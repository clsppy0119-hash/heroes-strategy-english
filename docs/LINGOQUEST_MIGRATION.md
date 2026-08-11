# LingoQuest 單向遷移評估

此 repo 是目標系統；不直接修改或依賴 LingoQuest repo。實際遷移前需盤點來源授權、資料格式與測試。

## 可相容、應保留的領域概念

- 能力定位：以 `PlacementAssessment` 輸入、`AbilityProfile` 輸出，保留 CEFR／技能向量的語意。
- 題庫：轉為版本化 `LearningItem`，題型、提示、答案、解釋與難度不綁 UI。
- 錯題／複習：以 `Attempt`、`ReviewState`、`Exposure` 匯入；排程演算法可替換。
- 中文 UI 原則：繁中為主要介面語言，英文內容附適量中文鷹架；屬產品規則而非 React Native component。
- 領地巡邏：只移植「學習事件進入遊戲世界」的 use case，不複製版面或資產。

## 不可直接合併

- React Native／Expo 畫面、navigation、hooks、樣式與平台元件不能直接放入 Next.js DOM。
- AsyncStorage／SecureStore、裝置通知、Expo runtime 與原生音訊需由 Web adapter 重做。
- 來源 repo 的帳號 ID、資料庫 schema、狀態管理與 API client 不視為相容契約。
- 任何第三方或商業遊戲圖像、音訊、文案、角色、商標與未明確授權 API 一律不遷移。
- 真實使用者紀錄不直接複製；需同意、去識別、欄位映射、保留政策與可回滾批次。

## Adapter 契約

來源先匯出中立、版本化 JSON：`ability_profiles`、`learning_items`、`attempts`、`review_states`。匯入器只接受通過 schema、provenance、license 與 content version 驗證的資料；使用 dry-run 產出 rejected rows 與原因。單向流程為 LingoQuest export → validation/staging → Heroes Strategy import，禁止雙寫。

## 遷移驗收

抽樣比對能力級別、題目答案與 due date；用合成帳號驗證，不使用真實資料。遷移前後以固定案例測試評分和複習排序；Web UI 另做手機／桌面驗收。
