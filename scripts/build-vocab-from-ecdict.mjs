import { createReadStream, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import process from 'node:process';

import * as OpenCC from 'opencc-js';

/**
 * 從 ECDICT 產生題庫。
 *
 *   node scripts/build-vocab-from-ecdict.mjs <ecdict.csv 的路徑>
 *
 * ECDICT（https://github.com/skywind3000/ECDICT，MIT 授權）有 77 萬筆
 * 英漢對照，附 BNC/COCA 詞頻與考試標籤。原始檔 65MB，**刻意不進 repo**——
 * 它是產生器的輸入，不是專案的一部分。要重跑就照上面的網址抓一份。
 *
 * ## 這支程式在解決的問題
 *
 * ECDICT 的釋義是字典格式：
 *
 *   n. 罩；风帽；（布质）面罩\nv. 覆盖；用头巾包\n[网络] 胡德；兜帽
 *
 * 四選一的按鈕塞不下這種東西，玩家也不該在一堆分號裡找答案。所以要清洗成
 * 一個短詞。清洗規則寧可嚴格：清不出乾淨結果的字直接丟掉——題庫少一個字
 * 沒關係，出一題看不懂的題目才是問題。
 *
 * ## 簡繁
 *
 * ECDICT 是簡體，用 OpenCC 的 s2twp（台灣正體＋台灣慣用詞）一次轉完。
 * 轉換發生在建置期，不進執行期。
 */

const SOURCE_URL = 'https://github.com/skywind3000/ECDICT';
const TARGET = 'content/vocab.v1.csv';

/** 每個等級要幾個詞。取夠多讓複習池有東西排，又不會把 bundle 撐爆。 */
const PER_LEVEL = 260;

/**
 * 等級由 COCA 詞頻排名決定。
 *
 * 分三級是為了對上地圖的三種地格等級（core 的 vocabLevelForTile）。
 * 邊界不是精算出來的——重點是「越裡面的地出越常用的字」，
 * 而不是某個特定的排名數字有什麼意義。
 */
const LEVEL_BANDS = [
  { level: 1, min: 1, max: 1200 },
  { level: 2, min: 1201, max: 3500 },
  { level: 3, min: 3501, max: 9000 },
];

/** 詞性標記。清洗時要剝掉。 */
const POS_PREFIX = /^\s*(?:[a-z]{1,4}\.\s*)+/;

/**
 * 不考的虛詞。
 *
 * 這份表是手寫的，因為 ECDICT 的 `pos` 欄位對這些字**正好都是空的**——
 * 越常見的字越沒有詞性統計，而虛詞就是最常見的那些。第一版靠 pos 過濾，
 * 結果 level 1 整片是 the/that/for/they，一個都沒擋掉。
 *
 * 收的是冠詞、代名詞、介系詞、連接詞、助動詞與純語法副詞。
 * 「always / never / almost / enough」這種有實義的副詞刻意留著——
 * 它們考得出對錯，也背得起來。
 */
const FUNCTION_WORDS = new Set(
  `a an the
   i you he she it we they me him her us them
   my your his its our their mine yours hers ours theirs
   this that these those who whom whose which what
   myself yourself himself herself itself ourselves themselves
   some any each every all both none other others such
   be am is are was were been being
   have has had having do does did done doing
   will would shall should can could may might must ought
   about above across after against along among around as at
   before behind below beneath beside besides between beyond by
   despite down during except for from in inside into near
   of off on onto out outside over past since through throughout
   till to toward towards under underneath until unto up upon with within without
   and but or nor so yet if because although though unless while whereas whether than
   not very too also just only even still again
   here there when where why how then thus hence
   yes ok okay`
    .split(/\s+/)
    .filter((word) => word.length > 0),
);

/**
 * 中文釋義的長度界線。
 *
 * 下限是 1 不是 2：中文的單字釋義（有、說、看、去）完全合格，而且往往
 * 就是那個字最核心的意思。第一版設成 2，結果 `have` 的第一義「有」被擋掉，
 * 程式往下掉到第二行的「aux. 已经」，產出 have→已經。
 * 界線設錯比資料錯更難發現，因為每一筆看起來都像正常的中文。
 */
const MIN_GLOSS = 1;
const MAX_GLOSS = 6;

const converter = OpenCC.Converter({ from: 'cn', to: 'twp' });

/** 一行 CSV，處理引號內的逗號與換行已在讀取階段合併。 */
function splitCsvLine(line) {
  const cells = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      cells.push(cell);
      cell = '';
    } else {
      cell += char;
    }
  }
  cells.push(cell);
  return cells;
}

/**
 * 把字典釋義洗成一個短詞。洗不乾淨就回 null。
 *
 * ## 只看第一行，不往下找
 *
 * 字典的第一行是主要詞性的主要語意；往下是次要詞性。第一版在第一行
 * 洗不出結果時會往下掉，結果 `say` 洗到第三行的「n. 意見」，
 * `have` 洗到第二行的「aux. 已經」——都是文法上正確、對玩家卻是錯的答案。
 *
 * 現在洗不出來就整個字丟掉。候選有幾千個，每級只要 260 個，
 * 用嚴格換乾淨很划算。
 *
 * 順序有意義：先剝詞性再取語意再量長度。反過來的話「n. 」會被算進長度。
 */
function cleanGloss(translation) {
  const first =
    translation
      .split(/\\n|\n/)
      .map((line) => line.trim())
      // [网络] / [计] 是網路用語與領域縮寫，不是這個字的一般意思。
      .find((line) => line.length > 0 && !line.startsWith('[') && !line.startsWith('（')) ?? '';

  const withoutPos = first.replace(POS_PREFIX, '');
  // 取第一個語意：分號、逗號、頓號都算分隔。
  const sense = withoutPos.split(/[；;，,、]/)[0] ?? '';
  // 括號裡的是補充說明，按鈕上放不下。
  const gloss = sense.replace(/[（(][^）)]*[）)]/g, '').trim();

  if (gloss.length < MIN_GLOSS || gloss.length > MAX_GLOSS) {
    return null;
  }
  // 只要純中文：夾雜英文或數字的多半是沒洗乾淨的殘留。
  return /^[一-鿿]+$/.test(gloss) ? gloss : null;
}

async function main() {
  const input = process.argv[2];
  if (input === undefined) {
    console.error('用法：node scripts/build-vocab-from-ecdict.mjs <ecdict.csv>');
    console.error(`ECDICT 原始檔請從 ${SOURCE_URL} 取得（MIT 授權，65MB，不進 repo）。`);
    process.exit(1);
  }

  const candidates = new Map(); // level -> entries
  for (const band of LEVEL_BANDS) {
    candidates.set(band.level, []);
  }

  const reader = createInterface({ input: createReadStream(input, 'utf8'), crlfDelay: Infinity });
  let header = null;
  let scanned = 0;

  for await (const line of reader) {
    if (header === null) {
      header = splitCsvLine(line);
      continue;
    }
    if (line.trim() === '') {
      continue;
    }
    scanned += 1;
    const cells = splitCsvLine(line);
    if (cells.length < header.length) {
      continue;
    }
    const row = Object.fromEntries(header.map((name, i) => [name, cells[i] ?? '']));

    const word = row.word.trim();
    // 產生器只收單字小寫。專有名詞、片語、縮寫都不適合當四選一的題目。
    if (!/^[a-z]{3,}$/.test(word)) {
      continue;
    }
    if (FUNCTION_WORDS.has(word)) {
      continue;
    }

    const rank = Number(row.frq) || 0;
    const band = LEVEL_BANDS.find((each) => rank >= each.min && rank <= each.max);
    if (band === undefined) {
      continue;
    }

    const gloss = cleanGloss(converter(row.translation));
    if (gloss === null) {
      continue;
    }

    candidates.get(band.level).push({ en: word, zh: gloss, rank });
  }

  // 每級取最常用的那些，中文重複的丟掉——同一題出現兩個一樣的選項是實質的 bug。
  const seenZh = new Set();
  const chosen = [];
  for (const band of LEVEL_BANDS) {
    const pool = candidates.get(band.level).sort((a, b) => a.rank - b.rank);
    let taken = 0;
    for (const entry of pool) {
      if (taken >= PER_LEVEL) {
        break;
      }
      if (seenZh.has(entry.zh)) {
        continue;
      }
      seenZh.add(entry.zh);
      chosen.push({ ...entry, level: band.level });
      taken += 1;
    }
    console.log(`  level ${band.level}：候選 ${pool.length}，採用 ${taken}`);
  }

  const rows = chosen.map(
    (entry, i) => `v${String(i + 1).padStart(4, '0')},${entry.en},${entry.zh},${entry.level},ecdict-v1`,
  );
  writeFileSync(TARGET, `id,en,zh,level,source\n${rows.join('\n')}\n`, 'utf8');

  console.log(`✓ ${TARGET} — 掃過 ${scanned.toLocaleString()} 筆，產出 ${chosen.length} 個詞`);
  console.log('  接著跑 pnpm gen:vocab 產生 TypeScript。');
}

await main();
