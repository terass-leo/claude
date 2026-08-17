/**
 * 突合ロジックの検証。
 *
 * Code.gs を Node の vm で読み込み、GAS 固有の API をスタブに差し替えて
 * cityMatchKind / readIntensity / matchEmployees を実データで検証する。
 *
 *   node gas/saigai-alert/test/match.test.js
 *
 * フィクスチャは 2026-08-17 06:37 福岡県福岡地方 M4.4（最大震度4）の
 * 気象庁「震源・震度情報」JSON から観測部分を抜き出したもの。
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sandbox = {
  Logger: { log: () => {} },
  Utilities: { formatDate: (d) => d.toISOString() },
  SpreadsheetApp: {},
  PropertiesService: {},
  UrlFetchApp: {},
  console,
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8'), sandbox);

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures++;
    console.log(`  NG  ${label}\n        期待: ${JSON.stringify(expected)}\n        実際: ${JSON.stringify(actual)}`);
  } else {
    console.log(`  OK  ${label}`);
  }
}

// --- 実データ: 福岡県福岡地方 M4.4 最大震度4 -----------------------------------
const city = (name, maxInt) => ({ Name: name, MaxInt: maxInt });
const FUKUOKA_DETAIL = {
  Body: {
    Earthquake: { Magnitude: '4.4' },
    Intensity: {
      Observation: {
        MaxInt: '4',
        Pref: [
          {
            Name: '福岡県', MaxInt: '4',
            Area: [
              { Name: '福岡県福岡', MaxInt: '4', City: [
                city('糸島市', '4'), city('福岡西区', '3'), city('福岡中央区', '2'),
                city('福岡南区', '2'), city('福岡早良区', '2'), city('宗像市', '2'),
                city('福岡古賀市', '2'), city('福津市', '2'), city('新宮町', '2'),
                city('福岡東区', '1'), city('福岡博多区', '1'), city('福岡城南区', '1'),
                city('筑紫野市', '1'), city('春日市', '1'), city('大野城市', '1'),
                city('太宰府市', '1'), city('那珂川市', '1'), city('宇美町', '1'),
                city('篠栗町', '1'), city('久山町', '1'), city('粕屋町', '1'),
              ]},
              { Name: '福岡県筑後', MaxInt: '2', City: [
                city('久留米市', '2'), city('柳川市', '1'), city('八女市', '1'),
                city('筑後市', '1'), city('大川市', '1'), city('小郡市', '1'),
                city('みやま市', '1'), city('筑前町', '1'), city('大刀洗町', '1'),
                city('福岡広川町', '1'),
              ]},
              { Name: '福岡県北九州', MaxInt: '1', City: [
                city('行橋市', '1'), city('中間市', '1'), city('芦屋町', '1'),
              ]},
              { Name: '福岡県筑豊', MaxInt: '1', City: [
                city('飯塚市', '1'), city('宮若市', '1'), city('嘉麻市', '1'),
              ]},
            ],
          },
          {
            Name: '佐賀県', MaxInt: '3',
            Area: [
              { Name: '佐賀県北部', MaxInt: '3', City: [
                city('唐津市', '3'), city('伊万里市', '1'), city('玄海町', '1'), city('有田町', '1'),
              ]},
              { Name: '佐賀県南部', MaxInt: '2', City: [
                city('佐賀市', '2'), city('多久市', '2'), city('上峰町', '2'), city('みやき町', '2'),
                city('鳥栖市', '1'), city('武雄市', '1'), city('小城市', '1'),
              ]},
            ],
          },
          // 要素が1つのときJMAは配列でなくオブジェクトを返す（正規化の検証）
          {
            Name: '熊本県', MaxInt: '1',
            Area: { Name: '熊本県熊本', MaxInt: '1', City: [
              city('熊本北区', '1'), city('玉名市', '1'), city('山鹿市', '1'),
            ]},
          },
          {
            Name: '山口県', MaxInt: '1',
            Area: { Name: '山口県西部', MaxInt: '1', City: city('下関市', '1') },
          },
        ],
      },
    },
    Comments: { ForecastComment: { Text: 'この地震による津波の心配はありません。' } },
  },
};

console.log('\n[1] JMAレスポンスの正規化（単一要素がオブジェクトで来るケースを含む）');
const obs = sandbox.readIntensity(FUKUOKA_DETAIL);
check('観測された市区町村の総数', obs.cities.length, 52);
check('都道府県別の最大震度', obs.prefs,
  { 福岡県: '4', 佐賀県: '3', 熊本県: '1', 山口県: '1' });
check('Areaがオブジェクトの県も市区町村を拾えている',
  obs.cities.filter((c) => c.pref === '熊本県').map((c) => c.name),
  ['熊本北区', '玉名市', '山鹿市']);
check('Cityがオブジェクトの県も拾えている',
  obs.cities.filter((c) => c.pref === '山口県').map((c) => c.name), ['下関市']);

console.log('\n[2] 市区町村名の表記ゆれ吸収');
const kind = sandbox.cityMatchKind;
check('完全一致', kind('筑紫野市', '筑紫野市', '福岡県'), 'exact');
check('政令市：市までのマスタは市内全区が対象（区が不明なため市内最大を採る）',
  kind('福岡西区', '福岡市', '福岡県'), 'citywide');
check('政令市：横浜市', kind('横浜青葉区', '横浜市', '神奈川県'), 'citywide');
check('政令市：熊本市', kind('熊本北区', '熊本市', '熊本県'), 'citywide');
check('政令市：区まで持つマスタ（大阪市平野区→大阪平野区）',
  kind('大阪平野区', '大阪市平野区', '大阪府'), 'exact');
check('政令市：区まで持つマスタの別区は市内最大として拾う',
  kind('大阪中央区', '大阪市平野区', '大阪府'), 'citywide');
check('東京23区は都道府県名が前置される', kind('東京世田谷区', '世田谷区', '東京都'), 'exact');
check('同名回避で都道府県名が前置される市（古賀市→福岡古賀市）',
  kind('福岡古賀市', '古賀市', '福岡県'), 'exact');
check('郡を含むマスタ（不破郡関ケ原町→関ケ原町）',
  kind('関ケ原町', '不破郡関ケ原町', '岐阜県'), 'exact');
check('郡を含むマスタ＋都道府県前置', kind('岐阜関ケ原町', '不破郡関ケ原町', '岐阜県'), 'exact');

console.log('\n[3] 誤検知しないこと');
check('福岡市が福津市を巻き込まない', kind('福津市', '福岡市', '福岡県'), '');
check('大阪市が大阪狭山市を巻き込まない', kind('大阪狭山市', '大阪市', '大阪府'), '');
check('福岡市が福岡古賀市を巻き込まない', kind('福岡古賀市', '福岡市', '福岡県'), '');
check('無関係な市区町村', kind('久留米市', '筑紫野市', '福岡県'), '');

console.log('\n[4] 実社員マスタとの突合（震度1以上＝全件拾う設定）');
const employees = [
  { name: '今村 絢', dept: 'フィールドセールス2グループ', pref: '福岡県', city: '福岡市' },
  { name: '中山 知香', dept: 'インストラクターマネジメント', pref: '福岡県', city: '福岡市' },
  { name: '土谷 昌平', dept: 'サービス開発', pref: '福岡県', city: '福岡市' },
  { name: '岩﨑 鈴峰', dept: 'フィールドセールス2グループ', pref: '福岡県', city: '福岡市' },
  { name: '日髙 卓哉', dept: 'CA第４チーム', pref: '福岡県', city: '筑紫野市' },
  { name: '井村 睦', dept: '事業開発グループ', pref: '福岡県', city: '春日市' },
  { name: '相良 尚子', dept: '第3グループ', pref: '熊本県', city: '熊本市' },
  { name: '下瀬 志央理', dept: 'フィールドセールス2グループ', pref: '山口県', city: '周南市' },
  { name: '岡 和明', dept: 'フィールドセールス1グループ', pref: '東京都', city: '日野市' },
];

sandbox.ALERT_MIN = '1';
const all = sandbox.matchEmployees(employees, obs);
check('福岡市の4名は市内最大の震度3で拾われる',
  all.filter((h) => h.city === '福岡市').map((h) => h.label + h.basis),
  ['3市内最大', '3市内最大', '3市内最大', '3市内最大']);
check('筑紫野市は震度1', all.filter((h) => h.name === '日髙 卓哉').map((h) => h.label), ['1']);
check('熊本市は区の観測点から震度1',
  all.filter((h) => h.name === '相良 尚子').map((h) => h.label + h.basis), ['1市内最大']);
check('観測点のない周南市は県内最大にフォールバック',
  all.filter((h) => h.name === '下瀬 志央理').map((h) => h.label + h.basis), ['1県内最大']);
check('揺れていない東京都の社員は対象外',
  all.filter((h) => h.pref === '東京都').length, 0);
check('震度の降順に並ぶ', all.map((h) => h.value).every((v, i, a) => i === 0 || a[i - 1] >= v), true);

console.log('\n[5] 本番しきい値（震度4以上）での挙動');
sandbox.ALERT_MIN = '4';
const real = sandbox.matchEmployees(employees, obs);
check('この地震では居住市区町村が震度4に達する社員はいない', real.length, 0);

// 糸島市（震度4）に社員がいた場合は拾えること
const withItoshima = employees.concat(
  [{ name: 'テスト 太郎', dept: '検証', pref: '福岡県', city: '糸島市' }]);
const hit4 = sandbox.matchEmployees(withItoshima, obs);
check('震度4の糸島市の社員は拾われる',
  hit4.map((h) => h.name + ':' + h.label), ['テスト 太郎:4']);

console.log('\n[6] 通知メッセージの組み立て');
sandbox.ALERT_MIN = '1';
const msg = sandbox.buildQuakeMessage(
  { eid: '20260817063722', at: '2026-08-17T06:37:00+09:00', anm: '福岡県福岡地方', mag: '4.4', maxi: '4' },
  FUKUOKA_DETAIL, obs, sandbox.matchEmployees(employees, obs), true);
check('震度4では@channelを付けない', msg.indexOf('<!channel>') === -1, true);
check('リンクはSlackのmrkdwn形式', msg.indexOf('<https://www.jma.go.jp/bosai/map.html') >= 0, true);
check('重複防止用のeidが入っている', msg.indexOf('eid: 20260817063722') >= 0, true);
check('番地や生年月日を含まない', /\d{3}-\d{4}|丁目|番地/.test(msg), false);

const msg5 = sandbox.buildQuakeMessage(
  { eid: 'x', at: '2026-08-17T06:37:00+09:00', anm: 'テスト', mag: '6.0', maxi: '5+' },
  FUKUOKA_DETAIL, obs, sandbox.matchEmployees(employees, obs), true);
check('震度5強では@channelを付ける', msg5.indexOf('<!channel>') === 0, true);
check('震度5強では安否確認を促す', msg5.indexOf('安否確認の実施') >= 0, true);

console.log('\n[7] 津波情報の解析');
const TSUNAMI_DETAIL = {
  Body: { Tsunami: { Forecast: { Item: [
    { Area: { Name: '有明・八代海' }, Category: { Kind: { Name: '津波注意報' } },
      MaxHeight: { TsunamiHeight: '1' } },
    { Area: { Name: '長崎県西方' }, Category: { Kind: { Name: '津波予報（若干の海面変動）' } },
      MaxHeight: { TsunamiHeight: '<0.2' } },
    { Area: { Name: '熊本県天草灘沿岸' }, Category: { Kind: { Name: '津波注意報' } },
      MaxHeight: { TsunamiHeight: '0.2' } },
  ]}}},
};
const areas = sandbox.readTsunamiAreas(TSUNAMI_DETAIL);
check('注意報・警報の区域だけを拾う（予報は除く）',
  areas.map((a) => a.area), ['有明・八代海', '熊本県天草灘沿岸']);
check('予報区名に県名を含む社員を拾える',
  sandbox.matchTsunamiEmployees(employees, areas).map((h) => h.name), ['相良 尚子']);

console.log('\n' + (failures === 0
  ? `全テスト成功（${failures} 件の失敗）`
  : `${failures} 件失敗`));
process.exit(failures === 0 ? 0 : 1);
