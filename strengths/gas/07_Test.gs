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
