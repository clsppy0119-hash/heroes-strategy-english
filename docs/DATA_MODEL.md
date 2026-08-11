# Data Model

## 遊戲

`profiles`、`player_states`、`heroes`、`player_heroes`、`skills`、`hero_skills`、`squads`、`squad_members`、`map_tiles`、`tile_ownership`、`battles`、`gacha_pulls`。戰鬥保存 `rules_version`、`seed`、輸入與結果；資源扣除、結算與佔領在單一交易中完成。

## 學習

`learning_profiles(user_id, cefr_estimate, skill_vector_json)`、`learning_items(kind, prompt, answer_json, metadata_json, content_version)`、`attempts(user_id, item_id, answer_json, score, context)`、`review_states(user_id, item_id, stability, difficulty, due_at, lapses)`、`exposures(user_id, item_id, surface, battle_id)`、`reading_sources(source_type, license, canonical_url, body)`、`daily_missions`。

## AI

`ai_conversations`、`ai_messages`（僅保留經政策允許的去識別內容）、`ai_runs(purpose, prompt_version, model, schema_version, status, usage_json, request_id)`。

所有玩家表以 `user_id` 套用 RLS；為 attempts 時間、到期複習與地圖座標建索引。內容不可原地破壞性修改，使用 `content_version`。

