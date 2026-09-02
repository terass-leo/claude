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
