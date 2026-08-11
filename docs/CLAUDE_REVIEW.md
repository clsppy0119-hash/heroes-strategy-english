# Claude Review Standard

每個可發布 milestone 使用 feature branch 與 PR；CI 通過後等待 Claude review，P0/P1 或 blocking 意見清零才可合併。Claude 是第二意見，不是另一個進度來源，所有結論必須留在 GitHub。

提供 PR 目標、驗收條件、diff、相關規格、測試與已知取捨；不得提供 `.env`、金鑰、真實玩家資料或未去識別學習紀錄。

優先檢查正確性／可重現性、交易與重試、安全／RLS／AI context、英文是否變成強制門票、領域邏輯耦合、migration 回滾、手機 UX 與測試缺口。每項標示 P0–P3、行號、情境、影響與最小修正；Codex 回覆 fixed / accepted risk / not applicable。

