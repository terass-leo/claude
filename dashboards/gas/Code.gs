/**
 * ピカイチ採用 コンディションボード — Google Apps Script 版
 *
 * 採用管理スプレッドシートに紐づけて使う。スプシを開くと「ピカイチ採用」メニューが出る。
 * 数字はすべてシートから読むので、決定者を1行追加すればダッシュボードが最新化される。
 *
 * セットアップは README.md を参照。
 */

// ============================================================
// CONFIG — シート名と読み取り位置。自分のスプシに合わせて変えるのはここだけ。
// ============================================================
var CONFIG = {
  // 決定者マスタ（1候補者1行）。無ければメニューから作成できる。
  masterSheet: '決定者マスタ',

  // 月次ファネルの目標／実績が入っているシートと、C4ブロックの見出しセル。
  // 見出し行から「目標」「実績」の列ペアを自動検出するので、列がずれても追従する。
  funnelSheet: 'ピカイチファネル',
  funnelAnchor: '1. 情報数',   // このラベルを含む行を起点にブロックを探す

  // ファネルの指標行ラベル（前方一致で探す）
  funnelRows: {
    info:  '1. 情報数',
    itv:   '4. 面接数',
    offer: '6. 内定数',
    sign:  '8. 締結数'
  },

  // 選考中一覧（パイプライン）。フェーズ列は見出し名で探す。
  pipelineSheet: '選考中一覧',
  pipelinePhaseHeader: '採用フェーズ',
  pipelineNameHeader: '候補者指名',

  // 集計を書き出すシート（Looker Studio 等から参照する用）
  summarySheet: '集計_ピカイチ',

  fiscalStartMonth: 1,   // 事業年度の開始月。1 なら 1〜12月、4 なら 4〜翌3月
  wbBenchmark: 3.0,      // HC目標×この値を「参考目標WB」とする（ピカイチ基準）
  guaranteeCapRate: 0.66 // 保証額の上限率（66%ルール）
};

var TIERS = [
  { name: 'POP',       wb: 5.0, slot: 's4' },
  { name: 'ピカイチ',   wb: 3.0, slot: 's3' },
  { name: '準ピカイチ', wb: 2.0, slot: 's2' },
  { name: 'その他',     wb: 1.2, slot: 's1' }
];

var MASTER_HEADERS = [
  '氏名', '区分', '締結日', '参画予定日', '応募チャネル', '出身企業',
  'リファラル元', '売上期待値(万円)', '年収保証(万円)', '固定給計(万円)',
  'サインアップ(万円)', 'ステータス', '備考'
];

// ============================================================
// メニュー
// ============================================================
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('ピカイチ採用')
    .addItem('ダッシュボードを開く', 'showDashboard')
    .addSeparator()
    .addItem('集計シートを更新', 'writeSummarySheet')
    .addItem('決定者マスタを作成 / 初期化', 'setupMasterSheet')
    .addItem('設定を診断', 'diagnose')
    .addToUi();
}

/** スプシ内のモーダルでダッシュボードを表示 */
function showDashboard() {
  var html = renderDashboard_().setWidth(1400).setHeight(900);
  SpreadsheetApp.getUi().showModalDialog(html, 'ピカイチ採用 コンディションボード');
}

/** ウェブアプリとして公開する場合のエントリポイント */
function doGet() {
  return renderDashboard_()
    .setTitle('ピカイチ採用 コンディションボード')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function renderDashboard_() {
  var t = HtmlService.createTemplateFromFile('Dashboard');
  t.payload = JSON.stringify(buildSnapshot());
  return t.evaluate();
}

// ============================================================
// 集計 — ダッシュボードが必要とする値をすべてここで作る
// ============================================================
function buildSnapshot() {
  var decided = readMaster_();
  var funnel  = readFunnel_();
  var pipeline = readPipeline_();

  var live = decided.filter(function (d) { return d.counts; });

  var monthly = buildMonthly_(live, funnel);
  var totals  = buildTotals_(live, funnel, monthly);
  var mix     = buildMix_(live);
  var guarantee = buildGuarantee_(live);
  var joins   = buildJoins_(live);
  var alerts  = buildAlerts_(live, funnel, monthly, totals, mix, guarantee, joins);

  return {
    asOf: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy年M月d日'),
    monthLabels: monthLabels_(),
    currentMonthIndex: currentMonthIndex_(),
    monthly: monthly,
    totals: totals,
    funnel: funnel,
    mix: mix,
    guarantee: guarantee,
    joins: joins,
    pipeline: pipeline,
    alerts: alerts,
    config: { wbBenchmark: CONFIG.wbBenchmark, capRate: CONFIG.guaranteeCapRate },
    tiers: TIERS
  };
}

/** 決定者マスタを読む */
function readMaster_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(CONFIG.masterSheet);
  if (!sh) {
    throw new Error('「' + CONFIG.masterSheet + '」シートがありません。メニューの「決定者マスタを作成 / 初期化」を実行してください。');
  }
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return [];

  var head = values[0].map(function (v) { return String(v).trim(); });
  var col = {};
  head.forEach(function (h, i) { col[h] = i; });

  var out = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var name = String(row[col['氏名']] || '').trim();
    if (!name) continue;

    var tierName = String(row[col['区分']] || '').trim();
    var tier = tierByName_(tierName);
    var status = String(row[col['ステータス']] || '締結').trim();

    out.push({
      name: name,
      tier: tier ? tier.name : tierName,
      wb: tier ? tier.wb : 0,
      slot: tier ? tier.slot : 's1',
      signMonth: monthIndexOf_(row[col['締結日']]),
      signDate: fmtDate_(row[col['締結日']]),
      joinMonth: monthIndexOf_(row[col['参画予定日']]),
      joinLabel: fmtYm_(row[col['参画予定日']]),
      joinKey: fmtSortKey_(row[col['参画予定日']]),
      channel: String(row[col['応募チャネル']] || '未設定').trim(),
      origin: String(row[col['出身企業']] || '未設定').trim(),
      referrer: String(row[col['リファラル元']] || '').trim(),
      expect: num_(row[col['売上期待値(万円)']]),
      guarantee: num_(row[col['年収保証(万円)']]),
      fixed: num_(row[col['固定給計(万円)']]),
      signup: num_(row[col['サインアップ(万円)']]),
      status: status,
      // 締結後に辞退した行は HC / WB から外すが、承諾率の分母には残す
      counts: status.indexOf('辞退') === -1
    });
  }
  return out;
}

/**
 * ファネルの C4 ブロックを読む。
 * 「目標」「実績」ラベル行から列ペアを検出するので、列位置がずれても追従する。
 */
function readFunnel_() {
  var empty = { info: blankPairs_(), itv: blankPairs_(), offer: blankPairs_(), sign: blankPairs_(), found: false };
  var sh = SpreadsheetApp.getActive().getSheetByName(CONFIG.funnelSheet);
  if (!sh) return empty;

  var values = sh.getDataRange().getValues();

  // 「目標」「実績」が交互に並ぶラベル行を探す
  var labelRow = -1, pairs = null;
  for (var r = 0; r < Math.min(values.length, 40); r++) {
    var p = detectPairs_(values[r]);
    if (p.length >= 12) { labelRow = r; pairs = p.slice(0, 12); break; }
  }
  if (labelRow < 0) return empty;

  var result = { found: true };
  Object.keys(CONFIG.funnelRows).forEach(function (key) {
    var label = CONFIG.funnelRows[key];
    result[key] = readMetricRow_(values, labelRow, pairs, label);
  });
  return result;
}

function detectPairs_(row) {
  var pairs = [], pending = -1;
  for (var c = 0; c < row.length; c++) {
    var v = String(row[c]).trim();
    if (v === '目標') pending = c;
    else if (v === '実績' && pending >= 0) { pairs.push([pending, c]); pending = -1; }
  }
  return pairs;
}

function readMetricRow_(values, labelRow, pairs, label) {
  var key = normalize_(label);
  for (var r = labelRow; r < values.length; r++) {
    if (normalize_(values[r][0]).indexOf(key) === 0) {
      return pairs.map(function (pr) {
        return { target: num_(values[r][pr[0]]), actual: num_(values[r][pr[1]]) };
      });
    }
  }
  return blankPairs_();
}

/** 選考中一覧をフェーズ別に集計 */
function readPipeline_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(CONFIG.pipelineSheet);
  if (!sh) return { found: false, phases: [] };

  var values = sh.getDataRange().getValues();
  var headRow = -1, phaseCol = -1, nameCol = -1;
  for (var r = 0; r < Math.min(values.length, 40); r++) {
    for (var c = 0; c < values[r].length; c++) {
      var v = String(values[r][c]).trim();
      if (v === CONFIG.pipelinePhaseHeader) { headRow = r; phaseCol = c; }
      if (v === CONFIG.pipelineNameHeader) { nameCol = c; }
    }
    if (headRow >= 0) break;
  }
  if (headRow < 0) return { found: false, phases: [] };

  var buckets = {};
  for (var r2 = headRow + 1; r2 < values.length; r2++) {
    var phase = String(values[r2][phaseCol] || '').trim();
    if (!phase) continue;
    // 締結済・辞退は選考中ではない
    if (/締結|辞退/.test(phase)) continue;
    if (!buckets[phase]) buckets[phase] = [];
    if (nameCol >= 0) {
      var nm = String(values[r2][nameCol] || '').trim();
      if (nm) buckets[phase].push(nm);
    }
  }

  var phases = Object.keys(buckets).sort().map(function (k) {
    return {
      phase: k,
      count: buckets[k].length || 0,
      names: buckets[k],
      pending: /ペンディング|保留/.test(k)
    };
  });
  function tally(pending) {
    return phases.filter(function (p) { return p.pending === pending; })
                 .reduce(function (a, p) { return a + p.count; }, 0);
  }
  return { found: true, phases: phases, active: tally(false), pending: tally(true),
           total: tally(false) + tally(true) };
}

/** 月次の HC / WB / 区分別内訳 */
function buildMonthly_(live, funnel) {
  var rows = [];
  for (var m = 0; m < 12; m++) {
    var inMonth = live.filter(function (d) { return d.signMonth === m; });
    var hc = inMonth.length;
    var wb = inMonth.reduce(function (a, d) { return a + d.wb; }, 0);
    var byTier = {};
    TIERS.forEach(function (t) {
      byTier[t.name] = inMonth.filter(function (d) { return d.tier === t.name; }).length;
    });
    var hcTarget = funnel.sign[m] ? funnel.sign[m].target : 0;
    rows.push({
      month: m + 1,
      hcTarget: hcTarget,
      hc: hc,
      wb: round1_(wb),
      avgWb: hc ? round2_(wb / hc) : null,
      wbTarget: round1_(hcTarget * CONFIG.wbBenchmark),
      byTier: byTier,
      hasActual: hc > 0 || m <= currentMonthIndex_()
    });
  }
  return rows;
}

function buildTotals_(live, funnel, monthly) {
  var hc = live.length;
  var wb = live.reduce(function (a, d) { return a + d.wb; }, 0);
  var hcTarget = sum_(monthly.map(function (r) { return r.hcTarget; }));
  var wbTarget = hcTarget * CONFIG.wbBenchmark;

  var cur = currentMonthIndex_();
  var recent = monthly.filter(function (r) {
    return r.month - 1 <= cur && r.month - 1 > cur - 3 && r.hc > 0;
  });
  var rHc = sum_(recent.map(function (r) { return r.hc; }));
  var rWb = sum_(recent.map(function (r) { return r.wb; }));

  var half = halfSplit_(funnel, cur);

  return {
    hc: hc,
    hcTarget: hcTarget,
    hcRate: hcTarget ? Math.round(hc / hcTarget * 100) : null,
    wb: round1_(wb),
    wbTarget: round1_(wbTarget),
    wbRate: wbTarget ? Math.round(wb / wbTarget * 100) : null,
    avgWb: hc ? round2_(wb / hc) : null,
    recentAvgWb: rHc ? round2_(rWb / rHc) : null,
    half: half
  };
}

/** 上期／下期の進捗と時間進捗 */
function halfSplit_(funnel, cur) {
  function agg(metric, from, to) {
    var t = 0, a = 0;
    for (var m = from; m <= to; m++) { t += funnel[metric][m].target; a += funnel[metric][m].actual; }
    return { target: t, actual: a, rate: t ? Math.round(a / t * 1000) / 10 : null };
  }
  var isH2 = cur >= 6;
  var from = isH2 ? 6 : 0, to = isH2 ? 11 : 5;
  var elapsed = cur - from + 1;
  return {
    label: isH2 ? '下期' : '上期',
    elapsedRate: Math.round(elapsed / 6 * 1000) / 10,
    info: agg('info', from, to),
    itv: agg('itv', from, to),
    offer: agg('offer', from, to),
    sign: agg('sign', from, to)
  };
}

/** 区分・チャネル・出身企業の構成 */
function buildMix_(live) {
  function group(fn) {
    var m = {};
    live.forEach(function (d) { var k = fn(d) || '未設定'; m[k] = (m[k] || 0) + 1; });
    return Object.keys(m)
      .map(function (k) { return { key: k, count: m[k], share: round1_(m[k] / live.length * 100) }; })
      .sort(function (a, b) { return b.count - a.count; });
  }
  var tiers = TIERS.map(function (t) {
    var n = live.filter(function (d) { return d.tier === t.name; }).length;
    return { key: t.name, wb: t.wb, slot: t.slot, count: n, share: live.length ? round1_(n / live.length * 100) : 0 };
  });
  var origins = group(function (d) { return d.origin; });
  return {
    tiers: tiers,
    channels: group(function (d) { return d.channel; }),
    origins: origins,
    referrers: group(function (d) { return d.referrer || '—'; }),
    topOriginShare: origins.length ? origins[0].share : 0,
    topOriginName: origins.length ? origins[0].key : '—'
  };
}

/** 保証率 — コミット総額 ÷ 売上期待値。66%ルールの超過を判定 */
function buildGuarantee_(live) {
  var rows = live.map(function (d) {
    var commit = d.guarantee + d.fixed + d.signup;
    var rate = d.expect ? round1_(commit / d.expect * 100) : null;
    return {
      name: d.name, tier: d.tier, wb: d.wb,
      expect: d.expect, commit: commit, rate: rate,
      over: rate !== null && rate > CONFIG.guaranteeCapRate * 100,
      unknown: !d.expect
    };
  }).sort(function (a, b) { return (b.rate || -1) - (a.rate || -1); });

  var scoped = rows.filter(function (r) { return !r.unknown; });
  var commit = sum_(rows.map(function (r) { return r.commit; }));
  var expect = sum_(scoped.map(function (r) { return r.expect; }));

  return {
    rows: rows,
    commitTotal: commit,
    expectTotal: expect,
    portfolioRate: expect ? round1_(sum_(scoped.map(function (r) { return r.commit; })) / expect * 100) : null,
    headroom: expect ? Math.round(expect * CONFIG.guaranteeCapRate - sum_(scoped.map(function (r) { return r.commit; }))) : null,
    overCount: rows.filter(function (r) { return r.over; }).length,
    overNames: rows.filter(function (r) { return r.over; }).map(function (r) { return r.name; }),
    unknownNames: rows.filter(function (r) { return r.unknown; }).map(function (r) { return r.name; })
  };
}

/** 参画月の分布 */
function buildJoins_(live) {
  var m = {};
  live.forEach(function (d) {
    var k = d.joinKey || '9999-99';
    if (!m[k]) m[k] = { key: k, label: d.joinLabel || '未定', count: 0, names: [] };
    m[k].count++; m[k].names.push(d.name);
  });
  var rows = Object.keys(m).sort().map(function (k) { return m[k]; });
  var peak = rows.reduce(function (a, r) { return (!a || r.count > a.count) ? r : a; }, null);
  return { rows: rows, peak: peak };
}

/** 自動アラート — ルールで判定するので毎月手で書き直さなくてよい */
function buildAlerts_(live, funnel, monthly, totals, mix, guarantee, joins) {
  var a = [];
  var h = totals.half;

  if (h.info.rate !== null && h.info.rate < h.elapsedRate) {
    a.push({
      level: 'crit', title: '入口の失速',
      body: h.label + 'の情報数は ' + h.info.actual + '／' + h.info.target + '件（' + h.info.rate +
            '%）。時間進捗 ' + h.elapsedRate + '% を下回っており、リードタイムを踏まえると期末の締結が空くリスクがある。'
    });
  }
  if (totals.wbRate !== null && totals.hcRate !== null && totals.wbRate < 100 && totals.hcRate >= 100) {
    a.push({
      level: 'warn', title: '人数は達成・WBは未達',
      body: 'HC ' + totals.hc + '／' + totals.hcTarget + '名（' + totals.hcRate + '%）に対し WB は ' +
            totals.wb + '／' + totals.wbTarget + '（' + totals.wbRate + '%）。平均WB ' + totals.avgWb +
            ' で、ピカイチ基準 ' + CONFIG.wbBenchmark + ' を下回っている。'
    });
  }
  if (totals.recentAvgWb !== null && totals.avgWb !== null && totals.recentAvgWb < totals.avgWb) {
    a.push({
      level: 'warn', title: '単価ミックスの劣化',
      body: '直近3か月の平均WB ' + totals.recentAvgWb + ' が通期平均 ' + totals.avgWb + ' を下回る。件数が伸びても売上インパクトが積み上がりにくい。'
    });
  }
  if (guarantee.overCount > 0) {
    a.push({
      level: 'warn', title: '66%ルールの超過が ' + guarantee.overCount + '名',
      body: guarantee.overNames.join('・') + '。年収保証額まではテイクレート100%のため、超過分は本部利益を直接削る。'
    });
  }
  if (guarantee.unknownNames.length) {
    a.push({
      level: 'warn', title: '売上期待値の未登録が ' + guarantee.unknownNames.length + '名',
      body: guarantee.unknownNames.join('・') + ' は集客戦略シートに売上期待値がなく、保証率が算定できない。'
    });
  }
  if (mix.topOriginShare >= 70) {
    a.push({
      level: 'warn', title: '出身企業の集中',
      body: '決定者の ' + mix.topOriginShare + '% が「' + mix.topOriginName + '」出身。単一チャネルが枯れた時に入口が同時に止まる。'
    });
  }
  if (joins.peak && joins.peak.count >= 5) {
    a.push({
      level: 'warn', title: joins.peak.label + ' に参画が ' + joins.peak.count + '名集中',
      body: '集客戦略MTGと立ち上げ支援が同月に束ねられる。前月までに集客戦略MTGを終える必要がある。'
    });
  }
  if (!a.length) {
    a.push({ level: 'ok', title: '警戒すべき指標はなし', body: 'すべての判定ルールが基準内。' });
  }
  return a;
}

// ============================================================
// 集計シートの書き出し（Looker Studio 等から参照する用）
// ============================================================
function writeSummarySheet() {
  var s = buildSnapshot();
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(CONFIG.summarySheet);
  if (!sh) sh = ss.insertSheet(CONFIG.summarySheet);
  sh.clear();

  var rows = [['区分', '月', '指標', '値']];
  s.monthly.forEach(function (m) {
    rows.push(['月次', m.month, 'HC目標', m.hcTarget]);
    rows.push(['月次', m.month, 'HC実績', m.hc]);
    rows.push(['月次', m.month, 'WB実績', m.wb]);
    rows.push(['月次', m.month, '参考目標WB', m.wbTarget]);
    if (m.avgWb !== null) rows.push(['月次', m.month, '平均WB', m.avgWb]);
    TIERS.forEach(function (t) { rows.push(['月次区分', m.month, t.name, m.byTier[t.name]]); });
  });
  rows.push(['累計', '', 'HC実績', s.totals.hc]);
  rows.push(['累計', '', 'HC目標', s.totals.hcTarget]);
  rows.push(['累計', '', 'WB実績', s.totals.wb]);
  rows.push(['累計', '', '参考目標WB', s.totals.wbTarget]);
  rows.push(['累計', '', '平均WB', s.totals.avgWb]);
  rows.push(['累計', '', '直近3か月平均WB', s.totals.recentAvgWb]);
  rows.push(['投資', '', 'コミット総額(万円)', s.guarantee.commitTotal]);
  rows.push(['投資', '', 'ポートフォリオ保証率(%)', s.guarantee.portfolioRate]);
  rows.push(['投資', '', '66%超過人数', s.guarantee.overCount]);
  s.mix.tiers.forEach(function (t) { rows.push(['区分構成', '', t.key, t.count]); });
  s.mix.channels.forEach(function (c) { rows.push(['チャネル構成', '', c.key, c.count]); });

  sh.getRange(1, 1, rows.length, 4).setValues(rows);
  sh.getRange(1, 1, 1, 4).setFontWeight('bold');
  sh.setFrozenRows(1);
  sh.autoResizeColumns(1, 4);

  SpreadsheetApp.getActive().toast('集計シートを更新しました（' + (rows.length - 1) + '行）', 'ピカイチ採用', 5);
}

// ============================================================
// 決定者マスタの作成
// ============================================================
function setupMasterSheet() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(CONFIG.masterSheet);

  if (sh && sh.getLastRow() > 1) {
    var res = ui.alert('「' + CONFIG.masterSheet + '」には既にデータがあります。ヘッダーと入力規則だけ再設定しますか？（データは消しません）',
      ui.ButtonSet.YES_NO);
    if (res !== ui.Button.YES) return;
  }
  if (!sh) sh = ss.insertSheet(CONFIG.masterSheet);

  sh.getRange(1, 1, 1, MASTER_HEADERS.length).setValues([MASTER_HEADERS]).setFontWeight('bold');
  sh.setFrozenRows(1);

  var tierRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(TIERS.map(function (t) { return t.name; }), true)
    .setAllowInvalid(false).build();
  sh.getRange(2, 2, Math.max(sh.getMaxRows() - 1, 200), 1).setDataValidation(tierRule);

  var statusRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['締結', '辞退（締結後）'], true)
    .setAllowInvalid(false).build();
  sh.getRange(2, 12, Math.max(sh.getMaxRows() - 1, 200), 1).setDataValidation(statusRule);

  sh.getRange(2, 3, Math.max(sh.getMaxRows() - 1, 200), 2).setNumberFormat('yyyy/mm/dd');
  sh.getRange(2, 8, Math.max(sh.getMaxRows() - 1, 200), 4).setNumberFormat('#,##0');
  sh.autoResizeColumns(1, MASTER_HEADERS.length);

  ss.toast('決定者マスタを整えました。1候補者1行で入力してください。', 'ピカイチ採用', 6);
}

/** 設定が正しくシートを掴めているか確認する */
function diagnose() {
  var lines = [];
  var ss = SpreadsheetApp.getActive();

  [['決定者マスタ', CONFIG.masterSheet], ['ファネル', CONFIG.funnelSheet],
   ['選考中一覧', CONFIG.pipelineSheet]].forEach(function (pair) {
    var sh = ss.getSheetByName(pair[1]);
    lines.push((sh ? '○' : '×') + ' ' + pair[0] + '：' + pair[1] + (sh ? '（' + sh.getLastRow() + '行）' : ' — 見つかりません'));
  });

  try {
    var f = readFunnel_();
    lines.push(f.found ? '○ ファネルの目標／実績列ペアを検出' : '× ファネルの「目標」「実績」ラベル行が見つかりません');
    if (f.found) {
      lines.push('   締結 目標 = [' + f.sign.map(function (x) { return x.target; }).join(', ') + ']');
      lines.push('   締結 実績 = [' + f.sign.map(function (x) { return x.actual; }).join(', ') + ']');
    }
  } catch (e) { lines.push('× ファネル読み取りエラー：' + e.message); }

  try {
    var d = readMaster_();
    lines.push('○ 決定者マスタ ' + d.length + '行（HC対象 ' + d.filter(function (x) { return x.counts; }).length + '名）');
    var noTier = d.filter(function (x) { return !x.wb; });
    if (noTier.length) lines.push('   ! 区分が未設定：' + noTier.map(function (x) { return x.name; }).join('・'));
  } catch (e) { lines.push('× ' + e.message); }

  try {
    var p = readPipeline_();
    lines.push(p.found ? '○ 選考中 ' + p.total + '名（' + p.phases.length + 'フェーズ）'
                       : '× 選考中一覧の「' + CONFIG.pipelinePhaseHeader + '」列が見つかりません');
  } catch (e) { lines.push('× パイプライン読み取りエラー：' + e.message); }

  SpreadsheetApp.getUi().alert('設定の診断\n\n' + lines.join('\n'));
}

// ============================================================
// ユーティリティ
// ============================================================
function tierByName_(name) {
  for (var i = 0; i < TIERS.length; i++) if (TIERS[i].name === name) return TIERS[i];
  return null;
}

function monthIndexOf_(v) {
  var d = toDate_(v);
  return d ? d.getMonth() : -1;
}

function toDate_(v) {
  if (v instanceof Date) return v;
  if (!v) return null;
  var d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function fmtDate_(v) {
  var d = toDate_(v);
  return d ? Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy/MM/dd') : '';
}

/** 並び替え用のキー。年月を yyyy-MM で返す（未定は末尾に来るよう空を返す） */
function fmtSortKey_(v) {
  var d = toDate_(v);
  return d ? Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM') : '';
}

function fmtYm_(v) {
  var d = toDate_(v);
  return d ? Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy年M月') : '';
}

function currentMonthIndex_() { return new Date().getMonth(); }

function monthLabels_() {
  var out = [];
  for (var m = 1; m <= 12; m++) out.push(m + '月');
  return out;
}

function blankPairs_() {
  var out = [];
  for (var i = 0; i < 12; i++) out.push({ target: 0, actual: 0 });
  return out;
}

function num_(v) {
  if (v === '' || v === null || v === undefined) return 0;
  var n = Number(String(v).replace(/[¥,\s万円%]/g, ''));
  return isNaN(n) ? 0 : n;
}

function normalize_(v) {
  return String(v).replace(/[\s\\]/g, '').replace(/．/g, '.');
}

function sum_(arr) { return arr.reduce(function (a, b) { return a + (Number(b) || 0); }, 0); }
function round1_(n) { return Math.round(n * 10) / 10; }
function round2_(n) { return Math.round(n * 100) / 100; }
