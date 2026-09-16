"use client";

import { useEffect, useState } from "react";
import styles from "./LoadingScreen.module.css";

type DebugLine = {
  at: number;
  text: string;
  kind?: "info" | "wait" | "ok" | "error";
};

export default function LoadingScreen() {
  const debugEnabled = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("debug") === "1";
  const [elapsed, setElapsed] = useState(0);
  const [lines, setLines] = useState<DebugLine[]>([]);

  useEffect(() => {
    if (!debugEnabled) return;
    const started = performance.now();
    const add = (text: string, kind: DebugLine["kind"] = "info") =>
      setLines((current) => [...current, { at: Math.round(performance.now() - started), text, kind }].slice(-30));

    add("APP: LoadingScreen aktiv");
    add(`URL: ${window.location.pathname}${window.location.search}`);
    add("STATUS: Warte auf /api/crossings/.../status", "wait");

    const timer = window.setInterval(() => setElapsed(Math.round(performance.now() - started) / 1000), 250);

    const onResource = (event: PerformanceResourceTiming) => {
      if (!event.name.includes("/api/crossings/") || !event.name.includes("/status")) return;
      add(`HTTP: ${event.name.split("/api/")[1] || event.name}`, "ok");
      add(`NETZWERK: ${(event.responseEnd - event.startTime).toFixed(0)} ms`, "ok");
      if (event.transferSize) add(`TRANSFER: ${event.transferSize} Bytes`);
    };

    performance.getEntriesByType("resource").forEach((entry) => onResource(entry as PerformanceResourceTiming));
    const observer = new PerformanceObserver((list) => list.getEntries().forEach((entry) => onResource(entry as PerformanceResourceTiming)));
    observer.observe({ type: "resource", buffered: true });

    const originalFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const input = args[0];
      const url = typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
      const isStatus = url.includes("/api/crossings/") && url.includes("/status");
      const fetchStarted = performance.now();
      if (isStatus) add(`FETCH → ${url}`, "wait");
      try {
        const response = await originalFetch(...args);
        if (isStatus) add(`FETCH ← HTTP ${response.status} nach ${(performance.now() - fetchStarted).toFixed(0)} ms`, response.ok ? "ok" : "error");
        return response;
      } catch (error) {
        if (isStatus) add(`FETCH ✕ ${error instanceof Error ? error.message : String(error)}`, "error");
        throw error;
      }
    };

    return () => {
      window.clearInterval(timer);
      observer.disconnect();
      window.fetch = originalFetch;
    };
  }, [debugEnabled]);

  return (
    <main className={styles.loadingScreen}>
      <div className={styles.loadingOverlay} />
      <img src="/images/meineschranke_logo.webp" alt="Meine Schranke" className={styles.loadingLogo} />
      <div className={styles.loadingBar}><div className={styles.loadingBarFill} /></div>

      {debugEnabled && (
        <section className={styles.debugPanel} aria-label="Status Debug">
          <div className={styles.debugHeader}>
            <strong>STATUS DEBUG</strong>
            <span>{elapsed.toFixed(1)} s</span>
          </div>
          <div className={styles.debugHint}>Live-Diagnose – Seite geöffnet mit ?debug=1</div>
          <div className={styles.debugLines}>
            {lines.map((line, index) => (
              <div key={`${line.at}-${index}`} className={`${styles.debugLine} ${styles[`debug_${line.kind || "info"}`]}`}>
                <span>{(line.at / 1000).toFixed(1)}s</span> {line.text}
              </div>
            ))}
            {!lines.length && <div className={styles.debugLine}>Initialisiere …</div>}
          </div>
        </section>
      )}
    </main>
  );
}
