"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { useCrossings } from "../../context/CrossingsContext";
import { FREE_CROSSING_LIMIT, PREMIUM_CROSSING_PACKAGE } from "../../lib/subscription-config";
import styles from "./page.module.css";
import ContentPreferences from "../../components/ContentPreferences";

function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const rad = (n: number) => (n * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function distanceLabel(km?: number) {
  if (km == null || !Number.isFinite(km)) return "Bahnübergang";
  return km < 10 ? km.toLocaleString("de-DE", { maximumFractionDigits: 1 }) + " km entfernt" : Math.round(km) + " km entfernt";
}

export default function MeineSchrankenPage() {
  const { saved, available, activeId, favoriteId, setActiveId, setFavorite, addCrossing, removeCrossing } = useCrossings();
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState<{ lat: number; lon: number } | null>(null);
  const [locationState, setLocationState] = useState<"idle" | "loading" | "ready" | "denied" | "error">("idle");
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState("");
  const [saving, setSaving] = useState(false);

  const savedIds = useMemo(() => new Set(saved.map((item) => item.id)), [saved]);
  const results = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("de-DE");
    return available
      .filter((item) => !savedIds.has(item.id) && (!q || item.name.toLocaleLowerCase("de-DE").includes(q)))
      .map((item) => ({
        ...item,
        distance: position && item.lat != null && item.lon != null
          ? distanceKm(position, { lat: item.lat, lon: item.lon })
          : undefined,
      }))
      .sort((a, b) => {
        if (position && a.distance != null && b.distance != null) return a.distance - b.distance;
        return a.name.localeCompare(b.name, "de");
      })
      .slice(0, query || position ? 60 : 24);
  }, [available, position, query, savedIds]);

  function locate() {
    if (!navigator.geolocation) {
      setLocationState("error");
      setNotice("Standortfreigabe wird von diesem Browser nicht unterstützt.");
      return;
    }
    setLocationState("loading");
    setNotice("");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setPosition({ lat: coords.latitude, lon: coords.longitude });
        setLocationState("ready");
      },
      (error) => {
        setLocationState(error.code === error.PERMISSION_DENIED ? "denied" : "error");
        setNotice(error.code === error.PERMISSION_DENIED
          ? "Kein Zugriff auf deinen Standort. Du kannst weiterhin manuell suchen."
          : "Dein Standort konnte nicht ermittelt werden. Bitte versuche es erneut.");
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  }

  async function add(id: string) {
    if (saved.length >= FREE_CROSSING_LIMIT) {
      setNotice(`Du kannst maximal ${FREE_CROSSING_LIMIT} Schranken speichern.`);
      return;
    }
    setBusyId(id);
    setNotice("");
    const crossing = available.find((item) => item.id === id);
    try {
      if (!crossing) throw new Error("Dieser Bahnübergang ist nicht mehr verfügbar. Bitte lade die Seite neu.");
      await addCrossing(crossing);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Die Schranke konnte nicht hinzugefügt werden.");
    } finally {
      setBusyId("");
    }
  }

  async function remove(id: string) {
    if (saved.length <= 1) {
      setNotice("Mindestens eine Schranke muss gespeichert bleiben.");
      return;
    }
    setBusyId(id);
    setNotice("");
    await removeCrossing(id);
    setBusyId("");
  }

  async function save() {
    if (!activeId) return;
    setSaving(true);
    setNotice("");
    await setFavorite(activeId);
    setSaving(false);
    window.location.href = "/app";
  }

  return (
    <main className={styles.page}>
      <div className={styles.wrap}>
        <section className={styles.intro}>
          <div>
            <div className={styles.kicker}><span /> DEIN ÜBERBLICK</div>
            <h1>Meine Schranken</h1>
            <p>Verwalte deine Bahnübergänge und lege fest, welche Schranke beim Öffnen der App zuerst angezeigt wird.</p>
          </div>
          <div className={styles.countCard}>
            <strong>{saved.length}<span>/{FREE_CROSSING_LIMIT}</span></strong>
            <small>gespeichert</small>
          </div>
        </section>

        <section className={styles.profilePanel}>
          <div>
            <span className={styles.overline}>PREMIUM-PAKET</span>
            <h2>Mehr Schranken im Blick</h2>
            <p>
              +{PREMIUM_CROSSING_PACKAGE.additionalCrossings} zusätzliche Bahnübergänge ·{" "}
              {(PREMIUM_CROSSING_PACKAGE.priceCents / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" })} brutto ·{" "}
              {PREMIUM_CROSSING_PACKAGE.durationDays} Tage Laufzeit
            </p>
            <p>
              {PREMIUM_CROSSING_PACKAGE.enabled
                ? "Das Paket ist verfügbar."
                : "Der Kauf wird freigeschaltet, sobald der Katalog ausreichend ausgebaut ist."}
            </p>
          </div>
          <span className={styles.pill}>
            {PREMIUM_CROSSING_PACKAGE.enabled ? "Verfügbar" : "Demnächst"}
          </span>
        </section>

        <section className={styles.savedPanel}>
          <div className={styles.panelHead}>
            <div>
              <span className={styles.overline}>DEINE AUSWAHL</span>
              <h2>Gespeicherte Schranken</h2>
            </div>
            <span className={styles.pill}>{saved.length} von {FREE_CROSSING_LIMIT}</span>
          </div>
          {saved.length === 0 ? (
            <div className={styles.emptySaved}>
              <span className={styles.emptyIcon}>⌁</span>
              <strong>Noch keine Schranke gespeichert</strong>
              <p>Suche unten nach einem Bahnübergang und füge ihn deiner Liste hinzu.</p>
            </div>
          ) : (
            <div className={styles.savedList}>
              {saved.map((crossing, index) => {
                const active = crossing.id === activeId;
                const favorite = crossing.id === favoriteId;
                return (
                  <article className={`${styles.savedItem} ${active ? styles.activeItem : ""}`} key={crossing.id}>
                    <button className={styles.selectItem} onClick={() => { setActiveId(crossing.id); setNotice(""); }} aria-pressed={active}>
                      <span className={styles.number}>{String(index + 1).padStart(2, "0")}</span>
                      <span className={styles.crossingGlyph} aria-hidden="true"><i /><i /></span>
                      <span className={styles.crossingName}>
                        <strong>{crossing.name}</strong>
                        <small>{active ? "Wird aktuell in der App angezeigt" : "Antippen, um diese Schranke auszuwählen"}</small>
                      </span>
                      <span className={styles.radioMark}>{active ? "✓" : ""}</span>
                    </button>
                    <div className={styles.itemActions}>
                      <button className={favorite ? styles.favoriteActive : styles.favorite} onClick={async () => { try { await setFavorite(crossing.id); setNotice(""); } catch (error) { setNotice(error instanceof Error ? error.message : "Favorit konnte nicht gespeichert werden."); } }} aria-label="Als Favorit festlegen" title="Favorit">★</button>
                      <button className={styles.remove} onClick={() => remove(crossing.id)} disabled={busyId === crossing.id || saved.length <= 1} aria-label="Schranke entfernen">×</button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
          <div className={styles.helper}><span>ⓘ</span> Die aktive Schranke erscheint direkt in deiner App. Mit ★ legst du deinen Favoriten fest.</div>
        </section>

        <section className={styles.findSection}>
          <div className={styles.findIntro}>
            <div>
              <span className={styles.overline}>ERWEITERN</span>
              <h2>Weitere Schranken hinzufügen</h2>
              <p>Finde Bahnübergänge über den Namen oder deinen aktuellen Standort.</p>
            </div>
            <button className={styles.locationButton} onClick={locate} disabled={locationState === "loading"}>
              <span>⌖</span>{locationState === "loading" ? "Suche läuft …" : locationState === "ready" ? "Standort aktualisieren" : "In meiner Nähe"}
            </button>
          </div>

          <label className={styles.search}>
            <span>⌕</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ort oder Bahnübergang suchen …" />
            {query && <button type="button" onClick={() => setQuery("")} aria-label="Suche leeren">×</button>}
          </label>

          {locationState === "ready" && <div className={styles.locationNote}>Standort gefunden – Ergebnisse sind nach Entfernung sortiert. Deine GPS-Daten bleiben auf deinem Gerät.</div>}
          {results.length === 0 ? (
            <div className={styles.noResults}>{available.length === 0 ? "Die Schrankenliste wird geladen …" : "Keine weiteren passenden Bahnübergänge gefunden."}</div>
          ) : (
            <div className={styles.results}>
              {results.map((crossing) => (
                <article className={styles.resultItem} key={crossing.id}>
                  <span className={styles.resultGlyph}><i /><i /></span>
                  <span className={styles.resultName}><strong>{crossing.name}</strong><small>{distanceLabel(crossing.distance)}</small></span>
                  <button className={styles.addButton} onClick={() => add(crossing.id)} disabled={busyId === crossing.id || saved.length >= FREE_CROSSING_LIMIT} aria-label={`${crossing.name} hinzufügen`}>
                    {busyId === crossing.id ? "…" : "+"}
                  </button>
                </article>
              ))}
            </div>
          )}
          {saved.length >= FREE_CROSSING_LIMIT && <p className={styles.limitNote}>Du hast das Limit von {FREE_CROSSING_LIMIT} Schranken erreicht. Entferne eine Schranke, um eine andere hinzuzufügen.</p>}
        </section>

        <ContentPreferences />
        {notice && <div className={styles.notice} role="status">{notice}</div>}
        <section className={styles.profilePanel}>
          <div>
            <span className={styles.overline}>KONTO</span>
            <h2>Mein Profil</h2>
            <p>Verwalte hier deine Schranken. Dein Konto ist mit deiner Anmeldung verknüpft.</p>
          </div>
          <button className={styles.logoutButton} onClick={() => signOut({ callbackUrl: "/" })}>Abmelden</button>
        </section>
        <div className={styles.bottomBar}>
          <div><strong>{saved.length} Schranken in deiner Liste</strong><small>Deine Auswahl wird mit deinem Konto synchronisiert.</small></div>
          <button onClick={save} disabled={saving || !activeId}>{saving ? "Speichert …" : "Fertig"} <span>→</span></button>
        </div>
        <Link className={styles.backLink} href="/app">← Zurück zur BÜ-Übersicht</Link>
      </div>
    </main>
  );
}
