/**
 * APIレスポンスの正規化（純粋関数のみ。GASのグローバルを使わない → node でテスト可能）
 * freee側のフィールド名の揺れ（group_id / id、group_name / name 等）はここで吸収する。
 */

function pick_(obj, keys, fallback) {
  for (const k of keys) {
    if (obj && obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
  }
  return fallback === undefined ? '' : fallback;
}

function normalizeGroup(raw) {
  return {
    id: String(pick_(raw, ['id', 'group_id'])),
    code: String(pick_(raw, ['code', 'group_code'])),
    name: String(pick_(raw, ['name', 'group_name'])),
    level: Number(pick_(raw, ['level'], 0)) || 0,
    parentId: pick_(raw, ['parent_group_id', 'parent_id'], null) === null ? null : String(pick_(raw, ['parent_group_id', 'parent_id'])),
    parentName: String(pick_(raw, ['parent_group_name'])),
  };
}

function normalizePosition(raw) {
  return {
    id: String(pick_(raw, ['id', 'position_id'])),
    code: String(pick_(raw, ['code', 'position_code'])),
    name: String(pick_(raw, ['name', 'position_name'])),
  };
}

function normalizeEmployee(raw, detail) {
  const d = detail || {};
  const profile = d.profile_rule || raw.profile_rule || {};
  const last = pick_(profile, ['last_name'], '');
  const first = pick_(profile, ['first_name'], '');
  const displayName = pick_(raw, ['display_name'], '') || pick_(d, ['display_name'], '') || (last + ' ' + first).trim();
  return {
    id: String(pick_(raw, ['id', 'employee_id'])),
    num: String(pick_(raw, ['num', 'employee_num'], '') || pick_(d, ['num'], '')),
    displayName: displayName,
    email: String(pick_(raw, ['email'], '') || pick_(d, ['email'], '') || pick_(profile, ['email'], '')),
    entryDate: String(pick_(raw, ['entry_date'], '') || pick_(d, ['entry_date'], '')),
    retireDate: String(pick_(raw, ['retire_date'], '') || pick_(d, ['retire_date'], '')),
    employmentType: String(pick_(profile, ['employment_type'], '') || pick_(raw, ['employment_type'], '')),
    title: String(pick_(profile, ['title'], '')),
  };
}

function normalizeMembership(raw) {
  return {
    groupId: String(pick_(raw, ['group_id', 'id'])),
    groupCode: String(pick_(raw, ['group_code', 'code'])),
    groupName: String(pick_(raw, ['group_name', 'name'])),
    level: Number(pick_(raw, ['level'], 0)) || 0,
    parentGroupId: pick_(raw, ['parent_group_id'], null) === null ? null : String(pick_(raw, ['parent_group_id'])),
    positionId: String(pick_(raw, ['position_id'])),
    positionCode: String(pick_(raw, ['position_code'])),
    positionName: String(pick_(raw, ['position_name'])),
  };
}

function employmentTypeLabel(type, labels) {
  if (!type) return '';
  return (labels && labels[type]) || type;
}

/** 部門IDをキーにした索引。親が未知の部門も落とさない。 */
function buildGroupIndex(groups) {
  const byId = {};
  groups.forEach(g => { byId[g.id] = g; });
  return byId;
}

/** ルート→対象部門までの部門オブジェクト配列。循環・欠損は安全に打ち切る。 */
function groupChain(groupIndex, groupId, maxDepth) {
  const chain = [];
  const seen = {};
  let cur = groupIndex[groupId];
  while (cur && !seen[cur.id] && chain.length < (maxDepth || 20)) {
    seen[cur.id] = true;
    chain.unshift(cur);
    cur = cur.parentId ? groupIndex[cur.parentId] : null;
  }
  return chain;
}

function groupPathNames(groupIndex, groupId, maxDepth) {
  return groupChain(groupIndex, groupId, maxDepth).map(g => g.name);
}

/** YYYY-MM-DD 文字列を日付比較用の数値に。空なら null */
function dateKey(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]);
}

/** 在籍判定。today は YYYY-MM-DD */
function employmentStatus(emp, today) {
  const t = dateKey(today);
  const entry = dateKey(emp.entryDate);
  const retire = dateKey(emp.retireDate);
  if (retire !== null && retire < t) return '退職';
  if (entry !== null && entry > t) return '入社予定';
  return '在籍';
}
