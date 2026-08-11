import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';

/**
 * 把 content/vocab.v1.csv 轉成 TypeScript。
 *
 * 為什麼要多這一步：CSV 是給人編輯的來源，但 Next 不能直接 import CSV，
 * 而在執行期讀檔又會把題庫綁死在伺服器端。產生一份 .ts 檔最單純，
 * CI 會檢查它跟 CSV 同步（scripts/check-vocab-sync.mjs），
 * 所以換題庫還是只要改 CSV 再跑一次 pnpm gen:vocab。
 */

const SOURCE = 'content/vocab.v1.csv';
const TARGET = 'src/content/vocab.generated.ts';
const COLUMNS = ['id', 'en', 'zh', 'level', 'source'];
const MIN_ENTRIES_PER_LEVEL = 6;

/** 這份 CSV 不含引號與逗號欄位，所以不需要完整的 CSV parser——但要驗證這件事成立。 */
function parseCsv(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const header = lines[0].split(',');
  if (header.join(',') !== COLUMNS.join(',')) {
    throw new Error(`${SOURCE} 的欄位應該是 ${COLUMNS.join(',')}，實際是 ${header.join(',')}`);
  }

  return lines.slice(1).map((line, index) => {
    if (line.includes('"')) {
      throw new Error(`${SOURCE}:${index + 2} 含有引號，這個 parser 不支援`);
    }
    const cells = line.split(',');
    if (cells.length !== COLUMNS.length) {
      throw new Error(`${SOURCE}:${index + 2} 有 ${cells.length} 欄，應該是 ${COLUMNS.length}`);
    }
    const [id, en, zh, level, source] = cells;
    const parsedLevel = Number(level);
    if (!Number.isInteger(parsedLevel) || parsedLevel < 1) {
      throw new Error(`${SOURCE}:${index + 2} 的 level「${level}」不是正整數`);
    }
    return { id, en, zh, level: parsedLevel, source };
  });
}

function validate(entries) {
  const problems = [];

  const seenId = new Set();
  const seenEn = new Set();
  const seenZh = new Set();
  for (const entry of entries) {
    if (seenId.has(entry.id)) problems.push(`id 重複：${entry.id}`);
    if (seenEn.has(entry.en)) problems.push(`英文重複：${entry.en}`);
    // 中文重複會讓同一題出現兩個看起來一樣的選項。
    if (seenZh.has(entry.zh)) problems.push(`中文重複：${entry.zh}`);
    seenId.add(entry.id);
    seenEn.add(entry.en);
    seenZh.add(entry.zh);
    if (!/^[a-z][a-z' -]*$/.test(entry.en)) {
      problems.push(`${entry.id} 的英文「${entry.en}」含有非預期字元`);
    }
  }

  const byLevel = new Map();
  for (const entry of entries) {
    byLevel.set(entry.level, (byLevel.get(entry.level) ?? 0) + 1);
  }
  for (const [level, count] of [...byLevel].sort((a, b) => a[0] - b[0])) {
    // 一場戰鬥要抽滿 MAX_ROUNDS 題，抽不滿的話玩家一按「出兵」就會炸。
    // 這個下限比「四選一需要四個干擾項」更嚴，所以只檢查它就夠。
    // 權威定義在 src/content/static-provider.ts 的 MIN_ENTRIES_PER_LEVEL，
    // 那邊是從 core 的 MAX_ROUNDS 算出來的；這裡是給 CSV 用的早期攔截。
    if (count < MIN_ENTRIES_PER_LEVEL) {
      problems.push(`level ${level} 只有 ${count} 個詞，一場戰鬥要抽 ${MIN_ENTRIES_PER_LEVEL} 題`);
    }
  }

  return problems;
}

function render(entries) {
  const rows = entries
    .map(
      (e) =>
        `  { id: '${e.id}', en: '${e.en}', zh: '${e.zh}', level: ${e.level}, source: '${e.source}' },`,
    )
    .join('\n');

  return `// 由 scripts/gen-vocab.mjs 從 ${SOURCE} 產生，不要手動編輯。
// 改題庫請改 CSV，然後跑 pnpm gen:vocab。

import type { VocabEntry } from './static-provider';

export const VOCAB_SOURCE = '${SOURCE}';

export const VOCAB: readonly VocabEntry[] = [
${rows}
];
`;
}

const entries = parseCsv(readFileSync(SOURCE, 'utf8'));
const problems = validate(entries);

if (problems.length > 0) {
  console.error(`✗ ${SOURCE} 有問題：`);
  for (const problem of problems) {
    console.error(`  ${problem}`);
  }
  process.exit(1);
}

writeFileSync(TARGET, render(entries), 'utf8');
console.log(`✓ ${TARGET} — ${entries.length} 個詞`);
