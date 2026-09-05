/**
 * ローカル検証ハーネス
 *
 * Apps Script の .gs は Node からそのまま実行できないため、GAS 固有のグローバル
 * （SpreadsheetApp / PropertiesService など）をスタブ化した VM 上に読み込み、
 * 採点ロジックとセルフテストを CI 的に走らせる。
 *
 *   node tools/verify.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const GAS_DIR = path.join(__dirname, '..', 'gas');
// UI や外部通信に触れないファイルだけを読み込む（05/06 は SpreadsheetApp 依存が濃いため除外）
const FILES = ['00_Config.gs', '01_Themes.gs', '02_Items.gs', '03_Scoring.gs', '07_Test.gs'];

const logs = [];
const sandbox = {
  console: { log: (...a) => logs.push(a.join(' ')) },
  // GAS スタブ: セルフテストが触れるのは console と（UI がある場合の）alert だけ
  SpreadsheetApp: {
    getUi() { throw new Error('no ui in node'); },
  },
  Utilities: { sleep() {} },
  PropertiesService: {
    getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {} }),
  },
};
vm.createContext(sandbox);

for (const f of FILES) {
  const src = fs.readFileSync(path.join(GAS_DIR, f), 'utf8');
  try {
    vm.runInContext(src, sandbox, { filename: f });
  } catch (err) {
    console.error(`構文エラー (${f}): ${err.message}`);
    process.exit(1);
  }
}

const summary = vm.runInContext('runSelfTest()', sandbox);
console.log(logs.join('\n'));

const failed = summary.split('\n').filter((l) => l.startsWith('NG'));
if (failed.length) {
  console.error(`\n失敗 ${failed.length} 件`);
  process.exit(1);
}
console.log('\nすべて合格');
