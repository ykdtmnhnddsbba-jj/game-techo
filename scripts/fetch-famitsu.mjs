// ファミ通.com の「PS5 ゲーム発売日スケジュール」から games.json を作る。
//   node scripts/fetch-famitsu.mjs
// 環境変数（任意）:
//   MONTHS_BACK(既定2) MONTHS_AHEAD(既定2) MAX_DETAIL(既定1000: 1回に取る個別ページ数の上限)
//   REQUEST_GAP_MS(既定1000) OUT(既定 games.json) FAMITSU_BASE / FAMITSU_UA（テスト・調整用）
// 個別ページ（ジャンル・メーカー）は新規ゲームの分だけ取得し、結果は games.json に保存して次回以降は再取得しません。
import fs from 'node:fs/promises';
import { parseSchedule, parseDetail, NON_GAME } from './famitsu-parse.mjs';

const BASE = process.env.FAMITSU_BASE || 'https://www.famitsu.com';
const OUT = process.env.OUT || 'games.json';
const MONTHS_BACK = +(process.env.MONTHS_BACK || 2);
const MONTHS_AHEAD = +(process.env.MONTHS_AHEAD || 2);
const MAX_DETAIL = +(process.env.MAX_DETAIL || 1000);
const GAP = +(process.env.REQUEST_GAP_MS || 1000);
const UA = process.env.FAMITSU_UA || 'Mozilla/5.0 (compatible; game-techo/1.0; personal-use release schedule fetcher)';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let last = 0;
async function get(path) {
  const wait = GAP - (Date.now() - last);
  if (wait > 0) await sleep(wait);
  last = Date.now();
  const r = await fetch(BASE + path, { headers: { 'User-Agent': UA, 'Accept-Language': 'ja,en;q=0.5', Accept: 'text/html' } });
  if (!r.ok) { const e = new Error(`HTTP ${r.status} ${path}`); e.status = r.status; throw e; }
  return r.text();
}

const ymOf = (y, m0) => { const d = new Date(Date.UTC(y, m0, 1)); return d.getUTCFullYear() * 100 + d.getUTCMonth() + 1; };
const ymStr = (n) => `${String(n).slice(0, 4)}-${String(n).slice(4)}`;

async function main() {
  const now = new Date();
  const months = [];
  for (let i = -MONTHS_BACK; i <= MONTHS_AHEAD; i++) months.push(ymOf(now.getUTCFullYear(), now.getUTCMonth() + i));
  const fromIso = ymStr(months[0]) + '-01';
  const toIso = ymStr(ymOf(now.getUTCFullYear(), now.getUTCMonth() + MONTHS_AHEAD + 1)) + '-01';
  console.log(`ファミ通 PS5 スケジュールを取得: ${fromIso} 〜 ${toIso}`);

  let prev = { games: [], excluded_ids: [] };
  try { prev = JSON.parse(await fs.readFile(OUT, 'utf8')); } catch { /* 初回 */ }
  const prevById = new Map((prev.games || []).map((g) => [g.id, g]));
  const excluded = new Set(prev.excluded_ids || []);

  // 1) 月別スケジュール
  const scraped = new Map();       // id -> 最も早い日付の行
  const okMonths = new Set(), failed = [];
  for (const ym of months) {
    try {
      const rows = parseSchedule(await get(`/schedule/ps5/${ym}`));
      okMonths.add(ymStr(ym));
      for (const r of rows) {
        const cur = scraped.get(r.id);
        if (!cur) scraped.set(r.id, r);
        else {                      // 同じタイトルが複数日（パッケージ版/DL版など）→ 早い日付を採用、欠けた情報は補う
          const [a, b] = r.date < cur.date ? [r, cur] : [cur, r];
          scraped.set(r.id, { ...a, cover: a.cover || b.cover, price: a.price || b.price });
        }
      }
      console.log(`  ${ymStr(ym)}: ${rows.length}件`);
    } catch (e) {
      failed.push(`${ymStr(ym)} (${e.message})`);
      console.warn(`  ${ymStr(ym)}: 取得失敗 ${e.message}`);
    }
  }
  if (!okMonths.size) {
    console.error('どの月も取得できませんでした。ファミ通側が接続を拒否している可能性があります（GitHub Actions のIPが弾かれている場合は、自分のPCで `node scripts/fetch-famitsu.mjs` を実行してください）。');
    process.exit(1);
  }

  // 2) 新規ゲームの個別ページ（ジャンル・メーカー）
  let detailCount = 0;
  const games = [];
  for (const r of [...scraped.values()].sort((a, b) => a.date.localeCompare(b.date))) {
    if (excluded.has(r.id) || NON_GAME.test(r.title)) { excluded.add(r.id); continue; }
    const old = prevById.get(r.id);
    let genres = old?.genres || [], developer = old?.developer || '', detail_at = old?.detail_at || null;
    // 個別ページは未取得のとき取得。ジャンルがファミ通側で未登録だったものは、7日ごとに取り直す
    const stale = detail_at && !genres.length && (Date.now() - Date.parse(detail_at)) / 86400e3 >= 7;
    if ((!detail_at || stale) && detailCount < MAX_DETAIL) {
      detailCount++;
      try {
        const d = parseDetail(await get(`/game/title/${r.id}/page/1`));
        // PS5本体・周辺機器: ジャンルが「本体・周辺商品」だけのときのみ除外
        // （ファミ通側で「本体・周辺商品 / アクションRPG」のようにゲームに混在登録されている場合があるため）
        if (d.genres.length && d.genres.every((g) => /本体|周辺/.test(g))) { excluded.add(r.id); continue; }
        genres = d.genres; developer = d.maker; detail_at = new Date().toISOString().slice(0, 10);
      } catch (e) { console.warn(`  個別ページ取得失敗 ${r.id} ${r.title}: ${e.message}`); }
    }
    games.push({
      id: r.id, name: r.title, native: '', cover: r.cover || old?.cover || '',
      release: r.date, region: 'JP', genres, tags: [], developer, series: '', avg: null, pop: 0, desc: '',
      price: r.price || old?.price || '', url: r.url, ...(detail_at ? { detail_at } : {}),
    });
  }
  console.log(`個別ページ取得: ${detailCount}件`);

  // 3) 前回分とマージ（期間外・取得失敗の月は前回の内容を残す）
  const newIds = new Set(games.map((g) => g.id));
  const kept = (prev.games || []).filter((g) => !newIds.has(g.id) && !excluded.has(g.id)
    && (g.added_by || g.release < fromIso || g.release >= toIso || !okMonths.has(g.release.slice(0, 7))));
  const merged = [...kept, ...games].sort((a, b) => a.release.localeCompare(b.release) || a.name.localeCompare(b.name, 'ja'));
  const excludedIds = [...excluded].sort();

  const unchanged = JSON.stringify(prev.games) === JSON.stringify(merged) && JSON.stringify(prev.excluded_ids || []) === JSON.stringify(excludedIds);
  if (unchanged) { console.log('変更なし（games.json は更新しません）'); return; }

  const json = {
    source: 'ファミ通.com', platform: 'PS5', generated_at: new Date().toISOString(),
    window: { from: fromIso, to: toIso }, ...(failed.length ? { failed_months: failed } : {}),
    excluded_ids: excludedIds, games: merged,
  };
  await fs.writeFile(OUT, JSON.stringify(json, null, 1) + '\n');
  console.log(`games.json を更新: ${merged.length}本`);
  if (failed.length) console.warn(`取得できなかった月: ${failed.join(', ')}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
