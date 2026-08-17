"use client";

import { useEffect, useState } from "react";
import styles from "./page.module.css";

type Station = { eva: string; stationName: string; role: string; categories: string[]; direction: string; fallbackOffsetSeconds: number; trackDistanceMeters: number };
type Crossing = { id: string; name: string; eva: string; lat: number; lon: number; confidence: number; status: string; source: string; stations?: Station[] };

const emptyStation = (): Station => ({ eva: "", stationName: "", role: "observation", categories: ["RB", "RE", "IC", "ICE"], direction: "unknown", fallbackOffsetSeconds: 0, trackDistanceMeters: 0 });

export default function CrossingsAdmin() {
  const [crossings, setCrossings] = useState<Crossing[]>([]);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [coords, setCoords] = useState("");
  const [nearest, setNearest] = useState<any[]>([]);
  const [form, setForm] = useState({ id: "", name: "", eva: "", lat: "", lon: "", closeOffsetSeconds: "80", openOffsetSeconds: "20", confidence: "0.5", requiredRouteStops: "", stations: [emptyStation()] as Station[] });

  async function load() {
    const res = await fetch("/api/admin/crossings", { cache: "no-store" });
    if (res.ok) setCrossings(await res.json());
  }
  useEffect(() => { load(); }, []);

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) { setForm((f) => ({ ...f, [key]: value })); }
  function updateStation(index: number, patch: Partial<Station>) { setForm((f) => ({ ...f, stations: f.stations.map((s, i) => i === index ? { ...s, ...patch } : s) })); }

  async function findNearest() {
    if (!coords.trim()) return;
    const res = await fetch(`/api/admin/crossings?coordinates=${encodeURIComponent(coords)}`);
    const data = await res.json();
    setNearest(data.nearest || []);
    const first = data.nearest?.[0];
    if (first) setForm((f) => ({ ...f, lat: String(first.lat), lon: String(first.lon) }));
  }

  async function save() {
    setSaving(true);
    try {
      const payload = { ...form, lat: Number(form.lat), lon: Number(form.lon), closeOffsetSeconds: Number(form.closeOffsetSeconds), openOffsetSeconds: Number(form.openOffsetSeconds), confidence: Number(form.confidence), requiredRouteStops: form.requiredRouteStops.split("\n").map((x) => x.trim()).filter(Boolean), stations: form.stations.filter((s) => s.eva.trim()) };
      const res = await fetch("/api/admin/crossings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      if (!res.ok) { const data = await res.json(); throw new Error(data.error || "Speichern fehlgeschlagen"); }
      await load(); setOpen(false); setNearest([]); setCoords("");
    } catch (e) { alert(e instanceof Error ? e.message : "Speichern fehlgeschlagen"); } finally { setSaving(false); }
  }

  return <main className={styles.page}>
    <header className={styles.header}><div><div className={styles.eyebrow}>CROSSINGS · ADMIN</div><h1>Bahnübergänge</h1><p>Infrastruktur, EVAs und Beobachtungsbahnhöfe zentral verwalten.</p></div><button className={styles.primary} onClick={() => setOpen(true)}>+ Übergang anlegen</button></header>
    <section className={styles.tableCard}><div className={styles.tableHead}><span>Übergang</span><span>EVA</span><span>Position</span><span>Stationen</span><span>Status</span></div>
      {crossings.map((c) => <div className={styles.row} key={c.id}><div><strong>{c.name}</strong><small>{c.id}</small></div><code>{c.eva}</code><span>{Number(c.lat).toFixed(5)}, {Number(c.lon).toFixed(5)}</span><span>{c.stations?.length ?? 0} verknüpft</span><span className={styles.badge}>{c.status}</span></div>)}
      {!crossings.length && <div className={styles.empty}>Noch keine Übergänge in der Datenbank.</div>}
    </section>

    {open && <div className={styles.backdrop} onMouseDown={() => setOpen(false)}><aside className={styles.drawer} onMouseDown={(e) => e.stopPropagation()}>
      <div className={styles.drawerHead}><div><div className={styles.eyebrow}>NEUER DATENSATZ</div><h2>Übergang einrichten</h2></div><button className={styles.close} onClick={() => setOpen(false)}>×</button></div>
      <div className={styles.steps}><span className={styles.active}>01 Standort</span><span>02 EVAs</span><span>03 Prognose</span></div>
      <div className={styles.content}>
        <section><label>Google-Maps-Koordinaten</label><div className={styles.inline}><input value={coords} onChange={(e) => setCoords(e.target.value)} placeholder="z. B. 52.196944, 8.642139"/><button className={styles.secondary} onClick={findNearest}>Übergang suchen</button></div><small>Koordinaten können direkt aus Google Maps übernommen werden. Der Wizard sucht zunächst den nächstgelegenen bekannten Übergang.</small>{nearest.length > 0 && <div className={styles.matches}>{nearest.map((n) => <button key={n.id} onClick={() => update("name", String(n.name))}><strong>{n.name}</strong><span>{n.distanceKm.toFixed(2)} km · EVA {n.eva}</span></button>)}</div>}</section>
        <div className={styles.grid}><Field label="Name" value={form.name} onChange={(v) => update("name", v)} placeholder="z. B. Kirchlengern"/><Field label="EVA des Übergangs" value={form.eva} onChange={(v) => update("eva", v)} placeholder="8003288"/><Field label="Breitengrad" value={form.lat} onChange={(v) => update("lat", v)} placeholder="52.196944"/><Field label="Längengrad" value={form.lon} onChange={(v) => update("lon", v)} placeholder="8.642139"/></div>
        <section><label>Angrenzende / beobachtete Bahnhöfe</label><small>Diese EVAs bilden später die Beobachtungsbasis für die DB-Fahrplananalyse.</small>{form.stations.map((s, i) => <div className={styles.station} key={i}><input value={s.eva} onChange={(e) => updateStation(i, { eva: e.target.value })} placeholder="EVA"/><input value={s.stationName} onChange={(e) => updateStation(i, { stationName: e.target.value })} placeholder="Bahnhof"/><select value={s.role} onChange={(e) => updateStation(i, { role: e.target.value })}><option value="primary">Primär</option><option value="observation">Beobachtung</option><option value="anchor">Anker</option></select><select value={s.direction} onChange={(e) => updateStation(i, { direction: e.target.value })}><option value="unknown">Richtung offen</option><option value="eastbound">Ostwärts</option><option value="westbound">Westwärts</option></select></div>)}<button className={styles.add} onClick={() => update("stations", [...form.stations, emptyStation()])}>+ Bahnhof hinzufügen</button></section>
        <section><label>Fahrweg / relevante Halte</label><textarea value={form.requiredRouteStops} onChange={(e) => update("requiredRouteStops", e.target.value)} placeholder={'Osnabrück Hbf\nBünde (Westf)\nHannover Hbf'} /></section>
        <div className={styles.grid}><Field label="Schließ-Offset (Sek.)" value={form.closeOffsetSeconds} onChange={(v) => update("closeOffsetSeconds", v)} /><Field label="Öffnungs-Offset (Sek.)" value={form.openOffsetSeconds} onChange={(v) => update("openOffsetSeconds", v)} /><Field label="Konfidenz" value={form.confidence} onChange={(v) => update("confidence", v)} /></div>
        <div className={styles.future}><strong>DB-Fahrplananalyse</strong><span>Im nächsten Schritt werden aus den hinterlegten EVAs die relevanten Zugverbindungen über die DB-Timetable-API ermittelt und für den Übergang modelliert.</span></div>
      </div>
      <footer className={styles.footer}><button className={styles.cancel} onClick={() => setOpen(false)}>Abbrechen</button><button className={styles.primary} disabled={saving} onClick={save}>{saving ? "Speichere…" : "Übergang speichern"}</button></footer>
    </aside></div>}
  </main>;
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) { return <label className={styles.field}><span>{label}</span><input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}/></label>; }
