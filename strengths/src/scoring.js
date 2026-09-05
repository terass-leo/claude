/**
 * 採点エンジン（純粋関数のみ。ブラウザ・Node どちらでも動く）
 *
 *  - 採点は完全にルールベース。同じ回答からは必ず同じ順位が出る。
 *  - 「強み」は個人内の相対順位で決める。全項目に高く／低く答える癖を打ち消すため、
 *    12テーマの素点を本人の平均・標準偏差で標準化（個人内Z）してから順位づけする。
 *  - 全社との比較（コホートZ）は母数が溜まってから別軸で併用する。
 */
const SCORING = {
  SCALE_MIN: 1,
  SCALE_MAX: 5,
  TOP_N: 5,
  BOTTOM_N: 3,
  NORM_MIN_N: 10,          // 全社比較を出し始める最低人数
  STRAIGHTLINE_SD: 0.30,   // 全項目の標準偏差がこれ未満なら「同じ選択肢ばかり」
  INCONSISTENCY_GAP: 2.0,  // 順項目と逆転項目の平均差がこれ以上のテーマを数える
  INCONSISTENCY_THEMES: 4, // 上記のテーマ数がこれ以上ならフラグ
};

function mean_(arr) {
  if (!arr.length) return NaN;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

/** 標本標準偏差（n-1）。要素1個以下なら0 */
function sd_(arr) {
  if (arr.length < 2) return 0;
  const m = mean_(arr);
  return Math.sqrt(arr.reduce((a, b) => a + (b - m) * (b - m), 0) / (arr.length - 1));
}

function round2_(x) {
  return Number.isFinite(x) ? Math.round(x * 100) / 100 : '';
}

/** 見出し文字列の表記ゆれを吸収する（空白・全角空白・句点の有無） */
function normalizeText_(s) {
  return String(s == null ? '' : s)
    .replace(/　/g, ' ')
    .replace(/\s+/g, '')
    .replace(/[。.]$/, '')
    .trim();
}

/**
 * 回答値を数値にする。「5 非常にあてはまる」のようなラベル付きも先頭の数字を拾う。
 */
function parseAnswerValue_(raw) {
  if (raw === null || raw === undefined) return NaN;
  if (typeof raw === 'number') return raw;
  const m = String(raw).trim().match(/^([1-9]\d*)/);
  return m ? Number(m[1]) : NaN;
}

/** 逆転項目を反転した「採点済みスコア」を返す。範囲外・空欄は null */
function scoreItem_(item, raw) {
  const v = parseAnswerValue_(raw);
  if (!Number.isFinite(v)) return null;
  if (v < SCORING.SCALE_MIN || v > SCORING.SCALE_MAX) return null;
  return item.reverse ? SCORING.SCALE_MAX + SCORING.SCALE_MIN - v : v;
}

/**
 * 見出し行から「列インデックス → 設問」の対応を作る。
 * 設問文が見出しに含まれていれば一致とみなす（グリッド形式「質問 [設問文]」にも対応）。
 */
function buildHeaderMap_(headers) {
  const normItems = ITEMS.map((it) => ({ item: it, key: normalizeText_(it.text) }));
  const map = {};
  const found = {};
  headers.forEach((h, idx) => {
    const key = normalizeText_(h);
    if (!key) return;
    const hit = normItems.find((n) => key === n.key || key.indexOf(n.key) >= 0);
    if (hit && !found[hit.item.id]) {
      map[idx] = hit.item;
      found[hit.item.id] = true;
    }
  });
  const missing = ITEMS.filter((it) => !found[it.id]);
  return { map, missing };
}

/**
 * 1人分の回答（itemId → 素点）を採点する。
 * @return {{answeredCount, themeScores, themeZ, ranking, top, bottom, flags}}
 */
function scoreAnswers(answers) {
  const byTheme = {};
  const allScored = [];
  let answeredCount = 0;
  THEMES.forEach((t) => { byTheme[t.id] = { positive: [], reverse: [] }; });

  ITEMS.forEach((item) => {
    const scored = scoreItem_(item, answers[item.id]);
    if (scored === null) return;
    answeredCount += 1;
    allScored.push(scored);
    byTheme[item.themeId][item.reverse ? 'reverse' : 'positive'].push(scored);
  });

  const themeScores = {};
  THEMES.forEach((t) => {
    const vals = byTheme[t.id].positive.concat(byTheme[t.id].reverse);
    themeScores[t.id] = vals.length ? mean_(vals) : NaN;
  });

  const themeVals = THEMES.map((t) => themeScores[t.id]).filter(Number.isFinite);
  const pMean = mean_(themeVals);
  // 全テーマ同値のとき丸め誤差で SD が 1e-16 程度残るため、実質ゼロとして扱う
  const pSd = sd_(themeVals) < 1e-9 ? 0 : sd_(themeVals);
  const themeZ = {};
  THEMES.forEach((t) => {
    const v = themeScores[t.id];
    themeZ[t.id] = Number.isFinite(v) && pSd > 0 ? (v - pMean) / pSd : 0;
  });

  const ranking = THEMES.slice()
    .filter((t) => Number.isFinite(themeScores[t.id]))
    .sort((a, b) => {
      if (themeZ[b.id] !== themeZ[a.id]) return themeZ[b.id] - themeZ[a.id];
      if (themeScores[b.id] !== themeScores[a.id]) return themeScores[b.id] - themeScores[a.id];
      return a.id < b.id ? -1 : 1;
    })
    .map((t, i) => ({ rank: i + 1, themeId: t.id, name: t.name, domain: t.domain, score: themeScores[t.id], z: themeZ[t.id] }));

  return {
    answeredCount,
    themeScores,
    themeZ,
    ranking,
    top: ranking.slice(0, SCORING.TOP_N),
    bottom: ranking.slice(-SCORING.BOTTOM_N),
    flags: buildQualityFlags_(answeredCount, allScored, byTheme, pSd),
  };
}

function buildQualityFlags_(answeredCount, allScored, byTheme, pSd) {
  const flags = [];
  if (answeredCount < ITEMS.length) flags.push(`未回答 ${ITEMS.length - answeredCount}件`);
  if (allScored.length >= 2 && sd_(allScored) < SCORING.STRAIGHTLINE_SD) flags.push('ほぼ同じ選択肢が続いている');
  if (pSd === 0 && answeredCount > 0) flags.push('テーマ間の差がつかず順位が確定しない');
  let inconsistent = 0;
  THEMES.forEach((t) => {
    const p = byTheme[t.id].positive;
    const r = byTheme[t.id].reverse;
    if (p.length && r.length && Math.abs(mean_(p) - mean_(r)) >= SCORING.INCONSISTENCY_GAP) inconsistent += 1;
  });
  if (inconsistent >= SCORING.INCONSISTENCY_THEMES) flags.push(`逆転項目との不一致が${inconsistent}テーマ（読み飛ばしの可能性）`);
  return flags;
}

/**
 * 全社（コホート）比較用のZ。母数が NORM_MIN_N 未満なら null
 * @param {Object} themeScores 本人のテーマ素点
 * @param {Array<Object>} cohort 全回答者の themeScores 配列
 */
function cohortZ(themeScores, cohort) {
  if (!cohort || cohort.length < SCORING.NORM_MIN_N) return null;
  const out = {};
  THEMES.forEach((t) => {
    const vals = cohort.map((c) => c[t.id]).filter(Number.isFinite);
    const m = mean_(vals);
    const s = sd_(vals) < 1e-9 ? 0 : sd_(vals);
    const v = themeScores[t.id];
    out[t.id] = Number.isFinite(v) && s > 0 ? (v - m) / s : 0;
  });
  return out;
}

/** 見出しから氏名などの列位置を探す。見つからなければ -1 */
function findCol_(headers, candidates) {
  for (let i = 0; i < headers.length; i += 1) {
    const h = normalizeText_(headers[i]).toLowerCase();
    if (candidates.some((c) => h.indexOf(normalizeText_(c).toLowerCase()) >= 0)) return i;
  }
  return -1;
}

/**
 * 表データ（2次元配列。1行目が見出し）を人ごとの採点結果に変換する。
 * 同じ氏名の回答が複数あれば、後の行（＝新しい回答）を採用する。
 */
function scoreTable(rows) {
  if (!rows || rows.length < 2) throw new Error('データが2行未満です。見出し行と回答行を含めて貼り付けてください。');
  const headers = rows[0];
  const { map, missing } = buildHeaderMap_(headers);
  const matched = Object.keys(map).length;
  if (matched === 0) throw new Error('設問の見出しが1つも見つかりません。フォームの回答シート（1行目が設問文）を貼り付けてください。');

  const colName = findCol_(headers, ['氏名', 'お名前', '名前', 'name']);
  const colDept = findCol_(headers, ['部署', 'チーム', 'dept']);
  const colMail = findCol_(headers, ['メール', 'email']);
  const colTime = findCol_(headers, ['タイムスタンプ', 'timestamp']);
  if (colName < 0) throw new Error('「氏名」列が見つかりません。フォームに氏名の質問があるか確認してください。');

  const byName = {};
  const order = [];
  for (let r = 1; r < rows.length; r += 1) {
    const row = rows[r];
    const name = String(row[colName] || '').trim();
    if (!name) continue;
    const answers = {};
    let any = false;
    Object.keys(map).forEach((idx) => {
      answers[map[idx].id] = row[Number(idx)];
      if (String(row[Number(idx)] || '').trim()) any = true;
    });
    if (!any) continue;
    if (!byName[name]) order.push(name);
    byName[name] = {
      name,
      dept: colDept >= 0 ? String(row[colDept] || '').trim() : '',
      email: colMail >= 0 ? String(row[colMail] || '').trim() : '',
      timestamp: colTime >= 0 ? String(row[colTime] || '').trim() : '',
      duplicate: !!byName[name],
      result: scoreAnswers(answers),
    };
  }

  const people = order.map((n) => byName[n]);
  const cohort = people.map((p) => p.result.themeScores);
  people.forEach((p) => { p.cohortZ = cohortZ(p.result.themeScores, cohort); });

  return {
    people,
    matchedItems: matched,
    missingItems: missing,
    cohortEnabled: people.length >= SCORING.NORM_MIN_N,
    duplicates: people.filter((p) => p.duplicate).map((p) => p.name),
  };
}
