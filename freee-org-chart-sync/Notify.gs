/** Slack Incoming Webhook 通知（任意。SLACK_WEBHOOK_URL 未設定なら何もしない） */
function notifySlack_(text) {
  const url = props_().getProperty(PROP_KEYS.SLACK_WEBHOOK_URL);
  if (!url) return false;
  try {
    UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ text: text }),
      muteHttpExceptions: true,
    });
    return true;
  } catch (e) {
    Logger.log('Slack通知失敗: ' + e);
    return false;
  }
}
