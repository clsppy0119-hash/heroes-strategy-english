/**
 * 發音。用瀏覽器內建的 speechSynthesis——不花錢，也不需要 API key。
 *
 * ## 為什麼放在 app 層而不是 content 層
 *
 * content 決定「這題該用聽的」，但「這台裝置放不放得出聲音」是瀏覽器的事。
 * 兩者分開之後，出題邏輯可以在 node 裡跑測試，而降級判斷只在瀏覽器裡發生。
 *
 * ## 為什麼不預先檢查有沒有英文語音
 *
 * `getVoices()` 在部分瀏覽器第一次呼叫時會回空陣列，要等 voiceschanged
 * 事件才有東西。拿它當「能不能發音」的判斷會在剛載入時誤判成不能，
 * 於是第一題永遠降級成文字題。所以只檢查 API 在不在，語音的挑選交給瀏覽器。
 */

export function canSpeak(): boolean {
  return typeof window !== 'undefined' && typeof window.speechSynthesis !== 'undefined';
}

/**
 * 唸一個英文字。
 *
 * 先 cancel 再 speak：玩家連按重播時，佇列會累積成好幾次連續朗讀，
 * 那聽起來像壞掉。
 *
 * 語速比預設慢一點——這是聽力測驗不是新聞播報，玩家需要時間把音節分開。
 */
export function speak(text: string): void {
  if (!canSpeak()) {
    return;
  }
  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.rate = 0.85;
    window.speechSynthesis.speak(utterance);
  } catch {
    // 有些環境 API 在但呼叫會丟（權限、無音訊裝置）。
    // 唸不出來不該讓整場戰鬥掛掉——玩家還有「看拼字」可以按。
  }
}
