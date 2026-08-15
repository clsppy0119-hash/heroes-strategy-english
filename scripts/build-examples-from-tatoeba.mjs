import { createReadStream, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import process from 'node:process';

import * as OpenCC from 'opencc-js';

/**
 * 從 Tatoeba 產生例句。
 *
 *   node scripts/build-examples-from-tatoeba.mjs <eng_sentences.tsv> <cmn_sentences.tsv> <links.csv>
 *
 * Tatoeba（https://tatoeba.org，CC BY 2.0 FR）的句子由使用者貢獻，附各語言的
 * 對譯。三個原始檔加起來約 175MB，**刻意不進 repo**——跟 ECDICT 一樣，
 * 它們是產生器的輸入，不是專案的一部分。
 *
 *   https://downloads.tatoeba.org/exports/per_language/eng/eng_sentences.tsv.bz2
 *   https://downloads.tatoeba.org/exports/per_language/cmn/cmn_sentences.tsv.bz2
 *   https://downloads.tatoeba.org/exports/links.tar.bz2
 *
 * 官方沒有「英中對照」的靜態匯出（那個要用網站上的互動工具產），所以這裡
 * 自己接：英文句子 →（links）→ 中文句子。
 *
 * ## 挑句子的原則：短
 *
 * 例句是在玩家剛答完一題、注意力正要離開的時候出現的。長句子等於沒出現。
 * 所以同一個字有很多句可選時一律挑最短的——短句的文法也單純，
 * 剛學會這個字的人讀得動。
 *
 * ## 這裡沒有解決的問題
 *
 * 句子裡的字義**不保證**跟題目考的那個語意一致。`like` 考「喜歡」，
 * 但抓到的句子可能用的是「像」。要真正解掉需要詞義消歧，那不是這一刀的事。
 * 現況是：短句 + 人工複審，跟釋義的處理方式一致。
 */

const VOCAB = 'content/vocab.v1.csv';
const TARGET = 'content/examples.v1.tsv';

/** 每個字先留幾個候選。留太少會在「找不到中譯」時沒有備胎。 */
const CANDIDATES_PER_WORD = 12;

/** 例句長度的界線。太短沒有上下文，太長玩家不會讀。 */
const MIN_CHARS = 12;
const MAX_CHARS = 70;

/** 中譯的長度上限。超過就是原句太複雜，連帶不適合當例句。 */
const MAX_ZH_CHARS = 40;

const converter = OpenCC.Converter({ from: 'cn', to: 'twp' });

function targetWords() {
  const lines = readFileSync(VOCAB, 'utf8').split(/\r?\n/).filter((line) => line.trim() !== '');
  return lines.slice(1).map((line) => {
    const [id, en] = line.split(',');
    return { id, en };
  });
}

/** 句子拆成小寫單字。用來判斷「這句有沒有出現這個字」，不做詞形還原。 */
function tokens(text) {
  return text.toLowerCase().match(/[a-z']+/g) ?? [];
}

async function eachLine(path, onLine) {
  const reader = createInterface({ input: createReadStream(path, 'utf8'), crlfDelay: Infinity });
  for await (const line of reader) {
    if (line !== '') {
      onLine(line);
    }
  }
}

async function main() {
  const [engPath, cmnPath, linksPath] = process.argv.slice(2);
  if (engPath === undefined || cmnPath === undefined || linksPath === undefined) {
    console.error('用法：node scripts/build-examples-from-tatoeba.mjs <eng.tsv> <cmn.tsv> <links.csv>');
    console.error('原始檔請見這支程式開頭的網址（CC BY 2.0 FR，不進 repo）。');
    process.exit(1);
  }

  const words = targetWords();
  const wanted = new Map(words.map((word) => [word.en, []]));
  console.log(`目標 ${words.length} 個字`);

  // 一、中文句子先進記憶體。這個檔小（約 5 萬句），而且後面兩步都要查它。
  const cmn = new Map();
  await eachLine(cmnPath, (line) => {
    const [id, , text] = line.split('\t');
    if (text !== undefined) {
      cmn.set(id, text);
    }
  });
  console.log(`  中文句子 ${cmn.size.toLocaleString()} 句`);

  /*
    二、先找出「有中譯」的英文句子 id。

    順序很重要。第一版是先挑最短的十二句、再看有沒有中譯，結果 780 個字
    只有 350 個找得到例句——因為 190 萬句英文裡只有 4.6% 有中譯，
    「最短的十二句」幾乎不會落在那 4.6% 裡面。

    倒過來做：先把有中譯的圈出來，再在裡面挑最短的。同樣的資料，
    覆蓋率差一倍以上。
  */
  const translation = new Map();
  await eachLine(linksPath, (line) => {
    const [left, right] = line.split('\t');
    const zh = cmn.get(right);
    if (zh !== undefined && zh.length <= MAX_ZH_CHARS && !translation.has(left)) {
      translation.set(left, zh);
    }
  });
  console.log(`  有中譯的句子 ${translation.size.toLocaleString()} 句`);

  /*
    三、掃英文句子，每個字留最短的幾句。

    不要對每一句跑 780 次比對——那是十幾億次操作。改成把句子拆成字集合，
    再看集合裡有沒有目標字，一句只花它自己的長度。
  */
  let scanned = 0;
  await eachLine(engPath, (line) => {
    const [id, , text] = line.split('\t');
    if (text === undefined || text.length < MIN_CHARS || text.length > MAX_CHARS) {
      return;
    }
    if (!translation.has(id)) {
      return;
    }
    scanned += 1;
    for (const token of new Set(tokens(text))) {
      const bucket = wanted.get(token);
      if (bucket === undefined) {
        continue;
      }
      bucket.push({ id, text });
      // 只留最短的幾句，避免整個語料庫都塞進記憶體。
      if (bucket.length > CANDIDATES_PER_WORD * 4) {
        bucket.sort((a, b) => a.text.length - b.text.length);
        bucket.length = CANDIDATES_PER_WORD;
      }
    }
  });
  console.log(`  其中長度合適又有中譯的 ${scanned.toLocaleString()} 句`);

  for (const bucket of wanted.values()) {
    bucket.sort((a, b) => a.text.length - b.text.length);
    bucket.length = Math.min(bucket.length, CANDIDATES_PER_WORD);
  }

  // 四、每個字挑最短的那一句。
  const rows = [];
  let missing = 0;
  for (const word of words) {
    const picked = (wanted.get(word.en) ?? [])[0];
    if (picked === undefined) {
      missing += 1;
      continue;
    }
    const zh = converter(translation.get(picked.id)).replace(/\s+/g, ' ').trim();
    const en = picked.text.replace(/\s+/g, ' ').trim();
    // TSV：句子裡不會有 tab，但保險起見擋掉。
    if (en.includes('\t') || zh.includes('\t')) {
      missing += 1;
      continue;
    }
    rows.push(`${word.id}\t${en}\t${zh}`);
  }

  writeFileSync(TARGET, `id\ten\tzh\n${rows.join('\n')}\n`, 'utf8');
  console.log(`✓ ${TARGET} — ${rows.length} 句（${missing} 個字沒找到合適的例句）`);
  console.log('  接著跑 pnpm gen:vocab 產生 TypeScript。');
}

await main();
