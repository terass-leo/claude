/**
 * 実行フロー — 回答受信 → 採点 → レポート生成 → 結果シート書き込み
 */

/** スプレッドシートを開いたときにメニューを追加する */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('強み診断')
    .addItem('① 初期セットアップ（フォーム作成）', 'setup')
    .addItem('② 未処理の回答を採点・レポート生成', 'processResponses')
    .addSeparator()
    .addItem('選択行のレポートを作り直す', 'regenerateSelected')
    .addItem('全社比較シートを更新する', 'writeCohortSheet')
    .addItem('セルフテスト（API不要）', 'runSelfTest')
    .addItem('Claude API 接続テスト', 'testClaudeConnection')
    .addToUi();
}

/** フォーム送信トリガーのハンドラ */
function onFormSubmitHandler() {
  try {
    processResponses();
  } catch (err) {
    log_('ERROR', 'onFormSubmit', err.message);
    throw err;
  }
}

/** 見出しの中から候補語を含む列の位置（0始まり）を返す。見つからなければ -1 */
function findCol_(headers, candidates) {
  for (let i = 0; i < headers.length; i += 1) {
    const h = normalizeText_(headers[i]);
    if (candidates.some((c) => h.indexOf(normalizeText_(c)) === 0 || h === normalizeText_(c))) return i;
  }
  return -1;
}

/** 回答1行を一意に識別するキー */
function responseKey_(timestamp, name) {
  const ts = timestamp instanceof Date
    ? Utilities.formatDate(timestamp, Session.getScriptTimeZone() || 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss')
    : String(timestamp);
  return `${ts}|${String(name).trim()}`;
}

/** 結果シートに既に載っているキーの集合 */
function processedKeys_(resultSheet) {
  const last = resultSheet.getLastRow();
  const set = {};
  if (last < 2) return set;
  const rows = resultSheet.getRange(2, 1, last - 1, 2).getValues();
  rows.forEach((r) => { set[responseKey_(r[0], r[1])] = true; });
  return set;
}

/**
 * 未処理の回答をまとめて処理する。
 * GASの実行時間制限に当たらないよう、時間切れが近づいたら中断して次回に回す。
 */
function processResponses() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const responseSheet = getResponseSheet_(ss);
  const resultSheet = ensureSheetWithHeaders_(ss, CONFIG.SHEET_RESULTS, resultHeaders_());

  const lastRow = responseSheet.getLastRow();
  if (lastRow < 2) {
    log_('RUN', '-', '未処理の回答はありません。');
    return 0;
  }

  const values = responseSheet.getRange(1, 1, lastRow, responseSheet.getLastColumn()).getValues();
  const headers = values[0];
  const { map, missing } = buildHeaderMap_(headers);
  if (missing.length) {
    throw new Error(
      `回答シートの見出しと設問マスタが一致しません（${missing.length}件）。` +
      `フォームの設問文を編集した可能性があります。\n未検出: ${missing.slice(0, 3).join(' / ')}`
    );
  }

  const colName = findCol_(headers, ['氏名', 'お名前']);
  const colDept = findCol_(headers, ['部署・チーム', '部署']);
  const colMail = findCol_(headers, ['メールアドレス', 'メール', 'Email']);
  if (colName < 0) throw new Error('回答シートに「氏名」列が見つかりません。');

  const done = processedKeys_(resultSheet);
  const startedAt = Date.now();
  let processed = 0;

  for (let r = 1; r < values.length; r += 1) {
    if (Date.now() - startedAt > CONFIG.MAX_RUNTIME_MS) {
      log_('RUN', '-', `実行時間の上限に達したため中断しました（${processed}件処理済み）。再度「未処理の回答を採点」を実行してください。`);
      break;
    }

    const row = values[r];
    const name = String(row[colName] || '').trim();
    if (!name) continue;
    const key = responseKey_(row[0], name);
    if (done[key]) continue;

    const answers = {};
    Object.keys(map).forEach((idx) => {
      answers[map[idx].id] = row[Number(idx)];
    });

    const profile = {
      name: name,
      dept: colDept >= 0 ? String(row[colDept] || '').trim() : '',
      email: colMail >= 0 ? String(row[colMail] || '').trim() : '',
      result: scoreAnswers(answers),
    };

    let reportUrl = '';
    let status = '完了';
    try {
      const markdown = generateReportText(profile);
      reportUrl = createReportDoc_(profile, markdown);
    } catch (err) {
      status = `エラー: ${err.message}`.slice(0, 200);
      log_('ERROR', name, err.message);
    }

    resultSheet.appendRow(buildResultRow_(row[0], profile, reportUrl, status));
    done[key] = true;
    processed += 1;
    log_('RUN', name, status);
  }

  log_('RUN', '-', `${processed}件を処理しました。`);
  return processed;
}

/** 結果シート1行分の配列を組み立てる */
function buildResultRow_(timestamp, profile, reportUrl, status) {
  const res = profile.result;
  return [timestamp, profile.name, profile.email, profile.dept]
    .concat(THEMES.map((t) => round2_(res.themeScores[t.id])))
    .concat(THEMES.map((t) => round2_(res.themeZ[t.id])))
    .concat([
      res.ranking.map((x) => x.name).join(' > '),
      res.top.map((x) => x.name).join('、'),
      res.flags.join(' / '),
      reportUrl,
      new Date(),
      status,
    ]);
}

/**
 * 結果シートで選択した行を削除し、未処理状態に戻してから再生成する。
 * 生成文だけを差し替えたいとき（プロンプト調整後など）に使う。
 */
function regenerateSelected() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getActiveSheet();
  const ui = SpreadsheetApp.getUi();
  if (sheet.getName() !== CONFIG.SHEET_RESULTS) {
    ui.alert(`「${CONFIG.SHEET_RESULTS}」シートで対象行を選択してから実行してください。`);
    return;
  }
  const ranges = sheet.getActiveRangeList().getRanges();
  const rows = [];
  ranges.forEach((rg) => {
    for (let i = 0; i < rg.getNumRows(); i += 1) {
      const r = rg.getRow() + i;
      if (r >= 2) rows.push(r);
    }
  });
  if (!rows.length) {
    ui.alert('再生成する行を選択してください。');
    return;
  }
  rows.sort((a, b) => b - a).forEach((r) => sheet.deleteRow(r));
  const n = processResponses();
  ui.alert(`${n}件のレポートを再生成しました。`);
}

/**
 * 全社比較シートを更新する。
 * 個人内Zが「本人の中での順位」なのに対し、こちらは「全社の中での位置」を見るための集計。
 * 回答者が CONFIG.NORM_MIN_N 人に満たないうちは出力しない。
 */
function writeCohortSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const resultSheet = ss.getSheetByName(CONFIG.SHEET_RESULTS);
  const ui = SpreadsheetApp.getUi();
  if (!resultSheet || resultSheet.getLastRow() < 2) {
    ui.alert('結果がまだありません。');
    return;
  }
  const rows = resultSheet.getRange(2, 1, resultSheet.getLastRow() - 1, resultSheet.getLastColumn()).getValues();
  const base = 4; // A〜D の後ろからテーマ素点が始まる
  const cohort = rows.map((r) => {
    const o = {};
    THEMES.forEach((t, i) => { o[t.id] = Number(r[base + i]); });
    return o;
  });

  if (cohort.length < CONFIG.NORM_MIN_N) {
    ui.alert(`全社比較は回答者が${CONFIG.NORM_MIN_N}人以上になってから出力されます（現在${cohort.length}人）。`);
    return;
  }

  const sheet = ensureSheetWithHeaders_(
    ss, '全社比較',
    ['氏名', '部署・チーム'].concat(THEMES.map((t) => `${t.name}_全社Z`))
  );
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).clearContent();
  }
  const out = rows.map((r, i) => {
    const z = cohortZ(cohort[i], cohort);
    return [r[1], r[3]].concat(THEMES.map((t) => round2_(z[t.id])));
  });
  sheet.getRange(2, 1, out.length, out[0].length).setValues(out);
  ui.alert(`全社比較シートを更新しました（${out.length}人）。`);
}
