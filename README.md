# 群英戰略版 / Heroes Strategy English

三國題材 SLG，英文學得越好，仗打得越漂亮。

答題不是通關門票，是戰鬥回合裡的下令：答對是暴擊，答錯是失誤。繞過答題等於放棄戰果，所以「亂猜跳過」這條最省力路徑不存在。

開發順序見 [#3 開發路線圖](https://github.com/clsppy0119-hash/heroes-strategy-english/issues/3)：五刀縱切，每一刀都從玩法穿到資料層，結束時都有人能玩、有數字可看、有事先寫好的喊停條件。

## 跑起來

需要 Node 24 與 pnpm。

```bash
pnpm install
pnpm dev
```

## 驗證

```bash
pnpm verify
```

等同 CI 跑的六關：

| 指令 | 擋什麼 |
| --- | --- |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm check:i18n` | 元件裡出現硬編中文 |
| `pnpm check:core` | `src/core` 碰到 UI、瀏覽器、時間或亂數 |
| `pnpm test` | Vitest |
| `pnpm build` | production build |

## 目錄結構

```
src/core/        遊戲規則。純函式，可整塊搬到伺服器
src/i18n/        文案。元件不得硬編字串
src/analytics/   埋點。呼叫端只認識 track()
src/content/     題目來源介面與預算熔斷器
scripts/         CI 用的兩支約束檢查
```

## 四項橫向約束

這四件事不屬於任何一個里程碑，但第一天就在，因為晚做等於全面返工。

**文案走 i18n key** — v0.1 只有繁中一種語系，這條規則現在沒有任何好處，它是為了之後。等到真要加第二種語言才回頭抽字串，等於全站掃一次。`pnpm check:i18n` 擋住新的硬編字串（註解與 locale 檔不算）。

**埋點跟著功能長** — `src/analytics/events.ts` 的 schema 是為了讓 [#7](https://github.com/clsppy0119-hash/heroes-strategy-english/issues/7) 算得出亂猜跳題率、作答時間分佈、連對長度分佈、單場放棄率、首次佔三塊地耗時這五個數字。前期沒埋的欄位事後補不回來。v0.1 寫進 localStorage，v0.2 換成後端時只動 sink，呼叫端不改。

**`src/core` 保持可搬** — 純函式、不碰 React、不碰瀏覽器、不自己取時間或亂數。時間與亂數一律由參數注入，否則同一場戰鬥在客戶端與伺服器會算出不同結果，v0.2 做伺服器權威時就得整段重寫。`pnpm check:core` 強制這件事。

**AI 成本熔斷的位置先留著** — v0.1 完全不用 AI，但 `withBudgetGuard` 已經在了。「AI 不進玩家的即時路徑」是架構決策不是後期優化參數，晚一步 AI 呼叫就會散落在各個元件裡。超出預算時靜靜降級到既有題庫：玩家不該因為我們預算用完就玩不下去，我們也不該因為玩家玩太多就破產。

## 決定性

戰鬥結果由 `(初始狀態, seed, RULES_VERSION, 作答序列)` 完全決定。任何會改變戰鬥結果的規則調整都必須遞增 `src/core/rules.ts` 的 `RULES_VERSION`——沒有版本號就無法判斷一場舊戰鬥為什麼重現不出來，是資料壞了還是規則改了。

相關：[#1 架構邊界與 LingoQuest 單向遷移](https://github.com/clsppy0119-hash/heroes-strategy-english/issues/1)

## 測試場與數據

v0.1 的驗收條件寫在 [#7](https://github.com/clsppy0119-hash/heroes-strategy-english/issues/7)，喊停條件是**亂猜跳題率超過三成就停下來重做設計，不要加內容**。

測試者玩完之後，按畫面上的「匯出測試資料」拿到一份 JSON，然後：

```bash
pnpm analyze playtest/*.json
```

會算出五個數字並對照喊停條件：亂猜跳題率、作答時間分佈、連對長度分佈、單場放棄率、首次佔下三塊地耗時。

「亂猜」的定義是**答錯且作答時間低於 800ms**——答對再快也不算，答錯但有花時間也不算，那是真的不會。800ms 這個門檻是拍腦袋定的，真人資料進來之後應該用作答時間分佈的左尾重新定。

分析用的是遊戲裡同一份 `analyze()`，所以測試場上看到的數字跟事後算出來的一致。

## 文件

| | |
| --- | --- |
| [docs/MASTER_PLAN.md](docs/MASTER_PLAN.md) | 願景、核心循環、英文在遊戲裡的位置 |
| [docs/ROADMAP.md](docs/ROADMAP.md) | 為什麼改成縱切，舊 M1–M6 對到哪 |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 模組邊界與關鍵規則 |
| [docs/DATA_MODEL.md](docs/DATA_MODEL.md) | 資料表與 RLS |
| [docs/AI_DEVELOPMENT.md](docs/AI_DEVELOPMENT.md) | AI 使用標準與護欄 |
| [docs/LINGOQUEST_MIGRATION.md](docs/LINGOQUEST_MIGRATION.md) | LingoQuest 單向遷移邊界 |
| [docs/REVIEW.md](docs/REVIEW.md) | PR 說明與 review 要求 |
