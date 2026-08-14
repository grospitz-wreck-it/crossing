"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
} from "react";

type CrossingSummary = {
  id: string;
  name: string;
};

type CrossingsContextValue = {
  saved: CrossingSummary[];
  available: CrossingSummary[];
  activeId: string | null;
  setActiveId: (id: string) => void;
  addCrossing: (crossing: CrossingSummary) => void;
  removeCrossing: (id: string) => void;
};

const STORAGE_KEY_SAVED = "crossing-app:saved-crossings";
const STORAGE_KEY_ACTIVE = "crossing-app:active-crossing";

const DEFAULT_CROSSING: CrossingSummary = {
  id: "kirchlengern",
  name: "Kirchlengern",
};

const CrossingsContext =
  createContext<CrossingsContextValue | null>(null);

export function CrossingsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [saved, setSaved] = useState<CrossingSummary[]>([
    DEFAULT_CROSSING,
  ]);
  const [available, setAvailable] = useState<CrossingSummary[]>(
    []
  );
  const [activeId, setActiveIdState] = useState<string | null>(
    null
  );
  const [hydrated, setHydrated] = useState(false);

  // Gespeicherte Auswahl aus localStorage übernehmen (nur im Browser).
  useEffect(() => {
    try {
      const rawSaved = localStorage.getItem(STORAGE_KEY_SAVED);
      const rawActive = localStorage.getItem(STORAGE_KEY_ACTIVE);

      if (rawSaved) {
        const parsed = JSON.parse(rawSaved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setSaved(parsed);
        }
      }

      setActiveIdState(rawActive ?? DEFAULT_CROSSING.id);
    } catch {
      setActiveIdState(DEFAULT_CROSSING.id);
    }

    setHydrated(true);
  }, []);

  // Alle verfügbaren Schranken laden (zum Hinzufügen im Menü).
  useEffect(() => {
    fetch("/api/crossings")
      .then((res) => (res.ok ? res.json() : []))
      .then((list) =>
        setAvailable(Array.isArray(list) ? list : [])
      )
      .catch(() => setAvailable([]));
  }, []);

  // Erst NACH dem initialen Laden persistieren, sonst überschreibt der
  // Default-State beim ersten Render den echten gespeicherten Wert.
  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(STORAGE_KEY_SAVED, JSON.stringify(saved));
  }, [saved, hydrated]);

  useEffect(() => {
    if (!hydrated || !activeId) return;
    localStorage.setItem(STORAGE_KEY_ACTIVE, activeId);
  }, [activeId, hydrated]);

  function addCrossing(crossing: CrossingSummary) {
    setSaved((prev) =>
      prev.some((c) => c.id === crossing.id)
        ? prev
        : [...prev, crossing]
    );
    setActiveIdState(crossing.id);
  }

  function removeCrossing(id: string) {
    setSaved((prev) => {
      const next = prev.filter((c) => c.id !== id);
      return next.length > 0 ? next : [DEFAULT_CROSSING];
    });

    setActiveIdState((current) => {
      if (current !== id) return current;
      const remaining = saved.filter((c) => c.id !== id);
      return remaining[0]?.id ?? DEFAULT_CROSSING.id;
    });
  }

  return (
    <CrossingsContext.Provider
      value={{
        saved,
        available,
        activeId,
        setActiveId: setActiveIdState,
        addCrossing,
        removeCrossing,
      }}
    >
      {children}
    </CrossingsContext.Provider>
  );
}

export function useCrossings() {
  const ctx = useContext(CrossingsContext);
  if (!ctx) {
    throw new Error(
      "useCrossings must be used within CrossingsProvider"
    );
  }
  return ctx;
}