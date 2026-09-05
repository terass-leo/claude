/**
 * 区切りテキストのパーサ（CSV / TSV 自動判定、RFC4180 の引用符・改行に対応）
 * Google スプレッドシートからのコピー（タブ区切り）と、CSVダウンロードの両方を受ける。
 */
function detectDelimiter_(text) {
  const firstLine = text.split(/\r?\n/).find((l) => l.trim()) || '';
  const tabs = (firstLine.match(/\t/g) || []).length;
  const commas = (firstLine.match(/,/g) || []).length;
  return tabs >= commas ? '\t' : ',';
}

function parseDelimited(text) {
  const src = String(text || '').replace(/^﻿/, '');
  const delim = detectDelimiter_(src);
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 1; }
        else inQuotes = false;
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') { inQuotes = true; continue; }
    if (c === delim) { row.push(field); field = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }

  return rows.filter((r) => r.some((cell) => String(cell).trim() !== ''));
}
