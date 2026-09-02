/**
 * 正規化済みデータからシート出力用の行配列を組み立てる（純粋関数）
 */

const FLAT_HEADER = [
  '従業員ID', '従業員番号', '氏名', 'メール', '雇用形態', '肩書き', '入社日', '退職日', '在籍ステータス',
  '部門L1', '部門L2', '部門L3', '部門L4', '部門L5', '部門L6',
  '所属部門', '部門コード', '部門ID', '階層', '役職', '役職コード', '所属順', '兼務', '部門フルパス', '同期日時',
];

const GROUPS_HEADER = ['部門ID', '部門コード', '部門名', '階層', '親部門ID', '親部門名', '部門フルパス', '直属人数', '配下合計人数', '主所属人数', '直属メンバー'];
const POSITIONS_HEADER = ['役職ID', '役職コード', '役職名', '人数', '該当者'];
const TREE_HEADER_FIXED = ['直属人数', '配下合計人数', 'メンバー（氏名／役職、※=兼務）'];
const CHANGES_HEADER = ['検知日時', '種別', '従業員ID', '従業員番号', '氏名', '変更前', '変更後', '備考'];

/**
 * @param input {
 *   groups: normalizeGroup[], positions: normalizePosition[],
 *   employees: [{ emp: normalizeEmployee, memberships: normalizeMembership[] }],
 *   today: 'YYYY-MM-DD', syncedAt: string, config: CONFIG相当
 * }
 */
function buildModel(input) {
  const cfg = input.config;
  const groupIndex = buildGroupIndex(input.groups);
  const maxDepth = cfg.MAX_GROUP_DEPTH;

  // 部門一覧に無いが所属情報にだけ現れる部門も索引へ補完
  input.employees.forEach(e => e.memberships.forEach(m => {
    if (m.groupId && !groupIndex[m.groupId]) {
      groupIndex[m.groupId] = { id: m.groupId, code: m.groupCode, name: m.groupName || '(不明な部門 ' + m.groupId + ')', level: m.level, parentId: m.parentGroupId, parentName: '' };
    }
  }));

  const flat = [];
  const membersByGroup = {}; // groupId -> [{name, position, primary}]
  const primaryCountByGroup = {};
  const membersByPosition = {}; // positionId -> [name]
  const positionIndex = {};
  input.positions.forEach(p => { positionIndex[p.id] = p; });

  input.employees.forEach(({ emp, memberships }) => {
    const status = employmentStatus(emp, input.today);
    if (status === '退職' && !cfg.INCLUDE_RETIRED) return;
    if (status === '入社予定' && !cfg.INCLUDE_FUTURE_ENTRANTS) return;

    const list = memberships.length ? memberships : [null];
    list.forEach((m, idx) => {
      const chain = m ? groupChain(groupIndex, m.groupId, maxDepth) : [];
      const names = chain.map(g => g.name);
      const leaf = chain.length ? chain[chain.length - 1] : null;
      const levels = [];
      for (let i = 0; i < maxDepth; i++) levels.push(names[i] || '');
      const positionName = m ? (m.positionName || (positionIndex[m.positionId] || {}).name || '') : '';
      const positionCode = m ? (m.positionCode || (positionIndex[m.positionId] || {}).code || '') : '';
      const isPrimary = idx === 0;

      flat.push({
        employeeId: emp.id,
        num: emp.num,
        name: emp.displayName,
        email: emp.email,
        employmentType: employmentTypeLabel(emp.employmentType, cfg.EMPLOYMENT_TYPE_LABELS),
        title: emp.title,
        entryDate: emp.entryDate,
        retireDate: emp.retireDate,
        status: status,
        levels: levels,
        groupName: leaf ? leaf.name : (m ? m.groupName : '（部門未設定）'),
        groupCode: leaf ? leaf.code : (m ? m.groupCode : ''),
        groupId: m ? m.groupId : '',
        depth: chain.length,
        positionName: positionName,
        positionCode: positionCode,
        order: idx + 1,
        concurrent: memberships.length > 1 ? (isPrimary ? '主' : '兼務') : '',
        path: names.join(' > ') || '（部門未設定）',
        syncedAt: input.syncedAt,
      });

      if (m) {
        const key = m.groupId;
        (membersByGroup[key] = membersByGroup[key] || []).push({ name: emp.displayName, position: positionName, primary: isPrimary });
        if (isPrimary) primaryCountByGroup[key] = (primaryCountByGroup[key] || 0) + 1;
        if (m.positionId || positionName) {
          const pk = m.positionId || positionName;
          (membersByPosition[pk] = membersByPosition[pk] || []).push(emp.displayName);
        }
      }
    });
  });

  // 部門順（フルパス）→ 所属順 → 従業員番号 で並べる
  flat.sort((a, b) => cmp_(a.path, b.path) || cmp_(a.order, b.order) || cmp_(a.num, b.num) || cmp_(a.name, b.name));

  const groupsSorted = Object.keys(groupIndex).map(id => groupIndex[id])
    .map(g => ({ g: g, chain: groupChain(groupIndex, g.id, maxDepth) }))
    .sort((a, b) => cmp_(a.chain.map(x => x.name).join(' > '), b.chain.map(x => x.name).join(' > ')));

  // 配下合計人数（子孫部門を含む）: 各部門の全祖先に加算
  const subtreeCount = {};
  Object.keys(membersByGroup).forEach(gid => {
    const n = membersByGroup[gid].length;
    groupChain(groupIndex, gid, maxDepth).forEach(g => { subtreeCount[g.id] = (subtreeCount[g.id] || 0) + n; });
  });

  const groupRows = groupsSorted.map(({ g, chain }) => {
    const members = membersByGroup[g.id] || [];
    return [
      g.id, g.code, g.name, chain.length, g.parentId || '', g.parentId && groupIndex[g.parentId] ? groupIndex[g.parentId].name : g.parentName,
      chain.map(x => x.name).join(' > '), members.length, subtreeCount[g.id] || 0, primaryCountByGroup[g.id] || 0,
      members.map(formatMember_).join('、'),
    ];
  });

  const treeHeader = [];
  for (let i = 0; i < maxDepth; i++) treeHeader.push('L' + (i + 1));
  const treeRows = groupsSorted.map(({ g, chain }) => {
    const cells = [];
    for (let i = 0; i < maxDepth; i++) cells.push(i === chain.length - 1 ? g.name : '');
    const members = membersByGroup[g.id] || [];
    return cells.concat([members.length, subtreeCount[g.id] || 0, members.map(formatMember_).join('、')]);
  });

  const positionRows = input.positions
    .map(p => [p.id, p.code, p.name, (membersByPosition[p.id] || []).length, (membersByPosition[p.id] || []).join('、')])
    .sort((a, b) => cmp_(b[3], a[3]) || cmp_(a[2], b[2]));
  // 役職マスタに無いが所属情報にだけ現れる役職名
  Object.keys(membersByPosition).forEach(pk => {
    if (!positionIndex[pk]) positionRows.push(['', '', pk, membersByPosition[pk].length, membersByPosition[pk].join('、')]);
  });

  return {
    flat: flat,
    flatRows: flat.map(flatToRow),
    groupRows: groupRows,
    treeHeader: treeHeader.concat(TREE_HEADER_FIXED),
    treeRows: treeRows,
    positionRows: positionRows,
    stats: {
      employees: uniqueCount_(flat.map(r => r.employeeId)),
      memberships: flat.length,
      groups: groupsSorted.length,
      positions: positionRows.length,
      noGroup: flat.filter(r => !r.groupId).length,
    },
  };
}

function formatMember_(m) {
  return (m.primary ? '' : '※') + m.name + (m.position ? '（' + m.position + '）' : '');
}

function flatToRow(r) {
  return [
    r.employeeId, r.num, r.name, r.email, r.employmentType, r.title, r.entryDate, r.retireDate, r.status,
  ].concat(r.levels).concat([
    r.groupName, r.groupCode, r.groupId, r.depth, r.positionName, r.positionCode, r.order, r.concurrent, r.path, r.syncedAt,
  ]);
}

/** シートから読み戻した行（ヘッダーは除く）を flat オブジェクトに戻す。列位置はヘッダー名で解決する。 */
function rowsToFlat(header, rows) {
  const col = {};
  header.forEach((h, i) => { col[h] = i; });
  const get = (row, name) => (col[name] === undefined ? '' : String(row[col[name]] === null || row[col[name]] === undefined ? '' : row[col[name]]));
  return rows.filter(r => get(r, '従業員ID') !== '').map(r => ({
    employeeId: get(r, '従業員ID'),
    num: get(r, '従業員番号'),
    name: get(r, '氏名'),
    email: get(r, 'メール'),
    employmentType: get(r, '雇用形態'),
    title: get(r, '肩書き'),
    entryDate: get(r, '入社日'),
    retireDate: get(r, '退職日'),
    status: get(r, '在籍ステータス'),
    groupName: get(r, '所属部門'),
    groupId: get(r, '部門ID'),
    positionName: get(r, '役職'),
    order: Number(get(r, '所属順')) || 1,
    path: get(r, '部門フルパス'),
  }));
}

function cmp_(a, b) {
  if (a === b) return 0;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a) < String(b) ? -1 : 1;
}

function uniqueCount_(arr) {
  const s = {};
  arr.forEach(v => { s[v] = true; });
  return Object.keys(s).length;
}
