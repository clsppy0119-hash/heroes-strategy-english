"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

import { marchProgress, type March, type TileId } from "@/core";
import { t } from "@/i18n";

import { placeAlong } from "./march-path";

/**
 * 沙盤上真的在走的那一列人。
 *
 * ## 為什麼不是逐格亮起來
 *
 * 第一版是把路線上的格子一格一格點亮。那是地圖標記，不是人在走——
 * lionw 要的是「真的有人在上面走的那種」，而格子亮起來只說得出
 * 「軍隊到過這裡」，說不出「軍隊正在移動」。
 *
 * ## 為什麼要量 DOM
 *
 * 隊伍要走在格子之間的任意位置，而不是卡在格子上，所以需要真正的像素座標。
 * 格子大小由 CSS 決定（響應式、有 gap 有 padding），在 JS 裡重算一次那些數字
 * 等於把版面規則抄兩份——改一邊忘了另一邊，隊伍就會走在格線外面。
 * 所以直接量真正的格子，版面怎麼變都跟得上。
 *
 * ## 為什麼用 requestAnimationFrame 而不是 React state
 *
 * 位置每一幀都在變。丟進 state 會讓整張沙盤每秒重繪六十次；
 * 這裡只動一個節點的 transform，React 完全不參與。
 */

interface Center {
  readonly x: number;
  readonly y: number;
  readonly size: number;
}

/**
 * 量出每一格的中心點，版面變了就重量。
 *
 * 用 offsetLeft/offsetTop 而不是 getBoundingClientRect：前者已經是相對於
 * 容器的座標，捲動頁面不會讓隊伍飄走。
 *
 * ## 為什麼連格子本身都要 observe
 *
 * 只 observe 容器不夠。第一次量到的時候格子可能還沒排版完（量到的寬度是
 * 兩條邊框加起來的 2px），而容器的尺寸從頭到尾沒變過，所以 observer
 * 不會再叫第二次——隊伍就會用那份錯的座標走一輩子，而且小到看不見。
 *
 * 實際踩過這個坑：隊伍算出來是 2×2 像素，畫面上等於什麼都沒有。
 */
export function useTileCenters(container: RefObject<HTMLElement | null>): Record<TileId, Center> {
  const [centers, setCenters] = useState<Record<TileId, Center>>({});

  useEffect(() => {
    const node = container.current;
    if (node === null) {
      return;
    }

    let signature = "";
    const measure = () => {
      const next: Record<TileId, Center> = {};
      let current = "";
      for (const tile of node.querySelectorAll<HTMLElement>("[data-tile]")) {
        const id = tile.dataset.tile;
        if (id !== undefined) {
          const center = {
            x: tile.offsetLeft + tile.offsetWidth / 2,
            y: tile.offsetTop + tile.offsetHeight / 2,
            size: tile.offsetWidth,
          };
          next[id] = center;
          current += `${id}:${center.x},${center.y},${center.size};`;
        }
      }
      // 尺寸沒變就不要製造新物件——observer 在拖動視窗時會叫得很密。
      if (current !== signature) {
        signature = current;
        setCenters(next);
      }
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    for (const tile of node.querySelectorAll<HTMLElement>("[data-tile]")) {
      observer.observe(tile);
    }
    return () => observer.disconnect();
  }, [container]);

  return centers;
}

/**
 * 小於這個尺寸就當作還沒排版完。
 *
 * 沒有這道門檻的話，排版還沒好時算出來的隊伍會是幾個像素大——
 * 那不會報錯，只會安靜地什麼都看不到。
 */
const MIN_TILE_PX = 16;

export function MarchColumn({
  march,
  path,
  centers,
  arrived,
  now,
}: {
  march: March;
  /** 路線上的格子，從主城到目標。 */
  path: readonly TileId[];
  centers: Record<TileId, Center>;
  arrived: boolean;
  /**
   * 外面那個每秒一次的心跳。
   *
   * 位置本來是 requestAnimationFrame 在更新的，但瀏覽器在分頁不可見時
   * 會把 rAF 停掉。把心跳也接進來，最差的情況是隊伍變成一秒一格地挪，
   * 而不是整個凍住——凍住看起來像壞掉，慢看起來只是慢。
   */
  now: number;
}) {
  const node = useRef<HTMLDivElement>(null);
  const facing = useRef(1);

  const points = path.map((id) => centers[id]).filter((center): center is Center => center !== undefined);
  const size = points.length > 0 ? points[0].size : 0;
  const ready = points.length === path.length && points.length > 0 && size >= MIN_TILE_PX;

  useEffect(() => {
    const element = node.current;
    if (element === null || !ready) {
      return;
    }

    const place = () => {
      const at = placeAlong(points, marchProgress(march, Date.now()));
      if (at.facing !== 0) {
        facing.current = at.facing;
      }
      element.style.transform = `translate3d(${at.x - size / 2}px, ${at.y - size / 2}px, 0) scaleX(${facing.current})`;
    };

    place();
    if (arrived) {
      return;
    }
    let frame = requestAnimationFrame(function step() {
      place();
      frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
    // points 是每次 render 新生的陣列，放進相依會讓 effect 每次都重跑。
    // 真正會改變動畫的是這幾個值；now 在這裡的用途是 rAF 被停掉時的備援。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [march.tileId, march.departedAt, march.arrivesAt, arrived, ready, size, path.join(), now]);

  if (!ready) {
    return null;
  }

  return (
    <div
      ref={node}
      aria-hidden
      className="pointer-events-none absolute left-0 top-0 will-change-transform"
      style={{ width: size, height: size }}
    >
      <Soldiers marching={!arrived} />
      <span className="sr-only">{arrived ? t("march.arrived") : t("march.column")}</span>
    </div>
  );
}

/**
 * 駐紮中的隊伍。
 *
 * 打完不會自動班師，所以閒置時隊伍站在某一格上。畫出來的理由不是好看：
 * 下一趟行軍多久是從這裡算的，玩家看不到隊伍就算不出來自己在付什麼。
 */
export function ArmyMarker({
  at,
  centers,
}: {
  at: TileId;
  centers: Record<TileId, Center>;
}) {
  const center = centers[at];
  if (center === undefined || center.size < MIN_TILE_PX) {
    return null;
  }
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute left-0 top-0"
      style={{
        width: center.size,
        height: center.size,
        transform: `translate3d(${center.x - center.size / 2}px, ${center.y - center.size / 2}px, 0)`,
      }}
    >
      <Soldiers marching={false} />
    </div>
  );
}

/**
 * 一列三個人加一面旗。
 *
 * 腳的動作是兩張圖輪流出現（steps(1) 的翻頁），不是插值——這個尺寸下
 * 關節角度看不出來，看得出來的是「腳換了」。翻頁比補間可靠得多，
 * 而且不會在慢一點的機器上變成滑步。
 *
 * 三個人的擺動時間刻意不同步：一起上下會像彈簧，錯開才像一群人在走。
 */
function Soldiers({ marching }: { marching: boolean }) {
  return (
    <svg viewBox="0 0 26 20" className="h-full w-full overflow-visible" role="presentation">
      {/* 地上的影子，讓隊伍看起來站在沙盤上而不是浮在上面 */}
      <ellipse cx="13" cy="17.6" rx="8" ry="1.1" fill="var(--ink)" opacity="0.12" />

      <Soldier x={5} delay={-0.32} marching={marching} />
      <Soldier x={12} delay={-0.16} marching={marching} />
      <Soldier x={19} delay={0} marching={marching} banner />
    </svg>
  );
}

function Soldier({
  x,
  delay,
  marching,
  banner = false,
}: {
  x: number;
  delay: number;
  marching: boolean;
  banner?: boolean;
}) {
  return (
    <g
      className={marching ? "soldier" : undefined}
      style={marching ? { animationDelay: `${delay}s` } : undefined}
    >
      {banner && (
        <>
          <line x1={x + 2.4} y1="1.5" x2={x + 2.4} y2="13" stroke="var(--ink)" strokeWidth="0.5" />
          <path d={`M${x + 2.4} 1.8 L${x + 6} 3.1 L${x + 2.4} 4.4 Z`} fill="var(--vermilion)" />
        </>
      )}

      <circle cx={x} cy="6" r="1.7" fill="var(--ink)" />
      <path
        d={`M${x} 7.7 L${x} 12`}
        stroke="var(--ink)"
        strokeWidth="1.8"
        strokeLinecap="round"
      />

      {/* 腳。兩張圖輪流，marching 停掉時只留第一張的站姿。 */}
      <g className={marching ? "stride-a" : undefined}>
        <path
          d={`M${x} 12 L${x - 1.9} 15.6 M${x} 12 L${x + 1.5} 15.6`}
          stroke="var(--ink)"
          strokeWidth="1.2"
          strokeLinecap="round"
        />
      </g>
      {marching && (
        <g className="stride-b">
          <path
            d={`M${x} 12 L${x - 0.5} 15.6 M${x} 12 L${x + 2.2} 15.6`}
            stroke="var(--ink)"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </g>
      )}
    </g>
  );
}
