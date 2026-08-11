import { spawnSync } from 'node:child_process';
import process from 'node:process';

/**
 * 把遊戲輸出成一包靜態檔（out/），可以丟到任何靜態託管。
 *
 *   pnpm build:static
 *   pnpm build:static --base-path /heroes-strategy-english
 *
 * 存在的理由是 #7：沒有人會為了幫忙測一個遊戲去 clone repo 跑 pnpm，
 * 要能給出一個連結。
 *
 * 用腳本而不是直接在 package.json 裡設環境變數，是因為 Windows 的 cmd
 * 不吃 `FOO=1 next build` 那種寫法，而為了兩個環境變數多裝 cross-env 不值得。
 */

const args = process.argv.slice(2);
const flagIndex = args.indexOf('--base-path');
const basePath = flagIndex === -1 ? (process.env.BASE_PATH ?? '') : (args[flagIndex + 1] ?? '');

if (basePath && !basePath.startsWith('/')) {
  console.error(`--base-path 要以 / 開頭，收到「${basePath}」`);
  process.exit(1);
}

console.log(basePath ? `靜態輸出，base path ${basePath}` : '靜態輸出，放在網域根目錄');

const result = spawnSync('node', ['node_modules/next/dist/bin/next', 'build'], {
  stdio: 'inherit',
  env: { ...process.env, STATIC_EXPORT: '1', BASE_PATH: basePath },
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

console.log('\n✓ out/ 已產生。整包丟到任何靜態託管就能玩，不需要 Node 伺服器。');
