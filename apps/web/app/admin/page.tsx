"use client";
import {useCallback,useEffect,useMemo,useState} from "react";
import styles from "./dashboard.module.css";

type Usage={limitPerMinute:number;currentWindow:number;remaining:number;utilizationPercent:number;lastHour:number;today:number;cacheHitsToday:number};
type Crossing={id:string;name:string;status:string;lat?:number;lon?:number;stations?:unknown[];city?:string};
type Measurement={closeDeltaSeconds:number|null;openDeltaSeconds:number|null;actualClose?:string|null;trains?:Array<{line?:string;category?:string}>};
type Ad={impressions:number;clicks:number;cpm:number};
type Feed={configured:boolean;activeJobs:number;totalJobs:number;failedJobs:number;observations24h:number;stations24h:number;lastObservedAt:string|null;lastSuccessAt:string|null;error?:string};
const number=(v:unknown)=>Number.isFinite(Number(v))?Number(v):0;
const average=(v:number[])=>v.length?v.reduce((a,b)=>a+b,0)/v.length:null;
const format=(v:number)=>Math.round(v).toLocaleString("de-DE");
const time=(v:string)=>new Date(v).toLocaleTimeString("de-DE",{hour:"2-digit",minute:"2-digit"});

export default function Admin(){
 const[rows,setRows]=useState<Measurement[]>([]),[crossings,setCrossings]=useState<Crossing[]>([]),[ads,setAds]=useState<Ad[]>([]),[usage,setUsage]=useState<Usage|null>(null),[feed,setFeed]=useState<Feed|null>(null);
 const[loading,setLoading]=useState(true),[updated,setUpdated]=useState<Date|null>(null),[errors,setErrors]=useState<string[]>([]),[search,setSearch]=useState("");
 const load=useCallback(async()=>{
  setLoading(true);const failed:string[]=[];
  const jobs=[["Messungen","/api/measurements/stats",setRows,(d:any)=>Array.isArray(d)?d:[]],["Bahnübergänge","/api/admin/crossings",setCrossings,(d:any)=>Array.isArray(d)?d:[]],["Werbung","/api/admin/ads/stats",setAds,(d:any)=>Array.isArray(d)?d:[]],["DB Timetables","/api/admin/api-usage",setUsage,(d:any)=>d],["Open Boards","/api/admin/open-boards/health",setFeed,(d:any)=>d]] as const;
  await Promise.all(jobs.map(async([label,url,setter,normalize])=>{try{const r=await fetch(url,{cache:"no-store"});const d=await r.json();if(!r.ok)throw new Error();(setter as (v:any)=>void)(normalize(d));}catch{failed.push(label)}}));
  setErrors(failed);setUpdated(new Date());setLoading(false);
 },[]);
 useEffect(()=>{void load();const id=window.setInterval(()=>void load(),120000);return()=>window.clearInterval(id)},[load]);
 const last24=useMemo(()=>rows.filter(r=>r.actualClose&&Date.now()-new Date(r.actualClose).getTime()<=86400000),[rows]);
 const close=average(last24.map(r=>r.closeDeltaSeconds).filter((v):v is number=>v!==null).map(Math.abs));
 const open=average(last24.map(r=>r.openDeltaSeconds).filter((v):v is number=>v!==null).map(Math.abs));
 const impressions=ads.reduce((s,a)=>s+number(a.impressions),0),clicks=ads.reduce((s,a)=>s+number(a.clicks),0);
 const revenue=ads.reduce((s,a)=>s+number(a.impressions)/1000*number(a.cpm),0);
 const active=crossings.filter(c=>c.status!=="inactive").length;
 const lines=useMemo(()=>{const m=new Map<string,{count:number;errors:number[]}>();last24.forEach(r=>r.trains?.forEach(t=>{const name=String(t.line||t.category||"Sonstige"),x=m.get(name)||{count:0,errors:[]};x.count++;if(r.closeDeltaSeconds!==null)x.errors.push(Math.abs(r.closeDeltaSeconds));m.set(name,x)}));return [...m.entries()].map(([line,v])=>({line,count:v.count,error:average(v.errors)})).sort((a,b)=>b.count-a.count).slice(0,5)},[last24]);
 const days=useMemo(()=>Array.from({length:7},(_,i)=>{const d=new Date();d.setHours(0,0,0,0);d.setDate(d.getDate()-6+i);const end=new Date(d);end.setDate(end.getDate()+1);const values=rows.filter(r=>r.actualClose&&new Date(r.actualClose)>=d&&new Date(r.actualClose)<end&&r.closeDeltaSeconds!==null).map(r=>Math.abs(r.closeDeltaSeconds as number));return{label:d.toLocaleDateString("de-DE",{weekday:"short"}),value:average(values)}}),[rows]);
 const max=Math.max(1,...days.map(d=>d.value||0)),points=days.map((d,i)=>({x:35+i*112,y:155-(d.value??max*.7)/max*105}));
 const path=points.map((p,i)=>(i?"L":"M")+" "+p.x+" "+p.y).join(" "),area=path+" L 707 172 L 35 172";
 const pct=Math.min(100,Math.max(0,usage?.utilizationPercent||0));
 const geo=crossings.filter(c=>Number.isFinite(c.lat)&&Number.isFinite(c.lon));\n const searchResults=search.trim()?crossings.filter(c=>(c.name+" "+(c.city||"")).toLowerCase().includes(search.trim().toLowerCase())).slice(0,6):[];
 const markers=geo.map(c=>({x:25+(Number(c.lon)-5.5)/10*205,y:20+(55.2-Number(c.lat))/8.2*250,c}));
 const state=feed?.error?"warn":feed?.configured&&feed.activeJobs>0?"good":"muted";
 return <main className={styles.shell}>
  <aside className={styles.sidebar}>
   <a className={styles.brand} href="/admin"><img src="/images/meineschranke_logo.webp" alt="Meine Schranke"/><span><b>CONTROL CENTER</b><small>Administration</small></span></a>
   <div className={styles.navLabel}>WORKSPACE</div><nav className={styles.nav}>
    <a className={styles.navActive} href="/admin"><Icon name="grid"/>Dashboard</a>
    <a href="/admin/crossings"><Icon name="rail"/>Bahnübergänge <i>{crossings.length||"–"}</i></a>
    <a href="/admin/measurements"><Icon name="activity"/>Messungen</a>
    <a href="/admin/crossings/api"><Icon name="database"/>Daten & APIs</a>
    <a href="/admin/campaigns"><Icon name="megaphone"/>Werbung & Kampagnen</a>
   </nav><div className={styles.navLabel}>SYSTEM</div><nav className={styles.nav}><a href="/admin/system"><Icon name="settings"/>Einstellungen</a></nav>
   <div className={styles.sidebarBottom}><i/><span><b>{errors.length?"Teilweise eingeschränkt":"Systemübersicht"}</b><small>{errors.length?errors.length+" Datenquellen nicht erreichbar":"Live-Daten · 2-Minuten-Refresh"}</small></span></div>
  </aside>
  <section className={styles.main}>
   <header className={styles.topbar}><div className={styles.breadcrumb}>MEINESCHRANKE <span>/</span> CONTROL CENTER</div><div className={styles.topActions}><div className={styles.searchWrap}><label className={styles.search}><Icon name="search"/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Bahnübergang suchen…"/><kbd>⌘ K</kbd></label>{search.trim()&&<div className={styles.searchResults}>{searchResults.length?searchResults.map(c=><a key={c.id} href="/admin/crossings"><b>{c.name}</b><small>{c.city||"Bahnübergang verwalten"}</small></a>):<span>Kein Treffer</span>}</div>}</div><button className={styles.iconButton} onClick={()=>void load()} aria-label="Aktualisieren"><Icon name="refresh"/></button><span className={styles.avatar}>MS</span></div></header>
   <div className={styles.content}>
    <div className={styles.heading}><div><div className={styles.eyebrow}>CROSSINGS · CONTROL CENTER</div><h1>Dashboard<span>.</span></h1><p>Alles im Blick. Jede Schranke. Jede Prognose. Jeder Datenstrom.</p></div><div className={styles.updated}><i/>{loading?"Aktualisiere…":updated?"Aktualisiert "+time(updated.toISOString()):"Noch keine Aktualisierung"}<button onClick={()=>void load()}>↻</button></div></div>
    {errors.length>0&&<div className={styles.warning}><Icon name="alert"/>Datenquellen nicht erreichbar: {errors.join(", ")}. Verfügbare Kennzahlen bleiben sichtbar.</div>}
    <section className={styles.kpis}>
     <Kpi icon="rail" label="Aktive Bahnübergänge" value={String(active)} foot={crossings.length+" insgesamt"} accent="red"/>
     <Kpi icon="activity" label="Messungen · 24 Stunden" value={format(last24.length)} foot={format(last24.filter(r=>r.closeDeltaSeconds!==null).length)+" mit Close-Istwert"} accent="blue"/>
     <Kpi icon="database" label="Open Boards · letzte 24 h" value={feed?format(feed.observations24h):"–"} foot={feed?format(feed.stations24h)+" Stationen mit Daten":"Feed-Monitoring"} accent="violet"/>
     <Kpi icon="euro" label="Werbeumsatz · Modell" value={revenue.toLocaleString("de-DE",{style:"currency",currency:"EUR"})} foot={format(impressions)+" Impressions · "+format(clicks)+" Klicks"} accent="green"/>
    </section>
    <div className={styles.primaryGrid}>
     <section className={styles.panel}><div className={styles.panelHead}><div><div className={styles.panelEyebrow}>PROGNOSE & DATENQUALITÄT</div><h2>Schließprognose</h2><p>Mittlere absolute Abweichung · letzte 7 Tage</p></div><div className={styles.bigMetric}>{close===null?"–":Math.round(close)+" s"}<small>Ø Abweichung / 24 h</small></div></div>
      <div className={styles.chart}><div className={styles.axis}><span>hoch</span><span>mittel</span><span>niedrig</span></div><svg viewBox="0 0 744 190" role="img" aria-label="Mittlere Schließabweichung der letzten sieben Tage" preserveAspectRatio="none"><defs><linearGradient id="dashboardArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fb344d" stopOpacity=".32"/><stop offset="1" stopColor="#fb344d" stopOpacity="0"/></linearGradient></defs>{[35,80,125,172].map(y=><line key={y} x1="35" x2="708" y1={y} y2={y} stroke="rgba(255,255,255,.08)" strokeDasharray="3 5"/>)}<path d={area} fill="url(#dashboardArea)"/><path d={path} fill="none" stroke="#ff4057" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"/>{points.map((p,i)=><circle key={i} cx={p.x} cy={p.y} r="4" fill="#fff" stroke="#ff4057" strokeWidth="2.5"/>)}</svg><div className={styles.chartLabels}>{days.map(d=><span key={d.label}>{d.label}</span>)}</div></div>
      <div className={styles.forecastFoot}><span>Ø Öffnungsabweichung <b>{open===null?"–":Math.round(open)+" s"}</b></span><span>Messbasis <b>{last24.length} Ereignisse</b></span></div>
     </section>
     <section className={styles.panel+" "+styles.systemPanel}><div className={styles.panelHead}><div><div className={styles.panelEyebrow}>LIVE MONITORING</div><h2>Systemstatus</h2></div><span className={styles.statusTag+" "+styles[state]}>{state==="good"?"OPERATIV":state==="warn"?"PRÜFEN":"DATEN FEHLEN"}</span></div>
      <Status label="DB Open Boards" detail={feed?.configured?"API-Zugang konfiguriert":"Zugangsdaten fehlen"} state={feed?.configured?"good":"bad"}/>
      <Status label="Open-Boards-Queue" detail={feed?feed.activeJobs+" aktive Jobs · "+feed.failedJobs+" Fehler":"Keine Daten"} state={feed?.failedJobs?"warn":feed?.activeJobs?"good":"muted"}/>
      <Status label="DB Timetables" detail={usage?usage.currentWindow+"/"+usage.limitPerMinute+" Requests / Minute":"Keine Daten"} state={usage&&pct>=90?"warn":usage?"good":"muted"}/>
      <Status label="OSM / Infrastruktur" detail={crossings.length?crossings.length+" BÜ-Datensätze geladen":"Keine Daten"} state={crossings.length?"good":"muted"}/>
      <Status label="Messdaten" detail={last24.length?last24.length+" Ereignisse in 24 h":"Keine neuen Ereignisse"} state={last24.length?"good":"muted"}/>
      <div className={styles.systemFoot}>Letzter Open-Boards-Eingang <b>{feed?.lastObservedAt?new Date(feed.lastObservedAt).toLocaleString("de-DE"):"–"}</b></div>
     </section>
    </div>
    <div className={styles.secondaryGrid}>
     <section className={styles.panel}><div className={styles.panelHead}><div><div className={styles.panelEyebrow}>INFRASTRUKTUR</div><h2>Bahnübergänge</h2><p>Geografischer Überblick der Standorte</p></div><a href="/admin/crossings">Alle öffnen ↗</a></div><div className={styles.mapWrap}><svg viewBox="0 0 260 300" role="img" aria-label="Schematische Deutschlandkarte mit Bahnübergängen"><path d="M89 9 113 18 129 11 145 27 169 26 181 43 203 48 211 69 230 81 222 105 235 122 220 143 226 165 208 183 207 204 190 217 186 241 164 250 151 275 129 281 113 264 94 272 77 252 56 248 49 226 32 212 40 189 26 174 35 154 22 135 34 113 27 94 43 79 42 55 61 44 66 25Z" className={styles.germany}/>{markers.map((p,i)=><g key={p.c.id}><circle cx={p.x} cy={p.y} r="9" className={p.c.status==="inactive"?styles.mapInactive:styles.mapGlow}/><circle cx={p.x} cy={p.y} r="3.5" className={p.c.status==="inactive"?styles.mapInactiveCore:styles.mapCore}/></g>)}</svg><div className={styles.mapStats}><b>{crossings.length}</b><span>Standorte</span><b className={styles.greenText}>{active}</b><span>Aktiv</span><b>{crossings.length-active}</b><span>Inaktiv</span></div>{geo.length===0&&<div className={styles.mapEmpty}>Standortkoordinaten noch nicht verfügbar</div>}</div></section>
     <section className={styles.panel}><div className={styles.panelHead}><div><div className={styles.panelEyebrow}>VERKEHRSDATEN</div><h2>Top-Linien</h2><p>Zugereignisse · 24 Stunden</p></div></div>{lines.length?lines.map((l)=><div className={styles.lineRow} key={l.line}><span>{l.line}</span><div className={styles.lineTrack}><i style={{width:Math.max(5,l.count/(lines[0]?.count||1)*100)+"%"}}/></div><b>{format(l.count)}</b></div>):<div className={styles.empty}>Noch keine Linienereignisse im Zeitraum.</div>}<div className={styles.lineFoot}>Messungen mit Zugzuordnung</div></section>
     <section className={styles.panel}><div className={styles.panelHead}><div><div className={styles.panelEyebrow}>API & LIMITS</div><h2>Open Boards</h2><p>Neue DB-Schnittstelle · Feed und Queue</p></div><a href="/admin/crossings/api">Details ↗</a></div><div className={styles.openMetric}><strong>{feed?format(feed.observations24h):"–"}</strong><span>Beobachtungen / 24 h</span></div><div className={styles.miniStats}><div><b>{feed?feed.activeJobs:"–"}</b><span>aktive Jobs</span></div><div><b>{feed?feed.failedJobs:"–"}</b><span>Fehler</span></div><div><b>{feed?format(feed.stations24h):"–"}</b><span>Stationen</span></div></div><div className={styles.legacy}><span>Legacy / Fallback · DB Timetables</span><b>{usage?pct.toFixed(1)+" %":"–"}</b><div><i style={{width:pct+"%"}}/></div><small>{usage?usage.currentWindow+" von "+usage.limitPerMinute+" Requests im 60-Sekunden-Fenster":"Status nicht verfügbar"}</small></div></section>
    </div>
    <section className={styles.bottomGrid}>
     <div className={styles.panel}><div className={styles.panelHead}><div><div className={styles.panelEyebrow}>MONETARISIERUNG</div><h2>Werbung & Reichweite</h2></div><a href="/admin/campaigns">Kampagnen ↗</a></div><div className={styles.adStats}><div><b>{format(impressions)}</b><span>Impressions</span></div><div><b>{format(clicks)}</b><span>Klicks</span></div><div><b>{impressions?(clicks/impressions*100).toFixed(2):"0,00"} %</b><span>CTR</span></div><div><b>{revenue.toLocaleString("de-DE",{style:"currency",currency:"EUR"})}</b><span>CPM-Modell</span></div></div></div>
     <div className={styles.panel}><div className={styles.panelHead}><div><div className={styles.panelEyebrow}>SCHNELLZUGRIFF</div><h2>Direkt weiterarbeiten</h2></div></div><div className={styles.quick}><a href="/admin/crossings"><Icon name="rail"/><span><b>BÜ verwalten</b><small>Standorte & Prognosen</small></span><em>↗</em></a><a href="/admin/crossings/api"><Icon name="database"/><span><b>API-Monitoring</b><small>Limits & Verbrauch</small></span><em>↗</em></a><a href="/admin/measurements"><Icon name="activity"/><span><b>Messungen</b><small>Feedback & Qualität</small></span><em>↗</em></a><a href="/admin/campaigns"><Icon name="megaphone"/><span><b>Kampagnen</b><small>Werbung & Budgets</small></span></a></div></div>
    </section>
    <footer className={styles.footer}>MEINESCHRANKE CONTROL CENTER <span>Automatische Aktualisierung · 120 Sekunden</span></footer>
   </div>
  </section>
 </main>;
}
function Kpi({icon,label,value,foot,accent}:{icon:string;label:string;value:string;foot:string;accent:string}){return <article className={styles.kpi}><div className={styles.kpiIcon+" "+styles[accent]}><Icon name={icon}/></div><div><span>{label}</span><strong>{value}</strong><small>{foot}</small></div></article>}
function Status({label,detail,state}:{label:string;detail:string;state:string}){return <div className={styles.statusRow}><i className={styles[state]}/><span><b>{label}</b><small>{detail}</small></span><em>{state==="good"?"●":state==="bad"?"!":"—"}</em></div>}
function Icon({name}:{name:string}){const paths:Record<string,string>={grid:"M3 3h7v7H3z M14 3h7v7h-7z M14 14h7v7h-7z M3 14h7v7H3z",rail:"M4 4h16M4 10h16M4 16h16M4 21l4-17m8 17 4-17M7 7h10M7 13h10M7 19h10",activity:"M3 12h4l3-8 4 16 3-8h4",database:"M12 3 3 8l9 5 9-5-9-5z M3 12l9 5 9-5 M3 16l9 5 9-5",megaphone:"M3 11v2h4l12 6V5L7 11H3z M7 13l2 7h4l-2-5",settings:"M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M19 12a7 7 0 1 1-14 0 7 7 0 0 1 14 0",search:"M20 20l-4.5-4.5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0z",refresh:"M20 7v5h-5 M20 12a8 8 0 1 1-2.3-5.7L20 7",euro:"M18 5a7 7 0 1 0 0 14 M4 10h10 M4 14h9",alert:"M12 3 2 21h20L12 3z M12 9v5m0 3h.01"};return <svg viewBox="0 0 24 24" aria-hidden="true"><path d={paths[name]||paths.grid}/></svg>}
