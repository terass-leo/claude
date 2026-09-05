/**
 * 強み診断（Strengths Survey）— 全部入り1ファイル版
 *
 * gas/ の8ファイルを結合したものです。Apps Script エディタの「コード.gs」に
 * この内容をまるごと貼り付ければ、それだけで動きます。
 *
 * 生成元: strengths/gas/ （個別に編集したい場合はそちらを参照）
 * 再生成: node tools/bundle.js
 */

// ==========================================================================
// 00_Config.gs
// ==========================================================================

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


// ==========================================================================
// 01_Themes.gs
// ==========================================================================

/**
 * 強みテーマ辞書（12テーマ / 4領域）
 *
 * Big Five のファセット構成（IPIP系のパブリックドメイン尺度で広く使われる下位因子）を土台に、
 * 「業務アサインの言語」として使える粒度へ再合成した独自テーマ。
 * 名称・定義・設問はすべてオリジナルで、特定の商用アセスメントの複製ではない。
 *
 * definition   : 一文の定義（レポートの土台）
 * behaviors    : この資質が高い人に現れる観察可能な行動
 * fit          : 向いている仕事の型（アサイン判断の材料）
 * overuse      : 強みが出すぎたときの副作用
 */
const THEMES = [
  // ===== 領域1: 動かす力 =====
  {
    id: 'T01', name: '完遂ドライブ', domain: '動かす力',
    definition: '決めたことを最後までやり切り、成果が出るまで熱量を落とさない力。',
    behaviors: ['締切前でも粘って詰め切る', '停滞している案件を再起動させる', '数字目標があると出力が上がる'],
    fit: ['期限の重いプロジェクトの推進役', '立ち上げ直後の泥臭いフェーズ', '未達案件のリカバリー'],
    overuse: ['手段が目的化して走り続ける', '周囲の消耗に気づかない', '撤退判断が遅れる'],
  },
  {
    id: 'T02', name: '段取り力', domain: '動かす力',
    definition: '着手前に手順・優先順位・スケジュールを設計し、混乱を仕組みで防ぐ力。',
    behaviors: ['逆算して中間マイルストーンを置く', '情報を後から探せる形で整理する', '並行案件を捌ける'],
    fit: ['複数部署をまたぐPJのPMO', '業務フロー設計・標準化', '繁忙期のオペレーション統括'],
    overuse: ['計画変更に強いストレスを感じる', '手順の細かさが現場の速度を落とす'],
  },
  {
    id: 'T03', name: '検証志向', domain: '動かす力',
    definition: '決める前に事実とリスクを確かめ、抜け漏れを潰してから前に進む力。',
    behaviors: ['数字の裏付けを取りにいく', '失敗シナリオと代替案を用意する', '外に出す前に必ず読み返す'],
    fit: ['制度設計・規程改定', 'コンプライアンス／労務まわりの判断', '重要な対外資料の最終チェック'],
    overuse: ['意思決定が遅れる', '慎重さが挑戦の芽を摘む', '周囲に不安が伝播する'],
  },

  // ===== 領域2: 巻き込む力 =====
  {
    id: 'T04', name: '主導性', domain: '巻き込む力',
    definition: '結論の出ない場に自ら踏み込み、決めて動かす力。',
    behaviors: ['議論を収束させて結論を出す', '責任のある役割を引き受ける', '誰も動かない局面で先に動く'],
    fit: ['新規PJのリード', '難度の高い交渉・調整', '意思決定が滞っている会議体の再設計'],
    overuse: ['議論を打ち切りすぎる', '周囲が意見を出しにくくなる', '独断に見える'],
  },
  {
    id: 'T05', name: 'ネットワーキング', domain: '巻き込む力',
    definition: '社内外に接点を作り、人と人をつないで物事を動かす力。',
    behaviors: ['初対面でも早く打ち解ける', '自分から接点を取りにいく', '適任者を紹介してつなぐ'],
    fit: ['アライアンス・外部連携', 'リファラル採用の推進', '横断PJのハブ役'],
    overuse: ['関係構築が目的化する', '広く浅くなり深掘りが弱る'],
  },
  {
    id: 'T06', name: '表現力', domain: '巻き込む力',
    definition: '考えを相手に届く言葉に翻訳し、場の空気を動かす力。',
    behaviors: ['具体例や比喩で腹落ちさせる', '人前で臆さず話す', '複雑な話を短くまとめ直す'],
    fit: ['全社発信・説明会の登壇', '採用広報・候補者への訴求', '経営への提案・提言'],
    overuse: ['言葉が実態を先回りする', '伝え方の巧さで中身の粗さが隠れる'],
  },

  // ===== 領域3: 支える力 =====
  {
    id: 'T07', name: '共感受信', domain: '支える力',
    definition: '相手の感情や言葉にならない変化を敏感に受け取る力。',
    behaviors: ['表情や声色の変化に気づく', '言われていない不安を察する', '相手の立場に自然に立てる'],
    fit: ['1on1・オンボーディング伴走', '離職予兆のキャッチ', '顧客・候補者の本音を引き出す面談'],
    overuse: ['相手の感情を抱え込み消耗する', '言いにくいことを言えなくなる'],
  },
  {
    id: 'T08', name: '信頼醸成', domain: '支える力',
    definition: '約束を守り、立場を選ばず誠実に接することで安心感の土台をつくる力。',
    behaviors: ['小さな約束も守る', '自分の非を素直に認める', '対立の間に立って着地点を探す'],
    fit: ['部門間の利害調整', 'センシティブな労務案件の窓口', 'チームの心理的安全性づくり'],
    overuse: ['波風を立てない選択に寄る', '対立の解消を急ぎ本質を先送りする'],
  },
  {
    id: 'T09', name: '育成支援', domain: '支える力',
    definition: '人の成長そのものに手応えを感じ、任せ方を相手に合わせて設計する力。',
    behaviors: ['知見を惜しまず共有する', '相手の段階に応じて任せる範囲を変える', '相談役を任されやすい'],
    fit: ['メンター・新人育成', 'マネージャー候補の引き上げ', '研修・ナレッジ整備'],
    overuse: ['手を出しすぎて自立を妨げる', '自分の成果が後回しになる'],
  },

  // ===== 領域4: 考え抜く力 =====
  {
    id: 'T10', name: '探究心', domain: '考え抜く力',
    definition: '仕組みや理由を理解するまで掘り下げ、新しい領域を学び続ける力。',
    behaviors: ['業務外でも興味を持てば調べる', '新しい手法をまず自分で試す', '「なぜ」が解けるまで気になる'],
    fit: ['新領域の初期調査', 'ツール・システムの導入検討', 'データ分析・仮説検証'],
    overuse: ['調べること自体で満足する', '意思決定より情報収集を優先する'],
  },
  {
    id: 'T11', name: '発想力', domain: '考え抜く力',
    definition: '既存のやり方を疑い、別の選択肢を生み出す力。',
    behaviors: ['会議で案を出す側に回る', '無関係なもの同士を結びつける', '制約を面白がる'],
    fit: ['新規事業・新施策の初期設計', '行き詰まった課題の打開', '制度やイベントの企画'],
    overuse: ['案が拡散して収束しない', '運用の現実味が伴わない'],
  },
  {
    id: 'T12', name: '構想力', domain: '考え抜く力',
    definition: '断片から全体像を組み立て、長期の見通しから逆算して道筋を描く力。',
    behaviors: ['目の前より行き先が気になる', '3年後を想像して今を決める', '選択肢を並べて最短経路を見極める'],
    fit: ['中期の組織設計・人員計画', '事業戦略の言語化', '複数施策のロードマップ統合'],
    overuse: ['抽象度が高すぎて現場に届かない', '足元の実行が手薄になる'],
  },
];

/** テーマIDから定義を引く */
function getTheme(themeId) {
  const t = THEMES.find((x) => x.id === themeId);
  if (!t) throw new Error(`未知のテーマID: ${themeId}`);
  return t;
}


// ==========================================================================
// 02_Items.gs
// ==========================================================================

/**
 * 設問マスタ — 全60項目（12テーマ × 5項目、うち各テーマ1項目は逆転項目）
 *
 * reverse: true の項目は「あてはまるほどテーマが低い」ので、採点時に (SCALE_MAX+SCALE_MIN) - 素点 に変換する。
 * 逆転項目は「すべて5を選ぶ」ような無思考回答を検出するためにも使う。
 *
 * 文言はすべてオリジナル。フォームの設問文をここから生成し、回答シートの見出しと
 * 突き合わせて採点するため、text を変更したら必ずフォームを作り直すこと。
 */
const ITEMS = [
  // --- T01 完遂ドライブ ---
  { id: 'Q01', themeId: 'T01', reverse: false, text: '一度やると決めたことは、多少しんどくても最後までやり切る。' },
  { id: 'Q02', themeId: 'T01', reverse: false, text: '目標が数字で示されると、俄然やる気が出る。' },
  { id: 'Q03', themeId: 'T01', reverse: false, text: '手ごたえのない状態が続くと、落ち着かなくなる。' },
  { id: 'Q04', themeId: 'T01', reverse: true,  text: '途中で興味が薄れると、そのまま手をつけずに放置してしまうことが多い。' },
  { id: 'Q05', themeId: 'T01', reverse: false, text: '負荷の高い時期のほうが、自分は力を発揮できていると感じる。' },

  // --- T02 段取り力 ---
  { id: 'Q06', themeId: 'T02', reverse: false, text: '仕事に取りかかる前に、手順とスケジュールを組み立てる。' },
  { id: 'Q07', themeId: 'T02', reverse: false, text: '資料やデータは、後から探しやすい状態に整理してある。' },
  { id: 'Q08', themeId: 'T02', reverse: false, text: '締切から逆算して、いつ何を終わらせるかを先に決めている。' },
  { id: 'Q09', themeId: 'T02', reverse: true,  text: '計画を立てるより、まず動き出すほうが性に合っている。' },
  { id: 'Q10', themeId: 'T02', reverse: false, text: '複数の案件が並行しても、優先順位をつけて捌ける。' },

  // --- T03 検証志向 ---
  { id: 'Q11', themeId: 'T03', reverse: false, text: '決める前に、想定されるリスクを一通り洗い出す。' },
  { id: 'Q12', themeId: 'T03', reverse: false, text: '数字や事実の裏づけがないまま進めるのは気持ちが悪い。' },
  { id: 'Q13', themeId: 'T03', reverse: false, text: '重要な連絡は、送る前に必ず読み返す。' },
  { id: 'Q14', themeId: 'T03', reverse: true,  text: '細かい確認よりも、勢いで進めることを優先しがちだ。' },
  { id: 'Q15', themeId: 'T03', reverse: false, text: 'うまくいかなかったときの代替案を、あらかじめ考えておく。' },

  // --- T04 主導性 ---
  { id: 'Q16', themeId: 'T04', reverse: false, text: '話が決まらない場面では、自分が結論を出しにいく。' },
  { id: 'Q17', themeId: 'T04', reverse: false, text: '責任を伴う役割を任されることに、抵抗はない。' },
  { id: 'Q18', themeId: 'T04', reverse: false, text: '反対されても、必要だと思えば自分の意見を主張する。' },
  { id: 'Q19', themeId: 'T04', reverse: true,  text: '議論の場では、まとめ役より聞き役に回ることが多い。' },
  { id: 'Q20', themeId: 'T04', reverse: false, text: '誰も動かない状況では、自分が先に動く。' },

  // --- T05 ネットワーキング ---
  { id: 'Q21', themeId: 'T05', reverse: false, text: '初対面の相手とも、比較的すぐに打ち解けられる。' },
  { id: 'Q22', themeId: 'T05', reverse: false, text: '社外の人と会う機会を、自分から作りにいく。' },
  { id: 'Q23', themeId: 'T05', reverse: false, text: '面識のない相手にも、必要であれば自分から連絡を取る。' },
  { id: 'Q24', themeId: 'T05', reverse: true,  text: '大人数が集まる場は、できれば避けたい。' },
  { id: 'Q25', themeId: 'T05', reverse: false, text: '人と人をつなぐことで物事が動くのが面白い。' },

  // --- T06 表現力 ---
  { id: 'Q26', themeId: 'T06', reverse: false, text: '自分の考えを、相手に伝わる言葉に置き換えるのが得意だ。' },
  { id: 'Q27', themeId: 'T06', reverse: false, text: '人前で話すことに苦手意識はない。' },
  { id: 'Q28', themeId: 'T06', reverse: false, text: '説明するときは、具体例やたとえを使うことが多い。' },
  { id: 'Q29', themeId: 'T06', reverse: true,  text: '自分の考えを言葉にするのに、時間がかかるほうだ。' },
  { id: 'Q30', themeId: 'T06', reverse: false, text: '自分の話し方で、その場の空気を変えられると思う。' },

  // --- T07 共感受信 ---
  { id: 'Q31', themeId: 'T07', reverse: false, text: '相手の表情や声の調子から、気持ちの変化に気づく。' },
  { id: 'Q32', themeId: 'T07', reverse: false, text: '相手が言葉にしていない不満や不安を察することがある。' },
  { id: 'Q33', themeId: 'T07', reverse: false, text: '相手の立場に立って考えることが、自然にできる。' },
  { id: 'Q34', themeId: 'T07', reverse: true,  text: '人の気持ちの細かな動きには、あまり関心が向かない。' },
  { id: 'Q35', themeId: 'T07', reverse: false, text: '落ち込んでいる人がいると、放っておけない。' },

  // --- T08 信頼醸成 ---
  { id: 'Q36', themeId: 'T08', reverse: false, text: '約束したことは、小さなことでも守る。' },
  { id: 'Q37', themeId: 'T08', reverse: false, text: '自分に非があるときは、素直に認めて伝える。' },
  { id: 'Q38', themeId: 'T08', reverse: false, text: '対立する意見の間に立って、着地点を探す役割になることが多い。' },
  { id: 'Q39', themeId: 'T08', reverse: true,  text: '人を信用するまでには、かなり時間がかかるほうだ。' },
  { id: 'Q40', themeId: 'T08', reverse: false, text: '立場が違う相手にも、態度を変えずに接する。' },

  // --- T09 育成支援 ---
  { id: 'Q41', themeId: 'T09', reverse: false, text: '人が成長していく姿を見るのが、純粋に嬉しい。' },
  { id: 'Q42', themeId: 'T09', reverse: false, text: '自分が持っている知識やノウハウは、惜しまず共有する。' },
  { id: 'Q43', themeId: 'T09', reverse: false, text: '相手の力量に合わせて、任せる範囲を変えている。' },
  { id: 'Q44', themeId: 'T09', reverse: true,  text: '人を育てることより、自分が成果を出すことのほうが優先だ。' },
  { id: 'Q45', themeId: 'T09', reverse: false, text: '相談に乗る役を頼まれることが多い。' },

  // --- T10 探究心 ---
  { id: 'Q46', themeId: 'T10', reverse: false, text: '知らない分野の話でも、その仕組みを理解したくなる。' },
  { id: 'Q47', themeId: 'T10', reverse: false, text: '業務に直結しなくても、興味を持ったことは調べる。' },
  { id: 'Q48', themeId: 'T10', reverse: false, text: '新しいツールや手法は、まず自分で試してみる。' },
  { id: 'Q49', themeId: 'T10', reverse: true,  text: '必要以上に深く調べることには、あまり意味を感じない。' },
  { id: 'Q50', themeId: 'T10', reverse: false, text: 'なぜそうなるのかが分かるまで、気になり続ける。' },

  // --- T11 発想力 ---
  { id: 'Q51', themeId: 'T11', reverse: false, text: '既存のやり方に対して、別の選択肢はないかとよく考える。' },
  { id: 'Q52', themeId: 'T11', reverse: false, text: '会議では、思いついた案を出す側になることが多い。' },
  { id: 'Q53', themeId: 'T11', reverse: false, text: '一見関係のないもの同士を結びつけて考えるのが好きだ。' },
  { id: 'Q54', themeId: 'T11', reverse: true,  text: '前例のあるやり方をなぞるほうが安心する。' },
  { id: 'Q55', themeId: 'T11', reverse: false, text: '制約がある状況ほど、面白い工夫が生まれると思う。' },

  // --- T12 構想力 ---
  { id: 'Q56', themeId: 'T12', reverse: false, text: '目の前の作業より、全体がどこへ向かうかが気になる。' },
  { id: 'Q57', themeId: 'T12', reverse: false, text: '数年後を想像しながら、今の意思決定を考える。' },
  { id: 'Q58', themeId: 'T12', reverse: false, text: '複数の選択肢を並べて、どの道筋が最短かを見極めようとする。' },
  { id: 'Q59', themeId: 'T12', reverse: true,  text: '長期の見通しより、当面の課題に集中したい。' },
  { id: 'Q60', themeId: 'T12', reverse: false, text: '断片的な情報から、全体像を組み立てるのが得意だ。' },
];

/** フォームの並び順（テーマが固まらないよう決め打ちで散らした順序）。ITEMS の id を並べる。 */
const ITEM_ORDER = [
  'Q01', 'Q16', 'Q31', 'Q46', 'Q06', 'Q21', 'Q36', 'Q51', 'Q11', 'Q26',
  'Q41', 'Q56', 'Q02', 'Q17', 'Q32', 'Q47', 'Q07', 'Q22', 'Q37', 'Q52',
  'Q12', 'Q27', 'Q42', 'Q57', 'Q03', 'Q18', 'Q33', 'Q48', 'Q08', 'Q23',
  'Q38', 'Q53', 'Q13', 'Q28', 'Q43', 'Q58', 'Q04', 'Q19', 'Q34', 'Q49',
  'Q09', 'Q24', 'Q39', 'Q54', 'Q14', 'Q29', 'Q44', 'Q59', 'Q05', 'Q20',
  'Q35', 'Q50', 'Q10', 'Q25', 'Q40', 'Q55', 'Q15', 'Q30', 'Q45', 'Q60',
];

/** ITEM_ORDER の順に並べた ITEMS を返す */
function getOrderedItems() {
  const byId = {};
  ITEMS.forEach((it) => { byId[it.id] = it; });
  return ITEM_ORDER.map((id) => {
    if (!byId[id]) throw new Error(`ITEM_ORDER に未知の設問ID: ${id}`);
    return byId[id];
  });
}


// ==========================================================================
// 03_Scoring.gs
// ==========================================================================

/**
 * 採点エンジン
 *
 * 方針:
 *  - 採点は完全にルールベース（決定論的）。LLMは一切使わない。同じ回答からは必ず同じ順位が出る。
 *  - 「強み」は個人内の相対順位で決める。全項目に高く答える人／低く答える人の癖を打ち消すため、
 *    12テーマの素点を本人の中で標準化（個人内Zスコア）してから順位づけする。
 *  - 全社との比較（コホートZ）は母数が溜まってから任意で併用する。
 */

/** 平均 */
function mean_(arr) {
  if (!arr.length) return NaN;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

/** 標本標準偏差（n-1）。要素1個以下なら0 */
function sd_(arr) {
  if (arr.length < 2) return 0;
  const m = mean_(arr);
  const v = arr.reduce((a, b) => a + (b - m) * (b - m), 0) / (arr.length - 1);
  return Math.sqrt(v);
}

/** 小数第2位に丸める */
function round2_(x) {
  return Number.isFinite(x) ? Math.round(x * 100) / 100 : '';
}

/** 見出し文字列の表記ゆれを吸収する */
function normalizeText_(s) {
  return String(s == null ? '' : s)
    .replace(/　/g, ' ')
    .replace(/\s+/g, '')
    .trim();
}

/**
 * 逆転項目を反転した「採点済みスコア」を返す。
 * 例: 5段階で reverse の素点5 → 1
 */
function scoreItem_(item, raw) {
  const v = Number(raw);
  if (!Number.isFinite(v)) return null;
  if (v < CONFIG.SCALE_MIN || v > CONFIG.SCALE_MAX) return null;
  return item.reverse ? CONFIG.SCALE_MAX + CONFIG.SCALE_MIN - v : v;
}

/**
 * 回答シートの見出し行から「列インデックス → 設問」の対応表を作る。
 * 設問文をキーに突き合わせるので、フォームの設問を並べ替えても壊れない。
 * 逆にフォームの文言を編集すると対応が取れなくなるため、その場合はここでエラーになる。
 *
 * @param {Array} headers 回答シートの1行目
 * @return {{map: Object, missing: Array<string>}} map は 列index → item
 */
function buildHeaderMap_(headers) {
  const byText = {};
  ITEMS.forEach((it) => { byText[normalizeText_(it.text)] = it; });

  const map = {};
  const found = {};
  headers.forEach((h, idx) => {
    const key = normalizeText_(h);
    if (byText[key]) {
      map[idx] = byText[key];
      found[byText[key].id] = true;
    }
  });
  const missing = ITEMS.filter((it) => !found[it.id]).map((it) => `${it.id}: ${it.text}`);
  return { map, missing };
}

/**
 * 1人分の回答（itemId → 素点）を採点する。
 *
 * @param {Object} answers itemId をキー、1〜5の素点を値に持つオブジェクト
 * @return {Object} テーマ別スコア・個人内Z・順位・回答品質フラグ
 */
function scoreAnswers(answers) {
  const scoredByTheme = {};
  const allScored = [];
  let answeredCount = 0;

  THEMES.forEach((t) => { scoredByTheme[t.id] = { positive: [], reverse: [] }; });

  ITEMS.forEach((item) => {
    const scored = scoreItem_(item, answers[item.id]);
    if (scored === null) return;
    answeredCount += 1;
    allScored.push(scored);
    scoredByTheme[item.themeId][item.reverse ? 'reverse' : 'positive'].push(scored);
  });

  // テーマ素点 = そのテーマの全項目（逆転補正後）の平均
  const themeScores = {};
  THEMES.forEach((t) => {
    const vals = scoredByTheme[t.id].positive.concat(scoredByTheme[t.id].reverse);
    themeScores[t.id] = vals.length ? mean_(vals) : NaN;
  });

  // 個人内標準化: 12テーマの素点を本人の平均・標準偏差で割り戻す
  const themeVals = THEMES.map((t) => themeScores[t.id]).filter(Number.isFinite);
  const pMean = mean_(themeVals);
  const pSd = sd_(themeVals);
  const themeZ = {};
  THEMES.forEach((t) => {
    const v = themeScores[t.id];
    themeZ[t.id] = Number.isFinite(v) && pSd > 0 ? (v - pMean) / pSd : 0;
  });

  // 順位づけ（Z降順 → 素点降順 → ID昇順 で完全に決定論的にする）
  const ranking = THEMES.slice()
    .filter((t) => Number.isFinite(themeScores[t.id]))
    .sort((a, b) => {
      if (themeZ[b.id] !== themeZ[a.id]) return themeZ[b.id] - themeZ[a.id];
      if (themeScores[b.id] !== themeScores[a.id]) return themeScores[b.id] - themeScores[a.id];
      return a.id < b.id ? -1 : 1;
    })
    .map((t, i) => ({
      rank: i + 1,
      themeId: t.id,
      name: t.name,
      domain: t.domain,
      score: themeScores[t.id],
      z: themeZ[t.id],
    }));

  return {
    answeredCount,
    themeScores,
    themeZ,
    ranking,
    top: ranking.slice(0, CONFIG.TOP_N),
    bottom: ranking.slice(-CONFIG.BOTTOM_N),
    flags: buildQualityFlags_(answeredCount, allScored, scoredByTheme, pSd),
  };
}

/** 回答品質フラグ（結果を読む側が信頼度を判断するための材料） */
function buildQualityFlags_(answeredCount, allScored, scoredByTheme, pSd) {
  const flags = [];
  if (answeredCount < ITEMS.length) {
    flags.push(`未回答 ${ITEMS.length - answeredCount}件`);
  }
  if (allScored.length >= 2 && sd_(allScored) < CONFIG.STRAIGHTLINE_SD) {
    flags.push('ほぼ同じ選択肢が続いている（結果の解像度が低い）');
  }
  if (pSd === 0 && answeredCount > 0) {
    flags.push('テーマ間の差がつかず順位が確定しない');
  }
  let inconsistent = 0;
  THEMES.forEach((t) => {
    const p = scoredByTheme[t.id].positive;
    const r = scoredByTheme[t.id].reverse;
    if (p.length && r.length && Math.abs(mean_(p) - mean_(r)) >= CONFIG.INCONSISTENCY_GAP) {
      inconsistent += 1;
    }
  });
  if (inconsistent >= 4) {
    flags.push(`逆転項目との不一致が${inconsistent}テーマ（読み飛ばしの可能性）`);
  }
  return flags;
}

/**
 * 全社（コホート）比較用のZスコア。過去の結果が NORM_MIN_N 件以上あるときだけ返す。
 *
 * @param {Object} themeScores 本人のテーマ素点
 * @param {Array<Object>} cohort 過去回答者の themeScores 配列（本人を含んでよい）
 * @return {Object|null} themeId → Z。母数不足なら null
 */
function cohortZ(themeScores, cohort) {
  if (!cohort || cohort.length < CONFIG.NORM_MIN_N) return null;
  const out = {};
  THEMES.forEach((t) => {
    const vals = cohort.map((c) => c[t.id]).filter(Number.isFinite);
    const m = mean_(vals);
    const s = sd_(vals);
    const v = themeScores[t.id];
    out[t.id] = Number.isFinite(v) && s > 0 ? (v - m) / s : 0;
  });
  return out;
}


// ==========================================================================
// 04_Setup.gs
// ==========================================================================

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


// ==========================================================================
// 05_Report.gs
// ==========================================================================

/**
 * 個人レポート生成 — Claude API 呼び出しと Google ドキュメント出力
 *
 * 採点（順位・スコア）は 03_Scoring.gs が決定論的に算出済み。
 * ここでのLLMの役割は「確定した順位を日本語のフィードバック文に翻訳すること」だけで、
 * スコアの計算や順位の判断は一切させない。
 */

/** Claude に渡すシステムプロンプト */
function buildSystemPrompt_() {
  return [
    'あなたは組織人事の専門家で、社員向けの強みフィードバックを書く役割です。',
    '与えられた診断結果（テーマの順位と定義）だけを根拠に、本人が読んで納得し、明日から使える日本語のレポートを書いてください。',
    '',
    '厳守事項:',
    '- 与えられたテーマ辞書と順位以外の事実（実績・経歴・性格傾向・エピソード）を創作しない。',
    '- スコアやZ値などの数値を本文に書かない。「上位」「相対的に控えめ」といった言葉に翻訳する。',
    '- 下位のテーマを「弱み」「欠点」と断定しない。あくまで本人の中での相対的な優先順位として扱う。',
    '- 性格の断定、医学的・臨床的な解釈、将来の成果の予言をしない。',
    '- 敬体（です・ます）で、断定しすぎない一方で曖昧にも逃げない、具体的な記述にする。',
    '- 見出しは指定どおりのMarkdown（##／###）を使い、指定にない見出しを足さない。',
  ].join('\n');
}

/** テーマ辞書を Claude 用のテキストに整形する */
function formatThemeDict_(themeIds) {
  return themeIds.map((id) => {
    const t = getTheme(id);
    return [
      `【${t.name}】（領域: ${t.domain}）`,
      `定義: ${t.definition}`,
      `現れやすい行動: ${t.behaviors.join(' / ')}`,
      `向いている仕事の型: ${t.fit.join(' / ')}`,
      `出すぎたときの副作用: ${t.overuse.join(' / ')}`,
    ].join('\n');
  }).join('\n\n');
}

/** 1人分のユーザープロンプトを組み立てる */
function buildUserPrompt_(profile) {
  const rankingLines = profile.result.ranking
    .map((r) => `${r.rank}位: ${r.name}（${r.domain}）`)
    .join('\n');

  const topIds = profile.result.top.map((r) => r.themeId);
  const bottomIds = profile.result.bottom.map((r) => r.themeId);

  const parts = [
    `対象者: ${profile.name} さん${profile.dept ? `（${profile.dept}）` : ''}`,
    '',
    '■ 12テーマの順位（本人の中での相対順位）',
    rankingLines,
    '',
    `■ 上位${CONFIG.TOP_N}テーマの定義`,
    formatThemeDict_(topIds),
    '',
    `■ 下位${CONFIG.BOTTOM_N}テーマの定義（参考）`,
    formatThemeDict_(bottomIds),
  ];

  if (profile.result.flags.length) {
    parts.push('', '■ 回答品質に関する注意',
      profile.result.flags.join(' / '),
      '※この点を踏まえ、断定を弱める表現にしてください。ただし注意書きの内容そのものは本文に書かないでください。');
  }

  parts.push('', '■ 出力フォーマット（この見出し構成を厳密に守る）',
    `## あなたの強み トップ${CONFIG.TOP_N}`,
    '### 1位 テーマ名',
    '（150〜200字。そのテーマが「この人の日常業務でどう現れるか」を具体的に描写する）',
    `（同じ形式で${CONFIG.TOP_N}位まで）`,
    '',
    '## 強みの組み合わせが生む持ち味',
    `（上位${CONFIG.TOP_N}テーマの掛け算で説明できる、この人固有の効きどころを200字程度で）`,
    '',
    '## 活かしどころ',
    '（箇条書き5つ。「〜のような仕事」という業務の型で書き、具体的な社内固有名詞は使わない）',
    '',
    '## 強みが出すぎたときの注意点',
    '（箇条書き3つ。「どのテーマが」「どんな形で出るか」「どう対処するか」を1項目にまとめる）',
    '',
    '## 相対的に控えめな面との付き合い方',
    '（150字程度。伸ばすより「補い方・任せ方」に焦点を当てる）',
    '',
    '## アサイン担当者向けメモ',
    '（箇条書き3つ。「任せると伸びる仕事」「別の人で補いたい場面」「1on1で確かめたい問い」を各1つ）');

  return parts.join('\n');
}

/** Claude API を叩く（リトライ付き） */
function callClaude_(systemPrompt, userPrompt) {
  const key = PropertiesService.getScriptProperties().getProperty(CONFIG.API_KEY_PROPERTY);
  if (!key) {
    throw new Error(`スクリプトプロパティ ${CONFIG.API_KEY_PROPERTY} が未設定です。`);
  }

  const payload = {
    model: CONFIG.MODEL,
    max_tokens: CONFIG.MAX_TOKENS,
    system: systemPrompt,
    thinking: { type: 'adaptive' },
    output_config: { effort: CONFIG.EFFORT },
    messages: [{ role: 'user', content: userPrompt }],
  };
  const headers = {
    'x-api-key': key,
    'anthropic-version': CONFIG.ANTHROPIC_VERSION,
  };
  if (CONFIG.USE_SERVER_SIDE_FALLBACK) {
    headers['anthropic-beta'] = CONFIG.FALLBACK_BETA;
    payload.fallbacks = 'default';
  }

  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: headers,
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  };

  let wait = 2000;
  for (let attempt = 1; attempt <= CONFIG.API_MAX_RETRY; attempt += 1) {
    const res = UrlFetchApp.fetch(CONFIG.API_URL, options);
    const code = res.getResponseCode();
    const body = res.getContentText();

    if (code === 200) {
      const json = JSON.parse(body);
      if (json.stop_reason === 'refusal') {
        const detail = json.stop_details ? JSON.stringify(json.stop_details) : '';
        throw new Error(`Claude がこのリクエストへの応答を控えました: ${detail}`);
      }
      const text = (json.content || [])
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
      if (!text) throw new Error('Claude から本文が返りませんでした。');
      return text;
    }

    const retryable = code === 429 || code === 408 || code >= 500;
    if (!retryable || attempt === CONFIG.API_MAX_RETRY) {
      throw new Error(`Claude API エラー (HTTP ${code}): ${body.slice(0, 500)}`);
    }
    Utilities.sleep(wait);
    wait *= 2;
  }
  throw new Error('Claude API 呼び出しに失敗しました。');
}

/** レポート本文を生成する */
function generateReportText(profile) {
  return callClaude_(buildSystemPrompt_(), buildUserPrompt_(profile));
}

/** レポート保存用の Drive フォルダを返す（なければ作る） */
function getReportFolder_() {
  const it = DriveApp.getFoldersByName(CONFIG.REPORT_FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(CONFIG.REPORT_FOLDER_NAME);
}

/**
 * Markdown を Google ドキュメントに流し込む。
 * Claude には ## / ### / - の3種類しか使わせないので、パーサもその3つだけを扱う。
 */
function renderMarkdownToDoc_(body, markdown) {
  markdown.split('\n').forEach((rawLine) => {
    const line = rawLine.replace(/\*\*/g, '').trimEnd();
    if (!line.trim()) return;

    if (line.startsWith('### ')) {
      body.appendParagraph(line.slice(4).trim())
        .setHeading(DocumentApp.ParagraphHeading.HEADING3);
    } else if (line.startsWith('## ')) {
      body.appendParagraph(line.slice(3).trim())
        .setHeading(DocumentApp.ParagraphHeading.HEADING2);
    } else if (line.startsWith('# ')) {
      body.appendParagraph(line.slice(2).trim())
        .setHeading(DocumentApp.ParagraphHeading.HEADING2);
    } else if (/^[-*・]\s+/.test(line.trim())) {
      body.appendListItem(line.trim().replace(/^[-*・]\s+/, ''))
        .setGlyphType(DocumentApp.GlyphType.BULLET);
    } else {
      body.appendParagraph(line.trim())
        .setHeading(DocumentApp.ParagraphHeading.NORMAL);
    }
  });
}

/**
 * レポートDocを作成し、URLを返す。
 * @param {Object} profile {name, dept, email, result}
 * @param {string} markdown Claude が生成した本文
 */
function createReportDoc_(profile, markdown) {
  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Tokyo', 'yyyy-MM-dd');
  const doc = DocumentApp.create(`強み診断レポート_${profile.name}_${today}`);
  const body = doc.getBody();

  body.appendParagraph(`${profile.name} さん 強み診断レポート`)
    .setHeading(DocumentApp.ParagraphHeading.TITLE);
  body.appendParagraph(`実施日: ${today}${profile.dept ? `　所属: ${profile.dept}` : ''}`)
    .setHeading(DocumentApp.ParagraphHeading.SUBTITLE);

  renderMarkdownToDoc_(body, markdown);

  body.appendParagraph('12テーマの順位').setHeading(DocumentApp.ParagraphHeading.HEADING2);
  const table = [['順位', 'テーマ', '領域', '相対スコア']].concat(
    profile.result.ranking.map((r) => [String(r.rank), r.name, r.domain, String(round2_(r.z))])
  );
  body.appendTable(table);

  body.appendParagraph('').setHeading(DocumentApp.ParagraphHeading.NORMAL);
  const note = body.appendParagraph(
    'この結果は自己申告アンケートに基づく相対的な傾向であり、能力の優劣や人事評価・選考の判断材料ではありません。' +
    '本人の育成・1on1・業務アサインの参考としてご利用ください。' +
    (profile.result.flags.length ? `\n（回答傾向に関する注記: ${profile.result.flags.join(' / ')}）` : '')
  );
  note.setItalic(true);

  doc.saveAndClose();

  const file = DriveApp.getFileById(doc.getId());
  getReportFolder_().addFile(file);
  DriveApp.getRootFolder().removeFile(file);
  if (CONFIG.SHARE_REPORT_WITH_RESPONDENT && profile.email) {
    try { file.addViewer(profile.email); } catch (e) { log_('REPORT', profile.name, `共有失敗: ${e.message}`); }
  }
  return doc.getUrl();
}


// ==========================================================================
// 06_Main.gs
// ==========================================================================

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


// ==========================================================================
// 07_Test.gs
// ==========================================================================

/**
 * セルフテスト — API を使わずに設問マスタと採点ロジックの健全性を確認する。
 * 設問を足す／文言を直すたびに実行すること。
 */

function assert_(cond, message) {
  if (!cond) throw new Error(`テスト失敗: ${message}`);
}

/** 全項目に同じ素点を入れた回答を作る */
function answersAll_(value) {
  const a = {};
  ITEMS.forEach((it) => { a[it.id] = value; });
  return a;
}

/** 指定テーマだけ高く、他は普通に答えた回答を作る（逆転項目も整合させる） */
function answersFavoring_(themeIds, high, base) {
  const a = {};
  ITEMS.forEach((it) => {
    const target = themeIds.indexOf(it.themeId) >= 0;
    const scored = target ? high : base;              // 逆転補正後にこうしたい、という値
    a[it.id] = it.reverse ? CONFIG.SCALE_MAX + CONFIG.SCALE_MIN - scored : scored;
  });
  return a;
}

function runSelfTest() {
  const results = [];
  const check = (label, fn) => {
    try { fn(); results.push(`OK   ${label}`); }
    catch (e) { results.push(`NG   ${label} — ${e.message}`); }
  };

  check('設問は60問、12テーマ×5問', () => {
    assert_(ITEMS.length === 60, `設問数が ${ITEMS.length} 問`);
    assert_(THEMES.length === 12, `テーマ数が ${THEMES.length}`);
    THEMES.forEach((t) => {
      const own = ITEMS.filter((i) => i.themeId === t.id);
      assert_(own.length === 5, `${t.name} の設問が ${own.length} 問`);
      const rev = own.filter((i) => i.reverse);
      assert_(rev.length === 1, `${t.name} の逆転項目が ${rev.length} 件`);
    });
  });

  check('設問IDとテーマIDに重複・欠落がない', () => {
    const ids = {};
    ITEMS.forEach((i) => {
      assert_(!ids[i.id], `設問ID重複: ${i.id}`);
      ids[i.id] = true;
      getTheme(i.themeId); // 未知のテーマIDなら例外
    });
    const texts = {};
    ITEMS.forEach((i) => {
      const k = normalizeText_(i.text);
      assert_(!texts[k], `設問文が重複: ${i.text}`);
      texts[k] = true;
    });
  });

  check('出題順に全60問が1回ずつ入り、同テーマが連続しない', () => {
    assert_(ITEM_ORDER.length === 60, `出題順の件数が ${ITEM_ORDER.length}`);
    const seen = {};
    ITEM_ORDER.forEach((id) => {
      assert_(!seen[id], `出題順に重複: ${id}`);
      seen[id] = true;
    });
    const ordered = getOrderedItems();
    for (let i = 1; i < ordered.length; i += 1) {
      assert_(ordered[i].themeId !== ordered[i - 1].themeId,
        `同テーマが連続: ${ordered[i - 1].id} → ${ordered[i].id}`);
    }
  });

  check('逆転項目が正しく反転される', () => {
    const rev = ITEMS.find((i) => i.reverse);
    const pos = ITEMS.find((i) => !i.reverse);
    assert_(scoreItem_(rev, 5) === 1, '逆転項目の5が1にならない');
    assert_(scoreItem_(rev, 1) === 5, '逆転項目の1が5にならない');
    assert_(scoreItem_(pos, 4) === 4, '順項目が変換されている');
    assert_(scoreItem_(pos, 0) === null, '範囲外の値が弾かれていない');
    assert_(scoreItem_(pos, '') === null, '空欄が弾かれていない');
  });

  check('狙ったテーマが1位になる', () => {
    const res = scoreAnswers(answersFavoring_(['T12'], 5, 3));
    assert_(res.ranking.length === 12, `順位が ${res.ranking.length} 件`);
    assert_(res.ranking[0].themeId === 'T12', `1位が ${res.ranking[0].name}`);
    assert_(res.top.length === CONFIG.TOP_N, 'Top件数が設定と不一致');
    assert_(res.themeZ.T12 > 0, '狙ったテーマのZが正でない');
  });

  check('複数テーマを立てると上位に揃う', () => {
    const res = scoreAnswers(answersFavoring_(['T04', 'T06', 'T11'], 5, 2));
    const topIds = res.top.map((x) => x.themeId);
    ['T04', 'T06', 'T11'].forEach((id) => {
      assert_(topIds.indexOf(id) >= 0, `${getTheme(id).name} が上位に入っていない`);
    });
  });

  check('全部同じ選択肢の回答にフラグが立つ', () => {
    const res = scoreAnswers(answersAll_(5));
    assert_(res.flags.length > 0, 'フラグが立たない');
    assert_(res.flags.join(' ').indexOf('逆転項目') >= 0, '逆転項目の不一致が検出されない');
  });

  check('未回答が数えられる', () => {
    const a = answersFavoring_(['T01'], 5, 3);
    delete a.Q01;
    delete a.Q02;
    const res = scoreAnswers(a);
    assert_(res.answeredCount === 58, `回答数が ${res.answeredCount}`);
    assert_(res.flags.join(' ').indexOf('未回答 2件') >= 0, '未回答フラグが出ない');
  });

  check('回答シート見出しとの突き合わせが成立する', () => {
    const headers = ['タイムスタンプ', 'メールアドレス', '氏名', '部署・チーム']
      .concat(getOrderedItems().map((i) => i.text));
    const { map, missing } = buildHeaderMap_(headers);
    assert_(missing.length === 0, `未検出の設問が ${missing.length} 件`);
    assert_(Object.keys(map).length === 60, `対応づいた列が ${Object.keys(map).length} 件`);
    assert_(map[4].id === ITEM_ORDER[0], '列と設問の対応がずれている');
  });

  check('全社比較Zは母数が足りないと出さない', () => {
    const one = scoreAnswers(answersFavoring_(['T01'], 5, 3)).themeScores;
    assert_(cohortZ(one, [one, one]) === null, '母数不足でもZを返している');
    const cohort = [];
    for (let i = 0; i < CONFIG.NORM_MIN_N; i += 1) {
      cohort.push(scoreAnswers(answersFavoring_([THEMES[i % 12].id], 5, 3)).themeScores);
    }
    assert_(cohortZ(one, cohort) !== null, '母数が足りてもZが出ない');
  });

  const summary = results.join('\n');
  const ng = results.filter((r) => r.indexOf('NG') === 0).length;
  const header = ng === 0 ? `全 ${results.length} 項目 合格` : `${ng} 項目が失敗`;
  console.log(`${header}\n${summary}`);
  try {
    SpreadsheetApp.getUi().alert('セルフテスト結果', `${header}\n\n${summary}`, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (e) {
    // エディタから直接実行した場合は UI が使えないのでログのみ
  }
  return summary;
}

/** Claude API に疎通するかだけを確かめる（課金は数円未満） */
function testClaudeConnection() {
  const text = callClaude_('簡潔に答えてください。', '「接続確認OK」とだけ返してください。');
  console.log(text);
  try {
    SpreadsheetApp.getUi().alert('API接続テスト', text, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (e) { /* エディタ実行時 */ }
  return text;
}

