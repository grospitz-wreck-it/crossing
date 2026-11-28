"use client";

import {
  useEffect,
  useState,
  useRef,
} from "react";
import LoadingScreen from "../components/LoadingScreen";
import ContentServices from "../components/ContentServices";
import AppIcon from "../components/AppIcon";
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
const MEASUREMENT_STATE_PREFIX = "crossing-app:measurement-state:";

// Module-level caches survive client-side navigation away from and back to /app.
const statusCache = new Map<string, any>();
const statusInFlight = new Map<string, Promise<void>>();
const adCache = new Map<string, any[]>();
const contentCache = new Map<string, any[]>();
let hasCompletedInitialBootstrap = false;

// Keep the feedback ID stable across reloads and identical to the ID used by
// the separate prediction-rating component. The status API intentionally
// contains forecast data only; it does not provide a predictionId.
function makePredictionId(crossingId: string, phase: any) {
  const trainIds = (phase?.trains ?? [])
    .map((train: any) => String(train.id ?? ""))
    .sort()
    .join(",");

  return `${crossingId}:${phase?.start ?? ""}:${phase?.end ?? ""}:${trainIds}`;
}

export default function Home() {
const { activeId, saved, hydrated } = useCrossings();
const activeCrossing = saved.find((crossing) => crossing.id === activeId) ?? saved[0];

const [data, setData] =
  useState<any>(() => activeId ? statusCache.get(activeId) ?? null : null);
const [bootstrapLoading, setBootstrapLoading] = useState(!hasCompletedInitialBootstrap);
const [bootstrapProgress, setBootstrapProgress] = useState(0);
const [bootstrapDetail, setBootstrapDetail] = useState("Deine Schranke wird geladen");
const [loadingAnimationFinished, setLoadingAnimationFinished] = useState(hasCompletedInitialBootstrap);
const [isSwitchingCrossing, setIsSwitchingCrossing] = useState(false);
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
  const [scoutEnabled, setScoutEnabled] = useState(false);

  const refreshTimeout =
    useRef<ReturnType<typeof setTimeout> | null>(
      null
    );

const activeIdRef = useRef<string | null>(activeId);
activeIdRef.current = activeId;

const predictionId =
  activeId && data?.phase?.start && data?.phase?.end
    ? makePredictionId(activeId, data.phase)
    : null;

useEffect(() => {
  const readScoutPreference = () => {
    try { setScoutEnabled(window.localStorage.getItem("crossing-app:scout-enabled") === "true"); }
    catch { setScoutEnabled(false); }
  };
  readScoutPreference();
  window.addEventListener("storage", readScoutPreference);
  window.addEventListener("crossing-scout-preference", readScoutPreference);
  return () => {
    window.removeEventListener("storage", readScoutPreference);
    window.removeEventListener("crossing-scout-preference", readScoutPreference);
  };
}, []);

useEffect(() => {
  setPendingEvent(null);
  setMessage("");
  if (!predictionId) {
    setMeasurementState("none");
    setFirstClickAt(null);
    setUnexpectedTrainSaved(false);
    return;
  }

  try {
    const raw = window.localStorage.getItem(MEASUREMENT_STATE_PREFIX + predictionId);
    const savedState = raw ? JSON.parse(raw) : null;
    const savedAt = Number(savedState?.firstClickAt || 0);
    const isFresh = savedAt > 0 && Date.now() - savedAt <= MAX_PHASE_MS;

    if (savedState?.state === "close-recorded" && isFresh) {
      setMeasurementState("close-recorded");
      setFirstClickAt(savedAt);
      setUnexpectedTrainSaved(savedState.unexpectedTrainSaved === true);
    } else {
      window.localStorage.removeItem(MEASUREMENT_STATE_PREFIX + predictionId);
      setMeasurementState("none");
      setFirstClickAt(null);
      setUnexpectedTrainSaved(false);
    }
  } catch {
    setMeasurementState("none");
    setFirstClickAt(null);
    setUnexpectedTrainSaved(false);
  }
}, [predictionId]);

const statusCacheRef = { current: statusCache };
const statusInFlightRef = { current: statusInFlight };
const adCacheRef = { current: adCache };
const contentCacheRef = { current: contentCache };

async function load(crossingId: string | null = activeIdRef.current, force = false, onProgress?: (progress: number, detail: string) => void) {
  if (!crossingId) return;

  const cached = statusCacheRef.current.get(crossingId);
  if (cached && !force) {
    if (activeIdRef.current === crossingId) {
      setData(cached);
      setAds(adCacheRef.current.get(crossingId) || []);
      setContentItems(contentCacheRef.current.get(crossingId) || []);
    }
    onProgress?.(100, `${saved.find((item) => item.id === crossingId)?.name ?? "Bahnübergang"} geladen`);
    return;
  }

  const existing = statusInFlightRef.current.get(crossingId);
  if (existing) {
    await existing;
    const latest = statusCacheRef.current.get(crossingId);
    if (latest && activeIdRef.current === crossingId) {
      setData(latest);
      setAds(adCacheRef.current.get(crossingId) || []);
      setContentItems(contentCacheRef.current.get(crossingId) || []);
    }
    return;
  }

  const request = (async () => {
    try {
      const crossingName = saved.find((item) => item.id === crossingId)?.name ?? "Bahnübergang";
      const statusPromise = fetch(`/api/crossings/${crossingId}/status`, { cache: "no-store" });
      const adsPromise = fetch(`/api/ads/${crossingId}`, { cache: "no-store" });
      const contentPromise = fetch(`/api/content/${crossingId}`, { cache: "no-store" });
      const statusRes = await statusPromise;
      if (!statusRes.ok) throw new Error(`Status API returned ${statusRes.status}`);

      const json = await statusRes.json();
      statusCacheRef.current.set(crossingId, json);
      onProgress?.(85, `${crossingName} geladen`);
      const [adRes, contentRes] = await Promise.all([adsPromise, contentPromise]);

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
        setIsSwitchingCrossing(false);
        setAds(adList);
        setContentItems(editorialItems);
        setCurrentAdIndex(0);
      }
    } catch (error) {
      console.error(`Failed to load crossing ${crossingId}:`, error);
      if (activeIdRef.current === crossingId) {
        setData({ error: true, state: "UNKNOWN", phase: null, closures: [], trains: [], trainCount: 0 });
        setIsSwitchingCrossing(false);
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
  if (!predictionId || measurementState !== "close-recorded" || unexpectedTrainSaved || savingUnexpectedTrain) {
    return;
  }

  setSavingUnexpectedTrain(true);
  try {
    const response = await fetch("/api/measurements/flag", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        predictionId,
        flag: "unexpected_train",
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.success !== true) {
      throw new Error(result.error || "Der Sonderfall konnte nicht gespeichert werden.");
    }

    setUnexpectedTrainSaved(true);
    if (predictionId && firstClickAt) {
      window.localStorage.setItem(
        MEASUREMENT_STATE_PREFIX + predictionId,
        JSON.stringify({ state: "close-recorded", firstClickAt, unexpectedTrainSaved: true })
      );
    }
    setMessage("✓ Güterzug-/Sonderzug-Hinweis gespeichert");
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
  if (!predictionId || savingMeasurement) return;
  if (event === "close" && measurementState === "close-recorded") return;
  if (event === "open" && measurementState === "open-recorded") return;

  setSavingMeasurement(true);
  try {
    const response = await fetch("/api/measurements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        predictionId,
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
      const recordedAt = Date.now();
      setFirstClickAt(recordedAt);
      setUnexpectedTrainSaved(false);
      if (predictionId) {
        window.localStorage.setItem(
          MEASUREMENT_STATE_PREFIX + predictionId,
          JSON.stringify({ state: "close-recorded", firstClickAt: recordedAt, unexpectedTrainSaved: false })
        );
      }
      setMessage(precision === "exact"
        ? "✓ Schranke geschlossen – Messung gespeichert"
        : "✓ Zustand erfasst (Zeitpunkt ungenau)");
    } else {
      setMeasurementState("none");
      setFirstClickAt(null);
      setUnexpectedTrainSaved(false);
      if (predictionId) {
        window.localStorage.removeItem(MEASUREMENT_STATE_PREFIX + predictionId);
      }
      setMessage(precision === "exact"
        ? "✓ Schranke offen – Messung gespeichert"
        : "✓ Öffnungszustand erfasst (Zeitpunkt ungenau)");
    }
    // Keep the precision choice visible until the server confirms the write.
    setPendingEvent(null);
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
  if (hasCompletedInitialBootstrap || !hydrated) return;

  let cancelled = false;
  const activeCrossingIndex = Math.max(0, saved.findIndex((crossing) => crossing.id === activeId));
  const initialCrossings = saved.length
    ? saved.length <= 3
      ? saved
      : [saved[0], saved[activeCrossingIndex], saved[activeCrossingIndex + 1], saved[activeCrossingIndex - 1]]
          .filter((crossing, index, list): crossing is (typeof saved)[number] =>
            Boolean(crossing) && list.findIndex((item) => item?.id === crossing.id) === index
          )
    : activeId
      ? [{ id: activeId, name: "Deine Schranke" }]
      : [];

  if (initialCrossings.length === 0) {
    hasCompletedInitialBootstrap = true;
    setBootstrapLoading(false);
    setLoadingAnimationFinished(true);
    return;
  }

  setBootstrapLoading(true);
  setBootstrapProgress(0);
  const crossingNames = initialCrossings
    .map((crossing) => crossing.name)
    .filter(Boolean);
  setBootstrapDetail(
    crossingNames.length
      ? `Wird geladen: ${crossingNames.join(" · ")}`
      : "Deine Bahnübergänge werden geladen"
  );

  let completed = 0;
  void Promise.all(initialCrossings.map((crossing) =>
    load(crossing.id, false, () => {
      if (cancelled) return;
      completed += 1;
      setBootstrapProgress(Math.round((completed / initialCrossings.length) * 90));
    })
  )).finally(() => {
    if (!cancelled) {
      hasCompletedInitialBootstrap = true;
      setBootstrapProgress(100);
      setBootstrapDetail(initialCrossings.length < saved.length ? "Dein Startbereich ist bereit" : "Alle Schranken sind bereit");
      setBootstrapLoading(false);
    }
  });

  return () => { cancelled = true; };
}, [hydrated]);

useEffect(() => {
  if (!activeId) {
    setData(null);
    setAds([]);
    setContentItems([]);
    setCurrentAdIndex(0);
    return;
  }

  const cached = statusCacheRef.current.get(activeId);
  if (cached) {
    setData(cached);
    setIsSwitchingCrossing(false);
  } else if (data) {
    // Keep the previous crossing visible while the new one is loading.
    setIsSwitchingCrossing(true);
  } else {
    setIsSwitchingCrossing(false);
  }
  setAds(adCacheRef.current.get(activeId) || []);
  setContentItems(contentCacheRef.current.get(activeId) || []);
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
        if (predictionId) {
          window.localStorage.removeItem(MEASUREMENT_STATE_PREFIX + predictionId);
        }

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

if (!hasCompletedInitialBootstrap && (!data || bootstrapLoading || !loadingAnimationFinished)) {
  return (
    <LoadingScreen
      message="Dein Schrankenprofil wird geladen"
      detail={activeId ? bootstrapDetail : undefined}
      progress={bootstrapProgress}
      onComplete={() => setLoadingAnimationFinished(true)}
    />
  );
}

if (!data) {
  return (
    <main className="container">
      <div className="heroCard">Deine Schranke wird vorbereitet …</div>
    </main>
  );
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

  <div className="crossingNameBlock">
    <span className="crossingNameEyebrow">DEIN BAHNÜBERGANG</span>
    <h1>{activeCrossing?.name ?? data.crossing?.name ?? "Deine Schranke"}</h1>
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
          <span className="upcomingClosuresIcon" aria-hidden="true"><AppIcon name="train" size={21} /></span>
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
                  {closureTrains.map((closureTrain: any, trainIndex: number) => {
                    const rawDirection = String(closureTrain.directionLabel || "").trim();
                    const directionIsReadable =
                      rawDirection.length > 0 &&
                      !/unknown|nl:|vbn-|^richtung\\s*[:\\d]/i.test(rawDirection) &&
                      !/\\b\\d{7}\\b/.test(rawDirection);
                    return (
                      <div className="upcomingClosureTrain" key={closureTrain.id || `${closureTrain.line}-${closureTrain.crossingTime}-${trainIndex}`}>
                        <strong>{closureTrain.line || "Linie nicht verfügbar"}</strong>
                        {directionIsReadable ? <span>{rawDirection}</span> : null}
                      </div>
                    );
                  })}
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
        <AppIcon name={showAllClosures ? "chevron-up" : "chevron-down"} size={16} />
      </button>
    )}
  </section>


  {isSwitchingCrossing && (
    <div
      role="status"
      aria-live="polite"
      aria-label="Bahnübergang wird geladen"
      style={{
        position: "fixed",
        zIndex: 60,
        top: "calc(env(safe-area-inset-top, 0px) + 14px)",
        left: "50%",
        transform: "translateX(-50%)",
        display: "flex",
        alignItems: "center",
        gap: 9,
        padding: "10px 14px",
        borderRadius: 999,
        background: "rgba(20, 32, 48, .92)",
        color: "#fff",
        boxShadow: "0 8px 28px rgba(0,0,0,.2)",
        fontSize: 13,
        fontWeight: 600,
        backdropFilter: "blur(10px)",
      }}
    >
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="9" stroke="rgba(255,255,255,.28)" strokeWidth="3" />
        <path d="M21 12a9 9 0 0 0-9-9" stroke="#fff" strokeWidth="3" strokeLinecap="round">
          <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur=".8s" repeatCount="indefinite" />
        </path>
      </svg>
      Schranke wird geladen
    </div>
  )}

  <ContentServices newsItems={contentItems} />

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

{scoutEnabled && (
  <section className="scoutControls" aria-label="Schranken-Scout">
    <h2>Schranken-Scout</h2>
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
      }}
    >
      GERADE EBEN
    </button>

    <button
      className="cta ctaSecondary"
      disabled={savingMeasurement}
      onClick={() => {
        void saveMeasurement(pendingEvent, "at_least");
      }}
    >
      WAR SCHON EINE WEILE SO
    </button>

    <button
      className="cancelButton"
      disabled={savingMeasurement}
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
              : "⚠ GÜTERZUG / SONDERZUG"}
        </button>
      )}

      <button
        className={`cta ctaOpen ${
          measurementState === "open-recorded" ? "disabledMeasurement" : ""
        }`}
        disabled={measurementState === "open-recorded"}
        onClick={() => setPendingEvent("open")}
      >
        SCHRANKE HOCH
      </button>
    </div>
    )}
    <p>Hilf uns, die Prognosen von meineSchranke zu verbessern.</p>
  </section>
)}
 
  </main>
);
}
