"use client";
import {useCallback,useEffect,useMemo,useState} from "react";
import styles from "./dashboard.module.css";
type Measurement={predictionId:string;actualClose:string|null;closeDeltaSeconds:number|null;openDeltaSeconds:number|null;trains?:Array<{line?:string;category?:string}>;flagged?:boolean};
type Crossing={id:string;name:string;city?:string;status:string};
type Campaign={id:string;name:string;active?:boolean;impressions?:number;clicks?:number;cpm?:number};
type Feed={configured:boolean;activeJobs:number;failedJobs:number;observations24h:number;stations24h:number;lastObservedAt:string|null;error?:string};
type Usage={limitPerMinute:number;currentWindow:number;remaining:number;utilizationPercent:number};
const fmt=(n:number)=>Math.round(n).toLocaleString("de-DE");
const avg=(a:number[])=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null;
export default function AdminDashboard(){
 const[crossings,setCrossings]=useState<Crossing[]>([]),[measurements,setMeasurements]=useState<Measurement[]>([]),[campaigns,setCampaigns]=useState<Campaign[]>([]),[feed,setFeed]=useState<Feed|null>(null),[usage,setUsage]=useState<Usage|null>(null),[loading,setLoading]=useState(true),[errors,setErrors]=useState<string[]>([]);
 const load=useCallback(async()=>{const failed:string[]=[];const tasks=[["Bahnübergänge","/api/admin/crossings",setCrossings],["Messungen","/api/measurements/stats",setMeasurements],["Kampagnen","/api/admin/campaigns",setCampaigns],["Open Boards","/api/admin/open-boards/health",setFeed],["DB API","/api/admin/api-usage",setUsage]] as const;await Promise.all(tasks.map(async([label,url,setter])=>{try{const r=await fetch(url,{cache:"no-store"});const d=await r.json();if(!r.ok)throw new Error();(setter as (v:any)=>void)(d)}catch{failed.push(label)}}));setErrors(failed);setLoading(false)},[]);
 useEffect(()=>{void load();const t=window.setInterval(()=>void load(),120000);return()=>window.clearInterval(t)},[load]);
 const active=crossings.filter(c=>c.status!=="inactive").length;
 const activeCampaigns=campaigns.filter(c=>Boolean(c.active)).length;
 const recent=measurements.filter(m=>m.actualClose&&Date.now()-new Date(m.actualClose).getTime()<86400000);
 const close=avg(recent.map(m=>m.closeDeltaSeconds).filter((v):v is number=>v!==null).map(Math.abs));
 const impressions=campaigns.reduce((s,c)=>s+Number(c.impressions||0),0),clicks=campaigns.reduce((s,c)=>s+Number(c.clicks||0),0);
 const byLine=useMemo(()=>{const map=new Map<string,number>();recent.forEach(m=>m.trains?.forEach(t=>{const k=t.line||t.category||"Sonstige";map.set(k,(map.get(k)||0)+1)}));return [...map].sort((a,b)=>b[1]-a[1]).slice(0,5)},[recent]);
 const status=feed?.error?"warn":feed?.configured?"good":"muted";
 return <div className={styles.dashboard}>
  <div className={styles.heading}><div><div className={styles.eyebrow}>BETRIEBSÜBERSICHT</div><h1>Dashboard</h1><p>Die wichtigsten Kennzahlen und Systemsignale auf einen Blick.</p></div><button onClick={()=>{setLoading(true);void load()}}>↻ Aktualisieren</button></div>
  {errors.length>0&&<div className={styles.warning}>Einige Datenquellen sind nicht erreichbar: {errors.join(", ")}</div>}
  <section className={styles.kpis}>
   <Kpi label="Bahnübergänge" value={fmt(crossings.length)} detail={active+" aktiv"}/>
   <Kpi label="Kampagnen" value={fmt(campaigns.length)} detail={activeCampaigns+" aktiv"}/>
   <Kpi label="Messungen · 24 h" value={fmt(recent.length)} detail={fmt(recent.filter(m=>m.closeDeltaSeconds!==null).length)+" mit Close-Abweichung"}/>
   <Kpi label="Open Boards · 24 h" value={feed?fmt(feed.observations24h):"–"} detail={feed?fmt(feed.stations24h)+" Stationen":"Keine Feed-Daten"}/>
   <Kpi label="Impressions" value={fmt(impressions)} detail={fmt(clicks)+" Klicks gesamt"}/>
  </section>
  <div className={styles.grid}>
   <section className={styles.panel}><div className={styles.panelHead}><div><span>DATENQUALITÄT</span><h2>Prognoseabweichung</h2></div><strong>{close===null?"–":Math.round(close)+" s"}<small>Ø Close · letzte 24 h</small></strong></div><div className={styles.metricRows}><div><span>Messungen mit Ist-Schließzeit</span><b>{fmt(recent.filter(m=>m.closeDeltaSeconds!==null).length)}</b></div><div><span>Messungen mit Ist-Öffnungszeit</span><b>{fmt(recent.filter(m=>m.openDeltaSeconds!==null).length)}</b></div><div><span>Markierte Messungen</span><b>{fmt(recent.filter(m=>m.flagged).length)}</b></div></div><a className={styles.more} href="/admin/measurements">Messungen öffnen →</a></section>
   <section className={styles.panel}><div className={styles.panelHead}><div><span>SYSTEMSTATUS</span><h2>Datenversorgung</h2></div><i className={styles[status]}>{status==="good"?"KONFIGURIERT":status==="warn"?"PRÜFEN":"UNBEKANNT"}</i></div><div className={styles.metricRows}><div><span>Open Boards Queue</span><b>{feed?feed.activeJobs+" aktiv":"–"}</b></div><div><span>Fehlerhafte Jobs</span><b>{feed?fmt(feed.failedJobs):"–"}</b></div><div><span>DB Timetables Limit</span><b>{usage?usage.currentWindow+" / "+usage.limitPerMinute:"–"}</b></div></div><small className={styles.footnote}>Letzter Open-Boards-Eingang: {feed?.lastObservedAt?new Date(feed.lastObservedAt).toLocaleString("de-DE"):"–"}</small><a className={styles.more} href="/admin/crossings/api">API-Monitoring öffnen →</a></section>
   <section className={styles.panel}><div className={styles.panelHead}><div><span>VERKEHR</span><h2>Linien · letzte 24 h</h2></div><a href="/admin/measurements">Details →</a></div>{byLine.length?byLine.map(([line,count])=><div className={styles.line} key={line}><span>{line}</span><div><i style={{width:Math.max(4,count/(byLine[0]?.[1]||1)*100)+"%"}}/></div><b>{fmt(count)}</b></div>):<p className={styles.empty}>Noch keine Zugzuordnungen im Zeitraum.</p>}</section>
   <section className={styles.panel}><div className={styles.panelHead}><div><span>STANDORTE</span><h2>Bahnübergänge</h2></div><a href="/admin/crossings">Verwalten →</a></div>{crossings.slice(0,6).map(c=><div className={styles.crossing} key={c.id}><span className={styles.dot}/><b>{c.name}</b><small>{c.city||c.id}</small><i>{c.status==="inactive"?"Inaktiv":"Aktiv"}</i></div>)}{!crossings.length&&<p className={styles.empty}>{loading?"Lade Standorte…":"Keine Standorte gefunden."}</p>}</section>
  </div>
  <div className={styles.footer}>Automatische Aktualisierung alle 2 Minuten{loading?" · Aktualisiere…":""}</div>
 </div>;
}
function Kpi({label,value,detail}:{label:string;value:string;detail:string}){return <article className={styles.kpi}><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>}
