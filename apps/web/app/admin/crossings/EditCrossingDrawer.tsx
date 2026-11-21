"use client";

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

type StationLink = { id?: string; eva: string; station_name: string; role: string; categories: string; direction: string; fallback_offset_seconds: number; track_distance_meters: number; lat?: number; lon?: number; };
type NearbyStation = { eva: string; name: string; ril100?: string; lat: number; lon: number; city?: string; distanceKm: number };
type InfrastructureCandidate = { kind: "route" | "track"; ref: string; name: string; distanceMeters: number; lineRelations: { id: number; ref: string; name: string }[]; segments: { lat: number; lon: number }[][] };
type Props = { crossingId: string; onClose: () => void; onSaved?: () => void };

const inputStyle: CSSProperties = { width: "100%", boxSizing: "border-box", border: "1px solid #dfe3e8", borderRadius: 10, padding: "11px 12px", font: "inherit", fontSize: 13 };
const labelStyle: CSSProperties = { fontSize: 11, fontWeight: 800, color: "#343c46" };

export default function EditCrossingDrawer({ crossingId, onClose, onSaved }: Props) {
  const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  const [form, setForm] = useState({ name: "", eva: "", lat: "", lon: "", closeOffsetSeconds: "80", openOffsetSeconds: "20", confidence: "0.5", status: "active", trainSourceMode: "mobilithek" });
  const [routeStops, setRouteStops] = useState<string[]>([]); const [links, setLinks] = useState<StationLink[]>([]);
  const [nearbyStations, setNearbyStations] = useState<NearbyStation[]>([]);
  const [nearbyLoading, setNearbyLoading] = useState(false);
  const [nearbyError, setNearbyError] = useState("");
  const [mapStation, setMapStation] = useState<NearbyStation | null>(null);
  const [infrastructure, setInfrastructure] = useState<InfrastructureCandidate[]>([]);
  const [infrastructureLoading, setInfrastructureLoading] = useState(false);
  const [infrastructureError, setInfrastructureError] = useState("");
  useEffect(() => { let alive = true; (async () => { try { const res = await fetch(`/api/admin/crossings/${encodeURIComponent(crossingId)}`, { cache: "no-store" }); const data = await res.json().catch(() => ({})); if (!res.ok) throw new Error(data.error || "Übergang konnte nicht geladen werden."); if (!alive) return; const c = data.crossing || {}; setForm({ name: String(c.name || ""), eva: String(c.eva || ""), lat: String(c.lat ?? ""), lon: String(c.lon ?? ""), closeOffsetSeconds: String(c.close_offset_seconds ?? 80), openOffsetSeconds: String(c.open_offset_seconds ?? 20), confidence: String(c.confidence ?? 0.5), status: String(c.status || "active"), trainSourceMode: ["openboards","mobilithek","hybrid"].includes(String(c.train_source_mode)) ? String(c.train_source_mode) : "mobilithek" }); setRouteStops(Array.isArray(c.requiredRouteStops) ? c.requiredRouteStops : []); setLinks(Array.isArray(data.stationLinks) ? data.stationLinks : []); } catch (e) { if (alive) setError(e instanceof Error ? e.message : "Laden fehlgeschlagen."); } finally { if (alive) setLoading(false); } })(); return () => { alive = false; }; }, [crossingId]);
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
  function addNearbyStation(station: NearbyStation) {
    setMapStation(station);
    setLinks((items) => items.some((item) => item.eva === station.eva) ? items : [...items, {
      eva: station.eva, station_name: station.name, role: "observation",
      categories: "ICE,IC,EC,RE,RB", direction: "unknown",
      fallback_offset_seconds: 0, track_distance_meters: 0,
      lat: station.lat, lon: station.lon,
    }]);
  }
  async function save() { setSaving(true); setError(""); try { const res = await fetch(`/api/admin/crossings/${encodeURIComponent(crossingId)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: form.name, eva: form.eva, lat: Number(form.lat), lon: Number(form.lon), closeOffsetSeconds: Number(form.closeOffsetSeconds), openOffsetSeconds: Number(form.openOffsetSeconds), confidence: Number(form.confidence), status: form.status, trainSourceMode: form.trainSourceMode, requiredRouteStops: routeStops, stationLinks: links }) }); const data = await res.json().catch(() => ({})); if (!res.ok) throw new Error(data.error || "Speichern fehlgeschlagen."); onSaved?.(); onClose(); } catch (e) { setError(e instanceof Error ? e.message : "Speichern fehlgeschlagen."); } finally { setSaving(false); } }
  function setField(key: keyof typeof form, value: string) { setForm((current) => ({ ...current, [key]: value })); }
  function addStop() { setRouteStops((items) => [...items, ""]); }
  function addStation() { setLinks((items) => [...items, { eva: "", station_name: "", role: "observation", categories: "ICE,IC,EC,RE,RB", direction: "unknown", fallback_offset_seconds: 0, track_distance_meters: 0 }]); }
  return <div style={{ position: "fixed", inset: 0, zIndex: 420, background: "rgba(15,20,28,.42)", display: "flex", justifyContent: "flex-end" }} onMouseDown={(e) => e.target === e.currentTarget && !saving && onClose()}><aside style={{ width: "min(760px,100vw)", height: "100%", background: "#fff", boxShadow: "-25px 0 70px rgba(0,0,0,.2)", display: "flex", flexDirection: "column" }} onMouseDown={(e) => e.stopPropagation()}><header style={{ padding: "26px 30px 20px", borderBottom: "1px solid #eceef1", display: "flex", justifyContent: "space-between", gap: 20 }}><div><div style={{ color: "#e10600", fontSize: 10, fontWeight: 850, letterSpacing: ".14em", marginBottom: 7 }}>BAHNÜBERGANG · BEARBEITEN</div><h2 style={{ margin: 0, fontSize: 30, letterSpacing: "-.035em" }}>{form.name || "Übergang"}</h2></div><button onClick={onClose} disabled={saving} style={{ border: 0, background: "#f1f2f4", borderRadius: 10, width: 38, height: 38, fontSize: 24, cursor: "pointer" }}>×</button></header>{loading ? <div style={{ padding: 30 }}>Übergang wird geladen…</div> : <><div style={{ overflow: "auto", padding: 26, display: "grid", gap: 24 }}>{error && <div style={{ padding: 12, borderRadius: 10, background: "#fff4f4", border: "1px solid #f1d5d8", color: "#b4232d", fontSize: 12 }}>{error}</div>}<section style={{ display: "grid", gap: 10 }}><strong style={{ fontSize: 13 }}>Standort</strong><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}><label style={{ display: "grid", gap: 6 }}><span style={labelStyle}>Name</span><input style={inputStyle} value={form.name} onChange={(e) => setField("name", e.target.value)} /></label><label style={{ display: "grid", gap: 6 }}><span style={labelStyle}>EVA</span><input style={inputStyle} value={form.eva} onChange={(e) => setField("eva", e.target.value)} /></label><label style={{ display: "grid", gap: 6 }}><span style={labelStyle}>Latitude</span><input style={inputStyle} value={form.lat} onChange={(e) => setField("lat", e.target.value)} /></label><label style={{ display: "grid", gap: 6 }}><span style={labelStyle}>Longitude</span><input style={inputStyle} value={form.lon} onChange={(e) => setField("lon", e.target.value)} /></label></div></section><section style={{ display: "grid", gap: 8 }}><strong style={{ fontSize: 13 }}>Betriebsart / Datenquelle</strong><select style={inputStyle} value={form.trainSourceMode} onChange={(e) => setField("trainSourceMode", e.target.value)}><option value="mobilithek">Mobilithek – bisheriger Betrieb</option><option value="openboards">OpenBoards – Mobilithek pausiert</option><option value="hybrid">Hybrid – OpenBoards + Mobilithek</option></select><small style={{ color: "#68717d", fontSize: 11, lineHeight: 1.5 }}>Gilt ausschließlich für diesen Bahnübergang. Die Auswahl wird erst nach dem Speichern übernommen.</small></section><section style={{ display: "grid", gap: 8 }}>
  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><strong style={{ fontSize: 13 }}>OSM-Gleise und DB-Bahnhöfe</strong><small style={{ color: "#68717d" }}>{infrastructure.length} Gleis-/Streckenkandidaten · {nearbyStations.length} Bahnhöfe</small></div>
  <EditInfrastructureMap lat={Number(form.lat)} lon={Number(form.lon)} candidates={infrastructure} stations={nearbyStations} selectedEva={mapStation?.eva || ""} onSelectStation={addNearbyStation} />
  {infrastructureLoading && <small>OSM-Gleisverläufe werden geladen…</small>}
  {infrastructureError && <small style={{ color: "#b4232d" }}>{infrastructureError}</small>}
  {!infrastructureLoading && !infrastructureError && infrastructure.length === 0 && <small style={{ color: "#68717d" }}>Keine OSM-Gleisgeometrie im Suchradius gefunden.</small>}
</section>
<section style={{ display: "grid", gap: 9 }}>
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
            {station.name} · EVA {station.eva} · {station.distanceKm.toFixed(1)} km
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
        <span><strong style={{ display: "block", fontSize: 12 }}>{station.name}</strong><small style={{ color: "#68717d" }}>EVA {station.eva}{station.city ? ` · ${station.city}` : ""} · {station.distanceKm.toFixed(1)} km</small></span>
        <span style={{ fontSize: 11, fontWeight: 750, color: selected ? "#1d4ed8" : "#343c46" }}>{selected ? "✓ Übernommen" : "Auf Karte wählen"}</span>
      </button>;
    })}
  </div>
</section><section style={{ display: "grid", gap: 10 }}><strong style={{ fontSize: 13 }}>Schließberechnung</strong><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}><label style={{ display: "grid", gap: 6 }}><span style={labelStyle}>Schließ-Offset (Sek.)</span><input type="number" style={inputStyle} value={form.closeOffsetSeconds} onChange={(e) => setField("closeOffsetSeconds", e.target.value)} /></label><label style={{ display: "grid", gap: 6 }}><span style={labelStyle}>Öffnungs-Offset (Sek.)</span><input type="number" style={inputStyle} value={form.openOffsetSeconds} onChange={(e) => setField("openOffsetSeconds", e.target.value)} /></label><label style={{ display: "grid", gap: 6 }}><span style={labelStyle}>Konfidenz</span><input type="number" min="0" max="1" step="0.05" style={inputStyle} value={form.confidence} onChange={(e) => setField("confidence", e.target.value)} /></label></div></section><section style={{ display: "grid", gap: 10 }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><strong style={{ fontSize: 13 }}>Strecken-Haltepunkte</strong><button onClick={addStop} style={{ border: 0, background: "#f1f2f4", borderRadius: 9, padding: "8px 11px", cursor: "pointer", fontWeight: 750 }}>+ Halt</button></div>{routeStops.map((stop, i) => <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 34px", gap: 8 }}><input style={inputStyle} value={stop} onChange={(e) => setRouteStops((items) => items.map((v, j) => j === i ? e.target.value : v))} placeholder="z. B. Bünde (Westf)" /><button onClick={() => setRouteStops((items) => items.filter((_, j) => j !== i))} style={{ border: 0, borderRadius: 9, background: "#fff4f4", color: "#c1121f", fontSize: 18, cursor: "pointer" }}>×</button></div>)}</section><section style={{ display: "grid", gap: 10 }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><strong style={{ fontSize: 13 }}>DB-Beobachtungsstationen</strong><button onClick={addStation} style={{ border: 0, background: "#111827", color: "#fff", borderRadius: 9, padding: "8px 11px", cursor: "pointer", fontWeight: 750 }}>+ Station</button></div>{links.map((link, i) => <div key={`${link.id || "new"}-${i}`} style={{ padding: 12, border: "1px solid #e5e7eb", borderRadius: 11, display: "grid", gap: 8 }}><div style={{ display: "grid", gridTemplateColumns: "110px 1fr 120px", gap: 8 }}><input style={inputStyle} placeholder="EVA" value={link.eva} onChange={(e) => setLinks((items) => items.map((v,j)=>j===i?{...v,eva:e.target.value}:v))} /><input style={inputStyle} placeholder="Stationsname" value={link.station_name} onChange={(e) => setLinks((items) => items.map((v,j)=>j===i?{...v,station_name:e.target.value}:v))} /><select style={inputStyle} value={link.role} onChange={(e) => setLinks((items) => items.map((v,j)=>j===i?{...v,role:e.target.value}:v))}><option value="primary">primary</option><option value="observation">observation</option><option value="anchor">anchor</option></select></div><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 34px", gap: 8 }}><input style={inputStyle} placeholder="Kategorien, z. B. ICE,IC,RE" value={link.categories} onChange={(e) => setLinks((items) => items.map((v,j)=>j===i?{...v,categories:e.target.value}:v))} /><select style={inputStyle} value={link.direction} onChange={(e) => setLinks((items) => items.map((v,j)=>j===i?{...v,direction:e.target.value}:v))}><option value="unknown">Richtung unbekannt</option><option value="eastbound">eastbound</option><option value="westbound">westbound</option></select><button onClick={() => setLinks((items) => items.filter((_,j)=>j!==i))} style={{ border: 0, borderRadius: 9, background: "#fff4f4", color: "#c1121f", fontSize: 18, cursor: "pointer" }}>×</button></div></div>)}</section><section style={{ display: "grid", gap: 8 }}><label style={{ display: "grid", gap: 6 }}><span style={labelStyle}>Status</span><select style={inputStyle} value={form.status} onChange={(e) => setField("status", e.target.value)}><option value="active">active</option><option value="inactive">inactive</option></select></label></section></div><footer style={{ padding: "16px 26px", borderTop: "1px solid #eceef1", display: "flex", justifyContent: "flex-end", gap: 10 }}><button onClick={onClose} disabled={saving} style={{ border: 0, borderRadius: 10, padding: "12px 16px", background: "#f1f2f4", cursor: "pointer", fontWeight: 750 }}>Abbrechen</button><button onClick={() => void save()} disabled={saving} style={{ border: 0, borderRadius: 10, padding: "12px 18px", background: "#e10600", color: "#fff", cursor: "pointer", fontWeight: 800 }}>{saving ? "Speichert…" : "Änderungen speichern"}</button></footer></>}</aside></div>;
}


function editMapMercator(lat: number, lon: number, zoom: number) {
  const n = 2 ** zoom, rad = lat * Math.PI / 180;
  return { x: ((lon + 180) / 360) * n, y: ((1 - Math.asinh(Math.tan(rad)) / Math.PI) / 2) * n };
}
function EditInfrastructureMap({ lat, lon, candidates, stations, selectedEva, onSelectStation }: { lat: number; lon: number; candidates: InfrastructureCandidate[]; stations: NearbyStation[]; selectedEva: string; onSelectStation: (station: NearbyStation) => void }) {
  const width = 700, height = 280, zoom = 11;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return <div style={{ padding: 16, color: "#68717d" }}>Bitte gültige Koordinaten eingeben.</div>;
  const center = editMapMercator(lat, lon, zoom), originX = center.x * 256 - width / 2, originY = center.y * 256 - height / 2;
  const tileX = Math.floor(center.x), tileY = Math.floor(center.y);
  const project = (point: {lat:number;lon:number}) => { const p = editMapMercator(point.lat, point.lon, zoom); return { x: p.x * 256 - originX, y: p.y * 256 - originY }; };
  const crossing = project({ lat, lon });
  const colors = ["#dc2626", "#2563eb", "#7c3aed", "#059669", "#ea580c", "#0891b2"];
  const tiles = [-1,0,1,2,3].flatMap(dx => [-1,0,1,2].map(dy => ({x:tileX+dx,y:tileY+dy})));
  return <div style={{ position:"relative",height:280,overflow:"hidden",borderRadius:13,border:"1px solid #dfe3e8",background:"#e8edf0" }}>
    {tiles.map(({x,y})=><img key={`${x}/${y}`} src={`https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`} alt="" draggable={false} style={{position:"absolute",width:256,height:256,left:x*256-originX,top:y*256-originY}} />)}
    <svg viewBox={`0 0 ${width} ${height}`} style={{position:"absolute",inset:0,width:"100%",height:"100%"}} aria-label="OSM-Gleise und DB-Bahnhöfe">
      {candidates.map((candidate,index)=><g key={`${candidate.ref}-${index}`} pointerEvents="none">{candidate.segments.map((segment,j)=>{const points=segment.map(project).map(p=>`${p.x},${p.y}`).join(" ");return <g key={j}><polyline points={points} fill="none" stroke="#fff" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round"/><polyline points={points} fill="none" stroke={colors[index%colors.length]} strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round"/></g>;})}</g>)}
      {stations.map(station=>{const p=project({lat:station.lat,lon:station.lon});const active=station.eva===selectedEva;return <g key={station.eva} transform={`translate(${p.x} ${p.y})`}><circle r={active?9:7} fill={active?"#2563eb":"#fff"} stroke="#1d4ed8" strokeWidth="3"/><circle r="2.5" fill={active?"#fff":"#1d4ed8"}/></g>;})}
      <circle cx={crossing.x} cy={crossing.y} r="12" fill="#dc2626" stroke="#fff" strokeWidth="4"/><circle cx={crossing.x} cy={crossing.y} r="4" fill="#fff"/>
    </svg>
    {stations.map(station=>{const p=project({lat:station.lat,lon:station.lon});return <button key={station.eva} type="button" title={station.name} aria-label={`${station.name} auf Karte auswählen`} onClick={()=>onSelectStation(station)} style={{position:"absolute",left:`${p.x/width*100}%`,top:`${p.y/height*100}%`,transform:"translate(-50%,-50%)",width:28,height:28,border:0,background:"transparent",cursor:"pointer"}}/>;})}
    <div style={{position:"absolute",left:10,bottom:10,display:"flex",gap:10,flexWrap:"wrap",padding:"6px 9px",borderRadius:8,background:"rgba(255,255,255,.94)",fontSize:10,fontWeight:700,pointerEvents:"none"}}><span>🔴 BÜ</span><span>🔵 DB-Bahnhof</span><span style={{color:"#b91c1c"}}>━ OSM-Gleis</span></div>
    <div style={{position:"absolute",right:8,top:8,background:"rgba(255,255,255,.94)",padding:"5px 8px",borderRadius:7,fontSize:10,pointerEvents:"none"}}>© OpenStreetMap</div>
  </div>;
}
