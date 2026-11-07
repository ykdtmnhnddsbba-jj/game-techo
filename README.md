# ゲーム手帖（PS5）— セットアップ手順

アニメ手帖のゲーム版です。**発売月ごと**にPS5ゲームを一覧表示し、10段階評価・一言メモ・好み分析・オススメ（相性%）が使えます。
静的サイト（`index.html`）＋ 発売日データ（`games.json`）の構成で、費用はかかりません。

```
index.html                           画面（これだけでも動く）
games.json                           発売日データ（ファミ通から自動取得して更新）
scripts/famitsu-parse.mjs            ファミ通のHTMLを読み取る部分
scripts/fetch-famitsu.mjs            ファミ通から games.json を作るスクリプト
handover.md                          引継ぎ資料（最新ソースの場所・データ形式・次の候補）
.github/workflows/update-games.yml   上のスクリプトを毎日動かす設定
scripts/fetch-igdb.mjs               （旧）IGDB版。使いません。削除して構いません
```

## データについて
データ元は **ファミ通.com の「PS5 ゲーム発売日スケジュール」** です（PS5-Game-Radar と同じ元データ）。
- 取れるもの: 日本語タイトル・日本の発売日・価格・ジャンル・メーカー・商品画像
- 取れないもの: シリーズ名・テーマ・評価スコア → 好み分析は **ジャンルとメーカー** が中心になります（手動追加のゲームにはシリーズ名も入れられます）
- 月ごとの一覧ページを1回ずつ取得し、ジャンル・メーカーは新しく見つかったゲームの個別ページだけ取得します（結果は `games.json` に残るので2回目以降は取り直しません）。アクセス間隔は1秒です。
- PS5本体・周辺機器は除外し、同じタイトルが複数日（パッケージ版/DL版など）にある場合は早い日付を採用します。
- 発売日は変更されることがあります。購入前にメーカーやPS Storeの公式情報もご確認ください。
- 個人利用（非商用）の範囲で使ってください。

## 1. 公開する（GitHub Pages・約5分）
1. GitHub で新しいリポジトリを作る（例: `game-techo`、Public）
2. このフォルダの中身をアップロード。そのとき `github-workflows/update-games.yml` は、リポジトリ内で **`.github/workflows/update-games.yml`** の位置に置く（GitHub画面の Add file → Create new file で、ファイル名欄に `.github/workflows/update-games.yml` と入力して中身を貼り付けるのが簡単）。置いたあとは `github-workflows` フォルダは不要です
3. Settings → Pages → Source を `Deploy from a branch`、Branch を `main` / `(root)` にして Save
4. 数分後 `https://<ユーザー名>.github.io/game-techo/` で開ける

この時点で、評価・メモ・好み分析・AI用プロンプト出力・**ゲームの手動追加**が使えます（データはブラウザ内に保存）。

## 2. 発売日を自動で入れる（ファミ通・登録やキーは不要）
1. GitHub の Actions タブ → `Update games.json` → **Run workflow** で初回実行（以後は毎日 04:17 JST に自動実行）
2. 初回は個別ページを数百件取得するため、5〜10分ほどかかります
3. 完了すると `games.json` が更新され、サイトの「発売月」タブにゲームが並びます

### Actions がファミ通に繋がらなかった場合
GitHub Actions は海外のサーバーで動くため、ファミ通側に断られる可能性があります（こちらでは事前に確認できていません）。Actions のログに `HTTP 403` などが並んで「どの月も取得できませんでした」と出たら、**自分のPC**で実行してください。
1. Node.js 18 以上をインストール
2. このフォルダで `node scripts/fetch-famitsu.mjs` を実行 → `games.json` が更新される
3. 更新された `games.json` をGitHubにアップロード（Add file → Upload files）

取得範囲は2か月前〜12か月先です（`MONTHS_BACK` / `MONTHS_AHEAD` 環境変数で変更可）。範囲より古いデータは前回分を引き継ぎます。

## 3. Google Drive に自動保存する（無料）
OAuthクライアントIDは `index.html` に設定済みです（アニメ手帖と同じIDを使い回し）。公開サイトの「設定」タブで **連携 / 今すぐ同期** を押すだけです。
- 保存先は Drive の `game-db.json`（アニメの `anime-db.json` とは別ファイル）。権限は `drive.file`（このアプリが作ったファイルのみ）。
- `drive.file` では保存先フォルダを指定できないため、最初の1回だけ Drive 上でファイルを好きなフォルダへ移してください（以後は名前で見つかります）。
- 初回は Google の確認画面が出ます（「未確認のアプリ」なら 詳細 → 移動）。テストモードなので約7日で再接続が必要です。右上の「☁ 要再接続」をクリックしてください。
- 評価は **公開サイト（github.io）でだけ**付けてください。ローカルでファイルを直接開くと保存先（localStorage）が別になります。取り違えたら「JSONを書き出す」→公開サイトで「JSONを読み込む」で移せます。

## 4. 他のAIに乗り換える／使う
- 「好み分析」タブの **プロンプトを作る → コピー** を好きなAIに貼り付け。評価データと、選んだ月の候補が入っています。
- 「設定」→「JSONを書き出す」で `game-db.json` を取得し、そのままAIに渡してもOK（先頭の `_readme` に項目の説明あり）。

## データ形式（game-db.json）
```json
{
  "_readme": "...説明...",
  "schema_version": 1,
  "updated_at": "ISO8601",
  "ratings": {
    "<ファミ通のタイトルID（手動追加は c から始まるID）>": {
      "title": "表示名", "cover": "画像URL", "release": "2026-11-20",
      "score": 8, "memo": "一言メモ", "played": true, "fav": false, "want": false,
      "genres": ["アクション"], "tags": [], "developer": "メーカー", "series": "",
      "rated_at": "ISO8601", "updated_at": "ISO8601"
    }
  },
  "custom_games": { "<c...>": { "name": "...", "release": "YYYY-MM-DD", "genres": [], "developer": "", "series": "", "cover": "" } }
}
```
- 削除した評価は `deleted: true` が付き、同期で別端末にも反映されます。競合は `updated_at` が新しい方を採用します。

## 補足
- `index.html` を直接ダブルクリックで開く（file://）と `games.json` を読み込めません。公開サイトで開くか、設定タブから `games.json` を手動で読み込んでください。
- カバー画像はファミ通の商品画像サーバーのものを表示しています。表示されないゲームは🎮マークになります。
- 他機種に広げたい場合は、`scripts/fetch-famitsu.mjs` の `/schedule/ps5/` を別機種のURL（ファミ通には `/schedule/switch/` などがあります）に変える方向になりますが、PS5以外は未検証です。
