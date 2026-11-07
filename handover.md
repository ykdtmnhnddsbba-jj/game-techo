# ゲーム手帖 引継ぎ資料

## 最新ソースの場所
- リポジトリ: https://github.com/ykdtmnhnddsbba-jj/game-techo （main / root。公開サイトは GitHub Pages）
- ローカル: `G:\マイドライブ\App\ゲームデータベース`（index.html / games.json / scripts/ / README.md / handover.md）
- 元になったサイト: アニメ手帖（`G:\マイドライブ\App\アニメデータベース` / リポジトリ anime-techo）。レイアウト・評価UI・Drive同期はこれを踏襲。
- 参考: `G:\マイドライブ\App\PS5-Game-Radar`（PowerShell製のローカルアプリ。同じファミ通ページから取得している）
- 注意: ローカルフォルダの `.github` は書き込みが保護されている。ワークフローは**リポジトリ側**（`.github/workflows/update-games.yml`）が正本。

## 構成
- `index.html` 単一ファイル（CSS/JS同梱、ビルドなし）。タブ: 発売月 / マイ評価 / 好み分析 / 設定。
- `games.json` ゲームデータ（ファミ通.com の PS5 発売日スケジュール）。画面はこれを fetch するだけ。
- `scripts/famitsu-parse.mjs` ファミ通HTMLの解析（純粋関数）。`scripts/fetch-famitsu.mjs` が取得・マージ・書き出し。
- `.github/workflows/update-games.yml` 毎日 04:17 JST に取得 → games.json を commit。
- `scripts/fetch-igdb.mjs` は旧IGDB版（不使用。ローカルから削除できなかったので残っている。消してよい）。

## データ形式
- games.json: `{source, platform, generated_at, window:{from,to}, excluded_ids, games:[{id(ファミ通のタイトルID), name, native(空), cover, release(YYYY-MM-DD), region:'JP', genres[], tags[], developer(メーカー), series(空), avg:null, pop:0, desc:'', price, url, detail_at}]}`
- game-db.json（Drive/書き出し）: `{_readme, schema_version, updated_at, ratings:{<id>:{title, cover, release, score, memo, played, fav, want, genres, tags, developer, series, rated_at, updated_at, deleted?}}, custom_games:{<c…>:{…}}}`
- 削除は `deleted:true`。同期は `updated_at` の新しい方を採用してマージ。
- localStorage キー: `gamedb.v1` / `gamedb.settings.v1` / `gamedb.gamesimport.v1`（アニメ手帖の `animedb.*` とは別）。Driveのファイル名は `game-db.json`。
- OAuthクライアントIDはアニメ手帖と同じものを index.html に埋め込み済み（github.io ユーザーが同じため使い回せる）。

## 仕様メモ
- 取得: 月別ページ `/schedule/ps5/YYYYMM` を2か月前〜12か月先、1秒間隔。ジャンル・メーカーは新規ゲームの個別ページ `/game/title/ID/page/1` のみ取得して games.json に保存（再取得しない）。同じIDが複数日にあれば早い日付を採用。PS5本体・周辺機器は除外（`NON_GAME` とジャンル「本体・周辺商品」）。取得失敗の月は前回の内容を残し、全月失敗なら exit 1 で games.json を触らない。
- ジャンル・メーカーが空のゲームは「相性%」が出ない（初回のActions実行後に入る）。
- 画像はファミ通の商品画像サーバー（`image.kagali.kgl-systems.io`、`?w=400&h=400&func=bound`）を `referrerpolicy="no-referrer"` で表示。
- 数字で終わるタイトルの価格にタイトル末尾の数字がくっつく不具合を修正済み（`stripTags` はタグを空白に置換）。

## 未検証（正直に）
- GitHub Actions（海外IP）からファミ通に繋がるか。繋がらなければ自分のPCで `node scripts/fetch-famitsu.mjs` を実行して games.json を push する。
- 実ブラウザでの Drive 同期（サンドボックスでは Google に繋がらない）。
- ファミ通の画像サーバーからのホットリンクが github.io 上で表示されるか（no-referrer 指定で表示される想定。ダメなら 🎮 表示になる）。
- 取得スクリプトの実通信はこの環境から行えていない。パーサーはユーザーのブラウザ上で実ページ（2026-11 PS5）に対して検証済み、取得の流れはモックサーバーで検証済み。

## 次の候補
- Switch 2 / PS4 など他機種の追加（`/schedule/switch2/` などは未確認）。
- シリーズ名の推定（タイトルの共通プレフィックスから）で好み分析を強化。
- 「気になる」だけの一覧（購入予定リスト）、発売日が近いものの通知。
- 発売日の変更検知（前回の games.json との差分表示）。
