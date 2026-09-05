/**
 * 初期セットアップ — フォーム生成・シート整備・トリガー登録
 *
 * このスクリプトはスプレッドシートにバインドして使う（拡張機能 → Apps Script）。
 * setup() を1回実行すれば、フォーム作成から回答受信時の自動採点まで一式が立ち上がる。
 */

/** 結果シートの見出し行を組み立てる */
function resultHeaders_() {
  return ['タイムスタンプ', '氏名', 'メール', '部署・チーム']
    .concat(THEMES.map((t) => `${t.name}_素点`))
    .concat(THEMES.map((t) => `${t.name}_Z`))
    .concat(['順位(1位→12位)', `Top${CONFIG.TOP_N}`, '回答品質フラグ', 'レポートURL', '生成日時', '状態']);
}

/** 初期セットアップ本体。メニューまたはエディタから手動実行する */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('スプレッドシートにバインドされたスクリプトとして実行してください。');

  const form = createSurveyForm_(ss);
  writeItemMaster_(ss);
  ensureSheetWithHeaders_(ss, CONFIG.SHEET_RESULTS, resultHeaders_());
  ensureSheetWithHeaders_(ss, CONFIG.SHEET_LOG, ['日時', '種別', '対象', 'メッセージ']);
  installTrigger_(ss);

  const url = form.getPublishedUrl();
  log_('SETUP', '-', `フォーム作成: ${url}`);
  SpreadsheetApp.getUi().alert(
    'セットアップ完了',
    ['回答用フォームURL:', url, '',
     '次にやること:',
     '1. プロジェクトの設定 → スクリプト プロパティ に ANTHROPIC_API_KEY を登録',
     '2. メニュー「強み診断」→「セルフテスト」で採点ロジックを確認',
     '3. フォームURLを配布'].join('\n'),
    SpreadsheetApp.getUi().ButtonSet.OK
  );
  return url;
}

/** 60項目のフォームを生成し、回答先をこのスプレッドシートに設定する */
function createSurveyForm_(ss) {
  const form = FormApp.create(CONFIG.FORM_TITLE);
  form.setDescription(CONFIG.FORM_DESCRIPTION);
  form.setProgressBar(true);
  form.setShowLinkToRespondAgain(false);

  // 社内利用を想定しメールを自動収集する。組織設定で使えない場合は氏名で突き合わせる。
  try {
    form.setCollectEmail(true);
  } catch (err) {
    log_('SETUP', '-', `メール自動収集を有効化できませんでした: ${err.message}`);
  }

  form.addTextItem().setTitle('氏名').setRequired(true);
  form.addTextItem().setTitle('部署・チーム').setRequired(false);

  form.addSectionHeaderItem()
    .setTitle('設問（全60問）')
    .setHelpText(`1 = ${SCALE_LABELS.low} / 5 = ${SCALE_LABELS.high}　深く考え込まず、直感で選んでください。`);

  getOrderedItems().forEach((item) => {
    form.addScaleItem()
      .setTitle(item.text)
      .setBounds(CONFIG.SCALE_MIN, CONFIG.SCALE_MAX)
      .setLabels(SCALE_LABELS.low, SCALE_LABELS.high)
      .setRequired(true);
  });

  form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());
  PropertiesService.getScriptProperties().setProperty('FORM_ID', form.getId());
  return form;
}

/** 設問マスタシートを書き出す（採点の監査用。ここを編集しても採点には影響しない） */
function writeItemMaster_(ss) {
  const sheet = ensureSheetWithHeaders_(
    ss, CONFIG.SHEET_ITEMS,
    ['出題順', '設問ID', 'テーマID', 'テーマ名', '領域', '逆転項目', '設問文']
  );
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).clearContent();
  }
  const rows = getOrderedItems().map((item, i) => {
    const t = getTheme(item.themeId);
    return [i + 1, item.id, t.id, t.name, t.domain, item.reverse ? '○' : '', item.text];
  });
  sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
  sheet.setFrozenRows(1);
  return sheet;
}

/** 指定名のシートを（なければ作って）見出し付きで返す */
function ensureSheetWithHeaders_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  const current = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0];
  if (normalizeText_(current.join('|')) !== normalizeText_(headers.join('|'))) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  sheet.setFrozenRows(1);
  return sheet;
}

/** 回答受信トリガーを（重複しないように）登録する */
function installTrigger_(ss) {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'onFormSubmitHandler')
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('onFormSubmitHandler').forSpreadsheet(ss).onFormSubmit().create();
}

/** フォームの回答が流れ込んでいるシートを返す */
function getResponseSheet_(ss) {
  const sheet = ss.getSheets().find((s) => {
    try { return !!s.getFormUrl(); } catch (e) { return false; }
  });
  if (!sheet) throw new Error('フォームの回答シートが見つかりません。先に setup() を実行してください。');
  return sheet;
}

/** 実行ログを1行追記する */
function log_(kind, target, message) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(CONFIG.SHEET_LOG) ||
      ensureSheetWithHeaders_(ss, CONFIG.SHEET_LOG, ['日時', '種別', '対象', 'メッセージ']);
    sheet.appendRow([new Date(), kind, target, message]);
  } catch (e) {
    console.log(`[${kind}] ${target}: ${message}`);
  }
}
