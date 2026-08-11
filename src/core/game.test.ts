import { describe, expect, it } from 'vitest';

import type { RoundQuestion } from './battle';
import { GRAIN_PER_OWNED_TILE, MARCH_COST, MAX_ROUNDS, START_GRAIN } from './config';
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

const questions: RoundQuestion[] = Array.from({ length: MAX_ROUNDS }, (_, i) => ({
  id: `q${i}`,
  answerIndex: 1,
  choiceCount: 4,
}));

/** 一路答對直到戰鬥結束。 */
function winBattle(state: GameState, tileId: string): GameState {
  let next = beginMarch(state, tileId, questions);
  while (next.battle !== null && next.battle.outcome === 'ongoing') {
    next = answerRound(next, 1);
  }
  return next;
}

/** 一路跳過直到戰鬥結束。 */
function skipBattle(state: GameState, tileId: string): GameState {
  let next = beginMarch(state, tileId, questions);
  while (next.battle !== null && next.battle.outcome === 'ongoing') {
    next = answerRound(next, null);
  }
  return next;
}

describe('createGame', () => {
  it('主城已佔領，其餘沒有', () => {
    const state = createGame('seed');
    expect(ownedCount(state)).toBe(1);
    expect(capturedCount(state)).toBe(0);
  });

  it('同樣的 seed 給同樣的初始狀態', () => {
    expect(createGame('same')).toEqual(createGame('same'));
  });

  it('起始糧草夠出兵', () => {
    expect(createGame('seed').grain).toBe(START_GRAIN);
    expect(START_GRAIN).toBeGreaterThanOrEqual(MARCH_COST);
  });
});

describe('出兵限制', () => {
  it('不相鄰的地格打不到', () => {
    // 角落 (0,0) 跟主城 (1,1) 不正交相鄰。
    expect(marchBlockedReason(createGame('s'), '0,0')).toBe('not-adjacent');
  });

  it('相鄰的可以打', () => {
    expect(marchBlockedReason(createGame('s'), '1,0')).toBeNull();
  });

  it('主城不能打自己', () => {
    expect(marchBlockedReason(createGame('s'), '1,1')).toBe('not-adjacent');
  });

  it('打下之後角落就相鄰了', () => {
    const state = dismissBattle(winBattle(createGame('s'), '1,0'));
    expect(marchBlockedReason(state, '0,0')).toBeNull();
  });

  it('糧草不足擋下出兵', () => {
    const poor: GameState = { ...createGame('s'), grain: MARCH_COST - 1 };
    expect(marchBlockedReason(poor, '1,0')).toBe('not-enough-grain');
  });

  it('戰鬥中不能再出兵', () => {
    const state = beginMarch(createGame('s'), '1,0', questions);
    expect(marchBlockedReason(state, '0,1')).toBe('in-battle');
  });

  it('被擋下時 beginMarch 丟錯', () => {
    expect(() => beginMarch(createGame('s'), '0,0', questions)).toThrow();
  });
});

describe('糧草', () => {
  it('出兵先扣糧', () => {
    const state = beginMarch(createGame('s'), '1,0', questions);
    expect(state.grain).toBe(START_GRAIN - MARCH_COST);
  });

  it('打贏之後每塊已佔領的地都產糧', () => {
    const state = winBattle(createGame('s'), '1,0');
    // 主城加剛拿下的那塊。
    expect(state.grain).toBe(START_GRAIN - MARCH_COST + 2 * GRAIN_PER_OWNED_TILE);
  });

  it('打輸一樣產糧——產糧不是打贏的獎勵', () => {
    const state = skipBattle(createGame('s'), '2,1');
    expect(state.battle?.outcome).toBe('lost');
    expect(state.grain).toBe(START_GRAIN - MARCH_COST + 1 * GRAIN_PER_OWNED_TILE);
  });
});

describe('失敗狀態', () => {
  it('一路打輸會卡住', () => {
    let state = createGame('s');
    let guard = 0;
    while (state.status === 'playing' && guard < 20) {
      state = dismissBattle(skipBattle(state, '2,1'));
      guard += 1;
    }
    expect(state.status).toBe('stuck');
    expect(state.grain).toBeLessThan(MARCH_COST);
  });

  it('卡住之後任何地格都出不了兵', () => {
    const stuck: GameState = { ...createGame('s'), grain: 0 };
    expect(marchBlockedReason(stuck, '1,0')).toBe('not-enough-grain');
  });
});

describe('retreat', () => {
  it('算成敗仗且糧草不退', () => {
    const state = retreat(beginMarch(createGame('s'), '1,0', questions));
    expect(state.battle?.outcome).toBe('lost');
    expect(state.grain).toBeLessThan(START_GRAIN);
    expect(capturedCount(state)).toBe(0);
  });

  it('沒在打的時候呼叫不會有事', () => {
    const state = createGame('s');
    expect(retreat(state)).toBe(state);
  });
});

describe('一局的進展', () => {
  it('連下三塊地', () => {
    let state = createGame('s');
    for (const id of ['1,0', '0,1', '2,1']) {
      state = dismissBattle(winBattle(state, id));
    }
    expect(capturedCount(state)).toBe(3);
    expect(state.battlesWon).toBe(3);
    expect(state.status).toBe('playing');
  });

  it('全部佔領就是通關', () => {
    let state = createGame('s');
    for (const id of ['1,0', '0,1', '2,1', '1,2', '0,0', '2,0', '0,2', '2,2']) {
      state = dismissBattle(winBattle(state, id));
    }
    expect(state.status).toBe('cleared');
    expect(capturedCount(state)).toBe(8);
  });

  it('同樣的操作序列給同樣的結果', () => {
    const run = () => {
      let state = createGame('replay');
      state = dismissBattle(winBattle(state, '1,0'));
      state = dismissBattle(skipBattle(state, '2,1'));
      return state;
    };
    expect(run()).toEqual(run());
  });
});

describe('dismissBattle', () => {
  it('戰鬥還在進行時不關', () => {
    const state = beginMarch(createGame('s'), '1,0', questions);
    expect(dismissBattle(state)).toBe(state);
  });

  it('結束後關掉戰報', () => {
    expect(dismissBattle(winBattle(createGame('s'), '1,0')).battle).toBeNull();
  });
});
