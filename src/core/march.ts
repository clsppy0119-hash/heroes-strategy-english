import { marchSpeedFactor } from './buildings';
import { MARCH_BASE_MS, MARCH_MS_PER_STEP } from './config';
import type { TileId } from './map';

/**
 * 行軍。
 *
 * ## 為什麼出兵不再是點下去就開打
 *
 * v0.1 的一切都在一次點擊裡完成：出兵、結算、佔領。那讓整局變成一連串
 * 沒有間隔的答題，也讓「時間」在遊戲裡完全不存在。
 *
 * v0.2 要驗的是「隔天有東西在等你」。行軍是那個假設最小的一個版本——
 * 你下了命令，然後它需要一段時間，而那段時間你可以不看著它。
 *
 * ## 為什麼抵達之後不自動開打
 *
 * 抵達就自動彈出戰鬥的話，玩家離開再回來看到的是一個「已經結束的東西」。
 * 停在「已抵達，等你接敵」才是回來的理由——那正是這一刀要驗的感覺。
 * 附帶好處是不必寫一個由計時器觸發的副作用，抵達只是一個看時間算出來的狀態。
 *
 * ## 為什麼時間看的是「離最近的己方領地多遠」
 *
 * 一開始是用「離主城多遠」算的，因為那樣畫面上的隊伍會真的走很多格，
 * 那個數字才看得懂。實測（2026-08-15）打臉了這個選擇：一場 232 秒的遊玩裡
 * **有 161 秒在看小人走路**，而且會越來越糟——行軍從 9 秒一路長到 25 秒，
 * 推算打完 35 塊地光走路要 15 分鐘。
 *
 * 現在改成從最近的己方領地出發。合法目標一定跟己方領地相鄰，所以那個距離
 * 永遠是一格，行軍時間變成固定值，不會隨擴張惡化。
 *
 * 代價是「遠的地方久」這條規則沒了，畫面上的隊伍也只走一格。那是換來的：
 * 等待時間不該隨著玩家玩得越好而越長。
 */

/**
 * 出征還是班師。
 *
 * 兩者共用同一個結構，因為對畫面來說它們是同一件事：一列人在沙盤上走。
 * 差別只有走的方向與長度，那用一個欄位就講完了。
 */
export type Heading = 'out' | 'home';

export interface March {
  /** 去程是目標，回程是從哪裡撤回來的。兩者都是同一塊地。 */
  readonly tileId: TileId;
  /** 出發的那塊己方領地。回程走回這裡，畫面上的隊伍也從這裡起步。 */
  readonly fromTileId: TileId;
  readonly departedAt: number;
  readonly arrivesAt: number;
  readonly heading: Heading;
}

/**
 * 班師只要去程的一半時間。
 *
 * 打完就走，不必再邊走邊探路——這是遊戲上的說法。真正的理由是：
 * 回程對玩家來說是純粹的等待，沒有任何期待在裡面（去程盡頭有一場仗），
 * 所以它該比去程短。一半是 lionw 定的。
 */
export const RETURN_RATIO = 0.5;

/**
 * 走一趟要多久。core 不能自己取時間，所以這裡只回傳長度。
 *
 * `steps` 是出發地到目標的格數。合法的出兵永遠是一格，但公式留著吃參數——
 * 之後如果做「跨過自己的領地去打遠處」，這裡不用重寫。
 */
export function marchDurationMs(steps: number, relayLevel: number): number {
  const base = MARCH_BASE_MS + MARCH_MS_PER_STEP * Math.max(1, steps);
  return Math.round(base * marchSpeedFactor(relayLevel));
}

export function returnDurationMs(steps: number, relayLevel: number): number {
  return Math.round(marchDurationMs(steps, relayLevel) * RETURN_RATIO);
}

export function startMarch(
  tileId: TileId,
  fromTileId: TileId,
  steps: number,
  relayLevel: number,
  now: number,
): March {
  return {
    tileId,
    fromTileId,
    departedAt: now,
    arrivesAt: now + marchDurationMs(steps, relayLevel),
    heading: 'out',
  };
}

/** 打完之後從那塊地走回出發地。 */
export function startReturn(
  tileId: TileId,
  fromTileId: TileId,
  steps: number,
  relayLevel: number,
  now: number,
): March {
  return {
    tileId,
    fromTileId,
    departedAt: now,
    arrivesAt: now + returnDurationMs(steps, relayLevel),
    heading: 'home',
  };
}

export function hasArrived(march: March, now: number): boolean {
  return now >= march.arrivesAt;
}

/** 還要多久，毫秒。已抵達是 0，不會是負的。 */
export function remainingMs(march: March, now: number): number {
  return Math.max(0, march.arrivesAt - now);
}

/**
 * 走完幾成，0 到 1。
 *
 * 時鐘倒退（換裝置、校時）時 departedAt 可能在未來，夾在 0 到 1 之間，
 * 讓進度條不會跑到框外或倒著長。
 */
export function marchProgress(march: March, now: number): number {
  const total = march.arrivesAt - march.departedAt;
  if (total <= 0) {
    return 1;
  }
  return Math.min(1, Math.max(0, (now - march.departedAt) / total));
}
