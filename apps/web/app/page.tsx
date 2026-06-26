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

  const hh =
    value.slice(6, 8);

  const mm =
    value.slice(8, 10);

  return `${hh}:${mm}`;
}
function formatArrival(
  value?: string
) {
  if (!value) {
    return "--:--";
  }

  const hh =
    value.slice(6, 8);

  const mm =
    value.slice(8, 10);

  return `${hh}:${mm}`;
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
  const stations =
    train?.arrivalStations;

  if (
    !stations ||
    stations.length === 0
  ) {
    return null;
  }

  return stations[
    stations.length - 1
  ];
}

function getDestination(
  train: any
) {
  const stations =
    train?.departureStations;

  if (
    !stations ||
    stations.length === 0
  ) {
    return null;
  }

  return stations[0];
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
  const timer =
    setInterval(() => {
      setCountdown(
        (
          prev: number
        ) =>
          Math.max(
            0,
            prev - 1
          )
      );
    }, 1000);

  return () =>
    clearInterval(timer);
}, []);

if (!data) {
  return (
    <main className="container">
      Loading...
    </main>
  );
}

return (
  <main className="container">
    <div className="logo">
      GEMEINDE
      KIRCHLENGERN
    </div>

    <div
      className={`statusDot ${
        data.state === "OPEN"
          ? "open"
          : "closed"
      }`}
    />

   <h1>
  <span className="headlineTop">
    BAHNÜBERGANG
  </span>

  <span className="headlineBottom">
    {data.state === "OPEN"
      ? "OFFEN"
      : "GESCHLOSSEN"}
  </span>
</h1>

    <div className="timer">
      {formatSeconds(
        countdown
      )}
    </div>

    <div className="subtitle">
      {data.state === "OPEN"
        ? "bis Schranke schließt"
        : "bis Schranke öffnet"}
    </div>

    <div className="trainCard">
  <div className="trainLabel">
    Nächster Zug
  </div>

  <div className="trainLine">
    {data.phase?.trains?.[0]?.line}
    {" · "}
    {
      data.phase?.trains?.[0]
        ?.trainNumber
    }
  </div>

  <div className="infoGrid">
    <div className="infoItem">
      <div className="infoTitle">
        Kommt aus
      </div>

      <div className="infoValue">
        {getOrigin(
          data.phase?.trains?.[0]
        )}
      </div>
    </div>

    <div className="infoItem">
      <div className="infoTitle">
        Fährt nach
      </div>

      <div className="infoValue">
        {getDestination(
          data.phase?.trains?.[0]
        )}
      </div>
    </div>

    <div className="infoItem">
      <div className="infoTitle">
        Ankunft
      </div>

      <div className="infoValue">
        {formatDbTime(
          data.phase
            ?.trains?.[0]
            ?.arrival
        )}
      </div>
    </div>

    <div className="infoItem">
      <div className="infoTitle">
        Schranke zu
      </div>

      <div className="infoValue">
        {formatIsoTime(
  data.phase.start
)}
      </div>
    </div>

    <div className="infoItem">
      <div className="infoTitle">
        Schranke auf
      </div>

      <div className="infoValue">
        {formatIsoTime(
  data.phase.end
)}
      </div>
    </div>

    <div className="infoItem">
      <div className="infoTitle">
        Gleis
      </div>

      <div className="infoValue">
        {
          data.phase
            ?.trains?.[0]
            ?.platform
        }
      </div>
    </div>
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
    </div>
  </main>
);
}
