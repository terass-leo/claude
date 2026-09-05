/**
 * ビルド — src/ から配布物を生成する
 *
 *   node tools/build.js
 *
 * 生成物:
 *   report.html          回答を貼るとレポートが出るHTML（単一ファイル）
 *   form-generator.gs    Googleフォームを1回で作るスクリプト
 *   sample/sample-responses.tsv  動作確認用の合成データ（実在の人物ではない）
 *   docs/theme-dictionary.md, docs/items.md
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const write = (p, s) => { fs.mkdirSync(path.dirname(path.join(ROOT, p)), { recursive: true }); fs.writeFileSync(path.join(ROOT, p), s); };

const data = read('src/data.js');
const scoring = read('src/scoring.js');
const csv = read('src/csv.js');

// データを評価してサンプル・ドキュメント生成に使う
const sb = { console };
vm.createContext(sb);
vm.runInContext(data + '\n' + scoring, sb);
const { THEMES, ITEMS, ordered } = vm.runInContext('({ THEMES, ITEMS, ordered: getOrderedItems() })', sb);

// ---- サンプルデータ（決定的な擬似乱数で合成。回答者は架空） ----
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260905);
const SAMPLE_PEOPLE = [
  ['サンプル 一郎', '仲介事業部', ['T04', 'T06', 'T11']],
  ['サンプル 花子', 'HR Div', ['T07', 'T08', 'T09']],
  ['サンプル 次郎', 'PD', ['T10', 'T12', 'T03']],
  ['サンプル 美咲', '仲介事業部', ['T01', 'T05', 'T04']],
  ['サンプル 健太', '金融事業部', ['T02', 'T03', 'T01']],
  ['サンプル 玲奈', 'HR Div', ['T09', 'T06', 'T12']],
  ['サンプル 大輔', '建築事業部', ['T12', 'T11', 'T04']],
  ['サンプル 結衣', 'キャリア事業部', ['T05', 'T07', 'T06']],
  ['サンプル 翔太', 'PD', ['T10', 'T02', 'T03']],
  ['サンプル 彩', '仲介事業部', ['T01', 'T04', 'T08']],
  ['サンプル 陸', '金融事業部', ['T03', 'T08', 'T02']],
  ['サンプル 直人', '仲介事業部', ['T05', 'T05', 'T05']], // 全部5の読み飛ばし回答（フラグ検証用）
];
function sampleAnswer(item, favored, person) {
  if (person[0] === 'サンプル 直人') return 5;
  const strong = favored.indexOf(item.themeId) >= 0;
  const weak = !strong && rnd() < 0.15;
  let target = strong ? 4.4 : weak ? 2.2 : 3.1;
  target += (rnd() - 0.5) * 1.6;
  let v = Math.round(target);
  v = Math.max(1, Math.min(5, v));
  return item.reverse ? 6 - v : v;
}
const header = ['タイムスタンプ', 'メールアドレス', '氏名', '部署・チーム'].concat(ordered.map((i) => i.text));
const rows = SAMPLE_PEOPLE.map((p, i) => {
  const d = new Date(2026, 8, 1 + Math.floor(i / 3), 9 + (i % 3) * 2, 12 + i);
  const ts = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:00`;
  return [ts, `sample${i + 1}@example.com`, p[0], p[1]].concat(ordered.map((it) => sampleAnswer(it, p[2], p)));
});
const sampleTsv = [header].concat(rows).map((r) => r.join('\t')).join('\n');
write('sample/sample-responses.tsv', sampleTsv);

// ---- report.html ----
let html = read('src/report.template.html');
html = html.replace('/*__DATA__*/', data)
  .replace('/*__SCORING__*/', scoring)
  .replace('/*__CSV__*/', csv)
  .replace('/*__SAMPLE__*/', `const SAMPLE_TSV = ${JSON.stringify(sampleTsv)};`);
write('report.html', html);

// ---- form-generator.gs ----
write('form-generator.gs', read('src/form-generator.template.gs').replace('/*__DATA__*/', data));

// ---- docs ----
const NOTE = '> このファイルは `src/data.js` から自動生成しています。定義を直すときは src 側を編集し、`node tools/build.js` を実行してください。\n\n';
let d = '# 強みテーマ辞書（12テーマ / 4領域）\n\n' + NOTE;
d += 'Big Five のファセット構成（IPIP系のパブリックドメイン尺度で用いられる下位因子）を土台に、業務アサインで使える語彙へ再合成した独自テーマです。名称・定義・設問はすべてオリジナルで、特定の商用アセスメントの複製ではありません。\n\n';
for (const dom of [...new Set(THEMES.map((t) => t.domain))]) {
  d += `## 領域: ${dom}\n\n`;
  for (const t of THEMES.filter((x) => x.domain === dom)) {
    d += `### ${t.name}（${t.id}）\n\n**定義**　${t.definition}\n\n| 観点 | 内容 |\n|---|---|\n`;
    d += `| 現れやすい行動 | ${t.behaviors.join('<br>')} |\n| 向いている仕事の型 | ${t.fit.join('<br>')} |\n| 出すぎたときの副作用 | ${t.overuse.join('<br>')} |\n| 1on1で確かめたい問い | ${t.probe} |\n\n`;
  }
}
write('docs/theme-dictionary.md', d);

let s = '# 設問一覧（全60問）\n\n' + NOTE;
s += '回答形式は5段階（1 = 全くあてはまらない 〜 5 = 非常にあてはまる）。**逆**の列が ○ の項目は逆転項目で、採点時に `6 - 素点` に変換します。\n\n## テーマ別\n\n| ID | テーマ | 逆 | 設問文 |\n|---|---|---|---|\n';
for (const t of THEMES) for (const i of ITEMS.filter((x) => x.themeId === t.id)) s += `| ${i.id} | ${t.name} | ${i.reverse ? '○' : ''} | ${i.text} |\n`;
s += '\n## 出題順（テーマが連続しないよう配置）\n\n| 出題順 | ID | テーマ | 設問文 |\n|---|---|---|---|\n';
ordered.forEach((i, n) => { s += `| ${n + 1} | ${i.id} | ${THEMES.find((x) => x.id === i.themeId).name} | ${i.text} |\n`; });
write('docs/items.md', s);

console.log('生成: report.html, form-generator.gs, sample/sample-responses.tsv, docs/*.md');
