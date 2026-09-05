/**
 * ローカル検証 — 採点ロジック・パーサ・サンプルデータの一気通貫テスト
 *
 *   node tools/verify.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const sb = { console };
vm.createContext(sb);
vm.runInContext(read('src/data.js') + '\n' + read('src/scoring.js') + '\n' + read('src/csv.js'), sb);
const g = vm.runInContext(
  '({ THEMES, ITEMS, ITEM_ORDER, getOrderedItems, normalizeText_, scoreItem_, scoreAnswers, buildHeaderMap_, parseDelimited, scoreTable })', sb);

let pass = 0, fail = 0;
function check(label, fn) {
  try { fn(); pass += 1; console.log(`OK   ${label}`); }
  catch (e) { fail += 1; console.log(`NG   ${label} — ${e.message}`); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };

const answersFavoring = (themeIds, high, base) => {
  const a = {};
  g.ITEMS.forEach((it) => {
    const scored = themeIds.indexOf(it.themeId) >= 0 ? high : base;
    a[it.id] = it.reverse ? 6 - scored : scored;
  });
  return a;
};

check('設問は60問、12テーマ×5問、各テーマ逆転1問', () => {
  assert(g.ITEMS.length === 60, `設問 ${g.ITEMS.length}`);
  assert(g.THEMES.length === 12, `テーマ ${g.THEMES.length}`);
  g.THEMES.forEach((t) => {
    const own = g.ITEMS.filter((i) => i.themeId === t.id);
    assert(own.length === 5, `${t.name}: ${own.length}問`);
    assert(own.filter((i) => i.reverse).length === 1, `${t.name}: 逆転項目数`);
    assert(t.probe && t.fit.length && t.overuse.length && t.behaviors.length, `${t.name}: 辞書項目が欠けている`);
  });
});

check('設問ID・設問文に重複がなく、出題順は同テーマが連続しない', () => {
  const ids = new Set(g.ITEMS.map((i) => i.id));
  assert(ids.size === 60, 'ID重複');
  const texts = new Set(g.ITEMS.map((i) => g.normalizeText_(i.text)));
  assert(texts.size === 60, '設問文重複');
  const ordered = g.getOrderedItems();
  assert(new Set(g.ITEM_ORDER).size === 60, '出題順に重複/欠落');
  for (let i = 1; i < ordered.length; i += 1) assert(ordered[i].themeId !== ordered[i - 1].themeId, `同テーマ連続 ${ordered[i].id}`);
});

check('設問文が互いに部分一致しない（見出し照合の安全性）', () => {
  const keys = g.ITEMS.map((i) => g.normalizeText_(i.text));
  keys.forEach((k, i) => keys.forEach((k2, j) => {
    if (i !== j) assert(k.indexOf(k2) < 0, `${g.ITEMS[j].id} が ${g.ITEMS[i].id} に含まれる`);
  }));
});

check('逆転項目・ラベル付き回答の変換', () => {
  const rev = g.ITEMS.find((i) => i.reverse);
  const pos = g.ITEMS.find((i) => !i.reverse);
  assert(g.scoreItem_(rev, 5) === 1 && g.scoreItem_(rev, 1) === 5, '逆転');
  assert(g.scoreItem_(pos, '4') === 4, '文字列数値');
  assert(g.scoreItem_(pos, '5 非常にあてはまる') === 5, 'ラベル付き');
  assert(g.scoreItem_(pos, 0) === null && g.scoreItem_(pos, '') === null, '範囲外/空欄');
});

check('狙ったテーマが上位に来る', () => {
  const r1 = g.scoreAnswers(answersFavoring(['T12'], 5, 3));
  assert(r1.ranking[0].themeId === 'T12', `1位 ${r1.ranking[0].name}`);
  const r3 = g.scoreAnswers(answersFavoring(['T04', 'T06', 'T11'], 5, 2));
  const top = r3.top.map((x) => x.themeId);
  ['T04', 'T06', 'T11'].forEach((id) => assert(top.indexOf(id) >= 0, `${id} が上位外`));
});

check('読み飛ばし回答（全部5）にフラグ、Zは丸め誤差なく0', () => {
  const a = {}; g.ITEMS.forEach((i) => { a[i.id] = 5; });
  const r = g.scoreAnswers(a);
  assert(r.flags.some((f) => f.indexOf('逆転項目') >= 0), JSON.stringify(r.flags));
  assert(r.flags.some((f) => f.indexOf('順位が確定しない') >= 0), JSON.stringify(r.flags));
  g.THEMES.forEach((t) => assert(r.themeZ[t.id] === 0, `${t.name} Z=${r.themeZ[t.id]}`));
});

check('CSV/TSV パーサ（引用符・改行・区切り自動判定）', () => {
  const t = g.parseDelimited('a\tb\tc\n1\t2\t3\n');
  assert(t.length === 2 && t[1][2] === '3', 'TSV');
  const c = g.parseDelimited('a,b,c\r\n"x, y","he said ""hi""","line1\nline2"\r\n');
  assert(c.length === 2 && c[1][0] === 'x, y' && c[1][1] === 'he said "hi"' && c[1][2] === 'line1\nline2', `CSV ${JSON.stringify(c)}`);
  const bom = g.parseDelimited('﻿a,b\n1,2');
  assert(bom[0][0] === 'a', 'BOM除去');
});

check('見出し照合（完全一致・グリッド形式・句点なし）', () => {
  const it = g.ITEMS[0];
  const { map, missing } = g.buildHeaderMap_(['タイムスタンプ', '氏名', it.text, `設問 [${g.ITEMS[1].text}]`, g.ITEMS[2].text.replace(/。$/, '')]);
  assert(map[2] && map[2].id === it.id, '完全一致');
  assert(map[3] && map[3].id === g.ITEMS[1].id, 'グリッド形式');
  assert(map[4] && map[4].id === g.ITEMS[2].id, '句点なし');
  assert(missing.length === 57, `missing ${missing.length}`);
});

check('サンプルTSVを一気通貫で採点できる', () => {
  const rows = g.parseDelimited(read('sample/sample-responses.tsv'));
  const data = g.scoreTable(rows);
  assert(data.people.length === 12, `人数 ${data.people.length}`);
  assert(data.matchedItems === 60, `設問列 ${data.matchedItems}`);
  assert(data.cohortEnabled === true, '全社比較が有効になっていない');
  const ichiro = data.people.find((p) => p.name === 'サンプル 一郎');
  const top = ichiro.result.top.map((x) => x.themeId);
  ['T04', 'T06', 'T11'].forEach((id) => assert(top.indexOf(id) >= 0, `一郎: ${id} が上位外 (${ichiro.result.top.map((x) => x.name)})`));
  const naoto = data.people.find((p) => p.name === 'サンプル 直人');
  assert(naoto.result.flags.length > 0, '直人にフラグが立たない');
  assert(naoto.cohortZ && Number.isFinite(naoto.cohortZ.T01), '全社Zが計算されていない');
});

check('同じ氏名の重複回答は後の行を採用', () => {
  const rows = g.parseDelimited(read('sample/sample-responses.tsv'));
  const dup = rows[1].slice(); // 一郎の行を複製し、T12 を全部5にした改訂版として末尾に追加
  const headers = rows[0];
  g.ITEMS.filter((i) => i.themeId === 'T12').forEach((i) => {
    const idx = headers.findIndex((h) => g.normalizeText_(h) === g.normalizeText_(i.text));
    dup[idx] = i.reverse ? 1 : 5;
  });
  const data = g.scoreTable(rows.concat([dup]));
  assert(data.people.length === 12, '人数が増えている');
  assert(data.duplicates.indexOf('サンプル 一郎') >= 0, '重複が記録されない');
  const p = data.people.find((x) => x.name === 'サンプル 一郎');
  assert(p.result.ranking[0].themeId === 'T12', `後の行が採用されていない (1位 ${p.result.ranking[0].name})`);
});

check('生成物 report.html にデータが埋め込まれ、プレースホルダが残っていない', () => {
  const html = read('report.html');
  ['/*__DATA__*/', '/*__SCORING__*/', '/*__CSV__*/', '/*__SAMPLE__*/'].forEach((ph) => assert(html.indexOf(ph) < 0, `${ph} が残存`));
  assert(html.indexOf('const THEMES') >= 0 && html.indexOf('const SAMPLE_TSV') >= 0, '埋め込み欠落');
  const gs = read('form-generator.gs');
  assert(gs.indexOf('/*__DATA__*/') < 0 && gs.indexOf('const ITEMS') >= 0, 'form-generator.gs の埋め込み');
  new vm.Script(gs, { filename: 'form-generator.gs' });
});

console.log(`\n${fail === 0 ? `全 ${pass} 項目 合格` : `${fail} 項目が失敗`}`);
process.exit(fail ? 1 : 0);
