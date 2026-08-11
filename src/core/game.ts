import { GRAIN_PER_OWNED_TILE, MARCH_COST, START_GRAIN } from './config';
import {
  abandonBattle,
  resolveRound as resolveBattleRound,
  startBattle,
  type BattleState,
  type RoundQuestion,
} from './battle';
import { canMarchTo, createMap, findTile, type Tile, type TileId } from './map';
import { RULES_VERSION, type RulesVersion } from './rules';
import { seedFrom, type RngState } from './rng';

/**
 * 整局的狀態機。
 *
 * 純函式、可序列化。v0.2 要把結算搬到伺服器時，搬的就是這個檔案跟它的相依，
 * 不用重寫——這是 scripts/check-core-purity.mjs 在守的東西。
 */

export type GameStatus = 'playing' | 'cleared' | 'stuck';

export interface GameState {
  readonly rulesVersion: RulesVersion;
  readonly seed: RngState;
  readonly tiles: readonly Tile[];
  readonly grain: number;
  readonly battle: BattleState | null;
  readonly battlesStarted: number;
  readonly battlesWon: number;
  readonly status: GameStatus;
}

export function createGame(seedText: string): GameState {
  return {
    rulesVersion: RULES_VERSION,
    seed: seedFrom(seedText),
    tiles: createMap(),
    grain: START_GRAIN,
    battle: null,
    battlesStarted: 0,
    battlesWon: 0,
    status: 'playing',
  };
}

export function capturedCount(state: GameState): number {
  return state.tiles.filter((tile) => tile.owned && tile.level > 0).length;
}

export function ownedCount(state: GameState): number {
  return state.tiles.filter((tile) => tile.owned).length;
}

export type MarchBlockedReason = 'in-battle' | 'not-adjacent' | 'not-enough-grain';

/** 擋下出兵的理由，null 代表可以出兵。UI 用它決定按鈕狀態與提示。 */
export function marchBlockedReason(state: GameState, id: TileId): MarchBlockedReason | null {
  if (state.battle !== null && state.battle.outcome === 'ongoing') {
    return 'in-battle';
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

export function beginMarch(state: GameState, id: TileId, questions: readonly RoundQuestion[]): GameState {
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
    battlesStarted: state.battlesStarted + 1,
    battle: startBattle({
      battleId: battleId(state, id),
      tileId: id,
      tileLevel: tile.level,
      seed: battleSeed(state, id),
      questions,
    }),
  };
}

function settle(state: GameState, battle: BattleState): GameState {
  const tiles =
    battle.outcome === 'won'
      ? state.tiles.map((tile) => (tile.id === battle.tileId ? { ...tile, owned: true } : tile))
      : state.tiles;

  // 產糧不分勝敗——已佔領的地一樣在產出，那不是打贏的獎勵。
  const owned = tiles.filter((tile) => tile.owned).length;
  const grain = state.grain + owned * GRAIN_PER_OWNED_TILE;

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
