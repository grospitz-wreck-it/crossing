"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./page.module.css";

type Crossing = {
  id: string;
  name: string;
  lat?: number | null;
  lon?: number | null;
};

type SavedCrossing = Crossing & { distance?: number };

const STORAGE_KEY = "meineschranke:crossings:v1";
const ACTIVE_KEY = "meineschranke:active-crossing:v1";
const MAX_CROSSINGS = 5;

function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistance(value?: number) {
  if (value == null || !Number.isFinite(value)) return "";
  return value < 10 ? value.toLocaleString("de-DE", { maximumFractionDigits: 1 }) + " km" : Math.round(value) + " km";
}

export default function MeineSchrankenPage() {
  const [catalog, setCatalog] = useState<Crossing[]>([]);
  const [saved, setSaved] = useState<SavedCrossing[]>([]);
  const [activeId, setActiveId] = useState("");
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState<{ lat: number; lon: number } | null>(null);
  const [locationState, setLocationState] = useState<"idle" | "loading" | "ready" | "denied" | "error">("idle");
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const [catalogRes, sessionRes] = await Promise.all([
          fetch("/api/crossings", { cache: "no-store" }),
          fetch("/api/auth/session", { cache: "no-store" }),
        ]);
        const list = catalogRes.ok ? await catalogRes.json() : [];
        const session = sessionRes.ok ? await sessionRes.json() : null;
        const signedIn = Boolean(session?.user?.id);
        let initialSaved: SavedCrossing[] = [];
        if (signedIn) {
          const userRes = await fetch("/api/user/crossings", { cache: "no-store" });
          if (userRes.ok) {
            const data = await userRes.json();
            initialSaved = (data.crossings ?? []).map((item: any) => ({
              id: String(item.crossing_id ?? item.id),
              name: String(item.name ?? ""),
              lat: item.lat == null ? null : Number(item.lat),
              lon: item.lon == null ? null : Number(item.lon),
            }));
          }
        } else {
          try {
            initialSaved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
          } catch { initialSaved = []; }
        }
        if (cancelled) return;
        const normalized = (Array.isArray(list) ? list : []).map((item: any) => ({
          id: String(item.id), name: String(item.name),
          lat: item.lat == null ? null : Number(item.lat),
          lon: item.lon == null ? null : Number(item.lon),
        }));
        setCatalog(normalized);
        setIsSignedIn(signedIn);
        setSaved(initialSaved.filter((item) => item?.id && item?.name).slice(0, MAX_CROSSINGS));
        setActiveId(localStorage.getItem(ACTIVE_KEY) || initialSaved[0]?.id || "");
      } catch {
        if (!cancelled) setNotice("Die Schranken konnten gerade nicht geladen werden.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    init();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!isSignedIn) localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  }, [saved, isSignedIn]);

  useEffect(() => {
    if (activeId) localStorage.setItem(ACTIVE_KEY, activeId);
  }, [activeId]);

  const enrichedCatalog = useMemo(() => catalog.map((crossing) => ({
    ...crossing,
    distance: position && crossing.lat != null && crossing.lon != null
      ? distanceKm(position.lat, position.lon, crossing.lat, crossing.lon)
      : undefined,
  })), [catalog, position]);

  const savedIds = useMemo(() => new Set(saved.map((item) => item.id)), [saved]);
  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("de-DE");
    const list = enrichedCatalog.filter((item) =>
      !q || item.name.toLocaleLowerCase("de-DE").includes(q)
    );
    return position && !q
      ? list.filter((item) => item.distance != null).sort((a, b) => (a.distance ?? 99999) - (b.distance ?? 99999)).slice(0, 30)
      : list.slice(0, 50);
  }, [enrichedCatalog, query, position]);

  function requestLocation() {
    if (!navigator.geolocation) {
      setLocationState("error");
      setNotice("Dein Browser unterstützt leider keine Standortfreigabe.");
      return;
    }
    setLocationState("loading");
    setNotice("");
    navigator.geolocation.getCurrentPosition(
      (result) => {
        setPosition({ lat: result.coords.latitude, lon: result.coords.longitude });
        setLocationState("ready");
      },
      (error) => {
        setLocationState(error.code === error.PERMISSION_DENIED ? "denied" : "error");
        setNotice(error.code === error.PERMISSION_DENIED
          ? "Standortzugriff nicht erlaubt. Du kannst weiterhin manuell suchen."
          : "Dein Standort konnte nicht ermittelt werden. Bitte versuche es erneut oder suche manuell.");
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  }

  async function toggleCrossing(crossing: Crossing & { distance?: number }) {
    setNotice("");
    if (savedIds.has(crossing.id)) {
      if (saved.length === 1) {
        setNotice("Mindestens eine Schranke muss gespeichert bleiben.");
        return;
      }
      if (isSignedIn) {
        const response = await fetch("/api/user/crossings", {
          method: "DELETE", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ crossingId: crossing.id }),
        });
        if (!response.ok) { setNotice("Die Schranke konnte nicht entfernt werden."); return; }
      }
      const next = saved.filter((item) => item.id !== crossing.id);
      setSaved(next);
      if (activeId === crossing.id) setActiveId(next[0]?.id ?? "");
      return;
    }
    if (saved.length >= MAX_CROSSINGS) {
      setNotice(`Du kannst maximal ${MAX_CROSSINGS} Schranken speichern.`);
      return;
    }
    if (isSignedIn) {
      const response = await fetch("/api/user/crossings", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ crossingId: crossing.id }),
      });
      if (!response.ok) { setNotice(response.status === 409 ? "Du hast bereits die maximale Anzahl gespeichert." : "Die Schranke konnte nicht hinzugefügt werden."); return; }
    }
    const next = [...saved, crossing];
    setSaved(next);
    if (!activeId) setActiveId(crossing.id);
  }

  async function saveSelection() {
    setSaving(true);
    setNotice("");
    try {
      if (isSignedIn && activeId) {
        await fetch("/api/user/crossings", {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ crossingId: activeId, action: "favorite" }),
        });
        window.location.href = "/app";
      } else {
        setNotice("Deine Auswahl ist in diesem Vorschau-Modus auf diesem Gerät gespeichert.");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <a href="/app" className={styles.back} aria-label="Zurück">←</a>
        <div className={styles.brand}><span className={styles.mark}>///</span> meineschranke</div>
        <span className={styles.headerTag}>{isSignedIn ? "MEIN KONTO" : "VORSCHAU"}</span>
      </header>

      <div className={styles.content}>
        <div className={styles.heading}>
          <p className={styles.eyebrow}>DEINE PERSÖNLICHE AUSWAHL</p>
          <h1>Meine Schranken</h1>
          <p>Behalte die Bahnübergänge im Blick, die für deinen Alltag wichtig sind.</p>
        </div>

        <section className={styles.locationCard}>
          <div className={styles.pin}>⌖</div>
          <div className={styles.locationCopy}>
            <h2>Schranken in deiner Nähe finden</h2>
            <p>Erlaube meineschranke den Zugriff auf deinen Standort, damit wir passende Bahnübergänge in deiner Umgebung anzeigen können.</p>
            <div className={styles.locationActions}>
              <button className={styles.primary} onClick={requestLocation} disabled={locationState === "loading"}>
                {locationState === "loading" ? "Standort wird ermittelt …" : "⌖ Standort freigeben"}
              </button>
              <button className={styles.textButton} onClick={() => { setPosition(null); setLocationState("idle"); }}>
                Manuell suchen
              </button>
            </div>
            <div className={styles.privacy}><span>♢</span> Dein Standort wird nur auf deinem Gerät für die Umkreissuche verwendet. Wir übertragen und speichern keine GPS-Koordinaten.</div>
            {locationState === "ready" && <div className={styles.success}>✓ Standort lokal ermittelt – Schranken nach Entfernung sortiert.</div>}
          </div>
        </section>

        <label className={styles.search}>
          <span>⌕</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ort, Straße oder Bahnübergang suchen" />
          {query && <button onClick={() => setQuery("")} aria-label="Suche löschen"}>×</button>}
        </label>

        <div className={styles.columns}>
          <section className={styles.listSection}>
            <div className={styles.sectionHeading}>
              <div><h2>Deine Schranken</h2><p>Deine gespeicherten Bahnübergänge</p></div>
              <span className={styles.counter}>{saved.length} / {MAX_CROSSINGS}</span>
            </div>
            {loading ? <div className={styles.empty}>Lade deine Schranken …</div> : saved.length === 0 ? (
              <div className={styles.empty}>Du hast noch keine Schranke gespeichert. Suche einen Bahnübergang oder nutze die Standortfreigabe.</div>
            ) : (
              <div className={styles.list}>
                {saved.map((crossing) => (
                  <article className={styles.item} key={crossing.id}>
                    <span className={styles.crossingIcon}>⚒</span>
                    <button className={styles.itemMain} onClick={() => setActiveId(crossing.id)}>
                      <strong>{crossing.name}</strong>
                      <small>{activeId === crossing.id ? "● Aktive Schranke" : "Als aktive Schranke auswählen"}</small>
                    </button>
                    <button className={styles.remove} onClick={() => toggleCrossing(crossing)} aria-label={crossing.name + " entfernen"}>×</button>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className={styles.listSection}>
            <div className={styles.sectionHeading}>
              <div><h2>{position && !query ? "In deiner Nähe" : "Bahnübergänge finden"}</h2><p>{position && !query ? "Nach Entfernung sortiert" : "Suche und füge weitere Schranken hinzu"}</p></div>
              {position && <span className={styles.nearbyBadge}>GPS aktiv</span>}
            </div>
            {filtered.length === 0 ? <div className={styles.empty}>{query ? "Keine passenden Bahnübergänge gefunden." : "Keine Standortdaten verfügbar. Suche bitte manuell."}</div> : (
              <div className={styles.list}>
                {filtered.filter((item) => !savedIds.has(item.id)).map((crossing) => (
                  <article className={styles.item} key={crossing.id}>
                    <span className={styles.crossingIcon}>⚒</span>
                    <div className={styles.itemMain}>
                      <strong>{crossing.name}</strong>
                      <small>{formatDistance(crossing.distance) || "Bahnübergang"}</small>
                    </div>
                    <button className={styles.add} onClick={() => toggleCrossing(crossing)} aria-label={crossing.name + " hinzufügen"}>+</button>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>

        {notice && <div className={styles.notice}>{notice}</div>}
        <div className={styles.footer}>
          <div><strong>{saved.length} Schranken ausgewählt</strong><small>Du kannst deine Auswahl jederzeit ändern.</small></div>
          <button className={styles.primary} onClick={saveSelection} disabled={saving || saved.length === 0}>{saving ? "Speichere …" : "Auswahl speichern →"}</button>
        </div>
      </div>
    </main>
  );
}
