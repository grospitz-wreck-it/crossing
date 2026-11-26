"use client";

import {
  useEffect,
  useState,
  useRef,
} from "react";
import LoadingScreen from "../components/LoadingScreen";
import { useCrossings } from "../context/CrossingsContext";

function formatSeconds(
  seconds: number
) {
  const mins = Math.floor(
    seconds / 60
  );

  const secs =
    seconds % 60;

  return `${mins
    .toString()
    .padStart(2, "0")}:${secs
    .toString()
    .padStart(2, "0")}`;
}
function formatDbTime(
  value?: string
) {
  if (!value) {
    return "--:--";
  }

  const yy = Number(
    value.slice(0, 2)
  );

  const mm = Number(
    value.slice(2, 4)
  );

  const dd = Number(
    value.slice(4, 6)
  );

  const hh = Number(
    value.slice(6, 8)
  );

  const mi = Number(
    value.slice(8, 10)
  );

  const date =
    new Date(
      Date.UTC(
        2000 + yy,
        mm - 1,
        dd,
        hh,
        mi
      )
    );

  return date.toLocaleTimeString(
    "de-DE",
    {
      hour: "2-digit",
      minute: "2-digit",
      timeZone:
        "Europe/Berlin",
    }
  );
}

function formatArrival(
  value?: string
) {
  return formatDbTime(
    value
  );
}

function formatIsoTime(
  value?: string
) {
  if (!value) {
    return "--:--";
  }

  return new Date(
    value
  ).toLocaleTimeString(
    "de-DE",
    {
      hour: "2-digit",
      minute: "2-digit",
      timeZone:
        "Europe/Berlin",
    }
  );
}

function getOrigin(
  train: any
) {
  return (
    train?.origin ??
    "--"
  );
}

function getDestination(
  train: any
) {
  return (
    train?.destination ??
    "--"
  );
}

const MAX_PHASE_MS =
  900 * 1000;

type EditorialNewsCarouselProps = { items: any[] };

function EditorialNewsCarousel({ items }: EditorialNewsCarouselProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [dragX, setDragX] = useState(0);
  const startX = useRef<number | null>(null);
  const startY = useRef<number | null>(null);
  const pointerId = useRef<number | null>(null);

  function handlePointerDown(event: React.PointerEvent<HTMLElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    startX.current = event.clientX;
    startY.current = event.clientY;
    pointerId.current = event.pointerId;
    if (event.target instanceof HTMLElement) event.target.setPointerCapture(event.pointerId);
    event.stopPropagation();
  }

  function handlePointerMove(event: React.PointerEvent<HTMLElement>) {
    if (pointerId.current !== event.pointerId || startX.current === null || startY.current === null) return;
    event.stopPropagation();
    const deltaX = event.clientX - startX.current;
    const deltaY = event.clientY - startY.current;
    if (Math.abs(deltaY) > Math.abs(deltaX) && Math.abs(deltaY) > 8) return;
    setDragX(deltaX);
  }

  function finishGesture(event: React.PointerEvent<HTMLElement>) {
    if (pointerId.current !== event.pointerId || startX.current === null || startY.current === null) return;
    event.stopPropagation();
    const deltaX = event.clientX - startX.current;
    const deltaY = event.clientY - startY.current;
    if (Math.abs(deltaX) >= 42 && Math.abs(deltaX) > Math.abs(deltaY)) {
      setActiveIndex((index) => Math.max(0, Math.min(items.length - 1, index + (deltaX < 0 ? 1 : -1))));
    }
    startX.current = null;
    startY.current = null;
    pointerId.current = null;
    setDragX(0);
  }

  function cancelGesture(event: React.PointerEvent<HTMLElement>) {
    event.stopPropagation();
    startX.current = null;
    startY.current = null;
    pointerId.current = null;
    setDragX(0);
  }

  const slideWidth = 100 / items.length;\n  const safeIndex = Math.min(activeIndex, items.length - 1);

  return (
    <section
      className="editorialContent"
      aria-label="Aktuelle Informationen"
      data-no-crossing-swipe
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishGesture}
      onPointerCancel={cancelGesture}
    >
      <div className="editorialContentHeader">
        <span>Aktuelle Informationen</span>
        {items.length > 1 && <span className="editorialContentCounter">{safeIndex + 1} / {items.length}</span>}
      </div>
      <div className="editorialContentViewport">
        <div
          className="editorialContentTrack"
          style={{
            width: `${items.length * 100}%`,
            transform: `translate3d(calc(-${safeIndex * slideWidth}% + ${dragX}px), 0, 0)`,
            transition: dragX === 0 ? "transform 240ms cubic-bezier(.22,1,.36,1)" : "none",
          }}
        >
          {items.map((item: any) => {
            const card = (
              <>
                <div className="editorialContentTop">
                  <span className="editorialContentIcon" style={{ background: (item.accent_color || "#f32643") + "20", color: item.accent_color || "#f32643" }}>{item.icon || "✨"}</span>
                  <span className="editorialContentType">{item.content_type === "local_news" ? "Lokal informiert" : item.content_type === "event" ? "Veranstaltung" : item.content_type === "partner" ? "Partner" : item.content_type === "onboarding" ? "Gut zu wissen" : "Tipp"}</span>
                </div>
                {item.image_url && <img className="editorialContentImage" src={item.image_url} alt="" loading="lazy" />}
                <h2>{item.title}</h2>
                {item.summary && <p>{item.summary}</p>}
                {item.action_type === "open_url" && item.action_url && <span className="editorialContentAction">Mehr erfahren <span aria-hidden="true">↗</span></span>}
              </>
            );
            return item.action_type === "open_url" && item.action_url ? (
              <a className="editorialContentCard" key={item.id} style={{ width: `${slideWidth}%`, borderColor: (item.accent_color || "#f32643") + "55" }} href={item.action_url} target="_blank" rel="noopener noreferrer">{card}</a>
            ) : (
              <article className="editorialContentCard" key={item.id} style={{ width: `${slideWidth}%`, borderColor: (item.accent_color || "#f32643") + "55" }}>{card}</article>
            );
          })}
        </div>
      </div>
      {items.length > 1 && (
        <div className="editorialContentPagination" aria-label="Information auswählen">
          {items.map((item: any, index: number) => (
            <button
              key={item.id}
              type="button"
              className={`editorialContentDot ${index === safeIndex ? "isActive" : ""}`}
              aria-label={`Information ${index + 1} anzeigen`}
              aria-current={index === safeIndex ? "true" : undefined}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => setActiveIndex(index)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export default function Home() {
const { activeId } = useCrossings();

const [data, setData] =
  useState<any>(null);
  const [ads, setAds] =
    useState<any[]>([]);
  const [contentItems, setContentItems] = useState<any[]>([]);

  const [currentAdIndex, setCurrentAdIndex] =
    useState(0);

  const [now, setNow] =
    useState(Date.now());

  const [
    showMoreTrains,
    setShowMoreTrains,
  ] = useState(false);

  const [showAllClosures, setShowAllClosures] = useState(false);

  const [
    measurementState,
    setMeasurementState,
  ] = useState<
    | "none"
    | "close-recorded"
    | "open-recorded"
  >("none");

  const [
    firstClickAt,
    setFirstClickAt,
  ] = useState<
    number | null
  >(null);

  const [
    pendingEvent,
    setPendingEvent,
  ] = useState<
    "close" | "open" | null
  >(null);

  const [
    message,
    setMessage,
  ] = useState("");
  const [unexpectedTrainSaved, setUnexpectedTrainSaved] = useState(false);
  const [savingMeasurement, setSavingMeasurement] = useState(false);
  const [savingUnexpectedTrain, setSavingUnexpectedTrain] = useState(false);

  const refreshTimeout =
    useRef<ReturnType<typeof setTimeout> | null>(
      null
    );

const activeIdRef = useRef<string | null>(activeId);
activeIdRef.current = activeId;

const statusCacheRef = useRef<Map<string, any>>(new Map());
const statusInFlightRef = useRef<Map<string, Promise<void>>>(new Map());
const adCacheRef = useRef<Map<string, any[]>>(new Map());
const contentCacheRef = useRef<Map<string, any[]>>(new Map());

async function load(crossingId: string | null = activeIdRef.current, force = false) {
  if (!crossingId) return;

  const cached = statusCacheRef.current.get(crossingId);
  if (cached && !force) {
    if (activeIdRef.current === crossingId) {
      setData(cached);
      setAds(adCacheRef.current.get(crossingId) || []);
      setContentItems(contentCacheRef.current.get(crossingId) || []);
    }
    return;
  }

  const existing = statusInFlightRef.current.get(crossingId);
  if (existing) return existing;

  const request = (async () => {
    try {
      const [statusRes, adRes, contentRes] = await Promise.all([
        fetch(`/api/crossings/${crossingId}/status`, { cache: "no-store" }),
        fetch(`/api/ads/${crossingId}`, { cache: "no-store" }),
        fetch(`/api/content/${crossingId}`, { cache: "no-store" }),
      ]);
      if (!statusRes.ok) throw new Error(`Status API returned ${statusRes.status}`);

      const json = await statusRes.json();
      statusCacheRef.current.set(crossingId, json);

      let adList: any[] = [];
      if (adRes.ok) {
        const list = await adRes.json();
        adList = Array.isArray(list) ? list : [];
      }
      adCacheRef.current.set(crossingId, adList);
      let editorialItems: any[] = [];
      if (contentRes.ok) {
        const list = await contentRes.json();
        editorialItems = Array.isArray(list) ? list : [];
      }
      contentCacheRef.current.set(crossingId, editorialItems);

      if (activeIdRef.current === crossingId) {
        setData(json);
        setAds(adList);
        setContentItems(editorialItems);
        setCurrentAdIndex(0);
      }
    } catch (error) {
      console.error(`Failed to load crossing ${crossingId}:`, error);
      if (activeIdRef.current === crossingId) {
        setData({ error: true, state: "UNKNOWN", phase: null, closures: [], trains: [], trainCount: 0 });
        setAds([]);
        setContentItems([]);
      }
    } finally {
      if (statusInFlightRef.current.get(crossingId) === request) {
        statusInFlightRef.current.delete(crossingId);
      }
    }
  })();

  statusInFlightRef.current.set(crossingId, request);
  return request;
}

async function saveUnexpectedTrain() {
  if (!data?.predictionId || measurementState !== "close-recorded" || unexpectedTrainSaved || savingUnexpectedTrain) {
    return;
  }

  setSavingUnexpectedTrain(true);
  try {
    const response = await fetch("/api/measurements/flag", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        predictionId: data.predictionId,
        flag: "unexpected_train",
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.success !== true) {
      throw new Error(result.error || "Der Sonderfall konnte nicht gespeichert werden.");
    }

    setUnexpectedTrainSaved(true);
    setMessage("✓ Güterzug-Sonderfall gespeichert");
  } catch (error) {
    console.error("Unexpected train flag failed:", error);
    setMessage("⚠️ Speichern fehlgeschlagen – bitte erneut versuchen");
  } finally {
    setSavingUnexpectedTrain(false);
    setTimeout(() => setMessage(""), 4000);
  }
}

async function saveMeasurement(
  event: "close" | "open",
  precision: "exact" | "at_least"
) {
  if (!data?.predictionId || savingMeasurement) return;
  if (event === "close" && measurementState === "close-recorded") return;
  if (event === "open" && measurementState === "open-recorded") return;

  setSavingMeasurement(true);
  try {
    const response = await fetch("/api/measurements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        predictionId: data.predictionId,
        event,
        actualAt: new Date().toISOString(),
        phase: data.phase,
        precision,
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.success !== true) {
      throw new Error(result.error || "Die Messung konnte nicht gespeichert werden.");
    }

    if (event === "close") {
      setMeasurementState("close-recorded");
      setFirstClickAt(Date.now());
      setUnexpectedTrainSaved(false);
      setMessage(precision === "exact"
        ? "✓ Schranke geschlossen – Messung gespeichert"
        : "✓ Zustand erfasst (Zeitpunkt ungenau)");
    } else {
      setMeasurementState("none");
      setFirstClickAt(null);
      setUnexpectedTrainSaved(false);
      setMessage(precision === "exact"
        ? "✓ Schranke offen – Messung gespeichert"
        : "✓ Öffnungszustand erfasst (Zeitpunkt ungenau)");
    }
  } catch (error) {
    console.error("Measurement save failed:", error);
    setMessage("⚠️ Speichern fehlgeschlagen – bitte erneut versuchen");
  } finally {
    setSavingMeasurement(false);
    setTimeout(() => setMessage(""), 4000);
  }
}

const wakeLockRef =
    useRef<any>(null);

  async function requestWakeLock() {
    if (!("wakeLock" in navigator)) {
      return;
    }

    try {
      wakeLockRef.current =
        await (
          navigator as any
        ).wakeLock.request(
          "screen"
        );
    } catch (error) {
      console.error(
        "Wake Lock request failed:",
        error
      );
    }
  }

  useEffect(() => {
  if (!activeId) {
    setData(null);
    setAds([]);
    setContentItems([]);
    setCurrentAdIndex(0);
    return;
  }

  const cached = statusCacheRef.current.get(activeId);
  setData(cached || null);
  setAds(adCacheRef.current.get(activeId) || []);
  setContentItems([]);
  setCurrentAdIndex(0);
  setShowMoreTrains(false);
  setPendingEvent(null);

  void load(activeId, !cached);
  const apiRefresh = setInterval(() => void load(activeId, true), 120000);
  return () => clearInterval(apiRefresh);
}, [activeId]);

useEffect(() => {
  requestWakeLock();

  function handleWakeLockVisibility() {
    if (
      document.visibilityState ===
      "visible"
    ) {
      requestWakeLock();
    }
  }

  document.addEventListener(
    "visibilitychange",
    handleWakeLockVisibility
  );

  return () => {
    document.removeEventListener(
      "visibilitychange",
      handleWakeLockVisibility
    );

    if (wakeLockRef.current) {
      wakeLockRef.current
        .release()
        .catch(() => {});

      wakeLockRef.current = null;
    }
  };
}, []);

useEffect(() => {
  if (ads.length <= 1) {
    return;
  }

  const timer = setInterval(() => {
    setCurrentAdIndex((i) =>
      (i + 1) % ads.length
    );
  }, 30000);

  return () =>
    clearInterval(timer);
}, [ads]);
useEffect(() => {
  if (!firstClickAt) {
    return;
  }

  const interval =
    setInterval(() => {
      const elapsed =
        Date.now() -
        firstClickAt;

      if (
        elapsed >
        MAX_PHASE_MS
      ) {
        setMeasurementState(
          "none"
        );

        setFirstClickAt(
          null
        );

        setMessage(
          "⚠️ Messung verworfen"
        );

        setTimeout(() => {
          setMessage("");
        }, 3000);
      }
    }, 1000);

  return () =>
    clearInterval(
      interval
    );
}, [firstClickAt]);
useEffect(() => {
  function refresh() {
    const crossingId = activeIdRef.current;
    if (crossingId) void load(crossingId, true);
  }
  function handleVisibility() {
    if (document.visibilityState === "visible") refresh();
  }
  document.addEventListener("visibilitychange", handleVisibility);
  window.addEventListener("focus", refresh);
  window.addEventListener("pageshow", refresh);
  return () => {
    document.removeEventListener("visibilitychange", handleVisibility);
    window.removeEventListener("focus", refresh);
    window.removeEventListener("pageshow", refresh);
  };
}, []);

useEffect(() => {
  const timer =
    setInterval(() => {
      setNow(Date.now());
    }, 1000);

  return () =>
    clearInterval(timer);
}, []);
useEffect(() => {
  if (!data?.phase) {
    return;
  }

  if (refreshTimeout.current) {
    clearTimeout(
      refreshTimeout.current
    );
  }

  const crossingId = activeId;
  const target = new Date(
    data.state === "OPEN" ? data.phase.start : data.phase.end
  ).getTime();

  const delay =
    Math.max(
      0,
      target - Date.now()
    ) + 500;

  refreshTimeout.current =
    setTimeout(() => {
      if (crossingId) void load(crossingId, true);
    }, delay);

  return () => {
    if (
      refreshTimeout.current
    ) {
      clearTimeout(
        refreshTimeout.current
      );
    }
  };
}, [data, activeId]);

if (!data) {
  return <LoadingScreen />;
}

if (!data.phase || !data.phase.trains?.length) {
  return (
    <main className="container">
      <div className="heroCard">
        Keine aktuellen Zugdaten verfügbar.
      </div>
    </main>
  );
}

const closeTime =
  formatIsoTime(
    data.phase.start
  );

const openTime =
  formatIsoTime(
    data.phase.end
  );

const closureDuration =
  data.phase.durationMinutes;

const train =
  data.phase.trains[0];

// Der Status muss lokal am exakten Phasenwechsel umspringen.
// Die API-Antwort kann noch OPEN enthalten, wenn der Countdown gerade 0 erreicht.
const phaseStartMs = new Date(data.phase.start).getTime();
const phaseEndMs = new Date(data.phase.end).getTime();
const displayState =
  now >= phaseStartMs && now < phaseEndMs
    ? "CLOSED"
    : now < phaseStartMs
      ? "OPEN"
      : data.state;

  const countdown =
  data?.phase
    ? Math.max(
        0,
        Math.floor(
          (
            new Date(
              displayState === "OPEN"
                ? data.phase.start
                : data.phase.end
            ).getTime() -
            now
          ) / 1000
        )
      )
    : 0;
if (!train) {
  return (
    <main className="container">
      <div className="heroCard">
        Keine aktuellen Zugdaten verfügbar.
      </div>
    </main>
  );
}
const ad =
  ads[currentAdIndex];
const heroImage =
  displayState === "OPEN"
    ? "/images/barrier-open.webp"
    : "/images/barrier-closed.webp";

return (
  <main className="container">

  <div className="logo">
    {data.crossing?.name
      ? `GEMEINDE ${data.crossing.name.toUpperCase()}`
      : "GEMEINDE KIRCHLENGERN"}
  </div>

  <div
  className={`heroCard ${
    displayState === "OPEN"
      ? "heroCardOpen"
      : "heroCardClosed"
  }`}
>

  <div className="heroVisual">

  <img
    src={heroImage}
    alt={
      displayState === "OPEN"
        ? "Bahnübergang offen"
        : "Bahnübergang geschlossen"
    }
    className="heroImage"
  />

</div>

<div className="heroContent">

  <div
    className={`statusBadge ${
      displayState === "OPEN"
        ? "badgeOpen"
        : "badgeClosed"
    }`}
  >
    ●{" "}
    {displayState === "OPEN"
      ? "OFFEN"
      : "GESCHLOSSEN"}
  </div>

  <div className="heroTimer">
    {formatSeconds(
      countdown
    )}
  </div>

  <div className="heroSubtitle">
    {displayState === "OPEN"
      ? "bis Schranke schließt"
      : "bis Schranke öffnet"}
  </div>

  <div className="heroStats">

  <div className="heroStatCard">
    <div className="heroStatIcon">
      🕒
    </div>

    <div className="heroStatValue">
      {formatIsoTime(data.phase?.start)}
    </div>

    <div className="heroStatLabel">
      Schließt
    </div>
  </div>

  <div className="heroStatCard">
    <div className="heroStatIcon">
      🔓
    </div>

    <div className="heroStatValue">
      {formatIsoTime(data.phase?.end)}
    </div>

    <div className="heroStatLabel">
      Frei
    </div>
  </div>

  <div className="heroStatCard">
    <div className="heroStatIcon">
      ⏳
    </div>

    <div className="heroStatValue">
      {closureDuration}m
    </div>

    <div className="heroStatLabel">
      Dauer
    </div>
  </div>

</div>

</div>



</div>
{displayState === "CLOSED" &&
  ad && (
    <a
      href={ad.targetUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="adCard"
    >
      <img
        src={ad.imageUrl}
        alt={ad.title}
        className="adImage"
      />
    </a>
)}
  <section className="upcomingClosures" aria-labelledby="upcomingClosuresTitle">
    <div className="upcomingClosuresHeading">
      <div>
        <div className="upcomingClosuresTitleRow">
          <span className="upcomingClosuresIcon" aria-hidden="true">▦</span>
          <h2 id="upcomingClosuresTitle">Kommende Schließzeiten</h2>
        </div>
        <p>Die nächsten erwarteten Schrankenschließungen</p>
      </div>
      <span className="upcomingLive"><span /> Live-Prognose</span>
    </div>

    {Array.isArray(data.closures) && data.closures.length > 0 ? (
      <div className="upcomingClosureList">
        {(showAllClosures ? data.closures : data.closures.slice(0, 3)).map((closure: any, index: number) => {
          const minutesUntil = Math.max(0, Math.round((new Date(closure.start).getTime() - now) / 60000));
          const closureTrains = Array.isArray(closure.trains) ? closure.trains : [];
          return (
            <article
              key={`${closure.start}-${closure.end}`}
              className={`upcomingClosureRow ${index === 0 ? "upcomingClosurePrimary" : ""}`}
            >
              <div className="upcomingClosureTime">
                <strong>{formatIsoTime(closure.start)}</strong>
                <span>{formatIsoTime(closure.end)}</span>
              </div>

              <div className="upcomingClosureDetails">
                <div className="upcomingClosureMeta">
                  <span>{closure.durationMinutes} Min. Schließzeit</span>
                  <span>{closure.trainCount} {closure.trainCount === 1 ? "Zug" : "Züge"}</span>
                </div>
                <div className="upcomingClosureTrains">
                  {closureTrains.map((closureTrain: any, trainIndex: number) => (
                    <div className="upcomingClosureTrain" key={closureTrain.id || `${closureTrain.line}-${closureTrain.crossingTime}-${trainIndex}`}>
                      <strong>{closureTrain.line || "Linie nicht verfügbar"}</strong>
                      <span>{closureTrain.directionLabel || "Richtung nicht verfügbar"}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="upcomingClosureEta">
                {index === 0 && minutesUntil === 0 ? "Demnächst" : `In ${minutesUntil} Min.`}
              </div>
            </article>
          );
        })}
      </div>
    ) : (
      <div className="upcomingClosuresEmpty">Aktuell sind keine weiteren Schließzeiten prognostiziert.</div>
    )}

    {Array.isArray(data.closures) && data.closures.length > 3 && (
      <button
        type="button"
        className="upcomingClosuresToggle"
        onClick={() => setShowAllClosures((value) => !value)}
        aria-expanded={showAllClosures}
      >
        {showAllClosures ? "Weniger anzeigen" : "Alle Schließzeiten anzeigen"}
        <span aria-hidden="true">{showAllClosures ? "⌃" : "⌄"}</span>
      </button>
    )}
  </section>


  {contentItems.length > 0 && (
    <EditorialNewsCarousel items={contentItems} />
  )}

{message && (
  <div
    className="measurementMessage"
  >
    {message}
  </div>
)}

{measurementState !==
  "none" && (
  <div
    className="measurementInfo"
  >
    Messung läuft
  </div>
)}

{pendingEvent ? (
  <div className="measurementButtons">
    <div className="precisionPrompt">
      {pendingEvent === "close"
        ? "Seit wann ist sie unten?"
        : "Seit wann ist sie oben?"}
    </div>

    <button
      className="cta ctaOpen"
      disabled={savingMeasurement}
      onClick={() => {
        void saveMeasurement(pendingEvent, "exact");
        setPendingEvent(null);
      }}
    >
      GERADE EBEN
    </button>

    <button
      className="cta ctaSecondary"
      disabled={savingMeasurement}
      onClick={() => {
        void saveMeasurement(pendingEvent, "at_least");
        setPendingEvent(null);
      }}
    >
      WAR SCHON EINE WEILE SO
    </button>

    <button
      className="cancelButton"
      onClick={() =>
        setPendingEvent(null)
      }
    >
      Abbrechen
    </button>
  </div>
) : (
  <div className="measurementButtons">
    <button
  className={`cta ctaClose ${
    measurementState ===
    "close-recorded"
      ? "disabledMeasurement"
      : ""
  }`}
  disabled={
    measurementState ===
    "close-recorded"
  }
  onClick={() =>
    setPendingEvent("close")
  }
>
  SCHRANKE RUNTER
</button>

      <button
  className={`cta ctaOpen ${
    measurementState ===
    "open-recorded"
      ? "disabledMeasurement"
      : ""
  }`}
  disabled={
    measurementState ===
    "open-recorded"
  }
  onClick={() =>
    setPendingEvent("open")
  }
>
  SCHRANKE HOCH
</button>
 {measurementState === "close-recorded" && (
  <button
    className="flagButton"
    disabled={unexpectedTrainSaved || savingUnexpectedTrain}
    onClick={() => void saveUnexpectedTrain()}
  >
    {savingUnexpectedTrain
      ? "WIRD GESPEICHERT …"
      : unexpectedTrainSaved
        ? "✓ SONDERFALL GESPEICHERT"
        : "⚠ GÜTERZUG / SONDERFALL"}
  </button>
)}
    </div>
)}
 
  </main>
);
}
