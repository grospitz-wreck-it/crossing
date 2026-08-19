"use client";

import { useEffect, useState } from "react";

type Usage = {
  limitPerMinute: number;
  currentWindow: number;
  remaining: number;
  utilizationPercent: number;
  lastHour: number;
  today: number;
  cacheHitsToday: number;
  byEva: { eva: string | null; requests: number }[];
};

export default function ApiBudgetPanel() {
  const [usage, setUsage] = useState<Usage | null>(null);

  useEffect(() => {
    let alive = true;

    async function load() {
      try {
        const res = await fetch("/api/admin/api-usage", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (alive) setUsage(data);
      } catch {}
    }

    void load();
    const timer = window.setInterval(() => void load(), 5000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  if (!usage) return null;

  const pct = Math.min(100, usage.utilizationPercent);
  const tone = pct >= 90 ? "#dc2626" : pct >= 75 ? "#d97706" : "#16a34a";

  return (
    <section
      style={{
        marginBottom: 18,
        padding: 18,
        border: "1px solid rgba(148,163,184,.22)",
        borderRadius: 18,
        background: "rgba(15,23,42,.72)",
        boxShadow: "0 10px 30px rgba(0,0,0,.12)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 20, alignItems: "center", marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".12em", opacity: .65 }}>DB TIMETABLES API</div>
          <strong style={{ fontSize: 18 }}>Rate-Limit &amp; Verbrauch</strong>
        </div>
        <div style={{ fontSize: 13, fontWeight: 700, color: tone }}>
          {usage.currentWindow} / {usage.limitPerMinute} · {pct.toFixed(1)} %
        </div>
      </div>

      <div style={{ height: 8, borderRadius: 999, background: "rgba(148,163,184,.16)", overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: tone, transition: "width .3s ease" }} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 12, marginTop: 14 }}>
        <Metric label="Frei jetzt" value={String(usage.remaining)} />
        <Metric label="Letzte Stunde" value={usage.lastHour.toLocaleString("de-DE")} />
        <Metric label="Heute" value={usage.today.toLocaleString("de-DE")} />
        <Metric label="Cache-Hits heute" value={usage.cacheHitsToday.toLocaleString("de-DE")} />
      </div>

      {usage.byEva.length > 0 && (
        <div style={{ marginTop: 14, fontSize: 12, opacity: .72 }}>
          <strong>Top EVAs · letzte 24h:</strong>{" "}
          {usage.byEva.slice(0, 8).map((item) => `${item.eva ?? "—"}: ${item.requests}`).join(" · ")}
        </div>
      )}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ padding: 10, borderRadius: 12, background: "rgba(148,163,184,.08)" }}>
      <div style={{ fontSize: 10, opacity: .55 }}>{label}</div>
      <div style={{ marginTop: 3, fontSize: 16, fontWeight: 700 }}>{value}</div>
    </div>
  );
}
