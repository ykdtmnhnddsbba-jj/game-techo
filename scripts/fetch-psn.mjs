// PSN のプレイ履歴から「遊んだゲーム」を求め、psn-played.json（ファミ通ID一覧のみ）を作る。
// games.json に無いゲームはファミ通の過去スケジュールから探して games.json に追加する。
//   node scripts/fetch-psn.mjs        （要 `npm i psn-api`）
// 環境変数:
//   PSN_STATE_KEY  必須。リフレッシュトークンを暗号化する鍵（GitHub Secrets）
//   PSN_NPSSO      初回／トークン失効時だけ必要（GitHub Secrets）
// 公開ファイルに入れるのは「ファミ通のタイトルID」だけ（プレイ時間・日付は保存しません）。
import fs from 'node:fs/promises';
import { parseSchedule, parseDetail, NON_GAME } from './famitsu-parse.mjs';
import { findGame, pickCandidate, suggest, isSameTitle, encryptState, decryptState } from './psn-lib.mjs';

const STATE = process.env.PSN_STATE_FILE || 'psn-state.enc';
const CACHE = 'psn-cache.json';
const OUT = 'psn-played.json';
const TROPHIES = 'psn-trophies.json';
const ALIASES = 'psn-aliases.enc', UNMATCHED = 'psn-unmatched.enc', SUGGEST = 'psn-suggest.enc';
const GAMES = process.env.GAMES || 'games.json';
const BASE = 'https://www.famitsu.com';
const RETRY_DAYS = 30;
const UA = 'Mozilla/5.0 (compatible; game-techo/1.0; personal-use)';
const today = () => new Date().toISOString().slice(0, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJson = async (p, d) => { try { return JSON.parse(await fs.readFile(p, 'utf8')); } catch { return d; } };

async function authenticate(psn) {
  const secret = process.env.PSN_STATE_KEY;
  if (!secret) throw new Error('PSN_STATE_KEY が設定されていません');
  let saved = null;
  try { saved = decryptState(await fs.readFile(STATE, 'utf8'), secret); } catch { /* 初回 or 鍵違い */ }
  let tokens = null;
  if (saved?.refreshToken) {
    try { tokens = await psn.exchangeRefreshTokenForAuthTokens(saved.refreshToken); console.log('リフレッシュトークンでログイン'); }
    catch (e) { console.warn('リフレッシュトークンが使えません:', e.message); }
  }
  if (!tokens) {
    const npsso = process.env.PSN_NPSSO;
    if (!npsso) throw new Error('ログインできません。PSN_NPSSO を取り直して GitHub Secrets に登録してください（README 参照）');
    tokens = await psn.exchangeAccessCodeForAuthTokens(await psn.exchangeNpssoForAccessCode(npsso));
    console.log('NPSSO でログイン');
  }
  // 新しいリフレッシュトークンをすぐ保存（途中で失敗しても次回使えるように）
  await fs.writeFile(STATE, encryptState({ refreshToken: tokens.refreshToken, saved_at: new Date().toISOString() }, secret) + '\n');
  return tokens;
}

async function fetchPlayed(psn, tokens) {
  const titles = [];
  let offset = 0;
  for (let i = 0; i < 50; i++) {
    const r = await psn.getUserPlayedGames({ accessToken: tokens.accessToken }, 'me', { limit: 200, offset });
    titles.push(...(r.titles || []));
    if (!r.titles?.length || r.nextOffset == null || r.nextOffset <= offset) break;
    offset = r.nextOffset;
  }
  // PS4/PS5のゲームのみ。同じゲームの複数バージョンは concept でまとめる
  const byKey = new Map();
  for (const t of titles) {
    if (t.category && !/^(ps4_game|ps5_native_game)$/.test(t.category)) continue;
    const key = t.concept?.id ? `c${t.concept.id}` : t.titleId;
    const names = [t.name, t.localizedName].filter(Boolean);
    const cur = byKey.get(key);
    if (cur) cur.names = [...new Set([...cur.names, ...names])]; else byKey.set(key, { key, names });
  }
  return [...byKey.values()];
}

let last = 0;
async function famitsu(path) {
  const wait = 1000 - (Date.now() - last); if (wait > 0) await sleep(wait); last = Date.now();
  const r = await fetch(BASE + path, { headers: { 'User-Agent': UA, 'Accept-Language': 'ja,en;q=0.5', Accept: 'text/html' } });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${path}`);
  return r.text();
}

const ymNum = (y, m0) => { const d = new Date(Date.UTC(y, m0, 1)); return d.getUTCFullYear() * 100 + d.getUTCMonth() + 1; };
// 月別スケジュールを走査して [{id,title,date,cover,price,url}] を返す。読めないページが続く場合は null（何も記録しない）
async function scanSchedules(windowFrom) {
  const now = new Date();
  const wf = windowFrom ? new Date(windowFrom + 'T00:00:00Z') : new Date(Date.UTC(now.getUTCFullYear() - 2, now.getUTCMonth(), 1));
  const jobs = [];
  const range = (y0, m0, y1, m1) => { const r = []; for (let i = y0 * 12 + m0; i < y1 * 12 + m1; i++) r.push(ymNum(Math.floor(i / 12), i % 12)); return r; };
  for (const ym of range(2020, 10, wf.getUTCFullYear(), wf.getUTCMonth())) jobs.push(['ps5', ym]);                       // PS5: 発売(2020-11)〜games.jsonの範囲の手前
  for (const ym of range(2014, 1, now.getUTCFullYear(), now.getUTCMonth() + 13)) jobs.push(['ps4', ym]);                 // PS4: 2014-02〜先12か月
  const out = new Map();
  let ok = 0, bad = 0, empty = 0;
  for (const [plat, ym] of jobs) {
    try {
      const rs = parseSchedule(await famitsu(`/schedule/${plat}/${ym}`));
      ok++; empty = rs.length ? 0 : empty + 1;
      for (const r of rs) { const k = r.id; const cur = out.get(k); if (!cur || r.date < cur.date) out.set(k, { ...r, plat }); }
      if (plat === 'ps4' && empty >= 12 && ym > 201800) { console.warn('  PS4スケジュールが空のため中断'); break; }
    } catch (e) { bad++; if (bad <= 3) console.warn(`  ${plat}/${ym}: ${e.message}`); if (bad >= 8 && !ok) { console.warn('  スケジュールを読めないため中断（URLの確認が必要な可能性）'); return null; } }
  }
  const rows = [...out.values()].filter((r) => !NON_GAME.test(r.title));
  console.log(`  スケジュール走査: ${jobs.length}ページ（成功${ok} / 失敗${bad}）→ ${rows.length}本`);
  return ok ? rows : null;
}

// トロフィー進捗: getUserTitles（トロフィーのあるタイトル一覧）→ ファミ通IDに紐付け。公開ファイルには「ID → 進捗%・獲得/全体の数」だけを保存
async function fetchTrophies(psn, tokens, played, resolved, games) {
  const titles = [];
  for (let offset = 0, i = 0; i < 30; i++) {
    const r = await psn.getUserTitles({ accessToken: tokens.accessToken }, 'me', { limit: 800, offset });
    titles.push(...(r.trophyTitles || []));
    if (r.nextOffset == null || !r.trophyTitles?.length || r.nextOffset <= offset) break;
    offset = r.nextOffset;
  }
  const out = {};
  let nomatch = 0;
  for (const t of titles) {
    const name = t.trophyTitleName;
    const p = played.find((x) => resolved.has(x.key) && x.names.some((n) => isSameTitle(name, n)));
    const id = p ? resolved.get(p.key) : (findGame([name], games) ? String(findGame([name], games).id) : null);
    if (!id) { nomatch++; continue; }
    const e = t.earnedTrophies || {}, d = t.definedTrophies || {};
    const rec = { p: t.progress ?? 0, e: [e.bronze || 0, e.silver || 0, e.gold || 0, e.platinum || 0], d: [d.bronze || 0, d.silver || 0, d.gold || 0, d.platinum || 0] };
    const cur = out[id];
    if (!cur || rec.p > cur.p) out[id] = rec;   // PS4/PS5の両方がある場合は進んでいる方
  }
  console.log(`トロフィー: ${titles.length}タイトル中 ${Object.keys(out).length}本を紐付け（未紐付け ${nomatch}）`);
  return out;
}

async function main() {
  const psn = await import('psn-api');
  const tokens = await authenticate(psn);
  const played = await fetchPlayed(psn, tokens);
  console.log(`PSN のプレイ履歴: ${played.length}本`);

  const gamesFile = await readJson(GAMES, null);
  if (!gamesFile?.games) throw new Error(`${GAMES} を読めません`);
  const games = gamesFile.games;
  const cache = await readJson(CACHE, {});
  let aliases = {};   // 手動で用意した日本語名など: { <PSNのキー>: ['日本語名', ...] }（公開しないよう暗号化して保存）
  try { aliases = decryptState(await fs.readFile(ALIASES, 'utf8'), process.env.PSN_STATE_KEY); } catch { /* 無ければ空 */ }
  const matched = new Set();
  const resolved = new Map();   // PSNのキー → ファミ通ID（トロフィーの紐付けに使う）
  const ids = new Set(), added = [], todo = [];
  let unfound = 0;

  for (const p of played) {
    const extra = aliases[p.key] || [];
    const orig = [...p.names];
    p.orig = orig; p.pinned = extra.find((a) => /^#\d+$/.test(a))?.slice(1); p.names = [...orig, ...extra.filter((a) => !/^#\d+$/.test(a))];
    const sig = extra.join('|');
    const hit = findGame(p.names, games);
    if (hit) { ids.add(String(hit.id)); matched.add(p.key); resolved.set(p.key, String(hit.id)); continue; }
    const c = cache[p.key];
    if (c?.id) { ids.add(String(c.id)); matched.add(p.key); resolved.set(p.key, String(c.id)); continue; }                           // 以前の検索で見つかっている
    if (c && (c.alias || '') === sig && (Date.now() - Date.parse(c.checked)) / 86400e3 < RETRY_DAYS) { unfound++; continue; } // 見つからなかった → 30日は再検索しない（別名を足したら再検索）
    todo.push(p);
  }

  // games.json に無いゲーム: ファミ通の過去の月別スケジュール（PS5の古い月 + PS4全期間）から探す。
  // （ファミ通の検索ページはブラウザ側の描画で、HTMLからは結果を読めないため）
  let rows = null;
  if (todo.length) {
    console.log(`games.json に無いゲーム ${todo.length}本 → ファミ通の過去スケジュールから探します`);
    rows = await scanSchedules(gamesFile.window?.from);
    if (rows) {
      for (const p of todo) {
        const pick = (p.pinned && rows.find((r) => r.id === p.pinned)) || pickCandidate(p.names, rows);
        if (!pick) { cache[p.key] = { id: null, checked: today(), ...(aliases[p.key] ? { alias: aliases[p.key].join('|') } : {}) }; unfound++; continue; }
        if (!games.some((g) => String(g.id) === pick.id)) {
          let genres = [], developer = '', detail_at = null;
          try { const d = parseDetail(await famitsu(`/game/title/${pick.id}/page/1`)); genres = d.genres; developer = d.maker; detail_at = today(); }
          catch (e) { console.warn(`  個別ページ取得失敗 ${pick.title}: ${e.message}`); }
          const g = { id: pick.id, name: pick.title, native: '', cover: pick.cover, release: pick.date, region: 'JP', genres, tags: [], developer, series: '', avg: null, pop: 0, desc: '', price: pick.price || '', url: pick.url, ...(detail_at ? { detail_at } : {}), added_by: 'psn' };
          games.push(g); added.push(g);
        }
        cache[p.key] = { id: pick.id, checked: today() };
        ids.add(pick.id); matched.add(p.key); resolved.set(p.key, pick.id);
      }
    }
  }

  if (rows) {   // 照合できなかったものに、ファミ通側の近い名前の候補を添える（暗号化。別名/ID指定づくり用）
    const pool = [...rows, ...games.map((g) => ({ id: g.id, title: g.name, date: g.release }))];
    const sug = played.filter((p) => !matched.has(p.key)).map((p) => ({ key: p.key, names: p.orig, candidates: suggest(p.names, pool) }));
    await fs.writeFile(SUGGEST, encryptState(sug, process.env.PSN_STATE_KEY) + '\n');
  }
  // 照合できなかったPSN名は暗号化して保存（公開しない。別名づくり用）
  const unmatched = played.filter((p) => !matched.has(p.key)).map((p) => ({ key: p.key, names: p.orig }));
  await fs.writeFile(UNMATCHED, encryptState(unmatched, process.env.PSN_STATE_KEY) + '\n');
  console.log(`照合: ${ids.size}本 / games.json に追加 ${added.length}本 / 見つからず ${unfound}本`);
  if (added.length) {
    games.sort((a, b) => a.release.localeCompare(b.release) || a.name.localeCompare(b.name, 'ja'));
    await fs.writeFile(GAMES, JSON.stringify(gamesFile, null, 1) + '\n');
  }
  await fs.writeFile(CACHE, JSON.stringify(cache, null, 1) + '\n');
  const sorted = [...ids].sort((a, b) => (/^\d+$/.test(a) && /^\d+$/.test(b) ? +a - +b : /^\d+$/.test(a) ? -1 : /^\d+$/.test(b) ? 1 : a.localeCompare(b)));
  try {
    const trophies = await fetchTrophies(psn, tokens, played, resolved, games);
    const prevT = await readJson(TROPHIES, { trophies: {} });
    if (JSON.stringify(prevT.trophies) !== JSON.stringify(trophies)) await fs.writeFile(TROPHIES, JSON.stringify({ generated_at: new Date().toISOString(), trophies }) + '\n');
  } catch (e) { console.warn('トロフィー取得に失敗（スキップ）:', e.message); }
  const prev = await readJson(OUT, { ids: [] });
  if (JSON.stringify(prev.ids) !== JSON.stringify(sorted)) await fs.writeFile(OUT, JSON.stringify({ generated_at: new Date().toISOString(), ids: sorted }) + '\n');
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
