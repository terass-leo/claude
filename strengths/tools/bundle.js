/**
 * gas/ の全ファイルを1本の .gs に結合する。
 * Apps Script エディタに1回貼るだけで済むようにするための配布物。
 *
 *   node tools/bundle.js
 */
const fs = require('fs');
const path = require('path');

const GAS_DIR = path.join(__dirname, '..', 'gas');
const OUT = path.join(__dirname, '..', 'dist', 'strengths-all-in-one.gs');

const FILES = [
  '00_Config.gs', '01_Themes.gs', '02_Items.gs', '03_Scoring.gs',
  '04_Setup.gs', '05_Report.gs', '06_Main.gs', '07_Test.gs',
];

const header = [
  '/**',
  ' * 強み診断（Strengths Survey）— 全部入り1ファイル版',
  ' *',
  ' * gas/ の8ファイルを結合したものです。Apps Script エディタの「コード.gs」に',
  ' * この内容をまるごと貼り付ければ、それだけで動きます。',
  ' *',
  ' * 生成元: strengths/gas/ （個別に編集したい場合はそちらを参照）',
  ' * 再生成: node tools/bundle.js',
  ' */',
  '',
  '',
].join('\n');

const rule = '// ' + '='.repeat(74);
const body = FILES.map((f) => {
  const src = fs.readFileSync(path.join(GAS_DIR, f), 'utf8').trimEnd();
  return [rule, `// ${f}`, rule, '', src, '', ''].join('\n');
}).join('\n');

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, header + body);
console.log(`${OUT} を生成しました（${(header + body).split('\n').length} 行）。`);
