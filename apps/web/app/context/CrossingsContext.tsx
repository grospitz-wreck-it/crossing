"use client";

import { createContext, useContext, useEffect, useState } from "react";

type CrossingSummary = { id: string; name: string };
type CrossingsContextValue = {
  saved: CrossingSummary[];
  available: CrossingSummary[];
  activeId: string | null;
  setActiveId: (id: string) => void;
  addCrossing: (crossing: CrossingSummary) => Promise<void>;
  removeCrossing: (id: string) => Promise<void>;
};

const STORAGE_KEY_ACTIVE = "crossing-app:active-crossing";
const DEFAULT_CROSSING: CrossingSummary = { id: "kirchlengern", name: "Kirchlengern" };
const CrossingsContext = createContext<CrossingsContextValue | null>(null);

function withDefaultCrossing(list: CrossingSummary[]) {
  return list.some((crossing) => crossing.id === DEFAULT_CROSSING.id)
    ? list
    : [DEFAULT_CROSSING, ...list];
}

export function CrossingsProvider({ children }: { children: React.ReactNode }) {
  const [saved, setSaved] = useState<CrossingSummary[]>([DEFAULT_CROSSING]);
  const [available, setAvailable] = useState<CrossingSummary[]>([]);
  // Do not block the main app on the crossings/user list. The default crossing
  // is already known and lets /app start loading its status immediately.
  const [activeId, setActiveIdState] = useState<string | null>(DEFAULT_CROSSING.id);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      // Resolve the locally selected crossing immediately. This is intentionally
      // independent from the DB-backed lists below.
      const rawActive = localStorage.getItem(STORAGE_KEY_ACTIVE);
      if (!cancelled && rawActive) {
        setActiveIdState(rawActive);
      }

      // These two requests are independent and must not form a request waterfall.
      const [crossingsResult, userResult] = await Promise.allSettled([
        fetch("/api/crossings", { cache: "no-store" }),
        fetch("/api/user/crossings", { cache: "no-store" }),
      ]);

      try {
        if (crossingsResult.status === "fulfilled" && crossingsResult.value.ok) {
          const crossingsJson = await crossingsResult.value.json();
          const availableList = Array.isArray(crossingsJson) ? crossingsJson : [];
          if (!cancelled) setAvailable(availableList);
        }

        if (userResult.status === "fulfilled" && userResult.value.ok) {
          const userJson = await userResult.value.json();
          const personalList = Array.isArray(userJson) ? userJson : [];
          const normalized = personalList
            .map((crossing: any) => ({
              id: String(crossing.crossing_id ?? crossing.id ?? ""),
              name: String(crossing.name ?? ""),
            }))
            .filter((crossing: CrossingSummary) => crossing.id && crossing.name);

          if (!cancelled) {
            const nextSaved = withDefaultCrossing(normalized);
            setSaved(nextSaved);
            const rawActiveNow = localStorage.getItem(STORAGE_KEY_ACTIVE);
            const activeExists = nextSaved.some((crossing) => crossing.id === rawActiveNow);
            // Only replace the active crossing with a DB-backed value when it is
            // actually present in the user's saved list. Otherwise retain the
            // already active/default crossing so the main status request never waits.
            if (activeExists) {
              setActiveIdState(rawActiveNow!);
            } else if (!rawActiveNow) {
              setActiveIdState(nextSaved[0]?.id ?? DEFAULT_CROSSING.id);
            }
          }
        } else if (!cancelled) {
          setSaved([DEFAULT_CROSSING]);
        }
      } catch (error) {
        console.error("Failed to initialize crossings:", error);
        if (!cancelled) {
          setSaved([DEFAULT_CROSSING]);
        }
      } finally {
        if (!cancelled) setHydrated(true);
      }
    }

    initialize();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!hydrated || !activeId) return;
    localStorage.setItem(STORAGE_KEY_ACTIVE, activeId);
  }, [activeId, hydrated]);

  async function addCrossing(crossing: CrossingSummary) {
    try {
      const response = await fetch("/api/user/crossings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ crossingId: crossing.id }),
      });
      if (response.status === 401) return;
      if (!response.ok) throw new Error(`Failed to add crossing (${response.status})`);
      setSaved((prev) => prev.some((item) => item.id === crossing.id) ? prev : [...prev, crossing]);
      setActiveIdState(crossing.id);
    } catch (error) {
      console.error("Failed to add crossing:", error);
    }
  }

  async function removeCrossing(id: string) {
    if (id === DEFAULT_CROSSING.id) return;
    try {
      const response = await fetch("/api/user/crossings", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ crossingId: id }),
      });
      if (response.status === 401) return;
      if (!response.ok) throw new Error(`Failed to remove crossing (${response.status})`);
      setSaved((prev) => withDefaultCrossing(prev.filter((crossing) => crossing.id !== id)));
      setActiveIdState((current) => current === id ? DEFAULT_CROSSING.id : current);
    } catch (error) {
      console.error("Failed to remove crossing:", error);
    }
  }

  return (
    <CrossingsContext.Provider value={{ saved, available, activeId, setActiveId: setActiveIdState, addCrossing, removeCrossing }}>
      {children}
    </CrossingsContext.Provider>
  );
}

export function useCrossings() {
  const ctx = useContext(CrossingsContext);
  if (!ctx) throw new Error("useCrossings must be used within CrossingsProvider");
  return ctx;
}
