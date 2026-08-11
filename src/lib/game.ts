export type Terrain = "城" | "林" | "田" | "礦" | "荒";
export type Tile = { id: number; terrain: Terrain; level: number; owned: boolean; power: number };
export type Report = { id: number; title: string; detail: string; victory: boolean };

const terrainCycle: Terrain[] = ["荒", "林", "田", "礦", "荒", "田", "林"];

export function createMap(): Tile[] {
  return Array.from({ length: 56 }, (_, id) => {
    const level = 1 + ((id * 7 + 3) % 5);
    return { id, terrain: id === 27 ? "城" : terrainCycle[id % terrainCycle.length], level, owned: id === 27, power: 640 + level * 310 };
  });
}

export function resolveBattle(tile: Tile, troops: number, intel: boolean): { victory: boolean; loss: number; detail: string } {
  const effectivePower = troops * (intel ? 1.18 : 1);
  const victory = effectivePower >= tile.power;
  const lossRate = victory ? 0.07 + tile.level * 0.018 : 0.16 + tile.level * 0.025;
  const loss = Math.max(80, Math.round(troops * lossRate));
  const detail = `${intel ? "情報判讀成功，避開守軍鋒線。" : "依標準偵察路線進軍。"} 我軍 ${troops.toLocaleString()} 對守軍 ${tile.power.toLocaleString()}，${victory ? "成功控制土地" : "兵力不足，已撤回主城"}。`;
  return { victory, loss, detail };
}

