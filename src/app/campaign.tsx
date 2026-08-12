"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { storedRecords, track } from "@/analytics";
import { vocabProvider, type Question } from "@/content";
import {
  GRID_SIZE,
  MARCH_COST,
  MAX_ROUNDS,
  RULES_VERSION,
  START_TROOPS,
  answerRound,
  battleId as makeBattleId,
  battleSeed,
  beginMarch,
  capturedCount,
  createGame,
  defenderHpFor,
  dismissBattle,
  marchBlockedReason,
  previewDamage,
  previewMultiplier,
  retreat,
  vocabLevelForTile,
  type GameState,
  type LossReason,
  type Terrain,
  type Tile,
} from "@/core";
import { t, type MessageKey } from "@/i18n";

const TOTAL_TILES = GRID_SIZE * GRID_SIZE - 1;

/** v0.1 沒有存檔，重開就是新的一局；種子固定讓測試場次可以互相比較。 */
const SEED_TEXT = "v0.1";

/** 地形的顯示名稱走 i18n；core 裡只有識別碼。 */
function terrainName(terrain: Terrain): string {
  return t(`terrain.${terrain}` as MessageKey);
}

/** 沙盤上的地形標記＝地形名稱的第一個字。不另外寫死一份字。 */
function terrainMark(terrain: Terrain): string {
  return terrainName(terrain).slice(0, 1);
}

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

  const battleTile = battle === null ? null : (game.tiles.find((tile) => tile.id === battle.tileId) ?? null);

  return (
    <div className="flex w-full flex-col gap-8">
      <Header grain={game.grain} captured={capturedCount(game)} onExport={exportRecords} />

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
          onSelect={(tile) => setSelectedId(tile.id)}
          onMarch={startMarch}
        />
      )}

      {game.status !== "playing" && (
        <section className="flex flex-col gap-3 border-t-2 border-vermilion bg-paper-raised p-5">
          <p className="font-display text-lg">
            {game.status === "cleared" ? t("campaign.status.cleared") : t("campaign.status.stuck")}
          </p>
          <button type="button" onClick={restart} className="self-start bg-vermilion px-5 py-2 text-sm font-medium text-paper">
            {t("campaign.restart")}
          </button>
        </section>
      )}
    </div>
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
  captured,
  onExport,
}: {
  grain: number;
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
          <Stat label={t("campaign.grain")} value={String(grain)} tone="bronze" />
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

function Stat({ label, value, tone }: { label: string; value: string; tone: "bronze" | "vermilion" }) {
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
    </div>
  );
}

/* ---------------------------------- 沙盤 ---------------------------------- */

function Sandtable({
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
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-8">
      <div className="flex flex-col gap-2">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink-soft">
          {t("campaign.mapLabel")}
        </p>
        <div className="sandtable grid w-full max-w-sm grid-cols-3 gap-1.5 border-2 border-rule-strong bg-paper-sunk p-1.5 lg:w-80">
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
      </div>

      <aside className="flex flex-1 flex-col gap-4 border border-rule bg-paper-raised p-5">
        {selected === null || selected.level === 0 ? (
          <p className="text-sm text-ink-soft">{t("tile.select")}</p>
        ) : (
          <>
            <div className="flex items-baseline gap-3">
              <h2 className="font-display text-2xl font-bold">{terrainName(selected.terrain)}</h2>
              <span className="font-mono text-sm text-ink-soft">
                {t("tile.level", { level: selected.level })}
              </span>
            </div>

            <dl className="flex gap-8 border-y border-rule py-3 text-sm">
              <div className="flex flex-col gap-0.5">
                <dt className="font-mono text-[11px] uppercase tracking-[0.15em] text-ink-soft">
                  {t("battle.defender")}
                </dt>
                <dd className="font-mono text-lg tabular-nums text-azure">
                  {selected.owned ? "—" : defenderHpFor(selected.level)}
                </dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="font-mono text-[11px] uppercase tracking-[0.15em] text-ink-soft">
                  {t("campaign.grain")}
                </dt>
                <dd className="font-mono text-lg tabular-nums text-bronze">−{MARCH_COST}</dd>
              </div>
            </dl>

            {blocked === null ? (
              <button
                type="button"
                onClick={() => onMarch(selected)}
                className="self-start bg-vermilion px-6 py-2.5 font-display text-base font-bold text-paper"
              >
                {t("tile.march")}
              </button>
            ) : (
              <p className="text-sm text-ink-soft">
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
  const owned = tile.owned;

  return (
    <button
      type="button"
      onClick={() => onSelect(tile)}
      aria-pressed={selected}
      aria-label={`${terrainName(tile.terrain)} ${t("tile.level", { level: tile.level })}${
        owned ? ` ${t("tile.owned")}` : ""
      }`}
      style={{ color: owned ? undefined : `var(--terrain-${tile.terrain})` }}
      className={`relative flex aspect-square flex-col items-center justify-center gap-0.5 border transition-colors ${
        owned
          ? "border-vermilion bg-vermilion text-paper"
          : marchable
            ? "border-rule-strong bg-paper hover:bg-paper-raised"
            : "border-rule bg-paper-sunk opacity-45"
      } ${selected ? "outline outline-2 outline-offset-2 outline-vermilion" : ""}`}
    >
      <span className={`font-display text-2xl font-bold leading-none ${owned ? "animate-banner" : ""}`}>
        {terrainMark(tile.terrain)}
      </span>
      {tile.level > 0 && (
        <span className="font-mono text-[10px] tabular-nums opacity-70">
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
          {t("battle.heading", { round: battle.round + 1, total: MAX_ROUNDS })}
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
