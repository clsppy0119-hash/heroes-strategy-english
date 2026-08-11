import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * 逐字元掃描，把註解換成等長的空白，字串內容原樣保留。
 *
 * 用正則移註解會在 "https://..." 這種字串上誤判，所以老老實實走狀態機。
 * 換成等長空白是為了讓行號與欄位保持正確，回報位置時才指得準。
 */
export function stripComments(source) {
  const out = [];
  let i = 0;
  const n = source.length;
  let state = 'code';
  let quote = '';

  const blank = (ch) => (ch === '\n' ? '\n' : ' ');

  while (i < n) {
    const ch = source[i];
    const next = source[i + 1];

    if (state === 'code') {
      if (ch === '/' && next === '/') {
        state = 'line-comment';
        out.push('  ');
        i += 2;
        continue;
      }
      if (ch === '/' && next === '*') {
        state = 'block-comment';
        out.push('  ');
        i += 2;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') {
        state = 'string';
        quote = ch;
        out.push(ch);
        i += 1;
        continue;
      }
      out.push(ch);
      i += 1;
      continue;
    }

    if (state === 'line-comment') {
      if (ch === '\n') {
        state = 'code';
        out.push('\n');
      } else {
        out.push(' ');
      }
      i += 1;
      continue;
    }

    if (state === 'block-comment') {
      if (ch === '*' && next === '/') {
        state = 'code';
        out.push('  ');
        i += 2;
        continue;
      }
      out.push(blank(ch));
      i += 1;
      continue;
    }

    // state === 'string'
    if (ch === '\\') {
      out.push(ch, next ?? '');
      i += 2;
      continue;
    }
    if (ch === quote) {
      state = 'code';
      quote = '';
    }
    out.push(ch);
    i += 1;
  }

  return out.join('');
}

/** 遞迴列出符合副檔名的檔案，回傳相對於 root 的 POSIX 路徑。 */
export function listFiles(root, { extensions, ignore = [] }) {
  const results = [];
  const ignoreSet = new Set(ignore);

  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const rel = relative(root, full).split(sep).join('/');
      if (ignoreSet.has(rel) || ignore.some((prefix) => rel.startsWith(`${prefix}/`))) {
        continue;
      }
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (extensions.some((ext) => entry.endsWith(ext))) {
        results.push(rel);
      }
    }
  };

  walk(root);
  return results.sort();
}

/** 把字元位移換成 1-indexed 的行列，用來回報位置。 */
export function positionAt(source, index) {
  let line = 1;
  let column = 1;
  for (let i = 0; i < index; i += 1) {
    if (source[i] === '\n') {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { line, column };
}

export function report(title, violations) {
  if (violations.length === 0) {
    console.log(`✓ ${title}`);
    return 0;
  }
  console.error(`✗ ${title} — ${violations.length} 處`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}:${v.column}  ${v.message}`);
  }
  return 1;
}
