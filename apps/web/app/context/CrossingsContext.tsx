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
  const [activeId, setActiveIdState] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      try {
        const crossingsResponse = await fetch("/api/crossings", { cache: "no-store" });
        const crossingsJson = crossingsResponse.ok ? await crossingsResponse.json() : [];
        const availableList = Array.isArray(crossingsJson) ? crossingsJson : [];
        if (!cancelled) setAvailable(availableList);

        const userResponse = await fetch("/api/user/crossings", { cache: "no-store" });
        if (userResponse.ok) {
          const userJson = await userResponse.json();
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
            const rawActive = localStorage.getItem(STORAGE_KEY_ACTIVE);
            const activeExists = nextSaved.some((crossing) => crossing.id === rawActive);
            setActiveIdState(activeExists ? rawActive : nextSaved[0]?.id ?? DEFAULT_CROSSING.id);
          }
        } else {
          const rawActive = localStorage.getItem(STORAGE_KEY_ACTIVE);
          if (!cancelled) {
            setSaved([DEFAULT_CROSSING]);
            setActiveIdState(rawActive || DEFAULT_CROSSING.id);
          }
        }
      } catch (error) {
        console.error("Failed to initialize crossings:", error);
        if (!cancelled) {
          setSaved([DEFAULT_CROSSING]);
          setActiveIdState(DEFAULT_CROSSING.id);
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
