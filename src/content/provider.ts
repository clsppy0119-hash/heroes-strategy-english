import type { RngState } from '@/core';

/**
 * 題目來源的介面。
 *
 * v0.1 只有一個實作：從固定題庫抽（#6 會把真的 CSV 接上來）。
 * 但介面與熔斷器現在就要在，因為「AI 不進玩家的即時路徑」是架構決策，
 * 不是之後可以調的參數——晚一步，AI 呼叫就會散落在各個元件裡。
 */

export interface Question {
  readonly id: string;
  /** 學習素材保持英文，中文只出現在 guide 與 tip。 */
  readonly prompt: string;
  readonly choices: readonly string[];
  readonly answerIndex: number;
  /** 追得回這題從哪來：手寫題庫的 row id，或之後 AI 產線的批次 id。 */
  readonly sourceId: string;
}

export interface QuestionRequest {
  readonly count: number;
  readonly level?: number;
  readonly excludeIds?: readonly string[];
  readonly seed: RngState;
}

export interface ContentProvider {
  readonly name: string;
  /** 同步簽名是刻意的：題目必須能在戰鬥回合裡立刻拿到，不能等網路。 */
  getQuestions(request: QuestionRequest): readonly Question[];
}

/** 預算追蹤。v0.1 沒有 AI，所以永遠花不掉，但位置先留著。 */
export interface BudgetTracker {
  readonly limit: number;
  readonly spent: number;
  canSpend(cost: number): boolean;
  record(cost: number): void;
}

export function createBudgetTracker(limit: number): BudgetTracker {
  let spent = 0;
  return {
    limit,
    get spent() {
      return spent;
    },
    canSpend(cost) {
      return spent + cost <= limit;
    },
    record(cost) {
      spent += cost;
    },
  };
}

export interface BudgetGuardOptions {
  readonly primary: ContentProvider;
  /** 超出預算、或 primary 失敗時用這個。必須是不花錢、不會失敗的來源。 */
  readonly fallback: ContentProvider;
  readonly budget: BudgetTracker;
  /** 每次向 primary 取一題的成本。 */
  readonly costPerQuestion: number;
  readonly onFallback?: (reason: 'budget' | 'error') => void;
}

/**
 * 熔斷器：超出預算就靜靜降級到既有題庫，而不是報錯或繼續燒錢。
 *
 * 玩家不該因為我們的預算用完就玩不下去，我們也不該因為玩家玩太多就破產。
 */
export function withBudgetGuard(options: BudgetGuardOptions): ContentProvider {
  const { primary, fallback, budget, costPerQuestion, onFallback } = options;
  return {
    name: `budget-guard(${primary.name} → ${fallback.name})`,
    getQuestions(request) {
      const cost = costPerQuestion * request.count;
      if (!budget.canSpend(cost)) {
        onFallback?.('budget');
        return fallback.getQuestions(request);
      }
      try {
        const questions = primary.getQuestions(request);
        budget.record(cost);
        return questions;
      } catch {
        onFallback?.('error');
        return fallback.getQuestions(request);
      }
    },
  };
}
