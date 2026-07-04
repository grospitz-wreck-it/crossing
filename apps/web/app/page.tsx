"use client";

import {
  useEffect,
  useState,
} from "react";

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
function getClosureDuration(
  start?: string,
  end?: string
) {
  if (!start || !end) {
    return null;
  }

  return Math.round(
    (
      new Date(end).getTime() -
      new Date(start).getTime()
    ) /
      60000
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

export default function Home() {
  const [data, setData] =
    useState<any>(null);

  const [countdown, setCountdown] =
    useState(0);

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
    message,
    setMessage,
  ] = useState("");

const [ad, setAd] =
  useState<any>(null);

  async function load() {
    try {
      const res = await fetch(
        "/api/crossings/kirchlengern/status"
      );

      const json =
        await res.json();

      setData(json);
      setCountdown(
        json.state === "OPEN"
          ? json.nextCloseIn
          : json.nextOpenIn
      );
    } catch (err) {
      console.error(err);
    }
  }
async function saveUnexpectedTrain() {
  if (!data?.predictionId) {
    return;
  }

  await fetch(
    "/api/measurements/flag",
    {
      method: "POST",

      headers: {
        "Content-Type":
          "application/json",
      },

      body: JSON.stringify({
        predictionId:
          data.predictionId,

        flag:
          "unexpected_train",
      }),
    }
  );

  setMessage(
    "⚠ Sonderfall markiert"
  );

  setTimeout(() => {
    setMessage("");
  }, 3000);
}
  async function saveMeasurement(
  event:
    | "close"
    | "open"
) {
  if (!data) {
    return;
  }

  if (
  event === "close" &&
  measurementState ===
    "close-recorded"
) {
  return;
}

if (
  event === "open" &&
  measurementState ===
    "open-recorded"
) {
  return;
}

  const res =
    await fetch(
      "/api/measurements",
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",
        },

        body: JSON.stringify({
          predictionId:
            data.predictionId,

          event,

          actualAt:
            new Date().toISOString(),

          phase:
            data.phase,
        }),
      }
    );

  await res.json();

  if (
  event === "close"
) {
  if (
    measurementState ===
    "open-recorded"
  ) {
    setMeasurementState(
      "none"
    );

    setFirstClickAt(
      null
    );

    setMessage(
      "✓ Messung abgeschlossen"
    );
  } else {
    setMeasurementState(
      "close-recorded"
    );

    setFirstClickAt(
      Date.now()
    );

    setMessage(
      "✓ Schranke runter gespeichert"
    );
  }
}

if (
  event === "open"
) {
  if (
    measurementState ===
    "close-recorded"
  ) {
    setMeasurementState(
      "none"
    );

    setFirstClickAt(
      null
    );

    setMessage(
      "✓ Messung abgeschlossen"
    );
  } else {
    setMeasurementState(
      "open-recorded"
    );

    setFirstClickAt(
      Date.now()
    );

    setMessage(
      "✓ Schranke hoch gespeichert"
    );
  }
}

  setTimeout(() => {
    setMessage("");
  }, 3000);
}

  useEffect(() => {
  load();

  const apiRefresh =
    setInterval(
      load,
      120000
    );

  return () =>
    clearInterval(
      apiRefresh
    );
}, []);
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
  const timer = setInterval(() => {
    setCountdown(
      (prev: number) => {
        const next =
          Math.max(
            0,
            prev - 1
          );

        return next;
      }
    );
  }, 1000);

  return () =>
    clearInterval(timer);
}, []);
useEffect(() => {
  if (
    countdown === 0 &&
    data
  ) {
    load();
  }
}, [countdown]);

useEffect(() => {
  fetch(
    "/api/ads/serve?crossingId=kirchlengern"
  )
    .then((r) => r.json())
    .then((ad) => {
      setAd(ad);

      if (!ad) {
        return;
      }

      fetch(
        "/api/ads/impression",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",
          },

          body: JSON.stringify({
            campaignId:
              ad.campaign_id,

            creativeId:
              ad.id,

            crossingId:
              "kirchlengern",

            sessionId:
              crypto.randomUUID(),
          }),
        }
      );
    })
    .catch(console.error);
}, []);

if (!data) {
  return (
    <main className="container">
      Loading...
    </main>
  );
}
const closeTime =
  formatIsoTime(
    data.phase?.start
  );

const openTime =
  formatIsoTime(
    data.phase?.end
  );

const closureDuration =
  getClosureDuration(
    data.phase?.start,
    data.phase?.end
  );

const train =
  data.phase?.trains?.[0];

const heroImage =
  data.state === "OPEN"
    ? "/images/barrier-open.webp"
    : "/images/barrier-closed.webp";


console.log({
  line: data.phase?.trains?.[0]?.line,
  delayMinutes:
    data.phase?.trains?.[0]?.delayMinutes,
});

return (
  <main className="container">

  <div className="logo">
    GEMEINDE KIRCHLENGERN
  </div>

  <div
  className={`heroCard ${
    data.state === "OPEN"
      ? "heroCardOpen"
      : "heroCardClosed"
  }`}
>

  <div className="heroVisual">

  <img
    src={heroImage}
    alt={
      data.state === "OPEN"
        ? "Bahnübergang offen"
        : "Bahnübergang geschlossen"
    }
    className="heroImage"
  />

</div>

<div className="heroContent">

  <div
    className={`statusBadge ${
      data.state === "OPEN"
        ? "badgeOpen"
        : "badgeClosed"
    }`}
  >
    ●{" "}
    {data.state === "OPEN"
      ? "OFFEN"
      : "GESCHLOSSEN"}
  </div>

  <div className="heroTimer">
    {formatSeconds(
      countdown
    )}
  </div>

  <div className="heroSubtitle">
    {data.state === "OPEN"
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
{data.state === "CLOSED" &&
  ad && (
    <a
      href={ad.target_url}
      target="_blank"
      rel="noreferrer"
      className="adCard"
    >
      <img
        src={ad.image_url}
        alt=""
        className="adImage"
      />
    </a>
)}
  <div className="trainCard">

  <div className="trainLabel">
    Nächster Zug
  </div>

  <div className="trainHeader">

    <div className="trainMain">

      <div className="trainLineRow">

  <div className="trainLine">

    {
      data.phase
        ?.trains?.[0]
        ?.line
    }

    <span className="trainNumberInline">

  {
    data.phase
      ?.trains?.[0]
      ?.trainNumber
  }

</span>

  </div>

  {data.phase?.trains?.[0]
    ?.delayMinutes > 0 && (
    <span className="delayChipInline">
      +
      {
        data.phase
          ?.trains?.[0]
          ?.delayMinutes
      }
    </span>
  )}

</div>

      <div className="trainRoute">

        {getOrigin(
          data.phase?.trains?.[0]
        )}

        {" → "}

        {getDestination(
          data.phase?.trains?.[0]
        )}

        {data.phase?.trains?.[0]
          ?.platform && (
          <span className="platformInline">
            · Gleis{" "}
            {
              data.phase
                ?.trains?.[0]
                ?.platform
            }
          </span>
        )}

      </div>

    </div>

    <div className="etaCard">

      <div className="etaLabel">
        passiert in
      </div>

      <div className="etaValue">
        {Math.max(
          1,
          Math.round(
            (
              data.phase
                ?.trains?.[0]
                ?.etaSeconds || 0
            ) / 60
          )
        )}
        <span className="etaUnit">
          Min
        </span>
      </div>

    </div>

  </div>

<div className="upcomingList">

  <div className="upcomingLabel">
    Danach
  </div>

    {data.trains
      ?.filter(
  (t: any) =>
    t.etaSeconds > 0 &&
    t.etaSeconds <= 1800
)
.slice(1, 10)
      .map((train: any) => (

        <div
  key={train.journeyId}
  className="upcomingTrain"
>

  <div className="upcomingMain">

    <div className="upcomingLine">

      <strong>
        {train.line}
      </strong>

      {train.delayMinutes >
        0 && (
        <span className="miniDelay">
          +{train.delayMinutes}
        </span>
      )}

    </div>

    <div className="upcomingRoute">
  → {train.destination}
</div>

  </div>

  <div className="upcomingTime">

  {formatIsoTime(
    train.arrival
  )}

  {train.delayMinutes >
    0 && (
    <span className="upcomingDelay">
      +{train.delayMinutes}
    </span>
  )}

</div>

</div>
      ))}

  </div>

  </div>

{data.phase?.trains?.length >
  1 && (
  <div className="trainCard">
    <div className="trainLabel">
      Weitere Züge
      dieser Phase
    </div>

    {data.phase.trains
      .slice(1)
      .map(
        (
          train: any,
          index: number
        ) => (
          <div
            key={index}
            className="extraTrain"
          >
            <div
              style={{
                fontWeight: 700,
                fontSize:
                  "1.1rem",
              }}
            >
              {train.line}
              {" · "}
              {
                train.trainNumber
              }
            </div>

            <div
              style={{
                marginTop: 4,
                color:
                  "#55708e",
              }}
            >
              {getOrigin(
                train
              )}
              {" → "}
              {getDestination(
                train
              )}
            </div>
          </div>
        )
      )}
  </div>
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
    saveMeasurement(
      "close"
    )
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
    saveMeasurement(
      "open"
    )
  }
>
  SCHRANKE HOCH
</button>
 <button
  className="flagButton"
  onClick={saveUnexpectedTrain}
>
  ⚠ GÜTERZUG / SONDERFALL
</button>
    </div>
 
  </main>
);
}
