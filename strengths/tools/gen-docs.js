/**
 * docs/ の Markdown を gas/ のデータから再生成する。
 * テーマ定義や設問を .gs 側で編集したあとに実行すること。
 *
 *   node tools/gen-docs.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const GAS_DIR = path.join(__dirname, '..', 'gas');
const DOCS_DIR = path.join(__dirname, '..', 'docs');

const sandbox = { console: { log: () => {} } };
vm.createContext(sandbox);
for (const f of ['00_Config.gs', '01_Themes.gs', '02_Items.gs', '03_Scoring.gs']) {
  vm.runInContext(fs.readFileSync(path.join(GAS_DIR, f), 'utf8'), sandbox, { filename: f });
}
const THEMES = vm.runInContext('THEMES', sandbox);
const ITEMS = vm.runInContext('ITEMS', sandbox);
const ordered = vm.runInContext('getOrderedItems()', sandbox);

const NOTE = (src) =>
  `> このファイルは \`gas/${src}\` から自動生成しています。` +
  '定義を直すときは .gs 側を編集し、`node tools/gen-docs.js` を実行してください。\n\n';

// ---- テーマ辞書 ----
let d = '# 強みテーマ辞書（12テーマ / 4領域）\n\n' + NOTE('01_Themes.gs');
d += 'Big Five のファセット構成（IPIP系のパブリックドメイン尺度で用いられる下位因子）を土台に、' +
  '業務アサインで使える語彙へ再合成した独自テーマです。名称・定義・設問はすべてオリジナルで、' +
  '特定の商用アセスメントの複製ではありません。\n\n';
for (const dom of [...new Set(THEMES.map((t) => t.domain))]) {
  d += `## 領域: ${dom}\n\n`;
  for (const t of THEMES.filter((x) => x.domain === dom)) {
    d += `### ${t.name}（${t.id}）\n\n`;
    d += `**定義**　${t.definition}\n\n`;
    d += '| 観点 | 内容 |\n|---|---|\n';
    d += `| 現れやすい行動 | ${t.behaviors.join('<br>')} |\n`;
    d += `| 向いている仕事の型 | ${t.fit.join('<br>')} |\n`;
    d += `| 出すぎたときの副作用 | ${t.overuse.join('<br>')} |\n\n`;
  }
}
fs.writeFileSync(path.join(DOCS_DIR, 'theme-dictionary.md'), d);

// ---- 設問一覧 ----
let s = '# 設問一覧（全60問）\n\n' + NOTE('02_Items.gs');
s += '回答形式は5段階（1 = 全くあてはまらない 〜 5 = 非常にあてはまる）。' +
  '**逆**の列が ○ の項目は逆転項目で、採点時に `6 - 素点` に変換します。\n\n';
s += '## テーマ別\n\n| ID | テーマ | 逆 | 設問文 |\n|---|---|---|---|\n';
for (const t of THEMES) {
  for (const i of ITEMS.filter((x) => x.themeId === t.id)) {
    s += `| ${i.id} | ${t.name} | ${i.reverse ? '○' : ''} | ${i.text} |\n`;
  }
}
s += '\n## 出題順（テーマが連続しないよう配置）\n\n| 出題順 | ID | テーマ | 設問文 |\n|---|---|---|---|\n';
ordered.forEach((i, n) => {
  const t = THEMES.find((x) => x.id === i.themeId);
  s += `| ${n + 1} | ${i.id} | ${t.name} | ${i.text} |\n`;
});
fs.writeFileSync(path.join(DOCS_DIR, 'items.md'), s);

console.log('docs/theme-dictionary.md と docs/items.md を更新しました。');
