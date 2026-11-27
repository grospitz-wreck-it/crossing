"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import studioStyles from "./page.module.css";
import AdminIcon from "../components/AdminIcon";

type StationLink = { id?: string; eva: string; station_name: string; role: string; categories: string; direction: string; fallback_offset_seconds: number; track_distance_meters: number; lat?: number; lon?: number; };
type NearbyStation = { eva: string; name: string; ril100?: string; lat: number; lon: number; city?: string; distanceKm: number };
type InfrastructureCandidate = { kind: "route" | "track"; ref: string; name: string; wayId: number; routeType?: string; relationId?: number | null; from?: string; to?: string; distanceMeters: number; lineRelations: { id: number; ref: string; name: string; routeType?: string }[]; segments: { lat: number; lon: number }[][] };
type TrackStationCandidate = { id?: string; eva: string; stationName: string; ril100?: string; ibnr?: string; lat: number; lon: number; distanceKm: number; trackDistanceMeters: number; alongTrackDistanceMeters: number; source?: string; selectable?: boolean };
type SelectedTrackStation = TrackStationCandidate & { side: "before" | "after"; trackWayIds: number[]; direction: "eastbound" | "westbound" | "unknown"; enabled: boolean; priority: number };
type Props = { crossingId: string; onClose: () => void; onSaved?: () => void };

const inputStyle: CSSProperties = { width: "100%", boxSizing: "border-box", border: "1px solid #dfe3e8", borderRadius: 10, padding: "11px 12px", font: "inherit", fontSize: 13 };
const labelStyle: CSSProperties = { fontSize: 11, fontWeight: 800, color: "#343c46" };

export default function EditCrossingDrawer({ crossingId, onClose, onSaved }: Props) {
  const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false); const [error, setError] = useState(""); const [editStep, setEditStep] = useState(1);
  const [form, setForm] = useState({ name: "", eva: "", lat: "", lon: "", postalCode: "", city: "", state: "", closeOffsetSeconds: "80", openOffsetSeconds: "20", confidence: "0.5", status: "active", trainSourceMode: "mobilithek" });
  const [routeStops, setRouteStops] = useState<string[]>([]); const [links, setLinks] = useState<StationLink[]>([]);
  const [nearbyStations, setNearbyStations] = useState<NearbyStation[]>([]);
  const [nearbyLoading, setNearbyLoading] = useState(false);
  const [nearbyError, setNearbyError] = useState("");
  const [mapStation, setMapStation] = useState<NearbyStation | null>(null);
  const [infrastructure, setInfrastructure] = useState<InfrastructureCandidate[]>([]);
  const [infrastructureLoading, setInfrastructureLoading] = useState(false);
  const [infrastructureError, setInfrastructureError] = useState("");
  const [selectedWayIds, setSelectedWayIds] = useState<number[]>([]);
  const [selectedLineHints, setSelectedLineHints] = useState<string[]>([]);
  const [crossingRules, setCrossingRules] = useState<Record<string, any>>({});
  const [globalTimingCorrectionSeconds, setGlobalTimingCorrectionSeconds] = useState("0");
  const [crossingTimingOverride, setCrossingTimingOverride] = useState("");
  const [eastboundTimingOverride, setEastboundTimingOverride] = useState("");
  const [westboundTimingOverride, setWestboundTimingOverride] = useState("");
  const [speedSettings, setSpeedSettings] = useState({ regional: "65", intercity: "90", freight: "40", unknown: "50", stoppingRegional: "45" });
  const [timingSettingsLoading, setTimingSettingsLoading] = useState(true);
  const [trackStations, setTrackStations] = useState<TrackStationCandidate[]>([]);
  const [selectedTrackStations, setSelectedTrackStations] = useState<SelectedTrackStation[]>([]);
  const [trackStationsLoading, setTrackStationsLoading] = useState(false);
  const [trackStationsError, setTrackStationsError] = useState("");
  const [profileCalculating, setProfileCalculating] = useState(false);
  const [profileError, setProfileError] = useState("");
  useEffect(() => {
    let alive = true;
    fetch("/api/admin/crossings/timing", { cache: "no-store" })
      .then(async (res) => { const data = await res.json().catch(() => ({})); if (!res.ok) throw new Error(data.error || "Globale Zeitkorrektur konnte nicht geladen werden."); return data; })
      .then((data) => { if (alive) setGlobalTimingCorrectionSeconds(String(data.crossingTimeCorrectionSeconds ?? 0)); })
      .catch((error) => { if (alive) setError(error instanceof Error ? error.message : "Globale Zeitkorrektur konnte nicht geladen werden."); })
      .finally(() => { if (alive) setTimingSettingsLoading(false); });
    return () => { alive = false; };
  }, []);
  useEffect(() => { let alive = true; (async () => { try { const res = await fetch(`/api/admin/crossings/${encodeURIComponent(crossingId)}`, { cache: "no-store" }); const data = await res.json().catch(() => ({})); if (!res.ok) throw new Error(data.error || "Übergang konnte nicht geladen werden."); if (!alive) return; const c = data.crossing || {}; setForm({ name: String(c.name || ""), eva: String(c.eva || ""), lat: String(c.lat ?? ""), lon: String(c.lon ?? ""), postalCode: String(c.postal_code || ""), city: String(c.city || ""), state: String(c.state || ""), closeOffsetSeconds: String(c.close_offset_seconds ?? 80), openOffsetSeconds: String(c.open_offset_seconds ?? 20), confidence: String(c.confidence ?? 0.5), status: String(c.status || "active"), trainSourceMode: ["openboards","mobilithek","hybrid"].includes(String(c.train_source_mode)) ? String(c.train_source_mode) : "mobilithek" }); setRouteStops(Array.isArray(c.requiredRouteStops) ? c.requiredRouteStops : []); setLinks(Array.isArray(data.stationLinks) ? data.stationLinks : []); const savedRules = c.rules && typeof c.rules === "object" && !Array.isArray(c.rules) ? c.rules : {}; setCrossingRules(savedRules); setCrossingTimingOverride(savedRules.timing?.crossingTimeCorrectionSeconds == null ? "" : String(savedRules.timing.crossingTimeCorrectionSeconds)); setEastboundTimingOverride(savedRules.timing?.directionalCrossingTimeCorrectionSeconds?.eastbound == null ? "" : String(savedRules.timing.directionalCrossingTimeCorrectionSeconds.eastbound)); setWestboundTimingOverride(savedRules.timing?.directionalCrossingTimeCorrectionSeconds?.westbound == null ? "" : String(savedRules.timing.directionalCrossingTimeCorrectionSeconds.westbound)); setSpeedSettings({ regional: String(savedRules.timing?.speedKmh?.regional ?? 65), intercity: String(savedRules.timing?.speedKmh?.intercity ?? 90), freight: String(savedRules.timing?.speedKmh?.freight ?? 40), unknown: String(savedRules.timing?.speedKmh?.unknown ?? 50), stoppingRegional: String(savedRules.timing?.speedKmh?.stoppingRegional ?? 45) }); setSelectedWayIds(Array.isArray(savedRules.selectedOsmTracks) ? savedRules.selectedOsmTracks.map((track: any) => Number(track.wayId)).filter((id: number) => Number.isFinite(id) && id > 0) : []); setSelectedLineHints(Array.isArray(savedRules.lineHints) ? savedRules.lineHints.map(String) : []); setSelectedTrackStations(Array.isArray(savedRules.observationStations) ? savedRules.observationStations.filter((station: any) => station && station.eva && (station.side === "before" || station.side === "after")).map((station: any) => ({ ...station, alongTrackDistanceMeters: Number(station.trackDistanceMeters || station.alongTrackDistanceMeters || 0), trackWayIds: Array.isArray(station.trackWayIds) ? station.trackWayIds.map(Number) : [], direction: station.direction || "unknown", enabled: station.enabled !== false, priority: Number(station.priority || 1) })) : []); } catch (e) { if (alive) setError(e instanceof Error ? e.message : "Laden fehlgeschlagen."); } finally { if (alive) setLoading(false); } })(); return () => { alive = false; }; }, [crossingId]);
  useEffect(() => {
    const lat = Number(form.lat), lon = Number(form.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !form.lat || !form.lon) return;
    let alive = true;
    setNearbyLoading(true); setNearbyError("");
    fetch(`/api/admin/stations/nearby?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&radiusKm=30&limit=20`, { cache: "no-store" })
      .then(async (res) => { const data = await res.json().catch(() => ({})); if (!res.ok) throw new Error(data.error || "Bahnhöfe konnten nicht geladen werden."); return data; })
      .then((data) => { if (alive) setNearbyStations(Array.isArray(data.stations) ? data.stations : []); })
      .catch((error) => { if (alive) setNearbyError(error instanceof Error ? error.message : "Bahnhöfe konnten nicht geladen werden."); })
      .finally(() => { if (alive) setNearbyLoading(false); });
    return () => { alive = false; };
  }, [form.lat, form.lon]);
  useEffect(() => {
    const lat = Number(form.lat), lon = Number(form.lon);
    if (!form.lat || !form.lon || !Number.isFinite(lat) || !Number.isFinite(lon)) return;
    let alive = true;
    setInfrastructureLoading(true); setInfrastructureError("");
    fetch(`/api/admin/crossings/infrastructure?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`, { cache: "no-store" })
      .then(async (res) => { const data = await res.json().catch(() => ({})); if (!res.ok || data.status !== "OK") throw new Error(data.error || "OSM-Gleise konnten nicht geladen werden."); return data; })
      .then((data) => { if (alive) setInfrastructure(Array.isArray(data.candidates) ? data.candidates : []); })
      .catch((error) => { if (alive) { setInfrastructure([]); setInfrastructureError(error instanceof Error ? error.message : "OSM-Gleise konnten nicht geladen werden."); } })
      .finally(() => { if (alive) setInfrastructureLoading(false); });
    return () => { alive = false; };
  }, [form.lat, form.lon]);
  useEffect(() => {
    const lat = Number(form.lat), lon = Number(form.lon);
    const wayIds = selectedWayIds.filter((id) => infrastructure.some((candidate) => candidate.wayId === id));
    if (!form.lat || !form.lon || !Number.isFinite(lat) || !Number.isFinite(lon) || !wayIds.length) {
      setTrackStations([]);
      setTrackStationsError("");
      setTrackStationsLoading(false);
      return;
    }
    let alive = true;
    setTrackStationsLoading(true);
    setTrackStationsError("");
    fetch(`/api/admin/crossings/stations?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&wayIds=${encodeURIComponent(wayIds.join(","))}`, { cache: "no-store" })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Streckennahe DB-Bahnhöfe konnten nicht geladen werden.");
        return data;
      })
      .then((data) => { if (alive) setTrackStations(Array.isArray(data.stations) ? data.stations : []); })
      .catch((error) => { if (alive) { setTrackStations([]); setTrackStationsError(error instanceof Error ? error.message : "DB-Bahnhöfe konnten nicht geladen werden."); } })
      .finally(() => { if (alive) setTrackStationsLoading(false); });
    return () => { alive = false; };
  }, [form.lat, form.lon, infrastructure, selectedWayIds]);

  function toggleTrack(candidate: InfrastructureCandidate) {
    setSelectedWayIds((current) => {
      const next = current.includes(candidate.wayId) ? current.filter((id) => id !== candidate.wayId) : [...current, candidate.wayId];
      return next;
    });
    setSelectedTrackStations([]);
    if (!selectedWayIds.includes(candidate.wayId)) {
      const hints = (candidate.lineRelations || []).map((line) => (line.ref || line.name || "").trim()).filter(Boolean);
      setSelectedLineHints((current) => Array.from(new Set([...current, ...hints])));
    }
  }
  function setTrackStationSide(station: TrackStationCandidate, side: "before" | "after") {
    setSelectedTrackStations((current) => {
      const existing = current.find((item) => item.eva === station.eva);
      if (existing?.side === side) return current.filter((item) => item.eva !== station.eva);
      return [...current.filter((item) => item.eva !== station.eva), { ...station, side, trackWayIds: [...selectedWayIds], direction: "unknown", enabled: true, priority: 1 }];
    });
  }
  function toggleLineHint(value: string) {
    setSelectedLineHints((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  }

  function addNearbyStation(station: NearbyStation) {
    setMapStation(station);
    setLinks((items) => items.some((item) => item.eva === station.eva) ? items : [...items, {
      eva: station.eva, station_name: station.name, role: "observation",
      categories: "ICE,IC,EC,RE,RB", direction: "unknown",
      fallback_offset_seconds: 0, track_distance_meters: 0,
      lat: station.lat, lon: station.lon,
    }]);
  }
  async function calculateOsmTimingProfile() {
    if (!selectedTrackStations.length) {
      setProfileError("Bitte zuerst mindestens eine Station als vorher oder nachher auswählen.");
      return;
    }
    setProfileCalculating(true); setProfileError("");
    try {
      const response = await fetch(`/api/admin/crossings/${encodeURIComponent(crossingId)}/timing-profile`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stations: selectedTrackStations }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || "OSM-Distanzen konnten nicht berechnet werden.");
      setCrossingRules((current) => ({
        ...current,
        timing: { ...(current.timing || {}), osmTimingProfile: data.profile },
      }));
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : "OSM-Distanzen konnten nicht berechnet werden.");
    } finally {
      setProfileCalculating(false);
    }
  }
  async function save() {
    setSaving(true); setError("");
    try {
      const selectedTracks = infrastructureError ? (Array.isArray(crossingRules.selectedOsmTracks) ? crossingRules.selectedOsmTracks : []) : infrastructure.filter((candidate) => selectedWayIds.includes(candidate.wayId));
      const selectedStationLinks: StationLink[] = selectedTrackStations.map((station) => ({
        eva: station.eva, station_name: station.stationName, role: "observation",
        categories: "ICE,IC,EC,RE,RB", direction: "unknown",
        fallback_offset_seconds: Math.max(60, Math.round((Math.max(0.5, station.distanceKm) / 90) * 3600)),
        track_distance_meters: Math.round(station.alongTrackDistanceMeters), lat: station.lat, lon: station.lon,
      }));
      const previouslyAutoSelected = Array.isArray(crossingRules.observationStations) ? crossingRules.observationStations.map((station: any) => String(station.eva || "")) : [];
      const mergedLinks = [...links.filter((link) => !previouslyAutoSelected.includes(link.eva) && !selectedStationLinks.some((station) => station.eva === link.eva)), ...selectedStationLinks];
      const availableHints = selectedTracks.flatMap((track: any) => (track.lineRelations || []).map((line: any) => String(line.ref || line.name || "").trim())).filter(Boolean);
      const overrideValue = crossingTimingOverride.trim() === "" ? null : Number(crossingTimingOverride);
      const eastboundValue = eastboundTimingOverride.trim() === "" ? null : Number(eastboundTimingOverride);
      const westboundValue = westboundTimingOverride.trim() === "" ? null : Number(westboundTimingOverride);
      for (const [label, value] of [["Individuelle", overrideValue], ["Richtung Ost", eastboundValue], ["Richtung West", westboundValue]] as const) if (value !== null && (!Number.isFinite(value) || Math.abs(value) > 3600)) throw new Error(`${label} Zeitkorrektur muss zwischen -3600 und 3600 Sekunden liegen.`);
      const directionalCorrections = { ...(eastboundValue === null ? {} : { eastbound: Math.round(eastboundValue) }), ...(westboundValue === null ? {} : { westbound: Math.round(westboundValue) }) };
      const rules = {
        ...crossingRules,
        timing: { ...(crossingRules.timing || {}), ...(overrideValue === null ? {} : { crossingTimeCorrectionSeconds: Math.round(overrideValue) }), ...(Object.keys(directionalCorrections).length ? { directionalCrossingTimeCorrectionSeconds: directionalCorrections } : {}), speedKmh: Object.fromEntries(Object.entries(speedSettings).map(([key, value]) => [key, Number(value)])) },
        lineHints: selectedLineHints.filter((hint) => availableHints.includes(hint)),
        selectedOsmTracks: selectedTracks,
        observationStations: selectedTrackStations.map((station) => ({ ...station, trackDistanceMeters: Math.round(station.alongTrackDistanceMeters) })),
      };
      if (overrideValue === null) delete rules.timing.crossingTimeCorrectionSeconds;
      if (!Object.keys(directionalCorrections).length) delete rules.timing.directionalCrossingTimeCorrectionSeconds;
      const speedValues = Object.values(speedSettings).map(Number);
      if (speedValues.some((value) => !Number.isFinite(value) || value < 10 || value > 200)) throw new Error("Prognose-Geschwindigkeiten müssen zwischen 10 und 200 km/h liegen.");
      const globalValue = Number(globalTimingCorrectionSeconds);
      if (!Number.isFinite(globalValue) || Math.abs(globalValue) > 3600) throw new Error("Die globale Zeitkorrektur muss zwischen -3600 und 3600 Sekunden liegen.");
      const globalRes = await fetch("/api/admin/crossings/timing", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ crossingTimeCorrectionSeconds: Math.round(globalValue) }) });
      const globalData = await globalRes.json().catch(() => ({}));
      if (!globalRes.ok) throw new Error(globalData.error || "Globale Zeitkorrektur konnte nicht gespeichert werden.");
      const res = await fetch(`/api/admin/crossings/${encodeURIComponent(crossingId)}`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: form.name, eva: form.eva, lat: Number(form.lat), lon: Number(form.lon), postalCode: form.postalCode, city: form.city, state: form.state,
          closeOffsetSeconds: Number(form.closeOffsetSeconds), openOffsetSeconds: Number(form.openOffsetSeconds),
          confidence: Number(form.confidence), status: form.status, trainSourceMode: form.trainSourceMode,
          requiredRouteStops: routeStops, stationLinks: mergedLinks, rules,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Speichern fehlgeschlagen.");
      onSaved?.(); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : "Speichern fehlgeschlagen."); }
    finally { setSaving(false); }
  }
  function setField(key: keyof typeof form, value: string) { if ((key === "lat" || key === "lon") && value !== form[key]) { const oldAutoEvas = Array.isArray(crossingRules.observationStations) ? crossingRules.observationStations.map((station: any) => String(station.eva || "")) : []; setLinks((current) => current.filter((link) => !oldAutoEvas.includes(link.eva))); setSelectedWayIds([]); setSelectedLineHints([]); setSelectedTrackStations([]); setCrossingRules((current) => ({ ...current, selectedOsmTracks: [], lineHints: [], observationStations: [] })); } setForm((current) => ({ ...current, [key]: value })); }
  function addStop() { setRouteStops((items) => [...items, ""]); }
  function addStation() { setLinks((items) => [...items, { eva: "", station_name: "", role: "observation", categories: "ICE,IC,EC,RE,RB", direction: "unknown", fallback_offset_seconds: 0, track_distance_meters: 0 }]); }
  return <div className={studioStyles.studioEditBackdrop} style={{ position: "fixed", inset: 0, zIndex: 420, background: "rgba(15,20,28,.42)", display: "flex", justifyContent: "flex-end" }} onMouseDown={(e) => e.target === e.currentTarget && !saving && onClose()}><aside className={studioStyles.studioEditDrawer} style={{ width: "min(760px,100vw)", height: "100%", background: "#fff", boxShadow: "-25px 0 70px rgba(0,0,0,.2)", display: "flex", flexDirection: "column" }} onMouseDown={(e) => e.stopPropagation()}><header style={{ padding: "26px 30px 20px", borderBottom: "1px solid #eceef1", display: "flex", justifyContent: "space-between", gap: 20 }}><div><div style={{ color: "#e10600", fontSize: 10, fontWeight: 850, letterSpacing: ".14em", marginBottom: 7 }}>BAHNÜBERGANG · BEARBEITEN</div><h2 style={{ margin: 0, fontSize: 30, letterSpacing: "-.035em" }}>{form.name || "Übergang"}</h2></div><button onClick={onClose} disabled={saving} aria-label="Bearbeitung schließen" style={{ border: 0, background: "rgba(255,255,255,.12)", borderRadius: 10, width: 40, height: 40, cursor: "pointer", display: "grid", placeItems: "center" }}><AdminIcon name="x" size={18}/></button></header><nav className={studioStyles.studioSteps} aria-label="Bearbeitungsschritte">{["Standort","Gleise","Daten","Prognose","Check"].map((label,index)=><button key={label} type="button" className={editStep===index+1?studioStyles.studioStepActive:editStep>index+1?studioStyles.studioStepDone:""} onClick={()=>setEditStep(index+1)}><span>{editStep>index+1?"✓":index+1}</span>{label}</button>)}</nav>{loading ? <div style={{ padding: 30 }}>Übergang wird geladen…</div> : <><div style={{ overflow: "auto", padding: 26, display: "grid", gap: 24 }}>{error && <div style={{ padding: 12, borderRadius: 10, background: "#fff4f4", border: "1px solid #f1d5d8", color: "#b4232d", fontSize: 12 }}>{error}</div>}{editStep === 1 && <section style={{ display: "grid", gap: 10 }}><strong style={{ fontSize: 13 }}>Standort</strong><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}><label style={{ display: "grid", gap: 6 }}><span style={labelStyle}>Name</span><input style={inputStyle} value={form.name} onChange={(e) => setField("name", e.target.value)} /></label><label style={{ display: "grid", gap: 6 }}></label><label style={{ display: "grid", gap: 6 }}><span style={labelStyle}>Latitude</span><input style={inputStyle} value={form.lat} onChange={(e) => setField("lat", e.target.value)} /></label><label style={{ display: "grid", gap: 6 }}><span style={labelStyle}>Longitude</span><input style={inputStyle} value={form.lon} onChange={(e) => setField("lon", e.target.value)} /></label></div></section>}{editStep === 1 && <section style={{ display: "grid", gap: 8 }}><strong style={{ fontSize: 13 }}>Adresse / Region</strong><div style={{ display: "grid", gridTemplateColumns: "110px 1fr 1fr", gap: 8 }}><input style={inputStyle} placeholder="PLZ" value={form.postalCode} onChange={(e)=>setField("postalCode",e.target.value)}/><input style={inputStyle} placeholder="Ort" value={form.city} onChange={(e)=>setField("city",e.target.value)}/><input style={inputStyle} placeholder="Bundesland" value={form.state} onChange={(e)=>setField("state",e.target.value)}/></div><small style={{color:"#68717d",fontSize:11}}>Optionale Verwaltungsangaben zum Standort.</small></section>}{editStep === 3 && <section style={{ display: "grid", gap: 8 }}><strong style={{ fontSize: 13 }}>Betriebsart / Datenquelle</strong><select style={inputStyle} value={form.trainSourceMode} onChange={(e) => setField("trainSourceMode", e.target.value)}><option value="mobilithek">Mobilithek – bisheriger Betrieb</option><option value="openboards">OpenBoards – Mobilithek pausiert</option><option value="hybrid">Hybrid – OpenBoards + Mobilithek</option></select><small style={{ color: "#68717d", fontSize: 11, lineHeight: 1.5 }}>Gilt ausschließlich für diesen Bahnübergang. Die Auswahl wird erst nach dem Speichern übernommen.</small></section>}{editStep === 2 && <section style={{ display: "grid", gap: 8 }}>
  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><strong style={{ fontSize: 13 }}>OSM-Gleise und DB-Bahnhöfe</strong><small style={{ color: "#68717d" }}>{infrastructure.length} Gleis-/Streckenkandidaten · {nearbyStations.length} Bahnhöfe</small></div>
  <EditInfrastructureMap lat={Number(form.lat)} lon={Number(form.lon)} candidates={infrastructure} stations={nearbyStations} selectedEva={mapStation?.eva || ""} selectedWayIds={selectedWayIds} onSelectStation={addNearbyStation} onToggleTrack={(wayId) => { const candidate = infrastructure.find((item) => item.wayId === wayId); if (candidate) toggleTrack(candidate); }} />
  {infrastructureLoading && <small>OSM-Gleisverläufe werden geladen…</small>}
  {infrastructureError && <small style={{ color: "#b4232d" }}>{infrastructureError}</small>}
  {!infrastructureLoading && !infrastructureError && infrastructure.length === 0 && <small style={{ color: "#68717d" }}>Keine OSM-Gleisgeometrie im Suchradius gefunden.</small>}
  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
    <strong style={{ fontSize: 12 }}>{selectedWayIds.length} von {infrastructure.length} OSM-Gleisen aktiviert</strong>
    <small style={{ color: "#68717d" }}>Nur tatsächlich querende Gleise aktivieren</small>
  </div>
  <div style={{ display: "grid", gap: 7 }}>
    {infrastructure.map((candidate) => {
      const selected = selectedWayIds.includes(candidate.wayId);
      const ownPoints = new Set(candidate.segments.flat().map((point) => `${point.lat.toFixed(5)}:${point.lon.toFixed(5)}`));
      const overlaps = infrastructure.filter((other) => other.wayId !== candidate.wayId && other.segments.some((segment) => segment.some((point) => ownPoints.has(`${point.lat.toFixed(5)}:${point.lon.toFixed(5)}`))));
      return <button key={candidate.wayId} type="button" onClick={() => toggleTrack(candidate)} aria-pressed={selected} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "10px 12px", textAlign: "left", borderRadius: 10, border: selected ? "1px solid #18834d" : "1px solid #dfe3e8", background: selected ? "#f1faf4" : "#fafbfc", cursor: "pointer" }}>
        <span style={{ width: 7, height: 32, borderRadius: 99, background: selected ? "#18834d" : "#64748b", flex: "0 0 auto" }} />
        <span style={{ flex: 1, minWidth: 0, display: "grid", gap: 3 }}><strong style={{ fontSize: 12 }}>{candidate.ref ? `Strecke ${candidate.ref}` : "OSM-Gleis"} · Way {candidate.wayId}</strong><small style={{ color: "#68717d", lineHeight: 1.4 }}>{candidate.name || "Ohne Bezeichnung"}{candidate.from || candidate.to ? ` · ${candidate.from || "?"} → ${candidate.to || "?"}` : ""}{candidate.lineRelations?.length ? ` · Linien: ${candidate.lineRelations.map((line) => line.ref || line.name).filter(Boolean).join(", ")}` : " · Keine Linienrelation"}{overlaps.length ? ` · mögliche Überlagerung mit ${overlaps.map((item) => item.wayId).join(", ")}` : ""}</small></span>
        <span style={{ fontSize: 10, color: "#68717d", whiteSpace: "nowrap" }}>{Math.round(candidate.distanceMeters)} m</span><strong style={{ fontSize: 10, color: selected ? "#18834d" : "#475569" }}>{selected ? "✓ Aktiv" : "＋ Aktivieren"}</strong>
      </button>;
    })}
  </div>
  {selectedWayIds.length > 0 && infrastructure.some((candidate) => candidate.lineRelations?.length) && <div style={{ display: "grid", gap: 7 }}>
    <strong style={{ fontSize: 11 }}>Linienrelationen der ausgewählten Gleise</strong>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {Array.from(new Map(infrastructure.filter((candidate) => selectedWayIds.includes(candidate.wayId)).flatMap((candidate) => candidate.lineRelations || []).map((line) => [String(line.id), line])).values()).map((line) => {
        const value = (line.ref || line.name || "").trim(); const checked = selectedLineHints.includes(value);
        return <button key={line.id} type="button" onClick={() => toggleLineHint(value)} aria-pressed={checked} style={{ border: checked ? "1px solid #18834d" : "1px solid #dfe3e8", borderRadius: 999, padding: "7px 10px", background: checked ? "#f1faf4" : "#fff", fontSize: 10, fontWeight: 800, cursor: "pointer" }}>{checked ? "✓ " : ""}{line.ref || line.name}{line.name && line.ref ? <span style={{ color: "#68717d", fontWeight: 500 }}> · {line.name}</span> : null}</button>;
      })}
    </div>
    <small style={{ color: "#68717d" }}>Ausgewählte Linien werden zusammen mit den OSM-Ways gespeichert; sie ersetzen keine manuelle Streckenprüfung.</small>
  </div>}
  {selectedWayIds.length > 0 && <div style={{ display: "grid", gap: 8 }}>
    <strong style={{ fontSize: 11 }}>DB-Stationen entlang der ausgewählten Gleise</strong>
    <div style={{ padding: 12, background: "#f7f8fa", border: "1px solid #e5e7eb", borderRadius: 10, display: "grid", gap: 8 }}><strong style={{ fontSize: 11 }}>Prognose-Geschwindigkeiten (km/h)</strong><small style={{ color: "#68717d", lineHeight: 1.45 }}>Konfigurierbare Durchschnittswerte für die OSM-Streckenentfernung. Sie werden als Fallback genutzt, wenn keine zwei aktuellen Stationszeiten für eine Messung vorliegen.</small><div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 8 }}>{([{ key: "regional", label: "RB / RE Durchfahrt" }, { key: "stoppingRegional", label: "RB / RE mit Halt" }, { key: "intercity", label: "ICE / IC / EC" }, { key: "freight", label: "Güterverkehr" }, { key: "unknown", label: "Unbekannt" }] as const).map((item) => <label key={item.key} style={{ display: "grid", gap: 4 }}><span style={{ fontSize: 10, color: "#475569", fontWeight: 700 }}>{item.label}</span><input type="number" min="10" max="200" step="1" style={inputStyle} value={speedSettings[item.key]} onChange={(event) => setSpeedSettings((current) => ({ ...current, [item.key]: event.target.value }))} /></label>)}</div></div>
    {trackStationsLoading && <small>Streckennahe Bahnhöfe werden ermittelt…</small>}
    {trackStationsError && <small style={{ color: "#b4232d" }}>{trackStationsError}</small>}
    {!trackStationsLoading && !trackStationsError && trackStations.length === 0 && <small style={{ color: "#68717d" }}>Keine passenden Stationen entlang der ausgewählten Gleise gefunden.</small>}
    {trackStations.map((station) => { const selected = selectedTrackStations.find((item) => item.eva === station.eva); return <div key={station.eva || station.id || station.stationName} style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 10px", border: "1px solid #e5e7eb", borderRadius: 9 }}>
      <span style={{ flex: 1, minWidth: 0 }}><strong style={{ display: "block", fontSize: 11 }}>{station.stationName}</strong><small style={{ color: "#68717d" }}>{station.source === "osm" ? "OSM-Halt · DB-Zuordnung noch offen" : `${station.distanceKm.toFixed(1)} km · ${Math.round(station.trackDistanceMeters)} m seitlich · ${Math.round(station.alongTrackDistanceMeters)} m entlang Gleis`}</small></span>
      <button type="button" disabled={station.selectable === false} onClick={() => setTrackStationSide(station, "before")} style={{ border: "1px solid #dfe3e8", borderRadius: 8, padding: "7px 8px", background: selected?.side === "before" ? "#e9f6ef" : "#fff", fontSize: 10, fontWeight: 750 }}>Vorher</button>
      <button type="button" disabled={station.selectable === false} onClick={() => setTrackStationSide(station, "after")} style={{ border: "1px solid #dfe3e8", borderRadius: 8, padding: "7px 8px", background: selected?.side === "after" ? "#e9f6ef" : "#fff", fontSize: 10, fontWeight: 750 }}>Nachher</button>
      {selected && <select aria-label={`Fahrtrichtung für ${station.stationName}`} value={selected.direction} onChange={(event) => setSelectedTrackStations((items) => items.map((item) => item.eva === station.eva ? { ...item, direction: event.target.value as SelectedTrackStation["direction"] } : item))} style={{ ...inputStyle, width: 118, padding: "7px 8px", fontSize: 10 }}><option value="unknown">Richtung offen</option><option value="eastbound">Ost</option><option value="westbound">West</option></select>}
    </div>; })}
    {selectedTrackStations.length > 0 && <small style={{ color: "#18834d" }}>Ausgewählt: {selectedTrackStations.map((station) => `${station.stationName} (${station.side === "before" ? "vorher" : "nachher"})`).join(" · ")}</small>}
    <div style={{ display: "grid", gap: 7, padding: 11, border: "1px solid #dbe3ed", borderRadius: 9, background: "#fbfcfe" }}>
      <button type="button" disabled={profileCalculating || selectedTrackStations.length === 0} onClick={calculateOsmTimingProfile} style={{ border: 0, borderRadius: 8, padding: "10px 12px", background: profileCalculating ? "#64748b" : "#172b4d", color: "#fff", fontSize: 11, fontWeight: 800, cursor: profileCalculating ? "wait" : "pointer" }}>
        {profileCalculating ? "OSM-Distanzen werden berechnet…" : "OSM-Streckendistanzen berechnen"}
      </button>
      <small style={{ color: "#68717d", lineHeight: 1.45 }}>Berechnet die Schienenwegdistanz im vorbereiteten OSM-Korridor. Bitte Streckenauswahl und Stationen zuerst speichern und den Dialog erneut öffnen. Die Berechnung wird danach hier separat gestartet.</small>
      {profileError && <small style={{ color: "#b4232d" }}>{profileError}</small>}
      {crossingRules.timing?.osmTimingProfile?.stations && <div style={{ display: "grid", gap: 5 }}>
        <strong style={{ fontSize: 10 }}>Gespeichertes OSM-Zeitprofil</strong>
        {crossingRules.timing.osmTimingProfile.stations.map((item: any) => <small key={item.eva} style={{ color: item.status === "confirmed" ? "#18834d" : "#9a6700" }}>
          {item.name || item.eva} · {item.side === "before" ? "vorher" : "nachher"} · {item.ok ? `${item.distanceKm} km` : item.reason} · {item.status || "nicht berechnet"}
        </small>)}
      </div>}
    </div>
  </div>}
</section>}
{editStep === 2 && <section style={{ display: "grid", gap: 9 }}>
  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
    <strong style={{ fontSize: 13 }}>Bahnhöfe auf der Karte auswählen</strong>
    <span style={{ fontSize: 11, color: "#68717d" }}>Umkreis 30 km</span>
  </div>
  <small style={{ color: "#68717d", lineHeight: 1.5 }}>Wähle einen Bahnhof aus der Liste. Die Karte springt zu diesem Standort; der Bahnhof wird als DB-Beobachtungsstation übernommen.</small>
  {nearbyLoading && <small>Bahnhöfe werden gesucht…</small>}
  {nearbyError && <small style={{ color: "#b4232d" }}>{nearbyError}</small>}
  {!nearbyLoading && !nearbyError && nearbyStations.length === 0 && <small style={{ color: "#68717d" }}>Keine Bahnhöfe im Umkreis gefunden.</small>}
  {nearbyStations.length > 0 && (
    <label style={{ display: "grid", gap: 6 }}>
      <span style={labelStyle}>Nächstgelegenen Bahnhof auswählen</span>
      <select
        style={inputStyle}
        value={mapStation?.eva || ""}
        onChange={(event) => {
          const station = nearbyStations.find((item) => item.eva === event.target.value);
          if (station) addNearbyStation(station);
        }}
      >
        <option value="">Bahnhof auswählen …</option>
        {nearbyStations.map((station) => (
          <option key={station.eva} value={station.eva}>
            {station.name} · {station.distanceKm.toFixed(1)} km
          </option>
        ))}
      </select>
    </label>
  )}
  <div style={{ display: "grid", gap: 6, maxHeight: 220, overflowY: "auto" }}>
    {nearbyStations.map((station) => {
      const selected = links.some((link) => link.eva === station.eva);
      const focused = mapStation?.eva === station.eva;
      return <button key={station.eva} type="button" onClick={() => addNearbyStation(station)} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "center", textAlign: "left", padding: "10px 12px", borderRadius: 10, border: focused ? "2px solid #2563eb" : "1px solid #dfe3e8", background: selected ? "#eff6ff" : "#fff", cursor: "pointer" }}>
        <span><strong style={{ display: "block", fontSize: 12 }}>{station.name}</strong><small style={{ color: "#68717d" }}>{station.city ? `${station.city} · ` : ""}{station.distanceKm.toFixed(1)} km</small></span>
        <span style={{ fontSize: 11, fontWeight: 750, color: selected ? "#1d4ed8" : "#343c46" }}>{selected ? "✓ Übernommen" : "Auf Karte wählen"}</span>
      </button>;
    })}
  </div>
</section>}{editStep === 4 && <section style={{ display: "grid", gap: 10 }}><strong style={{ fontSize: 13 }}>Schließberechnung</strong><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}><label style={{ display: "grid", gap: 6 }}><span style={labelStyle}>Schließ-Offset (Sek.)</span><input type="number" style={inputStyle} value={form.closeOffsetSeconds} onChange={(e) => setField("closeOffsetSeconds", e.target.value)} /></label><label style={{ display: "grid", gap: 6 }}><span style={labelStyle}>Öffnungs-Offset (Sek.)</span><input type="number" style={inputStyle} value={form.openOffsetSeconds} onChange={(e) => setField("openOffsetSeconds", e.target.value)} /></label><label style={{ display: "grid", gap: 6 }}><span style={labelStyle}>Konfidenz</span><input type="number" min="0" max="1" step="0.05" style={inputStyle} value={form.confidence} onChange={(e) => setField("confidence", e.target.value)} /></label></div></section>}{editStep === 4 && <section style={{ display: "grid", gap: 16, padding: 16, border: "1px solid #dbe3ed", borderRadius: 12, background: "#f8fafc" }}>
  <div>
    <strong style={{ fontSize: 14 }}>Wann soll die Schranke angezeigt werden?</strong>
    <p style={{ margin: "5px 0 0", color: "#68717d", fontSize: 11, lineHeight: 1.5 }}>Stelle ein, wie viel früher oder später unsere Anzeige den Schließbeginn melden soll. Der Regler verschiebt die berechnete Schließzeit entsprechend.</p>
  </div>
  <div style={{ display: "grid", gap: 8 }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
      <strong style={{ fontSize: 12 }}>Global für alle Bahnübergänge</strong>
      <span style={{ fontSize: 12, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{Number(globalTimingCorrectionSeconds) === 0 ? "Keine Verschiebung" : `${Math.abs(Number(globalTimingCorrectionSeconds))} Sek. ${Number(globalTimingCorrectionSeconds) < 0 ? "früher" : "später"}`}</span>
    </div>
    <input aria-label="Globale Zeitkorrektur" type="range" min="-300" max="300" step="15" value={Math.max(-300, Math.min(300, Number(globalTimingCorrectionSeconds) || 0))} onChange={(e) => setGlobalTimingCorrectionSeconds(e.target.value)} disabled={timingSettingsLoading} style={{ width: "100%", accentColor: "#2563eb", cursor: "pointer" }} />
    <div style={{ display: "flex", justifyContent: "space-between", color: "#68717d", fontSize: 10 }}><span>5 Min. früher</span><span>Passt</span><span>5 Min. später</span></div>
    <div style={{ padding: "9px 11px", borderRadius: 9, background: Number(globalTimingCorrectionSeconds) < 0 ? "#fff7ed" : Number(globalTimingCorrectionSeconds) > 0 ? "#eff6ff" : "#ecfdf3", color: Number(globalTimingCorrectionSeconds) < 0 ? "#9a3412" : Number(globalTimingCorrectionSeconds) > 0 ? "#1d4ed8" : "#166534", fontSize: 11, fontWeight: 750 }}>
      {Number(globalTimingCorrectionSeconds) < 0 ? `Die Anzeige meldet die Schließung ${Math.abs(Number(globalTimingCorrectionSeconds))} Sekunden früher.` : Number(globalTimingCorrectionSeconds) > 0 ? `Die Anzeige meldet die Schließung ${Number(globalTimingCorrectionSeconds)} Sekunden später.` : "Die Anzeige verwendet die berechnete Schließzeit ohne zusätzliche Korrektur."}
    </div>
    <small style={{ color: "#68717d", fontSize: 10 }}>Gilt als Standard, wenn für einen Bahnübergang kein eigener Wert eingestellt ist.</small>
  </div>
  <div style={{ height: 1, background: "#dbe3ed" }} />
  <div style={{ display: "grid", gap: 8 }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
      <strong style={{ fontSize: 12 }}>Nur für diesen Bahnübergang</strong>
      <button type="button" onClick={() => setCrossingTimingOverride("")} style={{ border: "1px solid #d1d5db", borderRadius: 8, background: "#fff", padding: "5px 8px", fontSize: 10, fontWeight: 700, cursor: "pointer" }}>Global übernehmen</button>
    </div>
    <input aria-label="Individuelle Zeitkorrektur" type="range" min="-300" max="300" step="15" value={Math.max(-300, Math.min(300, Number(crossingTimingOverride === "" ? globalTimingCorrectionSeconds : crossingTimingOverride) || 0))} onChange={(e) => setCrossingTimingOverride(e.target.value)} style={{ width: "100%", accentColor: "#2563eb", cursor: "pointer" }} />
    <div style={{ display: "flex", justifyContent: "space-between", color: "#68717d", fontSize: 10 }}><span>5 Min. früher</span><span>Globaler Wert</span><span>5 Min. später</span></div>
    <div style={{ padding: "9px 11px", borderRadius: 9, background: Number(crossingTimingOverride === "" ? globalTimingCorrectionSeconds : crossingTimingOverride) < 0 ? "#fff7ed" : Number(crossingTimingOverride === "" ? globalTimingCorrectionSeconds : crossingTimingOverride) > 0 ? "#eff6ff" : "#ecfdf3", color: Number(crossingTimingOverride === "" ? globalTimingCorrectionSeconds : crossingTimingOverride) < 0 ? "#9a3412" : Number(crossingTimingOverride === "" ? globalTimingCorrectionSeconds : crossingTimingOverride) > 0 ? "#1d4ed8" : "#166534", fontSize: 11, fontWeight: 750 }}>
      {crossingTimingOverride === "" ? "Verwendet den globalen Standard." : Number(crossingTimingOverride) < 0 ? `Für diesen Übergang meldet die Anzeige ${Math.abs(Number(crossingTimingOverride))} Sekunden früher.` : Number(crossingTimingOverride) > 0 ? `Für diesen Übergang meldet die Anzeige ${Number(crossingTimingOverride)} Sekunden später.` : "Für diesen Übergang keine zusätzliche Zeitkorrektur."}
    </div>
    <small style={{ color: "#68717d", fontSize: 10 }}>Ein eigener Wert ersetzt den globalen Standard. Mit „Global übernehmen“ wird die individuelle Einstellung entfernt.</small>
  </div>
</section>}
{editStep === 4 && <section style={{ display: "grid", gap: 10 }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><div style={{ height: 1, background: "#dbe3ed" }} /><div style={{ display: "grid", gap: 10 }}><strong style={{ fontSize: 12 }}>Zusätzliche Korrektur nach Fahrtrichtung</strong><small style={{ color: "#68717d", fontSize: 10 }}>Nur bei nachgewiesenen Unterschieden einstellen. Ohne Richtungswert gilt die individuelle BÜ-Korrektur, sonst der globale Wert.</small>{([{key:"eastbound",label:"Richtung Ost (eastbound)",value:eastboundTimingOverride,set:setEastboundTimingOverride},{key:"westbound",label:"Richtung West (westbound)",value:westboundTimingOverride,set:setWestboundTimingOverride}] as const).map(item => { const inherited=crossingTimingOverride===""?(Number(globalTimingCorrectionSeconds)||0):(Number(crossingTimingOverride)||0); const value=item.value===""?inherited:(Number(item.value)||0); return <div key={item.key} style={{display:"grid",gap:7,padding:11,border:"1px solid #e2e8f0",borderRadius:9}}><div style={{display:"flex",justifyContent:"space-between"}}><strong style={{fontSize:11}}>{item.label}</strong><button type="button" onClick={()=>item.set("")}>Standard nutzen</button></div><input aria-label={item.label} type="range" min="-300" max="300" step="15" value={Math.max(-300,Math.min(300,value))} onChange={e=>item.set(e.target.value)} style={{width:"100%"}}/><div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:"#68717d"}}><span>5 Min. früher</span><span>{item.value===""?"Standard":`${Math.abs(value)} Sek. ${value<0?"früher":"später"}`}</span><span>5 Min. später</span></div></div>;})}</div><strong style={{ fontSize: 13 }}>Strecken-Haltepunkte</strong><button onClick={addStop} style={{ border: 0, background: "#f1f2f4", borderRadius: 9, padding: "8px 11px", cursor: "pointer", fontWeight: 750 }}><AdminIcon name="plus" size={14}/> Halt</button></div>{routeStops.map((stop, i) => <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 34px", gap: 8 }}><input style={inputStyle} value={stop} onChange={(e) => setRouteStops((items) => items.map((v, j) => j === i ? e.target.value : v))} placeholder="z. B. Bünde (Westf)" /><button onClick={() => setRouteStops((items) => items.filter((_, j) => j !== i))} style={{ border: 0, borderRadius: 9, background: "#fff4f4", color: "#c1121f", fontSize: 18, cursor: "pointer" }}><AdminIcon name="x" size={15}/></button></div>)}</section>}{editStep === 3 && <section style={{ display: "grid", gap: 10 }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><strong style={{ fontSize: 13, color: "#243b54" }}>DB-Beobachtungsstationen</strong><button onClick={addStation} style={{ border: 0, background: "#111827", color: "#fff", borderRadius: 9, padding: "8px 11px", cursor: "pointer", fontWeight: 750 }}><AdminIcon name="plus" size={14}/> Station</button></div>{links.length === 0 && <div style={{ display: "grid", gap: 5, padding: "16px 14px", border: "1px dashed #cbd7e3", borderRadius: 11, background: "#f8fafc" }}><strong style={{ color: "#243b54", fontSize: 12 }}>Noch keine Beobachtungsstationen hinterlegt</strong><small style={{ color: "#718398", fontSize: 11, lineHeight: 1.5 }}>Füge eine DB-Station hinzu, um sie diesem Bahnübergang zuzuordnen. Du kannst EVA, Name und Rolle anschließend direkt bearbeiten.</small></div>}{links.map((link, i) => <div key={`${link.id || "new"}-${i}`} style={{ padding: 12, border: "1px solid #e5e7eb", borderRadius: 11, display: "grid", gap: 8 }}><div style={{ display: "grid", gridTemplateColumns: "110px 1fr 120px", gap: 8 }}><input style={inputStyle} placeholder="EVA" value={link.eva} onChange={(e) => setLinks((items) => items.map((v,j)=>j===i?{...v,eva:e.target.value}:v))} /><input style={inputStyle} placeholder="Stationsname" value={link.station_name} onChange={(e) => setLinks((items) => items.map((v,j)=>j===i?{...v,station_name:e.target.value}:v))} /><select style={inputStyle} value={link.role} onChange={(e) => setLinks((items) => items.map((v,j)=>j===i?{...v,role:e.target.value}:v))}><option value="primary">primary</option><option value="observation">observation</option><option value="anchor">anchor</option></select></div><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 34px", gap: 8 }}><input style={inputStyle} placeholder="Kategorien, z. B. ICE,IC,RE" value={link.categories} onChange={(e) => setLinks((items) => items.map((v,j)=>j===i?{...v,categories:e.target.value}:v))} /><select style={inputStyle} value={link.direction} onChange={(e) => setLinks((items) => items.map((v,j)=>j===i?{...v,direction:e.target.value}:v))}><option value="unknown">Richtung unbekannt</option><option value="eastbound">eastbound</option><option value="westbound">westbound</option></select><button onClick={() => setLinks((items) => items.filter((_,j)=>j!==i))} style={{ border: 0, borderRadius: 9, background: "#fff4f4", color: "#c1121f", fontSize: 18, cursor: "pointer" }}><AdminIcon name="x" size={16}/></button></div></div>)}</section>}{editStep === 5 && <section style={{ display: "grid", gap: 8 }}><label style={{ display: "grid", gap: 6 }}><span style={labelStyle}>Status</span><select style={inputStyle} value={form.status} onChange={(e) => setField("status", e.target.value)}><option value="active">active</option><option value="inactive">inactive</option></select></label></section>}{editStep === 5 && <section className={studioStyles.studioReview}><div className={studioStyles.reviewSignal}><span>✓</span><div><strong>Konfiguration prüfen</strong><small>Diese Werte werden beim Speichern für den Bahnübergang übernommen.</small></div></div><div className={studioStyles.reviewGrid}><div><small>STANDORT</small><strong>{form.name || "Ohne Namen"} · {form.postalCode || form.city || "Ort nicht hinterlegt"}</strong></div><div><small>KOORDINATEN</small><strong>{form.lat}, {form.lon}</strong></div><div><small>OSM-GLEISE</small><strong>{selectedWayIds.length} ausgewählt</strong></div><div><small>BEOBACHTUNGSSTATIONEN</small><strong>{links.filter((link) => !selectedTrackStations.some((station) => station.eva === link.eva)).length + selectedTrackStations.length} verknüpft</strong></div><div><small>DATENQUELLE</small><strong>{form.trainSourceMode}</strong></div><div><small>SCHRANKEN-OFFSETS</small><strong>{form.closeOffsetSeconds}s / {form.openOffsetSeconds}s</strong></div></div><small style={{color:"#718292"}}>Hinweis: Bestehende Zusatzregeln und manuelle Stationsverknüpfungen bleiben erhalten, soweit sie nicht in den vorherigen Schritten geändert wurden.</small></section>}</div><footer className={studioStyles.studioFooter}><button type="button" onClick={()=>editStep===1?onClose():setEditStep((step)=>Math.max(1,step-1))} disabled={saving} className={studioStyles.cancel}>{editStep===1?"Abbrechen":"Zurück"}</button><div style={{display:"flex",gap:9}}>{editStep<5?<button type="button" onClick={()=>setEditStep((step)=>Math.min(5,step+1))} className={studioStyles.primary}>Weiter <AdminIcon name="arrow-right" size={16}/></button>:<button type="button" onClick={() => void save()} disabled={saving || infrastructureLoading} className={studioStyles.primary}>{saving ? "Speichert…" : "Änderungen speichern"}</button>}</div></footer></>}</aside></div>;
}


function editMapMercator(lat: number, lon: number, zoom: number) {
  const n = 2 ** zoom, rad = lat * Math.PI / 180;
  return { x: ((lon + 180) / 360) * n, y: ((1 - Math.asinh(Math.tan(rad)) / Math.PI) / 2) * n };
}
function EditInfrastructureMap({ lat, lon, candidates, stations, selectedEva, selectedWayIds, onSelectStation, onToggleTrack }: { lat: number; lon: number; candidates: InfrastructureCandidate[]; stations: NearbyStation[]; selectedEva: string; selectedWayIds: number[]; onSelectStation: (station: NearbyStation) => void; onToggleTrack: (wayId: number) => void }) {
  const [zoom, setZoom] = useState(13);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [size, setSize] = useState({ width: 700, height: 280 });
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
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return <div style={{ padding: 16, color: "#68717d" }}>Bitte gültige Koordinaten eingeben.</div>;
  const { width, height } = size;
  const center = editMapMercator(lat, lon, zoom);
  const originX = center.x * 256 - width / 2 - pan.x, originY = center.y * 256 - height / 2 - pan.y;
  const minX = Math.floor(originX / 256), maxX = Math.floor((originX + width) / 256);
  const minY = Math.floor(originY / 256), maxY = Math.floor((originY + height) / 256);
  const tiles: { x: number; y: number }[] = [];
  for (let x = minX; x <= maxX; x++) for (let y = minY; y <= maxY; y++) tiles.push({ x, y });
  const project = (point: { lat: number; lon: number }) => { const p = editMapMercator(point.lat, point.lon, zoom); return { x: p.x * 256 - originX, y: p.y * 256 - originY }; };
  const crossing = project({ lat, lon });
  const colors = ["#dc2626", "#2563eb", "#7c3aed", "#059669", "#ea580c", "#0891b2"];
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
  function toggleTrack(wayId: number) {
    if (suppressClick.current) { suppressClick.current = false; return; }
    onToggleTrack(wayId);
  }
  return <div ref={mapRef} onPointerDown={beginPan} onPointerMove={movePan} onPointerUp={endPan} onPointerCancel={endPan} onPointerLeave={() => { if (drag.current?.moved) drag.current = null; }} onClickCapture={(event) => { if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false; } }} style={{ position: "relative", height: 280, overflow: "hidden", borderRadius: 13, border: "1px solid #dfe3e8", background: "#e8edf0", touchAction: "none", cursor: drag.current?.moved ? "grabbing" : "grab", userSelect: "none" }}>
    {tiles.map(({ x, y }) => <img key={`${zoom}/${x}/${y}`} src={`https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`} alt="" draggable={false} style={{ position: "absolute", width: 256, height: 256, maxWidth: "none", pointerEvents: "none", left: x * 256 - originX, top: y * 256 - originY }} />)}
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "hidden" }} aria-label="OSM-Gleise und DB-Bahnhöfe">
      {candidates.map((candidate, index) => { const selected = selectedWayIds.includes(candidate.wayId), color = selected ? "#18834d" : colors[index % colors.length]; return <g key={`${candidate.wayId}-${index}`} onClick={() => toggleTrack(candidate.wayId)} style={{ cursor: "pointer", pointerEvents: "stroke" }}>{candidate.segments.map((segment, j) => { const points = segment.map(project).map((point) => `${point.x},${point.y}`).join(" "); return <g key={j}><polyline points={points} fill="none" stroke="#fff" strokeWidth={selected ? 11 : 8} strokeLinecap="round" strokeLinejoin="round" pointerEvents="stroke"/><polyline points={points} fill="none" stroke={color} strokeWidth={selected ? 7 : 4.5} strokeLinecap="round" strokeLinejoin="round" pointerEvents="stroke"/></g>; })}</g>; })}
      {stations.map((station) => { const point = project({ lat: station.lat, lon: station.lon }), active = station.eva === selectedEva; return <g key={station.eva} transform={`translate(${point.x} ${point.y})`} pointerEvents="none"><circle r={active ? 9 : 7} fill={active ? "#2563eb" : "#fff"} stroke="#1d4ed8" strokeWidth="3"/><circle r="2.5" fill={active ? "#fff" : "#1d4ed8"}/></g>; })}
      <circle cx={crossing.x} cy={crossing.y} r="12" fill="#dc2626" stroke="#fff" strokeWidth="4" pointerEvents="none"/><circle cx={crossing.x} cy={crossing.y} r="4" fill="#fff" pointerEvents="none"/>
    </svg>
    {stations.map((station) => { const point = project({ lat: station.lat, lon: station.lon }); return <button key={station.eva} type="button" title={station.name} aria-label={`${station.name} auf Karte auswählen`} onClick={() => onSelectStation(station)} style={{ position: "absolute", left: point.x, top: point.y, transform: "translate(-50%,-50%)", width: 28, height: 28, border: 0, background: "transparent", cursor: "pointer", zIndex: 2 }} />; })}
    <div style={{ position: "absolute", right: 10, top: 10, zIndex: 5, display: "grid", gap: 4 }}>
      <button type="button" aria-label="Karte vergrößern" onClick={() => setZoom((value) => Math.min(19, value + 1))} style={{ width: 34, height: 34, border: "1px solid #d1d5db", borderRadius: 7, background: "#fff", fontSize: 20, fontWeight: 800, cursor: "pointer" }}>+</button>
      <button type="button" aria-label="Karte verkleinern" onClick={() => setZoom((value) => Math.max(9, value - 1))} style={{ width: 34, height: 34, border: "1px solid #d1d5db", borderRadius: 7, background: "#fff", fontSize: 20, fontWeight: 800, cursor: "pointer" }}>−</button>
      <button type="button" aria-label="Ausschnitt zentrieren" onClick={() => setPan({ x: 0, y: 0 })} style={{ width: 34, height: 34, border: "1px solid #d1d5db", borderRadius: 7, background: "#fff", fontSize: 15, fontWeight: 800, cursor: "pointer" }}>⌖</button>
    </div>
    <div style={{ position: "absolute", left: 10, bottom: 10, display: "flex", gap: 10, flexWrap: "wrap", padding: "6px 9px", borderRadius: 8, background: "rgba(255,255,255,.94)", fontSize: 10, fontWeight: 700, pointerEvents: "none", zIndex: 3 }}><span>🔴 BÜ</span><span>🔵 DB-Bahnhof</span><span style={{ color: "#b91c1c" }}>━ OSM-Gleis</span></div>
    <div style={{ position: "absolute", right: 8, bottom: 8, background: "rgba(255,255,255,.94)", padding: "5px 8px", borderRadius: 7, fontSize: 10, pointerEvents: "none", zIndex: 3 }}>© OpenStreetMap · Ziehen zum Verschieben</div>
  </div>;
}
