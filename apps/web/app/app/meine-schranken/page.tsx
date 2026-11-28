"use client";

import { useEffect, useMemo, useState } from "react";
import { signOut } from "next-auth/react";
import { FREE_CROSSING_LIMIT, useCrossings } from "../../context/CrossingsContext";
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

function formatEntitlementDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value.replace(" ", "T") + (value.endsWith("Z") ? "" : "Z"));
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(date);
}

export default function MeineSchrankenPage() {
  const {
    saved,
    available,
    activeId,
    favoriteId,
    maxCrossings,
    purchasedSlots,
    hydrated,
    nextExpirationAt,
    latestExpirationAt,
    premiumPackage,
    setActiveId,
    setFavorite,
    addCrossing,
    removeCrossing,
  } = useCrossings();
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState<{ lat: number; lon: number } | null>(null);
  const [locationState, setLocationState] = useState<"idle" | "loading" | "ready" | "denied" | "error">("idle");
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState("");
  const [modalSlot, setModalSlot] = useState<number | null>(null);
  const [checkoutBusy, setCheckoutBusy] = useState(false);

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
    try {
      await removeCrossing(id);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Die Schranke konnte nicht entfernt werden.");
    } finally {
      setBusyId("");
    }
  }

  useEffect(() => {
    const paymentState = new URLSearchParams(window.location.search).get("payment");
    if (paymentState === "success") {
      setNotice("Danke! Deine Zahlung wird bestätigt. Die zusätzlichen Plätze erscheinen, sobald Stripe die Zahlung verbucht hat. Lade die Seite anschließend neu.");
    } else if (paymentState === "cancelled") {
      setNotice("Der Bezahlvorgang wurde abgebrochen. Es wurde nichts berechnet.");
    }
  }, []);

  async function buyAdditionalSlots() {
    if (checkoutBusy) return;
    setCheckoutBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Stripe Checkout asks for the full billing address; the webhook checks the actual country.
        body: JSON.stringify({ billingCountry: "DE" }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.url) {
        throw new Error(result?.error || "Der Bezahlvorgang konnte nicht gestartet werden.");
      }
      window.location.assign(result.url);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Der Bezahlvorgang konnte nicht gestartet werden.");
      setCheckoutBusy(false);
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
                    <span className={styles.slotNumber}>{index < FREE_CROSSING_LIMIT ? "KOSTENLOS" : "PREMIUM"} · PLATZ {String(index + 1).padStart(2, "0")}</span>
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
                    <button className={styles.remove} onClick={() => remove(crossing.id)} disabled={busyId === crossing.id} aria-label="Platz leeren" title="Entfernen">×</button>
                  </div>
                </article>
              ) : (
                <button className={styles.emptySlot} key={`empty-${index}`} onClick={() => { setModalSlot(index); setQuery(""); }}>
                  <span className={styles.emptyPlus}>+</span>
                  <strong>{index < FREE_CROSSING_LIMIT ? "Bahnübergang hinzufügen" : "Premium-Platz belegen"}</strong>
                  <small>{index < FREE_CROSSING_LIMIT ? `Freier Platz ${index + 1}` : `Zusatzplatz ${index - FREE_CROSSING_LIMIT + 1}`}</small>
                </button>
              );
            })}
          </div>
          {saved.length > maxCrossings && (
            <p className={styles.limitNote}>Dein Premium-Kontingent ist abgelaufen. Deine gespeicherten Schranken bleiben erhalten. Entferne bitte {saved.length - maxCrossings} Platz/Plätze, bevor du neue hinzufügen kannst.</p>
          )}
        </section>

        <section className={styles.premiumCompact}>
          <div className={styles.premiumCopy}>
            <div className={styles.offerEyebrow}>
              <span className={styles.offerSpark} aria-hidden="true">✦</span>
              MEHR FREIHEIT MIT PREMIUM
            </div>
            <h2>Mehr Schranken. <span>Mehr Überblick.</span></h2>
            <p className={styles.offerLead}>
              Speichere zehn weitere Bahnübergänge und behalte bis zu 13 Orte gleichzeitig im Blick.
            </p>
            <div className={styles.premiumFacts}>
              <span><strong>+10</strong> Plätze</span>
              <span><strong>365</strong> Tage</span>
              <span><strong>1×</strong> zahlen · kein Abo</span>
            </div>
            {hydrated && purchasedSlots > 0 && (
              <div className={styles.premiumActive}>
                <span className={styles.premiumActiveDot} />
                <span>
                  {purchasedSlots} Premium-Zusatzplätze aktiv
                  {nextExpirationAt ? ` · nächster Ablauf ${formatEntitlementDate(nextExpirationAt) ?? nextExpirationAt}` : ""}
                  {latestExpirationAt && latestExpirationAt !== nextExpirationAt
                    ? ` · weitere Pakete bis ${formatEntitlementDate(latestExpirationAt) ?? latestExpirationAt}`
                    : ""}
                </span>
              </div>
            )}
          </div>

          <aside className={styles.premiumAction}>
            <div className={styles.premiumPriceBlock}>
              <strong>{(premiumPackage.priceCents / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" })}</strong>
              <span>einmalig · inkl. 19 % MwSt.</span>
            </div>
            {premiumPackage.enabled ? (
              <button className={styles.premiumCta} type="button" onClick={buyAdditionalSlots} disabled={checkoutBusy}>
                {checkoutBusy ? "Weiter zur Zahlung …" : purchasedSlots > 0 ? "Weitere 10 Plätze sichern" : "10 Plätze sichern"}
                <span aria-hidden="true">→</span>
              </button>
            ) : (
              <button className={styles.premiumCtaDisabled} type="button" disabled>
                <span>Premium startet bald</span>
              </button>
            )}
            <small>{premiumPackage.durationDays} Tage · Sichere Zahlung über Stripe · keine Verlängerung</small>
          </aside>
        </section>

        <ContentPreferences />
        <div className={styles.logoutRow}>
          <button className={styles.logoutButton} onClick={() => signOut({ callbackUrl: "/" })}>Abmelden</button>
        </div>
        {notice && <div className={styles.notice} role="status">{notice}</div>}
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
