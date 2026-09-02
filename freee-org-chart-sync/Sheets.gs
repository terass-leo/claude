/** スプレッドシート書き込みヘルパー */

function getSpreadsheet_() {
  const id = props_().getProperty(PROP_KEYS.SPREADSHEET_ID);
  if (id) return SpreadsheetApp.openById(id);
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (!active) throw new Error('スプレッドシートが特定できません。コンテナバインド型で使うか、スクリプトプロパティ SPREADSHEET_ID を設定してください。');
  return active;
}

function getOrCreateSheet_(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

/** シートを丸ごと置き換える（ヘッダー+データ）。書式は毎回最小限を再適用。 */
function writeTable_(ss, name, header, rows, options) {
  const opt = options || {};
  const sheet = getOrCreateSheet_(ss, name);
  sheet.clearContents();
  const data = [header].concat(rows);
  ensureSize_(sheet, data.length, header.length);
  // ID・コード列は文字列として固定（先頭ゼロ落ち・数値化を防ぐ）
  (opt.textColumns || []).forEach(name => {
    const idx = header.indexOf(name);
    if (idx >= 0 && data.length > 1) sheet.getRange(2, idx + 1, data.length - 1, 1).setNumberFormat('@');
  });
  sheet.getRange(1, 1, data.length, header.length).setValues(data.map(r => padRow_(r, header.length)));
  sheet.getRange(1, 1, 1, header.length).setFontWeight('bold').setBackground('#f1f3f4');
  sheet.setFrozenRows(1);
  if (opt.frozenColumns) sheet.setFrozenColumns(opt.frozenColumns);
  if (sheet.getFilter()) sheet.getFilter().remove();
  if (rows.length) sheet.getRange(1, 1, rows.length + 1, header.length).createFilter();
  // 余分な行があれば削除して見通しをよくする
  const maxRows = sheet.getMaxRows();
  if (maxRows > data.length + 5) sheet.deleteRows(data.length + 2, maxRows - data.length - 1);
  return sheet;
}

/** ヘッダーを維持して末尾に追記（変更履歴用） */
function appendRows_(ss, name, header, rows) {
  const sheet = getOrCreateSheet_(ss, name);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold').setBackground('#f1f3f4');
    sheet.setFrozenRows(1);
  }
  if (!rows.length) return sheet;
  const start = sheet.getLastRow() + 1;
  ensureSize_(sheet, start + rows.length - 1, header.length);
  sheet.getRange(start, 1, rows.length, header.length).setValues(rows.map(r => padRow_(r, header.length)));
  return sheet;
}

/** 組織図_フラットの現状を読み戻す（差分検出用）。シートが無ければ空。 */
function readFlatSheet_(ss) {
  const sheet = ss.getSheetByName(CONFIG.SHEETS.FLAT);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const values = sheet.getDataRange().getValues();
  const header = values[0].map(String);
  return rowsToFlat(header, values.slice(1).map(row => row.map(cellToText_)));
}

function cellToText_(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, 'Asia/Tokyo', 'yyyy-MM-dd');
  }
  return v;
}

function writeMeta_(ss, entries) {
  const sheet = getOrCreateSheet_(ss, CONFIG.SHEETS.META);
  sheet.clearContents();
  const rows = [['項目', '値']].concat(entries);
  sheet.getRange(1, 1, rows.length, 2).setValues(rows);
  sheet.getRange(1, 1, 1, 2).setFontWeight('bold');
  sheet.setColumnWidth(1, 180);
  sheet.setColumnWidth(2, 600);
}

function writeRawDebug_(ss, payload) {
  const sheet = getOrCreateSheet_(ss, CONFIG.SHEETS.RAW);
  sheet.clearContents();
  const rows = Object.keys(payload).map(k => [k, JSON.stringify(payload[k]).slice(0, 49000)]);
  sheet.getRange(1, 1, rows.length, 2).setValues(rows);
  sheet.hideSheet();
}

function ensureSize_(sheet, rows, cols) {
  if (sheet.getMaxRows() < rows) sheet.insertRowsAfter(sheet.getMaxRows(), rows - sheet.getMaxRows());
  if (sheet.getMaxColumns() < cols) sheet.insertColumnsAfter(sheet.getMaxColumns(), cols - sheet.getMaxColumns());
}

function padRow_(row, len) {
  const r = row.slice(0, len);
  while (r.length < len) r.push('');
  return r;
}
