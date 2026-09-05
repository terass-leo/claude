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
