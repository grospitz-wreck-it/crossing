"use client";

import { createContext, useContext, useEffect, useState } from "react";

type CrossingSummary = {
  id: string;
  name: string;
  lat?: number | null;
  lon?: number | null;
};

type CrossingsContextValue = {
  saved: CrossingSummary[];
  available: CrossingSummary[];
  activeId: string | null;
  favoriteId: string | null;
  setActiveId: (id: string) => void;
  setFavorite: (id: string) => Promise<void>;
  addCrossing: (crossing: CrossingSummary) => Promise<void>;
  removeCrossing: (id: string) => Promise<void>;
};

const STORAGE_KEY_ACTIVE = "crossing-app:active-crossing";
const MAX_FREE_CROSSINGS = 5;
const CrossingsContext = createContext<CrossingsContextValue | null>(null);

function withActiveCrossing(
  list: CrossingSummary[],
  activeId: string | null,
  available: CrossingSummary[],
) {
  if (!activeId || list.some((crossing) => crossing.id === activeId)) {
    return list;
  }

  const availableCrossing = available.find(
    (crossing) => crossing.id === activeId,
  );

  return availableCrossing
    ? [...list, availableCrossing].slice(0, MAX_FREE_CROSSINGS)
    : list;
}

export function CrossingsProvider({ children }: { children: React.ReactNode }) {
  const [saved, setSaved] = useState<CrossingSummary[]>([]);
  const [available, setAvailable] = useState<CrossingSummary[]>([]);
  const [activeId, setActiveIdState] = useState<string | null>(null);
  const [favoriteId, setFavoriteId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      const rawActive = localStorage.getItem(STORAGE_KEY_ACTIVE);

      if (!cancelled && rawActive) setActiveIdState(rawActive);

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
          const personalList = Array.isArray(userJson)
            ? userJson
            : Array.isArray(userJson?.crossings)
              ? userJson.crossings
              : [];

          const normalized = personalList
            .map((crossing: any) => {
              const id = String(
                crossing.crossing_id ?? crossing.id ?? "",
              );

              const catalog = availableList.find(
                (item: any) => item.id === id,
              );

              return {
                id,
                name: String(crossing.name ?? catalog?.name ?? ""),
                lat:
                  crossing.lat != null
                    ? Number(crossing.lat)
                    : catalog?.lat ?? null,
                lon:
                  crossing.lon != null
                    ? Number(crossing.lon)
                    : catalog?.lon ?? null,
              };
            })
            .filter(
              (crossing: CrossingSummary) =>
                crossing.id && crossing.name,
            );

          const apiFavoriteId =
            typeof userJson?.favoriteId === "string"
              ? userJson.favoriteId
              : normalized.find(
                  (crossing: any) => crossing.isFavorite,
                )?.id ?? null;

          if (!cancelled) {
            // Keep a locally selected crossing usable even if the user list is
            // temporarily stale or the row was not persisted yet. It is still
            // required to exist in the active crossings catalogue.
            const nextSaved = withActiveCrossing(
              normalized.slice(0, MAX_FREE_CROSSINGS),
              rawActive,
              availableList,
            );
            setSaved(nextSaved);

            const activeExists = nextSaved.some((crossing) => crossing.id === rawActive);
            if (activeExists && rawActive) {
              setActiveIdState(rawActive);
            } else if (!rawActive) {
              setActiveIdState(nextSaved[0]?.id ?? null);
            }
          }
        } else if (!cancelled) {
          const fallbackSaved = withActiveCrossing(
            [],
            rawActive,
            availableList,
          );
          setSaved(fallbackSaved);
        }
      } catch (error) {
        console.error("Failed to initialize crossings:", error);
        if (!cancelled) {
          setSaved(withActiveCrossing([], rawActive, availableList));
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
      setSaved((prev) => {
        if (prev.some((item) => item.id === crossing.id)) {
          return prev;
        }

        if (prev.length >= MAX_FREE_CROSSINGS) {
          return prev;
        }

        return [...prev, crossing];
      });
      setActiveIdState(crossing.id);

      /*
       * Der Server macht den ersten BÜ automatisch zum Favoriten.
       * Für die lokale UI behandeln wir einen bisher fehlenden
       * Favoriten ebenfalls sofort als Favoriten.
       */
      setFavoriteId((current) => current ?? crossing.id);
    } catch (error) {
      console.error("Failed to add crossing:", error);
    }
  }

  async function setFavorite(id: string) {
    if (!saved.some((crossing) => crossing.id === id)) {
      return;
    }

    try {
      const response = await fetch("/api/user/crossings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          crossingId: id,
          action: "favorite",
        }),
      });

      if (response.status === 401) return;

      if (!response.ok) {
        throw new Error(
          `Failed to set favorite (${response.status})`,
        );
      }

      setFavoriteId(id);
    } catch (error) {
      console.error("Failed to set favorite crossing:", error);
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
      const result = await response.json().catch(() => null);

      setSaved((prev) => {
        const remaining = prev.filter(
          (crossing) => crossing.id !== id,
        );

        setActiveIdState((current) => {
          if (current !== id) return current;
          return remaining[0]?.id ?? null;
        });

        return remaining;
      });

      if (favoriteId === id) {
        setFavoriteId(
          typeof result?.favoriteId === "string"
            ? result.favoriteId
            : null,
        );
      }
    } catch (error) {
      console.error("Failed to remove crossing:", error);
    }
  }

  return (
    <CrossingsContext.Provider
      value={{
        saved,
        available,
        activeId,
        favoriteId,
        setActiveId: setActiveIdState,
        setFavorite,
        addCrossing,
        removeCrossing,
      }}
    >
      {children}
    </CrossingsContext.Provider>
  );
}

export { MAX_FREE_CROSSINGS };

export function useCrossings() {
  const ctx = useContext(CrossingsContext);
  if (!ctx) throw new Error("useCrossings must be used within CrossingsProvider");
  return ctx;
}
