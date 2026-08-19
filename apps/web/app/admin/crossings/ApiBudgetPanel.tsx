"use client";

import { useEffect, useState } from "react";
import styles from "./ApiBudgetPanel.module.css";

type Usage = {
  limitPerMinute: number;
  currentWindow: number;
  remaining: number;
  utilizationPercent: number;
  lastHour: number;
  today: number;
  cacheHitsToday: number;
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
    const timer = window.setInterval(load, 10_000);
    return () => { alive = false; window.clearInterval(timer); };
  }, []);

  if (!usage) return null;
  const pct = Math.min(100, Math.max(0, usage.utilizationPercent));
  const tone = pct >= 90 ? styles.danger : pct >= 75 ? styles.warning : "";
  const status = pct >= 90 ? "Limit fast erreicht" : pct >= 75 ? "Hohe Auslastung" : "Im sicheren Bereich";

  return (
    <section className={`${styles.card} ${tone}`} aria-label="DB API Rate-Limit">
      <div className={styles.brand}>
        <img src="/images/meineschranke_logo.webp" alt="meineschranke" />
      </div>
      <div className={styles.eyebrow}>DB TIMETABLES API</div>
      <div className={styles.title}>Rate-Limit</div>
      <div className={styles.value}><strong>{usage.currentWindow}</strong><span> / {usage.limitPerMinute}</span></div>
      <div className={styles.progress}><span style={{ width: `${pct}%` }} /></div>
      <div className={styles.meta}><span>{usage.remaining} frei</span><span>{pct.toFixed(1)} %</span></div>
      <div className={styles.status}>● {status}</div>
      <div className={styles.stats}>
        <div><strong>{usage.lastHour.toLocaleString("de-DE")}</strong><span>letzte Stunde</span></div>
        <div><strong>{usage.today.toLocaleString("de-DE")}</strong><span>heute</span></div>
      </div>
    </section>
  );
}
