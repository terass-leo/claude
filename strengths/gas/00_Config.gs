/**
 * 強み診断（Strengths Survey）— 全体設定
 *
 * Google Forms → Sheets → GAS採点 → Claude API レポート生成 を1本で動かすための設定値。
 * ここだけ触れば挙動を変えられるようにしてある。
 */
const CONFIG = {
  // ---- Claude API ----
  API_KEY_PROPERTY: 'ANTHROPIC_API_KEY', // スクリプトプロパティのキー名
  API_URL: 'https://api.anthropic.com/v1/messages',
  ANTHROPIC_VERSION: '2023-06-01',
  MODEL: 'claude-opus-5',
  EFFORT: 'medium',   // low / medium / high / xhigh / max。レポート文の質を上げたければ high
  MAX_TOKENS: 16000,
  // 安全性分類器がリクエストを断った場合に自動で代替モデルへ回すサーバー側フォールバック
  USE_SERVER_SIDE_FALLBACK: true,
  FALLBACK_BETA: 'server-side-fallback-2026-07-01',
  API_MAX_RETRY: 5,

  // ---- シート / フォーム ----
  FORM_TITLE: '強み診断サーベイ',
  FORM_DESCRIPTION:
    '所要時間は約10分です。60個の文について、ふだんの自分にどれくらいあてはまるかを直感で選んでください。\n' +
    '正解・不正解はありません。「こうありたい姿」ではなく「実際の自分」で答えるほど、結果の精度が上がります。\n' +
    '結果は本人へのフィードバックと業務アサインの参考に使い、人事評価・選考には使用しません。',
  SHEET_ITEMS: '設問マスタ',
  SHEET_RESULTS: '結果',
  SHEET_LOG: '実行ログ',

  // ---- レポート ----
  REPORT_FOLDER_NAME: '強み診断レポート',
  SHARE_REPORT_WITH_RESPONDENT: false, // true にすると本人にDocの閲覧権限を付与
  TOP_N: 5,          // 上位いくつを「強み」として提示するか
  BOTTOM_N: 3,       // 下位いくつを「相対的に控えめな面」として扱うか

  // ---- 採点 ----
  SCALE_MIN: 1,
  SCALE_MAX: 5,
  NORM_MIN_N: 10,        // 全社比較（偏差値的なZ）を出し始める最低人数
  STRAIGHTLINE_SD: 0.30, // 全項目の標準偏差がこれ未満なら「同じ選択肢ばかり」フラグ
  INCONSISTENCY_GAP: 2.0, // 順項目と逆転項目の平均差がこれ以上のテーマ数を数える

  // ---- 実行制御 ----
  MAX_RUNTIME_MS: 4.5 * 60 * 1000, // GASの6分制限に対する安全マージン
};

/** 5段階スケールのラベル（フォーム表示用） */
const SCALE_LABELS = {
  low: '全くあてはまらない',
  high: '非常にあてはまる',
};
