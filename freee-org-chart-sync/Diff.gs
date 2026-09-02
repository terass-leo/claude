/**
 * 前回同期結果（シート上の組織図_フラット）と今回結果の差分を検出する（純粋関数）
 * 出力は 変更履歴 シートの行。
 */

function diffFlat(prevFlat, nextFlat, opts) {
  const o = opts || {};
  const detectedAt = o.detectedAt || '';
  const today = o.today || '';
  const newHireWindowDays = o.newHireWindowDays || 45;

  const prev = groupByEmployee_(prevFlat);
  const next = groupByEmployee_(nextFlat);
  const rows = [];
  const push = (type, e, before, after, note) => rows.push([detectedAt, type, e.employeeId, e.num, e.name, before, after, note || '']);

  Object.keys(next).forEach(id => {
    const n = next[id];
    const p = prev[id];
    if (!p) {
      if (Object.keys(prev).length === 0) return; // 初回同期は履歴を作らない
      const recentHire = isWithinDays_(n.primary.entryDate, today, newHireWindowDays);
      push(recentHire ? '入社' : '新規検知', n.primary, '', describe_(n), n.primary.status === '入社予定' ? '入社予定' : (recentHire ? '' : 'freee上に新たに現れた従業員（入社日: ' + n.primary.entryDate + '）'));
      return;
    }
    if (p.primary.path !== n.primary.path) {
      push('異動（主所属）', n.primary, p.primary.path, n.primary.path);
    }
    if ((p.primary.positionName || '') !== (n.primary.positionName || '')) {
      push('役職変更', n.primary, p.primary.positionName || '（なし）', n.primary.positionName || '（なし）');
    }
    const pSub = setOf_(p.others.map(membershipKey_));
    const nSub = setOf_(n.others.map(membershipKey_));
    n.others.forEach(m => { if (!pSub[membershipKey_(m)]) push('兼務追加', n.primary, '', membershipKey_(m)); });
    p.others.forEach(m => { if (!nSub[membershipKey_(m)]) push('兼務解除', n.primary, membershipKey_(m), ''); });
    if ((p.primary.employmentType || '') !== (n.primary.employmentType || '') && (p.primary.employmentType || n.primary.employmentType)) {
      push('雇用形態変更', n.primary, p.primary.employmentType || '（なし）', n.primary.employmentType || '（なし）');
    }
    if (p.primary.name !== n.primary.name) {
      push('氏名変更', n.primary, p.primary.name, n.primary.name);
    }
    if (p.primary.status !== n.primary.status && n.primary.status === '在籍' && p.primary.status === '入社予定') {
      push('入社（着任）', n.primary, '入社予定', '在籍');
    }
  });

  Object.keys(prev).forEach(id => {
    if (!next[id]) {
      const p = prev[id];
      push('退職・除外', p.primary, describe_(p), '', p.primary.retireDate ? '退職日: ' + p.primary.retireDate : 'freee一覧から消えた（退職 or 対象外化）');
    }
  });

  return rows;
}

function groupByEmployee_(flat) {
  const by = {};
  flat.forEach(r => {
    if (!r.employeeId) return;
    (by[r.employeeId] = by[r.employeeId] || []).push(r);
  });
  const out = {};
  Object.keys(by).forEach(id => {
    const list = by[id].slice().sort((a, b) => (a.order || 1) - (b.order || 1));
    out[id] = { primary: list[0], others: list.slice(1) };
  });
  return out;
}

function membershipKey_(r) {
  return r.path + (r.positionName ? ' / ' + r.positionName : '');
}

function describe_(e) {
  const parts = [membershipKey_(e.primary)].concat(e.others.map(m => '※' + membershipKey_(m)));
  return parts.join('、');
}

function setOf_(arr) {
  const s = {};
  arr.forEach(v => { s[v] = true; });
  return s;
}

function isWithinDays_(dateStr, today, days) {
  const d = parseYmd_(dateStr);
  const t = parseYmd_(today);
  if (!d || !t) return false;
  const diff = (t - d) / 86400000;
  return diff <= days; // 未来（入社予定）も含める
}

function parseYmd_(s) {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Slack通知用の要約テキスト */
function summarizeChanges(changeRows, maxLines) {
  const lines = changeRows.slice(0, maxLines || 30).map(r => {
    const type = r[1], name = r[4], before = r[5], after = r[6];
    if (before && after) return '• ' + type + '：' + name + '　' + before + ' → ' + after;
    if (after) return '• ' + type + '：' + name + '　' + after;
    return '• ' + type + '：' + name + (before ? '　' + before : '');
  });
  if (changeRows.length > lines.length) lines.push('… 他 ' + (changeRows.length - lines.length) + ' 件（スプレッドシートの変更履歴を参照）');
  return lines.join('\n');
}
