# Architecture

## 邊界

- `src/app`: Next.js routes 與 server endpoints。
- `src/components`: UI；不直接呼叫資料庫或 OpenAI。
- `src/lib/game`: 純函式戰鬥、地圖、經濟與掉落。
- `src/lib/learning`: 題目評分、SRS 排程、能力聚合與可移植契約。
- `src/lib/server`: Supabase repositories、授權、OpenAI gateway。

目前切片為單頁記憶體狀態。接後端時 UI 僅透過 application services；Browser → Next.js/Vercel → Supabase，AI 請求只從 Next.js server → OpenAI API。

## 關鍵規則

- 伺服器是資源、抽卡與戰鬥結果的權威來源；戰鬥保存規則版本與 seed。
- RLS 預設拒絕；內容資料和玩家狀態分表、版本化。
- AI 不決定經濟或勝負；逾時改用固定內容，遊戲結算不依賴 AI。
- AI context 最小化；記錄 request id、延遲、token、prompt/schema 版本，不記錄不必要原文。
- UI 使用深墨黑、鐵灰、骨白、軍令紅與黯金；不複製既有商業遊戲名稱、美術、地圖或介面。

