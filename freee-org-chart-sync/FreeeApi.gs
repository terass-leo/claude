/**
 * freee人事労務 API 呼び出し層
 * 認証・リトライ・ページングをここに閉じ込める。レスポンスの形の揺れは Normalize.gs で吸収する。
 */

function freeeGet_(path, params) {
  const query = Object.assign({ company_id: getCompanyId_() }, params || {});
  const qs = Object.keys(query)
    .filter(k => query[k] !== undefined && query[k] !== null)
    .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(query[k]))
    .join('&');
  const url = CONFIG.API_BASE + path + (qs ? '?' + qs : '');

  let refreshed = false;
  for (let attempt = 1; ; attempt++) {
    const res = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: {
        Authorization: 'Bearer ' + getAccessToken_(),
        'FREEE-VERSION': CONFIG.FREEE_VERSION,
        Accept: 'application/json',
      },
      muteHttpExceptions: true,
    });
    const code = res.getResponseCode();
    const body = res.getContentText();

    if (code >= 200 && code < 300) {
      if (CONFIG.API_INTERVAL_MS) Utilities.sleep(CONFIG.API_INTERVAL_MS);
      return body ? JSON.parse(body) : {};
    }
    if (code === 401 && !refreshed) {
      refreshed = true;
      getAccessToken_(true);
      continue;
    }
    const retryable = code === 429 || code >= 500;
    if (retryable && attempt <= CONFIG.API_RETRY) {
      Utilities.sleep(CONFIG.API_RETRY_WAIT_MS * attempt);
      continue;
    }
    throw new Error('freee API エラー GET ' + path + ' (HTTP ' + code + '): ' + body.slice(0, 500));
  }
}

/** 部門一覧 */
function fetchGroups_() {
  const data = freeeGet_('/groups');
  return firstArray_(data, ['groups', 'employee_groups', 'data']);
}

/** 役職一覧 */
function fetchPositions_() {
  const data = freeeGet_('/positions');
  return firstArray_(data, ['positions', 'employee_positions', 'data']);
}

/**
 * 従業員一覧（全ページ）
 * 注意: ページングは limit + offset。page パラメータは無視される（実地検証済み）。
 */
function fetchAllEmployees_() {
  const all = [];
  const limit = CONFIG.PAGE_LIMIT;
  for (let offset = 0, page = 0; page < 100; offset += limit, page++) {
    const data = freeeGet_('/employees', {
      limit: limit,
      offset: offset,
      with_no_payroll_calculation: true, // 給与計算対象外（役員・業務委託等）も含める
    });
    const items = firstArray_(data, ['employees', 'data']);
    all.push.apply(all, items);
    if (items.length < limit) break;
  }
  return all;
}

/** 従業員の所属部門・役職 */
function fetchGroupMemberships_(employeeId) {
  const data = freeeGet_('/employees/' + employeeId + '/group_memberships');
  const container = (data && data.employee_group_memberships) || data || {};
  return firstArray_(container, ['group_memberships', 'memberships', 'groups']);
}

/** 従業員詳細（雇用形態・肩書き等） */
function fetchEmployeeDetail_(employeeId) {
  const data = freeeGet_('/employees/' + employeeId);
  return (data && data.employee) || data || {};
}

function firstArray_(obj, keys) {
  if (Array.isArray(obj)) return obj;
  if (!obj) return [];
  for (const k of keys) {
    if (Array.isArray(obj[k])) return obj[k];
  }
  // 最後の手段: 最初に見つかった配列プロパティ
  for (const k of Object.keys(obj)) {
    if (Array.isArray(obj[k])) return obj[k];
  }
  return [];
}
