/**
 * TERASS 災害アラート
 *
 * 気象庁の公開防災情報（地震・津波）を定期取得し、社員の現住所（都道府県・市区町村）
 * と突合して、該当社員がいる場合に Slack #p_saigai へ通知する。
 *
 * 実行方法: main() を時間主導型トリガー（5分ごと推奨）で回す。
 * 初期設定:  setup() を一度だけ手動実行してスクリプトプロパティを登録する。
 *
 * 出典: 気象庁防災情報 https://www.jma.go.jp/bosai/
 */

// ===== 設定 =====================================================================

/** 社員住所マスタ（Googleスプレッドシート）のID */
var SHEET_ID = '1GorFs9jPr4DVMXrd7CUVvefwJibzCrft5LhYm3Xqoy0';

/** アラートを出す最低震度（この震度以上で通知）。'4' = 震度4 */
var ALERT_MIN = '4';

/** @channel を付ける震度（この震度以上で全員メンション）。'5-' = 震度5弱 */
var MENTION_MIN = '5-';

/** 何時間前までの地震を対象にするか（トリガー停止からの復帰時の取りこぼし防止） */
var LOOKBACK_HOURS = 3;

/** 1回の実行で処理する地震イベントの上限 */
var MAX_EVENTS_PER_RUN = 3;

var JMA_QUAKE_LIST = 'https://www.jma.go.jp/bosai/quake/data/list.json';
var JMA_QUAKE_BASE = 'https://www.jma.go.jp/bosai/quake/data/';
var JMA_TSUNAMI_LIST = 'https://www.jma.go.jp/bosai/tsunami/data/list.json';
var JMA_TSUNAMI_BASE = 'https://www.jma.go.jp/bosai/tsunami/data/';
var JMA_MAP_URL = 'https://www.jma.go.jp/bosai/map.html#contents=earthquake_map';

/** 震度コード -> 比較用の数値 */
var SCALE_VALUE = {
  '1': 1, '2': 2, '3': 3, '4': 4,
  '5-': 5, '5+': 6, '6-': 7, '6+': 8, '7': 9
};

/** 震度コード -> 表示ラベル */
var SCALE_LABEL = {
  '1': '1', '2': '2', '3': '3', '4': '4',
  '5-': '5弱', '5+': '5強', '6-': '6弱', '6+': '6強', '7': '7'
};

/** 政令指定都市（市名のみのマスタ表記を区単位のJMA表記に展開するため） */
var SEIREI_CITIES = {
  '札幌市': 1, '仙台市': 1, 'さいたま市': 1, '千葉市': 1, '横浜市': 1,
  '川崎市': 1, '相模原市': 1, '新潟市': 1, '静岡市': 1, '浜松市': 1,
  '名古屋市': 1, '京都市': 1, '大阪市': 1, '堺市': 1, '神戸市': 1,
  '岡山市': 1, '広島市': 1, '北九州市': 1, '福岡市': 1, '熊本市': 1
};

// ===== エントリポイント ==========================================================

/** 時間主導型トリガーから呼ばれる本体 */
function main() {
  try {
    checkEarthquakes();
  } catch (e) {
    logError('地震チェック', e);
  }
  try {
    checkTsunami();
  } catch (e) {
    logError('津波チェック', e);
  }
}

/** 初期設定。Slack Webhook URL を登録して疎通確認する（一度だけ手動実行） */
function setup() {
  var url = PropertiesService.getScriptProperties().getProperty('SLACK_WEBHOOK_URL');
  if (!url) {
    throw new Error(
      'スクリプトプロパティ SLACK_WEBHOOK_URL が未設定です。\n' +
      'GASエディタの「プロジェクトの設定 > スクリプト プロパティ」で\n' +
      'SLACK_WEBHOOK_URL に Slack Incoming Webhook の URL を登録してください。'
    );
  }
  var emps = loadEmployees();
  postToSlack(
    ':white_check_mark: *災害アラート セットアップ完了*\n' +
    '社員住所マスタを ' + emps.length + '名 読み込みました。\n' +
    '以後、震度' + SCALE_LABEL[ALERT_MIN] + '以上の地震で該当社員がいる場合に通知します。'
  );
  Logger.log('セットアップ完了: ' + emps.length + '名');
}

// ===== 地震 =====================================================================

function checkEarthquakes() {
  var list = fetchJson(JMA_QUAKE_LIST);
  if (!list || !list.length) return;

  var since = new Date().getTime() - LOOKBACK_HOURS * 3600 * 1000;
  var state = getState();
  var candidates = [];

  for (var i = 0; i < list.length && i < 60; i++) {
    var e = list[i];
    // 市区町村別の震度が入るのは「震源・震度情報」(VXSE5k) のみ
    if (e.ttl !== '震源・震度情報') continue;
    if (e.ift === '取消') continue;
    if (!e.maxi || !SCALE_VALUE[e.maxi]) continue;
    if (SCALE_VALUE[e.maxi] < SCALE_VALUE[ALERT_MIN]) continue;

    var at = new Date(e.at).getTime();
    if (isNaN(at) || at < since) continue;

    // 既報より震度が上がっていなければスキップ（続報・訂正の重複通知を防ぐ）
    var prev = state.quakes[e.eid];
    if (prev != null && SCALE_VALUE[e.maxi] <= prev) continue;

    candidates.push(e);
  }

  candidates.reverse(); // 古い順に通知
  var processed = 0;

  for (var j = 0; j < candidates.length && processed < MAX_EVENTS_PER_RUN; j++) {
    var ev = candidates[j];
    var detail = fetchJson(JMA_QUAKE_BASE + ev.json);
    if (!detail) continue;

    var obs = readIntensity(detail);
    var emps = loadEmployees();
    var hits = matchEmployees(emps, obs);

    var isFirst = state.quakes[ev.eid] == null;
    postToSlack(buildQuakeMessage(ev, detail, obs, hits, isFirst));

    state.quakes[ev.eid] = SCALE_VALUE[ev.maxi];
    processed++;
  }

  if (processed > 0) saveState(state);
}

/**
 * 詳細JSONから市区町村別・都道府県別の最大震度を取り出す。
 * JMAのJSONは要素が1つのとき配列でなくオブジェクトになるため、必ず toArray() を通す。
 */
function readIntensity(detail) {
  var result = { cities: [], prefs: {} };
  var body = detail && detail.Body;
  var observation = body && body.Intensity && body.Intensity.Observation;
  if (!observation) return result;

  var prefs = toArray(observation.Pref);
  for (var i = 0; i < prefs.length; i++) {
    var pref = prefs[i];
    if (!pref || !pref.Name) continue;
    result.prefs[pref.Name] = pref.MaxInt || '';

    var areas = toArray(pref.Area);
    for (var j = 0; j < areas.length; j++) {
      var cities = toArray(areas[j] && areas[j].City);
      for (var k = 0; k < cities.length; k++) {
        var city = cities[k];
        if (!city || !city.Name) continue;
        result.cities.push({
          pref: pref.Name,
          name: city.Name,
          maxInt: city.MaxInt || ''
        });
      }
    }
  }
  return result;
}

// ===== 突合 =====================================================================

/**
 * 社員1人ずつ、居住市区町村に一致するJMAの観測地点を探して最大震度を決める。
 * 市区町村で取れない場合は都道府県の最大震度にフォールバックする（見逃し防止）。
 */
function matchEmployees(employees, obs) {
  var hits = [];

  for (var i = 0; i < employees.length; i++) {
    var emp = employees[i];
    var best = null;   // {value, label, basis}
    var cityWide = null;

    for (var j = 0; j < obs.cities.length; j++) {
      var c = obs.cities[j];
      if (c.pref !== emp.pref) continue;
      var v = SCALE_VALUE[c.maxInt];
      if (!v) continue;

      var kind = cityMatchKind(c.name, emp.city, emp.pref);
      if (kind === 'exact') {
        if (!best || v > best.value) best = { value: v, label: SCALE_LABEL[c.maxInt], basis: '' };
      } else if (kind === 'citywide') {
        if (!cityWide || v > cityWide.value) {
          cityWide = { value: v, label: SCALE_LABEL[c.maxInt], basis: '市内最大' };
        }
      }
    }

    if (!best) best = cityWide;

    // 市区町村で取れなければ都道府県の最大震度で判定
    if (!best) {
      var pv = SCALE_VALUE[obs.prefs[emp.pref]];
      if (pv) best = { value: pv, label: SCALE_LABEL[obs.prefs[emp.pref]], basis: '県内最大' };
    }

    if (best && best.value >= SCALE_VALUE[ALERT_MIN]) {
      hits.push({
        name: emp.name, dept: emp.dept, pref: emp.pref, city: emp.city,
        value: best.value, label: best.label, basis: best.basis
      });
    }
  }

  hits.sort(function (a, b) { return b.value - a.value; });
  return hits;
}

/**
 * JMAの市区町村名がマスタの市区町村を指しているか判定する。
 *  'exact'    … その市区町村そのもの
 *  'citywide' … 同じ政令市の別の区（市内最大として採用）
 *  ''         … 不一致
 *
 * JMAの表記ゆれ:
 *   政令市     … 「福岡市西区」ではなく「福岡西区」（市を省略）
 *   東京23区   … 「東京世田谷区」（都道府県名を前置）
 *   同名回避   … 「古賀市」→「福岡古賀市」のように都道府県名を前置することがある
 *   郡         … 「不破郡関ケ原町」ではなく「関ケ原町」
 */
function cityMatchKind(jmaName, empCity, prefName) {
  if (!jmaName || !empCity) return '';
  var pShort = prefName.replace(/[都道府県]$/, '');

  if (jmaName === empCity) return 'exact';
  if (jmaName === pShort + empCity) return 'exact';

  // 郡を落とした形（不破郡関ケ原町 -> 関ケ原町 / 岐阜関ケ原町）
  var noGun = empCity.replace(/^.*?郡/, '');
  if (noGun !== empCity && noGun) {
    if (jmaName === noGun || jmaName === pShort + noGun) return 'exact';
  }

  // 政令市＋区まで記載（大阪市平野区 -> 大阪平野区）
  var withWard = empCity.match(/^(.+?)市(.+区)$/);
  if (withWard) {
    var base = withWard[1];
    if (jmaName === base + withWard[2]) return 'exact';
    // 同じ市の別の区は「市内最大」として拾う
    if (jmaName.indexOf(base) === 0 && /区$/.test(jmaName)) return 'citywide';
    return '';
  }

  // 政令市を市までしか持たない（福岡市 -> 福岡西区 など全区を対象にする）。
  // どの区に住んでいるか分からないため、市内の全区の最大震度を採る（citywide）。
  if (SEIREI_CITIES[empCity]) {
    var b = empCity.replace(/市$/, '');
    if (jmaName.indexOf(b) === 0 && /区$/.test(jmaName)) return 'citywide';
  }

  return '';
}

// ===== 津波 =====================================================================

/**
 * 津波注意報以上が出ているかを確認する。
 * 津波予報区（例:「有明・八代海」）は都道府県と1対1で対応しないため、
 * 区域名に都道府県名が含まれる場合のみ社員を突合し、それ以外は区域名のみ通知する。
 */
function checkTsunami() {
  var list = fetchJson(JMA_TSUNAMI_LIST);
  if (!list || !list.length) return;

  var since = new Date().getTime() - LOOKBACK_HOURS * 3600 * 1000;
  var state = getState();

  for (var i = 0; i < list.length && i < 20; i++) {
    var e = list[i];
    if (e.ift === '取消') continue;

    var rdt = new Date(e.rdt).getTime();
    if (isNaN(rdt) || rdt < since) continue;
    if (state.tsunami[e.json]) continue;

    var kinds = toArray(e.kind);
    var serious = [];
    for (var k = 0; k < kinds.length; k++) {
      var name = kinds[k] && kinds[k].kind;
      if (!name) continue;
      if (name.indexOf('解除') >= 0) continue;
      if (name.indexOf('大津波警報') >= 0 || name.indexOf('津波警報') >= 0 ||
          name.indexOf('津波注意報') >= 0) {
        serious.push(name);
      }
    }
    if (!serious.length) continue;

    var detail = fetchJson(JMA_TSUNAMI_BASE + e.json);
    var areas = readTsunamiAreas(detail);
    var emps = loadEmployees();
    var hits = matchTsunamiEmployees(emps, areas);

    postToSlack(buildTsunamiMessage(e, serious, areas, hits));
    state.tsunami[e.json] = 1;
    saveState(state);
    return; // 津波は1回の実行で1件だけ通知する
  }
}

/** 津波予報区ごとの発表内容を取り出す */
function readTsunamiAreas(detail) {
  var out = [];
  var forecast = detail && detail.Body && detail.Body.Tsunami && detail.Body.Tsunami.Forecast;
  var items = toArray(forecast && forecast.Item);
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    var areaName = it && it.Area && it.Area.Name;
    var kindName = it && it.Category && it.Category.Kind && it.Category.Kind.Name;
    if (!areaName || !kindName) continue;
    if (kindName.indexOf('注意報') < 0 && kindName.indexOf('警報') < 0) continue;
    var height = it.MaxHeight && it.MaxHeight.TsunamiHeight;
    out.push({ area: areaName, kind: kindName, height: height || '' });
  }
  return out;
}

/** 予報区名に都道府県名が含まれる場合のみ、その都道府県の社員を拾う */
function matchTsunamiEmployees(employees, areas) {
  var hits = [];
  for (var i = 0; i < employees.length; i++) {
    var emp = employees[i];
    var pShort = emp.pref.replace(/[都道府県]$/, '');
    for (var j = 0; j < areas.length; j++) {
      if (areas[j].area.indexOf(pShort) >= 0) {
        hits.push({ name: emp.name, dept: emp.dept, pref: emp.pref, city: emp.city,
                    area: areas[j].area, kind: areas[j].kind });
        break;
      }
    }
  }
  return hits;
}

// ===== 社員マスタ ===============================================================

/** スプレッドシートから社員の居住地を読み込む（氏名・部署・都道府県・市区町村のみ） */
function loadEmployees() {
  var sheet = SpreadsheetApp.openById(SHEET_ID).getSheets()[0];
  var values = sheet.getDataRange().getValues();
  if (!values.length) return [];

  var header = values[0].map(function (v) { return String(v).trim(); });
  var idx = {
    name: header.indexOf('氏名'),
    dept: header.indexOf('部署'),
    pref: header.indexOf('都道府県'),
    city: header.indexOf('市区町村')
  };
  if (idx.name < 0 || idx.pref < 0 || idx.city < 0) {
    throw new Error('社員住所マスタの見出し行に「氏名」「都道府県」「市区町村」が必要です');
  }

  var out = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    var pref = String(row[idx.pref] || '').trim();
    var city = String(row[idx.city] || '').trim();
    var name = String(row[idx.name] || '').trim();
    if (!name || !pref) continue;
    out.push({
      name: name,
      dept: idx.dept >= 0 ? String(row[idx.dept] || '').trim() : '',
      pref: pref,
      city: city
    });
  }
  return out;
}

// ===== Slack ===================================================================

function buildQuakeMessage(ev, detail, obs, hits, isFirst) {
  var mention = SCALE_VALUE[ev.maxi] >= SCALE_VALUE[MENTION_MIN];
  var lines = [];

  if (mention) lines.push('<!channel>');
  lines.push(':rotating_light: *災害アラート｜地震*' + (isFirst ? '' : '（続報）'));
  lines.push('');

  var mag = ev.mag ? 'M' + ev.mag + ' ' : '';
  lines.push('*' + mag + (ev.anm || '震源不明') + '* 最大震度' + SCALE_LABEL[ev.maxi]);
  lines.push('発生: ' + formatJst(ev.at));

  if (hits.length) {
    lines.push('');
    lines.push('*現住所が該当エリアの社員 ' + hits.length + '名*');
    for (var i = 0; i < hits.length; i++) {
      var h = hits[i];
      var note = h.basis ? '（' + h.basis + '）' : '';
      lines.push('• ' + h.name + '（' + h.dept + '） ' + h.pref + h.city +
                 ' — 震度' + h.label + note);
    }
  } else {
    lines.push('');
    lines.push('現住所が該当エリアの社員はいません。');
  }

  if (mention) {
    lines.push('');
    lines.push(':bangbang: 震度' + SCALE_LABEL[MENTION_MIN] + '以上です。安否確認の実施をご検討ください。');
  }

  var comment = detail && detail.Body && detail.Body.Comments &&
                detail.Body.Comments.ForecastComment &&
                detail.Body.Comments.ForecastComment.Text;
  if (comment) {
    lines.push('');
    lines.push('_' + comment.replace(/\n/g, ' ') + '_');
  }

  lines.push('');
  lines.push('<' + JMA_MAP_URL + '|気象庁の地震情報>');
  lines.push('_出典: 気象庁防災情報 ／ 住所: 安否アラート用_社員住所マスタ ／ eid: ' + ev.eid + '_');

  return lines.join('\n');
}

function buildTsunamiMessage(ev, kinds, areas, hits) {
  var mention = kinds.join('').indexOf('警報') >= 0;
  var lines = [];

  if (mention) lines.push('<!channel>');
  lines.push(':ocean: *災害アラート｜津波*');
  lines.push('');
  lines.push('*' + kinds.join('・') + '*');
  lines.push('地震: M' + (ev.mag || '?') + ' ' + (ev.anm || '') + '（' + formatJst(ev.at) + '）');

  if (areas.length) {
    lines.push('');
    lines.push('*対象の津波予報区*');
    for (var i = 0; i < areas.length; i++) {
      var h = areas[i].height ? '（予想高さ ' + areas[i].height + 'm）' : '';
      lines.push('• ' + areas[i].area + ' — ' + areas[i].kind + h);
    }
  }

  if (hits.length) {
    lines.push('');
    lines.push('*予報区に居住都道府県が含まれる社員 ' + hits.length + '名*');
    for (var j = 0; j < hits.length; j++) {
      lines.push('• ' + hits[j].name + '（' + hits[j].dept + '） ' +
                 hits[j].pref + hits[j].city);
    }
  }

  lines.push('');
  lines.push('_※津波予報区は都道府県と一致しないため、上記の社員リストは目安です。' +
             '沿岸部に居住・滞在する社員は別途ご確認ください。_');
  lines.push('<https://www.jma.go.jp/bosai/map.html#contents=tsunami|気象庁の津波情報>');
  lines.push('_出典: 気象庁防災情報 ／ eid: ' + ev.eid + '_');

  return lines.join('\n');
}

function postToSlack(text) {
  var url = PropertiesService.getScriptProperties().getProperty('SLACK_WEBHOOK_URL');
  if (!url) throw new Error('スクリプトプロパティ SLACK_WEBHOOK_URL が未設定です');

  var res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ text: text }),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) {
    throw new Error('Slack投稿に失敗: ' + res.getResponseCode() + ' ' + res.getContentText());
  }
}

// ===== 状態管理（重複通知の防止）================================================

function getState() {
  var raw = PropertiesService.getScriptProperties().getProperty('ALERT_STATE');
  var state = raw ? JSON.parse(raw) : {};
  if (!state.quakes) state.quakes = {};
  if (!state.tsunami) state.tsunami = {};
  return state;
}

function saveState(state) {
  state.quakes = trimObject(state.quakes, 200);
  state.tsunami = trimObject(state.tsunami, 100);
  PropertiesService.getScriptProperties()
    .setProperty('ALERT_STATE', JSON.stringify(state));
}

/** プロパティが肥大化しないよう、古いキーから落として上限件数に収める */
function trimObject(obj, limit) {
  var keys = Object.keys(obj);
  if (keys.length <= limit) return obj;
  keys.sort(); // イベントIDは時刻順の文字列なので昇順ソートで古い順になる
  var out = {};
  for (var i = keys.length - limit; i < keys.length; i++) out[keys[i]] = obj[keys[i]];
  return out;
}

// ===== ユーティリティ ===========================================================

function fetchJson(url) {
  var res = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true,
    headers: { 'User-Agent': 'TERASS-saigai-alert/1.0' }
  });
  if (res.getResponseCode() !== 200) {
    Logger.log('取得失敗 ' + res.getResponseCode() + ': ' + url);
    return null;
  }
  try {
    return JSON.parse(res.getContentText());
  } catch (e) {
    Logger.log('JSONパース失敗: ' + url);
    return null;
  }
}

/** JMAのJSONは要素が1つだと配列でなくオブジェクトになるため必ずこれを通す */
function toArray(v) {
  if (v == null) return [];
  return Object.prototype.toString.call(v) === '[object Array]' ? v : [v];
}

function formatJst(iso) {
  var d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  return Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');
}

function logError(label, e) {
  Logger.log('[' + label + '] エラー: ' + (e && e.stack ? e.stack : e));
}

// ===== 動作確認用 ===============================================================

/**
 * 直近の地震1件を、しきい値を無視して強制的に突合しSlackへ送る。
 * 導入時の疎通確認に使う（通常運用では使わない）。
 */
function testLatestQuake() {
  var list = fetchJson(JMA_QUAKE_LIST);
  var ev = null;
  for (var i = 0; i < list.length; i++) {
    if (list[i].ttl === '震源・震度情報' && list[i].ift !== '取消' && list[i].maxi) {
      ev = list[i];
      break;
    }
  }
  if (!ev) throw new Error('対象の地震情報が見つかりません');

  var detail = fetchJson(JMA_QUAKE_BASE + ev.json);
  var obs = readIntensity(detail);
  var emps = loadEmployees();

  // しきい値を一時的に最小に下げて突合する
  var saved = ALERT_MIN;
  ALERT_MIN = '1';
  var hits = matchEmployees(emps, obs);
  ALERT_MIN = saved;

  Logger.log('社員数: ' + emps.length + ' / 該当: ' + hits.length);
  postToSlack('【テスト送信】これは動作確認です。\n\n' +
              buildQuakeMessage(ev, detail, obs, hits, true));
}

/** 突合ロジックだけをログで確認する（Slackには送らない） */
function dryRunLatestQuake() {
  var list = fetchJson(JMA_QUAKE_LIST);
  for (var i = 0; i < list.length; i++) {
    if (list[i].ttl !== '震源・震度情報' || list[i].ift === '取消' || !list[i].maxi) continue;
    var ev = list[i];
    var detail = fetchJson(JMA_QUAKE_BASE + ev.json);
    var obs = readIntensity(detail);
    var hits = matchEmployees(loadEmployees(), obs);
    Logger.log(ev.at + ' ' + ev.anm + ' 最大震度' + ev.maxi +
               ' / 観測市区町村 ' + obs.cities.length + ' / 該当社員 ' + hits.length);
    for (var j = 0; j < hits.length; j++) {
      Logger.log('  ' + hits[j].name + ' ' + hits[j].pref + hits[j].city +
                 ' 震度' + hits[j].label + ' ' + hits[j].basis);
    }
    return;
  }
}
