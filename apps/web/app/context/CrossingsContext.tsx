"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { FREE_CROSSING_LIMIT, PREMIUM_CROSSING_PACKAGE } from "../lib/subscription-config";

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
  maxCrossings: number;
  purchasedSlots: number;
  hydrated: boolean;
  premiumPackage: {
    additionalCrossings: number;
    priceCents: number;
    currency: string;
    durationDays: number;
    enabled: boolean;
  };
  setActiveId: (id: string) => void;
  setFavorite: (id: string) => Promise<void>;
  addCrossing: (crossing: CrossingSummary, replaceCrossingId?: string) => Promise<void>;
  removeCrossing: (id: string) => Promise<void>;
};

const STORAGE_KEY_ACTIVE = "crossing-app:active-crossing";
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
    ? [...list, availableCrossing]
    : list;
}

export function CrossingsProvider({ children }: { children: React.ReactNode }) {
  const [saved, setSaved] = useState<CrossingSummary[]>([]);
  const [available, setAvailable] = useState<CrossingSummary[]>([]);
  const [activeId, setActiveIdState] = useState<string | null>(null);
  const [favoriteId, setFavoriteId] = useState<string | null>(null);
  const [maxCrossings, setMaxCrossings] = useState(FREE_CROSSING_LIMIT);
  const [purchasedSlots, setPurchasedSlots] = useState(0);
  const [premiumPackage, setPremiumPackage] = useState({
    additionalCrossings: PREMIUM_CROSSING_PACKAGE.additionalCrossings,
    priceCents: PREMIUM_CROSSING_PACKAGE.priceCents,
    currency: PREMIUM_CROSSING_PACKAGE.currency,
    durationDays: PREMIUM_CROSSING_PACKAGE.durationDays,
    // Do not expose Checkout until the database-controlled flag has loaded.
    enabled: false,
  });
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const rawActive = localStorage.getItem(STORAGE_KEY_ACTIVE);

    // Restore the last active crossing immediately. The user-specific list
    // contains names and coordinates already, so it does not need to wait for
    // the much larger catalogue used by the crossing picker.
    if (rawActive) setActiveIdState(rawActive);

    void (async () => {
      try {
        const response = await fetch("/api/user/crossings", { cache: "no-store" });
        if (!response.ok) throw new Error(`User crossings returned ${response.status}`);
        const userJson = await response.json();
        const personalList = Array.isArray(userJson)
          ? userJson
          : Array.isArray(userJson?.crossings)
            ? userJson.crossings
            : [];

        const normalized = personalList
          .map((crossing: any) => ({
            id: String(crossing.crossing_id ?? crossing.id ?? ""),
            name: String(crossing.name ?? ""),
            lat: crossing.lat != null ? Number(crossing.lat) : null,
            lon: crossing.lon != null ? Number(crossing.lon) : null,
          }))
          .filter((crossing: CrossingSummary) => crossing.id && crossing.name);

        if (Number.isFinite(Number(userJson?.maxCrossings))) {
          setMaxCrossings(Math.max(FREE_CROSSING_LIMIT, Number(userJson.maxCrossings)));
        }
        if (Number.isFinite(Number(userJson?.purchasedSlots))) {
          setPurchasedSlots(Math.max(0, Number(userJson.purchasedSlots)));
        }
        if (userJson?.premiumPackage) setPremiumPackage(userJson.premiumPackage);

        const apiFavoriteId = typeof userJson?.favoriteId === "string"
          ? userJson.favoriteId
          : normalized.find((crossing: any) => crossing.isFavorite)?.id ?? null;

        if (!cancelled) {
          const ordered = apiFavoriteId
            ? [...normalized].sort((a: any, b: any) =>
                a.id === apiFavoriteId ? -1 : b.id === apiFavoriteId ? 1 : 0
              )
            : normalized;
          setSaved(withActiveCrossing(ordered, rawActive, []));
          setFavoriteId(apiFavoriteId);
          // Der Favorit ist immer der linke Startpunkt.
          setActiveIdState(
            ordered.some((crossing: any) => crossing.id === apiFavoriteId)
              ? apiFavoriteId
              : ordered[0]?.id ?? null
          );
        }
      } catch (error) {
        console.error("Failed to initialize saved crossings:", error);
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();

    // Load the full catalogue independently; it is only needed by the
    // management/search screen and must not block the initial app view.
    void fetch("/api/crossings", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Crossings catalogue returned ${response.status}`);
        const list = await response.json();
        const availableList = Array.isArray(list) ? list : [];
        if (cancelled) return;
        setAvailable(availableList);
        setSaved((current) => withActiveCrossing(current, rawActive, availableList));
        if (rawActive && availableList.some((crossing: CrossingSummary) => crossing.id === rawActive)) {
          setActiveIdState((current) => current ?? rawActive);
        }
      })
      .catch((error) => console.error("Failed to load crossings catalogue:", error));

    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!hydrated || !activeId) return;
    localStorage.setItem(STORAGE_KEY_ACTIVE, activeId);
  }, [activeId, hydrated]);

  async function addCrossing(crossing: CrossingSummary, replaceCrossingId?: string) {
    try {
      const response = await fetch("/api/user/crossings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ crossingId: crossing.id, replaceCrossingId }),
      });
      if (response.status === 401) throw new Error("Deine Anmeldung ist abgelaufen. Bitte melde dich erneut an.");
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        throw new Error(result?.error || `Schranke konnte nicht gespeichert werden (${response.status}).`);
      }
      setSaved((prev) => {
        if (prev.some((item) => item.id === crossing.id)) return prev;
        const next = replaceCrossingId
          ? prev.filter((item) => item.id !== replaceCrossingId)
          : prev;
        return [...next, crossing];
      });
      if (replaceCrossingId && favoriteId === replaceCrossingId) {
        setFavoriteId(crossing.id);
      }
      setActiveIdState(crossing.id);

      /*
       * Der Server macht den ersten BÜ automatisch zum Favoriten.
       * Für die lokale UI behandeln wir einen bisher fehlenden
       * Favoriten ebenfalls sofort als Favoriten.
       */
      setFavoriteId((current) => current ?? crossing.id);
    } catch (error) {
      console.error("Failed to add crossing:", error);
      throw error;
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

      if (response.status === 401) throw new Error("Deine Anmeldung ist abgelaufen. Bitte melde dich erneut an.");

      if (!response.ok) {
        const result = await response.json().catch(() => null);
        throw new Error(result?.error || `Favorit konnte nicht gespeichert werden (${response.status}).`);
      }

      setFavoriteId(id);
      setSaved((prev) => [
        ...prev.filter((crossing) => crossing.id === id),
        ...prev.filter((crossing) => crossing.id !== id),
      ]);
    } catch (error) {
      console.error("Failed to set favorite crossing:", error);
      throw error;
    }
  }

  async function removeCrossing(id: string) {
    try {
      const response = await fetch("/api/user/crossings", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ crossingId: id }),
      });
      if (response.status === 401) throw new Error("Deine Anmeldung ist abgelaufen. Bitte melde dich erneut an.");
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        throw new Error(result?.error || `Schranke konnte nicht entfernt werden (${response.status}).`);
      }
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
      throw error;
    }
  }

  return (
    <CrossingsContext.Provider
      value={{
        saved,
        available,
        activeId,
        favoriteId,
        maxCrossings,
        purchasedSlots,
        premiumPackage,
        hydrated,
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

export { FREE_CROSSING_LIMIT };

export function useCrossings() {
  const ctx = useContext(CrossingsContext);
  if (!ctx) throw new Error("useCrossings must be used within CrossingsProvider");
  return ctx;
}
