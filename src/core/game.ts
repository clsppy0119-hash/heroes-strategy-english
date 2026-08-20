import {
  BUILDING_IDS,
  createBuildings,
  grainPerHour,
  maxLevelOf,
  offlineCapMs,
  upgradeCost,
  upgradeMs,
  type BuildingId,
  type Buildings,
} from './buildings';
import {
  GRAIN_PER_BATTLE,
  MARCH_COST,
  MORALE_COST_PER_STEP,
  MORALE_FLOOR,
  MORALE_FULL,
  START_GRAIN,
} from './config';
import { accrueGrain } from './time';
import {
  abandonBattle,
  resolveRound as resolveBattleRound,
  startBattle,
  type BattleState,
  type RoundQuestion,
} from './battle';
import {
  CITY_X,
  CITY_Y,
  canMarchTo,
  createMap,
  findTile,
  stepsBetween,
  tileId,
  type Tile,
  type TileId,
} from './map';
import { hasArrived, startMarch, startReturn, type March } from './march';
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
  readonly buildings: Buildings;
  /**
   * 隊伍閒著的時候站在哪一格。
   *
   * 打完不會自動班師——隊伍就地駐紮，玩家再決定要回城還是從這裡繼續打。
   * 所以位置變成局面的一部分：下一趟行軍多久，看的是從這裡走到目標多遠。
   */
  readonly armyAt: TileId;
  /**
   * 士氣。傷害等比乘上它，回到主城補滿。
   *
   * 這是「回城」唯一的實質理由——在這之前回城只換位置，換不到任何東西。
   */
  readonly morale: number;
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
    buildings: createBuildings(),
    armyAt: tileId(CITY_X, CITY_Y),
    morale: MORALE_FULL,
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
 * 補算時間產出，順便讓期間完工的建築生效。
 *
 * 每個會改變局面的動作都要先呼叫它，否則新佔領的地會回頭替過去的時間產糧。
 * 重複呼叫是安全的：不足一顆糧的零頭留在帳上，不會被無條件捨去。
 *
 * ## 為什麼要分段
 *
 * 屯田完工會把產速調上去。離線八小時、屯田在第三小時完工的話，
 * 前三小時該用舊速率、後五小時該用新速率。一律用完工後的速率會多發糧，
 * 一律用舊速率則等於建築白蓋了幾小時——兩種都是玩家看不出來但確實錯的帳。
 *
 * 所以這裡在每個完工時刻切一刀：補算到那一刻、套用完工、再繼續。
 *
 * 分段交界處會有一點誤差：上一段留在帳上的零頭（不足一顆糧的時間）
 * 會用下一段的速率折算，等於多給了不到一顆糧。一局最多切三刀，
 * 那個量比一次戰鬥的繳獲小三個數量級，換來的是不用在狀態裡多存一個小數欄位。
 *
 * ## 離線上限用的是離開時的糧倉等級
 *
 * 上限本身也會被糧倉改變，讓它在補算途中變動會讓「能補算多久」變成
 * 一個遞迴問題。取離開那一刻的等級單純得多，而且說得通：
 * 你離開時的倉庫有多大，就存得下多少。
 */
export function settleTime(state: GameState, now: number): GameState {
  const capMs = offlineCapMs(state.buildings.granary.level);

  // 到期的建築，按完工時間排序——順序錯了速率就套錯區間。
  //
  // 不設下界（不要求晚於 settledAt）：讀檔時可能拿到一份完工時間早於時間戳的
  // 存檔（時鐘被改過、或上一次結算沒寫回去）。那種工程一樣該完工，
  // 而它的補算區間長度會是零，所以多切這一刀不會多發糧。
  const finishing = BUILDING_IDS.filter((id) => {
    const at = state.buildings[id].completesAt;
    return at !== null && at <= now;
  }).sort((a, b) => state.buildings[a].completesAt! - state.buildings[b].completesAt!);

  let current = state;
  for (const id of finishing) {
    current = accrueInto(current, current.buildings[id].completesAt!, capMs);
    current = {
      ...current,
      buildings: {
        ...current.buildings,
        [id]: { level: current.buildings[id].level + 1, completesAt: null },
      },
    };
  }
  current = accrueInto(current, now, capMs);

  // 班師到家。這是純粹由時間決定的轉變，所以歸補算管——玩家不在的時候
  // 隊伍一樣會走到家，回來就能直接再出兵。
  const home =
    current.march !== null && current.march.heading === 'home' && hasArrived(current.march, now);

  if (current === state && !home) {
    return state;
  }
  return {
    ...current,
    armyAt: home ? current.march!.tileId : current.armyAt,
    // 進了城就補滿。這是回城唯一換得到的東西。
    morale: home ? MORALE_FULL : current.morale,
    march: home ? null : current.march,
    // 補算完可能就有糧再出兵了，卡住的狀態要跟著解除。
    status: current.status === 'stuck' && current.grain >= MARCH_COST ? 'playing' : current.status,
  };
}

/** 用目前的速率把時間補算到 `until`。速率不變的一段。 */
function accrueInto(state: GameState, until: number, capMs: number): GameState {
  const accrual = accrueGrain(
    grainPerHour(ownedCount(state), state.buildings.farm.level),
    state.settledAt,
    until,
    capMs,
  );
  if (accrual.grain === 0 && accrual.settledAt === state.settledAt && accrual.forfeitedMs === 0) {
    return state;
  }
  return {
    ...state,
    grain: state.grain + accrual.grain,
    settledAt: accrual.settledAt,
    forfeitedMs: state.forfeitedMs + accrual.forfeitedMs,
  };
}

/**
 * 讀檔之後接回去玩。
 *
 * 做兩件事：把離開期間的時間補算完（糧、完工的建築、抵達的行軍都在這裡結算），
 * 然後確保沒有殘留的戰鬥——`readSave` 已經不還原戰鬥，這裡再擋一次，
 * 因為 repository 之外還有別的路可能餵狀態進來（測試、之後的伺服器）。
 */
export function resumeGame(state: GameState, now: number): GameState {
  return settleTime(state.battle === null ? state : { ...state, battle: null }, now);
}

export type UpgradeBlockedReason = 'busy' | 'max-level' | 'not-enough-grain';

/** 擋下動工的理由，null 代表蓋得了。 */
export function upgradeBlockedReason(
  state: GameState,
  id: BuildingId,
  now: number,
): UpgradeBlockedReason | null {
  if (state.buildings[id].level >= maxLevelOf(id)) {
    return 'max-level';
  }
  // 主城只有一支工隊。同時能蓋三座的話，開場把糧一次花光就無事可做了。
  if (BUILDING_IDS.some((each) => isUnderConstruction(state, each, now))) {
    return 'busy';
  }
  if (state.grain < upgradeCost(id, state.buildings[id].level)) {
    return 'not-enough-grain';
  }
  return null;
}

export function isUnderConstruction(state: GameState, id: BuildingId, now: number): boolean {
  const at = state.buildings[id].completesAt;
  return at !== null && at > now;
}

/**
 * 動工。扣糧，記下完工時間——等級要等 settleTime 走到那一刻才會漲。
 *
 * 呼叫端要先 settleTime 再動工，否則這次升級的產速會回頭套到過去的時間。
 */
export function startUpgrade(state: GameState, id: BuildingId, now: number): GameState {
  const blocked = upgradeBlockedReason(state, id, now);
  if (blocked !== null) {
    throw new Error(`cannot upgrade ${id}: ${blocked}`);
  }
  const level = state.buildings[id].level;
  return {
    ...state,
    grain: state.grain - upgradeCost(id, level),
    buildings: {
      ...state.buildings,
      [id]: { level, completesAt: now + upgradeMs(id, level) },
    },
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
  // 一次只有一支軍隊在外，回程也算在外——人還沒到家就不能再派出去。
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

  // 從隊伍現在站的地方出發。相鄰的目標還是一格（九秒），但隊伍在角落時
  // 想打對面就要走整段路——那是玩家自己選的，不是遊戲強加的。
  const from = findTile(state.tiles, state.armyAt);
  if (from === undefined) {
    throw new Error(`army is nowhere: ${state.armyAt}`);
  }

  const steps = stepsBetween(from, tile);

  return {
    ...state,
    grain: state.grain - MARCH_COST,
    // 走越遠掉越多。掉在下令的那一刻，玩家才看得出「這一趟值不值」。
    morale: moraleAfter(state.morale, steps),
    march: startMarch(id, from.id, steps, state.buildings.relay.level, now),
  };
}

/**
 * 鳴金。還沒接敵，糧草原數帶回。
 *
 * 全額退是刻意的：點錯一塊地就損失一次出兵的成本，只會讓玩家不敢點。
 * 真正的成本是已經花掉的那段時間，那退不回來。
 *
 * 撤回不用走回程。這不是一次出兵，是一個被取消的命令——讓誤點還要罰
 * 一段回程時間，等於逼玩家在點之前先確認一次，那不是這個按鈕的用意。
 * 班師的時間留給真正打過的那一趟。
 */
export function recallMarch(state: GameState): GameState {
  const march = state.march;
  if (march === null || march.heading !== 'out') {
    return state;
  }
  const from = findTile(state.tiles, march.fromTileId);
  const to = findTile(state.tiles, march.tileId);
  const steps = from === undefined || to === undefined ? 0 : stepsBetween(from, to);
  return {
    ...state,
    grain: state.grain + MARCH_COST,
    // 士氣也一起退回去。撤回的是一個還沒發生的命令，不該留下代價。
    morale: Math.min(MORALE_FULL, Math.round((state.morale + MORALE_COST_PER_STEP * steps) * 10_000) / 10_000),
    march: null,
  };
}

/**
 * 走了幾步之後剩多少士氣。夾在下限，因為連全對都打不贏的仗不該存在。
 *
 * 四捨五入到小數第四位：0.04 一次次減下去會累積成 0.9199999999999999，
 * 那個數字會被原封不動寫進存檔。畫面上看不出差別，但存檔裡的數字
 * 沒理由是髒的，而且之後任何等值比較都會被它咬一口。
 */
export function moraleAfter(morale: number, steps: number): number {
  const next = morale - MORALE_COST_PER_STEP * Math.max(0, steps);
  return Math.max(MORALE_FLOOR, Math.round(next * 10_000) / 10_000);
}

/** 隊伍在主城裡。回城鍵要不要出現看這個。 */
export function armyAtCapital(state: GameState): boolean {
  return state.armyAt === tileId(CITY_X, CITY_Y);
}

/**
 * 班師回朝。
 *
 * 走回主城要多久看隊伍現在在哪——深入角落的代價在這裡付。
 * 回程一樣是去程的一半速度（打完就走，不必再探路）。
 *
 * 回城沒有直接的好處，它換的是位置：主城在中間，從那裡出發到任何一條
 * 戰線都比從角落近。要不要付這段路，是玩家自己算的。
 */
export function orderReturn(state: GameState, now: number): GameState {
  if (state.march !== null || armyAtCapital(state)) {
    return state;
  }
  if (state.battle !== null && state.battle.outcome === 'ongoing') {
    return state;
  }
  const from = findTile(state.tiles, state.armyAt);
  const capital = findTile(state.tiles, tileId(CITY_X, CITY_Y));
  if (from === undefined || capital === undefined) {
    return state;
  }
  return {
    ...state,
    march: startReturn(capital.id, from.id, stepsBetween(from, capital), state.buildings.relay.level, now),
  };
}

export function marchHasArrived(state: GameState, now: number): boolean {
  return state.march !== null && hasArrived(state.march, now);
}

/** 軍隊已經走到目標，等著開打。 */
export function readyToEngage(state: GameState, now: number): boolean {
  return state.march !== null && state.march.heading === 'out' && hasArrived(state.march, now);
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
  if (state.march.heading !== 'out') {
    throw new Error('the column is heading home, not to a battle');
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
      morale: state.morale,
    }),
  };
}

/**
 * 打完了。佔領、繳獲、然後班師。
 *
 * 回程是狀態的一部分而不是動畫：軍隊在路上就不能再出兵，而那段時間
 * 要能撐過關掉分頁。所以它跟去程一樣存在 march 裡，只是方向相反。
 */
function settle(state: GameState, battle: BattleState): GameState {
  const tiles =
    battle.outcome === 'won'
      ? state.tiles.map((tile) => (tile.id === battle.tileId ? { ...tile, owned: true } : tile))
      : state.tiles;

  // 繳獲不分勝敗——打輸一樣有，那不是打贏的獎勵。
  const grain = state.grain + GRAIN_PER_BATTLE;

  const allTaken = tiles.every((tile) => tile.owned);
  const canAffordAnother = grain >= MARCH_COST;
  /*
    打完就地駐紮，不自動班師。

    打贏就佔著那塊地；打輸（含中途鳴金）退回出發的地方——沒拿下的地
    站不住。接下來要回城還是從這裡繼續打，是玩家的選擇。
  */
  const armyAt = battle.outcome === 'won' ? battle.tileId : state.armyAt;

  return {
    ...state,
    tiles,
    grain,
    battle,
    armyAt,
    march: null,
    battlesWon: state.battlesWon + (battle.outcome === 'won' ? 1 : 0),
    status: allTaken ? 'cleared' : canAffordAnother ? 'playing' : 'stuck',
  };
}

/** 結算一回合。戰鬥在這一回合結束的話，佔領與繳獲一併算完。 */
export function answerRound(state: GameState, choiceIndex: number | null): GameState {
  if (state.battle === null || state.battle.outcome !== 'ongoing') {
    return state;
  }
  const battle = resolveBattleRound(state.battle, choiceIndex);
  return battle.outcome === 'ongoing' ? { ...state, battle } : settle(state, battle);
}

/** 中途離開。算成敗仗，糧草不退，隊伍退回原本站的地方。 */
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
