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
