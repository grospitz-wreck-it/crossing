"use client";

import { useState } from "react";

type Candidate = {
  name: string;
  identifierType: "evaNumbers" | "dhids" | "stationIds";
  identifier: string;
};

type DirectionResult = {
  direction: string;
  ok: boolean;
  httpStatus?: number;
  message?: string;
  count?: number;
  lines?: Array<{ line: string; count: number }>;
  s28Count?: number;
  s28?: Array<Record<string, unknown>>;
  stopPlaces?: Array<{ evaNumber: string | null; name: string | null }>;
};

type ProbeResult = {
  name: string;
  identifier: string;
  identifierType: string;
  s28Found: boolean;
  arrivals: DirectionResult;
  departures: DirectionResult;
};

const initialCandidates: Candidate[] = [
  { name: "IKEA Kaarst", identifierType: "evaNumbers", identifier: "8000438" },
  { name: "Kaarst Mitte/Holzbüttgen", identifierType: "evaNumbers", identifier: "8000432" },
  { name: "Kaarster Bahnhof", identifierType: "evaNumbers", identifier: "8003141" },
];

function DirectionPanel({ title, result }: { title: string; result: DirectionResult }) {
  return (
    <div style={{ border: "1px solid #8884", borderRadius: 9, padding: 12, minWidth: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
        <strong>{title}</strong>
        <span style={{ fontSize: 12, color: result.ok ? "#16834a" : "#c2410c" }}>
          {result.ok ? `HTTP ${result.httpStatus} · ${result.count} Einträge` : `Fehler ${result.httpStatus || ""}`}
        </span>
      </div>
      {!result.ok ? (
        <p style={{ color: "#c2410c", fontSize: 13, marginBottom: 0 }}>{result.message || "Abfrage fehlgeschlagen."}</p>
      ) : (
        <>
          <p style={{ fontSize: 13, margin: "8px 0" }}>
            {result.s28Count ? <strong style={{ color: "#16834a" }}>S28 gefunden: {result.s28Count}</strong> : "Keine S28 in dieser Tafel"}
          </p>
          <div style={{ fontSize: 12, opacity: .8 }}>
            Linien: {result.lines?.map((line) => `${line.line} (${line.count})`).join(", ") || "keine"}
          </div>
          {result.s28?.map((train, index) => (
            <div key={index} style={{ fontSize: 12, padding: "7px 0", borderTop: "1px solid #8883" }}>
              <strong>{String(train.line || "S28")}</strong> · Zug {String(train.journeyNumber || "–")} · {String(train.time || "–")} · {String(train.timeType || "–")}
              <div>{String(train.origin || "–")} → {String(train.destination || "–")}</div>
            </div>
          ))}
          {!!result.stopPlaces?.length && (
            <div style={{ fontSize: 11, opacity: .65, marginTop: 8 }}>
              API-StopPlaces: {result.stopPlaces.map((place) => `${place.name || "?"} [${place.evaNumber || "ohne EVA"}]`).join(" · ")}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function OpenBoardsS28ProbePage() {
  const [candidates, setCandidates] = useState(initialCandidates);
  const [results, setResults] = useState<ProbeResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [testedAt, setTestedAt] = useState("");

  function update(index: number, patch: Partial<Candidate>) {
    setCandidates((current) => current.map((item, i) => i === index ? { ...item, ...patch } : item));
  }

  async function runProbe() {
    const validCandidates = candidates.filter((item) => item.identifier.trim());
    if (!validCandidates.length) {
      setError("Bitte mindestens eine Stations-ID eintragen.");
      return;
    }
    setLoading(true);
    setError("");
    setResults([]);
    try {
      const response = await fetch("/api/admin/openboards-s28-probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ candidates: validCandidates }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Diagnose fehlgeschlagen.");
      setResults(payload.results || []);
      setTestedAt(payload.testedAt || "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Diagnose fehlgeschlagen.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 1120, margin: "0 auto", padding: "32px 20px", color: "var(--foreground, #171717)" }}>
      <div style={{ fontSize: 12, letterSpacing: 1.4, opacity: .65 }}>MEINESCHRANKE · ADMIN · DIAGNOSE</div>
      <h1 style={{ fontSize: 28, fontWeight: 700, margin: "8px 0" }}>OpenBoards · S28-Haltestellentest</h1>
      <p style={{ opacity: .72, marginTop: 0 }}>
        Isolierter Live-Test für drei Regiobahn-Haltepunkte. Es werden nur OpenBoards-Abfragen ausgeführt;
        Queue, Datenbank und Prognosen bleiben unverändert.
      </p>

      <section style={{ marginTop: 24, display: "grid", gap: 12 }}>
        {candidates.map((candidate, index) => (
          <div key={candidate.name} style={{ display: "grid", gridTemplateColumns: "minmax(180px,1fr) minmax(140px,.7fr) minmax(220px,1.2fr)", gap: 10, alignItems: "end", border: "1px solid #8884", borderRadius: 10, padding: 14 }}>
            <label style={{ display: "grid", gap: 5, fontSize: 12 }}>
              Haltepunkt
              <input value={candidate.name} onChange={(event) => update(index, { name: event.target.value })} style={{ padding: 10, border: "1px solid #8886", borderRadius: 7, background: "transparent", color: "inherit" }} />
            </label>
            <label style={{ display: "grid", gap: 5, fontSize: 12 }}>
              ID-Typ
              <select value={candidate.identifierType} onChange={(event) => update(index, { identifierType: event.target.value as Candidate["identifierType"] })} style={{ padding: 10, border: "1px solid #8886", borderRadius: 7, background: "transparent", color: "inherit" }}>
                <option value="dhids">DHID (zHV/DELFI)</option>
                <option value="evaNumbers">EVA-Nummer</option>
                <option value="stationIds">DB-Stations-ID (stada)</option>
              </select>
            </label>
            <label style={{ display: "grid", gap: 5, fontSize: 12 }}>
              Stations-ID
              <input value={candidate.identifier} onChange={(event) => update(index, { identifier: event.target.value })} placeholder="DHID / EVA / stada eintragen" style={{ padding: 10, border: "1px solid #8886", borderRadius: 7, background: "transparent", color: "inherit" }} />
            </label>
          </div>
        ))}
      </section>

      <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 16, flexWrap: "wrap" }}>
        <button onClick={() => void runProbe()} disabled={loading || !candidates.some((item) => item.identifier.trim())} style={{ padding: "11px 16px", borderRadius: 8, border: 0, background: "#111827", color: "white", fontWeight: 650, opacity: loading || !candidates.some((item) => item.identifier.trim()) ? .5 : 1 }}>
          {loading ? "OpenBoards wird abgefragt …" : "S28-Test starten"}
        </button>
        <span style={{ fontSize: 12, opacity: .65 }}>Maximal 6 Requests · Leere Zeilen werden übersprungen</span>
      </div>

      {error && <p role="alert" style={{ color: "#c2410c", padding: 12, background: "#c2410c12", borderRadius: 8 }}>{error}</p>}
      {testedAt && <p style={{ fontSize: 12, opacity: .65 }}>Abfrage: {new Date(testedAt).toLocaleString("de-DE")}</p>}

      {!!results.length && (
        <section style={{ display: "grid", gap: 14, marginTop: 18 }}>
          {results.map((result) => (
            <article key={result.name} style={{ border: "1px solid #8885", borderRadius: 12, padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
                <div><h2 style={{ fontSize: 18, margin: 0 }}>{result.name}</h2><div style={{ fontSize: 12, opacity: .65 }}>{result.identifierType}: {result.identifier}</div></div>
                <strong style={{ color: result.s28Found ? "#16834a" : "#b45309" }}>{result.s28Found ? "S28 gefunden" : "Kein S28-Treffer"}</strong>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 10 }}>
                <DirectionPanel title="Ankünfte" result={result.arrivals} />
                <DirectionPanel title="Abfahrten" result={result.departures} />
              </div>
            </article>
          ))}
        </section>
      )}
    </main>
  );
}
