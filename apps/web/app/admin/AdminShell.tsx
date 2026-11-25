"use client";
import type {ReactNode} from "react";
import {usePathname} from "next/navigation";
import {useEffect,useState} from "react";
import styles from "./AdminShell.module.css";
type NavItem=[string,string,string];\ntype NavGroup={label:string;items:NavItem[]};\nconst groups:NavGroup[]=[{label:"ÜBERSICHT",items:[["/admin","Dashboard","⌂"]]},{label:"BETRIEB",items:[["/admin/crossings","Bahnübergänge","▤"],["/admin/measurements","Messungen","◷"]]},{label:"VERMARKTUNG",items:[["/admin/ads","Werbung & Kampagnen","▧"],["/admin/campaigns","Kampagnen-Setup","＋"]]},{label:"DATEN & SYSTEM",items:[["/admin/crossings/api","DB API & Verbrauch","⌁"],["/admin/crossings/forecasts","Prognosen","⌘"]]} ];
export default function AdminShell({children}:{children:ReactNode}){
 const pathname=usePathname();
 const [campaignCount,setCampaignCount]=useState<number|null>(null);
 useEffect(()=>{let alive=true;fetch("/api/admin/campaigns",{cache:"no-store"}).then(r=>r.ok?r.json():[]).then(d=>{if(alive)setCampaignCount(Array.isArray(d)?d.length:0)}).catch(()=>{if(alive)setCampaignCount(null)});return()=>{alive=false}},[]);
 return <div className={styles.shell}>
  <aside className={styles.sidebar}>
   <a href="/admin" className={styles.brand}><img src="/images/meineschranke_logo.webp" alt="meineschranke"/><span><b>CONTROL CENTER</b><small>Administration</small></span></a>
   <nav aria-label="Admin Navigation">{groups.map(group=><div className={styles.group} key={group.label}><div className={styles.label}>{group.label}</div>{group.items.map(([href,label,icon])=><a key={href} href={href} className={pathname===href||(href!=="/admin"&&pathname.startsWith(href+"/"))?styles.active:styles.link}><i>{icon}</i><span>{label}</span>{href==="/admin/ads"&&campaignCount!==null&&<em>{campaignCount}</em>}</a>)}</div>)}</nav>
   <div className={styles.sidebarFoot}><i/> Systembereich</div>
  </aside>
  <div className={styles.workspace}><header className={styles.topbar}><div><span>MEINESCHRANKE</span><b>/</b><strong>{groups.flatMap(g=>g.items).find(([href])=>pathname===href|| (href!=="/admin"&&pathname.startsWith(href+"/")))?.[1]||"Administration"}</strong></div><a href="/admin">Zur Übersicht ↗</a></header><main className={styles.content}>{children}</main></div>
 </div>;
}
