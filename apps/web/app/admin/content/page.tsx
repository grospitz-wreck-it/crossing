"use client";
import { useEffect, useMemo, useState } from "react";
import AdminIcon from "../components/AdminIcon";
import ContentTypeIcon from "../../components/ContentTypeIcon";
import styles from "./page.module.css";

type Item = {
  id:string; title:string; summary:string; content_type:string; image_url?:string|null;
  icon:string; accent_color:string; status:string; action_type:string; action_url?:string|null;
  sort_order:number; onboarding_version?:number|null; crossings:string[];
};
type Crossing = {id:string;name:string};
const empty = () => ({title:"",summary:"",contentType:"feature_tip",imageUrl:"",accentColor:"#f32643",status:"draft",actionType:"none",actionUrl:"",sortOrder:0,onboardingVersion:1,crossings:[] as string[]});
const types = [{value:"onboarding",label:"Onboarding"},{value:"feature_tip",label:"Feature-Tipp"},{value:"local_news",label:"Lokale Nachricht"},{value:"event",label:"Veranstaltung"},{value:"partner",label:"Partner"}];
const actions = [{value:"none",label:"Keine Aktion"},{value:"location",label:"Standort öffnen"},{value:"install_help",label:"Installationshilfe"},{value:"open_url",label:"Externe URL öffnen"}];

export default function ContentStudioPage() {
  const [items,setItems]=useState<Item[]>([]);
  const [crossings,setCrossings]=useState<Crossing[]>([]);
  const [form,setForm]=useState(empty());
  const [editing,setEditing]=useState<string|null>(null);
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [uploading,setUploading]=useState(false);
  const [error,setError]=useState("");
  const [filter,setFilter]=useState("all");
  async function load(){
    const [contentRes,crossingRes]=await Promise.all([fetch("/api/admin/content",{cache:"no-store"}),fetch("/api/admin/crossings",{cache:"no-store"})]);
    if(!contentRes.ok) throw new Error("Inhalte konnten nicht geladen werden.");
    setItems(await contentRes.json());
    if(crossingRes.ok) setCrossings(await crossingRes.json());
  }
  useEffect(()=>{load().catch(e=>setError(e.message)).finally(()=>setLoading(false));},[]);
  const visible=useMemo(()=>filter==="all"?items:items.filter(i=>i.status===filter),[items,filter]);
  function edit(item:Item){
    setEditing(item.id);
    setForm({title:item.title,summary:item.summary||"",contentType:item.content_type,imageUrl:item.image_url||"",accentColor:item.accent_color||"#f32643",status:item.status,actionType:item.action_type||"none",actionUrl:item.action_url||"",sortOrder:item.sort_order||0,onboardingVersion:item.onboarding_version||1,crossings:item.crossings||[]});
    setError("");
  }
  function reset(){setEditing(null);setForm(empty());setError("");}
  async function upload(file?:File){
    if(!file)return;
    setUploading(true);setError("");
    try{const data=new FormData();data.append("file",file);const res=await fetch("/api/admin/upload",{method:"POST",body:data});const json=await res.json();if(!res.ok||!json.url)throw new Error(json.error||"Upload fehlgeschlagen.");setForm(v=>({...v,imageUrl:json.url}));}
    catch(e){setError(e instanceof Error?e.message:"Upload fehlgeschlagen.");}
    finally{setUploading(false);}
  }
  async function save(status=form.status){
    setSaving(true);setError("");
    try{
      const payload={...form,status};
      const res=await fetch(editing?"/api/admin/content/"+editing:"/api/admin/content",{method:editing?"PATCH":"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
      const data=await res.json();
      if(!res.ok)throw new Error(data.error||"Speichern fehlgeschlagen.");
      await load();reset();
    }catch(e){setError(e instanceof Error?e.message:"Speichern fehlgeschlagen.");}
    finally{setSaving(false);}
  }
  async function remove(item:Item){
    if(!window.confirm("Inhalt wirklich löschen?"))return;
    const res=await fetch("/api/admin/content/"+item.id,{method:"DELETE"});
    if(!res.ok){setError("Inhalt konnte nicht gelöscht werden.");return;}
    await load();if(editing===item.id)reset();
  }
  const set=(key:string,value:any)=>setForm(v=>({...v,[key]:value}));
  return <div className={styles.page}>
    <div className={styles.heading}>
      <div><div className={styles.eyebrow}>VERMARKTUNG / CONTENT</div><h1>Content-Studio</h1><p>App-Inhalte erstellen, gestalten und gezielt ausspielen.</p></div>
      <button className={styles.primary} onClick={reset}><AdminIcon name="plus" size={16}/> Neuer Inhalt</button>
    </div>
    <div className={styles.stats}>
      <div><span>Alle Inhalte</span><b>{items.length}</b></div>
      <div><span>Veröffentlicht</span><b>{items.filter(i=>i.status==="published").length}</b></div>
      <div><span>Entwürfe</span><b>{items.filter(i=>i.status!=="published").length}</b></div>
    </div>
    <div className={styles.layout}>
      <section className={styles.library}>
        <div className={styles.toolbar}><h2>Inhalte</h2><select value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">Alle Status</option><option value="published">Veröffentlicht</option><option value="draft">Entwürfe</option></select></div>
        {loading?<div className={styles.empty}>Inhalte werden geladen …</div>:visible.length===0?<div className={styles.empty}>Noch keine Inhalte vorhanden. Lege deinen ersten App-Inhalt an.</div>:<div className={styles.items}>{visible.map(item=><article key={item.id} className={styles.item}>
          <div className={styles.itemIcon} style={{background:item.accent_color+"22",color:item.accent_color}}><ContentTypeIcon type={item.content_type} size={20} /></div>
          <div className={styles.itemBody}><div className={styles.itemMeta}><span>{types.find(t=>t.value===item.content_type)?.label||item.content_type}</span><i className={item.status==="published"?styles.live:styles.draft}>{item.status==="published"?"Live":"Entwurf"}</i></div><b>{item.title}</b><p>{item.summary||"Kein Beschreibungstext"}</p><small>{item.crossings?.length?item.crossings.length+" Bahnübergänge":"Alle Bahnübergänge"} · {item.action_type==="none"?"Keine Aktion":actions.find(a=>a.value===item.action_type)?.label}</small></div>
          <div className={styles.itemActions}><button onClick={()=>edit(item)} aria-label="Bearbeiten"><AdminIcon name="pencil"/></button><button onClick={()=>remove(item)} aria-label="Löschen"><AdminIcon name="trash"/></button></div>
        </article>)}</div>}
      </section>
      <aside className={styles.editor}>
        <div className={styles.editorHead}><div><span>{editing?"INHALT BEARBEITEN":"NEUER INHALT"}</span><h2>{editing?"Bearbeiten":"Inhalt gestalten"}</h2></div>{editing&&<button onClick={reset}>Neu</button>}</div>
        <label>Titel<input value={form.title} maxLength={120} onChange={e=>set("title",e.target.value)} placeholder="z. B. So funktioniert meine Schranke"/></label>
        <label>Beschreibung<textarea value={form.summary} maxLength={600} rows={3} onChange={e=>set("summary",e.target.value)} placeholder="Kurzer Text für die Karte …"/></label>
        <label>Inhaltstyp<select value={form.contentType} onChange={e=>set("contentType",e.target.value)}>{types.map(t=><option key={t.value} value={t.value}>{t.label}</option>)}</select><small>Das Symbol wird automatisch passend zum Inhaltstyp gewählt.</small></label>
        <div className={styles.two}>
          <label>Akzentfarbe<div className={styles.color}><input type="color" value={form.accentColor} onChange={e=>set("accentColor",e.target.value)}/><code>{form.accentColor}</code></div></label>
          <label>Reihenfolge<input type="number" min="0" max="9999" value={form.sortOrder} onChange={e=>set("sortOrder",Number(e.target.value))}/></label>
        </div>
        <label>Bild<input type="file" accept="image/*" onChange={e=>upload(e.target.files?.[0])}/><small>{uploading?"Bild wird hochgeladen …":"PNG, JPG oder WebP"}</small></label>
        {form.imageUrl&&<div className={styles.imagePreview}><img src={form.imageUrl} alt="Inhaltsbild"/><button onClick={()=>set("imageUrl","")}>Bild entfernen</button></div>}
        <label>Aktion beim Antippen<select value={form.actionType} onChange={e=>set("actionType",e.target.value)}>{actions.map(a=><option key={a.value} value={a.value}>{a.label}</option>)}</select></label>
        {form.actionType==="open_url"&&<label>Ziel-URL<input type="url" value={form.actionUrl} onChange={e=>set("actionUrl",e.target.value)} placeholder="https://…"/></label>}
        {form.contentType==="onboarding"&&<label>Onboarding-Version<input type="number" min="1" value={form.onboardingVersion} onChange={e=>set("onboardingVersion",Number(e.target.value))}/><small>Eine höhere Version zeigt das Onboarding erneut.</small></label>}
        <label>Ausspielung an Bahnübergängen<select multiple value={form.crossings} onChange={e=>set("crossings",Array.from(e.target.selectedOptions).map(o=>o.value))}><option value="" disabled>Alle Bahnübergänge (keine Auswahl)</option>{crossings.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select><small>Keine Auswahl bedeutet: global ausspielen. Mehrfachauswahl mit Cmd / Strg.</small></label>
        <div className={styles.previewLabel}>LIVE-VORSCHAU</div>
        <div className={styles.preview} style={{borderColor:form.accentColor+"66"}}><div className={styles.previewTop}><span style={{background:form.accentColor+"22",color:form.accentColor}}><ContentTypeIcon type={form.contentType} size={17} /></span><small>{types.find(t=>t.value===form.contentType)?.label}</small></div>{form.imageUrl&&<img src={form.imageUrl} alt=""/>}<b>{form.title||"Dein Titel"}</b><p>{form.summary||"Hier erscheint deine Beschreibung."}</p></div>
        {error&&<div className={styles.error}>{error}</div>}
        <div className={styles.saveActions}><button className={styles.secondary} onClick={()=>save("draft")} disabled={saving||uploading}>Als Entwurf speichern</button><button className={styles.primary} onClick={()=>save("published")} disabled={saving||uploading}>{saving?"Speichert …":"Veröffentlichen"}</button></div>
      </aside>
    </div>
  </div>;
}
