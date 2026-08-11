import { readFileSync } from 'node:fs';
import process from 'node:process';

import { DISENGAGE_LIMIT, GUESS_THRESHOLD_MS, analyze } from '../src/analytics/analyze.ts';

/**
 * 讀測試者匯出的 JSON，算出 #7 的五個數字並對照喊停條件。
 *
 *   pnpm analyze playtest/*.json
 *
 * 跟遊戲裡用的是同一份 analyze()，所以測試場上看到的數字跟事後分析出來的一致。
 */

const files = process.argv.slice(2);

if (files.length === 0) {
  console.error('用法：pnpm analyze <匯出的 json 檔> [更多檔案...]');
  process.exit(1);
}

const records = files.flatMap((file) => {
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(parsed)) {
    throw new Error(`${file} 不是陣列`);
  }
  return parsed;
});

const report = analyze(records);

const pct = (value) => `${(value * 100).toFixed(1)}%`;
const ms = (value) => (value === null ? '—' : `${(value / 1000).toFixed(1)}s`);

console.log(`\n檔案 ${files.length} 份 · session ${report.sessions} 個 · 事件 ${records.length} 筆\n`);

console.log('一、亂猜跳題率');
console.log(`   出題 ${report.questionsShown}　作答 ${report.answered}　跳題 ${report.skipped}　亂猜 ${report.guessed}`);
console.log(`   亂猜跳題率 ${pct(report.disengageRate)}（喊停線 ${pct(DISENGAGE_LIMIT)}，亂猜定義：答錯且 < ${GUESS_THRESHOLD_MS}ms）\n`);

console.log('二、每題作答時間');
console.log(`   p25 ${ms(report.elapsedMs.p25)}　中位數 ${ms(report.elapsedMs.median)}　p75 ${ms(report.elapsedMs.p75)}\n`);

console.log('三、連對長度分佈（每場戰鬥的最長連對）');
if (report.maxStreakHistogram.length === 0) {
  console.log('   沒有資料');
} else {
  report.maxStreakHistogram.forEach((count, streak) => {
    console.log(`   連對 ${streak}　${'█'.repeat(count)} ${count}`);
  });
}
console.log('   幾乎沒人連到 3 以上的話，加成設計沒被感知到\n');

console.log('四、單場放棄率');
console.log(`   打完 ${report.battlesFinished} 場，中途離開 ${report.abandoned} 場　${pct(report.abandonRate)}\n`);

console.log('五、首次佔下三塊地耗時');
if (report.timeToThreeTilesMs.length === 0) {
  console.log('   沒有人佔到三塊地');
} else {
  for (const value of report.timeToThreeTilesMs) {
    console.log(`   ${ms(value)}`);
  }
}
console.log('   可玩定義是五分鐘內\n');

console.log('診斷拆解');
console.log('   地格   出題  跳題   答對率   勝率');
for (const row of report.byTileLevel) {
  const acc = row.accuracy === null ? '—' : pct(row.accuracy);
  const win = row.winRate === null ? '—' : `${pct(row.winRate)} (${row.won}/${row.battles})`;
  console.log(
    `   LV.${row.level}${String(row.questionsShown).padStart(7)}${String(row.skipped).padStart(6)}${acc.padStart(9)}${win.padStart(14)}`,
  );
}
console.log('   勝率若隨等級崩掉，問題是難度曲線而不是玩家不想學\n');

console.log('   回合   沒在讀題');
report.disengageByRound.forEach((value, index) => {
  console.log(`   第 ${index + 1} 回合${(value === null ? '—' : pct(value)).padStart(9)}`);
});
console.log('   越後面越高，代表玩家已經知道這場輸了還被迫繼續答\n');

console.log('   之前連敗   沒在讀題');
report.disengageByLosingStreak.forEach((value, index) => {
  const label = index === report.disengageByLosingStreak.length - 1 ? `${index} 場以上` : `${index} 場`;
  console.log(`   ${label.padEnd(9)}${(value === null ? '—' : pct(value)).padStart(9)}`);
});
console.log('   輸掉之後才開始亂點，是挫折不是無視\n');

const verdict = {
  pass: '通過——亂猜跳題率在喊停線以下，可以往 v0.2 走',
  fail: '未通過——停下來重做設計，不要加內容',
  'not-enough-data': '樣本不足，#7 要求至少五個人的資料',
}[report.verdict];

console.log(`結論：${verdict}\n`);

process.exit(report.verdict === 'fail' ? 1 : 0);
