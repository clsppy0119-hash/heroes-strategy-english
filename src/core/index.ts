/**
 * 遊戲規則層。
 *
 * 這個資料夾的規約（由 scripts/check-core-purity.mjs 強制）：
 *  - 純函式，輸入與輸出都是可序列化的資料
 *  - 不得 import react / next / 任何 UI 相依
 *  - 不得使用 window、document、localStorage、fetch、process
 *  - 不得使用 Date.now() 或 Math.random()——時間與亂數一律由參數注入
 *
 * 目的是讓 v0.2 能把整包搬到伺服器，而不是重寫一次。
 */

export { RULES_VERSION, type RulesVersion } from './rules';
export { seedFrom, nextFloat, nextInt, shuffle, type RngState } from './rng';

export {
  BASE_DAMAGE_RATE,
  CRIT_BASE,
  CRIT_MAX,
  CRIT_STEP,
  GRAIN_PER_OWNED_TILE,
  MARCH_COST,
  MAX_ROUNDS,
  START_GRAIN,
  START_TROOPS,
  TILE_STATS,
  vocabLevelForTile,
} from './config';

export {
  GRID_SIZE,
  canMarchTo,
  counterFor,
  createMap,
  defenderHpFor,
  findTile,
  isAdjacent,
  marchableTiles,
  tileId,
  type Tile,
  type TileId,
} from './map';

export {
  abandonBattle,
  currentQuestion,
  multiplierFor,
  resolveRound,
  startBattle,
  type BattleOutcome,
  type BattleState,
  type RoundQuestion,
  type RoundResult,
  type StartBattleInput,
} from './battle';

export {
  answerRound,
  battleId,
  battleSeed,
  beginMarch,
  capturedCount,
  createGame,
  dismissBattle,
  marchBlockedReason,
  ownedCount,
  retreat,
  type GameState,
  type GameStatus,
  type MarchBlockedReason,
} from './game';
