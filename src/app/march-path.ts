/**
 * 隊伍在沙盤上的座標。
 *
 * 抽成不含 React 的純函式，是因為這裡是整段行軍動畫唯一會算錯的地方——
 * 走在格線外面、走反方向、抵達時沒有停在目標上，都是這幾行的責任。
 * 動畫本身（requestAnimationFrame 有沒有跑）是瀏覽器的事，測不了也不需要測。
 */

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Placement {
  readonly x: number;
  readonly y: number;
  /** 1 是往右，-1 是往左，0 是這一段沒有左右分量。 */
  readonly facing: number;
}

/**
 * 走完 `progress`（0 到 1）之後，在折線上的哪個點。
 *
 * 折線是一格一格接起來的，所以要先找出走在第幾段，再在那一段裡內插。
 * 進度超出 0–1 會被夾住：時鐘倒退或存檔時間怪掉時，隊伍該停在路的兩端，
 * 而不是飛到沙盤外面。
 */
export function placeAlong(points: readonly Point[], progress: number): Placement {
  if (points.length === 0) {
    throw new RangeError('march path is empty');
  }
  const segments = points.length - 1;
  if (segments < 1) {
    return { x: points[0].x, y: points[0].y, facing: 0 };
  }

  const travelled = Math.min(segments, Math.max(0, progress * segments));
  const index = Math.min(segments - 1, Math.floor(travelled));
  const within = travelled - index;
  const from = points[index];
  const to = points[index + 1];

  return {
    x: from.x + (to.x - from.x) * within,
    y: from.y + (to.y - from.y) * within,
    // 上下走的時候回 0，讓呼叫端維持原本的朝向——
    // 為了一個沒有左右分量的路段翻面，看起來像原地轉圈。
    facing: to.x < from.x ? -1 : to.x > from.x ? 1 : 0,
  };
}
