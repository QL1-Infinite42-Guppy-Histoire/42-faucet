# 42 Chain & QL1 フォーセット / 42 Chain & QL1 Faucet

42 Chain メインネットと QL1 の公開フォーセットです。ウォレットの残高がほぼ無い人が、ガス代の足しになる小額のネイティブトークンを無料でもらえます。

A public faucet for 42 Chain mainnet and QL1. Newcomers whose wallets are almost empty can claim a small amount of the native token for gas.

- サイト / Site: https://ql1-infinite42-guppy-histoire.github.io/42-faucet/
- 送金係 Worker / Worker: https://42-faucet.nepicobsv.workers.dev

## 配布内容 / What you get

| チェーン / Chain | EVM chain ID | もらえる量（デフォルト）/ Claim amount (default) |
|---|---|---|
| 42 Chain | 421018 | 0.05 [42] |
| 42 Chain（ZAP トークン / ZAP token） | 421018 | 1 ZAP |
| QL1 | 766 | 10,000,000 QOM |

ZAP は 42 Chain 上の ERC-20（コントラクト `0x89195Ca5C954b6f99b78f4A2Aa5435A75Dc5B256`）で、42 Chain と同じ配布ウォレットから送ります。サイトの 42 Chain タブ内のチップ（[42] / ZAP）で切り替えます。ZAP は1回の受け取りごとに、受取人への 1 ZAP に加えて **0.5 ZAP をバーンアドレス `0x000000000000000000000000000000000000dEaD` へ送って燃やします**（1回あたりの消費は合計 1.5 ZAP）。累計燃焼量は、バーンアドレスの ZAP 残高（オンチェーンの実数）をサイトに表示します。[42] と QOM の配布に燃焼はありません。

ZAP is an ERC-20 on 42 Chain (contract `0x89195Ca5C954b6f99b78f4A2Aa5435A75Dc5B256`), sent from the same 42 Chain faucet wallet. Switch between [42] and ZAP with the chips in the 42 Chain tab. Each ZAP claim also **burns 0.5 ZAP** to `0x000000000000000000000000000000000000dEaD` (1.5 ZAP consumed per claim in total). The site shows the cumulative total burned **through this faucet** (a counter kept by the Worker, incremented only when a claim's burn transfer succeeds; ZAP burned by others to the same address is not included). [42] and QOM claims have no burn.

## ルール / Rules

濫用対策は（チェーン × トークン）の組み合わせごとに独立して数えます / Limits apply independently per (chain × token):

- 同じアドレスは7日に1回まで / 1 claim per address every 7 days
- 同じ回線（IP）は24時間に1回まで / 1 claim per IP every 24 hours
- [42] と QOM は、そのトークンの残高が「1回分以上」あるアドレスには配りません（[42]: 0.05 以上、QOM: 10,000,000 QOM 以上は不可。判定は対象トークンの残高だけです）。**ZAP だけは例外で残高ゲートが無く、すでに ZAP を持っているアドレスでも受け取れます** / For [42] and QOM, addresses already holding at least one claim amount of that token cannot claim (only that token's balance counts). **ZAP is the exception: no balance gate — existing ZAP holders can claim too**
- 組み合わせごとに1日100回まで / 100 claims per day per (chain × token)
- フォーセットのそのトークンの残高が「1回分の消費」未満になると自動で配布停止（ZAP は配布1＋燃焼0.5＝1.5 ZAP 未満で停止）/ Distribution pauses when the faucet's balance of that token drops below 1 claim's worth (for ZAP, one claim's cost is 1.5 ZAP including the burn)

## 仕組み / How it works

- フロントは静的サイト（`docs/`、GitHub Pages）。言語は英語デフォルト＋日本語切替（右上セレクタ、`faucet42_lang` に保存）、チェーンは [42 Chain | QL1] タブ切替（`faucet42_chain` に保存）。
- 送金は Cloudflare Worker（`worker/worker.js`）が行います。秘密鍵は Worker の Secret からのみ読み、サイトやこの repo には一切含まれません。鍵が未設定のチェーンは「準備中」を返し、そのチェーンだけ配布しません。
- ガス価格は送金時に `eth_gasPrice` を読んで使います（決め打ちしません。QL1 のフロアは高いので特に重要です）。
- 利用記録（アドレス・IP・日次カウンタ）は Cloudflare KV に（チェーン × トークン）名前空間付きで保存します。
- 配布が成功するたびに受取記録（アドレス・金額・tx・日時）と累計カウンタも KV に保存し、サイトの「受け取ったアドレス」一覧（合計件数＋最新100件）は Worker の `GET /claims` から読みます。
- Turnstile（人間判定）は任意です。Worker の Secret `TURNSTILE_SECRET` が設定されている時だけ検証し、サイト側も `docs/app.js` の `CONFIG.TURNSTILE_SITEKEY` が設定されている時だけウィジェットを表示します。

## セットアップ手順（管理者向け）/ Setup (for the owner)

チェーンごとに、配布専用ウォレットを新しく作るところから始めます。**秘密鍵はチャットや GitHub に絶対に貼らないでください。** 貼ってよいのは Cloudflare ダッシュボードの Secret 入力欄だけです。

Do this per chain. **Never paste a private key into chat or GitHub** — the only place it belongs is the Cloudflare dashboard secret field.

### 42 Chain

1. 配布専用の新しいウォレットを作ります（普段使いのウォレットとは分ける）。
2. そのアドレスに [42] と ZAP を入金します（例：50 [42] と 150 ZAP。配布 0.05 [42] × 約1,000回分／ZAP は配布 1 + 燃焼 0.5 = 1.5 ZAP × 100回分で、うち 50 ZAP が燃焼分）。[42] は ZAP 配布時のガス代にも使われるので、両方入れてください。
3. Cloudflare ダッシュボード → Workers & Pages → `42-faucet` → Settings → Variables and Secrets → Secret を追加：
   - 名前 / Name: `FAUCET_PRIVATE_KEY_42`
   - 値 / Value: 手順1のウォレットの秘密鍵
4. 数十秒で反映されます。サイトで 42 Chain タブを開き、残高が表示されれば稼働開始です。

### QL1

1. 配布専用の新しいウォレットを作ります（42 Chain 用とは別のもの）。
2. そのアドレスに QOM を入金します（例：1,000,000,000 QOM。配布 10,000,000 QOM × 100回分）。QL1 のガス代は高い（フロア 18 QOM/gas、1送金 21,000 gas で約378,000 QOM）ので、ガス分も含めて少し多めに入れてください。
3. Cloudflare ダッシュボード → Workers & Pages → `42-faucet` → Settings → Variables and Secrets → Secret を追加：
   - 名前 / Name: `FAUCET_PRIVATE_KEY_QL1`
   - 値 / Value: 手順1のウォレットの秘密鍵
4. サイトで QL1 タブを開き、残高が表示されれば稼働開始です。

### Turnstile を有効化する場合（任意）/ Optional Turnstile

1. Cloudflare ダッシュボードで Turnstile ウィジェットを作成し、サイトキーとシークレットキーを取得。
2. Worker の Secret に `TURNSTILE_SECRET`（シークレットキー）を追加。
3. `docs/app.js` の `CONFIG.TURNSTILE_SITEKEY` にサイトキーを入れて push（GitHub Pages に反映）。

### 配布額を変える場合 / Changing the claim amounts

Worker の環境変数で変えられます（Cloudflare ダッシュボード → `42-faucet` → Settings → Variables and Secrets）:

- `CLAIM_AMOUNT_42`（デフォルト `0.05`）
- `CLAIM_AMOUNT_ZAP`（デフォルト `1`）
- `CLAIM_BURN_ZAP`（デフォルト `0.5`、ZAP 1回の受け取りごとに燃やす量）
- `CLAIM_AMOUNT_QOM`（デフォルト `10000000`）

## 再デプロイ / Redeploying the worker

```sh
cd worker
npm install
npm run build        # -> dist/worker.bundle.js (ethers をバンドル)
# この VM の Cloudflare ヘルパーで、KV バインド付きでデプロイ
python3 ~/workspace/custom-connectors/custom.cloudflare/bin/cf.py deploy-bind \
  <ACCOUNT_ID> 42-faucet dist/worker.bundle.js bindings.json
```

注意：再デプロイ後は Cloudflare ダッシュボードで Secret（`FAUCET_PRIVATE_KEY_42` / `FAUCET_PRIVATE_KEY_QL1`）が残っているか必ず確認してください。消えていたら再登録が必要です。

Note: after redeploying, verify in the dashboard that the secrets are still present; re-add them if not.

## 開発メモ / Development notes

- RPC: 42 Chain は `https://evm-rpc.infinitepanda.xyz`（主）→ `https://evm-rpc-infinite.mschihuahua.org`（予備）、QL1 は `https://evm-rpc-ql1.mschihuahua.org`。
- ネイティブ配布は EVM ネイティブ送金（21,000 gas、legacy 形式、ガス価格は `eth_gasPrice`）。ZAP は ERC-20 `transfer`（ガス量は `eth_estimateGas`、失敗時は 65,000 にフォールバック）。ZAP の燃焼は配布直後の2本目の `transfer`（バーンアドレス宛て）で、燃焼だけ失敗しても claim は成立扱いにして Worker ログに `burn_failed` として残します。`GET /status?token=zap` の `burnedTotal` は、このフォーセット経由で燃えた ZAP の累計です（Worker の KV カウンタ `42:zap:burned` に wei で保持し、バーン送金が成功した時だけその回の燃焼量を加算します。他者が同じバーンアドレスに燃やした分は含みません）。
- Worker の API: `GET /status?chain=42|ql1[&token=native|zap]`、`GET /claims?chain=42|ql1[&token=native|zap]`、`POST /claim`（`token` 省略時は `native`。`zap` は 42 Chain のみ、QL1 では `qom` も native の別名）。
- エクスプローラー: 42 Chain は https://scan.infinitedrive.xyz、QL1 は https://scan.qom.network。

## License

MIT
