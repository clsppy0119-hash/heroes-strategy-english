import { describe, expect, it } from 'vitest';

import type { RoundQuestion } from './battle';

const T0 = 1_700_000_000_000;
import { GRAIN_PER_BATTLE, MARCH_COST, MAX_ROUNDS, START_GRAIN } from './config';
import {
  answerRound,
  beginMarch,
  capturedCount,
  createGame,
  dismissBattle,
  marchBlockedReason,
  ownedCount,
  retreat,
  type GameState,
} from './game';
import { CITY_X, CITY_Y, canMarchTo, tileId } from './map';

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

/** 一路答對直到戰鬥結束。 */
function winBattle(state: GameState, id: string): GameState {
  let next = beginMarch(state, id, questions);
  while (next.battle !== null && next.battle.outcome === 'ongoing') {
    next = answerRound(next, 1);
  }
  return next;
}

/** 一路跳過直到戰鬥結束。 */
function skipBattle(state: GameState, id: string): GameState {
  let next = beginMarch(state, id, questions);
  while (next.battle !== null && next.battle.outcome === 'ongoing') {
    next = answerRound(next, null);
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
    next = dismissBattle(winBattle({ ...next, grain: START_GRAIN }, id));
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
    const state = dismissBattle(winBattle(createGame('s', T0), NEAR));
    expect(marchBlockedReason(state, NEAR2)).toBeNull();
  });

  it('糧草不足擋下出兵', () => {
    const poor: GameState = { ...createGame('s', T0), grain: MARCH_COST - 1 };
    expect(marchBlockedReason(poor, NEAR)).toBe('not-enough-grain');
  });

  it('戰鬥中不能再出兵', () => {
    const state = beginMarch(createGame('s', T0), NEAR, questions);
    expect(marchBlockedReason(state, tileId(CITY_X, CITY_Y - 1))).toBe('in-battle');
  });

  it('被擋下時 beginMarch 丟錯', () => {
    expect(() => beginMarch(createGame('s', T0), CORNER, questions)).toThrow();
  });
});

describe('糧草', () => {
  it('出兵先扣糧', () => {
    const state = beginMarch(createGame('s', T0), NEAR, questions);
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
      state = dismissBattle(skipBattle(state, FAR));
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
    const state = retreat(beginMarch(createGame('s', T0), NEAR, questions));
    expect(state.battle?.outcome).toBe('lost');
    expect(state.grain).toBeLessThan(START_GRAIN);
    expect(capturedCount(state)).toBe(0);
  });

  it('沒在打的時候呼叫不會有事', () => {
    const state = createGame('s', T0);
    expect(retreat(state)).toBe(state);
  });
});

describe('一局的進展', () => {
  it('連下三塊地', () => {
    let state = createGame('s', T0);
    for (const id of [NEAR, tileId(CITY_X, CITY_Y - 1), tileId(CITY_X - 1, CITY_Y)]) {
      state = dismissBattle(winBattle({ ...state, grain: START_GRAIN }, id));
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
      state = dismissBattle(winBattle({ ...state, grain: START_GRAIN }, next!.id));
      guard += 1;
    }
    expect(state.status).toBe('cleared');
    expect(capturedCount(state)).toBe(state.tiles.length - 1);
  });

  it('同樣的操作序列給同樣的結果', () => {
    const run = () => {
      let state = createGame('replay', T0);
      state = dismissBattle(winBattle(state, NEAR));
      state = dismissBattle(skipBattle(openRoadToFar(state), FAR));
      return state;
    };
    expect(run()).toEqual(run());
  });
});

describe('dismissBattle', () => {
  it('戰鬥還在進行時不關', () => {
    const state = beginMarch(createGame('s', T0), NEAR, questions);
    expect(dismissBattle(state)).toBe(state);
  });

  it('結束後關掉戰報', () => {
    expect(dismissBattle(winBattle(createGame('s', T0), NEAR)).battle).toBeNull();
  });
});
