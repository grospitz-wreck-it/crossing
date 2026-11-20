"use client";

import { useEffect, useState } from "react";

type Crossing = { id: string; name: string; evas: string[] };
type Observation = {
  key: string; journeyId: string; eva: string; direction: string; eventTime: string;
  scheduledTime: string | null; timeType: string; line: string; category: string;
  journeyNumber: number; originEva: string | null; destinationEva: string | null;
  routeNames: string[]; platform: string | null; cancelled: boolean;
  observedAt: string; expiresAt: string;
};
type QueueJob = {
  key: string; direction: string; evas: string[]; intervalMs: number; priority: number;
  nextDueAt: string; lastStartedAt: string | null; lastFinishedAt: string | null;
  lastStatus: string | null; consecutiveFailures: number; lastError: string | null;
};
type Payload = {
  ok: boolean; crossings?: Crossing[]; crossing?: Crossing; observations?: Observation[];
  queue?: QueueJob[]; summary?: { observationCount: number; arrivals: number; departures: number; latestObservedAt: string | null; queueJobs: number; failedJobs: number };
  error?: string; warning?: string;
};

function time(value: string | null | undefined) {
  if (!value) return "–";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("de-DE");
}

export default function OpenBoardsTestPage() {
  const [crossings, setCrossings] = useState<Crossing[]>([]);
  const [selected, setSelected] = useState("");
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function loadCrossings() {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/admin/openboards-test", { cache: "no-store" });
      const result: Payload = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "Testansicht ist nicht aktiviert.");
      setCrossings(result.crossings || []);
    } catch (e) { setError(e instanceof Error ? e.message : "Laden fehlgeschlagen."); }
    finally { setLoading(false); }
  }

  async function loadSelected(id = selected) {
    if (!id) { setData(null); return; }
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/admin/openboards-test?crossingId=${encodeURIComponent(id)}`, { cache: "no-store" });
      const result: Payload = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "OpenBoards-Daten konnten nicht geladen werden.");
      setData(result);
    } catch (e) { setError(e instanceof Error ? e.message : "Laden fehlgeschlagen."); }
    finally { setLoading(false); }
  }

  useEffect(() => { void loadCrossings(); }, []);

  return (
    <main style={{ maxWidth: 1120, margin: "0 auto", padding: "32px 20px", color: "var(--foreground, #171717)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 12, letterSpacing: 1.4, opacity: .65 }}>MEINESCHRANKE · ADMIN</div>
          <h1 style={{ fontSize: 28, fontWeight: 700, margin: "8px 0" }}>OpenBoards-Testbetrieb</h1>
          <p style={{ opacity: .7, margin: 0 }}>Parallele Beobachtung – Mobilithek und bestehende Prognosen bleiben unverändert.</p>
        </div>
        <button onClick={() => void loadSelected()} disabled={!selected || loading} style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid #8886", background: "transparent" }}>Aktualisieren</button>
      </div>

      <section style={{ marginTop: 24, padding: 16, border: "1px solid #8884", borderRadius: 12 }}>
        <label htmlFor="crossing" style={{ display: "block", fontWeight: 600, marginBottom: 8 }}>Bahnübergang auswählen</label>
        <select id="crossing" value={selected} onChange={(event) => { setSelected(event.target.value); setData(null); void loadSelected(event.target.value); }} style={{ width: "100%", maxWidth: 560, padding: 12, borderRadius: 8, border: "1px solid #8888", background: "transparent", color: "inherit" }}>
          <option value="">Bitte auswählen …</option>
          {crossings.map((crossing) => <option key={crossing.id} value={crossing.id}>{crossing.name}</option>)}
        </select>
        {selected && data?.crossing && <p style={{ opacity: .7, fontSize: 13, marginBottom: 0 }}>EVAs: {data.crossing.evas.join(", ") || "Keine hinterlegt"}</p>}
      </section>

      {loading && <p style={{ padding: 20 }}>Lade OpenBoards-Testdaten …</p>}
      {error && <p role="alert" style={{ padding: 14, borderRadius: 8, background: "#b4530918", color: "inherit" }}>{error}</p>}
      {data?.warning && <p style={{ padding: 14, borderRadius: 8, background: "#b4530918" }}>{data.warning}</p>}

      {data?.summary && (
        <>
          <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12, marginTop: 20 }}>
            {[
              ["Beobachtungen", data.summary.observationCount],
              ["Ankünfte", data.summary.arrivals],
              ["Abfahrten", data.summary.departures],
              ["Queue-Jobs", data.summary.queueJobs],
              ["Fehlerhafte Jobs", data.summary.failedJobs],
            ].map(([label, value]) => <div key={String(label)} style={{ padding: 16, border: "1px solid #8884", borderRadius: 10 }}><div style={{ fontSize: 12, opacity: .65 }}>{label}</div><div style={{ fontSize: 26, fontWeight: 700 }}>{value}</div></div>)}
          </section>
          <p style={{ fontSize: 13, opacity: .7 }}>Letzte Erhebung: {time(data.summary.latestObservedAt)}</p>

          <section style={{ marginTop: 24 }}>
            <h2 style={{ fontSize: 19, fontWeight: 650 }}>Aktive Refresh-Jobs</h2>
            {!data.queue?.length ? <p>Noch keine passenden Queue-Jobs gefunden.</p> : <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}><thead><tr>{["Richtung","EVAs","Intervall","Priorität","Status","Letzter Lauf","Fehler"].map(x => <th key={x} style={{ textAlign: "left", padding: 9, borderBottom: "1px solid #8885" }}>{x}</th>)}</tr></thead><tbody>{data.queue.map(job => <tr key={job.key}><td style={{ padding: 9, borderBottom: "1px solid #8883" }}>{job.direction}</td><td style={{ padding: 9, borderBottom: "1px solid #8883" }}>{job.evas.join(", ")}</td><td style={{ padding: 9, borderBottom: "1px solid #8883" }}>{Math.round(job.intervalMs / 1000)} s</td><td style={{ padding: 9, borderBottom: "1px solid #8883" }}>{job.priority}</td><td style={{ padding: 9, borderBottom: "1px solid #8883" }}>{job.lastStatus || "wartet"}</td><td style={{ padding: 9, borderBottom: "1px solid #8883" }}>{time(job.lastFinishedAt)}</td><td style={{ padding: 9, borderBottom: "1px solid #8883", color: job.lastError ? "#dc2626" : "inherit" }}>{job.lastError || "–"}</td></tr>)}</tbody></table></div>}
          </section>

          <section style={{ marginTop: 24 }}>
            <h2 style={{ fontSize: 19, fontWeight: 650 }}>OpenBoards-Beobachtungen</h2>
            {!data.observations?.length ? <p>Noch keine gespeicherten Beobachtungen für diesen Übergang.</p> : <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}><thead><tr>{["Zeit","Linie","Zug","Richtung","Station","Zeitqualität","Gleis","Erhoben"].map(x => <th key={x} style={{ textAlign: "left", padding: 9, borderBottom: "1px solid #8885" }}>{x}</th>)}</tr></thead><tbody>{data.observations.map(item => <tr key={item.key}><td style={{ padding: 9, borderBottom: "1px solid #8883", whiteSpace: "nowrap" }}>{time(item.eventTime)}</td><td style={{ padding: 9, borderBottom: "1px solid #8883" }}>{item.line || item.category || "–"}</td><td style={{ padding: 9, borderBottom: "1px solid #8883" }}>{item.journeyNumber || item.journeyId}</td><td style={{ padding: 9, borderBottom: "1px solid #8883" }}>{item.direction === "arrivals" ? "Ankunft" : "Abfahrt"}</td><td style={{ padding: 9, borderBottom: "1px solid #8883" }}>{item.eva}</td><td style={{ padding: 9, borderBottom: "1px solid #8883" }}>{item.timeType}</td><td style={{ padding: 9, borderBottom: "1px solid #8883" }}>{item.platform || "–"}</td><td style={{ padding: 9, borderBottom: "1px solid #8883", whiteSpace: "nowrap" }}>{time(item.observedAt)}</td></tr>)}</tbody></table></div>}
          </section>
        </>
      )}
    </main>
  );
}
