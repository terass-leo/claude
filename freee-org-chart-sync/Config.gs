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
