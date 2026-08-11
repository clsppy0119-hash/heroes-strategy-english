# AI Development Standard

- 使用 OpenAI Responses API 的服務端 gateway；API key 不進瀏覽器。
- 機器處理輸出使用嚴格 JSON schema，驗證失敗不得寫入玩家狀態。
- prompt、schema、安全規則與 model 設定版本化；重要行為使用 eval 與 pinned model version。
- AI 不決定抽卡、戰鬥、掉落、付費或資源扣除。
- AI 老師只取得當次必要的能力摘要、近期錯題與遊戲目標；預設 `store: false`，任何保留政策變更需另行審查。
- 每個 use case 定義輸入／輸出 schema、延遲與成本上限、fallback、重試與 observability。
- 測試集覆蓋程度適配、答案正確性、繁中解釋、拒絕代打、prompt injection、個資洩漏與 schema。

AI 不可用時，老師可稍後再試，閱讀使用已審固定內容；戰鬥與學習排程不受影響。

