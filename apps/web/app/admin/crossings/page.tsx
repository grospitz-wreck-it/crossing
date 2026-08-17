"use client";

import { useEffect, useState } from "react";
import styles from "./page.module.css";

type Station = { eva: string; stationName: string; role: string; categories: string[]; direction: string; fallbackOffsetSeconds: number; trackDistanceMeters: number };
type Crossing = { id: string; name: string; eva: string; lat: number; lon: number; confidence: number; status: string; source: string; stations?: Station[] };
type NearbyStation = { eva: string; name: string; ril100?: string; lat: number; lon: number; city?: string; zipcode?: string; distanceKm: number };
const emptyStation = (): Station => ({ eva: "", stationName: "", role: "observation", categories: ["RB", "RE", "IC", "ICE"], direction: "unknown", fallbackOffsetSeconds: 0, trackDistanceMeters: 0 });

export default function CrossingsAdmin() {
  const [crossings, setCrossings] = useState<Crossing[]>([]), [open, setOpen] = useState(false), [saving, setSaving] = useState(false), [coords, setCoords] = useState(""), [nearest, setNearest] = useState<any[]>([]), [location, setLocation] = useState<any>(null), [lookupError, setLookupError] = useState(""), [nearbyStations, setNearbyStations] = useState<NearbyStation[]>([]), [stationLoading, setStationLoading] = useState(false);
  const [form, setForm] = useState({ id: "", name: "", eva: "", lat: "", lon: "", closeOffsetSeconds: "80", openOffsetSeconds: "20", confidence: "0.5", requiredRouteStops: "", stations: [] as Station[] });
  async function load() { const res = await fetch("/api/admin/crossings", { cache: "no-store" }); if (res.ok) setCrossings(await res.json()); }
  useEffect(() => { load(); }, []);
  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) { setForm((f) => ({ ...f, [key]: value })); }
  function updateStation(index: number, patch: Partial<Station>) { setForm((f) => ({ ...f, stations: f.stations.map((s, i) => i === index ? { ...s, ...patch } : s) })); }
  function addNearbyStation(station: NearbyStation) { if (form.stations.some((s) => s.eva === station.eva)) return; update("stations", [...form.stations, { ...emptyStation(), eva: station.eva, stationName: station.name, trackDistanceMeters: station.distanceKm * 1000 }]); }
  function removeStation(index: number) { update("stations", form.stations.filter((_, i) => i !== index)); }
  async function findNearest() {
    if (!coords.trim()) return;
    setLookupError(""); setNearbyStations([]);
    const res = await fetch(`/api/admin/crossings?location=${encodeURIComponent(coords.trim())}`), data = await res.json();
    if (!res.ok) { setNearest([]); setLocation(null); setLookupError(data.error || "Standort konnte nicht erkannt werden."); return; }
    setLocation(data.location); setNearest(data.nearest || []);
    if (data.location) {
      setForm((f) => ({ ...f, lat: String(data.location.lat), lon: String(data.location.lon) }));
      setStationLoading(true);
      try {
        const stationRes = await fetch(`/api/admin/stations/nearby?lat=${data.location.lat}&lon=${data.location.lon}&radiusKm=25&limit=12`);
        const stationData = await stationRes.json();
        if (stationRes.ok) setNearbyStations(stationData.stations || []); else setLookupError(stationData.error || "DB-Stationen konnten nicht geladen werden.");
      } finally { setStationLoading(false); }
    }
  }
  async function save() {
    setSaving(true);
    try {
      const payload = { ...form, lat: Number(form.lat), lon: Number(form.lon), closeOffsetSeconds: Number(form.closeOffsetSeconds), openOffsetSeconds: Number(form.openOffsetSeconds), confidence: Number(form.confidence), requiredRouteStops: [], stations: form.stations.filter((s) => s.eva.trim()) };
      const res = await fetch("/api/admin/crossings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      if (!res.ok) { const data = await res.json(); throw new Error(data.error || "Speichern fehlgeschlagen"); }
      await load(); setOpen(false); setNearest([]); setNearbyStations([]); setLocation(null); setCoords("");
    } catch (e) { alert(e instanceof Error ? e.message : "Speichern fehlgeschlagen"); } finally { setSaving(false); }
  }
  return <main className={styles.page}>
    <header className={styles.header}><div><div className={styles.eyebrow}>CROSSINGS · ADMIN</div><h1>Bahnübergänge</h1><p>Standorte, EVAs und zugehörige DB-Stationen verwalten.</p></div><button className={styles.primary} onClick={() => setOpen(true)}>+ Übergang anlegen</button></header>
    <section className={styles.tableCard}><div className={styles.tableHead}><span>Übergang</span><span>EVA</span><span>Position</span><span>Stationen</span><span>Status</span></div>{crossings.map((c) => <div className={styles.row} key={c.id}><div><strong>{c.name}</strong><small>{c.id}</small></div><code>{c.eva}</code><span>{Number(c.lat).toFixed(5)}, {Number(c.lon).toFixed(5)}</span><span>{c.stations?.length ?? 0} verknüpft</span><span className={styles.badge}>{c.status}</span></div>)}{!crossings.length && <div className={styles.empty}>Noch keine Übergänge in der Datenbank.</div>}</section>
    {open && <div className={styles.backdrop} onMouseDown={() => setOpen(false)}><aside className={styles.drawer} onMouseDown={(e) => e.stopPropagation()}>
      <div className={styles.drawerHead}><div><div className={styles.eyebrow}>NEUER DATENSATZ</div><h2>Übergang einrichten</h2></div><button className={styles.close} onClick={() => setOpen(false)}>×</button></div>
      <div className={styles.steps}><span className={styles.active}>01 Standort</span><span className={styles.active}>02 Stationen</span><span>03 Speichern</span></div>
      <div className={styles.content}>
        <section><label>Google Maps / Plus Code</label><div className={styles.inline}><input value={coords} onChange={(e) => setCoords(e.target.value)} placeholder="z. B. 6F25+VRJ Rödinghausen"/><button className={styles.secondary} onClick={findNearest}>Standort prüfen</button></div><small>Akzeptiert Google-Maps-Plus-Codes und GPS-Koordinaten. Danach werden die nächstgelegenen bekannten DB-Stationen aus <strong>db-stations</strong> ermittelt.</small>{lookupError && <div className={styles.error}>{lookupError}</div>}{location && <div className={styles.location}><strong>Standort erkannt</strong><span>{Number(location.lat).toFixed(6)}, {Number(location.lon).toFixed(6)} · {location.source === "plus-code-recovered" ? "Plus Code aufgelöst" : location.source === "plus-code" ? "Plus Code" : "GPS"}</span></div>}</section>
        <div className={styles.grid}><Field label="Name" value={form.name} onChange={(v) => update("name", v)} placeholder="z. B. Bahnübergang Bruchmühlen"/><Field label="EVA des Übergangs" value={form.eva} onChange={(v) => update("eva", v)} placeholder="EVA / Betriebsstelle"/><Field label="Breitengrad" value={form.lat} onChange={(v) => update("lat", v)} placeholder="wird automatisch gesetzt"/><Field label="Längengrad" value={form.lon} onChange={(v) => update("lon", v)} placeholder="wird automatisch gesetzt"/></div>
        {location && <section><label>DB-Stationen in der Umgebung</label><small>Nur Stammdaten: EVA, Name, RIL100 und Position. Echtzeit- und Fahrplandaten werden hier nicht verarbeitet.</small>{stationLoading ? <div className={styles.stationLoading}>DB-Stationen werden gesucht…</div> : nearbyStations.length ? <div className={styles.nearbyStations}>{nearbyStations.map((s) => { const selected = form.stations.some((x) => x.eva === s.eva); return <div className={`${styles.nearbyStation} ${selected ? styles.selected : ""}`} key={s.eva}><div><strong>{s.name}</strong><span>EVA {s.eva}{s.ril100 ? ` · ${s.ril100}` : ""} · {s.distanceKm.toFixed(1)} km</span></div><button disabled={selected} className={styles.addStation} onClick={() => addNearbyStation(s)}>{selected ? "✓ übernommen" : "+ übernehmen"}</button></div>; })}</div> : <div className={styles.emptySmall}>Keine DB-Station im Suchradius gefunden.</div>}</section>}
        {form.stations.length > 0 && <section><label>Verknüpfte Stationen</label>{form.stations.map((s, i) => <div className={styles.station} key={s.eva || i}><input value={s.eva} onChange={(e) => updateStation(i, { eva: e.target.value })} placeholder="EVA"/><input value={s.stationName} onChange={(e) => updateStation(i, { stationName: e.target.value })} placeholder="Bahnhof"/><select value={s.role} onChange={(e) => updateStation(i, { role: e.target.value })}><option value="primary">Primär</option><option value="observation">Beobachtung</option><option value="anchor">Anker</option></select><button className={styles.removeStation} onClick={() => removeStation(i)}>×</button></div>)}</section>}
        <div className={styles.grid}><Field label="Schließ-Offset (Sek.)" value={form.closeOffsetSeconds} onChange={(v) => update("closeOffsetSeconds", v)} /><Field label="Öffnungs-Offset (Sek.)" value={form.openOffsetSeconds} onChange={(v) => update("openOffsetSeconds", v)} /><Field label="Konfidenz" value={form.confidence} onChange={(v) => update("confidence", v)} /></div>
      </div><footer className={styles.footer}><button className={styles.cancel} onClick={() => setOpen(false)}>Abbrechen</button><button className={styles.primary} disabled={saving} onClick={save}>{saving ? "Speichere…" : "Übergang speichern"}</button></footer>
    </aside></div>}
  </main>;
}
function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) { return <label className={styles.field}><span>{label}</span><input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}/></label>; }
