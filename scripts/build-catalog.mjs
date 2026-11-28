// 検索用の全タイトル一覧 catalog.json を作る（ファミ通の月別スケジュール: PS5 2020-11〜 / PS4 2014-02〜、どちらも先12か月まで）。
// games.json は「発売月の一覧」用に期間を絞っているので、それより前のゲーム（例: 2016年のゼノバース2）は検索に出なかった。
// catalog.json には一覧の表示に要る最小限（ID・名前・発売日・画像・価格・機種）だけを入れる。ジャンル等の個別ページは取らない。
//   node scripts/build-catalog.mjs         （前回から7日未満なら何もしない。FORCE=1 で必ず作り直す）
import fs from 'node:fs/promises';
import { parseSchedule, NON_GAME } from './famitsu-parse.mjs';

const OUT = process.env.CATALOG || 'catalog.json';
const BASE = process.env.FAMITSU_BASE || 'https://www.famitsu.com';
const GAP = +(process.env.REQUEST_GAP_MS || 1000);
const MAX_AGE_DAYS = +(process.env.CATALOG_MAX_AGE_DAYS || 7);
const UA = process.env.FAMITSU_UA || 'Mozilla/5.0 (compatible; game-techo/1.0; personal-use release schedule fetcher)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let last = 0;
async function get(path) {
  const wait = GAP - (Date.now() - last); if (wait > 0) await sleep(wait); last = Date.now();
  const r = await fetch(BASE + path, { headers: { 'User-Agent': UA, 'Accept-Language': 'ja,en;q=0.5', Accept: 'text/html' } });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${path}`);
  return r.text();
}
const ymNum = (i) => Math.floor(i / 12) * 100 + (i % 12) + 1;   // 月の通し番号 → 202611
const range = (y0, m0, y1, m1) => { const r = []; for (let i = y0 * 12 + m0; i <= y1 * 12 + m1; i++) r.push(ymNum(i)); return r; };

async function main() {
  let prev = null;
  try { prev = JSON.parse(await fs.readFile(OUT, 'utf8')); } catch { /* 初回 */ }
  if (prev?.generated_at && !process.env.FORCE && (Date.now() - Date.parse(prev.generated_at)) / 86400e3 < MAX_AGE_DAYS) {
    console.log(`catalog.json は ${prev.generated_at.slice(0, 10)} に作成済み（${MAX_AGE_DAYS}日ごとに更新）`); return;
  }
  const now = new Date(), y = now.getUTCFullYear(), m = now.getUTCMonth();
  const jobs = [...range(2020, 10, y, m + 12).map((ym) => ['ps5', ym]), ...range(2014, 1, y, m + 12).map((ym) => ['ps4', ym])];
  const out = new Map();
  let ok = 0, bad = 0;
  for (const [plat, ym] of jobs) {
    try {
      const rows = parseSchedule(await get(`/schedule/${plat}/${ym}`));
      ok++;
      for (const r of rows) {
        if (NON_GAME.test(r.title)) continue;
        const cur = out.get(r.id);
        if (!cur) { out.set(r.id, { ...r, plat }); continue; }
        const [a, b] = r.date < cur.date ? [{ ...r, plat }, cur] : [cur, { ...r, plat }];   // 同じIDが複数日 → 早い日付、欠けた情報は補う
        out.set(r.id, { ...a, cover: a.cover || b.cover, price: a.price || b.price });
      }
    } catch (e) {
      bad++; if (bad <= 5) console.warn(`  ${plat}/${ym}: ${e.message}`);
      if (bad >= 10 && !ok) { console.error('スケジュールを読めないため中断（catalog.json は更新しません）'); process.exit(1); }
    }
  }
  console.log(`スケジュール: ${jobs.length}ページ（成功${ok} / 失敗${bad}）→ ${out.size}本`);
  // 読めた月が少なすぎるとき（ファミ通側の不調など）は、前回の一覧を壊さない
  if (prev?.games?.length && out.size < prev.games.length * 0.8) { console.error(`前回(${prev.games.length}本)より大きく減ったため更新しません`); process.exit(1); }
  const games = [...out.values()]
    .sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title, 'ja'))
    .map((r) => ({ id: r.id, name: r.title, release: r.date, cover: r.cover || '', price: r.price || '', plat: r.plat }));
  await fs.writeFile(OUT, JSON.stringify({ source: 'ファミ通.com', generated_at: new Date().toISOString(), games }) + '\n');
  console.log(`catalog.json: ${games.length}本`);
}
main().catch((e) => { console.error(e.message || e); process.exit(1); });
