"use client";

import { useMemo, useState } from "react";
import { createMap, Report, resolveBattle } from "@/lib/game";

const heroes = [
  { name: "沈烈", role: "槍兵主將", rarity: 5, power: 1280 },
  { name: "顧昭", role: "謀略副將", rarity: 4, power: 1040 },
  { name: "陸青", role: "騎兵先鋒", rarity: 4, power: 970 },
];

export function WarRoom() {
  const [tiles, setTiles] = useState(createMap);
  const [selected, setSelected] = useState(19);
  const [troops, setTroops] = useState(4200);
  const [orders, setOrders] = useState(5);
  const [grain, setGrain] = useState(12800);
  const [intel, setIntel] = useState(false);
  const [reports, setReports] = useState<Report[]>([{ id: 0, title: "前線待命", detail: "選擇一塊未佔領土地，研判情報後出征。", victory: true }]);
  const tile = tiles[selected];
  const owned = useMemo(() => tiles.filter((item) => item.owned).length, [tiles]);

  function march() {
    if (tile.owned || orders < 1 || grain < 600 || troops < 500) return;
    const result = resolveBattle(tile, troops, intel);
    setOrders((value) => value - 1);
    setGrain((value) => value - 600);
    setTroops((value) => Math.max(0, value - result.loss));
    if (result.victory) setTiles((items) => items.map((item) => item.id === tile.id ? { ...item, owned: true } : item));
    setReports((items) => [{ id: Date.now(), title: `${result.victory ? "捷報" : "敗報"} · ${tile.terrain}地 LV.${tile.level}`, detail: result.detail, victory: result.victory }, ...items].slice(0, 4));
    setIntel(false);
  }

  function reset() { setTiles(createMap()); setSelected(19); setTroops(4200); setOrders(5); setGrain(12800); setIntel(false); setReports([{ id: 0, title: "戰局重置", detail: "部隊已回到初始演練狀態。", victory: true }]); }

  return <main>
    <header className="topbar"><div><p className="eyebrow">北境 · 演武戰區</p><h1>群英戰略版 <span>Heroes Strategy English</span></h1></div><div className="resources"><b>糧草 {grain.toLocaleString()}</b><b>軍令 {orders}/5</b><b>領地 {owned}/56</b></div></header>
    <section className="workspace">
      <aside className="panel roster"><div className="panel-title"><span>第一軍團</span><em>戰力 3,290</em></div>{heroes.map((hero, index) => <article className="hero" key={hero.name}><div className="portrait">{hero.name[0]}</div><div><strong>{index + 1}. {hero.name}</strong><small>{"★".repeat(hero.rarity)} · {hero.role}</small><small>戰力 {hero.power.toLocaleString()}</small></div></article>)}<div className="troops"><span>現有兵力</span><strong>{troops.toLocaleString()}</strong><div><i style={{ width: `${Math.min(100, troops / 42)}%` }} /></div></div><button className="ghost" onClick={reset}>重置演練</button></aside>
      <section className="map-wrap"><div className="map-head"><div><p className="eyebrow">戰略沙盤 / 7 × 8</p><h2>河朔前線</h2></div><p>選擇土地研判守軍。中心為我方主城。</p></div><div className="map" role="grid" aria-label="戰略地圖">{tiles.map((item) => <button key={item.id} aria-label={`${item.terrain}地，等級 ${item.level}${item.owned ? "，已佔領" : ""}`} className={`tile ${item.owned ? "owned" : ""} ${item.id === selected ? "selected" : ""} t-${item.terrain}`} onClick={() => setSelected(item.id)}><span>{item.terrain}</span><small>LV.{item.level}</small></button>)}</div><div className="legend"><span>■ 我方</span><span>■ 資源地</span><span>框線：目前選取</span></div></section>
      <aside className="panel command"><div className="panel-title"><span>軍情研判</span><em>座標 {selected % 7 + 1},{Math.floor(selected / 7) + 1}</em></div><h2>{tile.terrain}地 · LV.{tile.level}</h2><dl><div><dt>守軍估值</dt><dd>{tile.power.toLocaleString()}</dd></div><div><dt>糧草消耗</dt><dd>600</dd></div><div><dt>狀態</dt><dd>{tile.owned ? "已控制" : "可進軍"}</dd></div></dl><section className={`intel ${intel ? "active" : ""}`}><p className="eyebrow">英語情報 · 可選加速</p><strong>“The eastern flank is exposed.”</strong><p>哪一側防線暴露？學過的 <u>flank</u> 再次出現在戰場情報中。</p><div><button onClick={() => setIntel(true)}>東側</button><button onClick={() => setIntel(false)}>西側</button></div>{intel && <small>情報確認：本次有效戰力 +18%。不作答仍可正常出征。</small>}</section><button className="march" disabled={tile.owned || orders < 1 || grain < 600} onClick={march}>{tile.owned ? "此地已控制" : "出征 · 自動戰鬥"}</button></aside>
    </section>
    <section className="reports"><div className="section-title"><p className="eyebrow">After Action</p><h2>最新戰報</h2></div><div className="report-list">{reports.map((report) => <article key={report.id} className={report.victory ? "win" : "loss"}><strong>{report.title}</strong><p>{report.detail}</p></article>)}</div></section>
  </main>;
}
