"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./page.module.css";

type Customer = {
  id: string; name: string; active: number | boolean;
  campaign_count: number | string; running_campaign_count: number | string;
  active_campaign_count: number | string; calculated_revenue: number | string;
};
type Profile = {
  legal_name: string; contact_name: string; contact_role: string; email: string; phone: string;
  street: string; postal_code: string; city: string; country: string; vat_id: string;
  billing_name: string; billing_street: string; billing_postal_code: string;
  billing_city: string; billing_country: string; billing_email: string; notes: string;
};
const emptyProfile: Profile = {
  legal_name:"",contact_name:"",contact_role:"",email:"",phone:"",street:"",postal_code:"",
  city:"",country:"Deutschland",vat_id:"",billing_name:"",billing_street:"",
  billing_postal_code:"",billing_city:"",billing_country:"Deutschland",billing_email:"",notes:""
};
const n=(v:number|string|null|undefined)=>Number(v??0);
const money=(v:number|string)=>new Intl.NumberFormat("de-DE",{style:"currency",currency:"EUR"}).format(n(v));

export default function CustomersPage(){
 const [rows,setRows]=useState<Customer[]>([]),[loading,setLoading]=useState(true);
 const [sort,setSort]=useState<"asc"|"desc">("asc"),[showCreate,setShowCreate]=useState(false);
 const [name,setName]=useState(""),[saving,setSaving]=useState(false),[error,setError]=useState("");
 const [selected,setSelected]=useState<Customer|null>(null),[profile,setProfile]=useState<Profile>(emptyProfile);
 const [detailLoading,setDetailLoading]=useState(false),[detailSaving,setDetailSaving]=useState(false);
 const [detailError,setDetailError]=useState(""),[detailMessage,setDetailMessage]=useState("");
 const [deleting,setDeleting]=useState<string|null>(null);

 async function load(){try{const r=await fetch("/api/admin/customers",{cache:"no-store"});if(!r.ok)throw new Error("Kunden konnten nicht geladen werden.");setRows(await r.json());}catch(e){setError(e instanceof Error?e.message:"Laden fehlgeschlagen.");}finally{setLoading(false);}}
 useEffect(()=>{void load();},[]);
 const sorted=useMemo(()=>[...rows].sort((a,b)=>sort==="asc"?a.name.localeCompare(b.name,"de",{sensitivity:"base"}):b.name.localeCompare(a.name,"de",{sensitivity:"base"})),[rows,sort]);
 const totals=useMemo(()=>rows.reduce((s,r)=>({campaigns:s.campaigns+n(r.campaign_count),running:s.running+n(r.running_campaign_count),active:s.active+n(r.active_campaign_count),revenue:s.revenue+n(r.calculated_revenue)}),{campaigns:0,running:0,active:0,revenue:0}),[rows]);

 async function openCustomer(customer:Customer){
   setSelected(customer);setProfile(emptyProfile);setDetailError("");setDetailMessage("");setDetailLoading(true);
   try{const r=await fetch("/api/admin/customers/"+customer.id,{cache:"no-store"});const data=await r.json();if(!r.ok)throw new Error(data.error||"Kundendaten konnten nicht geladen werden.");setProfile({...emptyProfile,...data.profile});}
   catch(e){setDetailError(e instanceof Error?e.message:"Laden fehlgeschlagen.");}
   finally{setDetailLoading(false);}
 }
 async function saveCustomer(e:React.FormEvent<HTMLFormElement>){
   e.preventDefault();if(!selected)return;setDetailSaving(true);setDetailError("");setDetailMessage("");
   try{const r=await fetch("/api/admin/customers/"+selected.id,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(profile)});const data=await r.json();if(!r.ok)throw new Error(data.error||"Speichern fehlgeschlagen.");setDetailMessage("Kundendaten gespeichert.");await load();}
   catch(e){setDetailError(e instanceof Error?e.message:"Speichern fehlgeschlagen.");}finally{setDetailSaving(false);}
 }
 async function createCustomer(e:React.FormEvent<HTMLFormElement>){
   e.preventDefault();if(!name.trim()){setError("Bitte einen Kundennamen eingeben.");return;}setSaving(true);setError("");
   try{const r=await fetch("/api/admin/customers",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:name.trim()})});const data=await r.json();if(!r.ok)throw new Error(data.error||"Anlegen fehlgeschlagen.");setName("");setShowCreate(false);await load();const created={id:data.id,name:name.trim(),active:1,campaign_count:0,running_campaign_count:0,active_campaign_count:0,calculated_revenue:0};await openCustomer(created);}
   catch(e){setError(e instanceof Error?e.message:"Anlegen fehlgeschlagen.");}finally{setSaving(false);}
 }
 async function deleteCustomer(customer:Customer){
   if(!window.confirm("Kunde „"+customer.name+"“ wirklich löschen? Kunden mit Kampagnen können nicht gelöscht werden."))return;
   setDeleting(customer.id);setError("");
   try{const r=await fetch("/api/admin/customers/"+customer.id,{method:"DELETE"});const data=await r.json();if(!r.ok)throw new Error(data.error||"Löschen fehlgeschlagen.");setRows(v=>v.filter(x=>x.id!==customer.id));if(selected?.id===customer.id)setSelected(null);}
   catch(e){setError(e instanceof Error?e.message:"Löschen fehlgeschlagen.");}finally{setDeleting(null);}
 }
 const field=(label:keyof Profile,title:string,placeholder="")=><label className={styles.field} key={label}><span>{title}</span><input value={profile[label]} placeholder={placeholder} onChange={e=>setProfile(p=>({...p,[label]:e.target.value}))}/></label>;

 return <main className={styles.page}>
  <header className={styles.header}><div><span className={styles.eyebrow}>VERMARKTUNG</span><h1>Kunden</h1><p>Kundenstammdaten, Kampagnen und Werbeumsatz zentral verwalten.</p></div><button className={styles.primary} onClick={()=>{setError("");setShowCreate(true);}}>＋ Kunde anlegen</button></header>
  <section className={styles.kpis}>
   <article className={styles.kpi}><span>Kunden</span><strong>{rows.length}</strong><small>Gesamtbestand</small></article>
   <article className={styles.kpi}><span>Kampagnen</span><strong>{totals.campaigns}</strong><small>Über alle Kunden</small></article>
   <article className={styles.kpi}><span>Aktive Kampagnen</span><strong>{totals.active}</strong><small>{totals.running} im Laufzeitraum</small></article>
   <article className={styles.kpi}><span>Berechneter Werbeumsatz</span><strong>{money(totals.revenue)}</strong><small>Keine Zahlungseingänge</small></article>
  </section>
  <section className={styles.panel}><div className={styles.panelHead}><div><h2>Kundenübersicht</h2><span>{rows.length} Kunden</span></div><button className={styles.sort} onClick={()=>setSort(v=>v==="asc"?"desc":"asc")}>Alphabetisch {sort==="asc"?"A–Z ↑":"Z–A ↓"}</button></div>
   {error&&<p className={styles.error}>{error}</p>}
   {loading?<p className={styles.empty}>Kunden werden geladen …</p>:<div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Kunde</th><th>Kampagnen</th><th>Laufend</th><th>Aktiv</th><th className={styles.money}>Werbeumsatz</th><th></th></tr></thead><tbody>{sorted.map(row=><tr key={row.id} className={styles.customerRow} onClick={()=>void openCustomer(row)}><td><button className={styles.customerLink} onClick={()=>void openCustomer(row)}>{row.name}<span>Details →</span></button></td><td>{n(row.campaign_count)}</td><td>{n(row.running_campaign_count)}</td><td><span className={n(row.active_campaign_count)>0?styles.active:styles.inactive}>{n(row.active_campaign_count)}</span></td><td className={styles.money}>{money(row.calculated_revenue)}</td><td className={styles.actionCell}><button className={styles.trash} title="Kunde löschen" aria-label={"Kunde "+row.name+" löschen"} disabled={deleting===row.id} onClick={e=>{e.stopPropagation();void deleteCustomer(row);}}> {deleting===row.id?"…":"⌫"} </button></td></tr>)}</tbody></table></div>}
   <p className={styles.note}>Werbeumsatz ist eine Berechnung aus ausgelieferten CPM-Impressions und hinterlegten Fixpreisen, keine Buchhaltung oder Zahlungserfassung.</p>
  </section>

  {showCreate&&<div className={styles.backdrop} onMouseDown={e=>{if(e.target===e.currentTarget&&!saving)setShowCreate(false);}}><form className={styles.createModal} onSubmit={createCustomer}><div className={styles.modalHead}><div><span className={styles.eyebrow}>KUNDENVERWALTUNG</span><h2>Neuen Kunden anlegen</h2></div><button type="button" className={styles.close} onClick={()=>setShowCreate(false)}>×</button></div><label className={styles.field}><span>Kundenname</span><input autoFocus value={name} onChange={e=>setName(e.target.value)} placeholder="z. B. Gemeinde Kirchlengern"/></label>{error&&<p className={styles.error}>{error}</p>}<div className={styles.modalActions}><button type="button" className={styles.secondary} onClick={()=>setShowCreate(false)}>Abbrechen</button><button className={styles.primary} disabled={saving}>{saving?"Wird angelegt …":"Kunde anlegen"}</button></div></form></div>}

  {selected&&<div className={styles.backdrop} onMouseDown={e=>{if(e.target===e.currentTarget&&!detailSaving)setSelected(null);}}><section className={styles.detailModal}>
   <header className={styles.detailHeader}><div><span className={styles.eyebrow}>KUNDENAKTE</span><h2>{selected.name}</h2><p>{n(selected.campaign_count)} Kampagnen · {n(selected.active_campaign_count)} aktiv · {money(selected.calculated_revenue)} berechneter Werbeumsatz</p></div><button className={styles.close} onClick={()=>setSelected(null)}>×</button></header>
   {detailLoading?<p className={styles.empty}>Kundendaten werden geladen …</p>:<form onSubmit={saveCustomer} className={styles.detailForm}>
    <section className={styles.formSection}><h3>Unternehmen & Ansprechpartner</h3><div className={styles.formGrid}>{field("legal_name","Firmenname / Rechnungsempfänger")}{field("contact_name","Ansprechpartner")}{field("contact_role","Funktion")}{field("email","E-Mail","kontakt@firma.de")}{field("phone","Telefon")}{field("vat_id","USt-IdNr.")}</div></section>
    <section className={styles.formSection}><h3>Geschäftsanschrift</h3><div className={styles.formGrid}>{field("street","Straße und Hausnummer")}{field("postal_code","PLZ")}{field("city","Ort")}{field("country","Land")}</div></section>
    <section className={styles.formSection}><h3>Rechnungsanschrift</h3><div className={styles.formGrid}>{field("billing_name","Abweichender Rechnungsempfänger")}{field("billing_email","Rechnungs-E-Mail")}{field("billing_street","Straße und Hausnummer")}{field("billing_postal_code","PLZ")}{field("billing_city","Ort")}{field("billing_country","Land")}</div></section>
    <section className={styles.formSection}><h3>Interne Notizen</h3><textarea value={profile.notes} onChange={e=>setProfile(p=>({...p,notes:e.target.value}))} rows={3} placeholder="Interne Hinweise zum Kunden …"/></section>
    {detailError&&<p className={styles.error}>{detailError}</p>}{detailMessage&&<p className={styles.success}>{detailMessage}</p>}
    <div className={styles.modalActions}><button type="button" className={styles.secondary} onClick={()=>setSelected(null)}>Schließen</button><button className={styles.primary} disabled={detailSaving}>{detailSaving?"Speichert …":"Änderungen speichern"}</button></div>
   </form>}
  </section></div>}
 </main>;
}
