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
