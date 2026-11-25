// Concurrency / reservation tests for the faucet worker.
//
// Runs the real worker fetch handler against an in-memory KV mock and
// a mocked chain RPC (global fetch stub). No live faucet funds are
// touched: the wallet key is generated fresh for each run and every
// RPC answer is fabricated.
//
// Scenarios:
//   1. While claim A is in flight (reserved, broadcast blocked), a
//      second claim for the same address is rejected
//      (address_cooldown) and one from the same IP is rejected
//      (ip_cooldown). After A succeeds, the address is on its normal
//      recorded cooldown and all reservation keys are gone.
//   2. A failed send releases the reservation: an immediate retry of
//      the same claim succeeds.
//   3. The daily cap counts in-flight reservations: with 99 recorded
//      claims and 1 in flight, a further claim hits daily_limit.
//
// Run: node test-reservation.mjs   (or: npm test)

import { ethers } from "ethers";
import worker from "./worker.js";

const tick = (ms) => new Promise((r) => setTimeout(r, ms));

// --- KV mock -------------------------------------------------------
// put/delete apply synchronously at call time (models the fast
// same-location write visibility Cloudflare documents); get/list
// resolve after a small delay. Expiration TTLs are honoured against
// the wall clock.
class MockKV {
  constructor() { this.map = new Map(); }
  _live(key) {
    const e = this.map.get(key);
    if (!e) return null;
    if (e.exp && Date.now() > e.exp) { this.map.delete(key); return null; }
    return e;
  }
  async get(key) { await tick(1); const e = this._live(key); return e ? e.value : null; }
  async put(key, value, opts = {}) {
    const exp = opts.expirationTtl ? Date.now() + opts.expirationTtl * 1000 : null;
    this.map.set(key, { value: String(value), exp });
  }
  async delete(key) { this.map.delete(key); }
  async list({ prefix = "", limit = 1000 } = {}) {
    await tick(1);
    const keys = [...this.map.keys()].filter((k) => k.startsWith(prefix) && this._live(k));
    return { keys: keys.slice(0, limit).map((name) => ({ name })), list_complete: true, cursor: "" };
  }
}

// --- RPC mock ------------------------------------------------------
const faucetWallet = ethers.Wallet.createRandom();
const FAUCET_ADDR = faucetWallet.address;
let sendBehaviour = { mode: "ok" }; // "ok" | "fail" | "block"
let sendEntered = null;             // promise resolver: broadcast reached
let sendGate = null;                // promise the blocked broadcast waits on

function rpcResult(method, params) {
  switch (method) {
    case "eth_getBalance": {
      const who = String(params[0]).toLowerCase();
      return who === FAUCET_ADDR.toLowerCase() ? "0x3635c9adc5dea00000" : "0x0"; // 1000 / 0
    }
    case "eth_gasPrice": return "0x3b9aca00";
    case "eth_getTransactionCount": return "0x0";
    case "eth_sendRawTransaction": return null; // handled async below
    default: return "0x0";
  }
}

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.includes("infinitepanda.xyz") || u.includes("mschihuahua.org")) {
    const body = JSON.parse(opts.body);
    if (body.method === "eth_sendRawTransaction") {
      if (sendEntered) { const r = sendEntered; sendEntered = null; r(); }
      if (sendBehaviour.mode === "block") await sendGate;
      if (sendBehaviour.mode === "fail") {
        return { json: async () => ({ jsonrpc: "2.0", id: 1, error: { message: "execution reverted" } }) };
      }
      return { json: async () => ({ jsonrpc: "2.0", id: 1, result: "0x" + "cd".repeat(32) }) };
    }
    return { json: async () => ({ jsonrpc: "2.0", id: 1, result: rpcResult(body.method, body.params || []) }) };
  }
  return realFetch(url, opts);
};

// --- helpers -------------------------------------------------------
function makeEnv() {
  return { FAUCET_KV: new MockKV(), FAUCET_PRIVATE_KEY_42: faucetWallet.privateKey };
}
function claimReq(address, ip) {
  return new Request("https://faucet.test/claim", {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip },
    body: JSON.stringify({ chain: "42", token: "native", address }),
  });
}
const ADDR_A = "0x1111111111111111111111111111111111111111";
const ADDR_B = "0x2222222222222222222222222222222222222222";
const NS = "42:native:";
const today = () => new Date().toISOString().slice(0, 10);

let failures = 0;
function check(name, cond, extra = "") {
  console.log((cond ? "PASS" : "FAIL") + "  " + name + (extra ? "  (" + extra + ")" : ""));
  if (!cond) failures++;
}

// --- scenario 1: in-flight reservation blocks duplicates -----------
{
  const env = makeEnv();
  sendBehaviour = { mode: "block" };
  let releaseSend;
  sendGate = new Promise((r) => { releaseSend = r; });
  const entered = new Promise((r) => { sendEntered = r; });

  const pA = worker.fetch(claimReq(ADDR_A, "203.0.113.1"), env);
  await entered; // A has reserved and is stuck in the broadcast

  const resB = await worker.fetch(claimReq(ADDR_A, "203.0.113.2"), env);
  const bodyB = await resB.json();
  check("S1 same address blocked in flight", resB.status === 429 && bodyB.code === "address_cooldown", bodyB.code);

  const resC = await worker.fetch(claimReq(ADDR_B, "203.0.113.1"), env);
  const bodyC = await resC.json();
  check("S1 same IP blocked in flight", resC.status === 429 && bodyC.code === "ip_cooldown", bodyC.code);

  releaseSend();
  sendBehaviour = { mode: "ok" };
  const resA = await pA;
  const bodyA = await resA.json();
  check("S1 first claim succeeds", resA.status === 200 && bodyA.ok === true && !!bodyA.txHash);

  const kv = env.FAUCET_KV;
  check("S1 reservation keys cleaned up",
    (await kv.get(NS + "rsv:addr:" + ADDR_A.toLowerCase())) === null &&
    (await kv.get(NS + "rsv:ip:203.0.113.1")) === null &&
    (await kv.list({ prefix: NS + "rsvday:" })).keys.length === 0);
  check("S1 claim recorded (addr + total)",
    (await kv.get(NS + "addr:" + ADDR_A.toLowerCase())) !== null &&
    (await kv.get(NS + "total")) === "1");

  const resD = await worker.fetch(claimReq(ADDR_A, "203.0.113.9"), env);
  const bodyD = await resD.json();
  check("S1 recorded cooldown applies after success", resD.status === 429 && bodyD.code === "address_cooldown", bodyD.code);
}

// --- scenario 2: failed send releases the reservation --------------
{
  const env = makeEnv();
  sendBehaviour = { mode: "fail" };
  const res1 = await worker.fetch(claimReq(ADDR_A, "203.0.113.1"), env);
  const body1 = await res1.json();
  check("S2 failing send reports send_failed", res1.status === 502 && body1.code === "send_failed", body1.code);

  sendBehaviour = { mode: "ok" };
  const res2 = await worker.fetch(claimReq(ADDR_A, "203.0.113.1"), env);
  const body2 = await res2.json();
  check("S2 immediate retry succeeds after release", res2.status === 200 && body2.ok === true, body2.code || "ok");
}

// --- scenario 3: daily cap counts in-flight reservations -----------
{
  const env = makeEnv();
  await env.FAUCET_KV.put(NS + "day:" + today(), "99", { expirationTtl: 3600 });
  sendBehaviour = { mode: "block" };
  let releaseSend;
  sendGate = new Promise((r) => { releaseSend = r; });
  const entered = new Promise((r) => { sendEntered = r; });

  const pA = worker.fetch(claimReq(ADDR_A, "203.0.113.1"), env);
  await entered;

  const resB = await worker.fetch(claimReq(ADDR_B, "203.0.113.2"), env);
  const bodyB = await resB.json();
  check("S3 99 recorded + 1 in flight hits daily_limit", resB.status === 429 && bodyB.code === "daily_limit", bodyB.code);

  releaseSend();
  sendBehaviour = { mode: "ok" };
  const resA = await pA;
  check("S3 reserved claim completes", resA.status === 200);
  check("S3 day counter recorded as 100", (await env.FAUCET_KV.get(NS + "day:" + today())) === "100");
}

console.log(failures === 0 ? "\nALL TESTS PASSED" : "\n" + failures + " TEST(S) FAILED");
process.exit(failures === 0 ? 0 : 1);
