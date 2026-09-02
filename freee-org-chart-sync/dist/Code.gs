/**
 * freee人事労務 → Google スプレッドシート 組織図自動同期
 * ※このファイルは build-single-file.sh が Config/Auth/FreeeApi/Normalize/Build/Diff/Sheets/Notify/Main を
 *   結合して生成したものです。編集は各 .gs 側で行ってください。
 */

// ===================== Config.gs =====================

/**
 * freee人事労務 → Google スプレッドシート 組織図自動同期
 * 設定値（このファイル以外は基本的に触らなくてよい）
 *
 * 秘匿情報（client_id / client_secret / トークン / Slack Webhook）は
 * スクリプトプロパティに保存する。コードには書かない。
 */
const CONFIG = {
  // freee 事業所ID（スクリプトプロパティ FREEE_COMPANY_ID があればそちらを優先）
  DEFAULT_COMPANY_ID: 11460330,

  API_BASE: 'https://api.freee.co.jp/hr/api/v1',
  AUTH_BASE: 'https://accounts.secure.freee.co.jp/public_api',
  // GASにコールバックURLを持たせずに済む「認可コードを画面表示」方式
  REDIRECT_URI: 'urn:ietf:wg:oauth:2.0:oob',
  FREEE_VERSION: '2022-02-01',

  PAGE_LIMIT: 100,              // /employees の最大値
  MAX_GROUP_DEPTH: 6,           // 部門階層の最大深さ（列数）
  API_RETRY: 3,
  API_RETRY_WAIT_MS: 1500,
  API_INTERVAL_MS: 120,         // レート制限対策の呼び出し間隔

  INCLUDE_RETIRED: false,       // 退職日が過去の従業員を含めるか
  INCLUDE_FUTURE_ENTRANTS: true,// 入社日が未来の従業員（入社予定）を含めるか
  FETCH_EMPLOYEE_DETAIL: true,  // 雇用形態・肩書きのため /employees/{id} を追加取得（従業員数分の呼び出し増）
  TIME_BUDGET_MS: 4.5 * 60 * 1000, // GAS実行上限6分に対する安全マージン。超えたら詳細取得を省略

  TRIGGER_HOUR: 6,              // 日次同期の実行時刻（JST）

  // 変更履歴で「入社」と判定する目安（入社日が同期日からこの日数以内、または初回検知）
  NEW_HIRE_WINDOW_DAYS: 45,

  SHEETS: {
    FLAT: '組織図_フラット',
    TREE: '組織図_ツリー',
    GROUPS: '部門マスタ',
    POSITIONS: '役職マスタ',
    CHANGES: '変更履歴',
    META: '_meta',
    RAW: '_raw_debug',
  },

  // freee employment_type の表示名。未知の値はそのまま表示する
  EMPLOYMENT_TYPE_LABELS: {
    employee: '正社員',
    regular_employee: '正社員',
    director: '役員',
    board_member: '役員',
    contract: '契約社員',
    contract_employee: '契約社員',
    part_time: 'パート・アルバイト',
    part_timer: 'パート・アルバイト',
    temporary: '派遣',
    outsourcing: '業務委託',
    other: 'その他',
  },
};

const PROP_KEYS = {
  CLIENT_ID: 'FREEE_CLIENT_ID',
  CLIENT_SECRET: 'FREEE_CLIENT_SECRET',
  COMPANY_ID: 'FREEE_COMPANY_ID',
  ACCESS_TOKEN: 'FREEE_ACCESS_TOKEN',
  ACCESS_TOKEN_EXPIRES_AT: 'FREEE_ACCESS_TOKEN_EXPIRES_AT',
  REFRESH_TOKEN: 'FREEE_REFRESH_TOKEN',
  AUTH_CODE: 'FREEE_AUTH_CODE',            // 初回認可時だけ一時的に使う
  SPREADSHEET_ID: 'SPREADSHEET_ID',        // スタンドアロン運用時のみ
  SLACK_WEBHOOK_URL: 'SLACK_WEBHOOK_URL',  // 任意
  DEBUG_RAW: 'DEBUG_RAW',                  // 'true' で _raw_debug にAPI生データを出す
};

// ===================== Auth.gs =====================

/**
 * freee OAuth2 認証まわり
 *
 * 初回セットアップ手順（README参照）:
 *   1. スクリプトプロパティに FREEE_CLIENT_ID / FREEE_CLIENT_SECRET を保存
 *   2. getAuthorizationUrl() を実行 → ログに出るURLをブラウザで開いて認可
 *   3. 画面に表示された認可コードをスクリプトプロパティ FREEE_AUTH_CODE に保存し saveAuthCodeFromProperty() を実行
 * 以降はリフレッシュトークンで自動更新される（freee仕様: アクセストークン6時間、
 * リフレッシュトークンは使うたびに新しいものへ入れ替わる・90日未使用で失効）。
 */

function props_() {
  return PropertiesService.getScriptProperties();
}

function requireProp_(key) {
  const v = props_().getProperty(key);
  if (!v) {
    throw new Error('スクリプトプロパティ ' + key + ' が未設定です。プロジェクトの設定 > スクリプトプロパティ から登録してください。');
  }
  return v;
}

function getCompanyId_() {
  return Number(props_().getProperty(PROP_KEYS.COMPANY_ID) || CONFIG.DEFAULT_COMPANY_ID);
}

/** 認可URLをログに出す（手順2）。 */
function getAuthorizationUrl() {
  const clientId = requireProp_(PROP_KEYS.CLIENT_ID);
  const url = CONFIG.AUTH_BASE + '/authorize'
    + '?response_type=code'
    + '&client_id=' + encodeURIComponent(clientId)
    + '&redirect_uri=' + encodeURIComponent(CONFIG.REDIRECT_URI)
    + '&prompt=select_company';
  Logger.log('以下のURLをブラウザで開き、事業所（TERASS）を選んで認可してください:\n' + url);
  return url;
}

/** 認可コードをトークンに交換して保存する（手順3）。 */
function saveAuthCode(code) {
  if (!code) throw new Error('saveAuthCode("認可コード") の形で呼んでください。');
  const payload = {
    grant_type: 'authorization_code',
    client_id: requireProp_(PROP_KEYS.CLIENT_ID),
    client_secret: requireProp_(PROP_KEYS.CLIENT_SECRET),
    code: String(code).trim(),
    redirect_uri: CONFIG.REDIRECT_URI,
  };
  const token = postToken_(payload);
  storeToken_(token);
  Logger.log('トークンを保存しました。company_id(応答)=' + (token.company_id || '-') + ' / 有効期限(秒)=' + token.expires_in);
  return 'OK';
}

/**
 * GASエディタは関数に引数を渡せないため、認可コードをスクリプトプロパティ FREEE_AUTH_CODE に
 * 一時保存してからこの関数を実行する。成功したらプロパティは削除される。
 */
function saveAuthCodeFromProperty() {
  const code = props_().getProperty(PROP_KEYS.AUTH_CODE);
  if (!code) throw new Error('スクリプトプロパティ ' + PROP_KEYS.AUTH_CODE + ' に認可コードを保存してから実行してください。');
  const result = saveAuthCode(code);
  props_().deleteProperty(PROP_KEYS.AUTH_CODE);
  return result;
}

/** 現在有効なアクセストークンを返す。期限切れ間近なら更新する。 */
function getAccessToken_(forceRefresh) {
  const p = props_();
  const now = Date.now();
  const cached = p.getProperty(PROP_KEYS.ACCESS_TOKEN);
  const expiresAt = Number(p.getProperty(PROP_KEYS.ACCESS_TOKEN_EXPIRES_AT) || 0);
  if (!forceRefresh && cached && now < expiresAt - 5 * 60 * 1000) return cached;

  // 同時実行でリフレッシュトークンを二重消費しないようロック
  const lock = LockService.getScriptLock();
  lock.waitLock(30 * 1000);
  try {
    const cached2 = p.getProperty(PROP_KEYS.ACCESS_TOKEN);
    const expiresAt2 = Number(p.getProperty(PROP_KEYS.ACCESS_TOKEN_EXPIRES_AT) || 0);
    if (!forceRefresh && cached2 && Date.now() < expiresAt2 - 5 * 60 * 1000) return cached2;
    return refreshAccessToken_();
  } finally {
    lock.releaseLock();
  }
}

function refreshAccessToken_() {
  const refreshToken = props_().getProperty(PROP_KEYS.REFRESH_TOKEN);
  if (!refreshToken) {
    throw new Error('リフレッシュトークンがありません。getAuthorizationUrl() → saveAuthCode() で再認可してください。');
  }
  const payload = {
    grant_type: 'refresh_token',
    client_id: requireProp_(PROP_KEYS.CLIENT_ID),
    client_secret: requireProp_(PROP_KEYS.CLIENT_SECRET),
    refresh_token: refreshToken,
  };
  let token;
  try {
    token = postToken_(payload);
  } catch (e) {
    // invalid_grant = リフレッシュトークン失効。再認可が必要
    if (/invalid_grant/.test(String(e.message))) {
      props_().deleteProperty(PROP_KEYS.ACCESS_TOKEN);
      props_().deleteProperty(PROP_KEYS.ACCESS_TOKEN_EXPIRES_AT);
      throw new Error('freeeのリフレッシュトークンが失効しています（90日未使用 or 取り消し）。getAuthorizationUrl() → saveAuthCode() で再認可してください。原因: ' + e.message);
    }
    throw e;
  }
  storeToken_(token);
  return token.access_token;
}

function postToken_(payload) {
  const res = UrlFetchApp.fetch(CONFIG.AUTH_BASE + '/token', {
    method: 'post',
    payload: payload,
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  const body = res.getContentText();
  if (code < 200 || code >= 300) {
    throw new Error('freeeトークン取得に失敗 (HTTP ' + code + '): ' + body);
  }
  const json = JSON.parse(body);
  if (!json.access_token) throw new Error('freeeトークン応答に access_token がありません: ' + body);
  return json;
}

function storeToken_(token) {
  const p = props_();
  const expiresIn = Number(token.expires_in || 21600);
  const values = {};
  values[PROP_KEYS.ACCESS_TOKEN] = token.access_token;
  values[PROP_KEYS.ACCESS_TOKEN_EXPIRES_AT] = String(Date.now() + expiresIn * 1000);
  // freeeはリフレッシュトークンをローテーションする。必ず新しい方を保存する
  if (token.refresh_token) values[PROP_KEYS.REFRESH_TOKEN] = token.refresh_token;
  p.setProperties(values, false);
}

/** 認証状態の確認用。 */
function checkAuthStatus() {
  const p = props_();
  const info = {
    client_id_set: !!p.getProperty(PROP_KEYS.CLIENT_ID),
    client_secret_set: !!p.getProperty(PROP_KEYS.CLIENT_SECRET),
    refresh_token_set: !!p.getProperty(PROP_KEYS.REFRESH_TOKEN),
    access_token_expires_at: p.getProperty(PROP_KEYS.ACCESS_TOKEN_EXPIRES_AT)
      ? new Date(Number(p.getProperty(PROP_KEYS.ACCESS_TOKEN_EXPIRES_AT))).toString() : null,
    company_id: getCompanyId_(),
    slack_webhook_set: !!p.getProperty(PROP_KEYS.SLACK_WEBHOOK_URL),
  };
  Logger.log(JSON.stringify(info, null, 2));
  return info;
}

// ===================== FreeeApi.gs =====================

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

// ===================== Normalize.gs =====================

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

// ===================== Build.gs =====================

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

// ===================== Diff.gs =====================

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

// ===================== Sheets.gs =====================

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

// ===================== Notify.gs =====================

/** Slack Incoming Webhook 通知（任意。SLACK_WEBHOOK_URL 未設定なら何もしない） */
function notifySlack_(text) {
  const url = props_().getProperty(PROP_KEYS.SLACK_WEBHOOK_URL);
  if (!url) return false;
  try {
    UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ text: text }),
      muteHttpExceptions: true,
    });
    return true;
  } catch (e) {
    Logger.log('Slack通知失敗: ' + e);
    return false;
  }
}

// ===================== Main.gs =====================

/**
 * エントリポイント
 *   syncOrgChart()        : 手動 or トリガーから呼ぶ同期本体
 *   setupDailyTrigger()   : 日次トリガーを作成（既存は置き換え）
 *   removeTriggers()      : トリガー削除
 *   onOpen()              : コンテナバインド時にメニューを追加
 */

function onOpen() {
  try {
    SpreadsheetApp.getUi()
      .createMenu('freee同期')
      .addItem('今すぐ同期', 'syncOrgChart')
      .addItem('認証状態を確認', 'checkAuthStatusUi_')
      .addItem('日次トリガーを設定', 'setupDailyTrigger')
      .addToUi();
  } catch (e) { /* スタンドアロン実行時は無視 */ }
}

function checkAuthStatusUi_() {
  const info = checkAuthStatus();
  SpreadsheetApp.getUi().alert(JSON.stringify(info, null, 2));
}

function setupDailyTrigger() {
  removeTriggers();
  ScriptApp.newTrigger('syncOrgChart')
    .timeBased()
    .everyDays(1)
    .atHour(CONFIG.TRIGGER_HOUR)
    .inTimezone('Asia/Tokyo')
    .create();
  Logger.log('日次トリガーを設定しました: 毎日 ' + CONFIG.TRIGGER_HOUR + ':00 頃(JST) に syncOrgChart を実行');
}

function removeTriggers() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'syncOrgChart')
    .forEach(t => ScriptApp.deleteTrigger(t));
}

function syncOrgChart() {
  const startedAt = Date.now();
  const ss = getSpreadsheet_();
  const now = new Date();
  const syncedAt = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');
  const today = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM-dd');
  const warnings = [];

  try {
    // 1. マスタ取得
    const rawGroups = fetchGroups_();
    const rawPositions = fetchPositions_();
    const rawEmployees = fetchAllEmployees_();
    const groups = rawGroups.map(normalizeGroup);
    const positions = rawPositions.map(normalizePosition);

    // 2. 従業員ごとの所属・詳細取得（対象外の人は呼ばない）
    const employees = [];
    let detailSkipped = 0;
    const rawMembershipSamples = [];
    let rawDetailSample = null;
    rawEmployees.forEach(raw => {
      const base = normalizeEmployee(raw);
      const status = employmentStatus(base, today);
      if (status === '退職' && !CONFIG.INCLUDE_RETIRED) return;
      if (status === '入社予定' && !CONFIG.INCLUDE_FUTURE_ENTRANTS) return;

      const rawMemberships = fetchGroupMemberships_(base.id);
      if (rawMembershipSamples.length < 3) rawMembershipSamples.push(rawMemberships);

      let detail = null;
      if (CONFIG.FETCH_EMPLOYEE_DETAIL) {
        if (Date.now() - startedAt < CONFIG.TIME_BUDGET_MS) {
          detail = fetchEmployeeDetail_(base.id);
          if (!rawDetailSample) rawDetailSample = detail;
        } else {
          detailSkipped++;
        }
      }
      employees.push({ emp: normalizeEmployee(raw, detail), memberships: rawMemberships.map(normalizeMembership) });
    });
    if (detailSkipped) warnings.push('実行時間制約のため ' + detailSkipped + ' 名の詳細（雇用形態等）取得を省略しました。FETCH_EMPLOYEE_DETAIL を false にするか対象を絞ってください。');

    // 3. モデル構築
    const model = buildModel({ groups, positions, employees, today, syncedAt, config: CONFIG });
    if (model.stats.noGroup) warnings.push('部門未設定の従業員が ' + model.stats.noGroup + ' 名います。');
    if (!groups.length) warnings.push('部門一覧が0件です。freeeアプリの権限（部門・役職の参照）を確認してください。');

    // 4. 差分検出（上書き前に前回状態を読む）
    const prevFlat = readFlatSheet_(ss);
    const changes = diffFlat(prevFlat, model.flat, { detectedAt: syncedAt, today, newHireWindowDays: CONFIG.NEW_HIRE_WINDOW_DAYS });

    // 5. 書き込み
    writeTable_(ss, CONFIG.SHEETS.FLAT, FLAT_HEADER, model.flatRows, { frozenColumns: 3, textColumns: ['従業員ID', '従業員番号', '部門コード', '部門ID', '役職コード'] });
    writeTable_(ss, CONFIG.SHEETS.TREE, model.treeHeader, model.treeRows);
    writeTable_(ss, CONFIG.SHEETS.GROUPS, GROUPS_HEADER, model.groupRows, { textColumns: ['部門ID', '部門コード', '親部門ID'] });
    writeTable_(ss, CONFIG.SHEETS.POSITIONS, POSITIONS_HEADER, model.positionRows, { textColumns: ['役職ID', '役職コード'] });
    appendRows_(ss, CONFIG.SHEETS.CHANGES, CHANGES_HEADER, changes);

    if (props_().getProperty(PROP_KEYS.DEBUG_RAW) === 'true') {
      writeRawDebug_(ss, {
        groups_sample: rawGroups.slice(0, 3),
        positions_sample: rawPositions.slice(0, 3),
        employees_sample: rawEmployees.slice(0, 2),
        memberships_samples: rawMembershipSamples,
        employee_detail_sample: rawDetailSample,
      });
    }

    const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
    writeMeta_(ss, [
      ['最終同期', syncedAt],
      ['ステータス', warnings.length ? '成功（警告あり）' : '成功'],
      ['従業員数（在籍・出力対象）', model.stats.employees],
      ['所属レコード数（兼務含む）', model.stats.memberships],
      ['部門数', model.stats.groups],
      ['役職数', model.stats.positions],
      ['今回検知した変更件数', changes.length],
      ['処理時間（秒）', elapsedSec],
      ['freee取得件数（従業員一覧・退職者含む）', rawEmployees.length],
      ['警告', warnings.join(' / ')],
      ['company_id', getCompanyId_()],
    ]);

    if (changes.length) {
      notifySlack_(':office: *freee組織図 更新検知*（' + syncedAt + '）\n' + summarizeChanges(changes, 30)
        + '\n<' + ss.getUrl() + '|スプレッドシートを開く>');
    }
    Logger.log('同期完了: 従業員 ' + model.stats.employees + ' 名 / 部門 ' + model.stats.groups + ' / 変更 ' + changes.length + ' 件 / ' + elapsedSec + '秒');
    return model.stats;
  } catch (e) {
    const msg = String(e && e.stack ? e.stack : e);
    try {
      writeMeta_(ss, [
        ['最終同期（失敗）', syncedAt],
        ['ステータス', '失敗'],
        ['エラー', msg.slice(0, 5000)],
        ['company_id', getCompanyId_()],
      ]);
    } catch (ignore) { /* メタ書き込み失敗は握りつぶす */ }
    notifySlack_(':rotating_light: freee組織図の同期に失敗しました（' + syncedAt + '）\n```' + String(e).slice(0, 1500) + '```');
    throw e;
  }
}
