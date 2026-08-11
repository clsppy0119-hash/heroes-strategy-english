import { readFileSync } from 'node:fs';
import process from 'node:process';

import { listFiles, positionAt, report, stripComments } from './lib/source-scan.mjs';

/**
 * 約束一：元件裡不得出現硬編中文，全部走 i18n key。
 *
 * v0.1 只有繁中一種語系，這條規則現在沒有任何好處——它是為了之後。
 * 等到真的要加第二種語言才回頭抽字串，等於全站掃一次；現在擋住成本接近零。
 *
 * 註解裡的中文不算（掃描前會先移掉註解），locale 檔本身也不掃。
 */

const ROOT = 'src';
const IGNORE = ['i18n/locales'];
const EXTENSIONS = ['.ts', '.tsx'];
const TEST_FILE = /\.test\.tsx?$/;

// CJK 統一漢字、擴充 A、相容漢字、中日韓標點、全形標點。
const CJK = /[　-〿㐀-䶿一-鿿豈-﫿！-｠]/g;

const violations = [];

for (const file of listFiles(ROOT, { extensions: EXTENSIONS, ignore: IGNORE })) {
  // 測試檔的敘述用中文寫比較讀得懂，且不會出現在畫面上。
  if (TEST_FILE.test(file)) {
    continue;
  }

  const source = readFileSync(`${ROOT}/${file}`, 'utf8');
  const code = stripComments(source);

  CJK.lastIndex = 0;
  let match;
  while ((match = CJK.exec(code)) !== null) {
    const { line, column } = positionAt(code, match.index);
    const snippet = source.slice(match.index, match.index + 20).split('\n')[0];
    violations.push({
      file: `${ROOT}/${file}`,
      line,
      column,
      message: `硬編中文「${snippet}」——請移到 src/i18n/locales/zh-TW.json 並改用 t()`,
    });
    // 同一行只回報一次，不然一句話會噴十幾筆。
    const lineEnd = code.indexOf('\n', match.index);
    CJK.lastIndex = lineEnd === -1 ? code.length : lineEnd;
  }
}

process.exit(report('元件內沒有硬編中文', violations));
