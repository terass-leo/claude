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
