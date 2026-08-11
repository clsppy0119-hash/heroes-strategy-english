"use client";

import { useState, useSyncExternalStore } from "react";

import { clearStoredRecords, storedRecordCount, subscribe, track } from "@/analytics";
import { createBudgetTracker } from "@/content/provider";
import { RULES_VERSION, nextInt, seedFrom, type RngState } from "@/core";
import { t } from "@/i18n";

/**
 * v0.1-1 的驗收畫面：四項橫向約束各展示一條，證明它們真的接起來了。
 * #5 的戰鬥核心進來之後整個檔案刪掉。
 */

const AI_BUDGET_LIMIT = 1000;

function rngSample(seed: string, count: number): number[] {
  let state: RngState = seedFrom(seed);
  const values: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const [value, next] = nextInt(state, 100);
    values.push(value);
    state = next;
  }
  return values;
}

export function SelfCheck() {
  const [seedText, setSeedText] = useState("battle-1");

  // 埋點記錄住在 React 之外（localStorage），所以用訂閱而不是 effect + setState。
  // 伺服器端沒有 localStorage，snapshot 給 null，掛載後才會換成真的筆數。
  const eventCount = useSyncExternalStore(subscribe, storedRecordCount, () => null);

  const budget = createBudgetTracker(AI_BUDGET_LIMIT);

  return (
    <>
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">{t("selfcheck.heading")}</h1>
        <p className="text-sm text-black/60 dark:text-white/60">{t("selfcheck.subheading")}</p>
      </header>

      <Row label={t("selfcheck.i18n.label")}>
        <p className="text-sm">{t("selfcheck.i18n.value")}</p>
      </Row>

      <Row label={t("selfcheck.rules.label")}>
        <code className="font-mono text-sm">{RULES_VERSION}</code>
      </Row>

      <Row label={t("selfcheck.rng.label")}>
        <p className="text-sm text-black/60 dark:text-white/60">{t("selfcheck.rng.hint")}</p>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-black/60 dark:text-white/60">{t("selfcheck.rng.seedLabel")}</span>
          <input
            value={seedText}
            onChange={(event) => setSeedText(event.target.value)}
            className="rounded border border-black/20 px-2 py-1 font-mono dark:border-white/20"
          />
        </label>
        <code className="font-mono text-sm tabular-nums">{rngSample(seedText, 8).join(" · ")}</code>
      </Row>

      <Row label={t("selfcheck.analytics.label")}>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => track({ type: "selfcheck_ping", note: seedText })}
            className="rounded bg-black px-3 py-1.5 text-sm text-white dark:bg-white dark:text-black"
          >
            {t("selfcheck.analytics.fire")}
          </button>
          <button
            type="button"
            onClick={() => clearStoredRecords()}
            className="rounded border border-black/20 px-3 py-1.5 text-sm dark:border-white/20"
          >
            {t("selfcheck.analytics.clear")}
          </button>
          <span className="text-sm tabular-nums">
            {eventCount === null
              ? t("selfcheck.analytics.empty")
              : t("selfcheck.analytics.count", { count: eventCount })}
          </span>
        </div>
      </Row>

      <Row label={t("selfcheck.content.label")}>
        <p className="text-sm tabular-nums">
          {t("selfcheck.content.budget", { remaining: budget.limit - budget.spent, limit: budget.limit })}
        </p>
        <p className="text-sm text-black/60 dark:text-white/60">{t("selfcheck.content.fallback")}</p>
      </Row>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2 border-t border-black/10 pt-4 dark:border-white/10">
      <h2 className="font-mono text-xs uppercase tracking-widest text-black/50 dark:text-white/50">{label}</h2>
      {children}
    </section>
  );
}
