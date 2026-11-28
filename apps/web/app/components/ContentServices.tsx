"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { useCrossings } from "../context/CrossingsContext";
import styles from "./ContentServices.module.css";
import AppIcon from "./AppIcon";
import ContentTypeIcon from "./ContentTypeIcon";

type FuelType = "e5" | "e10" | "diesel";
type ContentKind = "news" | "fuel" | "jokes";
type Preferences = { newsEnabled: boolean; fuelEnabled: boolean; fuelType: FuelType | null; jokesEnabled: boolean; contentOrder: ContentKind[] };
const DEFAULT_CONTENT_ORDER: ContentKind[] = ["news", "fuel", "jokes"];
function normalizeContentOrder(value: unknown): ContentKind[] {
  const allowed: ContentKind[] = ["news", "fuel", "jokes"];
  const requested = Array.isArray(value) ? value.filter((item): item is ContentKind => allowed.includes(item as ContentKind)) : [];
  return [...new Set<ContentKind>([...requested, ...DEFAULT_CONTENT_ORDER])];
}
type NewsItem = { id: string; content_type?: string; title: string; summary?: string; image_url?: string; action_type?: string; action_url?: string; accent_color?: string };
type FuelStation = { price: number; direction: string; station: { name: string; brand?: string | null; street?: string | null; place?: string | null; postCode?: number | null; distanceKm?: number | null; isOpen?: boolean; lat?: number | null; lng?: number | null } };
type Joke = { type: "single" | "twopart"; joke?: string; setup?: string; delivery?: string };
const fuelLabels: Record<FuelType, string> = { e5: "Super E5", e10: "Super E10", diesel: "Diesel" };
function mapsUrl(station: FuelStation["station"]) {
  if (typeof station.lat !== "number" || typeof station.lng !== "number") return null;
  return `https://www.google.com/maps/dir/?api=1&destination=${station.lat},${station.lng}&travelmode=driving`;
}
function contentLabel(item: NewsItem) {
  if (item.content_type === "local_news") return "Lokal informiert";
  if (item.content_type === "event") return "Veranstaltung";
  if (item.content_type === "partner") return "Partner";
  if (item.content_type === "onboarding") return "Gut zu wissen";
  return "Tipp";
}

export default function ContentServices({ newsItems = [] }: { newsItems?: NewsItem[] }) {
  const { activeId } = useCrossings();
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; scrollLeft: number } | null>(null);
  const [prefs, setPrefs] = useState<Preferences>({ newsEnabled: false, fuelEnabled: false, fuelType: null, jokesEnabled: false, contentOrder: DEFAULT_CONTENT_ORDER });
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [fuel, setFuel] = useState<{ results?: FuelStation[]; message?: string } | null>(null);
  const [fuelError, setFuelError] = useState("");
  const [joke, setJoke] = useState<Joke | null>(null);
  const [jokeError, setJokeError] = useState("");
  const [loadingFuel, setLoadingFuel] = useState(false);
  const [loadingJoke, setLoadingJoke] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/user/content-preferences", { cache: "no-store" })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (!cancelled && data) setPrefs({ ...data, contentOrder: normalizeContentOrder(data.contentOrder) }); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setPrefsLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!activeId || !prefs.fuelEnabled || !prefs.fuelType) { setFuel(null); setFuelError(""); return; }
    let cancelled = false;
    setLoadingFuel(true); setFuelError("");
    fetch(`/api/fuel/${encodeURIComponent(activeId)}?type=${prefs.fuelType}`, { cache: "no-store" })
      .then(async (r) => { const data = await r.json(); if (!r.ok) throw new Error(data.error || "Spritpreise nicht verfügbar."); return data; })
      .then((data) => { if (!cancelled) setFuel(data); })
      .catch((error) => { if (!cancelled) { setFuel(null); setFuelError(error.message); } })
      .finally(() => { if (!cancelled) setLoadingFuel(false); });
    return () => { cancelled = true; };
  }, [activeId, prefs.fuelEnabled, prefs.fuelType]);

  function handleTrackPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, scrollLeft: event.currentTarget.scrollLeft };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function handleTrackPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.currentTarget.scrollLeft = drag.scrollLeft - (event.clientX - drag.startX);
  }
  function handleTrackPointerEnd(event: React.PointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  }

  async function loadJoke() {
    setLoadingJoke(true); setJokeError("");
    try {
      const response = await fetch("/api/jokes", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Witz nicht verfügbar.");
      setJoke(data);
    } catch (error) {
      setJokeError(error instanceof Error ? error.message : "Witz nicht verfügbar.");
    } finally { setLoadingJoke(false); }
  }
  useEffect(() => {
    if (prefs.jokesEnabled && !joke) void loadJoke();
    if (!prefs.jokesEnabled) { setJoke(null); setJokeError(""); }
  }, [prefs.jokesEnabled]);

  const hasNews = prefs.newsEnabled && newsItems.length > 0;
  const hasFuel = prefs.fuelEnabled;
  const hasJokes = prefs.jokesEnabled;
  const cardCount = (hasNews ? newsItems.length : 0) + Number(hasFuel) + Number(hasJokes);
  if (!prefsLoaded || cardCount === 0) return null;

  return (
    <section className={styles.section} aria-label="Aktuelle Informationen" data-no-crossing-swipe>
      <div className={styles.header}>
        <div><span className={styles.sectionTitle}>Aktuelle Informationen</span><span className={styles.sectionHint}>Wische durch deine Inhalte</span></div>
        <span className={styles.counter}>{cardCount} Karten</span>
      </div>
      <div ref={trackRef} className={styles.track} onPointerDown={handleTrackPointerDown} onPointerMove={handleTrackPointerMove} onPointerUp={handleTrackPointerEnd} onPointerCancel={handleTrackPointerEnd}>
        {prefs.contentOrder.map((kind) => {
          if (kind === "news") return <Fragment key="news">{hasNews && newsItems.map((item) => {
          const card = (
            <>
              <div className={styles.cardHead}><span className={styles.icon} style={{ background: (item.accent_color || "#f32643") + "20", color: item.accent_color || "#f32643" }}><ContentTypeIcon type={item.content_type} size={20} /></span><span className={styles.eyebrow}>{contentLabel(item)}</span></div>
              {item.image_url && <img className={styles.newsImage} src={item.image_url} alt="" loading="lazy" />}
              <h2 className={styles.newsTitle}>{item.title}</h2>
              {item.summary && <p className={styles.newsSummary}>{item.summary}</p>}
              {item.action_type === "open_url" && item.action_url && <span className={styles.action}>Mehr erfahren <AppIcon name="arrow-up-right" size={14} /></span>}
            </>
          );
          return item.action_type === "open_url" && item.action_url
            ? <a className={styles.card} key={item.id} href={item.action_url} target="_blank" rel="noopener noreferrer" style={{ borderColor: (item.accent_color || "#f32643") + "55" }}>{card}</a>
            : <article className={styles.card} key={item.id} style={{ borderColor: (item.accent_color || "#f32643") + "55" }}>{card}</article>;
        })}</Fragment>;
          if (kind === "fuel") return <Fragment key="fuel">{hasFuel && (
          <article className={styles.card}>
            <div className={styles.cardHead}><span className={styles.icon}><AppIcon name="fuel" size={20} /></span><span className={styles.eyebrow}>GÜNSTIG TANKEN</span><span className={styles.type}>{prefs.fuelType ? fuelLabels[prefs.fuelType] : ""}</span></div>
            {loadingFuel ? <p className={styles.muted}>Preise werden geladen …</p> : fuelError ? <p className={styles.error}>{fuelError}</p> : fuel?.results?.length ? (
              <div className={styles.stationList}>
                {fuel.results.map((entry, index) => {
                  const station = entry.station;
                  const route = mapsUrl(station);
                  return <div className={styles.stationRow} key={station.name + index}>
                    <div className={styles.stationRank}>{index + 1}</div>
                    <div className={styles.stationInfo}><strong>{station.brand || station.name}</strong><span>{[station.street, station.postCode, station.place].filter(Boolean).join(", ")}</span><small>{entry.direction} · {station.distanceKm != null ? `${station.distanceKm.toLocaleString("de-DE", { maximumFractionDigits: 1 })} km` : "Entfernung unbekannt"}{station.isOpen ? " · geöffnet" : ""}</small></div>
                    <strong className={styles.stationPrice}>{entry.price.toLocaleString("de-DE", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} €</strong>
                    {route && <a className={styles.routeButton} href={route} target="_blank" rel="noopener noreferrer" aria-label={`Route zu ${station.name} in Google Maps öffnen`} title="Route in Google Maps öffnen"><AppIcon name="route" size={18} /></a>}
                  </div>;
                })}
              </div>
            ) : <p className={styles.muted}>{fuel?.message || "Im Umkreis von 5 km wurden keine Preise für diese Sorte gefunden."}</p>}
            <div className={styles.attribution}>Günstige Preise im Umkreis · <a href="https://creativecommons.org/licenses/by/4.0/deed.de" target="_blank" rel="noreferrer">Tankerkönig · CC BY 4.0</a></div>
          </article>
        )}</Fragment>;
          if (kind === "jokes") return <Fragment key="jokes">{hasJokes && <article className={styles.card}>
          <div className={styles.cardHead}><span className={styles.icon}><AppIcon name="message-circle" size={20} /></span><span className={styles.eyebrow}>KLEINE PAUSE</span><span className={styles.type}>Witz des Tages</span></div>
          {loadingJoke ? <p className={styles.muted}>Ein Witz wird gesucht …</p> : jokeError ? <p className={styles.error}>{jokeError}</p> : joke ? <div className={styles.joke}>{joke.type === "single" ? joke.joke : <><strong>{joke.setup}</strong><span>{joke.delivery}</span></>}</div> : <p className={styles.muted}>Noch kein Witz geladen.</p>}
          <button className={styles.refresh} type="button" onClick={() => void loadJoke()} disabled={loadingJoke}>{loadingJoke ? "Lädt …" : <>Neuen Witz laden <AppIcon name="refresh" size={15} /></>}</button>
          <div className={styles.attribution}>Witze von <a href="https://sv443.net/jokeapi/v2/" target="_blank" rel="noreferrer">JokeAPI</a></div>
        </article>}</Fragment>;
          return null;
        })}
      </div>
    </section>
  );
}
