/**
 * 強み診断 — Googleフォーム生成スクリプト（1回だけ使う）
 *
 * 使い方:
 *   1. https://script.google.com を開き「新しいプロジェクト」
 *   2. このファイルの内容を全文貼り付けて保存
 *   3. 上部の関数選択で createStrengthsForm を選び「実行」→ 権限を承認
 *   4. 実行ログに出る「回答用URL」を配布、「回答シート」に回答が溜まる
 *
 * APIキー・課金・トリガーは一切不要。フォームと回答シートを作るだけ。
 * 回答の集計は report.html に回答シートを貼り付けて行う。
 */

/*__DATA__*/

const FORM_TITLE = '強み診断サーベイ';
const FORM_DESCRIPTION =
  '所要時間は約10分です。60個の文について、ふだんの自分にどれくらいあてはまるかを直感で選んでください。\n' +
  '正解・不正解はありません。「こうありたい姿」ではなく「実際の自分」で答えるほど、結果の精度が上がります。\n' +
  '結果は本人へのフィードバックと業務アサインの参考に使い、人事評価・選考には使用しません。';
const SCALE_LOW = '全くあてはまらない';
const SCALE_HIGH = '非常にあてはまる';

function createStrengthsForm() {
  const form = FormApp.create(FORM_TITLE);
  form.setDescription(FORM_DESCRIPTION);
  form.setProgressBar(true);
  form.setShowLinkToRespondAgain(false);
  try { form.setCollectEmail(true); } catch (e) { /* 組織設定で使えない場合は氏名で突き合わせる */ }

  form.addTextItem().setTitle('氏名').setRequired(true);
  form.addTextItem().setTitle('部署・チーム').setRequired(false);
  form.addSectionHeaderItem()
    .setTitle('設問（全60問）')
    .setHelpText(`1 = ${SCALE_LOW} / 5 = ${SCALE_HIGH}　深く考え込まず、直感で選んでください。`);

  getOrderedItems().forEach((item) => {
    form.addScaleItem()
      .setTitle(item.text)
      .setBounds(1, 5)
      .setLabels(SCALE_LOW, SCALE_HIGH)
      .setRequired(true);
  });

  const ss = SpreadsheetApp.create(`${FORM_TITLE}（回答）`);
  form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());

  console.log('=== 作成完了 ===');
  console.log('回答用URL（配布用）: ' + form.getPublishedUrl());
  console.log('フォーム編集URL     : ' + form.getEditUrl());
  console.log('回答シート          : ' + ss.getUrl());
  console.log('回答シートを開いて全体をコピーし、report.html に貼り付けるとレポートが出ます。');
}
