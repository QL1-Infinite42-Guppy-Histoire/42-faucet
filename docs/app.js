// 42 Chain & QL1 Faucet — shared frontend logic for en.html / ja.html.
// The page language comes from <html lang>; all strings live below.
// The chain ([42 Chain | QL1] tabs, like the GuppyWallet Home switch)
// is kept in localStorage and every number, balance and explorer link
// follows the selected chain.
//
// TURNSTILE_SITEKEY: leave "" to disable the Turnstile widget. When a
// sitekey is set here, the widget appears and its token is sent with
// each claim — the Worker then requires the matching TURNSTILE_SECRET.

const CONFIG = {
  WORKER_URL: "https://42-faucet.nepicobsv.workers.dev",
  TURNSTILE_SITEKEY: "",
};

const CHAINS = {
  "42": { name: "42 Chain", symbol: "[42]" },
  ql1: { name: "QL1", symbol: "QOM" },
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
    addrLabel: (name) => `Your ${name} address (0x…)`,
    gate: (amount, sym) => `${amount} ${sym}`,
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
    addrLabel: (name) => `あなたの ${name} アドレス（0x…）`,
    gate: (amount, sym) => `${amount} ${sym} 未満`,
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

// "10000000" -> "10,000,000"; "0.05" -> "0.05"; "12.5" -> "12.5"
function fmtDisplay(numStr) {
  const s = String(numStr);
  const dot = s.indexOf(".");
  const int = dot === -1 ? s : s.slice(0, dot);
  const rest = dot === -1 ? "" : s.slice(dot);
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + rest;
}

function sym() {
  return CHAINS[currentChain].symbol;
}

function setResult(html, isError) {
  resultEl.innerHTML = html;
  resultEl.className = "result" + (isError ? " error" : " ok");
}

function paintChainTabs() {
  $("chainBtn42").classList.toggle("active", currentChain === "42");
  $("chainBtnQl1").classList.toggle("active", currentChain === "ql1");
  $("subText").innerHTML = S.sub(CHAINS[currentChain].name, sym());
  $("addrLabel").textContent = S.addrLabel(CHAINS[currentChain].name);
}

async function loadStatus() {
  const chain = currentChain;
  statusEl.textContent = S.loading;
  claimBtn.disabled = true;
  try {
    const res = await fetch(CONFIG.WORKER_URL + "/status?chain=" + chain);
    const st = await res.json();
    if (chain !== currentChain) return null; // user switched meanwhile
    lastStatus = st;
    $("claimAmount").textContent = fmtDisplay(st.claimAmount) + " " + sym();
    $("gateAmount").textContent = S.gate(fmtDisplay(st.claimAmount), sym());
    if (st.reason === "not_ready" || (!st.ready && !st.faucetAddress)) {
      statusEl.textContent = S.notReady;
      $("faucetBalance").textContent = "—";
      $("claimsLeft").textContent = "";
      $("faucetAddr").textContent = "—";
      claimBtn.disabled = true;
      return st;
    }
    $("faucetAddr").textContent = st.faucetAddress || "—";
    $("faucetBalance").textContent = fmtDisplay(st.balance) + " " + sym();
    $("claimsLeft").textContent =
      typeof st.claimsLeft === "number" ? S.claimsLeft(st.claimsLeft) : "";
    if (!st.ready) {
      statusEl.textContent = S.faucetLow(fmtDisplay(st.balance), sym());
      claimBtn.disabled = true;
    } else {
      statusEl.textContent = S.ready(fmtDisplay(st.claimAmount), sym());
      claimBtn.disabled = false;
    }
    return st;
  } catch (e) {
    if (chain !== currentChain) return null;
    statusEl.textContent = S.statusError;
    claimBtn.disabled = true;
    return null;
  }
}

function switchChain(chain) {
  if (!CHAINS[chain] || chain === currentChain) return;
  currentChain = chain;
  try { localStorage.setItem("faucet42_chain", chain); } catch (e) { /* ignore */ }
  setResult("", false);
  resultEl.className = "result";
  paintChainTabs();
  loadStatus();
}

$("chainBtn42").addEventListener("click", () => switchChain("42"));
$("chainBtnQl1").addEventListener("click", () => switchChain("ql1"));

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
  claimBtn.disabled = true;
  setResult(S.sending, false);
  try {
    const res = await fetch(CONFIG.WORKER_URL + "/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chain, address, turnstileToken: token }),
    });
    const data = await res.json();
    if (data.ok) {
      setResult(
        S.sent(fmtDisplay(data.amount), CHAINS[data.chain || chain].symbol, data.explorerUrl, data.txHash),
        false
      );
    } else {
      setResult(errorMessage(data), true);
    }
  } catch (e) {
    setResult(S.err_generic, true);
  } finally {
    resetTurnstile();
    if (chain === currentChain) await loadStatus();
  }
}

claimBtn.addEventListener("click", claim);
addrInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !claimBtn.disabled) claim();
});

paintChainTabs();
initTurnstile();
loadStatus();
