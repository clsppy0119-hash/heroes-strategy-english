import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import process from 'node:process';

/**
 * 確認 src/content/vocab.generated.ts 跟 content/vocab.v1.csv 同步。
 *
 * 沒有這道檢查，改了 CSV 卻忘了跑 gen:vocab 的話，遊戲會安靜地繼續用舊題庫——
 * 這種錯誤不會有任何症狀，直到有人發現新加的字從來沒出現過。
 */

const TARGET = 'src/content/vocab.generated.ts';

/** 換行正規化後再比：不然 Windows 的 CRLF checkout 會永遠判定成不同步。 */
const read = () => readFileSync(TARGET, 'utf8').replace(/\r\n/g, '\n');

const before = read();
execFileSync(process.execPath, ['scripts/gen-vocab.mjs'], { stdio: 'inherit' });
const after = read();

if (before !== after) {
  console.error(`✗ ${TARGET} 與 CSV 不同步。請跑 pnpm gen:vocab 並把結果一起提交。`);
  process.exit(1);
}

console.log('✓ 題庫與 CSV 同步');
