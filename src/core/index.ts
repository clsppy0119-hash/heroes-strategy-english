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

export {
  SAVE_VERSION,
  packSave,
  readSave,
  type LoadFailure,
  type LoadResult,
  type SaveEnvelope,
} from './save';
export { seedFrom, nextFloat, nextInt, shuffle, type RngState } from './rng';

export {
  BASE_DAMAGE_RATE,
  COUNTER_BY_LEVEL,
  CRIT_BASE,
  CRIT_MAX,
  CRIT_STEP,
  GRAIN_PER_BATTLE,
  GRAIN_PER_TILE_PER_HOUR,
  HOUR_MS,
  MARCH_BASE_MS,
  MARCH_COST,
  MARCH_MS_PER_STEP,
  MAX_OFFLINE_MS,
  MAX_LEVEL,
  MAX_ROUNDS,
  START_GRAIN,
  START_TROOPS,
  requiredCorrect,
  roundsFor,
  vocabLevelForTile,
} from './config';

export { counterFor, defenderHpFor } from './derive';

export {
  BUILDING_IDS,
  BUILDING_SPECS,
  FARM_BONUS_PER_LEVEL,
  GRANARY_BONUS_MS,
  RELAY_BONUS_PER_LEVEL,
  createBuildings,
  grainPerHour,
  marchSpeedFactor,
  maxLevelOf,
  offlineCapMs,
  upgradeCost,
  upgradeMs,
  type Building,
  type BuildingId,
  type BuildingSpec,
  type Buildings,
} from './buildings';

export { accrueGrain, msPerGrain, type Accrual } from './time';

export {
  hasArrived,
  marchDurationMs,
  marchProgress,
  remainingMs,
  startMarch,
  type March,
} from './march';

export {
  CITY_X,
  CITY_Y,
  GRID_SIZE,
  canMarchTo,
  createMap,
  distanceFromCity,
  findTile,
  isAdjacent,
  levelForDistance,
  marchHeadIndex,
  marchPath,
  marchableTiles,
  tileId,
  type Terrain,
  type Tile,
  type TileId,
} from './map';

export {
  abandonBattle,
  currentQuestion,
  maxRemainingDamage,
  minRemainingDamage,
  multiplierFor,
  previewDamage,
  previewMultiplier,
  resolveRound,
  startBattle,
  type BattleOutcome,
  type BattleState,
  type LossReason,
  type RoundQuestion,
  type RoundResult,
  type StartBattleInput,
} from './battle';

export {
  answerRound,
  battleId,
  battleSeed,
  capturedCount,
  createGame,
  dismissBattle,
  engageBattle,
  isUnderConstruction,
  marchBlockedReason,
  marchHasArrived,
  orderMarch,
  ownedCount,
  recallMarch,
  resumeGame,
  retreat,
  settleTime,
  startClock,
  startUpgrade,
  upgradeBlockedReason,
  CLOCK_NOT_STARTED,
  type GameState,
  type GameStatus,
  type MarchBlockedReason,
  type UpgradeBlockedReason,
} from './game';
