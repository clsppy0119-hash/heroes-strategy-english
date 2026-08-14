import { marchSpeedFactor } from './buildings';
import { MARCH_BASE_MS, MARCH_MS_PER_STEP } from './config';
import { distanceFromCity, type TileId } from './map';

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
 * ## 為什麼時間看的是離主城多遠，不是地格等級
 *
 * 出兵一律從相鄰的己方領地出發，所以「走幾格」永遠是一格，拿來算沒有意義。
 * 離主城的距離才是補給線的長度：越往外推，一趟越久。這跟等級同方向
 * （等級也是距離算出來的），但講的是不同的事——一個是仗難打，一個是路難走。
 */

export interface March {
  readonly tileId: TileId;
  readonly departedAt: number;
  readonly arrivesAt: number;
}

/** 走一趟要多久。core 不能自己取時間，所以這裡只回傳長度。 */
export function marchDurationMs(tileX: number, tileY: number, relayLevel: number): number {
  const base = MARCH_BASE_MS + MARCH_MS_PER_STEP * distanceFromCity(tileX, tileY);
  return Math.round(base * marchSpeedFactor(relayLevel));
}

export function startMarch(
  tileId: TileId,
  tileX: number,
  tileY: number,
  relayLevel: number,
  now: number,
): March {
  return {
    tileId,
    departedAt: now,
    arrivesAt: now + marchDurationMs(tileX, tileY, relayLevel),
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
