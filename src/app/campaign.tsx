"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { storedRecords, track } from "@/analytics";
import { vocabProvider, type Question } from "@/content";
import {
  BUILDING_IDS,
  GRID_SIZE,
  MARCH_COST,
  RULES_VERSION,
  START_TROOPS,
  answerRound,
  battleId as makeBattleId,
  battleSeed,
  capturedCount,
  CLOCK_NOT_STARTED,
  createGame,
  defenderHpFor,
  dismissBattle,
  engageBattle,
  grainPerHour,
  isUnderConstruction,
  marchBlockedReason,
  marchDurationMs,
  marchHasArrived,
  marchHeadIndex,
  marchPath,
  marchProgress,
  maxLevelOf,
  msPerGrain,
  orderMarch,
  previewDamage,
  previewMultiplier,
  ownedCount,
  recallMarch,
  remainingMs,
  resumeGame,
  retreat,
  roundsFor,
  settleTime,
  startClock,
  startUpgrade,
  upgradeBlockedReason,
  upgradeCost,
  upgradeMs,
  vocabLevelForTile,
  type BuildingId,
  type GameState,
  type LossReason,
  type March,
  type Terrain,
  type Tile,
} from "@/core";
import { t, type MessageKey } from "@/i18n";
import { LOCAL_PLAYER_ID, gameRepository } from "@/persistence";

import { MarchColumn, useTileCenters } from "./march-column";

/** 回來時桌上多出來的東西。零的話不打擾玩家。 */
interface Welcome {
  readonly awayMs: number;
  readonly grain: number;
}

const TOTAL_TILES = GRID_SIZE * GRID_SIZE - 1;

/** v0.1 沒有存檔，重開就是新的一局；種子固定讓測試場次可以互相比較。 */
const SEED_TEXT = "v0.1";

/**
 * 心跳。補算是冪等的，所以這個頻率純粹是畫面更新的節奏。
 *
 * 一秒是行軍倒數要的最粗粒度——五秒一跳的倒數會在原地停三次再一次掉五秒，
 * 看起來像壞掉。
 */
const TICK_MS = 1_000;

function seconds(ms: number): number {
  return Math.ceil(ms / 1000);
}

/**
 * 一段時間有多長。
 *
 * 兩分鐘以下寫秒：驛站第一級是 90 秒，四捨五入成「2 分」或「1 分」都不是實話。
 * 兩小時以上寫小時：離線一夜回來看到「還要 540 分」沒有人在心裡除得動。
 */
function durationLabel(ms: number): string {
  if (ms >= 7_200_000) {
    return t("build.hours", { hours: Math.round(ms / 3_600_000) });
  }
  return ms >= 120_000
    ? t("build.minutes", { minutes: Math.round(ms / 60_000) })
    : t("march.seconds", { seconds: seconds(ms) });
}

/** 還剩多久。跟 durationLabel 分開，因為「工期 還要 2 分」不是人話。 */
function untilLabel(ms: number): string {
  return t("build.until", { duration: durationLabel(ms) });
}

function buildingName(id: BuildingId): string {
  return t(`build.${id}.name` as MessageKey);
}

function buildingEffect(id: BuildingId): string {
  return t(`build.${id}.effect` as MessageKey);
}

/** 地形的顯示名稱走 i18n；core 裡只有識別碼。 */
function terrainName(terrain: Terrain): string {
  return t(`terrain.${terrain}` as MessageKey);
}

/** 沙盤上的地形標記＝地形名稱的第一個字。不另外寫死一份字。 */
function terrainMark(terrain: Terrain): string {
  return terrainName(terrain).slice(0, 1);
}

export function Campaign() {
  const [game, setGame] = useState<GameState>(() => createGame(SEED_TEXT, CLOCK_NOT_STARTED));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<readonly Question[]>([]);
  // 心跳存下來的「現在」。render 期間不能取時間（不純），倒數要靠這個。
  const [now, setNow] = useState<number>(CLOCK_NOT_STARTED);

  /** 讀檔之後才開始自動存檔。不然掛載那一瞬間的空局面會蓋掉真正的存檔。 */
  const [loaded, setLoaded] = useState(false);
  /** 這次回來補到多少離線產出。零或還沒讀檔時不顯示。 */
  const [welcomeBack, setWelcomeBack] = useState<Welcome | null>(null);

  // 作答時間要從「題目出現」算起，不是從 render 算起。
  const shownAt = useRef<number>(0);
  // render 期間不能取時間（不純），所以掛載後才記 session 起點。
  const sessionStart = useRef<number>(0);

  /**
   * 讀檔。
   *
   * 伺服器端 render 沒有 localStorage，而且 render 期間不能取時間，
   * 所以初始狀態是一個「還不知道現在幾點」的空局面，掛載後才換成真的。
   */
  useEffect(() => {
    let cancelled = false;
    const repository = gameRepository();

    void repository.load(LOCAL_PLAYER_ID).then((result) => {
      if (cancelled) {
        return;
      }
      const at = Date.now();
      sessionStart.current = at;

      const restored = result.ok ? resumeGame(result.state, at) : createGame(SEED_TEXT, at);
      const offlineGrain = result.ok ? restored.grain - result.state.grain : 0;

      track({
        type: "session_start",
        sinceLastSaveMs: result.ok ? at - result.savedAt : null,
        loaded: result.ok ? "ok" : result.reason,
        offlineGrain,
      });

      setGame(restored);
      setNow(at);
      setLoaded(true);
      if (result.ok && offlineGrain > 0) {
        setWelcomeBack({ awayMs: at - result.savedAt, grain: offlineGrain });
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // 對時之後定期補算——玩家看著糧草長，那是「時間在動」的唯一證據。
  useEffect(() => {
    const tick = () => {
      const at = Date.now();
      setNow(at);
      setGame((current) => settleTime(startClock(current, at), at));
    };
    tick();
    const timer = setInterval(tick, TICK_MS);
    return () => clearInterval(timer);
  }, []);

  /**
   * 自動存檔。
   *
   * 不用 debounce：settleTime 在沒有產出的那幾秒會回傳同一個物件，
   * 所以 game 的身分只在真的有事發生時才變，這個 effect 自然就不會每秒跑。
   */
  useEffect(() => {
    if (!loaded) {
      return;
    }
    void gameRepository().save(LOCAL_PLAYER_ID, game, Date.now());
  }, [game, loaded]);

  /**
   * 關掉分頁前再存一次。
   *
   * 上面那個 effect 存的是「上一個有變化的局面」，而玩家最後那幾秒的產出
   * 可能還沒觸發變化。pagehide 是行動瀏覽器唯一保證會發的離開事件——
   * beforeunload 在 iOS Safari 上不一定會來。
   */
  useEffect(() => {
    if (!loaded) {
      return;
    }
    const flush = () => {
      const at = Date.now();
      void gameRepository().save(LOCAL_PLAYER_ID, settleTime(game, at), at);
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [game, loaded]);

  /**
   * 完工是補算時間時算出來的，沒有一個「玩家按下去」的時刻可以埋點，
   * 所以改成盯著等級變化。這樣埋到的時間戳是玩家看到完工的那一刻——
   * 那正是 v0.2 想知道的（蓋了東西的人，隔多久回來看）。
   */
  const levels = BUILDING_IDS.map((id) => game.buildings[id].level).join(",");
  const seenLevels = useRef<string>("");
  useEffect(() => {
    if (seenLevels.current === "") {
      seenLevels.current = levels;
      return;
    }
    if (seenLevels.current === levels) {
      return;
    }
    const before = seenLevels.current.split(",").map(Number);
    levels.split(",").forEach((value, index) => {
      if (Number(value) > before[index]) {
        track({ type: "building_completed", building: BUILDING_IDS[index], level: Number(value) });
      }
    });
    seenLevels.current = levels;
  }, [levels]);

  const battle = game.battle;
  const selected = game.tiles.find((tile) => tile.id === selectedId) ?? null;

  /** 下令出兵。這一刻只是上路，戰鬥要等抵達之後玩家再按接敵。 */
  const order = useCallback(
    (tile: Tile) => {
      track({
        type: "march_ordered",
        tileId: tile.id,
        tileLevel: tile.level,
        durationMs: marchDurationMs(tile.x, tile.y, game.buildings.relay.level),
      });
      setGame(orderMarch(game, tile.id, Date.now()));
    },
    [game],
  );

  const build = useCallback(
    (id: BuildingId) => {
      const at = Date.now();
      track({
        type: "building_started",
        building: id,
        toLevel: game.buildings[id].level + 1,
        cost: upgradeCost(id, game.buildings[id].level),
        buildMs: upgradeMs(id, game.buildings[id].level),
      });
      // 先補算再動工，否則這次升級的產速會回頭套到過去的時間。
      setGame(startUpgrade(settleTime(game, at), id, at));
    },
    [game],
  );

  const recall = useCallback(() => {
    if (game.march === null) {
      return;
    }
    const at = Date.now();
    track({
      type: "march_recalled",
      tileId: game.march.tileId,
      elapsedMs: at - game.march.departedAt,
      arrived: marchHasArrived(game, at),
    });
    setGame(recallMarch(game));
  }, [game]);

  /**
   * 接敵。抽題要用 battleSeed(state, id)，所以順序是先算種子、抽題、再進 core。
   * 抵達之後不自動開打——停在「等你接敵」才是離開再回來的理由。
   */
  const engage = useCallback(() => {
    const march = game.march;
    if (march === null) {
      return;
    }
    const tile = game.tiles.find((each) => each.id === march.tileId);
    if (tile === undefined) {
      return;
    }
    const at = Date.now();

    const drawn = vocabProvider.getQuestions({
      count: roundsFor(tile.level),
      level: vocabLevelForTile(tile.level),
      seed: battleSeed(game, tile.id),
    });

    const next = engageBattle(
      game,
      drawn.map((question) => ({
        id: question.id,
        answerIndex: question.answerIndex,
        choiceCount: question.choices.length,
      })),
      at,
    );

    track({
      type: "battle_start",
      battleId: makeBattleId(game, tile.id),
      tileId: tile.id,
      seed: battleSeed(game, tile.id),
      rulesVersion: RULES_VERSION,
      waitedMs: at - march.departedAt,
    });
    track({ type: "question_shown", battleId: next.battle!.battleId, round: 0, questionId: drawn[0].id });

    shownAt.current = at;
    setQuestions(drawn);
    setGame(next);
  }, [game]);

  const submit = useCallback(
    (choiceIndex: number | null) => {
      if (battle === null || battle.outcome !== "ongoing") {
        return;
      }
      const question = questions[battle.round];
      const elapsedMs = Date.now() - shownAt.current;
      const next = answerRound(game, choiceIndex);
      const resolved = next.battle!.log[next.battle!.log.length - 1];

      if (choiceIndex === null) {
        track({
          type: "question_skipped",
          battleId: battle.battleId,
          round: battle.round,
          questionId: question.id,
          elapsedMs,
        });
      } else {
        track({
          type: "question_answered",
          battleId: battle.battleId,
          round: battle.round,
          questionId: question.id,
          correct: resolved.correct,
          elapsedMs,
          streak: resolved.streakAfter,
        });
      }

      const finished = next.battle!;
      if (finished.outcome === "ongoing") {
        track({
          type: "question_shown",
          battleId: finished.battleId,
          round: finished.round,
          questionId: questions[finished.round].id,
        });
        shownAt.current = Date.now();
      } else {
        track({
          type: "battle_end",
          battleId: finished.battleId,
          won: finished.outcome === "won",
          rounds: finished.log.length,
          correctCount: finished.correctCount,
          maxStreak: finished.maxStreak,
          abandoned: false,
        });
        if (finished.outcome === "won") {
          track({
            type: "tile_captured",
            tileId: finished.tileId,
            totalCaptured: capturedCount(next),
            sinceSessionStartMs: Date.now() - sessionStart.current,
          });
        }
      }

      setGame(next);
    },
    [battle, game, questions],
  );

  const giveUp = useCallback(() => {
    if (battle === null || battle.outcome !== "ongoing") {
      return;
    }
    const next = retreat(game);
    track({
      type: "battle_end",
      battleId: battle.battleId,
      won: false,
      rounds: battle.log.length,
      correctCount: battle.correctCount,
      maxStreak: battle.maxStreak,
      abandoned: true,
    });
    setGame(next);
  }, [battle, game]);

  const restart = useCallback(() => {
    track({
      type: "session_end",
      durationMs: Date.now() - sessionStart.current,
      battlesStarted: game.battlesStarted,
      battlesFinished: game.battlesStarted - (game.battle?.outcome === "ongoing" ? 1 : 0),
    });
    const at = Date.now();
    sessionStart.current = at;
    setNow(at);
    // 存檔先清掉再寫新局面：中途當掉的話，寧可讓玩家從頭開始，
    // 也不要留下一份「一半舊一半新」的存檔。
    void gameRepository()
      .clear(LOCAL_PLAYER_ID)
      .then(() => setGame(createGame(SEED_TEXT, at)));
    setSelectedId(null);
    setQuestions([]);
    setWelcomeBack(null);
  }, [game]);

  const battleTile = battle === null ? null : (game.tiles.find((tile) => tile.id === battle.tileId) ?? null);

  return (
    <div className="flex w-full flex-col gap-8">
      <Header
        grain={game.grain}
        grainRate={Math.round(grainPerHour(ownedCount(game), game.buildings.farm.level))}
        captured={capturedCount(game)}
        onExport={exportRecords}
      />

      {welcomeBack !== null && (
        <WelcomeBack welcome={welcomeBack} onDismiss={() => setWelcomeBack(null)} />
      )}

      {battle !== null && battle.outcome === "ongoing" ? (
        <BattlePanel
          battle={battle}
          tile={battleTile}
          question={questions[battle.round]}
          onAnswer={submit}
          onRetreat={giveUp}
        />
      ) : battle !== null ? (
        <BattleReport
          battle={battle}
          tile={battleTile}
          onDismiss={() => setGame(dismissBattle(game))}
        />
      ) : (
        <Sandtable
          game={game}
          selected={selected}
          now={now}
          onSelect={(tile) => setSelectedId(tile.id)}
          onMarch={order}
          onEngage={engage}
          onRecall={recall}
        />
      )}

      {/* 主城在打仗的時候不該分心，所以戰鬥畫面不顯示。 */}
      {battle === null && <CityPanel game={game} now={now} onBuild={build} />}

      {game.status === "cleared" ? (
        <section className="flex flex-col gap-3 border-t-2 border-vermilion bg-paper-raised p-5">
          <p className="font-display text-lg">{t("campaign.status.cleared")}</p>
          <button type="button" onClick={restart} className="self-start bg-vermilion px-5 py-2 text-sm font-medium text-paper">
            {t("campaign.restart")}
          </button>
        </section>
      ) : game.status === "stuck" ? (
        <WaitingForGrain game={game} onRestart={restart} />
      ) : null}
    </div>
  );
}

/**
 * 回來了。
 *
 * v0.2 要驗的假設是「隔天有東西在等你」。離線產糧算得再對，玩家沒看到
 * 就等於沒發生——#21 的教訓是機制沒被看見等於沒做。所以這裡把「你不在的
 * 這段時間發生了什麼」直接講出來，而不是讓玩家自己去比對數字。
 */
function WelcomeBack({ welcome, onDismiss }: { welcome: Welcome; onDismiss: () => void }) {
  return (
    <section className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-l-4 border-bronze bg-paper-raised py-3 pl-4 pr-5">
      <p className="font-display text-lg font-bold">{t("resume.heading")}</p>
      <p className="text-sm tabular-nums">
        {t("resume.summary", { away: durationLabel(welcome.awayMs), grain: welcome.grain })}
      </p>
      <button
        type="button"
        onClick={onDismiss}
        className="ml-auto text-sm text-ink-soft underline underline-offset-4"
      >
        {t("resume.dismiss")}
      </button>
    </section>
  );
}

/**
 * 主城。
 *
 * 這裡是 v0.2 唯一一個「你不在的時候世界還在動」的具體證據——沙盤上的地
 * 不會自己變，糧草的數字動得太慢看不出來，只有蓋到一半的工程回來時會不一樣。
 */
function CityPanel({
  game,
  now,
  onBuild,
}: {
  game: GameState;
  now: number;
  onBuild: (id: BuildingId) => void;
}) {
  return (
    <section className="flex flex-col gap-3">
      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink-soft">
        {t("build.heading")}
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        {BUILDING_IDS.map((id) => (
          <BuildingCard key={id} id={id} game={game} now={now} onBuild={onBuild} />
        ))}
      </div>
    </section>
  );
}

function BuildingCard({
  id,
  game,
  now,
  onBuild,
}: {
  id: BuildingId;
  game: GameState;
  now: number;
  onBuild: (id: BuildingId) => void;
}) {
  const building = game.buildings[id];
  const max = maxLevelOf(id);
  const building_ = isUnderConstruction(game, id, now);
  const blocked = upgradeBlockedReason(game, id, now);

  return (
    <div className="flex flex-col gap-2 border border-rule bg-paper-raised p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-display text-lg font-bold">{buildingName(id)}</h3>
        <span className="font-mono text-[11px] tabular-nums text-ink-soft">
          {t("build.level", { level: building.level, max })}
        </span>
      </div>
      <p className="text-xs text-ink-soft">{buildingEffect(id)}</p>

      {building_ ? (
        /* 純文字倒數看起來像壞掉的時鐘。長條會動，工程才像在進行。 */
        <div className="flex flex-col gap-1.5">
          <div className="h-1 w-full bg-paper-sunk">
            <div
              className="h-full bg-bronze transition-[width] duration-1000 ease-linear"
              style={{
                width: `${
                  (1 - (building.completesAt! - now) / upgradeMs(id, building.level)) * 100
                }%`,
              }}
            />
          </div>
          <p className="font-mono text-xs tabular-nums text-bronze">
            {t("build.underway", { until: untilLabel(building.completesAt! - now) })}
          </p>
        </div>
      ) : blocked === "max-level" ? (
        <p className="font-mono text-xs text-ink-soft">{t("build.maxed")}</p>
      ) : (
        <>
          {/* 代價寫在按之前：花多少糧、要蓋多久。 */}
          <p className="font-mono text-xs tabular-nums text-ink-soft">
            {t("build.cost", {
              grain: upgradeCost(id, building.level),
              duration: durationLabel(upgradeMs(id, building.level)),
            })}
          </p>
          <button
            type="button"
            disabled={blocked !== null}
            onClick={() => onBuild(id)}
            className="self-start bg-bronze px-4 py-1.5 font-display text-sm font-bold text-paper disabled:cursor-not-allowed disabled:bg-transparent disabled:text-ink-soft disabled:opacity-60"
          >
            {blocked === "busy"
              ? t("build.blocked.busy")
              : blocked === "not-enough-grain"
                ? t("build.blocked.notEnoughGrain")
                : t("build.start")}
          </button>
        </>
      )}
    </div>
  );
}

/**
 * 糧草見底。
 *
 * v0.1 這裡寫的是「這一局結束了」，因為當時糧草只能從打仗來，見底就真的沒了。
 * v0.2 有時間產出，見底變成「等一下就好」——把等待寫成 game over 會讓玩家關掉分頁，
 * 而那正好是 v0.2 要驗的假設（隔天有東西在等你）最需要的那個時刻。
 *
 * 所以這裡給的是還要等多久，重開只留一條不起眼的退路。
 */
function WaitingForGrain({ game, onRestart }: { game: GameState; onRestart: () => void }) {
  const minutes = Math.ceil(((MARCH_COST - game.grain) * msPerGrain(ownedCount(game))) / 60_000);

  return (
    <section className="flex flex-col gap-3 border-t-2 border-bronze bg-paper-raised p-5">
      <p className="font-display text-lg">{t("campaign.status.waiting")}</p>
      <p className="font-mono text-sm tabular-nums text-bronze">
        {minutes <= 1 ? t("campaign.status.waitingSoon") : t("campaign.status.waitingIn", { minutes })}
      </p>
      <button type="button" onClick={onRestart} className="self-start text-sm text-ink-soft underline underline-offset-4">
        {t("campaign.restart")}
      </button>
    </section>
  );
}

/**
 * 測試場結束後把埋點交出來。
 *
 * v0.1 的資料只存在測試者的瀏覽器裡，所以要有一個把它拿出來的方法。
 * v0.2 事件直接進後端之後，這顆按鈕就可以拿掉。
 */
function exportRecords(): void {
  const blob = new Blob([JSON.stringify(storedRecords(), null, 1)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `playtest-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "")}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function Header({
  grain,
  grainRate,
  captured,
  onExport,
}: {
  grain: number;
  grainRate: number;
  captured: number;
  onExport: () => void;
}) {
  return (
    <header className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <h1 className="font-display text-3xl font-bold sm:text-4xl">{t("campaign.heading")}</h1>
        <p className="max-w-prose text-sm text-ink-soft">{t("campaign.subheading")}</p>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-4 border-y border-rule py-3">
        <dl className="flex gap-8">
          <Stat
            label={t("campaign.grain")}
            value={String(grain)}
            note={t("campaign.grainRate", { rate: grainRate })}
            tone="bronze"
          />
          <Stat
            label={t("campaign.captured")}
            value={t("campaign.capturedValue", { captured, total: TOTAL_TILES })}
            tone="vermilion"
          />
        </dl>
        <div className="flex items-center gap-4 font-mono text-[11px] text-ink-soft">
          <span>{t("campaign.rules", { version: RULES_VERSION })}</span>
          <button type="button" onClick={onExport} className="underline underline-offset-4">
            {t("campaign.export")}
          </button>
        </div>
      </div>
    </header>
  );
}

function Stat({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note?: string;
  tone: "bronze" | "vermilion";
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink-soft">{label}</dt>
      <dd
        className={`font-display text-2xl font-bold tabular-nums ${
          tone === "bronze" ? "text-bronze" : "text-vermilion"
        }`}
      >
        {value}
      </dd>
      {note !== undefined && <dd className="font-mono text-[11px] tabular-nums text-ink-soft">{note}</dd>}
    </div>
  );
}

/* ---------------------------------- 沙盤 ---------------------------------- */

function Sandtable({
  game,
  selected,
  now,
  onSelect,
  onMarch,
  onEngage,
  onRecall,
}: {
  game: GameState;
  selected: Tile | null;
  now: number;
  onSelect: (tile: Tile) => void;
  onMarch: (tile: Tile) => void;
  onEngage: () => void;
  onRecall: () => void;
}) {
  const march = game.march;
  const marchTile = march === null ? null : (game.tiles.find((tile) => tile.id === march.tileId) ?? null);

  /**
   * 行軍路線。隊伍從主城一格一格走過去，走過的格子留下印子。
   *
   * 這不只是裝飾：行軍時間是用「離主城幾步」算的，讓軍隊真的走那麼多格，
   * 那個數字才變得看得懂——遠的地方久，是因為路真的長。
   */
  const path = marchTile === null ? [] : marchPath(marchTile.x, marchTile.y);
  const head = march === null ? -1 : marchHeadIndex(path, marchProgress(march, now));
  const grid = useRef<HTMLDivElement>(null);
  const centers = useTileCenters(grid);
  /**
   * 抵達之後隊伍就不畫了，換成目標格脈動的「已就位」。
   *
   * 這個判斷不能省成「頭還沒到最後一格」：主城旁邊的地距離是 1，路線只有
   * 主城跟目標兩格，隊伍一出發就已經在最後一格上。那是新玩家第一件會做的事，
   * 也是最不能沒有動靜的一次。
   */
  const arrived = march !== null && now >= march.arrivesAt;

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-8">
      <div className="flex flex-col gap-2">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink-soft">
          {t("campaign.mapLabel")}
        </p>
        {/* relative：走在上面的那一列人是絕對定位的，座標相對於這張沙盤。 */}
        <div
          ref={grid}
          className="sandtable relative grid w-full max-w-lg grid-cols-6 gap-1 border-2 border-rule-strong bg-paper-sunk p-1.5 lg:w-[30rem]"
        >
          {game.tiles.map((tile) => {
            const step = path.indexOf(tile.id);
            return (
              <TileButton
                key={tile.id}
                tile={tile}
                marchable={marchBlockedReason(game, tile.id) === null}
                selected={selected?.id === tile.id}
                onRoute={step > 0 && step <= head}
                targeted={march?.tileId === tile.id && !arrived}
                onSelect={onSelect}
              />
            );
          })}

          {march !== null && (
            <MarchColumn march={march} path={path} centers={centers} arrived={arrived} now={now} />
          )}
        </div>
      </div>

      <aside className="flex flex-1 flex-col gap-4 border border-rule bg-paper-raised p-5">
        {march !== null ? (
          <MarchPanel march={march} tile={marchTile} now={now} onEngage={onEngage} onRecall={onRecall} />
        ) : (
          <TileDetail game={game} tile={selected} onMarch={onMarch} />
        )}
      </aside>
    </div>
  );
}

/**
 * 軍隊在路上。
 *
 * 抵達之後停在這裡等玩家按接敵，不自動開打——那一刻才是「離開再回來，
 * 有東西在等你」最小的一個版本，而 v0.2 要驗的就是這件事。
 */
function MarchPanel({
  march,
  tile,
  now,
  onEngage,
  onRecall,
}: {
  march: March;
  tile: Tile | null;
  now: number;
  onEngage: () => void;
  onRecall: () => void;
}) {
  const arrived = now >= march.arrivesAt;
  const progress = marchProgress(march, now);

  return (
    <>
      <div className="flex flex-col gap-0.5">
        <h2 className="font-display text-2xl font-bold whitespace-nowrap">
          {arrived ? t("march.arrivedHeading") : t("march.heading")}
        </h2>
        {tile !== null && (
          <span className="font-mono text-xs text-ink-soft">
            {terrainName(tile.terrain)} · {t("tile.level", { level: tile.level })}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="h-1.5 w-full bg-paper-sunk">
          <div
            className="h-full bg-bronze transition-[width] duration-1000 ease-linear"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
        <p className="font-mono text-xs tabular-nums text-ink-soft">
          {arrived
            ? t("march.arrived")
            : t("march.remaining", { seconds: seconds(remainingMs(march, now)) })}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        {arrived && (
          <button
            type="button"
            onClick={onEngage}
            className="bg-vermilion px-6 py-2.5 font-display text-base font-bold text-paper"
          >
            {t("march.engage")}
          </button>
        )}
        <button type="button" onClick={onRecall} className="text-sm text-ink-soft underline underline-offset-4">
          {t("march.recall")}
        </button>
      </div>
    </>
  );
}

function TileDetail({
  game,
  tile,
  onMarch,
}: {
  game: GameState;
  tile: Tile | null;
  onMarch: (tile: Tile) => void;
}) {
  if (tile === null || tile.level === 0) {
    return <p className="text-sm text-ink-soft">{t("tile.select")}</p>;
  }
  const blocked = marchBlockedReason(game, tile.id);

  return (
    <>
      <div className="flex items-baseline gap-3">
        <h2 className="font-display text-2xl font-bold">{terrainName(tile.terrain)}</h2>
        <span className="font-mono text-sm text-ink-soft">{t("tile.level", { level: tile.level })}</span>
      </div>

      {/* 代價寫在按之前：守軍多硬、花多少糧、要走多久。 */}
      <dl className="flex gap-8 border-y border-rule py-3 text-sm">
        <div className="flex flex-col gap-0.5">
          <dt className="font-mono text-[11px] uppercase tracking-[0.15em] text-ink-soft">
            {t("battle.defender")}
          </dt>
          <dd className="font-mono text-lg tabular-nums text-azure">
            {tile.owned ? "—" : defenderHpFor(tile.level)}
          </dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="font-mono text-[11px] uppercase tracking-[0.15em] text-ink-soft">
            {t("campaign.grain")}
          </dt>
          <dd className="font-mono text-lg tabular-nums text-bronze">−{MARCH_COST}</dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="font-mono text-[11px] uppercase tracking-[0.15em] text-ink-soft">
            {t("march.label")}
          </dt>
          <dd className="font-mono text-lg tabular-nums text-ink-soft">
            {t("march.seconds", {
              seconds: seconds(marchDurationMs(tile.x, tile.y, game.buildings.relay.level)),
            })}
          </dd>
        </div>
      </dl>

      {blocked === null ? (
        <button
          type="button"
          onClick={() => onMarch(tile)}
          className="self-start bg-vermilion px-6 py-2.5 font-display text-base font-bold text-paper"
        >
          {t("tile.march")}
        </button>
      ) : (
        <p className="text-sm text-ink-soft">
          {tile.owned
            ? t("tile.owned")
            : blocked === "not-enough-grain"
              ? t("tile.blocked.notEnoughGrain")
              : blocked === "in-battle"
                ? t("tile.blocked.inBattle")
                : blocked === "marching"
                  ? t("tile.blocked.marching")
                  : t("tile.blocked.notAdjacent")}
        </p>
      )}
    </>
  );
}

function TileButton({
  tile,
  marchable,
  selected,
  targeted,
  onRoute,
  onSelect,
}: {
  tile: Tile;
  marchable: boolean;
  selected: boolean;
  /** 軍隊正在往這裡去（還沒到）。 */
  targeted: boolean;
  /** 隊伍已經走過這一格。 */
  onRoute: boolean;
  onSelect: (tile: Tile) => void;
}) {
  const owned = tile.owned;

  return (
    <button
      type="button"
      onClick={() => onSelect(tile)}
      aria-pressed={selected}
      aria-label={`${terrainName(tile.terrain)} ${t("tile.level", { level: tile.level })}${
        owned ? ` ${t("tile.owned")}` : ""
      }${targeted ? ` ${t("march.heading")}` : ""}`}
      data-tile={tile.id}
      style={{ color: owned ? undefined : `var(--terrain-${tile.terrain})` }}
      className={`relative flex aspect-square flex-col items-center justify-center gap-0.5 border transition-colors ${
        owned
          ? "border-vermilion bg-vermilion text-paper"
          : marchable
            ? "border-rule-strong bg-paper hover:bg-paper-raised"
            : "border-rule bg-paper-sunk opacity-45"
      } ${onRoute ? "route opacity-100" : ""} ${
        targeted ? "animate-target border-bronze bg-paper opacity-100" : ""
      } ${selected ? "outline outline-2 outline-offset-2 outline-vermilion" : ""}`}
    >
      <span className={`font-display text-xl font-bold leading-none ${owned ? "animate-banner" : ""}`}>
        {terrainMark(tile.terrain)}
      </span>
      {tile.level > 0 && (
        <span className="font-mono text-[9px] leading-none tabular-nums opacity-70">
          {t("tile.level", { level: tile.level })}
        </span>
      )}

    </button>
  );
}

/* ---------------------------------- 戰鬥 ---------------------------------- */

function ForceBar({
  label,
  value,
  max,
  tone,
  align,
}: {
  label: string;
  value: number;
  max: number;
  tone: "vermilion" | "azure";
  align: "left" | "right";
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const color = tone === "vermilion" ? "var(--vermilion)" : "var(--azure)";

  return (
    <div className={`flex flex-1 flex-col gap-1 ${align === "right" ? "items-end" : "items-start"}`}>
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-[11px] uppercase tracking-[0.15em] text-ink-soft">{label}</span>
        <span className="font-display text-xl font-bold tabular-nums" style={{ color }}>
          {value}
        </span>
      </div>
      <div className="h-1.5 w-full bg-paper-sunk">
        <div
          className={`h-full transition-[width] duration-300 ${align === "right" ? "ml-auto" : ""}`}
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
    </div>
  );
}

function BattlePanel({
  battle,
  tile,
  question,
  onAnswer,
  onRetreat,
}: {
  battle: NonNullable<GameState["battle"]>;
  tile: Tile | null;
  question: Question;
  onAnswer: (choiceIndex: number | null) => void;
  onRetreat: () => void;
}) {
  const maxHp = defenderHpFor(battle.tileLevel);
  const lastRound = battle.log[battle.log.length - 1] ?? null;

  return (
    <section className="flex flex-col gap-6">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink-soft">
          {t("battle.heading", { round: battle.round + 1, total: battle.rounds })}
        </p>
        <p className="font-mono text-[11px] tracking-[0.15em] text-ink-soft">
          {battle.streak > 0 ? t("battle.streak", { streak: battle.streak }) : t("battle.noStreak")}
        </p>
      </div>

      {/* 兩軍對峙。左邊我方，右邊守軍，中間是上一擊。 */}
      <div className="flex items-end gap-4 border-y-2 border-rule-strong py-4">
        <ForceBar label={t("battle.troops")} value={battle.troops} max={START_TROOPS} tone="vermilion" align="left" />

        <div className="flex min-w-20 flex-col items-center pb-1">
          {lastRound !== null && (
            <span
              key={lastRound.round}
              className="animate-strike font-display text-3xl font-bold tabular-nums text-vermilion"
            >
              {lastRound.damage}
            </span>
          )}
          {lastRound !== null && (
            <span className="font-mono text-[10px] tracking-[0.1em] text-ink-soft">
              {lastRound.choiceIndex === null
                ? t("battle.round.skipped")
                : lastRound.correct
                  ? t("battle.round.crit", { multiplier: lastRound.multiplier })
                  : t("battle.round.normal")}
            </span>
          )}
        </div>

        <ForceBar
          label={tile === null ? t("battle.defender") : terrainName(tile.terrain)}
          value={battle.defenderHp}
          max={maxHp}
          tone="azure"
          align="right"
        />
      </div>

      {/* 情報，不是考題。同一個機制換一個框架就不再是考卷。 */}
      <div className="flex flex-col gap-4 border border-rule bg-paper-raised p-5">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-vermilion">
          {t("battle.intel")}
        </p>
        <p className="font-display text-4xl font-bold tracking-tight sm:text-5xl">{question.prompt}</p>

        <div className="grid gap-2 sm:grid-cols-2">
          {question.choices.map((choice, index) => (
            <button
              key={choice}
              type="button"
              onClick={() => onAnswer(index)}
              className="border border-rule bg-paper px-4 py-3 text-left text-base transition-colors hover:border-vermilion hover:text-vermilion"
            >
              {choice}
            </button>
          ))}
        </div>

        {/*
          因果寫在選之前，不是寫在戰報裡。#7 的可玩定義要玩家「說得出答題跟打贏的關係」，
          而沒看過說明的人只會看眼前這一步。
        */}
        <dl className="flex flex-col gap-1 font-mono text-xs tabular-nums sm:flex-row sm:gap-6">
          <div className="text-vermilion">
            {t("battle.preview.correct", {
              multiplier: previewMultiplier(battle),
              damage: previewDamage(battle, true),
            })}
          </div>
          <div className="text-ink-soft">
            {t("battle.preview.miss", { damage: previewDamage(battle, false) })}
          </div>
        </dl>
      </div>

      <div className="flex flex-wrap gap-4 text-sm">
        <button type="button" onClick={() => onAnswer(null)} className="border border-rule px-4 py-2 text-ink-soft">
          {t("battle.skip")}
        </button>
        <button type="button" onClick={onRetreat} className="px-2 py-2 text-ink-soft opacity-70">
          {t("battle.retreat")}
        </button>
      </div>
    </section>
  );
}

/** 誠實地說為什麼輸，而不是讓玩家自己猜。 */
function lossMessage(reason: LossReason | null): string {
  switch (reason) {
    case "hopeless":
      return t("battle.loss.hopeless");
    case "out-of-rounds":
      return t("battle.loss.outOfRounds");
    case "out-of-troops":
      return t("battle.loss.outOfTroops");
    default:
      return t("battle.loss.retreated");
  }
}

function BattleReport({
  battle,
  tile,
  onDismiss,
}: {
  battle: NonNullable<GameState["battle"]>;
  tile: Tile | null;
  onDismiss: () => void;
}) {
  const won = battle.outcome === "won";
  const rounds = useMemo(() => battle.log, [battle.log]);

  return (
    <section className="flex flex-col gap-5">
      <div className={`flex flex-col gap-1 border-l-4 pl-4 ${won ? "border-vermilion" : "border-azure"}`}>
        <h2 className={`font-display text-3xl font-bold ${won ? "text-vermilion" : "text-azure"}`}>
          {won ? t("battle.result.won") : t("battle.result.lost")}
        </h2>
        {tile !== null && (
          <p className="font-mono text-xs tracking-[0.15em] text-ink-soft">
            {t("battle.result.place", { terrain: terrainName(tile.terrain), level: battle.tileLevel })}
          </p>
        )}
      </div>

      <p className="text-sm">
        {t("battle.result.summary", { correct: battle.correctCount, maxStreak: battle.maxStreak })}
      </p>
      {!won && <p className="max-w-prose text-sm text-ink-soft">{lossMessage(battle.lossReason)}</p>}

      <div className="flex flex-col gap-2 border border-rule bg-paper-raised p-4">
        <h3 className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink-soft">
          {t("battle.log.heading")}
        </h3>
        <ol className="flex flex-col gap-1 font-mono text-sm tabular-nums">
          {rounds.map((entry) => (
            <li key={entry.round} className="flex items-baseline gap-3">
              <span className="w-20 text-ink-soft">{t("battle.log.round", { round: entry.round + 1 })}</span>
              <span className={entry.correct ? "text-vermilion" : "text-ink-soft"}>
                {entry.choiceIndex === null
                  ? t("battle.round.skipped")
                  : entry.correct
                    ? t("battle.round.crit", { multiplier: entry.multiplier })
                    : t("battle.round.normal")}
              </span>
              <span className="ml-auto font-bold">{entry.damage}</span>
            </li>
          ))}
        </ol>
      </div>

      <button
        type="button"
        onClick={onDismiss}
        className="self-start bg-vermilion px-6 py-2.5 font-display text-base font-bold text-paper"
      >
        {t("battle.dismiss")}
      </button>
    </section>
  );
}
