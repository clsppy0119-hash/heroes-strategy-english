import { describe, expect, it } from 'vitest';

import { maxLevelOf } from './buildings';
import { MARCH_COST } from './config';
import {
  capturedCount,
  createGame,
  orderMarch,
  resumeGame,
  settleTime,
  startUpgrade,
  type GameState,
} from './game';
import { HOUR_MS } from './config';
import { CITY_X, CITY_Y, tileId } from './map';
import { RULES_VERSION } from './rules';
import { startReturn } from './march';
import { SAVE_VERSION, packSave, readSave } from './save';

const T0 = 1_700_000_000_000;
const NEAR = tileId(CITY_X + 1, CITY_Y);
const CITY = tileId(CITY_X, CITY_Y);
/** 離主城很遠、不是自己的地。 */
const FAR = tileId(0, 0);

const write = (state: GameState, savedAt = T0) => JSON.stringify(packSave(state, savedAt));

/** 從一份合法存檔出發，動一個欄位。驗證用的。 */
function tamper(mutate: (envelope: Record<string, unknown>) => void): string {
  const envelope = JSON.parse(write(createGame('s', T0))) as Record<string, unknown>;
  mutate(envelope);
  return JSON.stringify(envelope);
}

describe('存檔來回一趟', () => {
  it('原封不動地回來', () => {
    const state = createGame('roundtrip', T0);
    const result = readSave(write(state));
    expect(result.ok).toBe(true);
    expect(result.ok && result.state).toEqual(state);
  });

  it('資源、建築、時間戳都留著', () => {
    const built = startUpgrade({ ...createGame('s', T0), grain: 5_000 }, 'farm', T0);
    const result = readSave(write(built));
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.state.grain).toBe(built.grain);
    expect(result.state.buildings.farm.completesAt).toBe(built.buildings.farm.completesAt);
    expect(result.state.settledAt).toBe(built.settledAt);
  });

  it('已佔領的地留著', () => {
    const state: GameState = {
      ...createGame('s', T0),
      tiles: createGame('s', T0).tiles.map((tile) => (tile.id === NEAR ? { ...tile, owned: true } : tile)),
    };
    const result = readSave(write(state));
    expect(result.ok && capturedCount(result.state)).toBe(1);
  });

  it('在路上的軍隊留著——那是「回來時有東西在等你」的一半', () => {
    const marching = orderMarch(createGame('s', T0), NEAR, T0);
    const result = readSave(write(marching));
    expect(result.ok && result.state.march).toEqual(marching.march);
  });

  /**
   * 班師的目標地通常已經是自己的（剛打贏的那一塊），所以驗證不能一律要求
   * 「行軍目標必須是還沒佔領的地」——那條規則只對去程成立。
   */
  it('班師途中存檔，回程留著', () => {
    const base = createGame('s', T0);
    const returning: GameState = {
      ...base,
      tiles: base.tiles.map((tile) => (tile.id === NEAR ? { ...tile, owned: true } : tile)),
      march: startReturn(NEAR, tileId(CITY_X, CITY_Y), 1, 0, T0),
    };
    const result = readSave(write(returning));
    expect(result.ok && result.state.march).toEqual(returning.march);
  });

  it('記得存檔時間', () => {
    expect(readSave(write(createGame('s', T0), T0 + 999))).toMatchObject({ savedAt: T0 + 999 });
  });
});

/**
 * 進行中的戰鬥不還原。題目是 UI 層抽的、不在 GameState 裡，
 * 還原一場沒有題目的戰鬥會在玩家按下第一個選項時炸掉。
 */
describe('戰鬥不會被還原', () => {
  it('存檔裡就算有戰鬥，讀回來也是 null', () => {
    const fake = tamper((envelope) => {
      (envelope.state as Record<string, unknown>).battle = { battleId: 'b', tileId: NEAR, round: 0 };
    });
    expect(readSave(fake)).toMatchObject({ ok: true, state: { battle: null } });
  });

  it('resumeGame 再擋一次', () => {
    const withBattle = { ...createGame('s', T0), battle: { fake: true } } as unknown as GameState;
    expect(resumeGame(withBattle, T0).battle).toBeNull();
  });
});

describe('版本', () => {
  it('沒有存檔就是沒有，不是壞掉', () => {
    expect(readSave(null)).toEqual({ ok: false, reason: 'empty' });
    expect(readSave('')).toEqual({ ok: false, reason: 'empty' });
  });

  it('目前的存檔版本是 5——局面多了士氣', () => {
    expect(SAVE_VERSION).toBe(5);
  });

  it('外殼形狀變了就作廢', () => {
    const old = tamper((envelope) => {
      envelope.saveVersion = SAVE_VERSION - 1;
    });
    expect(readSave(old)).toEqual({ ok: false, reason: 'wrong-save-version' });
  });

  it('規則版本不同就作廢——舊存檔的數值不再對應現在的規則', () => {
    const old = tamper((envelope) => {
      envelope.rulesVersion = '0.0.1';
    });
    expect(readSave(old)).toEqual({ ok: false, reason: 'wrong-rules-version' });
  });

  it('現在的版本讀得回來', () => {
    expect(readSave(write(createGame('s', T0)))).toMatchObject({ ok: true });
  });

  it('存檔帶的是目前的規則版本', () => {
    expect(packSave(createGame('s', T0), T0).rulesVersion).toBe(RULES_VERSION);
  });
});

/**
 * localStorage 的內容不是我們寫的，是使用者的磁碟。這一組把它當成敵意輸入。
 * 每一條壞掉的存檔都必須被擋在門口，而不是在很遠的地方以看不懂的方式壞掉。
 */
describe('壞掉的存檔一律作廢，不會讓遊戲掛掉', () => {
  const bad: Record<string, string> = {
    '不是 JSON': '{ 這不是 json',
    '是字串不是物件': '"hello"',
    '是陣列不是物件': '[]',
    'null': 'null',
  };

  for (const [name, raw] of Object.entries(bad)) {
    it(name, () => {
      expect(readSave(raw).ok).toBe(false);
    });
  }

  const broken: Record<string, (state: Record<string, unknown>) => void> = {
    '沒有 tiles': (state) => {
      delete state.tiles;
    },
    'tiles 不是陣列': (state) => {
      state.tiles = 'nope';
    },
    'tiles 裡有壞掉的項目': (state) => {
      state.tiles = [{ id: 1, owned: 'yes' }];
    },
    '沒有 buildings': (state) => {
      delete state.buildings;
    },
    '建築等級是負的': (state) => {
      state.buildings = { ...(state.buildings as object), farm: { level: -1, completesAt: null } };
    },
    '建築等級超過上限': (state) => {
      state.buildings = {
        ...(state.buildings as object),
        farm: { level: maxLevelOf('farm') + 1, completesAt: null },
      };
    },
    '建築等級不是整數': (state) => {
      state.buildings = { ...(state.buildings as object), farm: { level: 1.5, completesAt: null } };
    },
    '少一座建築': (state) => {
      const buildings = { ...(state.buildings as Record<string, unknown>) };
      delete buildings.granary;
      state.buildings = buildings;
    },
    '糧草是 NaN': (state) => {
      state.grain = 'NaN';
    },
    '糧草是負的': (state) => {
      state.grain = -1;
    },
    '時間戳是負的': (state) => {
      state.settledAt = -1;
    },
    'status 不在列舉裡': (state) => {
      state.status = 'winning';
    },
    '行軍的目標地不存在': (state) => {
      state.march = { tileId: '99,99', fromTileId: CITY, departedAt: T0, arrivesAt: T0 + 1000, heading: 'out' };
    },
    '出發地不存在': (state) => {
      state.march = { tileId: NEAR, fromTileId: '99,99', departedAt: T0, arrivesAt: T0 + 1000, heading: 'out' };
    },
    '從不是自己的地出發——隊伍會從敵區冒出來': (state) => {
      state.march = { tileId: NEAR, fromTileId: FAR, departedAt: T0, arrivesAt: T0 + 1000, heading: 'out' };
    },
    '行軍的抵達時間早於出發': (state) => {
      state.march = { tileId: NEAR, fromTileId: CITY, departedAt: T0 + 1000, arrivesAt: T0, heading: 'out' };
    },
    '行軍不是物件': (state) => {
      state.march = 42;
    },
    '行軍沒有標明方向——不知道要去哪還是要回來': (state) => {
      state.march = { tileId: NEAR, fromTileId: CITY, departedAt: T0, arrivesAt: T0 + 1000 };
    },
    '行軍的方向不是認得的值': (state) => {
      state.march = { tileId: NEAR, fromTileId: CITY, departedAt: T0, arrivesAt: T0 + 1000, heading: 'sideways' };
    },
    '行軍沒有出發地': (state) => {
      state.march = { tileId: NEAR, departedAt: T0, arrivesAt: T0 + 1000, heading: 'out' };
    },
    '沒有隊伍的位置': (state) => {
      delete state.armyAt;
    },
    '隊伍站在不存在的地上': (state) => {
      state.armyAt = '99,99';
    },
    '隊伍站在不是自己的地上——那個局面在規則裡到不了': (state) => {
      state.armyAt = FAR;
    },
    '沒有士氣': (state) => {
      delete state.morale;
    },
    '士氣是 0——每一擊都會是 0 傷害，那是一場打不完的仗': (state) => {
      state.morale = 0;
    },
    '士氣超過滿值': (state) => {
      state.morale = 1.5;
    },
    '士氣低於下限——低於下限就可能出現贏不了的仗': (state) => {
      state.morale = 0.1;
    },
  };

  for (const [name, mutate] of Object.entries(broken)) {
    it(name, () => {
      const raw = tamper((envelope) => mutate(envelope.state as Record<string, unknown>));
      expect(readSave(raw)).toEqual({ ok: false, reason: 'corrupt' });
    });
  }
});

/**
 * 地格與建築是「以現在的規則重建，再把存檔的擁有狀態蓋上去」。
 * 這擋掉一整類 bug：存檔沒辦法塞進一個 derive.ts 算不出血量的地格等級。
 */
describe('存檔塞不進非法的局面', () => {
  it('存檔裡的地格等級被忽略，一律用現在的地圖', () => {
    const raw = tamper((envelope) => {
      const state = envelope.state as Record<string, unknown>;
      state.tiles = [{ id: NEAR, owned: true, level: 999, terrain: 'lava' }];
    });
    const result = readSave(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const tile = result.state.tiles.find((each) => each.id === NEAR)!;
    expect(tile.level).toBeLessThanOrEqual(3);
    expect(tile.owned).toBe(true);
    // 地圖大小也是現在的，不是存檔那一份的。
    expect(result.state.tiles).toHaveLength(36);
  });

  it('主城永遠是自己的，就算存檔說不是', () => {
    const raw = tamper((envelope) => {
      (envelope.state as Record<string, unknown>).tiles = [];
    });
    const result = readSave(raw);
    expect(result.ok && result.state.tiles.find((tile) => tile.level === 0)?.owned).toBe(true);
  });

  it('滿級卻還在施工的建築，工程被丟掉而不是讓等級溢出', () => {
    const raw = tamper((envelope) => {
      const state = envelope.state as Record<string, unknown>;
      state.buildings = {
        ...(state.buildings as object),
        granary: { level: maxLevelOf('granary'), completesAt: T0 + 1000 },
      };
    });
    const result = readSave(raw);
    expect(result.ok && result.state.buildings.granary.completesAt).toBeNull();
  });
});

/** 讀檔之後接回去玩：離開那段時間的糧、完工、抵達，都在這一步結算。 */
describe('resumeGame', () => {
  it('補上離開期間的糧', () => {
    const saved = createGame('s', T0);
    const resumed = resumeGame(saved, T0 + HOUR_MS);
    expect(resumed.grain).toBeGreaterThan(saved.grain);
  });

  it('離開期間完工的建築，回來就是蓋好的', () => {
    const built = startUpgrade({ ...createGame('s', T0), grain: 5_000 }, 'farm', T0);
    const resumed = resumeGame(built, built.buildings.farm.completesAt! + 1);
    expect(resumed.buildings.farm.level).toBe(1);
    expect(resumed.buildings.farm.completesAt).toBeNull();
  });

  it('離開期間抵達的軍隊還在原地等接敵', () => {
    const marching = orderMarch(createGame('s', T0), NEAR, T0);
    const resumed = resumeGame(marching, T0 + HOUR_MS);
    expect(resumed.march?.tileId).toBe(NEAR);
    expect(resumed.battle).toBeNull();
  });

  it('存檔時卡住，離線夠久就自己解開了', () => {
    const stuck: GameState = { ...createGame('s', T0), grain: 0, status: 'stuck' };
    const resumed = resumeGame(stuck, T0 + HOUR_MS * 8);
    expect(resumed.grain).toBeGreaterThanOrEqual(MARCH_COST);
    expect(resumed.status).toBe('playing');
  });

  it('讀檔補算過一次之後，再補算不會重複發糧', () => {
    const resumed = resumeGame(createGame('s', T0), T0 + HOUR_MS);
    expect(settleTime(resumed, T0 + HOUR_MS).grain).toBe(resumed.grain);
  });
});
