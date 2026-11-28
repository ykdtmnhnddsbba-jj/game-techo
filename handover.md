# ゲーム手帖 引継ぎ資料

## 最新ソースの場所（まずここを読む）
- **正本は GitHub リポジトリ**。ローカルフォルダはその複製で、`games.json` は GitHub Actions が毎日更新するため、ローカルのものは古いことがある（最新が必要なら git pull か GitHub から取得）。
- 続きの作業でリポジトリに push するには、セッションにリポジトリ `ykdtmnhnddsbba-jj/game-techo` を追加する。
- `.github/workflows` は編集内容をローカルへ書けない。ワークフローを直すときはリポジトリ側へ直接 push する。
- リポジトリ: https://github.com/ykdtmnhnddsbba-jj/game-techo （main / root。公開サイトは GitHub Pages）
- ローカル: `G:\マイドライブ\App\apps\media-db\ゲームデータベース`（index.html / games.json / scripts/ / README.md / handover.md）
- 元になったサイト: アニメ手帖（`G:\マイドライブ\App\apps\media-db\アニメデータベース` / リポジトリ anime-techo）。レイアウト・評価UI・Drive同期はこれを踏襲。
- 参考: `G:\マイドライブ\App\apps\media-db\PS5-Game-Radar`（PowerShell製のローカルアプリ。同じファミ通ページから取得している）
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

## 画面が勝手に動かない仕様（アニメ手帖と同じ考え方）
- 評価・メモ・ボタン操作は、そのカードだけをその場で更新する（一覧を作り直さない）。
- 一覧の並びと絞り込みは `visibleItems()` の `viewKey`（年・月・検索語・並び・状態・未評価のみ・ゲーム総数）が変わったとき、または `loadGames()`（起動・再読込）のときだけ作り直す。それ以外（評価、タブの行き来、Drive同期）は `ui.rank` / `ui.shown` で並びと表示を固定する。
- Drive同期の完了で画面を作り直さない。他端末の変更があったときだけ、表示中のカードをその場で更新する（`refreshCard`。入力中のメモ欄は触らない）。
- `renderGrid()` は再描画時にメモ欄の入力中の文字とカーソルを保つ。

## 現状（2026-11-08 時点）
- 公開サイト・GitHub Actions（毎日 + 手動実行）・Drive 同期は動作確認済み。ファミ通の画像もサイト上で表示される。
- 取得範囲は前後2か月（2026-11-08に変更。初回だけ24か月前〜12か月先で取得し、フラグの無い過去分は2026-11-08に games.json から削除済み。フラグ付き・PSNプレイ済み・直近2か月以降は残している）。games.json は約2,300本、ジャンルは約2,290本に入っている（好み分析のため過去分を広げた）。
- 検証できていない点: スマホ実機での見た目、評価が数百件になったときの動作、games.json（約1MB）の読み込み速度。

## PSN連携（2026-11-08 追加・Actionsで動作確認済み: 153本中99本照合、81本追加）
- `scripts/fetch-psn.mjs` + `scripts/psn-lib.mjs`（照合・暗号化の純粋関数、テスト済み）。ワークフローで famitsu 取得の後に実行（`continue-on-error`、`PSN_STATE_KEY` Secret があるときだけ）。
- 出力: `psn-played.json`（`{generated_at, ids:[ファミ通ID]}` のみ）/ `psn-cache.json`（PSN concept→ファミ通ID。見つからなければ id:null で30日再検索しない）/ `psn-state.enc`（暗号化済みリフレッシュトークン）。
- games.json に無いゲームは、ファミ通の**過去の月別スケジュール**（PS5: 2020-11〜games.json範囲の手前 / PS4: 2014-02〜先12か月、約214ページ・4分）を走査してタイトル照合し、個別ページでジャンル・メーカーを取って追加（`added_by:'psn'`。fetch-famitsu のマージで保持）。ファミ通の検索ページ(`/search/?q=…&type=game-title`)はブラウザ描画でHTMLに結果が無いため使えない。見つからないものは `psn-cache.json` に id:null で記録し30日は再走査しない。
- index.html の `applyPsn()` が読み込み時に未プレイ・未削除・`psn_off`なしの記録だけ `played:true, psn:true` にする。手動で外すと `psn_off:true`。
- 残り: PSN名が英語表記でファミ通名(日本語)と合わないものは未照合(約50本)。`【海外】`付きの名前が混ざる。スマホ実機・サイト上の表示は未確認。

## 次の候補
- Switch 2 / PS4 など他機種の追加（`/schedule/switch2/` などは未確認）。
- シリーズ名の推定（タイトルの共通プレフィックスから）で好み分析を強化。
- 「気になる」だけの一覧（購入予定リスト）、発売日が近いものの通知。
- 発売日の変更検知（前回の games.json との差分表示）。

## 2026-11-08 追記
- PSN: 153本中144本を照合（残り: プロサッカークラブをつくろう！/龍が如く8外伝/NFS Payback/FIFA 22/ASTRO's PLAYROOM/十三機兵防衛圏/MH:World/DQヒーローズ闇竜）。別名は `psn-aliases.enc`（鍵=PSN_STATE_KEY）。未照合はファミ通の月別スケジュールに載っていない or 名前が大きく違うもの。
- マイ評価に「点数別（10→1）」表示を追加（既定）。アニメ手帖と同じ作り。
- ワークフローの push は pull --rebase で3回まで再試行（別セッションの push と競合して失敗した前例あり）。
- トロフィー進捗(2026-11-08追加): `getUserTitles`（Accept-Language: ja-JP でトロフィータイトル名を日本語に）→ PSNプレイ履歴の名前で紐付け → `psn-trophies.json`。195タイトル中121本を紐付け（残りはPS3/Vita・DB外のゲーム中心）。UIは `trophyHtml()` と マイ評価の絞り込み `trodone`/`tropend`。


## 攻略手帖（kouryaku/）— 2026-11-08 追加
- ゲーム手帖とは別の静的サイト。同じリポジトリの `kouryaku/` にあり、公開URLは `https://ykdtmnhnddsbba-jj.github.io/game-techo/kouryaku/`。ゲーム手帖へのリンクは入れない方針（本人の指示）。
- 構成: `kouryaku/index.html`（共通ビューア）、`kouryaku/games/index.json`（ゲーム一覧）、`kouryaku/games/<slug>.json`（トロフィー一覧＋チャート。id=ファミ通ID）。ゲームを足すときは JSON を1つ作って index.json に追記する。
- 取得状況: `scripts/fetch-psn.mjs` の `fetchKouryaku` が、index.json のゲームについて PSN の定義と取得状況を取り、`psn-lib.mjs` の `mapTrophies` で攻略データのID（t01…）に対応づけて `kouryaku/psn-earned.json` に保存する（IDだけ。トロフィー名・日時は書かない）。名前一致が基本で、取れないときだけトロフィー種別の並びが完全一致する場合に限り並び順で対応づける（`how` に記録）。ワークフローの commit 対象にも追加済み。毎日の Actions で更新される。
- サイト側: 手動チェックは localStorage キー `kouryaku.v1`（バックアップはJSON書き出し/読み込み）。PSN取得済みは自動でチェック済みになり、チャートのステップも関連トロフィーが全部取得済みなら自動完了する。
- 検証済み: 2026-11-08 の実行で タクティクスオウガ リボーン 28/34 を対応づけ（個数が psn-trophies.json の 16/9/3/0 と一致）。

## 2026-11-21 追記: カリギュラ2 を攻略手帖に追加
- `kouryaku/games/caligula-2.json`（id=53003、トロフィー49個＝金3/銀7/銅38＋プラチナ）。index.json に追記済み。公開URL: https://ykdtmnhnddsbba-jj.github.io/game-techo/kouryaku/#caligula-2
- 進行状況: ほぼ未プレイ（本人申告）。PSNの psn-trophies.json に 53003 の記録なし。psn-earned.json にも未登録（名前一致の自動取得は未確認）。取得は手動チェック。
- チャートは「1周目=6章バッドエンドでクリアデータ→2周目(NG+)で序章〜8章→2周目8章で塔」の1.5周方針。6章の選択肢・ネームドクエストの発生章・WIREの達人の必要数・キィの楽曲数(1曲/3曲)は未確認で、チャートに警告を付けている。
- 金/銀の振り分けはEpic版の配点とブログからの推定。取り逃し扱い(世話焼き上手/心地よい世界/幸せな世界)も一部推定。


## 共通Googleログイン（2026-11）
- Googleログインと Drive 同期の処理は `../portal/lib/techo-google.js`（portalリポジトリ）に1本化した。各手帖は `TechoGoogle.create({site,...})` を呼ぶだけ。
- トークンは同じオリジン（ykdtmnhnddsbba-jj.github.io）の localStorage `techo_gauth_tok` に共有で保存。どれか1つの手帖でログインすれば、他の手帖も認証画面なしで同期できる。
- 同期は `GA.syncFile(ファイル名, id, マージ関数, 本文関数)`。Drive の読み込みに失敗したら上書きせずに中止する（データ消失防止）。ファイルが404なら id を忘れて次回検索し直す。
- portal の lib が読めない時もページ自体は表示される（同期だけ無効）。
## 2026-11-21 追記: PS5-Game-Radar の良い所を統合
- **好きなシリーズ**: Radar の判定ルール（軌跡・ペルソナ・FF・ドラクエ・龍が如く など）を `DEF_SERIES` として移植。ファミ通データにシリーズ名が無いので `seriesOf()` がタイトルから当てる。当たると ①カードに紫のシリーズバッジ ②`feats` に `s:<ラベル>` が入り好み分析で学習 ③相性%に上乗せ（強さ46で約+25%）。設定タブ「⭐ 好きなシリーズ」で編集（localStorage の `settings.series_rules`。端末ごと）。
- **✕ 興味なし**（`nope:true`）: 発売月の一覧では非表示（検索時と「状態: 興味なしのみ」では出る）。好み分析には「平均−2点・重さ半分」で入る。気になると排他。
- **🛒 購入予定**（`buy:true`）: 「気になる」の中の印。押すと気になるも付く。☆気になるタブに「購入予定のみ」の絞り込み。
- Radar の評価11件は `radar-import.json`（G: のこのフォルダ。個人データなのでリポジトリには入れない）を 設定 →「JSONを読み込む（統合）」で取り込める。
- Radar 本体（G:\マイドライブ\App\apps\media-db\PS5-Game-Radar）は引退予定（archive へ移すのは本人確認後）。

## 2026-11-21 追記: 幻想水滸伝 STAR LEAP（スマホ）を攻略手帖に追加
- 「幻想水滸伝SP」はスマホの『幻想水滸伝 STAR LEAP（スターリープ）』（本人の指摘）。最初に PS5 の I&II HDリマスターと間違えて追加したが、差し替えた（HDリマスター版の JSON は削除。必要なら PR #3 の履歴から戻せる）。
- `kouryaku/games/suikoden-star-leap.json`（id=suikoden-star-leap、platform=スマホ）。トロフィーが無いので `trophies` は空、チャート6章（このゲームについて／リセマラ／序盤／毎日／期間限定／育成）。
- ビューア: `trophies` が空のゲームは、トロフィータブを隠して、上の進み具合を「チャート 済/全」で出す。fetch-psn.mjs は PSN と紐付かないゲームをスキップするので影響なし。
- ④期間限定は 2026-11-21 時点の日付。イベントやガチャが変わったら更新する。

## 2026-11-17 追記: Ghost of Yōtei を攻略手帖に追加
- `kouryaku/games/ghost-of-yotei.json`（id=57849、トロフィー56個＝本編54＋2周目2個）。index.json に追記済み。公開URL: https://ykdtmnhnddsbba-jj.github.io/game-techo/kouryaku/#ghost-of-yotei
- PSNの取得状況: 名前一致56/56、取得済み30個（2026-11-16）。ゴールド0（閑話・一流賞金稼ぎ未）。ストーリーは「打倒 鬼・狐」まで、「打倒 龍」は未取得。チャートは取得済みを省いた「残りだけ」版。
- PSN側の表記に注意: 「酒吞童子」（吞）。ほかの攻略サイトは「酒呑童子」表記で、一文字違うと名前一致が外れる。
- ビューア(kouryaku/index.html)を「ルート無しのゲーム」に対応: routes が空なら、ルート絞り込みの代わりに分類(chapter)で絞り込み、ルートタブは「注意・出典」表記。likely が空なら推定一括チェックは非表示。
- scripts/fetch-psn.mjs: 名前が合わなかったとき、未一致の名前（ゲーム側の公開情報のみ）をActionsログに出す。DLC(Legends等)のトロフィーは未一致として並ぶが問題なし。
- 未確認: 2周目の2個（珍品奇品・いまひとたび）がプラチナ条件に入るか。本編をほぼ終えてもプラチナが出ない場合に確認。
- 攻略ポータル(artifacts)にGhost of Yōteiのリンクを追加済み。

## 2026-11-19 追記: Ghost of Yōtei のチャートを具体手順に更新
- ストーリークリア後(PSN 36/56、2026-11-18)に、残りだけのチャートを地域別に作り直した: ①戦闘系3つ→②準備(三味線・火矢)→③羊蹄平→④石狩ヶ原→⑤十勝ヶ峰→⑥名寄→⑦天塩ヶ丘(からくり箱12個)→⑧渡島ヶ浦→⑨収集物の仕上げ→⑩賞金首・鎧の最終確認→⑪足溜まり22→⑫プラチナ確認・2周目。
- 賞金首31件は日本語名(こつこつトロフィーコンプ、ゲームウィズ)で1人1ステップ。羊蹄平6/十勝ヶ峰6/石狩ヶ原6/天塩ヶ丘5/渡島ヶ浦8。討伐状況はゲーム内で見えないので手動チェック。
- 狐の巣・狼の巣穴・からくり箱の場所名は日本語の資料が見つからず英語表記(PowerPyx)。見つかれば日本語に直す。
- 取得済みのトロフィーに関わるステップは生成時に省く。再生成するには、リポジトリの psn-earned.json を読んで同じ処理をする(生成スクリプトはセッション内の一時ファイルで、リポジトリには入れていない)。
- 手帖ポータルは2か所(GitHub repo portal / claude.aiの手帖ポータル)に「攻略手帖」カードを追加済み。

## 2026-11-21 追記: 「☆ 気になる」タブ（購入予定リスト）
- タブ順: 発売月 / ☆ 気になる / マイ評価 / 好み分析 / 設定。`renderWant()`。
- 対象は `want:true` かつ未プレイ・未評価の記録。発売日の古い順（未定は最後）に並べ、月ごとに見出し。発売日は games.json の最新値を優先（延期に追従）し、無ければ記録時の `release`。
- バッジ: 「あと◯日」「今日発売」「発売中」＋価格。絞り込み: すべて / これから発売のみ / 発売済み（未購入）のみ。
- ボタン操作はほかのタブと同じくカードをその場で更新（☆を外しても一覧から即消えない。タブを開き直すと消える）。
- ※この変更はローカルの index.html にのみ反映（リポジトリ版に追加したものをローカルへ上書き）。リポジトリへは未 push。

## 2026-11-21 追記: Drive同期の安全対策（モノレポ横断の点検）
- Driveのファイルの読み込みに失敗したら保存を中止するようにした（以前は手元のデータで上書きして、他の端末の変更が消えるおそれがあった）。謎解き手帖と同じ対策。404 のときはファイルIDを忘れて次回に検索し直す。
- GitHub main にマージ済み（PR #1）。このフォルダの index.html もマージ後の版に更新済み。
- Google認証の state とトークンを localStorage にも保存（スマホで sessionStorage が消えてログインが通らない件。アニメ手帖と同じ gSt 方式）。state のキーは手帖ごとに分けた。
- 「☆ 気になる」タブもリポジトリに反映済み（上の 2026-11-21 追記の「未 push」は解消）。

## 2026-11-28 追記: ゼノバース2 と BLEACH Rebirth of Souls を攻略手帖に追加（PS Plus 2026年12月フリープレイ）
- `kouryaku/games/dragon-ball-xenoverse-2.json`（id=33683 ※PS4版のファミ通IDを仮置き、トロフィー61個＝本編50＋無料アプデ5＋有料DLC6）と `kouryaku/games/bleach-rebirth-of-souls.json`（id=bleach-rebirth-of-souls ※仮ID、36個＝白1/金5/銀10/銅20）。index.json に追記。
- 公開URL: https://ykdtmnhnddsbba-jj.github.io/game-techo/kouryaku/#dragon-ball-xenoverse-2 / #bleach-rebirth-of-souls
- 進行状況: どちらも未プレイ（フリープレイ提供 2026-12-01〜2027-01-04）。PSN反映は遊び始めてから確認する。
- **次の作業（PSN反映）**: 遊び始めた翌日以降に Actions のログ「攻略手帖: <slug> …」を見る。「PSNのトロフィー一覧と紐付いていません」なら、psn-cache.json / games.json(added_by:'psn') でファミ通IDを調べて、index.json と各JSONの id を差し替える（ゼノバース2はPS5版のIDになる可能性が高い）。名前が合わない分はログの「未一致」を見て直す。
- ゼノバース2の未確認: PS5版のプラチナに無料アプデ(Ver.1.12/1.14)の5個が入るか（公式の注意書きでは入るように読める）、神龍の願い事の強化手順、SSGSS変身の覚え方、覚醒技全習得に必要な種族数、本編の金銀銅の一部（銀11個の内訳が資料で食い違う）。
- BLEACHの未確認: プレイレベルの最大値、シークレットストーリーの解放条件、MISSIONS ★★★ の解放条件。金銀銅は一覧の並びからの推定。
- ファミ通・Exophase・PSNProfilesはこのセッションから取得できなかった（プロキシで拒否）。トロフィー名は Gamerch / ひまトロ / ゲームブログ 等から。
- 2026-11-28: Ghost of Yōtei の DLC 3本（Legends / Echoes of Sekigahara / Most Wanted）の攻略ページを削除（本人の指示）。index.json からも外した。本編 ghost-of-yotei.json は残す。戻すなら git の履歴から。
- 2026-11-28: GitHub は確認なしで push してよい（本人の指示）。
- 2026-11-28: ゼノバース2/BLEACHのチャートを具体的な手順に書き直し（本人の要望：キャラ名・場所・クエスト番号まで）。出典は PSNProfiles のトロフィーガイド（Claude in Chrome で閲覧。このセッションの WebFetch からは開けなかった）。BLEACH: 最大Lv100、★★★は卍解一護の月牙連発、20HITは恋次、魄晶石は1個7,500〜12,000pt・MISSIONS★で8,000pt、シークレットモーメントはシークレットストーリーを進めると解放。ゼノバース2: 5種族の覚醒技の取り方、SSGSSはサイヤ人LV90＋ウイス友好度MAX、昇格試験の推奨LVと相手、先生25人、EMは17個でOK など。英語版の名前のまま載せた箇所（バトル名・NPC名の一部）は caveats に記載。
