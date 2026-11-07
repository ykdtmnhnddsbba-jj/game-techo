// ファミ通.com の HTML を解析する純粋関数（ネットワーク・ファイル操作なし）。
// 構造（2026-11 時点）:
//   スケジュール: <h2>2026年11月5日（木）発売</h2> の下に <a class="…scheduleCard" href="/game/title/ID/page/1">
//                 カード内に <img alt="タイトル" srcSet="…url=https://image.kagali…/item/…"> と「3980円[税抜]」
//   個別ページ  : <dt>ジャンル</dt><dd>…</dd> / <dt>メーカー</dt><dd>…</dd>
export const BASE = 'https://www.famitsu.com';

const ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#x27;': "'", '&nbsp;': ' ' };
export function decode(s) {
  return String(s ?? '')
    .replace(/&(amp|lt|gt|quot|nbsp|#39|#x27);/g, (m) => ENT[m])
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}
// タグは空白に置き換える（隣り合う要素の文字が連結しないように。例: タイトル末尾の「27」と価格「8600円」が「278600円」になるのを防ぐ）
const stripTags = (s) =>
  decode(String(s).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ').trim();
const pad2 = (n) => String(n).padStart(2, '0');

// 「（PS Store ダウンロード版）」「価格 未定」「3980円[税抜]」等の付随テキストを除く
export function cleanTitle(t) {
  return String(t || '')
    .replace(/\s*[（(]PS Store ダウンロード版[）)].*$/, '')
    .replace(/\s*価格\s*未定.*$/, '')
    .replace(/\s*\d{3,7}円(?:\[税抜\])?.*$/, '')
    .replace(/\s*※.*$/, '')
    .replace(/\s+/g, ' ').trim();
}

// 周辺機器・本体など（ゲームソフトではないもの）
export const NON_GAME = /^PlayStation ?5\b|^PS5\b.*(本体|デジタル・エディション)|DualSense|PULSE|ヘッドセット|コントローラー|ワイヤレス|充電スタンド|メディアリモコン|PlayStation Portal|PlayStation VR/i;

// 月別スケジュールのHTML -> [{id,date,title,url,cover,price}]（同じ id が複数日ある場合は後で整理）
export function parseSchedule(html) {
  const out = [];
  const sections = [...String(html).matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>([\s\S]*?)(?=<h2[^>]*>|$)/gi)];
  for (const s of sections) {
    const m = stripTags(s[1]).match(/(20\d{2})年(\d{1,2})月(\d{1,2})日/);
    if (!m) continue;
    const date = `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;
    for (const a of s[2].matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
      if (!/scheduleCard/.test(a[1])) continue;
      const href = (a[1].match(/href="([^"]+)"/) || [])[1] || '';
      const idm = href.match(/\/game\/title\/(\d+)/);
      if (!idm) continue;
      const body = a[2];
      const alt = (body.match(/<img[^>]*\balt="([^"]*)"/) || [])[1];
      const nameEl = (body.match(/gameTitleName[^>]*>([\s\S]*?)<\/(?:span|p|div|h\d)>/) || [])[1];
      const title = cleanTitle(decode(alt || '') || stripTags(nameEl || ''));
      if (!title) continue;
      const img = (body.match(/url=(https:\/\/image\.kagali\.kgl-systems\.io\/item\/[^?&"'\s]+)/) || [])[1] || '';
      const price = (stripTags(body).match(/\d[\d,]*円(?:\[税抜\])?|価格\s*未定/) || [''])[0].replace(/\s+/g, '');
      out.push({ id: idm[1], date, title, url: `${BASE}/game/title/${idm[1]}/page/1`, cover: img ? `${img}?w=400&h=400&func=bound` : '', price });
    }
  }
  return out;
}

// ゲーム個別ページのHTML -> {genres:[], maker}
export function parseDetail(html) {
  const dd = (label) => {
    const m = String(html).match(new RegExp(`<dt[^>]*>\\s*${label}\\s*</dt>\\s*<dd[^>]*>([\\s\\S]*?)</dd>`));
    return m ? stripTags(m[1]) : '';
  };
  const genre = dd('ジャンル');
  const maker = dd('メーカー');
  const none = (v) => !v || /^[-ー－―]+$/.test(v);
  return {
    genres: none(genre) ? [] : genre.split(/\s*[\/／]\s*/).map((x) => x.trim()).filter(Boolean),
    maker: none(maker) ? '' : maker,
  };
}
