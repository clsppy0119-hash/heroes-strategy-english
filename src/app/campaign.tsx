"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { storedRecords, track } from "@/analytics";
import { vocabProvider, type Question } from "@/content";
import {
  GRID_SIZE,
  MARCH_COST,
  MAX_ROUNDS,
  RULES_VERSION,
  answerRound,
  battleId as makeBattleId,
  battleSeed,
  beginMarch,
  capturedCount,
  createGame,
  defenderHpFor,
  dismissBattle,
  marchBlockedReason,
  retreat,
  vocabLevelForTile,
  type GameState,
  type LossReason,
  type Tile,
} from "@/core";
import { t } from "@/i18n";

const TOTAL_TILES = GRID_SIZE * GRID_SIZE - 1;

/** v0.1 沒有存檔，重開就是新的一局；種子固定讓測試場次可以互相比較。 */
const SEED_TEXT = "v0.1";

export function Campaign() {
  const [game, setGame] = useState<GameState>(() => createGame(SEED_TEXT));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<readonly Question[]>([]);

  // 作答時間要從「題目出現」算起，不是從 render 算起。
  const shownAt = useRef<number>(0);
  // render 期間不能取時間（不純），所以掛載後才記 session 起點。
  const sessionStart = useRef<number>(0);
  useEffect(() => {
    sessionStart.current = Date.now();
  }, []);

  const battle = game.battle;
  const selected = game.tiles.find((tile) => tile.id === selectedId) ?? null;

  const startMarch = useCallback(
    (tile: Tile) => {
      const drawn = vocabProvider.getQuestions({
        count: MAX_ROUNDS,
        level: vocabLevelForTile(tile.level),
        seed: battleSeed(game, tile.id),
      });

      const next = beginMarch(
        game,
        tile.id,
        drawn.map((question) => ({
          id: question.id,
          answerIndex: question.answerIndex,
          choiceCount: question.choices.length,
        })),
      );

      track({
        type: "battle_start",
        battleId: makeBattleId(game, tile.id),
        tileId: tile.id,
        seed: battleSeed(game, tile.id),
        rulesVersion: RULES_VERSION,
      });
      track({ type: "question_shown", battleId: next.battle!.battleId, round: 0, questionId: drawn[0].id });

      shownAt.current = Date.now();
      setQuestions(drawn);
      setGame(next);
    },
    [game],
  );

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
    sessionStart.current = Date.now();
    setGame(createGame(SEED_TEXT));
    setSelectedId(null);
    setQuestions([]);
  }, [game]);

  const captured = capturedCount(game);

  return (
    <div className="flex w-full flex-col gap-6">
      <Header grain={game.grain} captured={captured} onExport={exportRecords} />

      {battle !== null && battle.outcome === "ongoing" ? (
        <BattlePanel
          round={battle.round}
          troops={battle.troops}
          defenderHp={battle.defenderHp}
          streak={battle.streak}
          question={questions[battle.round]}
          lastRound={battle.log[battle.log.length - 1] ?? null}
          onAnswer={submit}
          onRetreat={giveUp}
        />
      ) : battle !== null ? (
        <BattleReport battle={battle} onDismiss={() => setGame(dismissBattle(game))} />
      ) : (
        <Board
          game={game}
          selected={selected}
          onSelect={(tile) => setSelectedId(tile.id)}
          onMarch={startMarch}
        />
      )}

      {game.status !== "playing" && (
        <div className="flex flex-col gap-3 rounded border border-black/15 p-4 dark:border-white/15">
          <p className="text-sm">
            {game.status === "cleared" ? t("campaign.status.cleared") : t("campaign.status.stuck")}
          </p>
          <button
            type="button"
            onClick={restart}
            className="self-start rounded bg-black px-3 py-1.5 text-sm text-white dark:bg-white dark:text-black"
          >
            {t("campaign.restart")}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * 測試場結束後把埋點交出來。
 *
 * v0.1 的資料只存在測試者的瀏覽器裡，所以要有一個把它拿出來的方法。
 * v0.2 事件直接進後端之後，這顆按鈕就可以拿掉。
 * 匯出的檔案餵給 `pnpm analyze` 會算出 #7 的五個數字。
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
  captured,
  onExport,
}: {
  grain: number;
  captured: number;
  onExport: () => void;
}) {
  return (
    <header className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">{t("campaign.heading")}</h1>
        <p className="text-sm text-black/60 dark:text-white/60">{t("campaign.subheading")}</p>
      </div>
      <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm tabular-nums">
        <Stat label={t("campaign.grain")} value={String(grain)} />
        <Stat
          label={t("campaign.captured")}
          value={t("campaign.capturedValue", { captured, total: TOTAL_TILES })}
        />
        <Stat label={t("campaign.rules", { version: RULES_VERSION })} value="" />
        <button
          type="button"
          onClick={onExport}
          className="text-black/40 underline underline-offset-4 dark:text-white/40"
        >
          {t("campaign.export")}
        </button>
      </dl>
    </header>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="text-black/50 dark:text-white/50">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

function Board({
  game,
  selected,
  onSelect,
  onMarch,
}: {
  game: GameState;
  selected: Tile | null;
  onSelect: (tile: Tile) => void;
  onMarch: (tile: Tile) => void;
}) {
  const blocked = selected === null ? "not-adjacent" : marchBlockedReason(game, selected.id);

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
      <div className="grid w-full max-w-xs grid-cols-3 gap-2">
        {game.tiles.map((tile) => (
          <TileButton
            key={tile.id}
            tile={tile}
            marchable={marchBlockedReason(game, tile.id) === null}
            selected={selected?.id === tile.id}
            onSelect={onSelect}
          />
        ))}
      </div>

      <aside className="flex flex-1 flex-col gap-3 rounded border border-black/15 p-4 dark:border-white/15">
        {selected === null || selected.level === 0 ? (
          <p className="text-sm text-black/60 dark:text-white/60">{t("tile.select")}</p>
        ) : (
          <>
            <h2 className="text-lg font-semibold">{t("tile.level", { level: selected.level })}</h2>
            <p className="text-sm tabular-nums">
              {selected.owned ? t("tile.owned") : t("tile.defender", { hp: defenderHpFor(selected.level) })}
            </p>
            <p className="text-sm text-black/60 dark:text-white/60">
              {t("campaign.marchCost", { cost: MARCH_COST })}
            </p>
            {blocked === null ? (
              <button
                type="button"
                onClick={() => onMarch(selected)}
                className="self-start rounded bg-black px-4 py-2 text-sm text-white dark:bg-white dark:text-black"
              >
                {t("tile.march")}
              </button>
            ) : (
              <p className="text-sm text-black/50 dark:text-white/50">
                {selected.owned
                  ? t("tile.owned")
                  : blocked === "not-enough-grain"
                    ? t("tile.blocked.notEnoughGrain")
                    : blocked === "in-battle"
                      ? t("tile.blocked.inBattle")
                      : t("tile.blocked.notAdjacent")}
              </p>
            )}
          </>
        )}
      </aside>
    </div>
  );
}

function TileButton({
  tile,
  marchable,
  selected,
  onSelect,
}: {
  tile: Tile;
  marchable: boolean;
  selected: boolean;
  onSelect: (tile: Tile) => void;
}) {
  const label = tile.level === 0 ? t("tile.home") : t("tile.level", { level: tile.level });
  const tone = tile.owned
    ? "bg-black text-white dark:bg-white dark:text-black"
    : marchable
      ? "border-black/40 dark:border-white/40"
      : "border-black/10 text-black/35 dark:border-white/10 dark:text-white/35";

  return (
    <button
      type="button"
      onClick={() => onSelect(tile)}
      aria-pressed={selected}
      className={`aspect-square rounded border-2 text-sm font-medium transition-colors ${tone} ${
        selected ? "ring-2 ring-black/50 dark:ring-white/50" : ""
      }`}
    >
      {label}
    </button>
  );
}

function BattlePanel({
  round,
  troops,
  defenderHp,
  streak,
  question,
  lastRound,
  onAnswer,
  onRetreat,
}: {
  round: number;
  troops: number;
  defenderHp: number;
  streak: number;
  question: Question;
  lastRound: { damage: number; correct: boolean; choiceIndex: number | null; multiplier: number } | null;
  onAnswer: (choiceIndex: number | null) => void;
  onRetreat: () => void;
}) {
  return (
    <section className="flex flex-col gap-4 rounded border border-black/15 p-4 dark:border-white/15">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">
          {t("battle.heading", { round: round + 1, total: MAX_ROUNDS })}
        </h2>
        <p className="text-sm tabular-nums text-black/60 dark:text-white/60">
          {t("battle.troops")} {troops} · {t("battle.defender")} {defenderHp} ·{" "}
          {streak > 0 ? t("battle.streak", { streak }) : t("battle.noStreak")}
        </p>
      </div>

      {lastRound !== null && (
        <p className="text-sm tabular-nums">
          {lastRound.choiceIndex === null
            ? t("battle.round.skipped", { damage: lastRound.damage })
            : lastRound.correct
              ? t("battle.round.crit", { multiplier: lastRound.multiplier, damage: lastRound.damage })
              : t("battle.round.normal", { damage: lastRound.damage })}
        </p>
      )}

      <div className="flex flex-col gap-2">
        <p className="text-sm text-black/60 dark:text-white/60">{t("battle.prompt")}</p>
        <p className="text-3xl font-bold tracking-tight">{question.prompt}</p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {question.choices.map((choice, index) => (
          <button
            key={choice}
            type="button"
            onClick={() => onAnswer(index)}
            className="rounded border border-black/20 px-3 py-2 text-left text-sm hover:border-black/50 dark:border-white/20 dark:hover:border-white/50"
          >
            {choice}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => onAnswer(null)}
          className="rounded border border-black/20 px-3 py-1.5 text-sm text-black/60 dark:border-white/20 dark:text-white/60"
        >
          {t("battle.skip")}
        </button>
        <button
          type="button"
          onClick={onRetreat}
          className="rounded px-3 py-1.5 text-sm text-black/40 dark:text-white/40"
        >
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
  onDismiss,
}: {
  battle: NonNullable<GameState["battle"]>;
  onDismiss: () => void;
}) {
  const won = battle.outcome === "won";
  const rounds = useMemo(() => battle.log, [battle.log]);

  return (
    <section className="flex flex-col gap-4 rounded border border-black/15 p-4 dark:border-white/15">
      <h2 className="text-xl font-bold">{won ? t("battle.result.won") : t("battle.result.lost")}</h2>
      <p className="text-sm">
        {t("battle.result.summary", { correct: battle.correctCount, maxStreak: battle.maxStreak })}
      </p>
      {!won && (
        <p className="text-sm text-black/60 dark:text-white/60">{lossMessage(battle.lossReason)}</p>
      )}

      <div className="flex flex-col gap-1">
        <h3 className="font-mono text-xs uppercase tracking-widest text-black/50 dark:text-white/50">
          {t("battle.log.heading")}
        </h3>
        <ol className="flex flex-col gap-1 text-sm tabular-nums">
          {rounds.map((entry) => (
            <li key={entry.round} className="flex gap-3">
              <span className="text-black/50 dark:text-white/50">
                {t("battle.log.round", { round: entry.round + 1 })}
              </span>
              <span>
                {entry.choiceIndex === null
                  ? t("battle.round.skipped", { damage: entry.damage })
                  : entry.correct
                    ? t("battle.round.crit", { multiplier: entry.multiplier, damage: entry.damage })
                    : t("battle.round.normal", { damage: entry.damage })}
              </span>
            </li>
          ))}
        </ol>
      </div>

      <button
        type="button"
        onClick={onDismiss}
        className="self-start rounded bg-black px-4 py-2 text-sm text-white dark:bg-white dark:text-black"
      >
        {t("battle.dismiss")}
      </button>
    </section>
  );
}
