"use client";

import { useEffect, useState } from "react";
import styles from "./StatusDebugPanel.module.css";

type DebugKind = "info" | "wait" | "ok" | "error";

type DebugEntry = {
  at: number;
  text: string;
  kind: DebugKind;
};

type DebugState = {
  startedAt: number;
  entries: DebugEntry[];
};

declare global {
  interface Window {
    __crossingStatusDebug?: DebugState;
    __crossingStatusDebugPatched?: boolean;
  }
}

function debugEnabled() {
  return (
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("debug") === "1"
  );
}

function ensureDebugState(): DebugState {
  const existing = window.__crossingStatusDebug;
  if (existing) return existing;

  const state: DebugState = {
    startedAt: performance.now(),
    entries: [],
  };
  window.__crossingStatusDebug = state;
  return state;
}

function addDebugEntry(text: string, kind: DebugKind = "info") {
  if (!debugEnabled()) return;

  const state = ensureDebugState();
  state.entries.push({
    at: Math.round(performance.now() - state.startedAt),
    text,
    kind,
  });
  state.entries = state.entries.slice(-40);
  window.dispatchEvent(new Event("crossing-status-debug"));
}

function installFetchDiagnostics() {
  if (typeof window === "undefined" || window.__crossingStatusDebugPatched) {
    return;
  }

  window.__crossingStatusDebugPatched = true;
  const originalFetch = window.fetch.bind(window);

  window.fetch = async (...args) => {
    const input = args[0];
    const url =
      typeof input === "string"
        ? input
        : input instanceof Request
          ? input.url
          : String(input);

    const relevant =
      url.includes("/api/crossings/") || url.includes("/api/ads/");

    if (!relevant || !debugEnabled()) {
      return originalFetch(...args);
    }

    const started = performance.now();
    const shortUrl = url.includes("/api/")
      ? `/api/${url.split("/api/")[1]}`
      : url;

    addDebugEntry(`FETCH → ${shortUrl}`, "wait");

    try {
      const response = await originalFetch(...args);
      const elapsed = Math.round(performance.now() - started);
      addDebugEntry(
        `FETCH ← HTTP ${response.status} nach ${elapsed} ms`,
        response.ok ? "ok" : "error",
      );
      return response;
    } catch (error) {
      const elapsed = Math.round(performance.now() - started);
      addDebugEntry(
        `FETCH ✕ nach ${elapsed} ms: ${error instanceof Error ? error.message : String(error)}`,
        "error",
      );
      throw error;
    }
  };

  addDebugEntry("DEBUG: Fetch-Diagnose installiert");
}

if (typeof window !== "undefined") {
  installFetchDiagnostics();
}

export default function StatusDebugPanel() {
  const [state, setState] = useState<DebugState | null>(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!debugEnabled()) return;

    installFetchDiagnostics();
    const current = ensureDebugState();
    setState({ ...current, entries: [...current.entries] });
    addDebugEntry(`APP: ${window.location.pathname}${window.location.search}`);

    const onDebug = () => {
      const next = ensureDebugState();
      setState({ ...next, entries: [...next.entries] });
    };

    const timer = window.setInterval(() => {
      const next = ensureDebugState();
      setElapsed((performance.now() - next.startedAt) / 1000);
    }, 250);

    window.addEventListener("crossing-status-debug", onDebug);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("crossing-status-debug", onDebug);
    };
  }, []);

  if (!debugEnabled()) return null;

  const entries = state?.entries ?? [];

  return (
    <section className={styles.panel} aria-label="Status Debug">
      <div className={styles.header}>
        <strong>STATUS DEBUG</strong>
        <span>{elapsed.toFixed(1)} s</span>
      </div>
      <div className={styles.hint}>
        Live-Diagnose · ?debug=1 · Panel bleibt auch nach der Antwort sichtbar
      </div>
      <div className={styles.lines}>
        {entries.length === 0 && (
          <div className={styles.line}>Initialisiere …</div>
        )}
        {entries.map((entry, index) => (
          <div
            key={`${entry.at}-${index}`}
            className={`${styles.line} ${styles[entry.kind]}`}
          >
            <span>{(entry.at / 1000).toFixed(1)}s</span> {entry.text}
          </div>
        ))}
      </div>
    </section>
  );
}
