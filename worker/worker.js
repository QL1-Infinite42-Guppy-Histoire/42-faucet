// Faucet worker — 42 Chain (mainnet) + QL1, one worker for both chains.
//
// Gives a small amount of a token to addresses that hold less than one
// claim amount, as gas relief:
//   - 42 Chain (EVM 421018): [42] (native), default claim 0.05 [42]
//   - 42 Chain (EVM 421018): ZAP (ERC-20),  default claim 1 ZAP
//   - QL1      (EVM 766):    QOM (native),  default claim 10,000,000 QOM
//
// Every successful ZAP claim additionally burns 0.5 ZAP from the
// faucet wallet to the burn address 0x000…dEaD (a second ERC-20
// transfer right after the claim transfer), so one ZAP claim consumes
// 1.5 ZAP of stock. If only the burn transfer fails, the claim still
// counts (the claim transfer cannot be rolled back) and the failure
// is logged. The cumulative burned total shown by /status counts
// ONLY burns executed by this faucet: a KV counter at "<chain>:
// <token>:burned" (wei, decimal string) is incremented by the burn
// amount whenever — and only when — a claim's burn transfer
// succeeds. (The burn address's overall on-chain ZAP balance also
// includes other people's burns and is NOT what is displayed.)
//
// Private keys are read ONLY from Worker secrets, one per chain:
//   FAUCET_PRIVATE_KEY_42    for 42 Chain (both [42] and ZAP claims)
//   FAUCET_PRIVATE_KEY_QL1   for QL1
// A chain whose secret is not set answers "not_ready" for that chain
// only; the other chain keeps working. No key is ever stored in this
// code, in the repository, or in logs, and no key is generated here.
//
// Bindings / variables:
//   FAUCET_KV           (KV namespace binding, required: rate limits)
//   CLAIM_AMOUNT_42     (plain variable, optional, default "0.05")
//   CLAIM_AMOUNT_ZAP    (plain variable, optional, default "1")
//   CLAIM_BURN_ZAP      (plain variable, optional, default "0.5")
//   CLAIM_AMOUNT_QOM    (plain variable, optional, default "10000000")
//   TURNSTILE_SECRET    (secret, optional: enables Turnstile checks)
//
// Abuse limits, applied independently per (chain x token) pair (KV
// keys are namespaced "<chain>:<token>:..."):
//   - same address: 1 claim per 7 days
//   - same IP:      1 claim per 24 hours
//   - recipient must hold less than one claim amount of that token
//     ([42] and QOM only — ZAP has NO balance gate: existing ZAP
//     holders may claim too)
//   - global cap:   100 claims per day (UTC) per (chain x token)
//   - distribution pauses when the faucet's balance of that token
//     drops below 5 x the claim amount
//
// Claim history, in the same KV under the same namespace (no key
// collisions with the limit keys): every successful claim stores one
// record at "<chain>:<token>:claim:<zero-padded ts>:<txHash>" and
// bumps the cumulative counter at "<chain>:<token>:total". GET /claims
// lists the newest records (prefix scan, newest first) plus the total.

import { ethers } from "ethers";

// ZAP on 42 Chain (ERC-20, 18 decimals).
const ZAP_CONTRACT = "0x89195Ca5C954b6f99b78f4A2Aa5435A75Dc5B256";

// Burn address for the per-claim ZAP burn.
const BURN_ADDRESS = "0x000000000000000000000000000000000000dEaD";

const ERC20_IFACE = new ethers.Interface([
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address, uint256) returns (bool)",
]);

const CHAINS = {
  "42": {
    id: "42",
    chainId: 421018,
    rpcs: [
      "https://evm-rpc.infinitepanda.xyz",
      "https://evm-rpc-infinite.mschihuahua.org",
    ],
    explorerTx: "https://scan.infinitedrive.xyz/tx/",
    explorerAddr: "https://scan.infinitedrive.xyz/address/",
    keyEnv: "FAUCET_PRIVATE_KEY_42",
    tokens: {
      native: {
        id: "native",
        symbol: "42",
        contract: null,
        amountEnv: "CLAIM_AMOUNT_42",
        defaultAmount: "0.05",
      },
      zap: {
        id: "zap",
        symbol: "ZAP",
        contract: ZAP_CONTRACT,
        amountEnv: "CLAIM_AMOUNT_ZAP",
        defaultAmount: "1",
        burnEnv: "CLAIM_BURN_ZAP",
        burnDefault: "0.5",
        noGate: true,
      },
    },
  },
  ql1: {
    id: "ql1",
    chainId: 766,
    rpcs: ["https://evm-rpc-ql1.mschihuahua.org"],
    explorerTx: "https://scan.qom.network/tx/",
    explorerAddr: "https://scan.qom.network/address/",
    keyEnv: "FAUCET_PRIVATE_KEY_QL1",
    tokens: {
      native: {
        id: "native",
        symbol: "QOM",
        contract: null,
        amountEnv: "CLAIM_AMOUNT_QOM",
        defaultAmount: "10000000",
      },
    },
  },
};

const NATIVE_GAS_LIMIT = 21000n;
const ERC20_GAS_FALLBACK = 65000n;
const LOW_BALANCE_CLAIMS = 1n;
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

// Default is the chain's native token ("native"); an unknown token id
// for the chain returns null so the caller can reject it. On QL1 the
// native token may also be named "qom".
function tokenOf(cfg, v) {
  let id = String(v || "native").toLowerCase();
  if (cfg.id === "ql1" && id === "qom") id = "native";
  return cfg.tokens[id] || null;
}

// Decimal string for a wei value ("0.0500" -> "0.05", "10000000.0" -> "10000000").
function fmt(wei) {
  const s = ethers.formatEther(wei);
  if (!s.includes(".")) return s;
  const [int, fracRaw] = s.split(".");
  const frac = fracRaw.replace(/0+$/, "");
  return frac ? int + "." + frac : int;
}

function claimAmountWei(env, tok) {
  const raw = String(env[tok.amountEnv] || tok.defaultAmount).trim();
  try {
    const v = ethers.parseEther(raw);
    if (v > 0n) return v;
  } catch (e) { /* fall through to default */ }
  return ethers.parseEther(tok.defaultAmount);
}

// Per-claim burn for tokens that define one (ZAP only); 0 otherwise.
function claimBurnWei(env, tok) {
  if (!tok.burnEnv) return 0n;
  const raw = String(env[tok.burnEnv] || tok.burnDefault).trim();
  try {
    const v = ethers.parseEther(raw);
    if (v >= 0n) return v;
  } catch (e) { /* fall through to default */ }
  return ethers.parseEther(tok.burnDefault);
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

async function getNativeBalance(cfg, address) {
  return BigInt(await rpc(cfg, "eth_getBalance", [address, "latest"]));
}

// Balance of the given token: native balance for "native", ERC-20
// balanceOf for contract tokens.
async function getTokenBalance(cfg, tok, address) {
  if (!tok.contract) return getNativeBalance(cfg, address);
  const data = ERC20_IFACE.encodeFunctionData("balanceOf", [address]);
  const out = await rpc(cfg, "eth_call", [{ to: tok.contract, data }, "latest"]);
  return BigInt(out);
}

// Gas limit for an ERC-20 transfer: estimated on-chain, with a fixed
// fallback if the estimate call fails.
async function estimateErc20Gas(cfg, tok, from, to, amount) {
  try {
    const data = ERC20_IFACE.encodeFunctionData("transfer", [to, amount]);
    const est = await rpc(cfg, "eth_estimateGas", [
      { from, to: tok.contract, data },
    ]);
    const v = BigInt(est);
    if (v > 0n) return v;
  } catch (e) { /* fall through to the fallback */ }
  return ERC20_GAS_FALLBACK;
}

// Sign and broadcast one transaction; one retry on a stale nonce, in
// case two sends raced. Throws when the broadcast fails.
async function sendSigned(cfg, wallet, txBase, gasLimit, gasPrice) {
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const nonce = Number(
        await rpc(cfg, "eth_getTransactionCount", [wallet.address, "pending"])
      );
      const signed = await wallet.signTransaction({
        ...txBase,
        gasLimit: Number(gasLimit),
        gasPrice,
        nonce,
        chainId: cfg.chainId,
      });
      return await rpc(cfg, "eth_sendRawTransaction", [signed]);
    } catch (e) {
      lastErr = e;
      if (attempt === 0 && /nonce/i.test(String(e && e.message))) continue;
      break;
    }
  }
  throw lastErr || new Error("send failed");
}

async function handleStatus(env, cfg, tok) {
  const amount = claimAmountWei(env, tok);
  const burn = claimBurnWei(env, tok);
  const perClaim = amount + burn;
  const base = {
    chain: cfg.id,
    token: tok.id,
    symbol: tok.symbol,
    claimAmount: fmt(amount),
  };
  if (burn > 0n) {
    base.burnPerClaim = fmt(burn);
    base.burnAddress = BURN_ADDRESS;
    // Cumulative total burned BY THIS FAUCET ONLY, from its KV
    // counter ("<chain>:<token>:burned", stored in wei). Starts at
    // 0 and is incremented only when a claim's burn transfer
    // succeeds (see handleClaim). The burn address's overall
    // on-chain balance is deliberately not used here: it includes
    // ZAP burned by others before/outside this faucet.
    let burnedWei = 0n;
    const kv = env.FAUCET_KV;
    if (kv) {
      try {
        burnedWei = BigInt((await kv.get(cfg.id + ":" + tok.id + ":burned")) || "0");
      } catch (e) { /* keep 0 when the counter cannot be read */ }
    }
    base.burnedTotal = fmt(burnedWei);
  }
  const wallet = getWallet(env, cfg);
  if (!wallet) return json({ ready: false, reason: "not_ready", ...base });
  let balance;
  try {
    balance = await getTokenBalance(cfg, tok, wallet.address);
  } catch (e) {
    return json({ ready: false, reason: "rpc_error", faucetAddress: wallet.address, ...base });
  }
  // One claim consumes (amount + burn) of the token, so the remaining
  // claim count and the low-balance pause both use the combined cost.
  const claimsLeft = perClaim > 0n ? balance / perClaim : 0n;
  const ready = balance >= perClaim * LOW_BALANCE_CLAIMS;
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
  const tok = tokenOf(cfg, body.token);
  if (!tok) return json({ ok: false, code: "bad_token", chain: cfg.id }, 400);
  const meta = { chain: cfg.id, token: tok.id, symbol: tok.symbol };

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
  const ns = cfg.id + ":" + tok.id + ":";

  // Same address: 1 claim per 7 days (per chain x token).
  const addrKey = ns + "addr:" + address.toLowerCase();
  const prevAddr = await kv.get(addrKey);
  if (prevAddr) {
    const nextAt = Number(prevAddr) + ADDRESS_COOLDOWN_SEC;
    if (now < nextAt) {
      return json({ ok: false, code: "address_cooldown", retryAfterSec: nextAt - now, ...meta }, 429);
    }
  }

  // Same IP: 1 claim per 24 hours (per chain x token).
  const ipKey = ns + "ip:" + ip;
  const prevIp = await kv.get(ipKey);
  if (prevIp) {
    const nextAt = Number(prevIp) + IP_COOLDOWN_SEC;
    if (now < nextAt) {
      return json({ ok: false, code: "ip_cooldown", retryAfterSec: nextAt - now, ...meta }, 429);
    }
  }

  // Global daily cap (UTC day, per chain x token).
  const dayKey = ns + "day:" + new Date().toISOString().slice(0, 10);
  const dayCount = Number((await kv.get(dayKey)) || 0);
  if (dayCount >= DAILY_LIMIT) {
    return json({ ok: false, code: "daily_limit", ...meta }, 429);
  }

  const amount = claimAmountWei(env, tok);
  const burn = claimBurnWei(env, tok);
  const perClaim = amount + burn;

  let faucetTokenBalance, gasPrice, gasLimit, burnGasLimit = 0n;
  try {
    // Balance gate ([42] / QOM only): an address already holding at
    // least one claim amount of the token does not need gas relief.
    // ZAP has no gate — existing holders may claim. Only the target
    // token's balance is ever checked.
    if (!tok.noGate) {
      const recipientBalance = await getTokenBalance(cfg, tok, address);
      if (recipientBalance >= amount) {
        return json({ ok: false, code: "balance_too_high", balance: fmt(recipientBalance), ...meta }, 400);
      }
    }
    faucetTokenBalance = await getTokenBalance(cfg, tok, wallet.address);
    // Gas price is read at send time on each chain (the QL1 floor is
    // high, so never hardcode it).
    gasPrice = BigInt(await rpc(cfg, "eth_gasPrice", []));
    gasLimit = tok.contract
      ? await estimateErc20Gas(cfg, tok, wallet.address, address, amount)
      : NATIVE_GAS_LIMIT;
    if (burn > 0n) {
      burnGasLimit = await estimateErc20Gas(cfg, tok, wallet.address, BURN_ADDRESS, burn);
    }
  } catch (e) {
    return json({ ok: false, code: "rpc_error", ...meta }, 502);
  }

  // Pause when the faucet's balance of this token runs low: one claim
  // consumes (amount + burn), and distribution pauses below 1 claim's
  // worth of that combined cost. The gas itself is always paid in the
  // chain's native token, so for an ERC-20 claim the wallet's native
  // balance only has to cover the gas of both transfers.
  if (faucetTokenBalance < perClaim * LOW_BALANCE_CLAIMS) {
    return json({ ok: false, code: "faucet_low", balance: fmt(faucetTokenBalance), ...meta }, 503);
  }
  let faucetNativeBalance = faucetTokenBalance;
  if (tok.contract) {
    try {
      faucetNativeBalance = await getNativeBalance(cfg, wallet.address);
    } catch (e) {
      return json({ ok: false, code: "rpc_error", ...meta }, 502);
    }
  }
  if (faucetNativeBalance < gasPrice * (gasLimit + burnGasLimit)) {
    return json({ ok: false, code: "faucet_low", balance: fmt(faucetTokenBalance), ...meta }, 503);
  }

  // Sign and broadcast the claim transfer: a plain native transfer
  // (21,000 gas) or an ERC-20 transfer() call.
  const txBase = tok.contract
    ? {
        to: tok.contract,
        value: 0n,
        data: ERC20_IFACE.encodeFunctionData("transfer", [address, amount]),
      }
    : { to: address, value: amount };
  let txHash = null;
  try {
    txHash = await sendSigned(cfg, wallet, txBase, gasLimit, gasPrice);
  } catch (e) {
    txHash = null;
  }
  if (!txHash) {
    return json({ ok: false, code: "send_failed", ...meta }, 502);
  }

  // Burn transfer (ZAP only), sent right after the claim transfer. If
  // the burn alone fails, the claim still stands — the claim transfer
  // cannot be rolled back — and the inconsistency is logged so the
  // operator can reconcile it against the claim record.
  let burnTxHash = null;
  if (burn > 0n) {
    try {
      burnTxHash = await sendSigned(
        cfg,
        wallet,
        {
          to: tok.contract,
          value: 0n,
          data: ERC20_IFACE.encodeFunctionData("transfer", [BURN_ADDRESS, burn]),
        },
        burnGasLimit,
        gasPrice
      );
    } catch (e) {
      console.error(
        "burn_failed " +
          JSON.stringify({
            chain: cfg.id,
            token: tok.id,
            claimTx: txHash,
            address,
            burn: fmt(burn),
            error: String((e && e.message) || e),
          })
      );
    }
  }

  // Bump the faucet-only burned counter (the value /status returns
  // as burnedTotal) — ONLY when the burn transfer actually
  // succeeded, and only by that claim's burn amount. A failed burn
  // adds nothing. The claim itself already stands either way, so a
  // counter error here is logged, not fatal.
  if (burnTxHash) {
    try {
      const prevBurned = BigInt((await kv.get(ns + "burned")) || "0");
      await kv.put(ns + "burned", (prevBurned + burn).toString());
    } catch (e) {
      console.error(
        "burn_counter_failed " +
          JSON.stringify({
            chain: cfg.id,
            token: tok.id,
            claimTx: txHash,
            burnTx: burnTxHash,
            error: String((e && e.message) || e),
          })
      );
    }
  }

  // Record the claim only after a successful broadcast.
  await kv.put(addrKey, String(now), { expirationTtl: ADDRESS_COOLDOWN_SEC });
  if (ip !== "unknown") {
    await kv.put(ipKey, String(now), { expirationTtl: IP_COOLDOWN_SEC });
  }
  await kv.put(dayKey, String(dayCount + 1), { expirationTtl: DAY_KEY_TTL_SEC });

  // Claim history for the public recipients list: a cumulative counter
  // plus one record per claim, keyed by zero-padded timestamp so a KV
  // prefix list comes back in chronological order (read newest-first
  // by /claims). The "claim:" prefix cannot collide with the limit
  // keys ("addr:" / "ip:" / "day:" / "total" / "burned").
  const prevTotal = Number((await kv.get(ns + "total")) || 0);
  await kv.put(ns + "total", String(prevTotal + 1));
  const recKey = ns + "claim:" + String(now).padStart(12, "0") + ":" + txHash;
  await kv.put(
    recKey,
    JSON.stringify({ address, amount: fmt(amount), txHash, ts: now })
  );

  return json({
    ok: true,
    txHash,
    amount: fmt(amount),
    explorerUrl: cfg.explorerTx + txHash,
    ...(burnTxHash
      ? { burned: fmt(burn), burnTxHash, burnExplorerUrl: cfg.explorerTx + burnTxHash }
      : {}),
    ...meta,
  });
}

const CLAIMS_LIST_MAX = 100;

// Public recipients list: cumulative total + the newest claim records
// for one (chain x token). Read-only; works before any key is set
// (the log is simply empty until the first real claim).
async function handleClaims(env, cfg, tok) {
  const base = { chain: cfg.id, token: tok.id, symbol: tok.symbol };
  const kv = env.FAUCET_KV;
  if (!kv) return json({ ok: false, code: "misconfigured", ...base }, 500);
  const ns = cfg.id + ":" + tok.id + ":";
  const total = Number((await kv.get(ns + "total")) || 0);
  const listed = await kv.list({ prefix: ns + "claim:", limit: 1000 });
  const keys = listed.keys.map((k) => k.name).sort().reverse();
  const items = [];
  for (const key of keys.slice(0, CLAIMS_LIST_MAX)) {
    const raw = await kv.get(key);
    if (!raw) continue;
    try {
      const rec = JSON.parse(raw);
      items.push({
        address: rec.address,
        amount: rec.amount,
        txHash: rec.txHash,
        ts: rec.ts,
        txUrl: cfg.explorerTx + rec.txHash,
        addressUrl: cfg.explorerAddr + rec.address,
      });
    } catch (e) { /* skip a corrupt record */ }
  }
  return json({ total, items, ...base });
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
        const tok = tokenOf(cfg, url.searchParams.get("token"));
        if (!tok) return json({ ok: false, code: "bad_token", chain: cfg.id }, 400);
        return await handleStatus(env, cfg, tok);
      }
      if (url.pathname === "/claim" && request.method === "POST") {
        return await handleClaim(request, env);
      }
      if (url.pathname === "/claims" && request.method === "GET") {
        const cfg = chainOf(url.searchParams.get("chain"));
        if (!cfg) return json({ ok: false, code: "bad_chain" }, 400);
        const tok = tokenOf(cfg, url.searchParams.get("token"));
        if (!tok) return json({ ok: false, code: "bad_token", chain: cfg.id }, 400);
        return await handleClaims(env, cfg, tok);
      }
      if (url.pathname === "/" && request.method === "GET") {
        return new Response(
          "42 Chain & QL1 Faucet Worker\n" +
            "GET  /status?chain=42|ql1[&token=native|zap]\n" +
            "GET  /claims?chain=42|ql1[&token=native|zap]\n" +
            "POST /claim {\"chain\": \"42\"|\"ql1\", \"token\": \"native\"|\"zap\", \"address\": \"0x...\"}\n" +
            "(token defaults to \"native\"; \"zap\" is 42 Chain only; on QL1 \"qom\" also names the native token)\n",
          { headers: { "Content-Type": "text/plain", ...CORS } }
        );
      }
      return json({ ok: false, code: "not_found" }, 404);
    } catch (e) {
      return json({ ok: false, code: "internal_error" }, 500);
    }
  },
};
