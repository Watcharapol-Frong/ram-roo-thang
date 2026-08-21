export async function showLoadingAnimation(chatId, accessToken) {
  const url = 'https://api.line.me/v2/bot/chat/loading/start';
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
      body: JSON.stringify({ chatId: chatId, loadingSeconds: 5 })
    });
  } catch (e) { console.error("Error showing loading animation", e); }
}

export async function replyToLINE(replyToken, messages, accessToken) {
  return fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
    body: JSON.stringify({ replyToken: replyToken, messages: messages })
  });
}
