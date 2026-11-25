"use client";

import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import styles from "./page.module.css";
import EditCrossingDrawer from "./EditCrossingDrawer";
import AdminIcon from "../components/AdminIcon";

type Station = { eva: string; stationName: string; role: string; categories: string[]; direction: string; fallbackOffsetSeconds: number; trackDistanceMeters: number };
type Crossing = { id: string; name: string; eva: string; lat: number; lon: number; confidence: number; status: string; source: string; postal_code?: string; city?: string; state?: string; stations?: Station[] };
type NearbyStation = { eva: string; stationName: string; ril100?: string; lat: number; lon: number; city?: string; zipcode?: string; distanceKm: number };
type Point = { lat: number; lon: number };
type RailwayLine = { id: number; routeType: string; ref: string; name: string; from: string; to: string; network?: string; operator?: string };
type RailwayCandidate = { kind: string; routeType: string; ref: string; name: string; from: string; to: string; distanceMeters: number; wayId: number; relationId?: number | null; source: string; waysCount: number; segments: Point[][]; lineRelations?: RailwayLine[] };
type RailwayInfrastructure = { status: string; candidates: RailwayCandidate[]; error?: string };
type StationCandidate = { id?: string; eva: string; stationName: string; ril100?: string; ibnr?: string; lat: number; lon: number; distanceKm: number; trackDistanceMeters: number; source?: string; selectable?: boolean };
type SelectedObservationStation = StationCandidate & { side: "before" | "after" };
type Forecast = { crossing: any; state: string; nextClosure: any; closures: any[]; trains: any[]; stations: any[]; message?: string };

export default function CrossingsAdmin() {
  const [crossings, setCrossings] = useState<Crossing[]>([]);
  const [open, setOpen] = useState(false);
  const [studioStep, setStudioStep] = useState(1);
  const [editingCrossingId, setEditingCrossingId] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState("");
  const [coords, setCoords] = useState("");
  const [location, setLocation] = useState<any>(null);
  const [lookupError, setLookupError] = useState("");
  const [railwayInfrastructure, setRailwayInfrastructure] = useState<RailwayInfrastructure>({ status: "NOT_RUN", candidates: [] });
  const [osmStartedAt, setOsmStartedAt] = useState<number | null>(null);
  const [osmElapsedSeconds, setOsmElapsedSeconds] = useState(0);
  const [selectedRouteKey, setSelectedRouteKey] = useState("");
  const [selectedRouteKeys, setSelectedRouteKeys] = useState<string[]>([]);
  const [selectedRoute, setSelectedRoute] = useState<RailwayCandidate | null>(null);
  const [selectedLineHints, setSelectedLineHints] = useState<string[]>([]);
  const [stationCandidates, setStationCandidates] = useState<StationCandidate[]>([]);
  const [selectedObservationStations, setSelectedObservationStations] = useState<SelectedObservationStation[]>([]);
  const [stationCandidateLoading, setStationCandidateLoading] = useState(false);
  const [stationLoading, setStationLoading] = useState(false);
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [forecastLoading, setForecastLoading] = useState(false);
  const [forecastError, setForecastError] = useState("");
  const [profilePreparing, setProfilePreparing] = useState(false);
  const [profileResult, setProfileResult] = useState("");
  const [profileError, setProfileError] = useState("");
  const lookupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lookupRequest = useRef(0);
  const stationRequest = useRef(0);
  const [form, setForm] = useState({ id: "", name: "", eva: "", lat: "", lon: "", postalCode: "", city: "", state: "", closeOffsetSeconds: "80", openOffsetSeconds: "20", confidence: "0.5", trainSourceMode: "hybrid" });
  const [speedSettings, setSpeedSettings] = useState({ regional: "65", stoppingRegional: "45", intercity: "90", freight: "40", unknown: "50" });

  async function load() { const res = await fetch("/api/admin/crossings", { cache: "no-store" }); if (res.ok) setCrossings(await res.json()); }
  useEffect(() => { void load(); return () => { if (lookupTimer.current) clearTimeout(lookupTimer.current); }; }, []);
  useEffect(() => { if (osmStartedAt === null) return; const tick = () => setOsmElapsedSeconds(Math.floor((Date.now() - osmStartedAt) / 1000)); tick(); const timer = setInterval(tick, 250); return () => clearInterval(timer); }, [osmStartedAt]);
  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) { setForm((f) => ({ ...f, [key]: value })); }
  function looksLikeLocation(value: string) { const input = value.trim(); if (input.length < 8) return false; if (/[-+]?\d{1,3}[.,]\d+\s*[,; ]\s*[-+]?\d{1,3}[.,]\d+/.test(input)) return true; return /^[23456789CFGHJMPQRVWX]{4,7}\+[23456789CFGHJMPQRVWX]{2,7}(?:\s+.+)?$/i.test(input); }
  function resetWizard() { setStudioStep(1); setCoords(""); setLocation(null); setLookupError(""); setRailwayInfrastructure({ status: "NOT_RUN", candidates: [] }); setOsmStartedAt(null); setOsmElapsedSeconds(0); setSelectedRouteKey(""); setSelectedRouteKeys([]); setSelectedRoute(null); setSelectedLineHints([]); setStationCandidates([]); setSelectedObservationStations([]); setStationCandidateLoading(false); setForm({ id: "", name: "", eva: "", lat: "", lon: "", postalCode: "", city: "", state: "", closeOffsetSeconds: "80", openOffsetSeconds: "20", confidence: "0.5", trainSourceMode: "hybrid" }); setSpeedSettings({ regional: "65", stoppingRegional: "45", intercity: "90", freight: "40", unknown: "50" }); }
  async function resolveLocation(value = coords) {
    const input = value.trim(); if (!looksLikeLocation(input)) return;
    const requestId = ++lookupRequest.current; setLookupError(""); setStationLoading(true); setRailwayInfrastructure({ status: "LOADING", candidates: [] }); setSelectedRouteKey(""); setSelectedRouteKeys([]); setSelectedRoute(null);
    try {
      const res = await fetch(`/api/admin/crossings?location=${encodeURIComponent(input)}`, { cache: "no-store" }); const data = await res.json().catch(() => ({}));
      if (requestId !== lookupRequest.current) return;
      if (!res.ok) { setLocation(null); setRailwayInfrastructure({ status: "ERROR", candidates: [] }); setLookupError(data.error || "Standort konnte nicht erkannt werden."); return; }
      const resolvedLocation = data.location || null; setLocation(resolvedLocation); if (!resolvedLocation) return; setOsmElapsedSeconds(0); setOsmStartedAt(Date.now());
      setForm((f) => ({ ...f, lat: String(resolvedLocation.lat), lon: String(resolvedLocation.lon) }));
      try {
        const infraRes = await fetch(`/api/admin/crossings/infrastructure?lat=${encodeURIComponent(resolvedLocation.lat)}&lon=${encodeURIComponent(resolvedLocation.lon)}`, { cache: "no-store" }); const infraData = await infraRes.json().catch(() => ({}));
        if (requestId !== lookupRequest.current) return; const candidates = Array.isArray(infraData?.candidates) ? infraData.candidates : []; setRailwayInfrastructure({ ...(infraData || {}), candidates });
        // Do not silently choose the first OSM candidate; the user must confirm the actual route.
      } catch { if (requestId === lookupRequest.current) setRailwayInfrastructure({ status: "ERROR", candidates: [], error: "OSM-Bahnstrecken konnten nicht geladen werden." }); }
    } catch { if (requestId === lookupRequest.current) { setRailwayInfrastructure({ status: "ERROR", candidates: [] }); setLookupError("Standort konnte nicht geladen werden. Bitte erneut versuchen."); } }
    finally { if (requestId === lookupRequest.current) { setStationLoading(false); setOsmStartedAt(null); } }
  }
  async function loadStationCandidates(candidate: RailwayCandidate, selectedTracks?: RailwayCandidate[]) {
    const requestId = ++stationRequest.current;
    if (!location || (!candidate.relationId && !candidate.wayId)) {
      setStationCandidates([]);
      setSelectedObservationStations([]);
      setStationCandidateLoading(false);
      return;
    }
    setStationCandidateLoading(true);
    setStationCandidates([]);
    setLookupError("");
    const selectedWays = selectedTracks || railwayInfrastructure.candidates.filter((item) => selectedRouteKeys.includes(routeKey(item)));
    const wayIds = (selectedWays.length ? selectedWays : [candidate]).map((item) => item.wayId).filter((id) => Number.isFinite(id) && id > 0);
    const routeParam = `wayIds=${encodeURIComponent(wayIds.join(","))}`;
    const url = `/api/admin/crossings/stations?lat=${encodeURIComponent(location.lat)}&lon=${encodeURIComponent(location.lon)}&${routeParam}`;
    let lastError: unknown = null;
    try {
      // Overpass/Turso can occasionally abort a request under load. Retry twice,
      // but never let an older route selection overwrite the current one.
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (requestId !== stationRequest.current) return;
        try {
          const response = await fetch(url, { cache: "no-store" });
          const data = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(data.error || `DB-Stationen konnten nicht ermittelt werden (${response.status}).`);
          if (requestId !== stationRequest.current) return;
          setStationCandidates(Array.isArray(data.stations) ? data.stations : []);
          setSelectedObservationStations([]);
          return;
        } catch (error) {
          lastError = error;
          const message = error instanceof Error ? error.message : String(error);
          const retryable = /abort|timeout|temporar|network|fetch failed/i.test(message);
          if (!retryable || attempt === 2) throw error;
          await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
        }
      }
    } catch (error) {
      if (requestId !== stationRequest.current) return;
      setStationCandidates([]);
      setSelectedObservationStations([]);
      const message = error instanceof Error ? error.message : String(error || lastError || "");
      setLookupError(/abort|timeout|temporar|network|fetch failed/i.test(message)
        ? "Die Bahnhofssuche wurde vorübergehend unterbrochen. Bitte die Strecke erneut auswählen."
        : message || "DB-Stationen konnten nicht ermittelt werden.");
    } finally {
      if (requestId === stationRequest.current) setStationCandidateLoading(false);
    }
  }
  function setStationSide(station: StationCandidate, side: "before" | "after") {
    setSelectedObservationStations((current) => {
      const existing = current.find((item) => item.eva === station.eva);
      if (existing?.side === side) return current.filter((item) => item.eva !== station.eva);
      return [...current.filter((item) => item.eva !== station.eva), { ...station, side }];
    });
  }
  function selectRouteState(candidate: RailwayCandidate) {
    const key = routeKey(candidate);
    const isSelected = selectedRouteKeys.includes(key);
    const nextKeys = isSelected ? selectedRouteKeys.filter((item) => item !== key) : [...selectedRouteKeys, key];
    const nextCandidates = nextKeys.map((item) => railwayInfrastructure.candidates.find((entry) => routeKey(entry) === item)).filter(Boolean) as RailwayCandidate[];
    setSelectedRouteKeys(nextKeys);
    const primary = nextCandidates[0] || null;
    setSelectedRouteKey(primary ? routeKey(primary) : "");
    setSelectedRoute(primary ? { ...primary, relationId: null, segments: nextCandidates.flatMap((entry) => entry.segments || []).map((segment) => segment.map((point) => ({ ...point }))) } : null);
    if (!primary) { setStationCandidates([]); setSelectedObservationStations([]); return; }
    setSelectedLineHints(
      getLineChips(candidate)
        .map((line) => (line.ref || line.name || "").trim())
        .filter(Boolean)
    );
    void loadStationCandidates(primary, nextCandidates);
  }
  function toggleLineHint(value: string) {
    setSelectedLineHints((current) =>
      current.includes(value) ? current.filter((item) => item !== value) : [...current, value]
    );
  }
  function handleLocationChange(value: string) { setCoords(value); setLookupError(""); if (lookupTimer.current) clearTimeout(lookupTimer.current); if (!looksLikeLocation(value)) return; lookupTimer.current = setTimeout(() => { void resolveLocation(value); }, 650); }
  async function save() {
    if (!location || !form.lat || !form.lon) { setLookupError("Bitte zuerst einen Standort prüfen."); return; }
    if (railwayInfrastructure.candidates.length > 0 && !selectedRouteKeys.length) { setLookupError("Bitte mindestens ein OSM-Gleis aktivieren."); return; }
    setSaving(true); setLookupError("");
    try {
      const route = selectedRoute; const selectedRoutes = railwayInfrastructure.candidates.filter((candidate) => selectedRouteKeys.includes(routeKey(candidate))); const speedValues = Object.values(speedSettings).map(Number); if (speedValues.some((value) => !Number.isFinite(value) || value < 10 || value > 200)) throw new Error("Prognose-Geschwindigkeiten müssen zwischen 10 und 200 km/h liegen."); const payload = { ...form, selectedRoutes, speedSettings: Object.fromEntries(Object.entries(speedSettings).map(([key, value]) => [key, Number(value)])), lat: Number(form.lat), lon: Number(form.lon), closeOffsetSeconds: Number(form.closeOffsetSeconds), openOffsetSeconds: Number(form.openOffsetSeconds), confidence: Number(form.confidence), routeRef: route?.ref || "", routeName: route?.name || "", selectedRouteRef: route?.ref || "", selectedRouteName: route?.name || "", selectedRoute: route ? { ...route, segments: route.segments } : null, lineHints: selectedLineHints, observationStations: selectedObservationStations };
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
    setForecast(null); setForecastError(""); setProfileResult(""); setProfileError(""); setForecastLoading(true); try { const res = await fetch(`/api/admin/crossings/${encodeURIComponent(crossing.id)}/forecast`, { cache: "no-store" }); const data = await res.json().catch(() => ({})); if (!res.ok) throw new Error(data.error || "Prognose konnte nicht geladen werden."); setForecast(data); } catch (e) { setForecastError(e instanceof Error ? e.message : "Prognose konnte nicht geladen werden."); } finally { setForecastLoading(false); }
  }
  async function prepareOsmProfile(crossingId: string) {
    if (!crossingId || profilePreparing) return;
    setProfilePreparing(true); setProfileResult(""); setProfileError("");
    try {
      const res = await fetch(`/api/admin/crossings/${encodeURIComponent(crossingId)}/osm-profile`, { method: "POST", cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `OSM-Profil konnte nicht erstellt werden (${res.status}).`);
      setProfileResult(`Profil v${data.profileVersion} erstellt · ${data.ways} Ways · ${data.nodes} Knoten · ${Math.round(Number(data.bytes || 0) / 1024)} KB`);
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : "OSM-Profil konnte nicht erstellt werden.");
    } finally { setProfilePreparing(false); }
  }
  return <main className={styles.page}>
    <header className={styles.header}><div><div className={styles.eyebrow}>CROSSINGS · ADMIN</div><h1>Bahnübergänge</h1><p>Standorte, automatisch ermittelte DB-Stationen und Prognoseregeln verwalten.</p></div><button className={styles.primary} onClick={() => { resetWizard(); setOpen(true); }}>+ Übergang anlegen</button></header>
    {lookupError && !open && <div className={styles.error}>{lookupError}</div>}
    <section className={styles.tableCard}><div className={styles.tableHead}><span>Übergang</span><span>Position</span><span>Stationen</span><span>Status</span><span></span><span></span></div>{crossings.map((c) => <div className={styles.row} key={c.id} role="button" tabIndex={0} onClick={() => void openForecast(c)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") void openForecast(c); }} style={{ width: "100%", cursor: "pointer" }}><div><strong>{c.name}</strong><small>{[c.postal_code,c.city,c.state].filter(Boolean).join(" · ") || c.id}</small></div><span>{Number(c.lat).toFixed(5)}, {Number(c.lon).toFixed(5)}</span><span>{c.stations?.length ?? 0} automatisch</span><span className={styles.badge}>{c.status}</span><span></span><button type="button" className={styles.editButton} onClick={(e)=>{e.stopPropagation();setEditingCrossingId(c.id);}} aria-label={`${c.name} bearbeiten`}>✎</button><button type="button" className={styles.removeStation} disabled={deletingId === c.id} onClick={(e) => { e.stopPropagation(); void deleteCrossing(c); }}>{deletingId === c.id ? "…" : "×"}</button></div>)}{!crossings.length && <div className={styles.empty}>Noch keine Übergänge in der Datenbank.</div>}</section>
    {forecast && <div className={styles.backdrop} onMouseDown={() => setForecast(null)}><aside className={styles.drawer} onMouseDown={(e) => e.stopPropagation()}><div className={styles.drawerHead}><div><div className={styles.eyebrow}>PROGNOSE</div><h2>{forecast.crossing?.name || "Bahnübergang"}</h2></div><button className={styles.close} onClick={() => setForecast(null)}>×</button></div><div className={styles.content}><div className={styles.location}><strong>{forecast.state === "CLOSED" ? "● GESCHLOSSEN" : "● OFFEN"}</strong><span>{forecast.crossing?.lat?.toFixed?.(6)}, {forecast.crossing?.lon?.toFixed?.(6)}</span></div><section><label>OSM-Streckenprofil</label><div className={styles.nearbyStation}><div style={{ flex: 1 }}><strong>Streckengraph vorbereiten / aktualisieren</strong><span>Einmaliger Admin-Vorgang. Der Live-Status baut den Graphen ausdrücklich nicht selbst auf.</span>{profileResult && <small>{profileResult}</small>}{profileError && <div className={styles.error}>{profileError}</div>}</div><button type="button" className={styles.secondary} disabled={profilePreparing} onClick={() => void prepareOsmProfile(String(forecast.crossing?.id || ""))}>{profilePreparing ? "Profil wird erstellt…" : "Profil neu aufbauen"}</button></div></section>{forecast.message && <div className={styles.emptySmall}>{forecast.message}</div>}{forecast.nextClosure && <section><label>Nächste Schließzeit</label><div className={styles.nearbyStation}><div><strong>{formatTime(forecast.nextClosure.start)} – {formatTime(forecast.nextClosure.end)}</strong><span>{formatRelative(forecast.nextClosure.start)} · {forecast.nextClosure.trains?.length || 0} Zug/Züge</span>{forecast.nextClosure.trains?.length > 0 && <TrainList trains={forecast.nextClosure.trains} />}</div></div></section>}<section><label>Weitere Prognosen</label>{forecast.closures?.length ? <div className={styles.nearbyStations}>{forecast.closures.map((closure: any, index: number) => <div className={styles.nearbyStation} key={`${closure.start}-${index}`}><div><strong>{formatTime(closure.start)} – {formatTime(closure.end)}</strong><span>{closure.trainCount} Zug/Züge · ca. {closure.durationMinutes} Min.</span>{closure.trains?.length > 0 && <TrainList trains={closure.trains} />}</div></div>)}</div> : <div className={styles.emptySmall}>Keine weiteren Schließzeiten im Prognosefenster.</div>}</section><section><label>Datenbasis</label>{forecast.stations?.length ? <div className={styles.nearbyStations}>{forecast.stations.map((station: any) => <div className={styles.nearbyStation} key={station.eva}><div><strong>{station.stationName}</strong><span>EVA {station.eva} · {station.ok ? `${station.count} Fahrplanereignisse` : `Fehler: ${station.error || "unbekannt"}`}</span></div></div>)}</div> : <div className={styles.emptySmall}>Keine DB-Beobachtungsstation verknüpft.</div>}</section></div></aside></div>}
    {forecastLoading && !forecast && <div className={styles.backdrop}><aside className={styles.drawer}><div className={styles.content}><div className={styles.stationLoading}>Prognose wird geladen…</div></div></aside></div>}
    {forecastError && !forecast && <div className={styles.backdrop} onMouseDown={() => setForecastError("")}><aside className={styles.drawer} onMouseDown={(e) => e.stopPropagation()}><div className={styles.drawerHead}><h2>Prognose</h2><button className={styles.close} onClick={() => setForecastError("")}>×</button></div><div className={styles.content}><div className={styles.error}>{forecastError}</div></div></aside></div>}
    {open && <div className={`${styles.backdrop} ${styles.studioBackdrop}`} onMouseDown={() => !saving && setOpen(false)}><aside className={`${styles.drawer} ${styles.studioDrawer}`} onMouseDown={(e) => e.stopPropagation()}>
      <div className={styles.studioHero}><div><div className={styles.eyebrow}>MEINESCHRANKE · BÜ STUDIO</div><h2>Neuen Bahnübergang einrichten</h2><p>Wir bauen deine Prognose Schritt für Schritt auf.</p></div><button className={styles.close} disabled={saving} onClick={() => setOpen(false)} aria-label="Studio schließen"><AdminIcon name="x" size={18}/></button><div className={styles.studioSignal}><span/><span/><span/></div></div>
      <nav className={styles.studioSteps} aria-label="Einrichtungsschritte">{["Standort","Gleise","Daten","Prognose","Check"].map((label,index)=><button type="button" key={label} className={studioStep===index+1?styles.studioStepActive:studioStep>index+1?styles.studioStepDone:styles.studioStep} onClick={()=>setStudioStep(index+1)}><span>{studioStep>index+1?"✓":String(index+1).padStart(2,"0")}</span>{label}</button>)}</nav>
      <div className={styles.studioWorkspace}><div className={styles.studioMain}>
        <div className={styles.studioStepIntro}><span>SCHRITT {String(studioStep).padStart(2,"0")} / 05</span><strong>{["Standort festlegen","Das richtige Gleis finden","Datenquellen verbinden","Prognose feinjustieren","Alles bereit?"][studioStep-1]}</strong><small>{["Wo befindet sich der Bahnübergang?","Wähle ausschließlich Gleise, die den Übergang wirklich queren.","Die passenden Bahnhöfe und Zugdaten bilden das Fundament.","Lege die Ausgangswerte für die Zeitberechnung fest.","Prüfe die Konfiguration vor dem Speichern."][studioStep-1]}</small></div>
        <div className={styles.content}>
          {studioStep===1&&<><section><label>Google Maps / Plus Code</label><div className={styles.inline}><input value={coords} onChange={(e) => handleLocationChange(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void resolveLocation(); } }} placeholder="z. B. 6F25+VRJ Rödinghausen"/><button className={styles.secondary} disabled={stationLoading || saving} onClick={() => void resolveLocation()}>{stationLoading ? "Suche…" : "Standort prüfen"}</button></div><small>Akzeptiert Google-Maps-Plus-Codes und GPS-Koordinaten. Nach der Standortprüfung werden OSM-Bahnstrecken und später automatisch die passenden DB-Stationen und Prognoseregeln bestimmt.</small>{lookupError && <div className={styles.error}>{lookupError}</div>}{location && <div className={styles.location}><strong>Standort erkannt</strong><span>{Number(location.lat).toFixed(6)}, {Number(location.lon).toFixed(6)} · {location.source === "plus-code-recovered" ? "Plus Code aufgelöst" : location.source === "plus-code" ? "Plus Code" : "GPS"}</span></div>}</section><div className={styles.grid}><Field label="Name" value={form.name} onChange={(v) => update("name", v)} placeholder="z. B. Bahnübergang Bruchmühlen"/></div><div className={styles.locationFields}><Field label="Postleitzahl (optional)" value={form.postalCode} onChange={(v)=>update("postalCode",v)} placeholder="z. B. 32278"/><Field label="Ort (optional)" value={form.city} onChange={(v)=>update("city",v)} placeholder="z. B. Kirchlengern"/><Field label="Bundesland (optional)" value={form.state} onChange={(v)=>update("state",v)} placeholder="z. B. Nordrhein-Westfalen"/></div></>}
          {studioStep===2&&<>{location && <section className={styles.routeSection}><div className={styles.routeIntro}><div><label>Konkretes OSM-Gleis auswählen</label><small>Jedes OSM-Gleis (Way-ID) wird einzeln angezeigt. Bitte genau das Gleis auswählen, das den Bahnübergang tatsächlich quert – benachbarte Gleise können zu anderen Strecken gehören.</small></div>{selectedRoute && <span className={styles.routeSelected}>✓ {selectedRoute.ref ? `Strecke ${selectedRoute.ref}` : "Strecke ausgewählt"}</span>}</div><RouteMap lat={Number(location.lat)} lon={Number(location.lon)} candidates={railwayInfrastructure.candidates} selectedKey={selectedRouteKeys.join("|")} onSelect={selectRouteState}/>{selectedRoute && <ObservationStationPicker candidates={stationCandidates} selected={selectedObservationStations} loading={stationCandidateLoading} onSelect={setStationSide}/>} {selectedRoute && getLineChips(selectedRoute).length > 0 && <div className={styles.lineChipSection}>
        <div className={styles.lineChipLabel}>Welche Linien kreuzen hier sicher?</div>
        <small>Die ausgewählten Linien werden für Nachfrage, Snapshot und Prognose als harte Einschränkung verwendet.</small>
        <div className={styles.lineChips}>{getLineChips(selectedRoute).map((line) => {
          const value = (line.ref || line.name || "").trim();
          const checked = selectedLineHints.includes(value);
          return <button type="button" key={line.id} className={styles.lineChip} aria-pressed={checked} onClick={() => toggleLineHint(value)}>
            <span className={styles.lineChipRef}>{checked ? "✓ " : ""}{line.ref || line.name}</span>
            {line.name && line.ref && <span className={styles.lineChipName}>{line.name}</span>}
          </button>;
        })}</div>
        {!selectedLineHints.length && <small>Keine Linie ausgewählt – die vorhandenen Kategorien/Regeln bleiben maßgeblich.</small>}
      </div>}{railwayInfrastructure.status === "LOADING" && <div className={styles.osmLoading} role="status" aria-live="polite"><div className={styles.osmLoadingTop}><span className={styles.osmSpinner}/><div><strong>OSM-Gleisverläufe werden geladen…</strong><small>Overpass-Abfrage läuft · {osmElapsedSeconds} s vergangen</small></div><span className={styles.osmElapsed}>{osmElapsedSeconds}s</span></div><div className={styles.osmProgressTrack}><span/></div><small className={styles.osmLoadingHint}>{osmElapsedSeconds < 4 ? "Verbindung zu den OSM-Datenquellen wird aufgebaut." : osmElapsedSeconds < 12 ? "Gleisgeometrien werden gesucht und übertragen." : osmElapsedSeconds < 18 ? "Die Anfrage dauert länger als üblich – die Datenquelle antwortet noch." : "Warte auf die OSM-Antwort. Bei Zeitüberschreitung wird automatisch ein Fehler angezeigt."}</small></div>}{railwayInfrastructure.status !== "LOADING" && railwayInfrastructure.candidates.length === 0 && <div className={styles.emptySmall}>{railwayInfrastructure.error || "Keine OSM-Bahnstrecke im Suchradius gefunden."}</div>}<div className={styles.infrastructureHead}><div><strong>{selectedRouteKeys.length} von {railwayInfrastructure.candidates.length} Gleisen aktiviert</strong><small>Ways können sich überlagern. Prüfe jede OSM-ID einzeln und aktiviere nur die Gleise, die den Übergang tatsächlich queren.</small></div></div><div className={styles.routeList}>{railwayInfrastructure.candidates.map((c) => { const key = routeKey(c); const selected = selectedRouteKeys.includes(key); return <button type="button" key={key} aria-pressed={selected} className={`${styles.routeCard} ${selected ? styles.routeCardSelected : ""}`} onClick={() => selectRouteState(c)}><span className={styles.routeSwatch} /><span className={styles.routeCardText}><strong>{c.ref ? `Strecke ${c.ref}` : "OSM-Gleis"}</strong><small>OSM-Way {c.wayId}{c.name ? ` · ${c.name}` : " · ohne Bezeichnung"}{c.from || c.to ? ` · ${c.from || "?"} → ${c.to || "?"}` : ""}{c.lineRelations?.length ? ` · ${c.lineRelations.map((line) => line.ref || line.name).filter(Boolean).join(", ")}` : " · keine Linienrelation"}{getOverlappingWays(c, railwayInfrastructure.candidates).length ? ` · Überlagerung mit ${getOverlappingWays(c, railwayInfrastructure.candidates).map((entry) => entry.wayId).join(", ")}` : ""}</small></span><span className={styles.routeDistance}>{c.distanceMeters} m</span><span className={styles.routeCheck}>{selected ? "✓ Aktiv" : "＋ Aktivieren"}</span></button>; })}</div></section>}</>}
          {studioStep===3&&<>{location && selectedRoute && <section><label>Automatische Konfiguration</label><div className={styles.nearbyStations}><div className={styles.nearbyStation}><div><strong>DB-Stationen werden automatisch bestimmt</strong><span>Streckennahe Beobachtungsbahnhöfe plus größere Bahnhöfe im Umkreis von bis zu 75 km für ICE/IC-Erkennung.</span></div></div><div className={styles.nearbyStation}><div><strong>Prognoseregeln werden automatisch erzeugt</strong><span>OSM-Streckenrelation, Strecken-Endpunkte, Stationen und Entfernung fließen in requiredRouteStops und throughRules ein.</span></div></div></div></section>}<section className={styles.sourceModeSection}><label>Betriebsart / Datenquelle für diesen Bahnübergang</label><select value={form.trainSourceMode} onChange={(e) => update("trainSourceMode", e.target.value as typeof form.trainSourceMode)}><option value="hybrid">OpenBoards bevorzugt – Mobilithek als Fallback</option><option value="mobilithek">Nur Mobilithek (manueller Fallback-Betrieb)</option><option value="openboards">OpenBoards bevorzugt – Mobilithek als Fallback (Legacy)</option></select><small>OpenBoards wird nur bei passender, gültiger Beobachtung verwendet. Fehlt sie oder ist OpenBoards nicht verfügbar, bleibt Mobilithek aktiv. Bestehende Übergänge behalten zunächst ihre bisherige Einstellung.</small></section></>}
          {studioStep===4&&<><section className={styles.sourceModeSection}><label>Prognose-Geschwindigkeiten (km/h)</label><small>Grundwerte für die OSM-Streckenprognose; später im Bearbeitungsdialog individuell anpassbar.</small><div className={styles.grid}>{([{ key: "regional", label: "RB / RE Durchfahrt" }, { key: "stoppingRegional", label: "RB / RE mit Halt" }, { key: "intercity", label: "ICE / IC / EC" }, { key: "freight", label: "Güterverkehr" }, { key: "unknown", label: "Unbekannt" }] as const).map((item) => <Field key={item.key} label={item.label} value={speedSettings[item.key]} onChange={(value) => setSpeedSettings((current) => ({ ...current, [item.key]: value }))} />)}</div></section><div className={styles.grid}><Field label="Schließ-Offset (Sek.)" value={form.closeOffsetSeconds} onChange={(v) => update("closeOffsetSeconds", v)} /><Field label="Öffnungs-Offset (Sek.)" value={form.openOffsetSeconds} onChange={(v) => update("openOffsetSeconds", v)} /><Field label="Konfidenz" value={form.confidence} onChange={(v) => update("confidence", v)} /></div></>}
          {studioStep===5&&<div className={styles.studioReview}><div className={styles.reviewSignal}><span>✓</span><div><strong>Fast geschafft!</strong><small>Deine Konfiguration wird vor dem Speichern noch einmal geprüft.</small></div></div><div className={styles.reviewGrid}><div><small>NAME</small><strong>{form.name||"Noch nicht benannt"}</strong></div><div><small>STANDORT</small><strong>{location?`${Number(location.lat).toFixed(5)}, ${Number(location.lon).toFixed(5)}`:"Nicht erkannt"}</strong></div><div><small>OSM-GLEISE</small><strong>{selectedRouteKeys.length} ausgewählt</strong></div><div><small>DB-BEOBACHTUNGEN</small><strong>{selectedObservationStations.length} ausgewählt</strong></div><div><small>DATENQUELLE</small><strong>{form.trainSourceMode==="hybrid"?"OpenBoards + Mobilithek":form.trainSourceMode==="mobilithek"?"Mobilithek":"OpenBoards + Mobilithek"}</strong></div><div><small>ZEIT-OFFSETS</small><strong>{form.closeOffsetSeconds}s / {form.openOffsetSeconds}s</strong></div></div>{lookupError&&<div className={styles.error}>{lookupError}</div>}</div>}
        </div>
      </div><aside className={styles.studioAside}><div className={styles.asideTop}><span>LIVE-CHECK</span><i className={location?"online":""}/></div><div className={styles.asideStatus}>{location?"Standort erkannt":"Warte auf Standort"}</div><div className={styles.asideCoords}>{location?`${Number(location.lat).toFixed(6)} / ${Number(location.lon).toFixed(6)}`:"Plus Code oder Koordinaten eingeben"}</div><div className={styles.asideDivider}/><div className={styles.asideMetric}><span>OSM-Gleise</span><strong>{selectedRouteKeys.length}<small> / {railwayInfrastructure.candidates.length}</small></strong></div><div className={styles.asideMetric}><span>DB-Stationen</span><strong>{selectedObservationStations.length}</strong></div><div className={styles.asideDivider}/><div className={styles.asideTip}><span>✦ GUT ZU WISSEN</span><p>Wähle lieber ein Gleis zu wenig als ein benachbartes Gleis zu viel. Die physische Zuordnung ist entscheidend für verlässliche Prognosen.</p></div><div className={styles.asideTrack}><span/><span/><span/><span/><b>●</b></div></aside></div>
      <footer className={styles.studioFooter}><button className={styles.cancel} disabled={saving} onClick={()=>studioStep===1?setOpen(false):setStudioStep(v=>Math.max(1,v-1))}>{studioStep===1?"Abbrechen":"Zurück"}</button>{studioStep<5?<button className={styles.primary} disabled={saving||(studioStep===1&&!location)||(studioStep===2&&railwayInfrastructure.candidates.length>0&&!selectedRouteKeys.length)||(studioStep===3&&railwayInfrastructure.candidates.length>0&&!selectedRoute)} onClick={()=>setStudioStep(v=>Math.min(5,v+1))}>Weiter <AdminIcon name="arrow-right" size={16}/></button>:<button className={styles.primary} disabled={saving||!location||(railwayInfrastructure.candidates.length>0&&!selectedRouteKeys.length)} onClick={()=>void save()}>{saving?"Speichere…":<>Bahnübergang speichern <AdminIcon name="check" size={16}/></>}</button>}</footer>
    </aside></div>}
    {editingCrossingId&&<EditCrossingDrawer crossingId={editingCrossingId} onClose={()=>setEditingCrossingId("")} onSaved={()=>{setEditingCrossingId("");void load();}}/>}
  </main>;
}

function ObservationStationPicker({ candidates, selected, loading, onSelect }: { candidates: StationCandidate[]; selected: SelectedObservationStation[]; loading: boolean; onSelect: (station: StationCandidate, side: "before" | "after") => void }) {
  return <div style={{ marginTop: 18 }}>
    <div className={styles.lineChipLabel}>Welche Stationen bilden die Grundanalyse?</div>
    <small>Wähle relevante Bahnhöfe und Haltepunkte unmittelbar vor und nach dem Übergang. Die technische Zuordnung erfolgt im Hintergrund.</small>
    {loading && <div className={styles.emptySmall}>Bahnhöfe und Haltepunkte werden ermittelt…</div>}
    {!loading && candidates.length === 0 && <div className={styles.emptySmall}>Keine streckennahen Bahnhöfe oder Haltepunkte gefunden.</div>}
    {!loading && candidates.length > 0 && <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
      {candidates.map((station) => {
        const current = selected.find((item) => item.eva === station.eva);
        return <div key={station.eva || station.id || station.stationName} className={styles.nearbyStation}>
          <div style={{ flex: 1 }}>
            <strong>{station.stationName}</strong>
            <span>{station.source === "osm" ? "OSM-Halt · DB-Zuordnung noch offen" : `${station.distanceKm.toFixed(1)} km vom BÜ · ${Math.round(station.trackDistanceMeters)} m zur Strecke`}</span>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button type="button" disabled={station.selectable === false} title={station.selectable === false ? "Noch keine eindeutige DB-Zuordnung vorhanden" : undefined} className={styles.secondary} aria-pressed={current?.side === "before"} onClick={() => onSelect(station, "before")}>{current?.side === "before" ? "✓ " : ""}Vorher</button>
            <button type="button" disabled={station.selectable === false} title={station.selectable === false ? "Noch keine eindeutige DB-Zuordnung vorhanden" : undefined} className={styles.secondary} aria-pressed={current?.side === "after"} onClick={() => onSelect(station, "after")}>{current?.side === "after" ? "✓ " : ""}Nachher</button>
          </div>
        </div>;
      })}
    </div>}
    {selected.length > 0 && <small style={{ display: "block", marginTop: 8 }}>Grundanalyse: {selected.map((station) => `${station.stationName} (${station.side === "before" ? "vorher" : "nachher"})`).join(" · ")}</small>}
  </div>;
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
function routeKey(candidate: RailwayCandidate) { return `${candidate.routeType}:way:${candidate.wayId}`; }
function getOverlappingWays(candidate: RailwayCandidate, candidates: RailwayCandidate[]) {
  const points = (candidate.segments || []).flat();
  return candidates.filter((other) => {
    if (other.wayId === candidate.wayId) return false;
    const otherSegments = other.segments || [];
    for (const point of points) for (const segment of otherSegments) for (let i = 1; i < segment.length; i++) {
      const a = segment[i - 1], b = segment[i];
      const scale = 111320, x = (point.lon - a.lon) * scale * Math.cos(point.lat * Math.PI / 180), y = (point.lat - a.lat) * scale;
      const bx = (b.lon - a.lon) * scale * Math.cos(point.lat * Math.PI / 180), by = (b.lat - a.lat) * scale, denominator = bx * bx + by * by;
      const t = Math.max(0, Math.min(1, denominator ? (x * bx + y * by) / denominator : 0));
      if (Math.hypot(x - bx * t, y - by * t) <= 1.5) return true;
    }
    return false;
  });
}
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
function RouteMap({ lat, lon, candidates, selectedKey, onSelect }: { lat: number; lon: number; candidates: RailwayCandidate[]; selectedKey: string; onSelect: (candidate: RailwayCandidate) => void }) {
  const [zoom, setZoom] = useState(15);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [size, setSize] = useState({ width: 620, height: 340 });
  const mapRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointerId: number; x: number; y: number; panX: number; panY: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  useEffect(() => {
    const element = mapRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setSize({ width, height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const width = size.width, height = size.height;
  const center = mercator(lat, lon, zoom);
  const originX = center.x * 256 - width / 2 - pan.x;
  const originY = center.y * 256 - height / 2 - pan.y;
  const tileX = Math.floor(originX / 256), tileY = Math.floor(originY / 256);
  const minX = tileX, maxX = Math.floor((originX + width) / 256);
  const minY = tileY, maxY = Math.floor((originY + height) / 256);
  const tiles = [];
  for (let x = minX; x <= maxX; x++) for (let y = minY; y <= maxY; y++) tiles.push({ x, y });
  const project = (point: Point) => { const p = mercator(point.lat, point.lon, zoom); return { x: p.x * 256 - originX, y: p.y * 256 - originY }; };
  const marker = project({ lat, lon });
  const colors = ["#c1121f", "#0f172a", "#2563eb", "#7c3aed", "#059669", "#ea580c", "#0891b2", "#be185d"];
  function beginPan(event: ReactPointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest("button")) return;
    drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y, moved: false };
  }
  function movePan(event: ReactPointerEvent<HTMLDivElement>) {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const dx = event.clientX - active.x, dy = event.clientY - active.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) active.moved = true;
    if (active.moved) setPan({ x: active.panX + dx, y: active.panY + dy });
  }
  function endPan(event: ReactPointerEvent<HTMLDivElement>) {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    suppressClick.current = drag.current.moved;
    drag.current = null;
  }
  function choose(candidate: RailwayCandidate) {
    if (suppressClick.current) { suppressClick.current = false; return; }
    onSelect(candidate);
  }
  return <div ref={mapRef} className={styles.routeMap} onPointerDown={beginPan} onPointerMove={movePan} onPointerUp={endPan} onPointerCancel={endPan} onPointerLeave={() => { if (drag.current?.moved) drag.current = null; }} onClickCapture={(event) => { if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false; } }}>
    <div className={styles.mapTiles}>{tiles.map(({ x, y }) => <img key={`${zoom}/${x}/${y}`} src={`https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`} alt="" draggable={false} style={{ left: x * 256 - originX, top: y * 256 - originY }} />)}</div>
    <svg className={styles.routeOverlay} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-label="Bahnstrecken-Auswahlkarte">
      {candidates.map((candidate, index) => { const key = routeKey(candidate), selected = selectedKey.split("|").includes(key), color = colors[index % colors.length]; return <g key={key} onClick={() => choose(candidate)} className={styles.routeHitArea}>{candidate.segments.map((segment, segmentIndex) => { const points = segment.map(project).map((point) => `${point.x},${point.y}`).join(" "); return <g key={`${key}-${segmentIndex}`}><polyline points={points} fill="none" stroke="#fff" strokeWidth={selected ? 10 : 8} strokeLinecap="round" strokeLinejoin="round" opacity=".96"/><polyline points={points} fill="none" stroke={color} strokeWidth={selected ? 6 : 4} strokeLinecap="round" strokeLinejoin="round" opacity={selected ? 1 : .82}/></g>;})}</g>; })}
      <circle cx={marker.x} cy={marker.y} r="9" fill="#c1121f" stroke="#fff" strokeWidth="4"/><circle cx={marker.x} cy={marker.y} r="3" fill="#fff"/>
    </svg>
    <div style={{ position: "absolute", right: 10, top: 10, zIndex: 5, display: "grid", gap: 4 }}>
      <button type="button" aria-label="Karte vergrößern" onClick={() => setZoom((value) => Math.min(19, value + 1))}>+</button>
      <button type="button" aria-label="Karte verkleinern" onClick={() => setZoom((value) => Math.max(9, value - 1))}>−</button>
      <button type="button" aria-label="Ausschnitt zentrieren" onClick={() => setPan({ x: 0, y: 0 })}>⌖</button>
    </div>
    <div className={styles.mapLegend}><span>📍 Übergang</span>{candidates.slice(0, 4).map((candidate, index) => <button type="button" key={routeKey(candidate)} onClick={() => onSelect(candidate)}><i style={{ background: colors[index % colors.length] }} />{candidate.ref ? `Strecke ${candidate.ref}` : "Gleis"}</button>)}</div>
    <div className={styles.mapAttribution}>© OpenStreetMap · Ziehen zum Verschieben</div>
  </div>;
}
function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) { return <label className={styles.field}><span>{label}</span><input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}/></label>; }
