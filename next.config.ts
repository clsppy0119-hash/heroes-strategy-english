import type { NextConfig } from "next";

/**
 * v0.1 完全跑在瀏覽器裡（純前端 + localStorage），所以整個遊戲可以靜態輸出，
 * 丟到任何靜態託管都能跑，不需要 Node 伺服器。
 *
 * 這對 #7 很重要：沒有人會為了幫忙測一個遊戲去 clone repo 跑 pnpm。
 * 要能給出一個連結。
 *
 *   pnpm build:static                      → out/，放在網域根目錄
 *   BASE_PATH=/heroes-strategy-english …   → 放在子路徑（例如 GitHub Pages）
 *
 * v0.2 有了後端之後就不能再靜態輸出，那時候把 STATIC_EXPORT 拿掉即可。
 */
const staticExport = process.env.STATIC_EXPORT === "1";
const basePath = process.env.BASE_PATH ?? "";

const nextConfig: NextConfig = {
  ...(staticExport ? { output: "export" as const } : {}),
  ...(basePath ? { basePath, assetPrefix: basePath } : {}),
  // 靜態託管通常沒有圖片最佳化服務。
  ...(staticExport ? { images: { unoptimized: true } } : {}),
};

export default nextConfig;
