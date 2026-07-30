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

  // 既存の進捗管理シートを流用する場合に、月次ファネルの C4 ブロックを読むシート名。
  // 見出し行から「目標」「実績」の列ペアを自動検出するので、列がずれても追従する。
  // 新しいスプレッドシートで始める場合はこのシートが無くてよく、下の targetSheet を読む。
  funnelSheet: 'ピカイチファネル',
  funnelAnchor: '1. 情報数',   // このラベルを含む行を起点にブロックを探す

  // ファネルの指標行ラベル（前方一致で探す）
  funnelRows: {
    info:  '1. 情報数',
    itv:   '4. 面接数',
    offer: '6. 内定数',
    sign:  '8. 締結数'
  },

  // 選考中一覧（パイプライン）。各列は見出し名で探すので列順は自由。
  pipelineSheet: '選考中一覧',
  pipelinePhaseHeader: '採用フェーズ',
  pipelineNameHeader: '候補者指名',
  pipelineConfidenceHeader: '確度',

  // ファネルの C4 ブロックが見つからない場合に読む、シンプルな月次目標シート。
  // 新規スプレッドシートでは最初からこちらを使えばよい。
  targetSheet: '月次目標',

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

// 月次目標シートの行ラベル（＋「目標」「実績」）
var TARGET_ROWS = { info: '情報数', itv: '面接数', offer: '内定数', sign: '締結数' };

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
    .addItem('初期セットアップ（最初に1回）', 'bootstrap')
    .addItem('集計シートを更新', 'writeSummarySheet')
    .addItem('設定を診断', 'diagnose')
    .addSeparator()
    .addSubMenu(SpreadsheetApp.getUi().createMenu('シート操作')
      .addItem('決定者マスタを作成 / 初期化', 'setupMasterSheet')
      .addItem('決定者の初期データを投入', 'seedMasterSheet')
      .addItem('月次目標シートを作成', 'createTargetSheet')
      .addItem('選考中一覧を作成 / 投入', 'createPipelineSheet'))
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

  // 締結の実績はマスタが唯一の正。シート側の値は参照しない
  // （ここを一本化しないと、締結後辞退の扱いでファネルと HC がずれる）
  monthly.forEach(function (m, i) { funnel.sign[i].actual = m.hc; });

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
  var sh = SpreadsheetApp.getActive().getSheetByName(CONFIG.funnelSheet);
  if (sh) {
    var values = sh.getDataRange().getValues();

    // 「目標」「実績」が交互に並ぶラベル行を探す
    var labelRow = -1, pairs = null;
    for (var r = 0; r < Math.min(values.length, 40); r++) {
      var p = detectPairs_(values[r]);
      if (p.length >= 12) { labelRow = r; pairs = p.slice(0, 12); break; }
    }
    if (labelRow >= 0) {
      var result = { found: true, source: CONFIG.funnelSheet };
      Object.keys(CONFIG.funnelRows).forEach(function (key) {
        result[key] = readMetricRow_(values, labelRow, pairs, CONFIG.funnelRows[key]);
      });
      return result;
    }
  }
  // C4 ブロックが無ければシンプルな月次目標シートを読む
  return readTargetSheet_();
}

/**
 * 月次目標シート（指標 × 1〜12月）を読む。
 * 行ラベルは「情報数 目標」「情報数 実績」のように 指標＋区分 で書く。
 * 締結数の実績はマスタから算出するので入力不要。
 */
function readTargetSheet_() {
  var empty = { info: blankPairs_(), itv: blankPairs_(), offer: blankPairs_(),
                sign: blankPairs_(), found: false, source: null };
  var sh = SpreadsheetApp.getActive().getSheetByName(CONFIG.targetSheet);
  if (!sh || sh.getLastRow() < 2) return empty;

  var values = sh.getDataRange().getValues();
  var result = { found: true, source: CONFIG.targetSheet };

  Object.keys(TARGET_ROWS).forEach(function (key) {
    var name = TARGET_ROWS[key];
    result[key] = blankPairs_();
    ['目標', '実績'].forEach(function (kind) {
      var want = normalize_(name + kind);
      for (var r = 1; r < values.length; r++) {
        if (normalize_(values[r][0]) !== want) continue;
        for (var m = 0; m < 12; m++) {
          result[key][m][kind === '目標' ? 'target' : 'actual'] = num_(values[r][m + 1]);
        }
        break;
      }
    });
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

/** 選考中一覧をフェーズ別に集計。確度も拾う */
function readPipeline_() {
  var empty = { found: false, phases: [], active: 0, pending: 0, total: 0, high: 0 };
  var sh = SpreadsheetApp.getActive().getSheetByName(CONFIG.pipelineSheet);
  if (!sh) return empty;

  var values = sh.getDataRange().getValues();
  var headRow = -1, phaseCol = -1, nameCol = -1, confCol = -1;
  for (var r = 0; r < Math.min(values.length, 40); r++) {
    for (var c = 0; c < values[r].length; c++) {
      var v = String(values[r][c]).trim();
      if (v === CONFIG.pipelinePhaseHeader) { headRow = r; phaseCol = c; }
      if (v === CONFIG.pipelineNameHeader) nameCol = c;
      // 「採用確度」のような表記ゆれも拾えるよう部分一致にする
      if (confCol < 0 && v.indexOf(CONFIG.pipelineConfidenceHeader) >= 0) confCol = c;
    }
    if (headRow >= 0) break;
  }
  if (headRow < 0) return empty;

  var buckets = {};
  for (var r2 = headRow + 1; r2 < values.length; r2++) {
    var phase = String(values[r2][phaseCol] || '').trim();
    if (!phase) continue;
    if (/締結|辞退/.test(phase)) continue;   // 締結済・辞退は選考中ではない
    if (!buckets[phase]) buckets[phase] = [];
    var nm = nameCol >= 0 ? String(values[r2][nameCol] || '').trim() : '';
    if (!nm) continue;
    buckets[phase].push({
      name: nm,
      confidence: confCol >= 0 ? String(values[r2][confCol] || '').trim() : ''
    });
  }

  var phases = Object.keys(buckets).sort().map(function (k) {
    var rows = buckets[k];
    return {
      phase: k,
      count: rows.length,
      rows: rows,
      names: rows.map(function (x) { return x.name; }),
      high: rows.filter(function (x) { return /高/.test(x.confidence); }).length,
      pending: /ペンディング|保留/.test(k)
    };
  });
  function tally(pending) {
    return phases.filter(function (p) { return p.pending === pending; })
                 .reduce(function (a, p) { return a + p.count; }, 0);
  }
  return {
    found: true, phases: phases,
    active: tally(false), pending: tally(true), total: tally(false) + tally(true),
    high: phases.reduce(function (a, p) { return a + (p.pending ? 0 : p.high); }, 0)
  };
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
// 初期データ — 2026年7月30日時点の決定者。bootstrap / seedMasterSheet で投入する。
// 締結日は Salesforce の ContractConclusionDate、金額は万円。
// ============================================================
var SEED_DECIDED = [
  ['小田 俊介', 'ピカイチ',   '2026/03/05', '2026/05/01', 'リストマッチ', 'REDS',                 '大河原さん',     3300, 1500,   0,   0, '締結', ''],
  ['藤岡 将也', 'ピカイチ',   '2026/03/07', '2026/05/01', 'リストマッチ', '住友不動産販売',       '鈴木英徳さん',   2400, 1400, 120,   0, '締結', '固定給 30万×4か月'],
  ['吉川 航二', 'ピカイチ',   '2026/04/01', '2026/09/01', 'リストマッチ', '住友不動産販売',       '大河原さん',     3000, 1500,   0,   0, '締結', ''],
  ['藤崎 常博', '準ピカイチ', '2026/05/06', '2026/10/01', '直接応募',     '住友不動産販売',       '',               2400, 1700,   0,   0, '締結', ''],
  ['田邊 柚樹', 'ピカイチ',   '2026/05/23', '2026/08/01', 'リストマッチ', '住友不動産販売',       '谷津さん',       2400, 2000,   0,   0, '締結', ''],
  ['塚越 翔太', 'ピカイチ',   '2026/05/27', '2026/09/01', 'リファラル',   '住友不動産販売',       '重道さん',       2400, 1500,   0,   0, '締結', ''],
  ['常光 孝博', '準ピカイチ', '2026/05/27', '2026/09/01', 'リストマッチ', '東宝ハウス',           '福田さん',       2400, 1200,   0,   0, '締結', ''],
  ['鳥越 篤',   'その他',     '2026/05/30', '2026/09/01', 'リストマッチ', '住友不動産販売',       '岡部さん',       2100,    0, 150,   0, '締結', '固定給 25万×6か月'],
  ['鈴木 碧',   '準ピカイチ', '2026/06/23', '',           'リストマッチ', '三菱UFJ不動産販売',    '谷津さん',          0,    0,   0,   0, '辞退（締結後）', '配偶者の反対。次回接点 2026/10/14'],
  ['小畑 慧伍', 'ピカイチ',   '2026/06/30', '2026/09/01', 'リストマッチ', '住友不動産販売',       '谷津さん',       2400, 1800,   0,   0, '締結', ''],
  ['中川 雅史', 'ピカイチ',   '2026/07/01', '2026/08/01', 'リストマッチ', '住友不動産販売',       '鈴木さん',       3000, 2000,   0, 200, '締結', 'サインアップ 200万'],
  ['西野 大智', '準ピカイチ', '2026/07/02', '2026/09/01', 'リストマッチ', '住友不動産販売',       '谷津さん',       2400, 1100,   0,   0, '締結', ''],
  ['岡田 雅美', 'ピカイチ',   '2026/07/07', '2026/08/01', 'リストマッチ', '住友不動産販売',       '',               4200,    0,   0,   0, '締結', '保証なし'],
  ['池田 悠真', '準ピカイチ', '2026/07/15', '2026/08/01', 'リストマッチ', '住友不動産販売',       '谷津さん',       2400,    0, 120,   0, '締結', '固定給 30万×4か月'],
  ['吉村 剣郎', 'その他',     '2026/07/14', '2026/09/01', 'リストマッチ', '住友不動産販売',       '谷津さん',       2100, 1000,   0,   0, '締結', ''],
  ['安彦 詠太', 'ピカイチ',   '2026/07/27', '2026/09/01', 'リストマッチ', '住友不動産販売',       '鈴木英徳さん',      0, 1900,   0,   0, '締結', '売上期待値が未登録']
];

// 月次目標（FY2026）。既存のファネルシートを読めない場合に月次目標シートへ書き込む。
var SEED_TARGETS = {
  '情報数 目標': [1, 2, 3, 2, 2, 3, 4, 2, 2, 4, 4, 5],
  '情報数 実績': [1, 5, 6, 5, 4, 3, 2, 0, 0, 0, 0, 0],
  '面接数 目標': [1, 1, 2, 2, 1, 1, 3, 2, 1, 3, 2, 2],
  '面接数 実績': [2, 4, 4, 0, 2, 6, 1, 0, 0, 0, 0, 0],
  '内定数 目標': [0, 2, 1, 2, 1, 0, 3, 2, 1, 3, 2, 2],
  '内定数 実績': [2, 4, 4, 0, 2, 6, 1, 0, 0, 0, 0, 0],
  '締結数 目標': [0, 0, 2, 1, 1, 0, 3, 2, 1, 2, 1, 1],
  '締結数 実績': [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
};

// 選考中の候補者（2026/07/30時点）。確度は「1.高 / 2.中 / 3.低」で入れる。
var SEED_PIPELINE = [
  ['徳久 雄一郎',   '住友不動産販売',                 'ピカイチ経路', '大河原さん',                 '05 内定承諾見込み', '2.中', '10/1参画予定。保証2,300万円想定'],
  ['小原澤 健太',   '東急リバブル',                   'ピカイチ経路', '大山さんからの紹介の紹介',   '04 オファー面談',   '1.高', '会食実施済'],
  ['山本 貴之',     '東急リバブル',                   'ピカイチ経路', '小原澤さんからの紹介',       '04 オファー面談',   '2.中', '会食実施済'],
  ['関さん',         '令和地所',                       'ピカイチ経路', '吉田さん',                   '04 オファー面談',   '2.中', ''],
  ['木崎 在',       '住友不動産販売',                 'ピカイチ経路', '鈴木さん',                   '04 オファー面談',   '2.中', ''],
  ['髙橋 寛臣',     '住友不動産販売',                 'ピカイチ経路', '西野さん',                   '04 オファー面談',   '2.中', ''],
  ['飯塚 将平',     '東宝ハウス',                     'ピカイチ経路', '常光さん',                   '04 オファー面談',   '',     '東宝ハウス経路の2人目'],
  ['山村 政裕',     '野村ソリューションズ',           'その他',       'あゆみ名刺',                 '04 オファー面談',   '3.低', ''],
  ['加藤 雄也',     'モダンスタンダード',             'その他',       '通常採用から送客',           '03 最終面接',       '3.低', '年収保証の面接を実施予定'],
  ['小林 孝明',     '住友不動産販売',                 '自社サイト',   '',                           '02 一次面接',       '3.低', ''],
  ['野上 裕行',     '住友不動産販売',                 'ピカイチ経路', '岡部さん',                   '02 一次面接',       '3.低', ''],
  ['永野 正太郎',   '住友不動産販売',                 'ピカイチ経路', '根上さん',                   '09 ペンディング',   '3.低', '山元が一度カジュアル面談'],
  ['渡邊さん',       '住友不動産販売',                 'ピカイチ経路', '大河原さん',                 '09 ペンディング',   '3.低', '大河原さんフォロー中'],
  ['守屋 裕章',     '東急リバブル',                   'ピカイチ経路', '大山さん',                   '09 ペンディング',   '3.低', '住宅購入を検討中で当面動けない'],
  ['久保 恵亮',     '株式会社パワーコンサルティングワークス', 'ピカイチ経路', '李さん',            '09 ペンディング',   '2.中', '']
];

var PIPELINE_HEADERS = ['候補者指名', '現職', '応募経路', '紹介者', '採用フェーズ', '確度', 'メモ'];

/**
 * 貼り付け直後の1回だけ実行する。
 * 決定者マスタ → 初期データ → 月次目標シート → 診断 をまとめて行う。
 */
function bootstrap() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.alert('ピカイチ採用ボードの初期セットアップ',
    '次を行います。\n\n' +
    '・「' + CONFIG.masterSheet + '」を作成し、2026年7月30日時点の決定者16行を投入\n' +
    '・「' + CONFIG.funnelSheet + '」が無い場合は「' + CONFIG.targetSheet + '」を作成して月次目標を投入\n' +
    '・設定を診断\n\n既にあるデータは消しません。よろしいですか？',
    ui.ButtonSet.OK_CANCEL);
  if (res !== ui.Button.OK) return;

  setupMasterSheet(true);
  var added = seedMasterSheet(true);

  var ss = SpreadsheetApp.getActive();
  var made = [];
  if (!ss.getSheetByName(CONFIG.funnelSheet)) { createTargetSheet(true); made.push(CONFIG.targetSheet); }
  if (!ss.getSheetByName(CONFIG.pipelineSheet)) { createPipelineSheet(true); made.push(CONFIG.pipelineSheet); }

  ss.toast('決定者 ' + added + '行を投入しました。' +
           (made.length ? made.join('・') + ' も作成しました。' : ''),
           'セットアップ完了', 8);
  diagnose();
}

/** 決定者マスタに初期データを投入する。氏名が既にある行はスキップするので何度実行してもよい */
function seedMasterSheet(silent) {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(CONFIG.masterSheet);
  if (!sh) { setupMasterSheet(true); sh = ss.getSheetByName(CONFIG.masterSheet); }

  var existing = {};
  if (sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().forEach(function (r) {
      var n = String(r[0]).trim();
      if (n) existing[n] = true;
    });
  }

  var rows = SEED_DECIDED.filter(function (r) { return !existing[r[0]]; })
    .map(function (r) {
      var c = r.slice();
      c[2] = c[2] ? new Date(c[2]) : '';
      c[3] = c[3] ? new Date(c[3]) : '';
      return c;
    });

  if (rows.length) {
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, MASTER_HEADERS.length).setValues(rows);
    sh.getRange(2, 3, sh.getLastRow() - 1, 2).setNumberFormat('yyyy/mm/dd');
    sh.autoResizeColumns(1, MASTER_HEADERS.length);
  }
  if (!silent) {
    ss.toast(rows.length ? rows.length + '行を追加しました。' : '追加する行はありませんでした（すべて登録済み）。',
             'ピカイチ採用', 5);
  }
  return rows.length;
}

/** 選考中一覧シートを作り、現在の選考中候補者を投入する */
function createPipelineSheet(silent) {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(CONFIG.pipelineSheet);
  if (!sh) sh = ss.insertSheet(CONFIG.pipelineSheet);

  var existing = {};
  if (sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().forEach(function (r) {
      var n = String(r[0]).trim();
      if (n) existing[n] = true;
    });
  } else {
    sh.getRange(1, 1, 1, PIPELINE_HEADERS.length).setValues([PIPELINE_HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }

  var rows = SEED_PIPELINE.filter(function (r) { return !existing[r[0]]; });
  if (rows.length) {
    sh.getRange(Math.max(sh.getLastRow() + 1, 2), 1, rows.length, PIPELINE_HEADERS.length).setValues(rows);
    sh.autoResizeColumns(1, PIPELINE_HEADERS.length);
  }
  if (!silent) ss.toast(rows.length + '行を投入しました。', 'ピカイチ採用', 5);
  return rows.length;
}

/** 月次目標シートを作る。既存のファネルシートを読める場合は不要 */
function createTargetSheet(silent) {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(CONFIG.targetSheet);
  if (!sh) sh = ss.insertSheet(CONFIG.targetSheet);

  var header = ['指標'];
  for (var m = 1; m <= 12; m++) header.push(m + '月');
  var rows = [header];
  Object.keys(SEED_TARGETS).forEach(function (k) {
    rows.push([k].concat(SEED_TARGETS[k]));
  });
  rows.push([]);
  rows.push(['※ 締結数の実績は決定者マスタから自動算出するため、ここに入力する必要はありません。']);

  sh.getRange(1, 1, rows.length, header.length).setValues(
    rows.map(function (r) {
      var c = r.slice();
      while (c.length < header.length) c.push('');
      return c;
    }));
  sh.getRange(1, 1, 1, header.length).setFontWeight('bold');
  sh.setFrozenRows(1);
  sh.setFrozenColumns(1);
  sh.autoResizeColumns(1, header.length);

  if (!silent) ss.toast('月次目標シートを作成しました。', 'ピカイチ採用', 5);
}

// ============================================================
// 決定者マスタの作成
// ============================================================
function setupMasterSheet(silent) {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(CONFIG.masterSheet);

  if (!silent && sh && sh.getLastRow() > 1) {
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

  if (!silent) ss.toast('決定者マスタを整えました。1候補者1行で入力してください。', 'ピカイチ採用', 6);
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
    lines.push(f.found ? '○ ファネル読み取り元：' + f.source
                       : '× ファネルを読めません（' + CONFIG.funnelSheet + ' の「目標」「実績」ラベル行も、' +
                         CONFIG.targetSheet + ' も見つかりません）');
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
    lines.push(p.found ? '○ 選考中 ' + p.active + '名 / ペンディング ' + p.pending + '名（確度「高」' + p.high + '名）'
                       : '－ 選考中一覧なし（' + CONFIG.pipelineSheet + ' の「' + CONFIG.pipelinePhaseHeader + '」列が見つかりません）');
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
