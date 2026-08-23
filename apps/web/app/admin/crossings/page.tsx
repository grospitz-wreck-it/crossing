"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./page.module.css";

type Station = { eva: string; stationName: string; role: string; categories: string[]; direction: string; fallbackOffsetSeconds: number; trackDistanceMeters: number };
type Crossing = { id: string; name: string; eva: string; lat: number; lon: number; confidence: number; status: string; source: string; stations?: Station[] };
type NearbyStation = { eva: string; stationName: string; ril100?: string; lat: number; lon: number; city?: string; zipcode?: string; distanceKm: number };
type Point = { lat: number; lon: number };
type RailwayLine = { id: number; routeType: string; ref: string; name: string; from: string; to: string; network?: string; operator?: string };
type RailwayCandidate = { kind: string; routeType: string; ref: string; name: string; from: string; to: string; distanceMeters: number; wayId: number; relationId?: number | null; source: string; waysCount: number; segments: Point[][]; lineRelations?: RailwayLine[] };
type RailwayInfrastructure = { status: string; candidates: RailwayCandidate[]; error?: string };
type Forecast = { crossing: any; state: string; nextClosure: any; closures: any[]; trains: any[]; stations: any[]; message?: string };

export default function CrossingsAdmin() {
  const [crossings, setCrossings] = useState<Crossing[]>([]);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState("");
  const [coords, setCoords] = useState("");
  const [location, setLocation] = useState<any>(null);
  const [lookupError, setLookupError] = useState("");
  const [railwayInfrastructure, setRailwayInfrastructure] = useState<RailwayInfrastructure>({ status: "NOT_RUN", candidates: [] });
  const [selectedRouteKey, setSelectedRouteKey] = useState("");
  const [selectedRoute, setSelectedRoute] = useState<RailwayCandidate | null>(null);
  const [stationLoading, setStationLoading] = useState(false);
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [forecastLoading, setForecastLoading] = useState(false);
  const [forecastError, setForecastError] = useState("");
  const lookupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lookupRequest = useRef(0);
  const [form, setForm] = useState({ id: "", name: "", eva: "", lat: "", lon: "", closeOffsetSeconds: "80", openOffsetSeconds: "20", confidence: "0.5" });

  async function load() { const res = await fetch("/api/admin/crossings", { cache: "no-store" }); if (res.ok) setCrossings(await res.json()); }
  useEffect(() => { void load(); return () => { if (lookupTimer.current) clearTimeout(lookupTimer.current); }; }, []);
  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) { setForm((f) => ({ ...f, [key]: value })); }
  function looksLikeLocation(value: string) { const input = value.trim(); if (input.length < 8) return false; if (/[-+]?\d{1,3}[.,]\d+\s*[,; ]\s*[-+]?\d{1,3}[.,]\d+/.test(input)) return true; return /^[23456789CFGHJMPQRVWX]{4,7}\+[23456789CFGHJMPQRVWX]{2,7}(?:\s+.+)?$/i.test(input); }
  function resetWizard() { setCoords(""); setLocation(null); setLookupError(""); setRailwayInfrastructure({ status: "NOT_RUN", candidates: [] }); setSelectedRouteKey(""); setSelectedRoute(null); setForm({ id: "", name: "", eva: "", lat: "", lon: "", closeOffsetSeconds: "80", openOffsetSeconds: "20", confidence: "0.5" }); }
  async function resolveLocation(value = coords) {
    const input = value.trim(); if (!looksLikeLocation(input)) return;
    const requestId = ++lookupRequest.current; setLookupError(""); setStationLoading(true); setRailwayInfrastructure({ status: "LOADING", candidates: [] }); setSelectedRouteKey(""); setSelectedRoute(null);
    try {
      const res = await fetch(`/api/admin/crossings?location=${encodeURIComponent(input)}`, { cache: "no-store" }); const data = await res.json().catch(() => ({}));
      if (requestId !== lookupRequest.current) return;
      if (!res.ok) { setLocation(null); setRailwayInfrastructure({ status: "ERROR", candidates: [] }); setLookupError(data.error || "Standort konnte nicht erkannt werden."); return; }
      const resolvedLocation = data.location || null; setLocation(resolvedLocation); if (!resolvedLocation) return;
      setForm((f) => ({ ...f, lat: String(resolvedLocation.lat), lon: String(resolvedLocation.lon) }));
      try {
        const infraRes = await fetch(`/api/admin/crossings/infrastructure?lat=${encodeURIComponent(resolvedLocation.lat)}&lon=${encodeURIComponent(resolvedLocation.lon)}`, { cache: "no-store" }); const infraData = await infraRes.json().catch(() => ({}));
        if (requestId !== lookupRequest.current) return; const candidates = Array.isArray(infraData?.candidates) ? infraData.candidates : []; setRailwayInfrastructure({ ...(infraData || {}), candidates });
        const first = candidates[0] || null; if (first) selectRouteState(first);
      } catch { if (requestId === lookupRequest.current) setRailwayInfrastructure({ status: "ERROR", candidates: [], error: "OSM-Bahnstrecken konnten nicht geladen werden." }); }
    } catch { if (requestId === lookupRequest.current) { setRailwayInfrastructure({ status: "ERROR", candidates: [] }); setLookupError("Standort konnte nicht geladen werden. Bitte erneut versuchen."); } }
    finally { if (requestId === lookupRequest.current) setStationLoading(false); }
  }
  function selectRouteState(candidate: RailwayCandidate) { setSelectedRouteKey(routeKey(candidate)); setSelectedRoute({ ...candidate, segments: (candidate.segments || []).map((segment) => segment.map((point) => ({ ...point }))) }); }
  function handleLocationChange(value: string) { setCoords(value); setLookupError(""); if (lookupTimer.current) clearTimeout(lookupTimer.current); if (!looksLikeLocation(value)) return; lookupTimer.current = setTimeout(() => { void resolveLocation(value); }, 650); }
  async function save() {
    if (!location || !form.lat || !form.lon) { setLookupError("Bitte zuerst einen Standort prüfen."); return; }
    if (railwayInfrastructure.candidates.length > 0 && !selectedRoute) { setLookupError("Bitte zuerst eine Bahnstrecke auf der Karte auswählen."); return; }
    setSaving(true); setLookupError("");
    try {
      const route = selectedRoute; const payload = { ...form, lat: Number(form.lat), lon: Number(form.lon), closeOffsetSeconds: Number(form.closeOffsetSeconds), openOffsetSeconds: Number(form.openOffsetSeconds), confidence: Number(form.confidence), routeRef: route?.ref || "", routeName: route?.name || "", selectedRouteRef: route?.ref || "", selectedRouteName: route?.name || "", selectedRoute: route ? { ...route, segments: route.segments } : null };
      const res = await fetch("/api/admin/crossings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }); const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Speichern fehlgeschlagen (${res.status})`);
      const savedId = String(data?.crossing?.id || data?.id || "").trim(); if (!savedId) throw new Error("Der Server hat keinen Datensatz bestätigt.");
      const verify = await fetch("/api/admin/crossings", { cache: "no-store" }); const verifyRows = verify.ok ? await verify.json().catch(() => []) : [];
      const persisted = Array.isArray(verifyRows) && verifyRows.some((row: Crossing) => String(row.id) === savedId);
      if (!persisted) throw new Error("Der Übergang wurde gespeichert, konnte aber anschließend nicht aus der Datenbank bestätigt werden.");
      setCrossings(verifyRows); setOpen(false); resetWizard();
    } catch (e) { setLookupError(e instanceof Error ? e.message : "Speichern fehlgeschlagen"); } finally { setSaving(false); }
  }
  async function deleteCrossing(crossing: Crossing) {
    if (deletingId) return;
    if (!window.confirm(`„${crossing.name}“ wirklich löschen? Dieser Datensatz und seine Verknüpfungen werden entfernt.`)) return;
    setDeletingId(crossing.id); setLookupError("");
    try {
      const res = await fetch(`/api/admin/crossings?id=${encodeURIComponent(crossing.id)}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Löschen fehlgeschlagen.");
      setCrossings((rows) => rows.filter((row) => row.id !== crossing.id));
      if (forecast?.crossing?.id === crossing.id) setForecast(null);
    } catch (e) { setLookupError(e instanceof Error ? e.message : "Löschen fehlgeschlagen."); } finally { setDeletingId(""); }
  }
  async function openForecast(crossing: Crossing) {
    setForecast(null); setForecastError(""); setForecastLoading(true); try { const res = await fetch(`/api/admin/crossings/${encodeURIComponent(crossing.id)}/forecast`, { cache: "no-store" }); const data = await res.json().catch(() => ({})); if (!res.ok) throw new Error(data.error || "Prognose konnte nicht geladen werden."); setForecast(data); } catch (e) { setForecastError(e instanceof Error ? e.message : "Prognose konnte nicht geladen werden."); } finally { setForecastLoading(false); }
  }
  return <main className={styles.page}>
    <header className={styles.header}><div><div className={styles.eyebrow}>CROSSINGS · ADMIN</div><h1>Bahnübergänge</h1><p>Standorte, automatisch ermittelte DB-Stationen und Prognoseregeln verwalten.</p></div><button className={styles.primary} onClick={() => { resetWizard(); setOpen(true); }}>+ Übergang anlegen</button></header>
    {lookupError && !open && <div className={styles.error}>{lookupError}</div>}
    <section className={styles.tableCard}><div className={styles.tableHead}><span>Übergang</span><span>EVA</span><span>Position</span><span>Stationen</span><span>Status</span><span></span></div>{crossings.map((c) => <div className={styles.row} key={c.id} role="button" tabIndex={0} onClick={() => void openForecast(c)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") void openForecast(c); }} style={{ width: "100%", cursor: "pointer" }}><div><strong>{c.name}</strong><small>{c.id}</small></div><code>{c.eva || "—"}</code><span>{Number(c.lat).toFixed(5)}, {Number(c.lon).toFixed(5)}</span><span>{c.stations?.length ?? 0} automatisch</span><span className={styles.badge}>{c.status}</span><button type="button" className={styles.removeStation} disabled={deletingId === c.id} onClick={(e) => { e.stopPropagation(); void deleteCrossing(c); }}>{deletingId === c.id ? "…" : "×"}</button></div>)}{!crossings.length && <div className={styles.empty}>Noch keine Übergänge in der Datenbank.</div>}</section>
    {forecast && <div className={styles.backdrop} onMouseDown={() => setForecast(null)}><aside className={styles.drawer} onMouseDown={(e) => e.stopPropagation()}><div className={styles.drawerHead}><div><div className={styles.eyebrow}>PROGNOSE</div><h2>{forecast.crossing?.name || "Bahnübergang"}</h2></div><button className={styles.close} onClick={() => setForecast(null)}>×</button></div><div className={styles.content}><div className={styles.location}><strong>{forecast.state === "CLOSED" ? "● GESCHLOSSEN" : "● OFFEN"}</strong><span>{forecast.crossing?.lat?.toFixed?.(6)}, {forecast.crossing?.lon?.toFixed?.(6)}</span></div>{forecast.message && <div className={styles.emptySmall}>{forecast.message}</div>}{forecast.nextClosure && <section><label>Nächste Schließzeit</label><div className={styles.nearbyStation}><div><strong>{formatTime(forecast.nextClosure.start)} – {formatTime(forecast.nextClosure.end)}</strong><span>{formatRelative(forecast.nextClosure.start)} · {forecast.nextClosure.trains?.length || 0} Zug/Züge</span>{forecast.nextClosure.trains?.length > 0 && <TrainList trains={forecast.nextClosure.trains} />}</div></div></section>}<section><label>Weitere Prognosen</label>{forecast.closures?.length ? <div className={styles.nearbyStations}>{forecast.closures.map((closure: any, index: number) => <div className={styles.nearbyStation} key={`${closure.start}-${index}`}><div><strong>{formatTime(closure.start)} – {formatTime(closure.end)}</strong><span>{closure.trainCount} Zug/Züge · ca. {closure.durationMinutes} Min.</span>{closure.trains?.length > 0 && <TrainList trains={closure.trains} />}</div></div>)}</div> : <div className={styles.emptySmall}>Keine weiteren Schließzeiten im Prognosefenster.</div>}</section><section><label>Datenbasis</label>{forecast.stations?.length ? <div className={styles.nearbyStations}>{forecast.stations.map((station: any) => <div className={styles.nearbyStation} key={station.eva}><div><strong>{station.stationName}</strong><span>EVA {station.eva} · {station.ok ? `${station.count} Fahrplanereignisse` : `Fehler: ${station.error || "unbekannt"}`}</span></div></div>)}</div> : <div className={styles.emptySmall}>Keine DB-Beobachtungsstation verknüpft.</div>}</section></div></aside></div>}
    {forecastLoading && !forecast && <div className={styles.backdrop}><aside className={styles.drawer}><div className={styles.content}><div className={styles.stationLoading}>Prognose wird geladen…</div></div></aside></div>}
    {forecastError && !forecast && <div className={styles.backdrop} onMouseDown={() => setForecastError("")}><aside className={styles.drawer} onMouseDown={(e) => e.stopPropagation()}><div className={styles.drawerHead}><h2>Prognose</h2><button className={styles.close} onClick={() => setForecastError("")}>×</button></div><div className={styles.content}><div className={styles.error}>{forecastError}</div></div></aside></div>}
    {open && <div className={styles.backdrop} onMouseDown={() => !saving && setOpen(false)}><aside className={styles.drawer} onMouseDown={(e) => e.stopPropagation()}><div className={styles.drawerHead}><div><div className={styles.eyebrow}>NEUER DATENSATZ</div><h2>Übergang einrichten</h2></div><button className={styles.close} disabled={saving} onClick={() => setOpen(false)}>×</button></div><div className={styles.steps}><span className={styles.active}>01 Standort</span><span className={styles.active}>02 Strecke</span><span>03 Automatik &amp; Speichern</span></div><div className={styles.content}>
      <section><label>Google Maps / Plus Code</label><div className={styles.inline}><input value={coords} onChange={(e) => handleLocationChange(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void resolveLocation(); } }} placeholder="z. B. 6F25+VRJ Rödinghausen"/><button className={styles.secondary} disabled={stationLoading || saving} onClick={() => void resolveLocation()}>{stationLoading ? "Suche…" : "Standort prüfen"}</button></div><small>Akzeptiert Google-Maps-Plus-Codes und GPS-Koordinaten. Nach der Standortprüfung werden OSM-Bahnstrecken und später automatisch die passenden DB-Stationen und Prognoseregeln bestimmt.</small>{lookupError && <div className={styles.error}>{lookupError}</div>}{location && <div className={styles.location}><strong>Standort erkannt</strong><span>{Number(location.lat).toFixed(6)}, {Number(location.lon).toFixed(6)} · {location.source === "plus-code-recovered" ? "Plus Code aufgelöst" : location.source === "plus-code" ? "Plus Code" : "GPS"}</span></div>}</section>
      {location && <section className={styles.routeSection}><div className={styles.routeIntro}><div><label>Bahnstrecke auswählen</label><small>Die ausgewählte OSM-Strecke ist die Grundlage für die automatische Stationserkennung und Regelgenerierung.</small></div>{selectedRoute && <span className={styles.routeSelected}>✓ {selectedRoute.ref ? `Strecke ${selectedRoute.ref}` : "Strecke ausgewählt"}</span>}</div><RouteMap lat={Number(location.lat)} lon={Number(location.lon)} candidates={railwayInfrastructure.candidates} selectedKey={selectedRouteKey} onSelect={selectRouteState}/>{railwayInfrastructure.status === "LOADING" && <div className={styles.emptySmall}>Bahnstrecken werden aus OpenStreetMap ermittelt…</div>}{railwayInfrastructure.status !== "LOADING" && railwayInfrastructure.candidates.length === 0 && <div className={styles.emptySmall}>{railwayInfrastructure.error || "Keine OSM-Bahnstrecke im Suchradius gefunden."}</div>}<div className={styles.routeList}>{railwayInfrastructure.candidates.map((c) => { const key = routeKey(c); const selected = key === selectedRouteKey; return <button type="button" key={key} className={`${styles.routeCard} ${selected ? styles.routeCardSelected : ""}`} onClick={() => selectRouteState(c)}><span className={styles.routeSwatch} /><span className={styles.routeCardText}><strong>{c.ref ? `Strecke ${c.ref}` : "Gleis ohne Streckenreferenz"}</strong><small>{c.name || "Keine OSM-Bezeichnung"}{c.from || c.to ? ` · ${c.from || "?"} → ${c.to || "?"}` : ""}</small></span><span className={styles.routeDistance}>{c.distanceMeters} m</span>{selected && <span className={styles.routeCheck}>✓</span>}</button>; })}</div></section>}
      <div className={styles.grid}><Field label="Name" value={form.name} onChange={(v) => update("name", v)} placeholder="z. B. Bahnübergang Bruchmühlen"/><Field label="EVA des Übergangs" value={form.eva} onChange={(v) => update("eva", v)} placeholder="optional"/></div>
      {location && selectedRoute && <section><label>Automatische Konfiguration</label><div className={styles.nearbyStations}><div className={styles.nearbyStation}><div><strong>DB-Stationen werden automatisch bestimmt</strong><span>Streckennahe Beobachtungsbahnhöfe plus größere Bahnhöfe im Umkreis von bis zu 75 km für ICE/IC-Erkennung.</span></div></div><div className={styles.nearbyStation}><div><strong>Prognoseregeln werden automatisch erzeugt</strong><span>OSM-Streckenrelation, Strecken-Endpunkte, Stationen und Entfernung fließen in requiredRouteStops und throughRules ein.</span></div></div></div></section>}
      <div className={styles.grid}><Field label="Schließ-Offset (Sek.)" value={form.closeOffsetSeconds} onChange={(v) => update("closeOffsetSeconds", v)} /><Field label="Öffnungs-Offset (Sek.)" value={form.openOffsetSeconds} onChange={(v) => update("openOffsetSeconds", v)} /><Field label="Konfidenz" value={form.confidence} onChange={(v) => update("confidence", v)} /></div>
    </div><footer className={styles.footer}><button className={styles.cancel} disabled={saving} onClick={() => setOpen(false)}>Abbrechen</button><button className={styles.primary} disabled={saving || !location || (railwayInfrastructure.candidates.length > 0 && !selectedRoute)} onClick={() => void save()}>{saving ? "Speichere…" : "Übergang speichern"}</button></footer></aside></div>}
  </main>;
}

function TrainList({ trains }: { trains: any[] }) {
  return <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
    {trains.map((train: any, index: number) => {
      const line = String(train.line || train.category || "Zug").trim();
      const destination = String(train.destination || "").trim();
      const journeyNumber = String(train.journeyNumber || "").trim();
      const delay = Number(train.delayMinutes || 0);
      return <div key={`${train.id || journeyNumber || line}-${index}`} style={{ display: "flex", alignItems: "baseline", gap: 7, flexWrap: "wrap", fontSize: 12 }}>
        <strong>🚆 {line}{destination ? ` → ${destination}` : ""}</strong>
        {journeyNumber && <span>Fahrt {journeyNumber}</span>}
        {delay !== 0 && <span>{delay > 0 ? `+${delay}` : delay} Min.</span>}
      </div>;
    })}
  </div>;
}

function formatTime(value: string) { try { return new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" }).format(new Date(value)); } catch { return value; } }
function formatRelative(value: string) { const diff = new Date(value).getTime() - Date.now(); if (diff <= 0) return "jetzt"; return `in ${Math.ceil(diff / 60000)} Min.`; }
function routeKey(candidate: RailwayCandidate) { return `${candidate.routeType}:${candidate.relationId || candidate.ref || candidate.wayId}`; }
function getLineChips(candidate: RailwayCandidate) {
  const seen = new Set<string>();
  return (candidate.lineRelations || []).filter((line) => {
    const label = (line.ref || line.name || "").trim();
    if (!label || seen.has(label)) return false;
    seen.add(label);
    return true;
  });
}
function mercator(lat: number, lon: number, zoom: number) { const n = 2 ** zoom; const x = ((lon + 180) / 360) * n; const rad = (lat * Math.PI) / 180; const y = ((1 - Math.asinh(Math.tan(rad)) / Math.PI) / 2) * n; return { x, y }; }
function RouteMap({ lat, lon, candidates, selectedKey, onSelect }: { lat: number; lon: number; candidates: RailwayCandidate[]; selectedKey: string; onSelect: (candidate: RailwayCandidate) => void }) { const width = 620, height = 310, zoom = 15, center = mercator(lat, lon, zoom), tileX = Math.floor(center.x), tileY = Math.floor(center.y), originX = center.x * 256 - width / 2, originY = center.y * 256 - height / 2, colors = ["#c1121f", "#0f172a", "#2563eb", "#7c3aed", "#059669", "#ea580c", "#0891b2", "#be185d"], project = (point: Point) => { const p = mercator(point.lat, point.lon, zoom); return { x: p.x * 256 - originX, y: p.y * 256 - originY }; }, marker = project({ lat, lon }); return <div className={styles.routeMap}><div className={styles.mapTiles}>{[-1, 0, 1, 2].flatMap((dx) => [-1, 0, 1, 2].map((dy) => { const x = tileX + dx, y = tileY + dy; return <img key={`${x}-${y}`} src={`https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`} alt="" draggable={false} style={{ left: `${x * 256 - originX}px`, top: `${y * 256 - originY}px` }} />; }))}</div><svg className={styles.routeOverlay} viewBox={`0 0 ${width} ${height}`} aria-label="Bahnstrecken-Auswahlkarte">{candidates.map((candidate, index) => { const key = routeKey(candidate), selected = key === selectedKey, color = colors[index % colors.length]; return <g key={key} onClick={() => onSelect(candidate)} className={styles.routeHitArea}>{candidate.segments.map((segment, segmentIndex) => { const points = segment.map(project).map((p) => `${p.x},${p.y}`).join(" "); return <polyline key={`${key}-halo-${segmentIndex}`} points={points} fill="none" stroke="#ffffff" strokeWidth={selected ? 10 : 8} strokeLinecap="round" strokeLinejoin="round" opacity={.95}/>; }).concat(candidate.segments.map((segment, segmentIndex) => { const points = segment.map(project).map((p) => `${p.x},${p.y}`).join(" "); return <polyline key={`${key}-line-${segmentIndex}`} points={points} fill="none" stroke={color} strokeWidth={selected ? 6 : 4} strokeLinecap="round" strokeLinejoin="round" opacity={selected ? 1 : .8}/>; }))}</g>; })}<circle cx={marker.x} cy={marker.y} r="9" fill="#c1121f" stroke="#fff" strokeWidth="4"/><circle cx={marker.x} cy={marker.y} r="3" fill="#fff"/></svg><div className={styles.mapLegend}><span>📍 Übergang</span>{candidates.slice(0, 4).map((c, i) => <button type="button" key={routeKey(c)} onClick={() => onSelect(c)}><i style={{ background: colors[i % colors.length] }} />{c.ref ? `Strecke ${c.ref}` : "Gleis"}</button>)}</div></div>; }
function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) { return <label className={styles.field}><span>{label}</span><input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}/></label>; }
