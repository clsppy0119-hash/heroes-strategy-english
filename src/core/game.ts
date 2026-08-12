import { GRAIN_PER_BATTLE, MARCH_COST, START_GRAIN } from './config';
import { accrueGrain } from './time';
import {
  abandonBattle,
  resolveRound as resolveBattleRound,
  startBattle,
  type BattleState,
  type RoundQuestion,
} from './battle';
import { canMarchTo, createMap, findTile, type Tile, type TileId } from './map';
import { hasArrived, startMarch, type March } from './march';
import { RULES_VERSION, type RulesVersion } from './rules';
import { seedFrom, type RngState } from './rng';

/**
 * 整局的狀態機。
 *
 * 純函式、可序列化。v0.2 要把結算搬到伺服器時，搬的就是這個檔案跟它的相依，
 * 不用重寫——這是 scripts/check-core-purity.mjs 在守的東西。
 */

/**
 * `stuck` 在 v0.1 是「這一局結束了」，v0.2 起是「等糧」。
 *
 * 時間會自己把糧補回來（settleTime 補到夠出兵就解除），所以它不再是失敗狀態
 * 而是一個等待狀態。介面文案要跟著改——把等待寫成 game over 會讓玩家關掉分頁。
 */
export type GameStatus = 'playing' | 'cleared' | 'stuck';

export interface GameState {
  readonly rulesVersion: RulesVersion;
  readonly seed: RngState;
  readonly tiles: readonly Tile[];
  readonly grain: number;
  /** 在路上的那支軍隊。抵達之後還是留在這裡，等玩家按「接敵」才轉成戰鬥。 */
  readonly march: March | null;
  readonly battle: BattleState | null;
  readonly battlesStarted: number;
  readonly battlesWon: number;
  readonly status: GameStatus;
  /** 上一次補算時間產出的時間戳。core 不能自己取時間，一律由呼叫端注入。 */
  readonly settledAt: number;
  /** 因為超過離線上限被丟掉的時間，UI 用來提醒玩家。 */
  readonly forfeitedMs: number;
}

export function createGame(seedText: string, now: number): GameState {
  return {
    rulesVersion: RULES_VERSION,
    seed: seedFrom(seedText),
    tiles: createMap(),
    grain: START_GRAIN,
    march: null,
    battle: null,
    battlesStarted: 0,
    battlesWon: 0,
    status: 'playing',
    settledAt: now,
    forfeitedMs: 0,
  };
}

/**
 * 對時。
 *
 * 元件在 render 期間不能取時間（不純），而靜態輸出的伺服器端也不可能知道
 * 玩家的時鐘。所以初始狀態的 settledAt 是 0，掛載後才由這個函式對上。
 * 對時不補算——那段「還沒掛載」的時間本來就不該產糧。
 */
export function startClock(state: GameState, now: number): GameState {
  return state.settledAt === CLOCK_NOT_STARTED ? { ...state, settledAt: now } : state;
}

/** createGame 的 now 傳這個代表「還不知道現在幾點」。 */
export const CLOCK_NOT_STARTED = 0;

/**
 * 補算時間產出。
 *
 * 每個會改變局面的動作都要先呼叫它，否則新佔領的地會回頭替過去的時間產糧。
 * 重複呼叫是安全的：不足一顆糧的零頭留在帳上，不會被無條件捨去。
 */
export function settleTime(state: GameState, now: number): GameState {
  const accrual = accrueGrain(ownedCount(state), state.settledAt, now);
  if (accrual.grain === 0 && accrual.settledAt === state.settledAt && accrual.forfeitedMs === 0) {
    return state;
  }
  const grain = state.grain + accrual.grain;
  return {
    ...state,
    grain,
    settledAt: accrual.settledAt,
    forfeitedMs: state.forfeitedMs + accrual.forfeitedMs,
    // 補算完可能就有糧再出兵了，卡住的狀態要跟著解除。
    status: state.status === 'stuck' && grain >= MARCH_COST ? 'playing' : state.status,
  };
}

export function capturedCount(state: GameState): number {
  return state.tiles.filter((tile) => tile.owned && tile.level > 0).length;
}

export function ownedCount(state: GameState): number {
  return state.tiles.filter((tile) => tile.owned).length;
}

export type MarchBlockedReason = 'in-battle' | 'marching' | 'not-adjacent' | 'not-enough-grain';

/** 擋下出兵的理由，null 代表可以出兵。UI 用它決定按鈕狀態與提示。 */
export function marchBlockedReason(state: GameState, id: TileId): MarchBlockedReason | null {
  if (state.battle !== null && state.battle.outcome === 'ongoing') {
    return 'in-battle';
  }
  // 一次只有一支軍隊在外。抵達之後也還算在外，直到玩家接敵或鳴金。
  if (state.march !== null) {
    return 'marching';
  }
  const tile = findTile(state.tiles, id);
  if (tile === undefined || !canMarchTo(state.tiles, tile)) {
    return 'not-adjacent';
  }
  if (state.grain < MARCH_COST) {
    return 'not-enough-grain';
  }
  return null;
}

/** 這場戰鬥的種子：同一局裡打同一塊地的第 n 場，題目順序永遠一樣。 */
export function battleSeed(state: GameState, id: TileId): RngState {
  return seedFrom(`${state.seed}:${id}:${state.battlesStarted}`);
}

export function battleId(state: GameState, id: TileId): string {
  return `b${state.battlesStarted + 1}-${id}`;
}

/**
 * 下令出兵。扣糧，然後軍隊上路——這一刻還沒有戰鬥。
 *
 * 糧草在出發時就扣掉，不是抵達時。理由是玩家看得到的因果要跟按鈕同時發生；
 * 抵達才扣的話，糧草會在玩家沒有操作的時候自己少掉。
 */
export function orderMarch(state: GameState, id: TileId, now: number): GameState {
  const blocked = marchBlockedReason(state, id);
  if (blocked !== null) {
    throw new Error(`cannot march to ${id}: ${blocked}`);
  }
  const tile = findTile(state.tiles, id);
  if (tile === undefined) {
    throw new Error(`no tile ${id}`);
  }

  return {
    ...state,
    grain: state.grain - MARCH_COST,
    march: startMarch(id, tile.x, tile.y, now),
  };
}

/**
 * 鳴金。還沒接敵，糧草原數帶回。
 *
 * 全額退是刻意的：點錯一塊地就損失一次出兵的成本，只會讓玩家不敢點。
 * 真正的成本是已經花掉的那段時間，那退不回來。
 */
export function recallMarch(state: GameState): GameState {
  if (state.march === null) {
    return state;
  }
  return { ...state, grain: state.grain + MARCH_COST, march: null };
}

export function marchHasArrived(state: GameState, now: number): boolean {
  return state.march !== null && hasArrived(state.march, now);
}

/**
 * 接敵。把已抵達的行軍換成一場戰鬥。
 *
 * 題目由呼叫端抽好傳進來——題庫在 core 外面（core 不得相依外層模組），
 * 而抽題要用 battleSeed(state, id)，所以順序是：先算種子、抽題、再呼叫這裡。
 */
export function engageBattle(state: GameState, questions: readonly RoundQuestion[], now: number): GameState {
  if (state.march === null) {
    throw new Error('no march to engage');
  }
  if (!hasArrived(state.march, now)) {
    throw new Error(`march to ${state.march.tileId} has not arrived`);
  }
  const tile = findTile(state.tiles, state.march.tileId);
  if (tile === undefined) {
    throw new Error(`no tile ${state.march.tileId}`);
  }

  return {
    ...state,
    march: null,
    battlesStarted: state.battlesStarted + 1,
    battle: startBattle({
      battleId: battleId(state, tile.id),
      tileId: tile.id,
      tileLevel: tile.level,
      seed: battleSeed(state, tile.id),
      questions,
    }),
  };
}

function settle(state: GameState, battle: BattleState): GameState {
  const tiles =
    battle.outcome === 'won'
      ? state.tiles.map((tile) => (tile.id === battle.tileId ? { ...tile, owned: true } : tile))
      : state.tiles;

  // 繳獲不分勝敗——打輸一樣有，那不是打贏的獎勵。
  const grain = state.grain + GRAIN_PER_BATTLE;

  const allTaken = tiles.every((tile) => tile.owned);
  const canAffordAnother = grain >= MARCH_COST;

  return {
    ...state,
    tiles,
    grain,
    battle,
    battlesWon: state.battlesWon + (battle.outcome === 'won' ? 1 : 0),
    status: allTaken ? 'cleared' : canAffordAnother ? 'playing' : 'stuck',
  };
}

/** 結算一回合。戰鬥在這一回合結束的話，佔領與產糧一併算完。 */
export function answerRound(state: GameState, choiceIndex: number | null): GameState {
  if (state.battle === null || state.battle.outcome !== 'ongoing') {
    return state;
  }
  const battle = resolveBattleRound(state.battle, choiceIndex);
  return battle.outcome === 'ongoing' ? { ...state, battle } : settle(state, battle);
}

/** 中途離開。算成敗仗，糧草不退。 */
export function retreat(state: GameState): GameState {
  if (state.battle === null || state.battle.outcome !== 'ongoing') {
    return state;
  }
  return settle(state, abandonBattle(state.battle));
}

/** 關掉戰報，回到地圖。 */
export function dismissBattle(state: GameState): GameState {
  return state.battle === null || state.battle.outcome === 'ongoing' ? state : { ...state, battle: null };
}
