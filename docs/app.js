// 42 Chain & QL1 Faucet — shared frontend logic for en.html / ja.html.
// The page language comes from <html lang>; all strings live below.
// The chain ([42 Chain | QL1] tabs, like the GuppyWallet Home switch)
// is kept in localStorage and every number, balance and explorer link
// follows the selected chain. On 42 Chain there is also a token switch
// ([42] / ZAP chips); QL1 always serves its native QOM.
//
// TURNSTILE_SITEKEY: leave "" to disable the Turnstile widget. When a
// sitekey is set here, the widget appears and its token is sent with
// each claim — the Worker then requires the matching TURNSTILE_SECRET.

const CONFIG = {
  WORKER_URL: "https://42-faucet.nepicobsv.workers.dev",
  TURNSTILE_SITEKEY: "",
};

const CHAINS = {
  "42": { name: "42 Chain", symbol: "[42]", explorer: "https://scan.infinitedrive.xyz" },
  ql1: { name: "QL1", symbol: "QOM", explorer: "https://scan.qom.network" },
};

const LANG = (document.documentElement.lang || "en").startsWith("ja") ? "ja" : "en";

const S = {
  en: {
    sub: (name, sym) =>
      `Running out of gas money on <b>${name}</b>? If your wallet is almost empty, you can claim a small amount of <b>${sym}</b> for free.`,
    loading: "Loading…",
    ready: (amount, sym) => `Ready — one claim is ${amount} ${sym}.`,
    notReady: "This chain's faucet is still being set up. Please come back later — the other chain may already be live.",
    faucetLow: (bal, sym) => `The faucet is low on funds (${bal} ${sym} left) and is paused. Please try again later.`,
    statusError: "Could not reach the faucet server. Please reload the page.",
    claimsLeft: (n) => `About ${n} claims left`,
    claimsTotal: (n) => `Total: ${n} claim${n === 1 ? "" : "s"} so far`,
    claimsEmpty: "No one has claimed yet.",
    claimsError: "Could not load the list.",
    addrLabel: (name) => `Your ${name} address (0x…)`,
    subZap: (amount) => `Claim ${amount} ZAP.`,
    gateNote: (amount, sym) =>
      `Only addresses holding <b>less than ${amount} ${sym}</b> can claim. This faucet is for gas relief, not a giveaway for funded wallets.`,
    gateNoteZap: "You can claim ZAP even if you already hold some.",
    smallNote: "Amounts are small on purpose: just enough to make a few transactions. Please don't drain it with many wallets.",
    smallNoteZap: "Amounts are small on purpose. Please don't drain it with many wallets.",
    stock: (bal, sym, n) => `Stock: ${bal} ${sym} (about ${n} claims left)`,
    invalidAddress: "That doesn't look like a valid address. Check it and try again.",
    sending: "Sending…",
    sent: (amount, sym, url, hash) =>
      `Sent ${amount} ${sym}! <a href="${url}" target="_blank" rel="noopener">View the transaction</a> (${hash.slice(0, 10)}…)`,
    err_address_cooldown: (h) => `This address already claimed recently. You can claim again in about ${h}.`,
    err_ip_cooldown: (h) => `This network already claimed recently. Please try again in about ${h}.`,
    err_balance_too_high: (amount, sym) => `This address already holds ${amount} ${sym} or more, so it doesn't need gas money.`,
    err_daily_limit: "Today's 100 claims on this chain are used up. Please come back tomorrow.",
    err_faucet_low: "The faucet is low on funds and has paused. Please try again later.",
    err_not_ready: "This chain's faucet is still being set up. Please come back later.",
    err_turnstile_failed: "The human check didn't pass. Please try again.",
    err_turnstile_needed: "Please complete the human check above first.",
    err_generic: "Something went wrong. Please try again in a moment.",
    hoursUnit: (h) => (h >= 48 ? `${Math.round(h / 24)} days` : `${h} hours`),
  },
  ja: {
    sub: (name, sym) =>
      `<b>${name}</b> のガス代が足りないときに。ウォレットがほぼ空なら、<b>${sym}</b> を小額だけ無料でもらえます。`,
    loading: "読み込み中…",
    ready: (amount, sym) => `受付中 — 1回にもらえるのは ${amount} ${sym} です。`,
    notReady: "このチェーンのフォーセットはまだ準備中です。もう少し待ってから来てください（もう片方のチェーンは始まっているかもしれません）。",
    faucetLow: (bal, sym) => `フォーセットの残りが少ないため（残り ${bal} ${sym}）、配布を止めています。また後で来てください。`,
    statusError: "フォーセットのサーバーにつながりませんでした。ページを再読み込みしてください。",
    claimsLeft: (n) => `あと約 ${n} 回分あります`,
    claimsTotal: (n) => `合計 ${n} 件`,
    claimsEmpty: "まだ受け取った人はいません。",
    claimsError: "一覧を読み込めませんでした。",
    addrLabel: (name) => `あなたの ${name} アドレス（0x…）`,
    subZap: (amount) => `ZAP を ${amount} 枚受け取れます。`,
    gateNote: (amount, sym) =>
      `もらえるのは残高が <b>${amount} ${sym} 未満</b> のアドレスだけです。これはガス代救済用で、お金のあるウォレットへの配布ではありません。`,
    gateNoteZap: "ZAP は、すでに持っているアドレスでも受け取れます。",
    smallNote: "金額は「数回分の取引ができる程度」にあえて小さくしています。複数のウォレットでの取り尽くしはご遠慮ください。",
    smallNoteZap: "配布量はあえて小さくしています。複数のウォレットでの取り尽くしはご遠慮ください。",
    stock: (bal, sym, n) => `在庫： ${bal} ${sym}（あと約 ${n} 回分）`,
    invalidAddress: "アドレスの形が違うようです。確認してもう一度どうぞ。",
    sending: "送っています…",
    sent: (amount, sym, url, hash) =>
      `${amount} ${sym} を送りました！ <a href="${url}" target="_blank" rel="noopener">取引を見る</a>（${hash.slice(0, 10)}…）`,
    err_address_cooldown: (h) => `このアドレスは最近もらったばかりです。次にもらえるのは約 ${h} 後です。`,
    err_ip_cooldown: (h) => `この回線からは最近もらったばかりです。約 ${h} 待ってからどうぞ。`,
    err_balance_too_high: (amount, sym) => `このアドレスはすでに ${amount} ${sym} 以上を持っているので、ガス代の救済は不要です。`,
    err_daily_limit: "このチェーンの今日の配布分（100回）が終わりました。また明日来てください。",
    err_faucet_low: "フォーセットの残りが少ないため、配布を止めています。また後で来てください。",
    err_not_ready: "このチェーンのフォーセットはまだ準備中です。もう少し待ってから来てください。",
    err_turnstile_failed: "人間かどうかの確認が通りませんでした。もう一度どうぞ。",
    err_turnstile_needed: "先に上の「人間かどうか」の確認を済ませてください。",
    err_generic: "うまくいきませんでした。少し待ってもう一度どうぞ。",
    hoursUnit: (h) => (h >= 48 ? `約${Math.round(h / 24)}日` : `約${h}時間`),
  },
}[LANG];

// ---- current chain (persisted) ----
let currentChain = "42";
try {
  const saved = localStorage.getItem("faucet42_chain");
  if (saved && CHAINS[saved]) currentChain = saved;
} catch (e) { /* storage unavailable: default 42 Chain */ }

// ---- current token on 42 Chain (persisted); QL1 is always native ----
const TOKENS_42 = { native: "[42]", zap: "ZAP" };
let currentToken = "native";
try {
  const saved = localStorage.getItem("faucet42_token");
  if (saved && TOKENS_42[saved]) currentToken = saved;
} catch (e) { /* storage unavailable: default native */ }

// Sanitize an impossible stored combination (chain=ql1 with
// token=zap left over from a 42 Chain visit): the token switch only
// exists on 42 Chain, and asking the QL1 worker for "zap" returns a
// 400 with no claim amount. Correct the state and write the fix back.
if (currentChain === "ql1" && currentToken !== "native") {
  currentToken = "native";
  try { localStorage.setItem("faucet42_token", "native"); } catch (e) { /* ignore */ }
}

// The token actually requested for the current selection: always
// "native" on QL1, whatever the stored state says.
function effToken() {
  return currentChain === "ql1" ? "native" : currentToken;
}

function symFor(chain, token) {
  if (chain === "ql1") return CHAINS.ql1.symbol;
  return TOKENS_42[token] || TOKENS_42.native;
}

// ---- language selector (top-right, persisted) ----
(function initLang() {
  const sel = document.getElementById("langSel");
  if (!sel) return;
  sel.addEventListener("change", () => {
    const v = sel.value;
    try { localStorage.setItem("faucet42_lang", v); } catch (e) { /* storage unavailable: still navigate */ }
    location.href = v === "ja" ? "ja.html" : "en.html";
  });
})();

const $ = (id) => document.getElementById(id);
const statusEl = $("status");
const resultEl = $("result");
const claimBtn = $("claimBtn");
const addrInput = $("addrInput");
let turnstileWidgetId = null;
let lastStatus = null;

// "10000000" -> "10,000,000"; "0.05" -> "0.05"; "12.5" -> "12.5".
// A missing value renders as a dash, never as "undefined"/"null".
function fmtDisplay(numStr) {
  if (numStr == null || numStr === "") return "—";
  const s = String(numStr);
  const dot = s.indexOf(".");
  const int = dot === -1 ? s : s.slice(0, dot);
  const rest = dot === -1 ? "" : s.slice(dot);
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + rest;
}

function sym() {
  return symFor(currentChain, currentToken);
}

function setResult(html, isError) {
  resultEl.innerHTML = html;
  resultEl.className = "result" + (isError ? " error" : " ok");
}

function isZap() {
  return currentChain === "42" && currentToken === "zap";
}

function paintChainTabs() {
  $("chainBtn42").classList.toggle("active", currentChain === "42");
  $("chainBtnQl1").classList.toggle("active", currentChain === "ql1");
  paintSub();
  $("addrLabel").textContent = S.addrLabel(CHAINS[currentChain].name);
  paintTokenSwitch();
  paintNotes();
}

// Subtitle per (chain x token): gas-relief copy for the native
// tokens, plain factual copy for ZAP (ZAP is not gas money).
// amountStr is display-formatted; a default is used until /status
// answers with the live value.
function paintSub(amountStr) {
  if (isZap()) {
    $("subText").innerHTML = S.subZap(amountStr || "1");
  } else {
    $("subText").innerHTML = S.sub(CHAINS[currentChain].name, sym());
  }
}

// The balance-gate note and the "small amounts" note also follow the
// selection: ZAP has no balance gate and no gas-relief framing.
function paintNotes(amountStr) {
  const gateEl = $("gateNote");
  if (gateEl) {
    gateEl.innerHTML = isZap()
      ? S.gateNoteZap
      : S.gateNote(amountStr || defaultAmountDisplay(), sym());
  }
  const smallEl = $("smallNote");
  if (smallEl) {
    smallEl.textContent = isZap() ? S.smallNoteZap : S.smallNote;
  }
}

function defaultAmountDisplay() {
  if (currentChain === "ql1") return "10,000,000";
  return "0.05";
}

// Prominent stock line: the faucet's balance of the selected token
// plus the remaining claim count (one claim costs one claim amount
// of the token). Hidden while the faucet is not_ready — the balance
// is unknown then.
function paintStock(st) {
  const el = $("stockLine");
  if (!el) return;
  if (!st || st.balance == null || typeof st.claimsLeft !== "number") {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  el.hidden = false;
  el.textContent = S.stock(
    fmtDisplay(st.balance),
    sym(),
    fmtDisplay(String(st.claimsLeft))
  );
}

// Token chips exist only on 42 Chain; QL1 always serves native QOM.
function paintTokenSwitch() {
  const box = $("tokenSwitch");
  if (!box) return;
  box.hidden = currentChain !== "42";
  $("tokenBtnNative").classList.toggle("active", currentToken === "native");
  $("tokenBtnZap").classList.toggle("active", currentToken === "zap");
}

async function loadStatus() {
  const chain = currentChain;
  const token = effToken();
  statusEl.textContent = S.loading;
  claimBtn.disabled = true;
  let res;
  try {
    res = await fetch(
      CONFIG.WORKER_URL + "/status?chain=" + chain + "&token=" + token
    );
  } catch (e) {
    // A rejected fetch is a genuine network failure — the only case
    // that earns the "could not reach the server" wording.
    if (chain !== currentChain || token !== effToken()) return null;
    statusEl.textContent = S.statusError;
    paintStock(null);
    claimBtn.disabled = true;
    return null;
  }
  const st = await res.json().catch(() => null);
  if (chain !== currentChain || token !== effToken()) return null; // user switched meanwhile
  if (!res.ok || !st || st.claimAmount == null) {
    // The server answered, but with an HTTP error (e.g. 400) or a
    // body without a claim amount. That is NOT a connection
    // failure: show a plain retry message and dashes — never an
    // "undefined" amount, never the network-error wording.
    statusEl.textContent = S.err_generic;
    $("claimAmount").textContent = "—";
    $("faucetBalance").textContent = "—";
    $("claimsLeft").textContent = "";
    $("faucetAddr").textContent = "—";
    paintStock(null);
    claimBtn.disabled = true;
    return null;
  }
  lastStatus = st;
    $("claimAmount").textContent = fmtDisplay(st.claimAmount) + " " + sym();
    paintSub(fmtDisplay(st.claimAmount));
    paintNotes(fmtDisplay(st.claimAmount));
    if (st.reason === "not_ready" || (!st.ready && !st.faucetAddress)) {
      statusEl.textContent = S.notReady;
      $("faucetBalance").textContent = "—";
      $("claimsLeft").textContent = "";
      $("faucetAddr").textContent = "—";
      paintStock(null);
      claimBtn.disabled = true;
      return st;
    }
    $("faucetAddr").textContent = st.faucetAddress || "—";
    $("faucetBalance").textContent = fmtDisplay(st.balance) + " " + sym();
    $("claimsLeft").textContent =
      typeof st.claimsLeft === "number" ? S.claimsLeft(st.claimsLeft) : "";
    paintStock(st);
    if (!st.ready) {
      statusEl.textContent = S.faucetLow(fmtDisplay(st.balance), sym());
      claimBtn.disabled = true;
    } else {
      statusEl.textContent = S.ready(fmtDisplay(st.claimAmount), sym());
      claimBtn.disabled = false;
    }
    return st;
}

function switchChain(chain) {
  if (!CHAINS[chain] || chain === currentChain) return;
  currentChain = chain;
  try { localStorage.setItem("faucet42_chain", chain); } catch (e) { /* ignore */ }
  // The token switch exists only on 42 Chain: entering QL1 resets
  // the token to the chain default, so a stale "zap" can never be
  // sent to QL1 (which would answer 400 / no claim amount).
  if (chain === "ql1" && currentToken !== "native") {
    currentToken = "native";
    try { localStorage.setItem("faucet42_token", "native"); } catch (e) { /* ignore */ }
  }
  setResult("", false);
  resultEl.className = "result";
  paintChainTabs();
  loadStatus();
  loadClaims();
}

$("chainBtn42").addEventListener("click", () => switchChain("42"));
$("chainBtnQl1").addEventListener("click", () => switchChain("ql1"));

function switchToken(token) {
  if (!TOKENS_42[token] || token === currentToken) return;
  currentToken = token;
  try { localStorage.setItem("faucet42_token", token); } catch (e) { /* ignore */ }
  setResult("", false);
  resultEl.className = "result";
  paintChainTabs();
  loadStatus();
  loadClaims();
}

$("tokenBtnNative").addEventListener("click", () => switchToken("native"));
$("tokenBtnZap").addEventListener("click", () => switchToken("zap"));

// ---- public recipients list (per chain x token) ----
// Only the 6 most recent recipients are shown (the API returns the
// full list newest-first; the slice happens here at render time).
const CLAIMS_SHOW_MAX = 6;
async function loadClaims() {
  const chain = currentChain;
  const token = effToken();
  const totalEl = $("claimsTotal");
  const listEl = $("claimsList");
  if (!totalEl || !listEl) return;
  try {
    const res = await fetch(
      CONFIG.WORKER_URL + "/claims?chain=" + chain + "&token=" + token
    );
    const data = await res.json().catch(() => null);
    if (chain !== currentChain || token !== effToken()) return; // switched meanwhile
    if (!res.ok || !data) throw new Error("claims request failed");
    totalEl.textContent = S.claimsTotal(data.total || 0);
    listEl.textContent = "";
    const items = Array.isArray(data.items) ? data.items : [];
    if (!items.length) {
      const p = document.createElement("p");
      p.className = "claims-empty";
      p.textContent = S.claimsEmpty;
      listEl.appendChild(p);
      return;
    }
    const sym = symFor(chain, token);
    for (const it of items.slice(0, CLAIMS_SHOW_MAX)) {
      const row = document.createElement("div");
      row.className = "claim-item";
      const a = document.createElement("a");
      a.href = it.addressUrl;
      a.target = "_blank";
      a.rel = "noopener";
      a.className = "mono";
      a.textContent = it.address;
      row.appendChild(a);
      const meta = document.createElement("div");
      meta.className = "claim-meta";
      const amt = document.createElement("span");
      amt.textContent = fmtDisplay(it.amount) + " " + sym;
      meta.appendChild(amt);
      meta.appendChild(document.createTextNode(" · "));
      const tx = document.createElement("a");
      tx.href = it.txUrl;
      tx.target = "_blank";
      tx.rel = "noopener";
      tx.textContent = "tx";
      meta.appendChild(tx);
      meta.appendChild(document.createTextNode(" · "));
      const time = document.createElement("span");
      time.textContent = new Date((it.ts || 0) * 1000).toLocaleString();
      meta.appendChild(time);
      row.appendChild(meta);
      listEl.appendChild(row);
    }
  } catch (e) {
    if (chain !== currentChain || token !== effToken()) return;
    totalEl.textContent = "";
    listEl.textContent = "";
    const p = document.createElement("p");
    p.className = "claims-empty";
    p.textContent = S.claimsError;
    listEl.appendChild(p);
  }
}

// ---- optional Turnstile ----
function initTurnstile() {
  if (!CONFIG.TURNSTILE_SITEKEY) return;
  const box = $("turnstileBox");
  box.hidden = false;
  const script = document.createElement("script");
  script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
  script.async = true;
  script.onload = () => {
    if (window.turnstile) {
      turnstileWidgetId = window.turnstile.render(box, {
        sitekey: CONFIG.TURNSTILE_SITEKEY,
      });
    }
  };
  document.head.appendChild(script);
}

function turnstileToken() {
  if (!CONFIG.TURNSTILE_SITEKEY) return "";
  if (!window.turnstile || turnstileWidgetId === null) return "";
  return window.turnstile.getResponse(turnstileWidgetId) || "";
}

function resetTurnstile() {
  if (window.turnstile && turnstileWidgetId !== null) {
    try { window.turnstile.reset(turnstileWidgetId); } catch (e) { /* noop */ }
  }
}

function errorMessage(data) {
  const code = data && data.code;
  if (code === "address_cooldown") {
    const h = Math.max(1, Math.ceil((data.retryAfterSec || 0) / 3600));
    return S.err_address_cooldown(S.hoursUnit(h));
  }
  if (code === "ip_cooldown") {
    const h = Math.max(1, Math.ceil((data.retryAfterSec || 0) / 3600));
    return S.err_ip_cooldown(S.hoursUnit(h));
  }
  if (code === "balance_too_high") {
    const amount = lastStatus ? fmtDisplay(lastStatus.claimAmount) : "";
    return S.err_balance_too_high(amount, sym());
  }
  const key = "err_" + code;
  return S[key] || S.err_generic;
}

async function claim() {
  const address = addrInput.value.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    setResult(S.invalidAddress, true);
    return;
  }
  let token = "";
  if (CONFIG.TURNSTILE_SITEKEY) {
    token = turnstileToken();
    if (!token) {
      setResult(S.err_turnstile_needed, true);
      return;
    }
  }
  const chain = currentChain;
  const ftoken = effToken();
  claimBtn.disabled = true;
  setResult(S.sending, false);
  try {
    const res = await fetch(CONFIG.WORKER_URL + "/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chain, token: ftoken, address, turnstileToken: token }),
    });
    const data = await res.json();
    if (data.ok) {
      setResult(
        S.sent(fmtDisplay(data.amount), symFor(chain, ftoken), data.explorerUrl, data.txHash),
        false
      );
    } else {
      setResult(errorMessage(data), true);
    }
  } catch (e) {
    setResult(S.err_generic, true);
  } finally {
    resetTurnstile();
    if (chain === currentChain) {
      await loadStatus();
      loadClaims();
    }
  }
}

claimBtn.addEventListener("click", claim);
addrInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !claimBtn.disabled) claim();
});

paintChainTabs();
initTurnstile();
loadStatus();
loadClaims();
