import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "群英戰略版", description: "Heroes Strategy English playable milestone" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-Hant"><body>{children}</body></html>;
}

