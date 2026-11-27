"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "./page.module.css";
import AdminIcon from "../../components/AdminIcon";

type Crossing = {
  id: string; name: string; eva?: string; lat: number; lon: number;
  status?: string; train_source_mode?: string; stations?: Array<{ eva: string; stationName?: string }>;
};
type Forecast = {
  crossing?: { id: string; name: string; lat: number; lon: number };
  state?: string; message?: string;
  nextClosure?: { start: string; end: string; trains?: any[] } | null;
  closures?: Array<{ start: string; end: string; durationMinutes?: number; trainCount?: number; trains?: any[] }>;
  stations?: Array<{ eva: string; stationName: string; ok: boolean; count?: number; error?: string }>;
};

const time = (value?: string) => value ? new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "–";
const sourceLabel = (value?: string) => value === "openboards" ? "OpenBoards" : value === "hybrid" ? "Hybrid" : "Mobilithek";

export default function ForecastsPage() {
  const [crossings, setCrossings] = useState<Crossing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Crossing | null>(null);
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [forecastLoading, setForecastLoading] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileMessage, setProfileMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/admin/crossings", { cache: "no-store" });
      const data = await response.json().catch(() => []);
      if (!response.ok) throw new Error(data.error || "Bahnübergänge konnten nicht geladen werden.");
      setCrossings(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Übersicht konnte nicht geladen werden.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function openForecast(crossing: Crossing) {
    setSelected(crossing); setForecast(null); setProfileMessage(""); setForecastLoading(true); setError("");
    try {
      const response = await fetch(`/api/admin/crossings/${encodeURIComponent(crossing.id)}/forecast`, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Prognose konnte nicht geladen werden.");
      setForecast(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Prognose konnte nicht geladen werden.");
    } finally { setForecastLoading(false); }
  }

  async function prepareProfile() {
    if (!selected || profileLoading) return;
    setProfileLoading(true); setProfileMessage("");
    try {
      const response = await fetch(`/api/admin/crossings/${encodeURIComponent(selected.id)}/osm-profile`, { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `OSM-Profil konnte nicht vorbereitet werden (${response.status}).`);
      setProfileMessage(`Profil gespeichert · ${data.ways} Gleisabschnitte · ${data.nodes} Knoten · ${(Number(data.bytes || 0) / 1024).toFixed(1)} KB`);
    } catch (e) {
      setProfileMessage(e instanceof Error ? e.message : "OSM-Profil konnte nicht vorbereitet werden.");
    } finally { setProfileLoading(false); }
  }

  return <main className={styles.page}>
    <header className={styles.header}>
      <div><div className={styles.eyebrow}>CROSSINGS · DATEN</div><h1>Prognosen</h1><p>Aktuelle Schließprognosen und Datenbasis aller verwalteten Bahnübergänge.</p></div>
      <button className={styles.refresh} onClick={() => void load()} disabled={loading}>{loading ? "Aktualisiere…" : <><AdminIcon name="refresh" size={15}/> Aktualisieren</>}</button>
    </header>
    {error && !selected && <div className={styles.error}>{error}</div>}
    <section className={styles.tableCard}>
      <div className={styles.tableHead}><span>Bahnübergang</span><span>Datenquelle</span><span>Stationen</span><span>Status</span><span></span></div>
      {crossings.map((crossing) => <button type="button" className={styles.row} key={crossing.id} onClick={() => void openForecast(crossing)}>
        <span className={styles.name}><strong>{crossing.name}</strong><small>{crossing.id}</small><small>{Number(crossing.lat).toFixed(5)}, {Number(crossing.lon).toFixed(5)}</small></span>
        <span>{sourceLabel(crossing.train_source_mode)}</span>
        <span>{crossing.stations?.length ?? 0} verknüpft</span>
        <span className={styles.badge}>{crossing.status || "active"}</span>
        <span className={styles.openIcon}><AdminIcon name="arrow-up-right" size={16}/></span>
      </button>)}
      {!loading && !crossings.length && <div className={styles.empty}>Noch keine Bahnübergänge vorhanden.</div>}
      {loading && <div className={styles.empty}>Bahnübergänge werden geladen…</div>}
    </section>

    {selected && <div className={styles.backdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}>
      <aside className={styles.drawer}>
        <header className={styles.drawerHead}><div><div className={styles.eyebrow}>PROGNOSE · {sourceLabel(selected.train_source_mode).toUpperCase()}</div><h2>{selected.name}</h2><p>{Number(selected.lat).toFixed(5)}, {Number(selected.lon).toFixed(5)}</p></div><button className={styles.close} onClick={() => setSelected(null)}><AdminIcon name="x" size={16}/></button></header>
        <div className={styles.content}>
          {forecastLoading && <div className={styles.empty}>Prognose wird berechnet…</div>}
          {error && selected && <div className={styles.error}>{error}</div>}
          {forecast && <>
            <div className={styles.statusGrid}>
              <div className={forecast.state === "CLOSED" ? styles.closed : styles.open}><small>Aktueller Status</small><strong>{forecast.state === "CLOSED" ? "GESCHLOSSEN" : forecast.state || "UNBEKANNT"}</strong></div>
              <div className={styles.metric}><small>Nächste Schließung</small><strong>{forecast.nextClosure ? time(forecast.nextClosure.start) : "–"}</strong><span>{forecast.nextClosure ? `${time(forecast.nextClosure.start)} – ${time(forecast.nextClosure.end)} Uhr` : "Keine im Prognosefenster"}</span></div>
            </div>
            {forecast.message && <div className={styles.empty}>{forecast.message}</div>}
            <section><h3>Weitere Schließzeiten</h3>{forecast.closures?.length ? <div className={styles.list}>{forecast.closures.map((closure, index) => <div className={styles.listItem} key={`${closure.start}-${index}`}><div><strong>{time(closure.start)} – {time(closure.end)}</strong><small>{closure.trainCount ?? 0} Zug/Züge · ca. {closure.durationMinutes ?? "–"} Min.</small></div><span>{closure.trains?.length ? closure.trains.map((train: any) => train.line || train.category || "Zug").join(", ") : ""}</span></div>)}</div> : <div className={styles.empty}>Keine weiteren Schließzeiten im Prognosefenster.</div>}</section>
            <section><h3>Datenbasis</h3>{forecast.stations?.length ? <div className={styles.list}>{forecast.stations.map((station) => <div className={styles.listItem} key={station.eva}><div><strong>{station.stationName}</strong><small>EVA {station.eva} · {station.ok ? `${station.count ?? 0} Ereignisse` : station.error || "Fehler"}</small></div><span className={station.ok ? styles.good : styles.bad}>{station.ok ? "OK" : "Fehler"}</span></div>)}</div> : <div className={styles.empty}>Keine Beobachtungsstationen verknüpft.</div>}</section>
            <section><h3>OSM-Streckenprofil</h3><p className={styles.help}>Einmaliger Aufbau des gespeicherten Streckengraphen. Dieser Vorgang wird nicht durch normale Statusabfragen ausgelöst.</p><button className={styles.primary} onClick={() => void prepareProfile()} disabled={profileLoading}>{profileLoading ? "Streckengraph wird aufgebaut…" : "OSM-Profil vorbereiten / aktualisieren"}</button>{profileMessage && <div className={styles.empty}>{profileMessage}</div>}</section>
          </>}
        </div>
      </aside>
    </div>}
  </main>;
}
