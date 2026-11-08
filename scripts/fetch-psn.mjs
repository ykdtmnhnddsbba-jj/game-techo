// PSN のプレイ履歴から「遊んだゲーム」を求め、psn-played.json（ファミ通ID一覧のみ）を作る。
// games.json に無いゲームはファミ通で検索して games.json に追加する。
//   node scripts/fetch-psn.mjs        （要 `npm i psn-api`）
// 環境変数:
//   PSN_STATE_KEY  必須。リフレッシュトークンを暗号化する鍵（GitHub Secrets）
//   PSN_NPSSO      初回／トークン失効時だけ必要（GitHub Secrets）
//   FAMITSU_SEARCH 検索URL（{q} を検索語に置換。既定は下記）  MAX_SEARCH（1回に検索する上限。既定40）
// 公開ファイルに入れるのは「ファミ通のタイトルID」だけ（プレイ時間・日付は保存しません）。
import fs from 'node:fs/promises';
import { parseSearch, parseDetail } from './famitsu-parse.mjs';
import { findGame, pickCandidate, encryptState, decryptState } from './psn-lib.mjs';

const STATE = process.env.PSN_STATE_FILE || 'psn-state.enc';
const CACHE = 'psn-cache.json';
const OUT = 'psn-played.json';
const GAMES = process.env.GAMES || 'games.json';
const BASE = 'https://www.famitsu.com';
const SEARCH = process.env.FAMITSU_SEARCH || '/search/?q={q}&type=game-title';
const MAX_SEARCH = +(process.env.MAX_SEARCH || 40);
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

async function main() {
  const psn = await import('psn-api');
  const tokens = await authenticate(psn);
  const played = await fetchPlayed(psn, tokens);
  console.log(`PSN のプレイ履歴: ${played.length}本`);

  const gamesFile = await readJson(GAMES, null);
  if (!gamesFile?.games) throw new Error(`${GAMES} を読めません`);
  const games = gamesFile.games;
  const cache = await readJson(CACHE, {});
  const ids = new Set(), added = [];
  let searches = 0, searchFail = 0, unfound = 0, emptyStreak = 0, working = false;
  const pendingNull = [];   // 検索が正常に動いたと確認できたときだけ「見つからず」を記録する

  for (const p of played) {
    const hit = findGame(p.names, games);
    if (hit) { ids.add(String(hit.id)); continue; }
    const c = cache[p.key];
    if (c?.id) {                                       // 以前の検索で見つかっている
      ids.add(String(c.id));
      continue;
    }
    if (c && (Date.now() - Date.parse(c.checked)) / 86400e3 < RETRY_DAYS) { unfound++; continue; }   // 見つからなかった → 30日は再検索しない
    if (searches >= MAX_SEARCH || searchFail >= 5 || emptyStreak >= 5) continue;                                        // 今回は上限。次回に回す
    searches++;
    try {
      const q = encodeURIComponent(p.names[p.names.length > 1 ? 1 : 0].replace(/[®™©]/g, '').trim());
      const html = await famitsu(SEARCH.replace('{q}', q));
      const cands = parseSearch(html);
      if (!cands.length && emptyStreak === 0) {   // 診断: 検索ページの中身を少しだけログに出す
        const hrefs = [...new Set([...html.matchAll(/href="([^"]*(?:game|title)[^"]*)"/g)].map((m) => m[1]))].slice(0, 8);
        console.warn(`  [診断] 長さ=${html.length} title=${(html.match(/<title>([^<]*)/) || [])[1]} /game/title出現=${(html.match(/game\/title/g) || []).length} 総リンク=${(html.match(/<a\b/g) || []).length} 例=${JSON.stringify(hrefs)}`);
        const i = html.indexOf('game/title'); if (i >= 0) console.warn('  [診断] 周辺: ' + html.slice(Math.max(0, i - 200), i + 300).replace(/\s+/g, ' '));
        else console.warn('  [診断] 本文: ' + html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 300));
      }
      if (cands.length) { working = true; emptyStreak = 0; } else emptyStreak++;
      if (!cands.length && emptyStreak <= 3) console.warn(`  検索結果0件: ${p.names[0]}`);
      if (emptyStreak >= 5) console.warn('  検索結果が5回連続で0件のため中断します（検索URLかHTML構造の確認が必要な可能性）');
      const pick = pickCandidate(p.names, cands);
      if (!pick) { pendingNull.push(p.key); unfound++; continue; }
      const d = parseDetail(await famitsu(`/game/title/${pick.id}/page/1`));
      if (!d.release) { pendingNull.push(p.key); unfound++; console.warn(`  発売日が読めず追加しません: ${pick.title}`); continue; }
      const dup = games.find((g) => String(g.id) === pick.id);
      if (!dup) {
        const g = { id: pick.id, name: pick.title, native: '', cover: d.cover, release: d.release, region: 'JP', genres: d.genres, tags: [], developer: d.maker, series: '', avg: null, pop: 0, desc: '', price: '', url: `${BASE}/game/title/${pick.id}/page/1`, detail_at: today(), added_by: 'psn' };
        games.push(g); added.push(g);
      }
      cache[p.key] = { id: pick.id, checked: today() };
      ids.add(pick.id);
      searchFail = 0;
    } catch (e) { searchFail++; console.warn(`  検索失敗 ${p.names[0]}: ${e.message}`); }
  }

  if (working) for (const k of pendingNull) cache[k] = { id: null, checked: today() };
  console.log(`照合: ${ids.size}本 / games.json に追加 ${added.length}本 / 見つからず ${unfound}本 / 今回の検索 ${searches}回`);
  if (added.length) {
    games.sort((a, b) => a.release.localeCompare(b.release) || a.name.localeCompare(b.name, 'ja'));
    await fs.writeFile(GAMES, JSON.stringify(gamesFile, null, 1) + '\n');
  }
  await fs.writeFile(CACHE, JSON.stringify(cache, null, 1) + '\n');
  const sorted = [...ids].sort((a, b) => +a - +b);
  const prev = await readJson(OUT, { ids: [] });
  if (JSON.stringify(prev.ids) !== JSON.stringify(sorted)) await fs.writeFile(OUT, JSON.stringify({ generated_at: new Date().toISOString(), ids: sorted }) + '\n');
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
