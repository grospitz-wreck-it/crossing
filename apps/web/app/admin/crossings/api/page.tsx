"use client";

import { useEffect, useState } from "react";
import styles from "./page.module.css";

type Usage = { limitPerMinute:number; currentWindow:number; remaining:number; utilizationPercent:number; lastHour:number; today:number; cacheHitsToday:number; oldestRequest:string|null; byEva:{eva:string|null;requests:number}[] };

export default function ApiDetailsPage(){
  const [usage,setUsage]=useState<Usage|null>(null); const [error,setError]=useState("");
  useEffect(()=>{let alive=true;async function load(){try{const r=await fetch("/api/admin/api-usage",{cache:"no-store"});const d=await r.json();if(!r.ok)throw new Error(d.error||"API-Status konnte nicht geladen werden.");if(alive)setUsage(d);}catch(e){if(alive)setError(e instanceof Error?e.message:"API-Status konnte nicht geladen werden.");}}void load();const t=window.setInterval(load,10000);return()=>{alive=false;window.clearInterval(t)}},[]);
  const pct=Math.min(100,Math.max(0,usage?.utilizationPercent||0));
  return <main className={styles.page}><header className={styles.header}><div><div className={styles.eyebrow}>SYSTEM · DB API</div><h1>API-Übersicht</h1><p>Rate-Limit, Verbrauch und die teuersten EVA-Abfragen auf einen Blick.</p></div><a className={styles.back} href="/admin/crossings">← Bahnübergänge</a></header>
    {error&&<div className={styles.error}>{error}</div>}
    {usage&&<><div className={styles.tabs}><a className={styles.active} href="/admin/crossings/api">Übersicht</a><a href="#rate">Rate-Limit</a><a href="#eva">EVA-Verbrauch</a><a href="#cache">Cache</a></div>
      <section className={styles.hero}><div><span>AKTUELLE MINUTE</span><strong>{usage.currentWindow} <small>/ {usage.limitPerMinute}</small></strong><b>{pct.toFixed(1)} %</b></div><div className={styles.bar}><i style={{width:`${pct}%`}}/></div><p>Globales gleitendes 60-Sekunden-Fenster. Neue DB-Anfragen werden automatisch verzögert, bevor das Kontingent überschritten wird.</p></section>
      <section className={styles.cards}><article><span>Frei jetzt</span><strong>{usage.remaining}</strong><small>Requests im Fenster</small></article><article><span>Letzte Stunde</span><strong>{usage.lastHour.toLocaleString("de-DE")}</strong><small>DB-Timetables Requests</small></article><article><span>Heute</span><strong>{usage.today.toLocaleString("de-DE")}</strong><small>Requests gesamt</small></article><article><span>Cache-Hits</span><strong>{usage.cacheHitsToday.toLocaleString("de-DE")}</strong><small>heute nicht extern angefragt</small></article></section>
      <div className={styles.grid}><section id="rate" className={styles.panel}><h2>Rate-Limit</h2><div className={styles.line}><span>Maximal</span><strong>{usage.limitPerMinute} / Minute</strong></div><div className={styles.line}><span>Aktuell</span><strong>{usage.currentWindow}</strong></div><div className={styles.line}><span>Rest</span><strong>{usage.remaining}</strong></div><div className={styles.line}><span>Älteste Anfrage</span><strong>{usage.oldestRequest||"–"}</strong></div></section><section id="cache" className={styles.panel}><h2>Cache</h2><p>Cache-Treffer werden nicht auf das externe DB-Timetables-Kontingent angerechnet.</p><div className={styles.cacheNumber}>{usage.cacheHitsToday.toLocaleString("de-DE")}</div><small>Cache-Hits heute</small></section></div>
      <section id="eva" className={styles.panel}><div className={styles.panelHead}><div><h2>Top EVAs · letzte 24 Stunden</h2><p>Welche Stationen verursachen aktuell den meisten externen API-Verbrauch?</p></div><span>Top {usage.byEva.length}</span></div><div className={styles.evas}>{usage.byEva.map((item,i)=><div className={styles.eva} key={`${item.eva}-${i}`}><code>{item.eva||"ohne EVA"}</code><div><i style={{width:`${Math.min(100,(item.requests/(usage.byEva[0]?.requests||1))*100)}%`}}/></div><strong>{item.requests}</strong></div>)}</div></section>
    </>}
  </main>;
}
