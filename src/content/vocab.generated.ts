// 由 scripts/gen-vocab.mjs 從 content/vocab.v1.csv 產生，不要手動編輯。
// 改題庫請改 CSV，然後跑 pnpm gen:vocab。

import type { VocabEntry } from './static-provider';

export const VOCAB_SOURCE = 'content/vocab.v1.csv';

export const VOCAB: readonly VocabEntry[] = [
  { id: 'v001', en: 'march', zh: '行軍', level: 1, source: 'handwritten-v1' },
  { id: 'v002', en: 'guard', zh: '守衛', level: 1, source: 'handwritten-v1' },
  { id: 'v003', en: 'plain', zh: '平原', level: 1, source: 'handwritten-v1' },
  { id: 'v004', en: 'river', zh: '河流', level: 1, source: 'handwritten-v1' },
  { id: 'v005', en: 'gate', zh: '城門', level: 1, source: 'handwritten-v1' },
  { id: 'v006', en: 'grain', zh: '糧草', level: 1, source: 'handwritten-v1' },
  { id: 'v007', en: 'horse', zh: '戰馬', level: 1, source: 'handwritten-v1' },
  { id: 'v008', en: 'arrow', zh: '箭矢', level: 1, source: 'handwritten-v1' },
  { id: 'v009', en: 'camp', zh: '營地', level: 1, source: 'handwritten-v1' },
  { id: 'v010', en: 'road', zh: '道路', level: 1, source: 'handwritten-v1' },
  { id: 'v011', en: 'flank', zh: '側翼', level: 2, source: 'handwritten-v1' },
  { id: 'v012', en: 'retreat', zh: '撤退', level: 2, source: 'handwritten-v1' },
  { id: 'v013', en: 'supply', zh: '補給', level: 2, source: 'handwritten-v1' },
  { id: 'v014', en: 'scout', zh: '斥候', level: 2, source: 'handwritten-v1' },
  { id: 'v015', en: 'siege', zh: '圍城', level: 2, source: 'handwritten-v1' },
  { id: 'v016', en: 'ambush', zh: '埋伏', level: 2, source: 'handwritten-v1' },
  { id: 'v017', en: 'terrain', zh: '地形', level: 2, source: 'handwritten-v1' },
  { id: 'v018', en: 'morale', zh: '士氣', level: 2, source: 'handwritten-v1' },
  { id: 'v019', en: 'reinforce', zh: '增援', level: 2, source: 'handwritten-v1' },
  { id: 'v020', en: 'garrison', zh: '駐軍', level: 2, source: 'handwritten-v1' },
];
