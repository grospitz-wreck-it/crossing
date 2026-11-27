"use client";
import {useEffect,useMemo,useState} from "react";
import styles from "./page.module.css";
import AdminIcon from "../components/AdminIcon";
type Row={predictionId:string;predictedClose:string|null;predictedOpen:string|null;actualClose:string|null;actualOpen:string|null;closeDeltaSeconds:number|null;openDeltaSeconds:number|null;measuredDurationSeconds:number|null;trains:Array<{line?:string;category?:string}>;trainCount:number;flagged:boolean};
const n=(v:number|null)=>v===null?"–":(v>0?"+":"")+v.toLocaleString("de-DE")+" s";
export default function MeasurementsAdmin(){
 const[rows,setRows]=useState<Row[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(""),[filter,setFilter]=useState("all");
 async function load(){try{const r=await fetch("/api/measurements/stats",{cache:"no-store"});const d=await r.json();if(!r.ok)throw new Error("Messungen konnten nicht geladen werden.");setRows(Array.isArray(d)?d:[]);setError("")}catch(e){setError(e instanceof Error?e.message:"Unbekannter Fehler")}finally{setLoading(false)}}
 useEffect(()=>{void load();const t=window.setInterval(()=>void load(),120000);return()=>window.clearInterval(t)},[]);
 const filtered=useMemo(()=>rows.filter(r=>filter==="flagged"?r.flagged:filter==="measured"?r.closeDeltaSeconds!==null||r.openDeltaSeconds!==null:true),[rows,filter]);
 const measured=rows.filter(r=>r.closeDeltaSeconds!==null||r.openDeltaSeconds!==null).length,flagged=rows.filter(r=>r.flagged).length;
 const close=rows.map(r=>r.closeDeltaSeconds).filter((v):v is number=>v!==null).map(Math.abs);
 const mean=close.length?Math.round(close.reduce((a,b)=>a+b,0)/close.length):null;
 return <div className={styles.page}>
  <header className={styles.header}><div><div className={styles.eyebrow}>BETRIEB · QUALITÄTSSICHERUNG</div><h1>Messungen</h1><p>Abgleich zwischen prognostizierten und tatsächlich gemeldeten Schrankenschaltungen.</p></div><button onClick={()=>{setLoading(true);void load()}}><AdminIcon name="refresh" size={15}/> Aktualisieren</button></header>
  {error&&<div className={styles.error}>{error}</div>}
  <section className={styles.kpis}><Kpi label="Messereignisse" value={rows.length}/><Kpi label="Mit Ist-Abgleich" value={measured}/><Kpi label="Ø Close-Abweichung" value={mean===null?"–":mean+" s"}/><Kpi label="Markiert" value={flagged}/></section>
  <section className={styles.panel}>
   <div className={styles.toolbar}><div><h2>Messprotokoll</h2><p>{filtered.length} von {rows.length} Prognoseereignissen</p></div><select value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">Alle Messungen</option><option value="measured">Mit Ist-Abgleich</option><option value="flagged">Markierte</option></select></div>
   <div className={styles.tableWrap}><table><thead><tr><th>Zeitpunkt</th><th>Zug / Linie</th><th>Close-Abweichung</th><th>Open-Abweichung</th><th>Dauer</th><th>Status</th></tr></thead><tbody>{filtered.map(r=><tr key={r.predictionId}><td>{r.actualClose?new Date(r.actualClose).toLocaleString("de-DE"):"Noch kein Ist-Zeitpunkt"}</td><td>{r.trains?.map(t=>t.line||t.category).filter(Boolean).join(", ")||"–"}<small>{r.trainCount} Zugzuordnungen</small></td><td className={r.closeDeltaSeconds===null?"":Math.abs(r.closeDeltaSeconds)>120?styles.warn:""}>{n(r.closeDeltaSeconds)}</td><td>{n(r.openDeltaSeconds)}</td><td>{r.measuredDurationSeconds===null?"–":Math.round(r.measuredDurationSeconds/60)+" min"}</td><td><span className={r.flagged?styles.flag:styles.ok}>{r.flagged?"Markiert":"Erfasst"}</span></td></tr>)}</tbody></table>{!loading&&!filtered.length&&<div className={styles.empty}>Für diesen Filter liegen keine Messungen vor.</div>}{loading&&<div className={styles.empty}>Messungen werden geladen…</div>}</div>
  </section>
 </div>;
}
function Kpi({label,value}:{label:string;value:number|string}){return <article className={styles.kpi}><span>{label}</span><b>{typeof value==="number"?value.toLocaleString("de-DE"):value}</b></article>}
