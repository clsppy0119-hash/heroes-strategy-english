import { readFileSync } from 'node:fs';
import process from 'node:process';

import { listFiles, positionAt, report, stripComments } from './lib/source-scan.mjs';

/**
 * 約束三：src/core 必須能整塊搬到伺服器執行。
 *
 * 這代表：純函式、不碰 UI、不碰瀏覽器、不自己取時間或亂數。
 * 時間與亂數一律由參數注入，否則同一場戰鬥在客戶端與伺服器會算出不同結果，
 * v0.2 要做伺服器權威時就得整段重寫。
 */

const ROOT = 'src/core';
const EXTENSIONS = ['.ts'];
const TEST_FILE = /\.test\.ts$/;

const BANNED_IMPORTS = [
  { pattern: /from\s+['"]react['"]/g, why: 'core 不得相依 React' },
  { pattern: /from\s+['"]react-dom[^'"]*['"]/g, why: 'core 不得相依 React DOM' },
  { pattern: /from\s+['"]next[/'"]/g, why: 'core 不得相依 Next.js' },
  { pattern: /from\s+['"]@\/(analytics|i18n|content|app)[^'"]*['"]/g, why: 'core 不得相依外層模組' },
];

const BANNED_GLOBALS = [
  { pattern: /\bwindow\b/g, why: 'core 不得使用 window' },
  { pattern: /\bdocument\b/g, why: 'core 不得使用 document' },
  { pattern: /\blocalStorage\b/g, why: 'core 不得使用 localStorage' },
  { pattern: /\bsessionStorage\b/g, why: 'core 不得使用 sessionStorage' },
  { pattern: /\bfetch\s*\(/g, why: 'core 不得發網路請求' },
  { pattern: /\bprocess\./g, why: 'core 不得讀環境變數' },
  { pattern: /\bMath\.random\b/g, why: 'core 不得使用 Math.random，亂數請用 rng.ts 並由參數注入 seed' },
  { pattern: /\bDate\.now\b/g, why: 'core 不得自己取時間，請由參數注入' },
  { pattern: /\bnew\s+Date\b/g, why: 'core 不得自己取時間，請由參數注入' },
];

const violations = [];

for (const file of listFiles(ROOT, { extensions: EXTENSIONS })) {
  if (TEST_FILE.test(file)) {
    continue;
  }

  const source = readFileSync(`${ROOT}/${file}`, 'utf8');
  const code = stripComments(source);

  for (const { pattern, why } of [...BANNED_IMPORTS, ...BANNED_GLOBALS]) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(code)) !== null) {
      const { line, column } = positionAt(code, match.index);
      violations.push({ file: `${ROOT}/${file}`, line, column, message: why });
    }
  }
}

process.exit(report('src/core 保持純淨且可搬到伺服器', violations));
