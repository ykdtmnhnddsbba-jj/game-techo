// PSN連携の純粋関数（ネットワークなし）: タイトル名の正規化・照合・トークン保存の暗号化。
import crypto from 'node:crypto';

// 表記ゆれを吸収した比較用の文字列にする（®™・記号・空白・全半角・大文字小文字を無視）
export function norm(s) {
  return String(s || '')
    .normalize('NFKC')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').normalize('NFC')   // ō → o などアクセント記号を除く
    .replace(/ー/g, '')                                      // 長音の揺れ（スーパ－/スーパー）を吸収
    .replace(/[(\[]\s*(ps[1-5]|ps\s?vita|switch\s?2?|nintendo switch\s?2?|pc|xbox[^)\]]*|steam)\s*[)\]]/g, '')   // 末尾の機種表記「(PS5)」など
    .replace(/\s*[-–]\s*(ps[45]|switch2?)\s*$/, '')
    .replace(/[®™©℠]/g, '')
    .replace(/[\s\-–—―~〜～:：・!！?？'"“”‘’`´()（）\[\]【】「」『』<>＜＞,.，。、/／\\&＆+＋*★☆♪_]/g, '');
}

// 照合: 完全一致 > 一方が他方を含み、長さが近い（80%以上）。曖昧なものは採用しない。
export function isSameTitle(a, b) {
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 5 && long.includes(short) && short.length / long.length >= 0.8;
}

// 名前候補（PSNの name / localizedName）のどれかが games の名前と同じものを探す
export function findGame(names, games) {
  for (const g of games) for (const n of names) if (isSameTitle(n, g.name) || (g.native && isSameTitle(n, g.native))) return g;
  return null;
}

// 検索結果(candidates: [{id,title}])から、PSNの名前と同じものを選ぶ
export function pickCandidate(names, candidates) {
  const hits = candidates.filter((c) => names.some((n) => isSameTitle(n, c.title)));
  const rank = (c) => (c.plat === 'ps5' || /PS5/i.test(c.title) ? 0 : c.plat === 'ps4' || /PS4/i.test(c.title) ? 1 : 2);   // 複数機種版があれば PS5 > PS4 > その他
  return hits.sort((a, b) => rank(a) - rank(b))[0] || null;
}

// リフレッシュトークンの保存（AES-256-GCM。鍵は環境変数 PSN_STATE_KEY から導出）
const keyOf = (secret) => crypto.createHash('sha256').update(String(secret)).digest();
export function encryptState(obj, secret) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', keyOf(secret), iv);
  const enc = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
}
export function decryptState(b64, secret) {
  const buf = Buffer.from(String(b64).trim(), 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', keyOf(secret), buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return JSON.parse(Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8'));
}

// あいまい類似度（2文字ずつの Dice 係数, 0〜1）。候補の提案用（自動採用はしない）
const grams = (s) => { const t = norm(s), m = new Map(); for (let i = 0; i < t.length - 1; i++) { const g = t.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); } return [m, Math.max(0, t.length - 1)]; };
export function similarity(a, b) {
  const [x, nx] = grams(a), [y, ny] = grams(b);
  if (!nx || !ny) return 0;
  let hit = 0; for (const [g, c] of x) hit += Math.min(c, y.get(g) || 0);
  return (2 * hit) / (nx + ny);
}
export function suggest(names, rows, n = 4, min = 0.3) {
  return rows.map((r) => ({ r, sc: Math.max(...names.map((nm) => similarity(nm, r.title))) }))
    .filter((x) => x.sc >= min).sort((a, b) => b.sc - a.sc).slice(0, n)
    .map((x) => ({ id: String(x.r.id), title: x.r.title, date: x.r.date || x.r.release, plat: x.r.plat || '', score: +x.sc.toFixed(2) }));
}
