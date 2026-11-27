"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { useCrossings } from "../../context/CrossingsContext";
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
  const { saved, available, activeId, favoriteId, maxCrossings, purchasedSlots, premiumPackage, setActiveId, setFavorite, addCrossing, removeCrossing } = useCrossings();
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState<{ lat: number; lon: number } | null>(null);
  const [locationState, setLocationState] = useState<"idle" | "loading" | "ready" | "denied" | "error">("idle");
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState("");
  const [modalSlot, setModalSlot] = useState<number | null>(null);
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
      .slice(0, query || position ? 80 : 30);
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

  async function chooseCrossing(id: string) {
    const slotIndex = modalSlot;
    if (slotIndex == null) return;
    const crossing = available.find((item) => item.id === id);
    if (!crossing) {
      setNotice("Dieser Bahnübergang ist nicht mehr verfügbar. Bitte lade die Seite neu.");
      return;
    }
    const replaced = saved[slotIndex];
    setBusyId(id);
    setNotice("");
    try {
      await addCrossing(crossing, replaced?.id);
      setModalSlot(null);
      setQuery("");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Die Schranke konnte nicht gespeichert werden.");
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
    try {
      await setFavorite(activeId);
      window.location.href = "/app";
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Deine Auswahl konnte nicht gespeichert werden.");
      setSaving(false);
    }
  }

  const slotCount = Math.max(maxCrossings, saved.length);

  return (
    <main className={styles.page}>
      <div className={styles.wrap}>
        <section className={styles.slotsPanel}>
          <div className={styles.panelHead}>
            <div>
              <span className={styles.overline}>DEINE AUSWAHL</span>
              <h2>Deine Schranken-Plätze</h2>
              <p className={styles.slotIntro}>Tippe auf ein Plus, um einen Bahnübergang hinzuzufügen. Belegte Plätze kannst du jederzeit austauschen.</p>
            </div>
            <span className={styles.slotCountChip}><strong>{saved.length}</strong><span>/ {maxCrossings} Plätze belegt</span></span>
          </div>
          <div className={styles.slotGrid}>
            {Array.from({ length: slotCount }, (_, index) => {
              const crossing = saved[index];
              const active = crossing?.id === activeId;
              const favorite = crossing?.id === favoriteId;
              return crossing ? (
                <article className={`${styles.slotCard} ${active ? styles.slotActive : ""}`} key={crossing.id}>
                  <button className={styles.slotMain} onClick={() => setActiveId(crossing.id)} aria-pressed={active}>
                    <span className={styles.slotNumber}>PLATZ {String(index + 1).padStart(2, "0")}</span>
                    <span className={styles.crossingGlyph} aria-hidden="true"><i /><i /></span>
                    <strong>{crossing.name}</strong>
                    <span className={styles.slotStatus}>{active ? "Aktuell ausgewählt" : "Als aktive Schranke auswählen"}</span>
                    {position && crossing.lat != null && crossing.lon != null && (
                      <span className={styles.slotDistance}>
                        {distanceLabel(distanceKm(position, { lat: crossing.lat, lon: crossing.lon }))}
                      </span>
                    )}
                  </button>
                  <div className={styles.slotActions}>
                    <button className={favorite ? styles.favoriteActive : styles.favorite} onClick={() => setFavorite(crossing.id)} aria-label="Als Favorit festlegen" title="Favorit">★</button>
                    <button className={styles.slotEdit} onClick={() => { setModalSlot(index); setQuery(""); }} aria-label="Bahnübergang austauschen" title="Bahnübergang bearbeiten"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z" /></svg></button>
                    <button className={styles.remove} onClick={() => remove(crossing.id)} disabled={busyId === crossing.id || saved.length <= 1} aria-label="Platz leeren" title="Entfernen">×</button>
                  </div>
                </article>
              ) : (
                <button className={styles.emptySlot} key={`empty-${index}`} onClick={() => { setModalSlot(index); setQuery(""); }}>
                  <span className={styles.emptyPlus}>+</span>
                  <strong>Bahnübergang hinzufügen</strong>
                  <small>Freier Platz {index + 1}</small>
                </button>
              );
            })}
          </div>
          {saved.length > maxCrossings && (
            <p className={styles.limitNote}>Dein Premium-Kontingent ist abgelaufen. Deine gespeicherten Schranken bleiben erhalten. Entferne bitte {saved.length - maxCrossings} Platz/Plätze, bevor du neue hinzufügen kannst.</p>
          )}
          <div className={styles.helper}><span>ⓘ</span> Jeder Platz kann beliebig oft mit einem anderen Bahnübergang belegt werden. Deine Prognosen bleiben davon unberührt.</div>
        </section>

        <section className={styles.profilePanel}>
          <div>
            <span className={styles.overline}>MEHR PLÄTZE</span>
            <h2>Mehr Schranken im Blick</h2>
            <p>+{premiumPackage.additionalCrossings} zusätzliche Plätze ·{" "}
              {(premiumPackage.priceCents / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" })} brutto · {premiumPackage.durationDays} Tage Laufzeit</p>
            <p>{premiumPackage.enabled ? "Das Paket ist verfügbar." : "Premium wird zu einem späteren Zeitpunkt freigeschaltet."}</p>
          </div>
          <span className={styles.pill}>{premiumPackage.enabled ? "Verfügbar" : "Demnächst"}</span>
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
          <div><strong>{saved.length} von {maxCrossings} Plätzen belegt</strong><small>{purchasedSlots > 0 ? `${purchasedSlots} Premium-Plätze aktiv` : "Deine Auswahl wird mit deinem Konto synchronisiert."}</small></div>
          <button onClick={save} disabled={saving || !activeId}>{saving ? "Speichert …" : "Fertig"} <span>→</span></button>
        </div>
        <Link className={styles.backLink} href="/app">← Zurück zur BÜ-Übersicht</Link>
      </div>

      {modalSlot != null && (
        <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setModalSlot(null); }}>
          <section className={styles.crossingModal} role="dialog" aria-modal="true" aria-labelledby="crossing-modal-title">
            <div className={styles.modalHeader}>
              <div>
                <span className={styles.overline}>{saved[modalSlot] ? "PLATZ AUSTAUSCHEN" : "PLATZ BELEGEN"}</span>
                <h2 id="crossing-modal-title">Welchen Bahnübergang möchtest du {saved[modalSlot] ? "hier anzeigen" : "hinzufügen"}?</h2>
                <p>Suche nach einem Ort oder finde Bahnübergänge in deiner Nähe.</p>
              </div>
              <button className={styles.modalClose} onClick={() => setModalSlot(null)} aria-label="Fenster schließen">×</button>
            </div>
            <div className={styles.modalTools}>
              <label className={styles.search}>
                <span>⌕</span>
                <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ort oder Bahnübergang suchen …" />
                {query && <button type="button" onClick={() => setQuery("")} aria-label="Suche leeren">×</button>}
              </label>
              <button className={styles.locationButton} onClick={locate} disabled={locationState === "loading"}>
                <span>⌖</span>{locationState === "loading" ? "Suche läuft …" : locationState === "ready" ? "Standort aktiv" : "In meiner Nähe"}
              </button>
            </div>
            {locationState === "ready" && <p className={styles.locationNote}>Nach Entfernung sortiert. Deine Standortdaten bleiben auf deinem Gerät.</p>}
            {notice && <div className={styles.modalError} role="alert">{notice}</div>}
            <div className={styles.modalResults}>
              {results.length === 0 ? (
                <div className={styles.noResults}>{available.length === 0 ? "Bahnübergänge werden geladen …" : "Keine passenden Bahnübergänge gefunden."}</div>
              ) : results.map((crossing) => (
                <button className={styles.modalResult} key={crossing.id} onClick={() => chooseCrossing(crossing.id)} disabled={busyId === crossing.id}>
                  <span className={styles.resultGlyph}><i /><i /></span>
                  <span className={styles.resultName}><strong>{crossing.name}</strong><small>{distanceLabel(crossing.distance)}</small></span>
                  <span className={styles.modalAdd}>{busyId === crossing.id ? <span className={styles.modalSpinner} aria-label="Wird gespeichert" /> : "+"}</span>
                </button>
              ))}
            </div>
            <div className={styles.modalFooter}>
              <span>{results.length} passende Bahnübergänge</span>
              <button onClick={() => setModalSlot(null)}>Abbrechen</button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
