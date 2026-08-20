"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { storedRecords, track } from "@/analytics";
import {
  EMPTY_REVIEW_BOOK,
  exampleFor,
  recordAttempt,
  resolveMode,
  vocabProvider,
  type Question,
  type ReviewBook,
  type VocabExample,
} from "@/content";
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
  armyAtCapital,
  distanceFromCity,
  marchBlockedReason,
  marchDurationMs,
  marchHasArrived,
  marchProgress,
  maxLevelOf,
  msPerGrain,
  orderMarch,
  orderReturn,
  previewDamage,
  previewMultiplier,
  ownedCount,
  recallMarch,
  remainingMs,
  resumeGame,
  retreat,
  returnDurationMs,
  stepsBetween,
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
import { LOCAL_PLAYER_ID, gameRepository, reviewRepository } from "@/persistence";

import { ArmyMarker, MarchColumn, useTileCenters } from "./march-column";
import { canSpeak, speak } from "./speech";

/** 回來時桌上多出來的東西。零的話不打擾玩家。 */
interface Welcome {
  readonly awayMs: number;
  readonly grain: number;
}

/**
 * 剛答完的那一題。
 *
 * 局面已經往前走了（answerRound 回傳的是下一回合），這份資料是為了把畫面
 * 停在上一題——玩家要看的是「我剛剛那題對不對、那個字怎麼用」，
 * 而不是立刻被推到下一題。
 */
interface Reveal {
  readonly question: Question;
  readonly correct: boolean;
  readonly skipped: boolean;
  readonly damage: number;
  readonly multiplier: number;
  readonly example: VocabExample | null;
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

  /**
   * 複習簿。跟局面分開存——重開一局會丟掉領地與糧草，
   * 但不該丟掉「哪些字你背過」。
   *
   * 用 ref 而不是 state：它每一題都會變，但沒有任何畫面直接顯示它，
   * 進 state 只會讓整棵樹白重繪一次。
   */
  const review = useRef<ReviewBook>(EMPTY_REVIEW_BOOK);

  /** 讀檔之後才開始自動存檔。不然掛載那一瞬間的空局面會蓋掉真正的存檔。 */
  const [loaded, setLoaded] = useState(false);
  /** 這次回來補到多少離線產出。零或還沒讀檔時不顯示。 */
  const [welcomeBack, setWelcomeBack] = useState<Welcome | null>(null);
  /** 剛答完的那一題。不是 null 就把畫面停在它上面。 */
  const [reveal, setReveal] = useState<Reveal | null>(null);

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

    // 複習簿讀不到不該擋住遊戲開場，所以不跟局面的讀檔綁在一起等。
    void reviewRepository()
      .load(LOCAL_PLAYER_ID)
      .then((book) => {
        if (!cancelled) {
          review.current = book;
        }
      });

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
        durationMs: marchDurationMs(
          stepsBetween(game.tiles.find((each) => each.id === game.armyAt) ?? tile, tile),
          game.buildings.relay.level,
        ),
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

  const goHome = useCallback(() => {
    setGame(orderReturn(game, Date.now()));
  }, [game]);

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
   *
   * 抵達就直接開打（lionw 指定）。原本停在「等你接敵」多一個按鈕，
   * 但那個按鈕沒有選擇可言——走到了就是要打，多一下點擊只是延遲。
   */
  const engage = useCallback(() => {
    const march = game.march;
    if (march === null || march.heading !== "out") {
      return;
    }
    const tile = game.tiles.find((each) => each.id === march.tileId);
    if (tile === undefined) {
      return;
    }
    const at = Date.now();

    // 帶著複習簿去抽題：到期該複習的字會排到前面（見 content/select.ts）。
    const drawn = vocabProvider.getQuestions({
      count: roundsFor(tile.level),
      level: vocabLevelForTile(tile.level),
      seed: battleSeed(game, tile.id),
      review: { book: review.current, now: at },
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
    track({
      type: "question_shown",
      battleId: next.battle!.battleId,
      round: 0,
      questionId: drawn[0].id,
      mode: drawn[0].mode,
    });

    shownAt.current = at;
    setQuestions(drawn);
    setGame(next);
  }, [game]);

  // engage 每次 render 都是新的（它讀 game），但排程只該跟著抵達時間跑一次。
  const latestEngage = useRef(engage);
  useEffect(() => {
    latestEngage.current = engage;
  });

  /**
   * 走到了就開打。
   *
   * 用一個算準抵達時刻的計時器，而不是每次 render 去問「到了沒」。
   * 抵達是一件排定好的外部事件，effect 對它訂閱一次就夠——盯著自己的
   * state 反覆檢查會變成連鎖 render，那也正是 react-hooks 在擋的東西。
   *
   * 離線回來、行軍早就抵達的情況走同一條路：剩餘時間是負的，夾成 0，
   * 計時器立刻就燒。那正是「回來時有東西在等你」。
   */
  const engageAt = game.march?.heading === "out" ? game.march.arrivesAt : null;
  const inBattle = battle !== null;
  useEffect(() => {
    if (!loaded || inBattle || engageAt === null) {
      return;
    }
    const timer = setTimeout(() => latestEngage.current(), Math.max(0, engageAt - Date.now()));
    return () => clearTimeout(timer);
  }, [loaded, inBattle, engageAt]);

  const submit = useCallback(
    (choiceIndex: number | null) => {
      if (battle === null || battle.outcome !== "ongoing") {
        return;
      }
      const question = questions[battle.round];
      const at = Date.now();
      const elapsedMs = at - shownAt.current;
      const next = answerRound(game, choiceIndex);
      const resolved = next.battle!.log[next.battle!.log.length - 1];

      /*
        記進複習簿。跳過算答錯——玩家沒判讀出來，跟判讀錯了對學習來說
        是同一件事，而「跳過不留紀錄」會讓不會的字永遠不進複習池。
      */
      review.current = recordAttempt(review.current, {
        itemId: question.id,
        correct: resolved.correct,
        elapsedMs,
        at,
        context: battle.battleId,
      });
      void reviewRepository().save(LOCAL_PLAYER_ID, review.current);

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
          mode: question.mode,
        });
      }

      /*
        答完先停一拍，把正確答案跟例句攤開來看。

        下一題的 question_shown 與 shownAt 不在這裡發——那會把「讀例句的時間」
        算進下一題的作答時間裡，而作答時間是判定亂猜的依據（#7）。
        等玩家按下繼續才算下一題開始。
      */
      const finished = next.battle!;
      setReveal({
        question,
        correct: resolved.correct,
        skipped: choiceIndex === null,
        damage: resolved.damage,
        multiplier: resolved.multiplier,
        example: exampleFor(question.id) ?? null,
      });

      if (finished.outcome !== "ongoing") {
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

  /** 看完例句，繼續。下一題從這一刻才開始計時。 */
  const continueFromReveal = useCallback(() => {
    setReveal(null);
    const current = game.battle;
    if (current === null || current.outcome !== "ongoing") {
      return;
    }
    const upcoming = questions[current.round];
    if (upcoming === undefined) {
      return;
    }
    track({
      type: "question_shown",
      battleId: current.battleId,
      round: current.round,
      questionId: upcoming.id,
      mode: upcoming.mode,
    });
    shownAt.current = Date.now();
  }, [game, questions]);

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
    //
    // 複習簿刻意不清。重開一局丟掉的是領地與糧草，不是「哪些字你背過」——
    // 那是玩家真正累積下來的東西，也是這個遊戲存在的理由。
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

      {reveal !== null ? (
        <RoundReveal
          reveal={reveal}
          hasNextRound={battle !== null && battle.outcome === "ongoing"}
          onContinue={continueFromReveal}
        />
      ) : battle !== null && battle.outcome === "ongoing" ? (
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
          onRecall={recall}
          onReturn={goHome}
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
  onRecall,
  onReturn,
}: {
  game: GameState;
  selected: Tile | null;
  now: number;
  onSelect: (tile: Tile) => void;
  onMarch: (tile: Tile) => void;
  onRecall: () => void;
  onReturn: () => void;
}) {
  const march = game.march;
  const marchTile = march === null ? null : (game.tiles.find((tile) => tile.id === march.tileId) ?? null);

  /** 行軍路線：起點 → 終點。方向不影響這兩個欄位的意義。 */
  const path = march === null ? [] : [march.fromTileId, march.tileId];
  const grid = useRef<HTMLDivElement>(null);
  const centers = useTileCenters(grid);
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
          {game.tiles.map((tile) => (
            <TileButton
              key={tile.id}
              tile={tile}
              marchable={marchBlockedReason(game, tile.id) === null}
              selected={selected?.id === tile.id}
              targeted={march?.heading === "out" && march.tileId === tile.id && !arrived}
              onSelect={onSelect}
            />
          ))}

          {march !== null ? (
            <MarchColumn march={march} path={path} centers={centers} arrived={arrived} now={now} />
          ) : (
            /* 沒在路上的時候隊伍也要看得見，否則玩家不知道自己下一趟從哪出發。 */
            <ArmyMarker at={game.armyAt} centers={centers} />
          )}
        </div>
      </div>

      <aside className="flex flex-1 flex-col gap-4 border border-rule bg-paper-raised p-5">
        {march !== null ? (
          <MarchPanel march={march} tile={marchTile} now={now} onRecall={onRecall} />
        ) : (
          <TileDetail game={game} tile={selected} onMarch={onMarch} onReturn={onReturn} />
        )}
      </aside>
    </div>
  );
}

/**
 * 軍隊在路上。
 *
 * 去程走到就直接開打，所以「已抵達」這個狀態在畫面上幾乎看不到——
 * 它只在最後那一格與戰鬥開場之間存在一瞬間。
 *
 * 回程沒有任何按鈕：班師途中玩家什麼都不用決定，給他一個能按的東西
 * 只會讓他以為漏了什麼。
 */
function MarchPanel({
  march,
  tile,
  now,
  onRecall,
}: {
  march: March;
  tile: Tile | null;
  now: number;
  onRecall: () => void;
}) {
  const home = march.heading === "home";
  const arrived = now >= march.arrivesAt;
  const progress = marchProgress(march, now);

  return (
    <>
      <div className="flex flex-col gap-0.5">
        <h2 className="font-display text-2xl font-bold whitespace-nowrap">
          {home ? t("march.homeHeading") : arrived ? t("march.arrivedHeading") : t("march.heading")}
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
            ? t(home ? "march.home" : "march.arrived")
            : t(home ? "march.homeRemaining" : "march.remaining", {
                seconds: seconds(remainingMs(march, now)),
              })}
        </p>
      </div>

      {!home && (
        <button type="button" onClick={onRecall} className="self-start text-sm text-ink-soft underline underline-offset-4">
          {t("march.recall")}
        </button>
      )}
    </>
  );
}

/**
 * 選了一塊地之後的面板，外加「回城」。
 *
 * 回城放在這裡而不是另開一塊：隊伍閒著的時候玩家只有兩種選擇（往哪打、
 * 要不要回去），擺在同一個地方才看得出那是同一個決定的兩面。
 */
function TileDetail({
  game,
  tile,
  onMarch,
  onReturn,
}: {
  game: GameState;
  tile: Tile | null;
  onMarch: (tile: Tile) => void;
  onReturn: () => void;
}) {
  const army = game.tiles.find((each) => each.id === game.armyAt);
  const home = armyAtCapital(game);
  const homeSteps = army === undefined ? 0 : distanceFromCity(army.x, army.y);

  /** 隊伍在外面時，不管選了哪一塊地都給得了回城。 */
  const returnHome = home ? null : (
    <div className="flex flex-col gap-2 border-t border-rule pt-3">
      <p className="font-mono text-[11px] text-ink-soft">
        {t("army.inField", { terrain: army === undefined ? "" : terrainName(army.terrain) })}
      </p>
      <button
        type="button"
        onClick={onReturn}
        className="self-start border border-rule px-4 py-2 text-sm text-ink-soft"
      >
        {t("army.returnHome", {
          seconds: seconds(returnDurationMs(homeSteps, game.buildings.relay.level)),
        })}
      </button>
    </div>
  );

  if (tile === null || tile.level === 0) {
    return (
      <>
        <p className="text-sm text-ink-soft">{t("tile.select")}</p>
        {returnHome}
      </>
    );
  }
  const blocked = marchBlockedReason(game, tile.id);
  const steps = army === undefined ? 1 : stepsBetween(army, tile);

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
              seconds: seconds(marchDurationMs(steps, game.buildings.relay.level)),
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

      {returnHome}
    </>
  );
}

function TileButton({
  tile,
  marchable,
  selected,
  targeted,
  onSelect,
}: {
  tile: Tile;
  marchable: boolean;
  selected: boolean;
  /** 軍隊正在往這裡去（還沒到）。 */
  targeted: boolean;
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
      } ${targeted ? "animate-target border-bronze bg-paper opacity-100" : ""} ${
        selected ? "outline outline-2 outline-offset-2 outline-vermilion" : ""
      }`}
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

/**
 * 答完一題之後停的那一拍。
 *
 * ## 為什麼要停
 *
 * 玩家剛做完判斷，注意力正在那個字上——那是例句唯一會被讀進去的時刻。
 * 直接推到下一題的話，答錯的人永遠不知道正解是什麼，答對的人也沒看過
 * 那個字怎麼用。
 *
 * ## 代價
 *
 * 每一題多一次點擊。三回合的仗就是多三下。如果實際玩起來覺得拖，
 * 這裡改成幾秒後自動繼續就好——但預設給玩家自己決定看多久，
 * 因為讀例句的速度差很多。
 */
function RoundReveal({
  reveal,
  hasNextRound,
  onContinue,
}: {
  reveal: Reveal;
  /** 這場仗還沒打完，按下去是下一題而不是戰報。 */
  hasNextRound: boolean;
  onContinue: () => void;
}) {
  const answer = reveal.question.choices[reveal.question.answerIndex];

  return (
    <section className="flex flex-col gap-5">
      <div
        className={`flex flex-col gap-1 border-l-4 pl-4 ${
          reveal.correct ? "border-vermilion" : "border-azure"
        }`}
      >
        <p
          className={`font-display text-2xl font-bold ${
            reveal.correct ? "text-vermilion" : "text-azure"
          }`}
        >
          {reveal.skipped
            ? t("reveal.skipped")
            : reveal.correct
              ? t("reveal.correct")
              : t("reveal.wrong")}
        </p>
        <p className="font-mono text-xs tabular-nums text-ink-soft">
          {reveal.correct
            ? t("reveal.damageCrit", { multiplier: reveal.multiplier, damage: reveal.damage })
            : t("reveal.damage", { damage: reveal.damage })}
        </p>
      </div>

      {/* 答錯的人在這裡才第一次看到正解，所以字要大。 */}
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-y border-rule py-4">
        <span className="font-display text-4xl font-bold tracking-tight">
          {reveal.question.prompt}
        </span>
        <span className="font-display text-2xl font-bold text-bronze">{answer}</span>
      </div>

      {reveal.example !== null && (
        <div className="flex flex-col gap-2 border border-rule bg-paper-raised p-5">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink-soft">
            {t("reveal.example")}
          </p>
          <p className="text-xl leading-relaxed">{reveal.example.en}</p>
          <p className="text-sm text-ink-soft">{reveal.example.zh}</p>
        </div>
      )}

      <button
        type="button"
        onClick={onContinue}
        autoFocus
        className="self-start bg-vermilion px-6 py-2.5 font-display text-base font-bold text-paper"
      >
        {hasNextRound ? t("reveal.continue") : t("reveal.report")}
      </button>
    </section>
  );
}

/**
 * 題目本體：看字，還是聽音。
 *
 * ## 為什麼一定要有「看拼字」
 *
 * 三個理由，任何一個都足夠：
 *  - 自動播放在部分瀏覽器需要先有互動，第一次可能沒聲音
 *  - 聽不見的玩家在純語音題面前只能亂猜
 *  - 玩家聽了三次還是抓不到，硬卡著只會讓他關掉分頁
 *
 * 按了不扣分也不記錄——它是自己選的難度，不是遊戲的懲罰。
 */
function Prompt({ question }: { question: Question }) {
  const speech = canSpeak();
  const mode = resolveMode(question.mode, speech);
  const [revealed, setRevealed] = useState(false);

  /*
    題目出現就唸一次。呼叫端給了 key={question.id}，換題等於整個重新掛載，
    所以「把拼字收回去」不用在這裡重設 state——那會變成 effect 裡呼叫
    setState 的連鎖 render，用 key 重置是 React 給的正解。
  */
  useEffect(() => {
    if (mode === "listen") {
      speak(question.prompt);
    }
  }, [question.prompt, mode]);

  if (mode === "read") {
    return (
      <p className="font-display text-4xl font-bold tracking-tight sm:text-5xl">{question.prompt}</p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={() => speak(question.prompt)}
          className="flex items-center gap-3 border-2 border-vermilion bg-paper px-5 py-3 font-display text-xl font-bold text-vermilion transition-colors hover:bg-vermilion hover:text-paper"
        >
          <span aria-hidden className="text-2xl leading-none">
            {t("battle.listen.mark")}
          </span>
          {t("battle.listen.replay")}
        </button>

        {revealed ? (
          <span className="font-display text-3xl font-bold tracking-tight">{question.prompt}</span>
        ) : (
          <button
            type="button"
            onClick={() => setRevealed(true)}
            className="text-sm text-ink-soft underline underline-offset-4"
          >
            {t("battle.listen.reveal")}
          </button>
        )}
      </div>
      <p className="font-mono text-[11px] tracking-[0.1em] text-ink-soft">{t("battle.listen.hint")}</p>
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
        <Prompt key={question.id} question={question} />

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
