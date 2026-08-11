# 群英戰略版（Heroes Strategy English）

一款以嚴肅戰爭 SLG 為核心、讓英文學習成為養成與資源效率加速器的自有品牌 Web 遊戲。

## 產品原則

- 遊戲在不答英文題時仍然成立並且好玩。
- 英文提供情報、效率、額外收益與養成加速，不是行動門票。
- 學過的內容會以戰報、情報、事件與任務再次出現，形成記憶循環。
- AI 老師只透過受控服務讀取必要的學習摘要與遊戲狀態；金鑰不進瀏覽器。

## 目前進度

v0.1 Milestone 1 是本機可執行的前端垂直切片：7×8 戰略地圖、三人隊伍、資源與軍令、佔地戰鬥、英文情報加速，以及自動戰報。資料暫存於前端，下一階段再接 Supabase。

## 本機啟動

需要 Node.js 20+ 與 pnpm。

```bash
pnpm install
pnpm dev
```

開啟 `http://localhost:3000`。品質檢查：`pnpm lint`、`pnpm typecheck`、`pnpm build`。

## 文件索引

- [Master Plan](docs/MASTER_PLAN.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Data Model](docs/DATA_MODEL.md)
- [AI Development](docs/AI_DEVELOPMENT.md)
- [Claude Review](docs/CLAUDE_REVIEW.md)
- [v0.1 Roadmap](docs/ROADMAP_V0.1.md)
- [LingoQuest Migration](docs/LINGOQUEST_MIGRATION.md)

GitHub 是唯一真實進度來源；產品決策必須落在 issue、PR 或本 repo 文件。
