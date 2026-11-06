// Faucet worker — 42 Chain (mainnet) + QL1, one worker for both chains.
//
// Gives a small amount of the chain's native token to addresses that
// hold less than one claim amount, so newcomers can pay gas:
//   - 42 Chain (EVM 421018): [42],  default claim 0.05 [42]
//   - QL1      (EVM 766):    QOM,   default claim 10,000,000 QOM
//
// Private keys are read ONLY from Worker secrets, one per chain:
//   FAUCET_PRIVATE_KEY_42    for 42 Chain
//   FAUCET_PRIVATE_KEY_QL1   for QL1
// A chain whose secret is not set answers "not_ready" for that chain
// only; the other chain keeps working. No key is ever stored in this
// code, in the repository, or in logs, and no key is generated here.
//
// Bindings / variables:
//   FAUCET_KV           (KV namespace binding, required: rate limits)
//   CLAIM_AMOUNT_42     (plain variable, optional, default "0.05")
//   CLAIM_AMOUNT_QOM    (plain variable, optional, default "10000000")
//   TURNSTILE_SECRET    (secret, optional: enables Turnstile checks)
//
// Abuse limits, applied independently per chain (KV keys are
// namespaced "<chain>:..."):
//   - same address: 1 claim per 7 days
//   - same IP:      1 claim per 24 hours
//   - recipient must hold less than one claim amount
//   - global cap:   100 claims per day (UTC) per chain
//   - distribution pauses when the faucet balance drops below
//     5 x the claim amount

import { ethers } from "ethers";

const CHAINS = {
  "42": {
    id: "42",
    chainId: 421018,
    symbol: "42",
    rpcs: [
      "https://evm-rpc.infinitepanda.xyz",
      "https://evm-rpc-infinite.mschihuahua.org",
    ],
    explorerTx: "https://scan.infinitedrive.xyz/tx/",
    keyEnv: "FAUCET_PRIVATE_KEY_42",
    amountEnv: "CLAIM_AMOUNT_42",
    defaultAmount: "0.05",
  },
  ql1: {
    id: "ql1",
    chainId: 766,
    symbol: "QOM",
    rpcs: ["https://evm-rpc-ql1.mschihuahua.org"],
    explorerTx: "https://scan.qom.network/tx/",
    keyEnv: "FAUCET_PRIVATE_KEY_QL1",
    amountEnv: "CLAIM_AMOUNT_QOM",
    defaultAmount: "10000000",
  },
};

const GAS_LIMIT = 21000n;
const LOW_BALANCE_CLAIMS = 5n;
const ADDRESS_COOLDOWN_SEC = 7 * 24 * 3600;
const IP_COOLDOWN_SEC = 24 * 3600;
const DAILY_LIMIT = 100;
const DAY_KEY_TTL_SEC = 2 * 24 * 3600;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

function chainOf(v) {
  return CHAINS[String(v || "42").toLowerCase()] || null;
}

// Decimal string for a wei value ("0.0500" -> "0.05", "10000000.0" -> "10000000").
function fmt(wei) {
  const s = ethers.formatEther(wei);
  if (!s.includes(".")) return s;
  const [int, fracRaw] = s.split(".");
  const frac = fracRaw.replace(/0+$/, "");
  return frac ? int + "." + frac : int;
}

function claimAmountWei(env, cfg) {
  const raw = String(env[cfg.amountEnv] || cfg.defaultAmount).trim();
  try {
    const v = ethers.parseEther(raw);
    if (v > 0n) return v;
  } catch (e) { /* fall through to default */ }
  return ethers.parseEther(cfg.defaultAmount);
}

function getWallet(env, cfg) {
  const key = String(env[cfg.keyEnv] || "").trim();
  if (!key) return null;
  try {
    return new ethers.Wallet(key.startsWith("0x") ? key : "0x" + key);
  } catch (e) {
    return null;
  }
}

// JSON-RPC with failover across the chain's endpoints, in order.
async function rpc(cfg, method, params) {
  let lastErr = null;
  for (const url of cfg.rpcs) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message || "rpc error");
      return data.result;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("all RPC endpoints failed");
}

async function getBalance(cfg, address) {
  return BigInt(await rpc(cfg, "eth_getBalance", [address, "latest"]));
}

async function handleStatus(env, cfg) {
  const amount = claimAmountWei(env, cfg);
  const base = { chain: cfg.id, symbol: cfg.symbol, claimAmount: fmt(amount) };
  const wallet = getWallet(env, cfg);
  if (!wallet) return json({ ready: false, reason: "not_ready", ...base });
  let balance;
  try {
    balance = await getBalance(cfg, wallet.address);
  } catch (e) {
    return json({ ready: false, reason: "rpc_error", faucetAddress: wallet.address, ...base });
  }
  const claimsLeft = amount > 0n ? balance / amount : 0n;
  const ready = balance >= amount * LOW_BALANCE_CLAIMS;
  return json({
    ready,
    reason: ready ? null : "faucet_low",
    faucetAddress: wallet.address,
    balance: fmt(balance),
    claimsLeft: claimsLeft > 1000000n ? 1000000 : Number(claimsLeft),
    ...base,
  });
}

async function handleClaim(request, env) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ ok: false, code: "bad_request" }, 400);
  }
  const cfg = chainOf(body.chain);
  if (!cfg) return json({ ok: false, code: "bad_chain" }, 400);
  const meta = { chain: cfg.id, symbol: cfg.symbol };

  const wallet = getWallet(env, cfg);
  if (!wallet) return json({ ok: false, code: "not_ready", ...meta }, 503);
  const kv = env.FAUCET_KV;
  if (!kv) return json({ ok: false, code: "misconfigured", ...meta }, 500);

  let address;
  try {
    address = ethers.getAddress(String(body.address || "").trim());
  } catch (e) {
    return json({ ok: false, code: "invalid_address", ...meta }, 400);
  }

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";

  // Optional Turnstile check: only when the secret is configured.
  if (env.TURNSTILE_SECRET) {
    try {
      const form = new FormData();
      form.append("secret", env.TURNSTILE_SECRET);
      form.append("response", String(body.turnstileToken || ""));
      if (ip !== "unknown") form.append("remoteip", ip);
      const res = await fetch(
        "https://challenges.cloudflare.com/turnstile/v0/siteverify",
        { method: "POST", body: form }
      );
      const data = await res.json();
      if (!data.success) return json({ ok: false, code: "turnstile_failed", ...meta }, 403);
    } catch (e) {
      return json({ ok: false, code: "turnstile_failed", ...meta }, 403);
    }
  }

  const now = Math.floor(Date.now() / 1000);
  const ns = cfg.id + ":";

  // Same address: 1 claim per 7 days (per chain).
  const addrKey = ns + "addr:" + address.toLowerCase();
  const prevAddr = await kv.get(addrKey);
  if (prevAddr) {
    const nextAt = Number(prevAddr) + ADDRESS_COOLDOWN_SEC;
    if (now < nextAt) {
      return json({ ok: false, code: "address_cooldown", retryAfterSec: nextAt - now, ...meta }, 429);
    }
  }

  // Same IP: 1 claim per 24 hours (per chain).
  const ipKey = ns + "ip:" + ip;
  const prevIp = await kv.get(ipKey);
  if (prevIp) {
    const nextAt = Number(prevIp) + IP_COOLDOWN_SEC;
    if (now < nextAt) {
      return json({ ok: false, code: "ip_cooldown", retryAfterSec: nextAt - now, ...meta }, 429);
    }
  }

  // Global daily cap (UTC day, per chain).
  const dayKey = ns + "day:" + new Date().toISOString().slice(0, 10);
  const dayCount = Number((await kv.get(dayKey)) || 0);
  if (dayCount >= DAILY_LIMIT) {
    return json({ ok: false, code: "daily_limit", ...meta }, 429);
  }

  const amount = claimAmountWei(env, cfg);

  let recipientBalance, faucetBalance, gasPrice;
  try {
    recipientBalance = await getBalance(cfg, address);
    // Gas relief only: an address already holding at least one claim
    // amount does not need the faucet.
    if (recipientBalance >= amount) {
      return json({ ok: false, code: "balance_too_high", balance: fmt(recipientBalance), ...meta }, 400);
    }
    faucetBalance = await getBalance(cfg, wallet.address);
    // Gas price is read at send time on each chain (the QL1 floor is
    // high, so never hardcode it).
    gasPrice = BigInt(await rpc(cfg, "eth_gasPrice", []));
  } catch (e) {
    return json({ ok: false, code: "rpc_error", ...meta }, 502);
  }

  // Pause when the faucet runs low (below 5 claims) or cannot cover
  // this claim plus its gas.
  const needed = amount + gasPrice * GAS_LIMIT;
  if (faucetBalance < amount * LOW_BALANCE_CLAIMS || faucetBalance < needed) {
    return json({ ok: false, code: "faucet_low", balance: fmt(faucetBalance), ...meta }, 503);
  }

  // Sign and broadcast a plain native transfer (21,000 gas). One retry
  // on a stale nonce, in case two claims raced.
  let txHash = null;
  for (let attempt = 0; attempt < 2 && !txHash; attempt++) {
    try {
      const nonce = Number(
        await rpc(cfg, "eth_getTransactionCount", [wallet.address, "pending"])
      );
      const signed = await wallet.signTransaction({
        to: address,
        value: amount,
        gasLimit: Number(GAS_LIMIT),
        gasPrice,
        nonce,
        chainId: cfg.chainId,
      });
      txHash = await rpc(cfg, "eth_sendRawTransaction", [signed]);
    } catch (e) {
      if (attempt === 0 && /nonce/i.test(String(e && e.message))) continue;
      break;
    }
  }
  if (!txHash) {
    return json({ ok: false, code: "send_failed", ...meta }, 502);
  }

  // Record the claim only after a successful broadcast.
  await kv.put(addrKey, String(now), { expirationTtl: ADDRESS_COOLDOWN_SEC });
  if (ip !== "unknown") {
    await kv.put(ipKey, String(now), { expirationTtl: IP_COOLDOWN_SEC });
  }
  await kv.put(dayKey, String(dayCount + 1), { expirationTtl: DAY_KEY_TTL_SEC });

  return json({
    ok: true,
    txHash,
    amount: fmt(amount),
    explorerUrl: cfg.explorerTx + txHash,
    ...meta,
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }
    try {
      if (url.pathname === "/status" && request.method === "GET") {
        const cfg = chainOf(url.searchParams.get("chain"));
        if (!cfg) return json({ ok: false, code: "bad_chain" }, 400);
        return await handleStatus(env, cfg);
      }
      if (url.pathname === "/claim" && request.method === "POST") {
        return await handleClaim(request, env);
      }
      if (url.pathname === "/" && request.method === "GET") {
        return new Response(
          "42 Chain & QL1 Faucet Worker\n" +
            "GET  /status?chain=42|ql1\n" +
            "POST /claim {\"chain\": \"42\"|\"ql1\", \"address\": \"0x...\"}\n",
          { headers: { "Content-Type": "text/plain", ...CORS } }
        );
      }
      return json({ ok: false, code: "not_found" }, 404);
    } catch (e) {
      return json({ ok: false, code: "internal_error" }, 500);
    }
  },
};
