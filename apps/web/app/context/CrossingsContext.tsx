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
const CrossingsContext = createContext<CrossingsContextValue | null>(null);

function withActiveCrossing(
  list: CrossingSummary[],
  activeId: string | null,
  available: CrossingSummary[],
) {
  if (!activeId || list.some((crossing) => crossing.id === activeId)) return list;
  const availableCrossing = available.find((crossing) => crossing.id === activeId);
  return availableCrossing ? [...list, availableCrossing] : list;
}

export function CrossingsProvider({ children }: { children: React.ReactNode }) {
  const [saved, setSaved] = useState<CrossingSummary[]>([]);
  const [available, setAvailable] = useState<CrossingSummary[]>([]);
  const [activeId, setActiveIdState] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      const rawActive = localStorage.getItem(STORAGE_KEY_ACTIVE);

      const [crossingsResult, userResult] = await Promise.allSettled([
        fetch("/api/crossings", { cache: "no-store" }),
        fetch("/api/user/crossings", { cache: "no-store" }),
      ]);

      let availableList: CrossingSummary[] = [];

      try {
        if (crossingsResult.status === "fulfilled" && crossingsResult.value.ok) {
          const crossingsJson = await crossingsResult.value.json();
          availableList = Array.isArray(crossingsJson) ? crossingsJson : [];
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
            const nextSaved = withActiveCrossing(normalized, rawActive, availableList);
            setSaved(nextSaved);

            const activeIdFromStorage = rawActive &&
              (nextSaved.some((crossing) => crossing.id === rawActive) ||
                availableList.some((crossing) => crossing.id === rawActive))
              ? rawActive
              : null;

            const fallbackId =
              activeIdFromStorage ??
              nextSaved[0]?.id ??
              availableList[0]?.id ??
              null;

            setActiveIdState(fallbackId);
          }
        } else if (!cancelled) {
          const fallbackId = rawActive && availableList.some((crossing) => crossing.id === rawActive)
            ? rawActive
            : availableList[0]?.id ?? null;
          setSaved(withActiveCrossing([], fallbackId, availableList));
          setActiveIdState(fallbackId);
        }
      } catch (error) {
        console.error("Failed to initialize crossings:", error);
        if (!cancelled) {
          const fallbackId = rawActive && availableList.some((crossing) => crossing.id === rawActive)
            ? rawActive
            : availableList[0]?.id ?? null;
          setSaved(withActiveCrossing([], fallbackId, availableList));
          setActiveIdState(fallbackId);
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
    try {
      const response = await fetch("/api/user/crossings", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ crossingId: id }),
      });
      if (response.status === 401) return;
      if (!response.ok) throw new Error(`Failed to remove crossing (${response.status})`);
      setSaved((prev) => prev.filter((crossing) => crossing.id !== id));
      setActiveIdState((current) => {
        if (current !== id) return current;
        return saved.find((crossing) => crossing.id !== id)?.id ?? available[0]?.id ?? null;
      });
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
