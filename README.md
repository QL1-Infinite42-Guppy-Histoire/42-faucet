# 42 Chain & QL1 フォーセット / 42 Chain & QL1 Faucet

42 Chain メインネットと QL1 の公開フォーセットです。ウォレットの残高がほぼ無い人が、ガス代の足しになる小額のネイティブトークンを無料でもらえます。

A public faucet for 42 Chain mainnet and QL1. Newcomers whose wallets are almost empty can claim a small amount of the native token for gas.

- サイト / Site: https://ql1-infinite42-guppy-histoire.github.io/42-faucet/
- 送金係 Worker / Worker: https://42-faucet.nepicobsv.workers.dev

## 配布内容 / What you get

| チェーン / Chain | EVM chain ID | もらえる量（デフォルト）/ Claim amount (default) |
|---|---|---|
| 42 Chain | 421018 | 0.05 [42] |
| QL1 | 766 | 10,000,000 QOM |

## ルール / Rules

濫用対策はチェーンごとに独立して数えます / Limits apply independently per chain:

- 同じアドレスは7日に1回まで / 1 claim per address every 7 days
- 同じ回線（IP）は24時間に1回まで / 1 claim per IP every 24 hours
- 残高が「1回分以上」あるアドレスには配りません（42 Chain: 0.05 [42] 以上、QL1: 10,000,000 QOM 以上は不可）/ Addresses already holding at least one claim amount cannot claim
- チェーンごとに1日100回まで / 100 claims per day per chain
- フォーセットの残高が「配布額×5」未満になると自動で配布停止 / Distribution pauses when the faucet balance drops below 5 claims' worth

## 仕組み / How it works

- フロントは静的サイト（`docs/`、GitHub Pages）。言語は英語デフォルト＋日本語切替（右上セレクタ、`faucet42_lang` に保存）、チェーンは [42 Chain | QL1] タブ切替（`faucet42_chain` に保存）。
- 送金は Cloudflare Worker（`worker/worker.js`）が行います。秘密鍵は Worker の Secret からのみ読み、サイトやこの repo には一切含まれません。鍵が未設定のチェーンは「準備中」を返し、そのチェーンだけ配布しません。
- ガス価格は送金時に `eth_gasPrice` を読んで使います（決め打ちしません。QL1 のフロアは高いので特に重要です）。
- 利用記録（アドレス・IP・日次カウンタ）は Cloudflare KV にチェーン名前空間付きで保存します。
- Turnstile（人間判定）は任意です。Worker の Secret `TURNSTILE_SECRET` が設定されている時だけ検証し、サイト側も `docs/app.js` の `CONFIG.TURNSTILE_SITEKEY` が設定されている時だけウィジェットを表示します。

## セットアップ手順（管理者向け）/ Setup (for the owner)

チェーンごとに、配布専用ウォレットを新しく作るところから始めます。**秘密鍵はチャットや GitHub に絶対に貼らないでください。** 貼ってよいのは Cloudflare ダッシュボードの Secret 入力欄だけです。

Do this per chain. **Never paste a private key into chat or GitHub** — the only place it belongs is the Cloudflare dashboard secret field.

### 42 Chain

1. 配布専用の新しいウォレットを作ります（普段使いのウォレットとは分ける）。
2. そのアドレスに [42] を入金します（例：50 [42]。配布 0.05 [42] × 約1,000回分）。
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
- 送金は EVM ネイティブ送金（21,000 gas、legacy 形式、ガス価格は `eth_gasPrice`）。
- エクスプローラー: 42 Chain は https://scan.infinitedrive.xyz、QL1 は https://scan.qom.network。

## License

MIT
