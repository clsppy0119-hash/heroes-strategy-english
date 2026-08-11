/**
 * 遊戲規則層。
 *
 * 這個資料夾的規約（由 scripts/check-core-purity.mjs 強制）：
 *  - 純函式，輸入與輸出都是可序列化的資料
 *  - 不得 import react / next / 任何 UI 相依
 *  - 不得使用 window、document、localStorage、fetch、process
 *  - 不得使用 Date.now() 或 Math.random()——時間與亂數一律由參數注入
 *
 * 目的是讓 v0.2 能把整包搬到伺服器執行，而不是重寫一次。
 */

export { RULES_VERSION, type RulesVersion } from './rules';
export { seedFrom, nextFloat, nextInt, shuffle, type RngState } from './rng';
