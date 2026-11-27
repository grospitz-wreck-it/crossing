"use client";

import { useEffect, useState } from "react";
import { useCrossings } from "../context/CrossingsContext";
import styles from "./ContentServices.module.css";

type FuelType = "e5" | "e10" | "diesel";
type Preferences = { fuelEnabled: boolean; fuelType: FuelType | null; jokesEnabled: boolean };
const fuelLabels: Record<FuelType, string> = { e5: "Super E5", e10: "Super E10", diesel: "Diesel" };

export default function ContentServices() {
  const { activeId } = useCrossings();
  const [prefs, setPrefs] = useState<Preferences>({ fuelEnabled: false, fuelType: null, jokesEnabled: false });
  const [fuel, setFuel] = useState<any>(null);
  const [fuelError, setFuelError] = useState("");
  const [joke, setJoke] = useState<any>(null);
  const [jokeError, setJokeError] = useState("");
  const [loadingFuel, setLoadingFuel] = useState(false);
  const [loadingJoke, setLoadingJoke] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/user/content-preferences", { cache: "no-store" })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (!cancelled && data) setPrefs(data); })
      .catch(() => {});
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

  if (!prefs.fuelEnabled && !prefs.jokesEnabled) return null;

  return (
    <section className={styles.section} aria-label="Deine Inhalte">
      {prefs.fuelEnabled && (
        <article className={styles.card}>
          <div className={styles.cardHead}><span className={styles.icon}>⛽</span><span className={styles.eyebrow}>GÜNSTIG TANKEN</span><span className={styles.type}>{prefs.fuelType ? fuelLabels[prefs.fuelType] : ""}</span></div>
          {loadingFuel ? <p className={styles.muted}>Preise werden geladen …</p> : fuelError ? <p className={styles.error}>{fuelError}</p> : fuel?.result ? (
            <div className={styles.fuelContent}>
              <strong className={styles.price}>{Number(fuel.result.price).toLocaleString("de-DE", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} €<small>/ Liter</small></strong>
              <div className={styles.station}><strong>{fuel.result.station.brand || fuel.result.station.name}</strong><span>{[fuel.result.station.street, fuel.result.station.postCode, fuel.result.station.place].filter(Boolean).join(", ")}</span><small>{fuel.result.station.distanceKm != null ? `${fuel.result.station.distanceKm.toLocaleString("de-DE", { maximumFractionDigits: 1 })} km vom Bahnübergang` : ""}{fuel.result.station.isOpen ? " · geöffnet" : " · Öffnungsstatus nicht bestätigt"}</small></div>
            </div>
          ) : <p className={styles.muted}>Im Umkreis von 5 km wurde kein Preis für diese Sorte gefunden.</p>}
          <div className={styles.attribution}>Preise: <a href="https://creativecommons.tankerkoenig.de/" target="_blank" rel="noreferrer">Tankerkönig</a> · CC BY 4.0</div>
        </article>
      )}
      {prefs.jokesEnabled && (
        <article className={styles.card}>
          <div className={styles.cardHead}><span className={styles.icon}>😄</span><span className={styles.eyebrow}>KLEINE PAUSE</span><span className={styles.type}>Witz des Tages</span></div>
          {loadingJoke ? <p className={styles.muted}>Ein Witz wird gesucht …</p> : jokeError ? <p className={styles.error}>{jokeError}</p> : joke ? <div className={styles.joke}>{joke.type === "single" ? joke.joke : <><strong>{joke.setup}</strong><span>{joke.delivery}</span></>}</div> : <p className={styles.muted}>Noch kein Witz geladen.</p>}
          <button className={styles.refresh} type="button" onClick={() => void loadJoke()} disabled={loadingJoke}>{loadingJoke ? "Lädt …" : "Neuen Witz laden ↻"}</button>
          <div className={styles.attribution}>Witze von <a href="https://sv443.net/jokeapi/v2/" target="_blank" rel="noreferrer">JokeAPI</a></div>
        </article>
      )}
    </section>
  );
}
