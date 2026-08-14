import { describe, expect, it } from 'vitest';

import type { RoundQuestion } from './battle';

const T0 = 1_700_000_000_000;
import { createBuildings, maxLevelOf, upgradeCost, upgradeMs } from './buildings';
import { GRAIN_PER_BATTLE, MARCH_COST, MAX_ROUNDS, START_GRAIN } from './config';
import {
  answerRound,
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
  retreat,
  settleTime,
  startUpgrade,
  upgradeBlockedReason,
  type GameState,
} from './game';
import { CITY_X, CITY_Y, canMarchTo, tileId } from './map';
import { RETURN_RATIO } from './march';

const questions: RoundQuestion[] = Array.from({ length: MAX_ROUNDS }, (_, i) => ({
  id: `q${i}`,
  answerIndex: 1,
  choiceCount: 4,
}));

/**
 * 座標一律從主城算出來，不寫死。
 * 地圖從 3×3 變成 6×6 時，寫死座標的測試會整片紅掉，但紅的是測試不是程式。
 */
const CITY = tileId(CITY_X, CITY_Y);
/** 主城正東，距離 1，LV.1——跳過也拿得下。 */
const NEAR = tileId(CITY_X + 1, CITY_Y);
/** 再往東一格，距離 2，還是 LV.1。 */
const NEAR2 = tileId(CITY_X + 2, CITY_Y);
/** 距離 3，LV.1 之後的第一塊 LV.2——這是最近的「跳過會輸」的地。 */
const FAR = tileId(CITY_X + 3, CITY_Y);
/** 角落，一開始碰不到。 */
const CORNER = tileId(0, 0);

/** 出兵到接敵。行軍時間對大部分測試不是重點，直接跳到抵達那一刻。 */
function engage(state: GameState, id: string): GameState {
  const ordered = orderMarch(state, id, T0);
  return engageBattle(ordered, questions, ordered.march!.arrivesAt);
}

/**
 * 關掉戰報並讓隊伍到家。
 *
 * 直接把回程拿掉而不是用 settleTime 走完——補算會順便產糧，
 * 而下面好幾個測試在驗糧草的精確值。班師本身另外有一組測試。
 */
function atHome(state: GameState): GameState {
  return { ...dismissBattle(state), march: null };
}

/** 一路答對直到戰鬥結束。 */
function winBattle(state: GameState, id: string): GameState {
  let next = engage(state, id);
  while (next.battle !== null && next.battle.outcome === 'ongoing') {
    next = answerRound(next, 1, T0);
  }
  return next;
}

/** 一路跳過直到戰鬥結束。 */
function skipBattle(state: GameState, id: string): GameState {
  let next = engage(state, id);
  while (next.battle !== null && next.battle.outcome === 'ongoing') {
    next = answerRound(next, null, T0);
  }
  return next;
}

/** 打通一條路，讓 FAR 變成打得到的。糧草另外補，這幾場不是測試的重點。 */
function openRoadToFar(state: GameState): GameState {
  let next = state;
  for (const id of [NEAR, NEAR2]) {
    if (next.tiles.some((tile) => tile.id === id && tile.owned)) {
      continue;
    }
    next = atHome(winBattle({ ...next, grain: START_GRAIN }, id));
  }
  return { ...next, grain: START_GRAIN };
}

describe('createGame', () => {
  it('主城已佔領，其餘沒有', () => {
    const state = createGame('seed', T0);
    expect(ownedCount(state)).toBe(1);
    expect(capturedCount(state)).toBe(0);
  });

  it('同樣的 seed 給同樣的初始狀態', () => {
    expect(createGame('same', T0)).toEqual(createGame('same', T0));
  });

  it('起始糧草夠出兵', () => {
    expect(createGame('seed', T0).grain).toBe(START_GRAIN);
    expect(START_GRAIN).toBeGreaterThanOrEqual(MARCH_COST);
  });
});

describe('出兵限制', () => {
  it('不相鄰的地格打不到', () => {
    expect(marchBlockedReason(createGame('s', T0), CORNER)).toBe('not-adjacent');
  });

  it('相鄰的可以打', () => {
    expect(marchBlockedReason(createGame('s', T0), NEAR)).toBeNull();
  });

  it('主城不能打自己', () => {
    expect(marchBlockedReason(createGame('s', T0), CITY)).toBe('not-adjacent');
  });

  it('打下之後更外面那圈就相鄰了', () => {
    const state = atHome(winBattle(createGame('s', T0), NEAR));
    expect(marchBlockedReason(state, NEAR2)).toBeNull();
  });

  it('糧草不足擋下出兵', () => {
    const poor: GameState = { ...createGame('s', T0), grain: MARCH_COST - 1 };
    expect(marchBlockedReason(poor, NEAR)).toBe('not-enough-grain');
  });

  it('戰鬥中不能再出兵', () => {
    const state = engage(createGame('s', T0), NEAR);
    expect(marchBlockedReason(state, tileId(CITY_X, CITY_Y - 1))).toBe('in-battle');
  });

  it('被擋下時 orderMarch 丟錯', () => {
    expect(() => orderMarch(createGame('s', T0), CORNER, T0)).toThrow();
  });
});

/**
 * 出兵不再是點下去就開打：下令、走路、抵達、接敵是四件事。
 * 這一組盯著中間那兩件不會被跳過。
 */
describe('行軍', () => {
  it('下令就上路，還沒有戰鬥', () => {
    const state = orderMarch(createGame('s', T0), NEAR, T0);
    expect(state.march?.tileId).toBe(NEAR);
    expect(state.battle).toBeNull();
  });

  it('糧草在出發時就扣，不是抵達時', () => {
    const state = orderMarch(createGame('s', T0), NEAR, T0);
    expect(state.grain).toBe(START_GRAIN - MARCH_COST);
  });

  it('剛出發還沒到', () => {
    const state = orderMarch(createGame('s', T0), NEAR, T0);
    expect(marchHasArrived(state, T0)).toBe(false);
    expect(marchHasArrived(state, state.march!.arrivesAt)).toBe(true);
  });

  it('還沒到就接敵會丟錯——不能靠呼叫順序偷跳過行軍時間', () => {
    const state = orderMarch(createGame('s', T0), NEAR, T0);
    expect(() => engageBattle(state, questions, T0)).toThrow();
  });

  it('沒有軍隊在外時接敵會丟錯', () => {
    expect(() => engageBattle(createGame('s', T0), questions, T0)).toThrow();
  });

  it('一次只有一支軍隊在外', () => {
    const state = orderMarch(createGame('s', T0), NEAR, T0);
    expect(marchBlockedReason(state, tileId(CITY_X, CITY_Y - 1))).toBe('marching');
  });

  it('抵達之後也還算在外，直到接敵', () => {
    const state = orderMarch(createGame('s', T0), NEAR, T0);
    expect(marchBlockedReason(state, tileId(CITY_X, CITY_Y - 1))).toBe('marching');
    expect(marchHasArrived(state, state.march!.arrivesAt)).toBe(true);
    expect(marchBlockedReason(state, tileId(CITY_X, CITY_Y - 1))).toBe('marching');
  });

  it('接敵之後軍隊不在路上了', () => {
    const state = engage(createGame('s', T0), NEAR);
    expect(state.march).toBeNull();
    expect(state.battle?.tileId).toBe(NEAR);
    expect(state.battlesStarted).toBe(1);
  });

  it('鳴金原數退糧——點錯一塊地不該賠掉一次出兵', () => {
    const state = recallMarch(orderMarch(createGame('s', T0), NEAR, T0));
    expect(state.march).toBeNull();
    expect(state.grain).toBe(START_GRAIN);
    expect(state.battlesStarted).toBe(0);
  });

  it('沒在行軍時鳴金不會有事', () => {
    const state = createGame('s', T0);
    expect(recallMarch(state)).toBe(state);
  });

  /** 離開再回來的那條路徑：抵達的軍隊要一直等在那裡，core 不會自己替它開打。 */
  it('離線很久回來，軍隊還在原地等著開打', () => {
    const state = orderMarch(createGame('s', T0), NEAR, T0);
    const muchLater = T0 + 86_400_000;
    expect(marchHasArrived(state, muchLater)).toBe(true);
    expect(state.battle).toBeNull();
    expect(engageBattle(state, questions, muchLater).battle?.tileId).toBe(NEAR);
  });
});

/**
 * 打完要走回來。回程是狀態不是動畫——軍隊在路上就不能再出兵，
 * 而那段時間要撐得過關掉分頁。
 */
describe('班師', () => {
  it('打完就上路回家', () => {
    const state = winBattle(createGame('s', T0), NEAR);
    expect(state.march?.heading).toBe('home');
    expect(state.march?.tileId).toBe(NEAR);
  });

  it('打輸也要走回來', () => {
    const state = skipBattle(openRoadToFar(createGame('s', T0)), FAR);
    expect(state.battle?.outcome).toBe('lost');
    expect(state.march?.heading).toBe('home');
  });

  it('鳴金收兵也要走回來', () => {
    const state = retreat(engage(createGame('s', T0), NEAR), T0);
    expect(state.march?.heading).toBe('home');
  });

  it('回程是去程的一半', () => {
    const ready = openRoadToFar(createGame('s', T0));
    const outbound = orderMarch(ready, FAR, T0).march!.arrivesAt - T0;

    const back = winBattle(ready, FAR);
    const inbound = back.march!.arrivesAt - back.march!.departedAt;

    expect(inbound).toBe(Math.round(outbound * RETURN_RATIO));
    expect(inbound).toBeLessThan(outbound);
  });

  it('人還沒到家就不能再出兵', () => {
    const state = dismissBattle(winBattle(createGame('s', T0), NEAR));
    expect(state.march?.heading).toBe('home');
    expect(marchBlockedReason(state, NEAR2)).toBe('marching');
  });

  it('到家之後補算會把隊伍收掉，就能再出兵了', () => {
    const state = dismissBattle(winBattle(createGame('s', T0), NEAR));
    const home = settleTime(state, state.march!.arrivesAt);
    expect(home.march).toBeNull();
    expect(marchBlockedReason(home, NEAR2)).toBeNull();
  });

  it('還沒到家的時候補算不會提早收掉', () => {
    const state = dismissBattle(winBattle(createGame('s', T0), NEAR));
    expect(settleTime(state, state.march!.arrivesAt - 1).march?.heading).toBe('home');
  });

  /** 玩家不在的時候隊伍一樣會走到家，回來就能直接再出兵。 */
  it('離線很久回來，隊伍早就到家了', () => {
    const state = dismissBattle(winBattle(createGame('s', T0), NEAR));
    expect(settleTime(state, T0 + 86_400_000).march).toBeNull();
  });

  it('回程不能拿來接敵', () => {
    const state = dismissBattle(winBattle(createGame('s', T0), NEAR));
    expect(() => engageBattle(state, questions, state.march!.arrivesAt)).toThrow();
  });

  it('回程不能鳴金——那趟已經打完了，沒有東西可以退', () => {
    const state = dismissBattle(winBattle(createGame('s', T0), NEAR));
    expect(recallMarch(state)).toBe(state);
  });

  it('驛站也讓回程變快', () => {
    const base = winBattle(createGame('s', T0), NEAR);
    const withRelay: GameState = {
      ...createGame('s', T0),
      buildings: { ...createBuildings(), relay: { level: 1, completesAt: null } },
    };
    const faster = winBattle(withRelay, NEAR);
    expect(faster.march!.arrivesAt - faster.march!.departedAt).toBeLessThan(
      base.march!.arrivesAt - base.march!.departedAt,
    );
  });
});

describe('城池建築', () => {
  const rich = (): GameState => ({ ...createGame('build', T0), grain: 100_000 });

  it('動工先扣糧，等級還沒漲', () => {
    const state = startUpgrade(rich(), 'farm', T0);
    expect(state.grain).toBe(100_000 - upgradeCost('farm', 0));
    expect(state.buildings.farm.level).toBe(0);
    expect(state.buildings.farm.completesAt).toBe(T0 + upgradeMs('farm', 0));
  });

  it('工期沒到就還在蓋', () => {
    const state = startUpgrade(rich(), 'farm', T0);
    expect(isUnderConstruction(state, 'farm', T0 + 1)).toBe(true);
    expect(isUnderConstruction(state, 'farm', state.buildings.farm.completesAt!)).toBe(false);
  });

  it('一次只能蓋一座——主城只有一支工隊', () => {
    const state = startUpgrade(rich(), 'farm', T0);
    expect(upgradeBlockedReason(state, 'relay', T0)).toBe('busy');
    expect(() => startUpgrade(state, 'relay', T0)).toThrow();
  });

  it('蓋完就能蓋下一座', () => {
    const state = settleTime(startUpgrade(rich(), 'farm', T0), T0 + upgradeMs('farm', 0));
    expect(upgradeBlockedReason(state, 'relay', state.settledAt)).toBeNull();
  });

  it('糧草不足擋下動工', () => {
    const poor: GameState = { ...createGame('b', T0), grain: 0 };
    expect(upgradeBlockedReason(poor, 'farm', T0)).toBe('not-enough-grain');
  });

  it('滿級之後蓋不動', () => {
    const maxed: GameState = {
      ...rich(),
      buildings: { ...createBuildings(), granary: { level: maxLevelOf('granary'), completesAt: null } },
    };
    expect(upgradeBlockedReason(maxed, 'granary', T0)).toBe('max-level');
  });

  /** 驛站的效果要在下令出兵的那一刻就算進去，不是抵達時才追認。 */
  it('驛站蓋好之後行軍變快', () => {
    const before = orderMarch(rich(), NEAR, T0);
    const withRelay: GameState = {
      ...rich(),
      buildings: { ...createBuildings(), relay: { level: 1, completesAt: null } },
    };
    const after = orderMarch(withRelay, NEAR, T0);
    expect(after.march!.arrivesAt - T0).toBeLessThan(before.march!.arrivesAt - T0);
  });
});

describe('糧草', () => {
  it('出兵先扣糧', () => {
    const state = engage(createGame('s', T0), NEAR);
    expect(state.grain).toBe(START_GRAIN - MARCH_COST);
  });

  it('打完有固定的戰場繳獲', () => {
    const state = winBattle(createGame('s', T0), NEAR);
    expect(state.grain).toBe(START_GRAIN - MARCH_COST + GRAIN_PER_BATTLE);
  });

  it('打輸一樣有繳獲——那不是打贏的獎勵', () => {
    const state = skipBattle(openRoadToFar(createGame('s', T0)), FAR);
    expect(state.battle?.outcome).toBe('lost');
    expect(state.grain).toBe(START_GRAIN - MARCH_COST + GRAIN_PER_BATTLE);
  });

  /**
   * 舊算法是「每塊已佔領的地各產 50」，地一多就壓過出兵成本，糧草失去意義。
   * 這個測試釘住「打仗是淨支出」——糧草只能從時間來，那是 v0.2 的假設。
   */
  it('打一場是淨支出，地再多也一樣', () => {
    expect(GRAIN_PER_BATTLE).toBeLessThan(MARCH_COST);

    const rich: GameState = {
      ...createGame('s', T0),
      tiles: createGame('s', T0).tiles.map((tile) => ({ ...tile, owned: tile.id !== NEAR })),
      grain: START_GRAIN,
    };
    const after = winBattle(rich, NEAR);
    expect(after.grain).toBeLessThan(START_GRAIN);
  });
});

describe('失敗狀態', () => {
  it('一路打輸會卡住', () => {
    let state = openRoadToFar(createGame('s', T0));
    let guard = 0;
    while (state.status === 'playing' && guard < 30) {
      state = atHome(skipBattle(state, FAR));
      guard += 1;
    }
    expect(state.status).toBe('stuck');
    expect(state.grain).toBeLessThan(MARCH_COST);
  });

  it('卡住之後任何地格都出不了兵', () => {
    const stuck: GameState = { ...createGame('s', T0), grain: 0 };
    expect(marchBlockedReason(stuck, NEAR)).toBe('not-enough-grain');
  });
});

describe('retreat', () => {
  it('算成敗仗且糧草不退', () => {
    const state = retreat(engage(createGame('s', T0), NEAR), T0);
    expect(state.battle?.outcome).toBe('lost');
    expect(state.grain).toBeLessThan(START_GRAIN);
    expect(capturedCount(state)).toBe(0);
  });

  it('沒在打的時候呼叫不會有事', () => {
    const state = createGame('s', T0);
    expect(retreat(state, T0)).toBe(state);
  });
});

describe('一局的進展', () => {
  it('連下三塊地', () => {
    let state = createGame('s', T0);
    for (const id of [NEAR, tileId(CITY_X, CITY_Y - 1), tileId(CITY_X - 1, CITY_Y)]) {
      state = atHome(winBattle({ ...state, grain: START_GRAIN }, id));
    }
    expect(capturedCount(state)).toBe(3);
    expect(state.battlesWon).toBe(3);
    expect(state.status).toBe('playing');
  });

  /**
   * 6×6 有 35 塊地要打，順序得沿著相鄰一路推。糧草在這裡補滿——
   * 這個測試驗的是「全下之後狀態變 cleared」，不是經濟。
   */
  it('全部佔領就是通關', () => {
    let state = createGame('s', T0);
    let guard = 0;
    while (state.status !== 'cleared' && guard < 100) {
      const next = state.tiles.find((tile) => canMarchTo(state.tiles, tile));
      expect(next).toBeDefined();
      state = atHome(winBattle({ ...state, grain: START_GRAIN }, next!.id));
      guard += 1;
    }
    expect(state.status).toBe('cleared');
    expect(capturedCount(state)).toBe(state.tiles.length - 1);
  });

  it('同樣的操作序列給同樣的結果', () => {
    const run = () => {
      let state = createGame('replay', T0);
      state = atHome(winBattle(state, NEAR));
      state = atHome(skipBattle(openRoadToFar(state), FAR));
      return state;
    };
    expect(run()).toEqual(run());
  });
});

describe('dismissBattle', () => {
  it('戰鬥還在進行時不關', () => {
    const state = engage(createGame('s', T0), NEAR);
    expect(dismissBattle(state)).toBe(state);
  });

  it('結束後關掉戰報', () => {
    expect(dismissBattle(winBattle(createGame('s', T0), NEAR)).battle).toBeNull();
  });
});
