"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./page.module.css";

type Station = { eva: string; stationName: string; role: string; categories: string[]; direction: string; fallbackOffsetSeconds: number; trackDistanceMeters: number };
type Crossing = { id: string; name: string; eva: string; lat: number; lon: number; confidence: number; status: string; source: string; stations?: Station[] };
type NearbyStation = { eva: string; stationName: string; ril100?: string; lat: number; lon: number; city?: string; zipcode?: string; distanceKm: number };
type Point = { lat: number; lon: number };
type RailwayCandidate = { kind: string; routeType: string; ref: string; name: string; from: string; to: string; distanceMeters: number; wayId: number; relationId?: number | null; source: string; waysCount: number; segments: Point[][] };
type RailwayInfrastructure = { status: string; candidates: RailwayCandidate[]; error?: string };

const emptyStation = (): Station => ({ eva: "", stationName: "", role: "observation", categories: ["RB", "RE", "IC", "ICE"], direction: "unknown", fallbackOffsetSeconds: 0, trackDistanceMeters: 0 });

export default function CrossingsAdmin() {
  const [crossings, setCrossings] = useState<Crossing[]>([]);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [coords, setCoords] = useState("");
  const [nearest, setNearest] = useState<any[]>([]);
  const [location, setLocation] = useState<any>(null);
  const [lookupError, setLookupError] = useState("");
  const [nearbyStations, setNearbyStations] = useState<NearbyStation[]>([]);
  const [railwayInfrastructure, setRailwayInfrastructure] = useState<RailwayInfrastructure>({ status: "NOT_RUN", candidates: [] });
  const [selectedRouteKey, setSelectedRouteKey] = useState("");
  const [stationLoading, setStationLoading] = useState(false);
  const lookupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lookupRequest = useRef(0);
  const [form, setForm] = useState({ id: "", name: "", eva: "", lat: "", lon: "", closeOffsetSeconds: "80", openOffsetSeconds: "20", confidence: "0.5", requiredRouteStops: "", stations: [] as Station[] });

  async function load() { const res = await fetch("/api/admin/crossings", { cache: "no-store" }); if (res.ok) setCrossings(await res.json()); }
  useEffect(() => { load(); return () => { if (lookupTimer.current) clearTimeout(lookupTimer.current); }; }, []);
  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) { setForm((f) => ({ ...f, [key]: value })); }
  function updateStation(index: number, patch: Partial<Station>) { setForm((f) => ({ ...f, stations: f.stations.map((s, i) => i === index ? { ...s, ...patch } : s) })); }
  function addNearbyStation(station: NearbyStation) { if (form.stations.some((s) => s.eva === station.eva)) return; update("stations", [...form.stations, { ...emptyStation(), eva: station.eva, stationName: station.stationName, trackDistanceMeters: station.distanceKm * 1000 }]); }
  function removeStation(index: number) { update("stations", form.stations.filter((_, i) => i !== index)); }
  function looksLikeLocation(value: string) { const input = value.trim(); if (input.length < 8) return false; if (/[-+]?\d{1,3}[.,]\d+\s*[,; ]\s*[-+]?\d{1,3}[.,]\d+/.test(input)) return true; return /^[23456789CFGHJMPQRVWX]{4,7}\+[23456789CFGHJMPQRVWX]{2,7}(?:\s+.+)?$/i.test(input); }

  async function resolveLocation(value = coords) {
    const input = value.trim(); if (!looksLikeLocation(input)) return;
    const requestId = ++lookupRequest.current;
    setLookupError(""); setStationLoading(true); setNearbyStations([]); setRailwayInfrastructure({ status: "LOADING", candidates: [] }); setSelectedRouteKey("");
    try {
      const res = await fetch(`/api/admin/crossings?location=${encodeURIComponent(input)}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (requestId !== lookupRequest.current) return;
      if (!res.ok) { setNearest([]); setLocation(null); setRailwayInfrastructure({ status: "ERROR", candidates: [] }); setLookupError(data.error || "Standort konnte nicht erkannt werden."); return; }
      setLocation(data.location || null); setNearest(data.nearest || []); setNearbyStations(data.stations || []);
      if (data.location) setForm((f) => ({ ...f, lat: String(data.location.lat), lon: String(data.location.lon) }));
      if (data.location) {
        try {
          const infraRes = await fetch(`/api/admin/crossings/infrastructure?lat=${encodeURIComponent(data.location.lat)}&lon=${encodeURIComponent(data.location.lon)}`, { cache: "no-store" });
          const infraData = await infraRes.json().catch(() => ({}));
          if (requestId === lookupRequest.current) {
            setRailwayInfrastructure(infraData || { status: "ERROR", candidates: [] });
            const first = Array.isArray(infraData?.candidates) ? infraData.candidates[0] : null;
            if (first) setSelectedRouteKey(routeKey(first));
          }
        } catch { if (requestId === lookupRequest.current) setRailwayInfrastructure({ status: "ERROR", candidates: [] }); }
      }
    } catch { if (requestId === lookupRequest.current) { setRailwayInfrastructure({ status: "ERROR", candidates: [] }); setLookupError("Standort konnte nicht geladen werden. Bitte erneut versuchen."); } }
    finally { if (requestId === lookupRequest.current) setStationLoading(false); }
  }

  function handleLocationChange(value: string) { setCoords(value); setLookupError(""); if (lookupTimer.current) clearTimeout(lookupTimer.current); if (!looksLikeLocation(value)) return; lookupTimer.current = setTimeout(() => { void resolveLocation(value); }, 500); }
  async function save() {
    setSaving(true);
    try {
      const selected = railwayInfrastructure.candidates.find((candidate) => routeKey(candidate) === selectedRouteKey);
      const payload = { ...form, lat: Number(form.lat), lon: Number(form.lon), closeOffsetSeconds: Number(form.closeOffsetSeconds), openOffsetSeconds: Number(form.openOffsetSeconds), confidence: Number(form.confidence), requiredRouteStops: selected ? [selected.ref].filter(Boolean) : [], stations: form.stations.filter((s) => s.eva.trim()) };
      const res = await fetch("/api/admin/crossings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      if (!res.ok) { const data = await res.json(); throw new Error(data.error || "Speichern fehlgeschlagen"); }
      await load(); setOpen(false); setNearest([]); setNearbyStations([]); setRailwayInfrastructure({ status: "NOT_RUN", candidates: [] }); setSelectedRouteKey(""); setLocation(null); setCoords("");
    } catch (e) { alert(e instanceof Error ? e.message : "Speichern fehlgeschlagen"); } finally { setSaving(false); }
  }

  return <main className={styles.page}>
    <header className={styles.header}><div><div className={styles.eyebrow}>CROSSINGS · ADMIN</div><h1>Bahnübergänge</h1><p>Standorte, EVAs und zugehörige DB-Stationen verwalten.</p></div><button className={styles.primary} onClick={() => setOpen(true)}>+ Übergang anlegen</button></header>
    <section className={styles.tableCard}><div className={styles.tableHead}><span>Übergang</span><span>EVA</span><span>Position</span><span>Stationen</span><span>Status</span></div>{crossings.map((c) => <div className={styles.row} key={c.id}><div><strong>{c.name}</strong><small>{c.id}</small></div><code>{c.eva}</code><span>{Number(c.lat).toFixed(5)}, {Number(c.lon).toFixed(5)}</span><span>{c.stations?.length ?? 0} verknüpft</span><span className={styles.badge}>{c.status}</span></div>)}{!crossings.length && <div className={styles.empty}>Noch keine Übergänge in der Datenbank.</div>}</section>
    {open && <div className={styles.backdrop} onMouseDown={() => setOpen(false)}><aside className={styles.drawer} onMouseDown={(e) => e.stopPropagation()}>
      <div className={styles.drawerHead}><div><div className={styles.eyebrow}>NEUER DATENSATZ</div><h2>Übergang einrichten</h2></div><button className={styles.close} onClick={() => setOpen(false)}>×</button></div>
      <div className={styles.steps}><span className={styles.active}>01 Standort</span><span className={styles.active}>02 Strecke &amp; Stationen</span><span>03 Speichern</span></div>
      <div className={styles.content}>
        <section><label>Google Maps / Plus Code</label><div className={styles.inline}><input value={coords} onChange={(e) => handleLocationChange(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void resolveLocation(); } }} onBlur={() => void resolveLocation()} placeholder="z. B. 6F25+VRJ Rödinghausen"/><button className={styles.secondary} disabled={stationLoading} onClick={() => void resolveLocation()}>{stationLoading ? "Suche…" : "Standort prüfen"}</button></div><small>Akzeptiert Google-Maps-Plus-Codes und GPS-Koordinaten. Die Suche startet automatisch, sobald eine gültige Eingabe erkannt wird.</small>{lookupError && <div className={styles.error}>{lookupError}</div>}{location && <div className={styles.location}><strong>Standort erkannt</strong><span>{Number(location.lat).toFixed(6)}, {Number(location.lon).toFixed(6)} · {location.source === "plus-code-recovered" ? "Plus Code aufgelöst" : location.source === "plus-code" ? "Plus Code" : "GPS"}</span></div>}</section>
        {location && <section className={styles.routeSection}><div className={styles.routeIntro}><div><label>Bahnstrecke auswählen</label><small>Klicke eine farbige Strecke auf der Karte oder wähle sie unten. Die Auswahl bestimmt später die relevanten Stationen und Zugverbindungen.</small></div>{selectedRouteKey && <span className={styles.routeSelected}>✓ Strecke ausgewählt</span>}</div><RouteMap lat={Number(location.lat)} lon={Number(location.lon)} candidates={railwayInfrastructure.candidates} selectedKey={selectedRouteKey} onSelect={setSelectedRouteKey}/>{railwayInfrastructure.status === "LOADING" && <div className={styles.emptySmall}>Bahnstrecken werden aus OpenStreetMap ermittelt…</div>}{railwayInfrastructure.status !== "LOADING" && railwayInfrastructure.candidates.length === 0 && <div className={styles.emptySmall}>{railwayInfrastructure.error || "Keine OSM-Bahnstrecke im Suchradius gefunden."}</div>}<div className={styles.routeList}>{railwayInfrastructure.candidates.map((c) => { const key = routeKey(c); const selected = key === selectedRouteKey; return <button type="button" key={key} className={`${styles.routeCard} ${selected ? styles.routeCardSelected : ""}`} onClick={() => setSelectedRouteKey(key)}><span className={styles.routeSwatch} /><span className={styles.routeCardText}><strong>{c.ref ? `Strecke ${c.ref}` : "Gleis ohne Streckenreferenz"}</strong><small>{c.name || "Keine OSM-Bezeichnung"}{c.from || c.to ? ` · ${c.from || "?"} → ${c.to || "?"}` : ""}</small></span><span className={styles.routeDistance}>{c.distanceMeters} m</span>{selected && <span className={styles.routeCheck}>✓</span>}</button>; })}</div></section>}
        <div className={styles.grid}><Field label="Name" value={form.name} onChange={(v) => update("name", v)} placeholder="z. B. Bahnübergang Bruchmühlen"/><Field label="EVA des Übergangs" value={form.eva} onChange={(v) => update("eva", v)} placeholder="EVA / Betriebsstelle"/><Field label="Breitengrad" value={form.lat} onChange={(v) => update("lat", v)} placeholder="wird automatisch gesetzt"/><Field label="Längengrad" value={form.lon} onChange={(v) => update("lon", v)} placeholder="wird automatisch gesetzt"/></div>
        {location && <section><label>DB-Stationen in der Umgebung</label><small>Die Liste bleibt zunächst eine Vorschau. Nach Auswahl der Bahnstrecke werden wir diese Stationen auf den ausgewählten Streckenverlauf einschränken.</small>{stationLoading ? <div className={styles.stationLoading}>DB-Stationen werden gesucht…</div> : nearbyStations.length ? <div className={styles.nearbyStations}>{nearbyStations.map((s) => { const selected = form.stations.some((x) => x.eva === s.eva); return <div className={`${styles.nearbyStation} ${selected ? styles.selected : ""}`} key={s.eva}><div><strong>{s.stationName}</strong><span>EVA {s.eva}{s.ril100 ? ` · ${s.ril100}` : ""} · {s.distanceKm.toFixed(1)} km</span></div><button disabled={selected} className={styles.addStation} onClick={() => addNearbyStation(s)}>{selected ? "✓ übernommen" : "+ übernehmen"}</button></div>; })}</div> : <div className={styles.emptySmall}>Keine DB-Station im Suchradius gefunden.</div>}</section>}
        {form.stations.length > 0 && <section><label>Verknüpfte Stationen</label>{form.stations.map((s, i) => <div className={styles.station} key={s.eva || i}><input value={s.eva} onChange={(e) => updateStation(i, { eva: e.target.value })} placeholder="EVA"/><input value={s.stationName} onChange={(e) => updateStation(i, { stationName: e.target.value })} placeholder="Bahnhof"/><select value={s.role} onChange={(e) => updateStation(i, { role: e.target.value })}><option value="primary">Primär</option><option value="observation">Beobachtung</option><option value="anchor">Anker</option></select><button className={styles.removeStation} onClick={() => removeStation(i)}>×</button></div>)}</section>}
        <div className={styles.grid}><Field label="Schließ-Offset (Sek.)" value={form.closeOffsetSeconds} onChange={(v) => update("closeOffsetSeconds", v)} /><Field label="Öffnungs-Offset (Sek.)" value={form.openOffsetSeconds} onChange={(v) => update("openOffsetSeconds", v)} /><Field label="Konfidenz" value={form.confidence} onChange={(v) => update("confidence", v)} /></div>
      </div>
      <footer className={styles.footer}><button className={styles.cancel} onClick={() => setOpen(false)}>Abbrechen</button><button className={styles.primary} disabled={saving || (!!location && railwayInfrastructure.candidates.length > 0 && !selectedRouteKey)} onClick={save}>{saving ? "Speichere…" : "Übergang speichern"}</button></footer>
    </aside></div>}
  </main>;
}

function routeKey(candidate: RailwayCandidate) { return `${candidate.routeType}:${candidate.relationId || candidate.ref || candidate.wayId}`; }
function mercator(lat: number, lon: number, zoom: number) { const n = 2 ** zoom; const x = ((lon + 180) / 360) * n; const rad = (lat * Math.PI) / 180; const y = ((1 - Math.asinh(Math.tan(rad)) / Math.PI) / 2) * n; return { x, y }; }

function RouteMap({ lat, lon, candidates, selectedKey, onSelect }: { lat: number; lon: number; candidates: RailwayCandidate[]; selectedKey: string; onSelect: (key: string) => void }) {
  const width = 620; const height = 310; const zoom = 15; const center = mercator(lat, lon, zoom); const tileX = Math.floor(center.x); const tileY = Math.floor(center.y); const originX = center.x * 256 - width / 2; const originY = center.y * 256 - height / 2;
  const colors = ["#c1121f", "#0f172a", "#2563eb", "#7c3aed", "#059669", "#ea580c", "#0891b2", "#be185d"];
  const project = (point: Point) => { const p = mercator(point.lat, point.lon, zoom); return { x: p.x * 256 - originX, y: p.y * 256 - originY }; };
  const marker = project({ lat, lon });
  return <div className={styles.routeMap}><div className={styles.mapTiles}>{[-1, 0, 1, 2].flatMap((dx) => [-1, 0, 1, 2].map((dy) => { const x = tileX + dx; const y = tileY + dy; return <img key={`${x}-${y}`} src={`https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`} alt="" draggable={false} style={{ left: `${x * 256 - originX}px`, top: `${y * 256 - originY}px` }} />; }))}</div><svg className={styles.routeOverlay} viewBox={`0 0 ${width} ${height}`} aria-label="Bahnstrecken-Auswahlkarte">{candidates.map((candidate, index) => { const key = routeKey(candidate); const selected = key === selectedKey; const color = colors[index % colors.length]; return <g key={key} onClick={() => onSelect(key)} className={styles.routeHitArea}>{candidate.segments.map((segment, segmentIndex) => { const points = segment.map(project).map((p) => `${p.x},${p.y}`).join(" "); return <polyline key={`${key}-halo-${segmentIndex}`} points={points} fill="none" stroke="#ffffff" strokeWidth={selected ? 10 : 8} strokeLinecap="round" strokeLinejoin="round" opacity={.95}/>; }).concat(candidate.segments.map((segment, segmentIndex) => { const points = segment.map(project).map((p) => `${p.x},${p.y}`).join(" "); return <polyline key={`${key}-line-${segmentIndex}`} points={points} fill="none" stroke={color} strokeWidth={selected ? 6 : 4} strokeLinecap="round" strokeLinejoin="round" opacity={selected ? 1 : .8}/>; }))}</g>; })}<circle cx={marker.x} cy={marker.y} r="9" fill="#c1121f" stroke="#fff" strokeWidth="4"/><circle cx={marker.x} cy={marker.y} r="3" fill="#fff"/></svg><div className={styles.mapLegend}><span>📍 Übergang</span>{candidates.slice(0, 4).map((c, i) => <button type="button" key={routeKey(c)} onClick={() => onSelect(routeKey(c))}><i style={{ background: colors[i % colors.length] }} />{c.ref ? `Strecke ${c.ref}` : "Gleis"}</button>)}</div></div>;
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) { return <label className={styles.field}><span>{label}</span><input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}/></label>; }
