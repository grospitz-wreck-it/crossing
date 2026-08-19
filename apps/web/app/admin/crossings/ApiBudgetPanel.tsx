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
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  useEffect(() => {
    let alive = true;

    async function load() {
      try {
        const res = await fetch("/api/admin/api-usage", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (alive) {
          setUsage(data);
          setUpdatedAt(new Date());
        }
      } catch {}
    }

    void load();
    const timer = window.setInterval(() => void load(), 10_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  if (!usage) return null;

  const pct = Math.min(100, Math.max(0, usage.utilizationPercent));
  const tone = pct >= 90 ? "#ef4444" : pct >= 75 ? "#f59e0b" : "#22c55e";
  const status = pct >= 90 ? "Limit fast erreicht" : pct >= 75 ? "Hohe Auslastung" : "Im sicheren Bereich";
  const maxEva = Math.max(1, ...usage.byEva.map((item) => item.requests));
  const updatedLabel = updatedAt
    ? updatedAt.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : "gerade eben";

  return (
    <section
      style={{
        width: "min(1400px, calc(100% - 80px))",
        boxSizing: "border-box",
        margin: "40px auto 28px",
        padding: "28px 30px 22px",
        borderRadius: 20,
        color: "#f8fafc",
        background: "linear-gradient(135deg, #111827 0%, #172033 100%)",
        border: "1px solid rgba(148,163,184,.18)",
        boxShadow: "0 16px 45px rgba(15,23,42,.18)",
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-start", gap: 18 }}>
        <div style={{ minWidth: 220 }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".16em", color: "#94a3b8", marginBottom: 7 }}>
            DB TIMETABLES API
          </div>
          <h2 style={{ margin: 0, fontSize: "clamp(24px, 3vw, 34px)", lineHeight: 1.05, letterSpacing: "-.04em", color: "#f8fafc" }}>
            API-Übersicht &amp; Rate-Limit
          </h2>
        </div>

        <div style={{ textAlign: "right", flex: "0 0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 7, fontSize: 12, color: "#cbd5e1" }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: tone, boxShadow: `0 0 0 4px ${tone}22` }} />
            Aktuelle Minute
          </div>
          <div style={{ marginTop: 2, fontSize: "clamp(30px, 4vw, 42px)", lineHeight: 1, fontWeight: 850, letterSpacing: "-.04em", color: tone }}>
            {usage.currentWindow} / {usage.limitPerMinute}
          </div>
          <div style={{ marginTop: 4, fontSize: 16, fontWeight: 800, color: tone }}>{pct.toFixed(1)} %</div>
        </div>
      </div>

      <div style={{ marginTop: 20, height: 10, borderRadius: 999, background: "rgba(148,163,184,.16)", overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", borderRadius: 999, background: tone, transition: "width .35s ease" }} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(145px, 1fr))", gap: 10, marginTop: 18 }}>
        <Metric icon="◷" label="Frei jetzt" value={usage.remaining.toLocaleString("de-DE")} detail="Requests verfügbar" tone="#22c55e" />
        <Metric icon="◷" label="Letzte Stunde" value={usage.lastHour.toLocaleString("de-DE")} detail="Requests gesamt" tone="#60a5fa" />
        <Metric icon="▣" label="Heute" value={usage.today.toLocaleString("de-DE")} detail="Requests gesamt" tone="#a78bfa" />
        <Metric icon="ϟ" label="Cache-Hits heute" value={usage.cacheHitsToday.toLocaleString("de-DE")} detail="Treffer aus Cache" tone="#fbbf24" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 18, marginTop: 18 }}>
        <div style={{ minWidth: 0, padding: 18, borderRadius: 15, background: "rgba(15,23,42,.42)", border: "1px solid rgba(148,163,184,.12)" }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: "#f8fafc", marginBottom: 14 }}>Top EVAs · letzte 24 Stunden</div>
          {usage.byEva.length ? (
            <div style={{ display: "grid", gap: 9 }}>
              {usage.byEva.slice(0, 8).map((item) => {
                const width = Math.max(4, (item.requests / maxEva) * 100);
                return (
                  <div key={item.eva ?? "unknown"} style={{ display: "grid", gridTemplateColumns: "76px minmax(80px, 1fr) 40px 48px", gap: 10, alignItems: "center", fontSize: 11 }}>
                    <span style={{ color: "#e2e8f0", fontVariantNumeric: "tabular-nums" }}>{item.eva ?? "—"}</span>
                    <div style={{ height: 6, borderRadius: 99, background: "rgba(148,163,184,.12)", overflow: "hidden" }}>
                      <div style={{ width: `${width}%`, height: "100%", borderRadius: 99, background: "#60a5fa" }} />
                    </div>
                    <span style={{ color: "#e2e8f0", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{item.requests}</span>
                    <span style={{ color: "#94a3b8", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{usage.lastHour ? `${((item.requests / Math.max(1, usage.lastHour)) * 100).toFixed(1)}%` : "—"}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ color: "#94a3b8", fontSize: 12 }}>Noch keine API-Aufrufe im Auswertungsfenster.</div>
          )}
        </div>

        <div style={{ padding: 18, borderRadius: 15, border: "1px solid rgba(148,163,184,.14)", background: "rgba(15,23,42,.24)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 800, color: "#f8fafc" }}>
            <span style={{ color: "#fbbf24" }}>◈</span> Rate-Limit
          </div>
          <p style={{ margin: "14px 0 0", color: "#cbd5e1", fontSize: 12, lineHeight: 1.55 }}>
            Maximal {usage.limitPerMinute} Requests pro Minute im gleitenden 60-Sekunden-Fenster.
          </p>
          <p style={{ margin: "10px 0 0", color: "#94a3b8", fontSize: 11, lineHeight: 1.5 }}>
            Neue Anfragen werden automatisch verzögert, wenn das Limit erreicht ist.
          </p>
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid rgba(148,163,184,.12)", color: tone, fontSize: 11, fontWeight: 800 }}>
            {status}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 10, marginTop: 18, paddingTop: 14, borderTop: "1px solid rgba(148,163,184,.12)", color: "#94a3b8", fontSize: 10 }}>
        <span>◷ Letzte Aktualisierung: {updatedLabel}</span>
        <span>● Daten werden alle 10 Sekunden aktualisiert</span>
      </div>
    </section>
  );
}

function Metric({ icon, label, value, detail, tone }: { icon: string; label: string; value: string; detail: string; tone: string }) {
  return (
    <div style={{ minWidth: 0, padding: "14px 15px", borderRadius: 14, background: "rgba(148,163,184,.08)", border: "1px solid rgba(148,163,184,.08)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 28, height: 28, borderRadius: 9, display: "grid", placeItems: "center", background: `${tone}18`, color: tone, fontSize: 16, fontWeight: 800 }}>{icon}</span>
        <span style={{ color: "#cbd5e1", fontSize: 11, fontWeight: 700 }}>{label}</span>
      </div>
      <div style={{ marginTop: 8, fontSize: 26, lineHeight: 1, fontWeight: 850, letterSpacing: "-.03em", color: tone, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      <div style={{ marginTop: 5, color: "#64748b", fontSize: 10 }}>{detail}</div>
    </div>
  );
}
