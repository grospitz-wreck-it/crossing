"use client";

import { useEffect, useState } from "react";

export default function Home() {
  const [data, setData] = useState<any>();

  useEffect(() => {
    load();

    const interval = setInterval(
      load,
      5000
    );

    return () => clearInterval(interval);
  }, []);

  async function load() {
    const res = await fetch(
      "/api/crossings/kirchlengern-elsestrasse/status"
    );

    const json = await res.json();

    setData(json);
  }

  if (!data) {
    return <div>Loading...</div>;
  }

  return (
    <main className="container">
      <div
        className={
          data.state === "OPEN"
            ? "open"
            : "closed"
        }
      >
        {data.state === "OPEN"
          ? "🟢"
          : "🔴"}
      </div>

      <h1>
        {data.state === "OPEN"
          ? "OFFEN"
          : "GESCHLOSSEN"}
      </h1>

      <div className="timer">
        {data.state === "OPEN"
          ? data.nextCloseIn
          : data.remainingOpenIn}
      </div>

      <p>
        {data.state === "OPEN"
          ? "bis Schranke schließt"
          : "bis Schranke öffnet"}
      </p>
    </main>
  );
}
