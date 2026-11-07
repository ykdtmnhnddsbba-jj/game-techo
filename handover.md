# ゲーム手帖 引継ぎ資料

## 最新ソースの場所（まずここを読む）
- **正本は GitHub リポジトリ**。ローカルフォルダはその複製で、`games.json` は GitHub Actions が毎日更新するため、ローカルのものは古いことがある（最新が必要なら git pull か GitHub から取得）。
- 続きの作業でリポジトリに push するには、セッションにリポジトリ `ykdtmnhnddsbba-jj/game-techo` を追加する。
- `.github/workflows` は編集内容をローカルへ書けない。ワークフローを直すときはリポジトリ側へ直接 push する。
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
- `scripts/fetch-igdb.mjs`（ローカルのみに残る）は旧IGDB版で不使用。リポジトリには無い。消してよい。
- ローカルの `github-workflows/update-games.yml` はリポジトリ側ワークフローの控え。

## データ形式
- games.json: `{source, platform, generated_at, window:{from,to}, excluded_ids, games:[{id(ファミ通のタイトルID), name, native(空), cover, release(YYYY-MM-DD), region:'JP', genres[], tags[], developer(メーカー), series(空), avg:null, pop:0, desc:'', price, url, detail_at}]}`
- game-db.json（Drive/書き出し）: `{_readme, schema_version, updated_at, ratings:{<id>:{title, cover, release, score, memo, played, fav, want, genres, tags, developer, series, rated_at, updated_at, deleted?}}, custom_games:{<c…>:{…}}}`
- 削除は `deleted:true`。同期は `updated_at` の新しい方を採用してマージ。
- localStorage キー: `gamedb.v1` / `gamedb.settings.v1` / `gamedb.gamesimport.v1`（アニメ手帖の `animedb.*` とは別）。Driveのファイル名は `game-db.json`。
- OAuthクライアントIDはアニメ手帖と同じものを index.html に埋め込み済み（github.io ユーザーが同じため使い回せる）。

## 仕様メモ
- 取得: 月別ページ `/schedule/ps5/YYYYMM` を24か月前〜12か月先、1秒間隔（個別ページは1回あたり最大1000件。初回は2回に分けて取得されることがある）。ジャンル・メーカーは新規ゲームの個別ページ `/game/title/ID/page/1` のみ取得して games.json に保存。ジャンルが空のままのゲームだけ7日ごとに取り直す。同じIDが複数日にあれば早い日付を採用。PS5本体・周辺機器は除外（タイトルが `NON_GAME` に一致、またはジャンルが「本体・周辺商品」だけのとき。ファミ通には「本体・周辺商品 / アクションRPG」のようにゲームへ混在登録された例があり、これは除外しない）。取得失敗の月は前回の内容を残し、全月失敗なら exit 1 で games.json を触らない。
- ジャンルが空のゲームは「相性%」が出ず、好み分析にも入らない（ファミ通側で未登録の作品。数本のみ）。
- 画像はファミ通の商品画像サーバー（`image.kagali.kgl-systems.io`、`?w=400&h=400&func=bound`）を `referrerpolicy="no-referrer"` で表示。
- 数字で終わるタイトルの価格にタイトル末尾の数字がくっつく不具合を修正済み（`stripTags` はタグを空白に置換）。

## 現状（2026-11-08 時点）
- 公開サイト・GitHub Actions（毎日 + 手動実行）・Drive 同期は動作確認済み。ファミ通の画像もサイト上で表示される。
- 取得範囲は24か月前〜12か月先。games.json は約2,300本、ジャンルは約2,290本に入っている（好み分析のため過去分を広げた）。
- 検証できていない点: スマホ実機での見た目、評価が数百件になったときの動作、games.json（約1MB）の読み込み速度。

## PSN連携（2026-11-08 追加・Actionsでの実動作は未確認）
- `scripts/fetch-psn.mjs` + `scripts/psn-lib.mjs`（照合・暗号化の純粋関数、テスト済み）。ワークフローで famitsu 取得の後に実行（`continue-on-error`、`PSN_STATE_KEY` Secret があるときだけ）。
- 出力: `psn-played.json`（`{generated_at, ids:[ファミ通ID]}` のみ）/ `psn-cache.json`（PSN concept→ファミ通ID。見つからなければ id:null で30日再検索しない）/ `psn-state.enc`（暗号化済みリフレッシュトークン）。
- games.json に無いゲームはファミ通検索で追加（`added_by:'psn'`。fetch-famitsu のマージで保持される）。**ファミ通の検索URL（既定 `/search/?type=game&q={q}`）と結果HTMLは未検証**。サンドボックスからファミ通に繋がらず確認できていない。初回Actionsログで「検索結果0件」が出たら、`FAMITSU_SEARCH` か `parseSearch` を直す。
- index.html の `applyPsn()` が読み込み時に未プレイ・未削除・`psn_off`なしの記録だけ `played:true, psn:true` にする。手動で外すと `psn_off:true`。
- 未検証: `psn-api` の `getUserPlayedGames` の実レスポンス（nextOffset 等）、PSN名とファミ通名の照合率。

## 次の候補
- Switch 2 / PS4 など他機種の追加（`/schedule/switch2/` などは未確認）。
- シリーズ名の推定（タイトルの共通プレフィックスから）で好み分析を強化。
- 「気になる」だけの一覧（購入予定リスト）、発売日が近いものの通知。
- 発売日の変更検知（前回の games.json との差分表示）。
