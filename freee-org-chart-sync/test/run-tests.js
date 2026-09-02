/**
 * 純粋関数（Normalize / Build / Diff）の node 上テスト。
 *   node test/run-tests.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const eq = (a, b, msg) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b), msg);

const ctx = { console };
vm.createContext(ctx);
['Config.gs', 'Normalize.gs', 'Build.gs', 'Diff.gs'].forEach(f => {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx, { filename: f });
});
const g = vm.runInContext('({ CONFIG, FLAT_HEADER, normalizeGroup, normalizePosition, normalizeEmployee, normalizeMembership, employmentTypeLabel, buildGroupIndex, groupPathNames, employmentStatus, buildModel, rowsToFlat, diffFlat, summarizeChanges })', ctx);

// ---- fixtures（freee応答の想定形。フィールド名の揺れも混ぜる） ----
const rawGroups = [
  { id: 1, code: 'HQ', name: '本部', level: 1, parent_group_id: null },
  { id: 2, code: 'HR', name: 'HR Div', level: 2, parent_group_id: 1 },
  { id: 3, code: 'HR-REC', name: '採用', level: 3, parent_group_id: 2 },
  { id: 4, code: 'BIZ', name: '事業本部', level: 1, parent_group_id: null },
];
const rawPositions = [{ id: 10, code: 'CHRO', name: 'CHRO' }, { id: 11, code: 'MGR', name: 'マネージャー' }, { id: 12, code: 'MEM', name: 'メンバー' }];

const groups = rawGroups.map(g.normalizeGroup);
const positions = rawPositions.map(g.normalizePosition);

function emp(id, name, entry, retire, type) {
  return g.normalizeEmployee({ id, num: 'E' + id, display_name: name, email: name.toLowerCase() + '@terass.com', entry_date: entry, retire_date: retire || null },
    { profile_rule: { employment_type: type || 'employee', title: '' } });
}

const today = '2026-09-02';
const employees = [
  { emp: emp(1, 'Leo', '2021-04-01'), memberships: [{ group_id: 2, group_name: 'HR Div', position_id: 10, position_name: 'CHRO' }] },
  { emp: emp(2, 'Kazu', '2022-01-01'), memberships: [
      { group_id: 3, group_name: '採用', position_id: 11, position_name: 'マネージャー' },
      { id: 4, name: '事業本部', position_id: 12, position_name: 'メンバー' }, // id/name 形式の揺れ
  ] },
  { emp: emp(3, 'Retired', '2020-01-01', '2026-05-31'), memberships: [{ group_id: 2 }] },
  { emp: emp(4, 'Future', '2026-10-01'), memberships: [{ group_id: 3, position_id: 12 }] },
  { emp: emp(5, 'NoGroup', '2024-01-01'), memberships: [] },
  { emp: emp(6, 'Orphan', '2024-01-01'), memberships: [{ group_id: 99, group_name: '謎部門', parent_group_id: 4 }] },
].map(e => ({ emp: e.emp, memberships: e.memberships.map(g.normalizeMembership) }));

// ---- Normalize ----
assert.strictEqual(g.employmentStatus(employees[2].emp, today), '退職');
assert.strictEqual(g.employmentStatus(employees[3].emp, today), '入社予定');
assert.strictEqual(g.employmentStatus(employees[0].emp, today), '在籍');
eq(g.groupPathNames(g.buildGroupIndex(groups), '3'), ['本部', 'HR Div', '採用']);
assert.strictEqual(g.employmentTypeLabel('director', g.CONFIG.EMPLOYMENT_TYPE_LABELS), '役員');
assert.strictEqual(g.employmentTypeLabel('weird_type', g.CONFIG.EMPLOYMENT_TYPE_LABELS), 'weird_type');
// 循環参照でも止まる
const cyc = g.buildGroupIndex([{ id: 'a', name: 'A', parentId: 'b' }, { id: 'b', name: 'B', parentId: 'a' }]);
eq(g.groupPathNames(cyc, 'a'), ['B', 'A']);

// ---- Build ----
const model = g.buildModel({ groups, positions, employees, today, syncedAt: '2026-09-02 06:00:00', config: g.CONFIG });
const byName = {};
model.flat.forEach(r => (byName[r.name] = byName[r.name] || []).push(r));
assert.ok(!byName['Retired'], '退職者は除外される');
assert.ok(byName['Future'] && byName['Future'][0].status === '入社予定', '入社予定は含まれる');
assert.strictEqual(byName['Kazu'].length, 2, '兼務は2行');
assert.strictEqual(byName['Kazu'].find(r => r.order === 1).concurrent, '主');
assert.strictEqual(byName['Kazu'].find(r => r.order === 2).concurrent, '兼務');
assert.strictEqual(byName['Kazu'].find(r => r.order === 1).path, '本部 > HR Div > 採用');
assert.strictEqual(byName['Kazu'].find(r => r.order === 2).groupName, '事業本部', 'id/name 形式でも部門が解決される');
assert.strictEqual(byName['NoGroup'][0].path, '（部門未設定）');
assert.strictEqual(byName['Orphan'][0].path, '事業本部 > 謎部門', 'マスタに無い部門も親をたどって補完される');
assert.strictEqual(byName['Leo'][0].levels[0], '本部');
assert.strictEqual(byName['Leo'][0].levels[1], 'HR Div');
assert.strictEqual(byName['Leo'][0].employmentType, '正社員');
assert.strictEqual(model.stats.employees, 5);
assert.strictEqual(model.stats.memberships, 6);
assert.strictEqual(model.stats.noGroup, 1);
// 部門マスタ: 本部の配下合計 = Leo + Kazu(主) + Future = 3
const hq = model.groupRows.find(r => r[2] === '本部');
assert.strictEqual(hq[7], 0, '本部 直属0');
assert.strictEqual(hq[8], 3, '本部 配下合計3');
const rec = model.groupRows.find(r => r[2] === '採用');
assert.strictEqual(rec[7], 2);
assert.strictEqual(rec[9], 2, '採用 主所属2');
const biz = model.groupRows.find(r => r[2] === '事業本部');
assert.strictEqual(biz[8], 2, '事業本部 配下合計 = Kazu兼務 + Orphan');
assert.ok(biz[10].indexOf('※Kazu') >= 0, '兼務者には※');
// ツリー: L列に部門名が階層位置で入る
const treeRec = model.treeRows.find(r => r[2] === '採用');
assert.ok(treeRec && treeRec[0] === '' && treeRec[1] === '');
assert.strictEqual(model.treeHeader.length, g.CONFIG.MAX_GROUP_DEPTH + 3);
// 行→オブジェクト往復
assert.strictEqual(model.flatRows[0].length, g.FLAT_HEADER.length);
const roundTrip = g.rowsToFlat(g.FLAT_HEADER, model.flatRows);
assert.strictEqual(roundTrip.length, model.flat.length);
assert.strictEqual(roundTrip.find(r => r.name === 'Kazu' && r.order === 2).path, '事業本部');

// ---- Diff ----
const opts = { detectedAt: '2026-09-03 06:00:00', today: '2026-09-03', newHireWindowDays: 45 };
eq(g.diffFlat([], model.flat, opts), [], '初回は履歴なし');
eq(g.diffFlat(model.flat, model.flat, opts), [], '変化なしなら空');

// 変化を作る: Leoが事業本部に異動+役職変更、Kazuの兼務解除、NoGroup退職、新入社 Sae、Future着任
const employees2 = [
  { emp: emp(1, 'Leo', '2021-04-01'), memberships: [{ group_id: 4, position_id: 11, position_name: 'マネージャー' }] },
  { emp: emp(2, 'Kazu', '2022-01-01'), memberships: [{ group_id: 3, position_id: 11, position_name: 'マネージャー' }] },
  { emp: emp(4, 'Future', '2026-09-01'), memberships: [{ group_id: 3, position_id: 12 }] },
  { emp: emp(6, 'Orphan', '2024-01-01', null, 'director'), memberships: [{ group_id: 99, group_name: '謎部門', parent_group_id: 4 }] },
  { emp: emp(7, 'Sae', '2026-09-01'), memberships: [{ group_id: 3, position_id: 12, position_name: 'メンバー' }] },
  { emp: emp(8, 'Old', '2019-01-01'), memberships: [{ group_id: 4 }] },
].map(e => ({ emp: e.emp, memberships: e.memberships.map(g.normalizeMembership) }));
const model2 = g.buildModel({ groups, positions, employees: employees2, today: '2026-09-03', syncedAt: 'x', config: g.CONFIG });
const changes = g.diffFlat(model.flat, model2.flat, opts);
const types = changes.map(r => r[1] + ':' + r[4]).sort();
eq(types, [
  '入社:Sae', '入社（着任）:Future', '兼務解除:Kazu', '役職変更:Leo', '新規検知:Old', '異動（主所属）:Leo', '退職・除外:NoGroup', '雇用形態変更:Orphan',
].sort(), JSON.stringify(types));
const move = changes.find(r => r[1] === '異動（主所属）');
assert.strictEqual(move[5], '本部 > HR Div');
assert.strictEqual(move[6], '事業本部');
const arrive = changes.find(r => r[4] === 'Future');
assert.strictEqual(arrive[1], '入社（着任）', '入社予定→在籍 を着任として検知');
const summary = g.summarizeChanges(changes, 3);
assert.ok(summary.split('\n').length === 4 && /他 5 件/.test(summary), summary);

console.log('ALL TESTS PASSED (' + changes.length + ' change rows in diff scenario)');
