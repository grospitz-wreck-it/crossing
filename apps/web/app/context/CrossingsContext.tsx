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
  addCrossing: (crossing: CrossingSummary) => Promise<void>;
  removeCrossing: (id: string) => Promise<void>;
};

const STORAGE_KEY_ACTIVE =
  "crossing-app:active-crossing";

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

  const [available, setAvailable] = useState<
    CrossingSummary[]
  >([]);

  const [activeId, setActiveIdState] =
    useState<string | null>(null);

  const [hydrated, setHydrated] =
    useState(false);

  /*
   * --------------------------------------------------
   * INITIAL LOAD
   * --------------------------------------------------
   *
   * 1. verfügbare Schranken laden
   * 2. persönlichen User-Bestand laden
   * 3. aktive Schranke aus localStorage übernehmen
   */
  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      try {
        /*
         * Verfügbare Schranken
         */
        const crossingsResponse =
          await fetch("/api/crossings");

        const crossingsJson =
          crossingsResponse.ok
            ? await crossingsResponse.json()
            : [];

        const availableList =
          Array.isArray(crossingsJson)
            ? crossingsJson
            : [];

        if (!cancelled) {
          setAvailable(availableList);
        }

        /*
         * Persönliche Schranken
         *
         * 200 = eingeloggt
         * 401 = nicht eingeloggt
         */
        const userResponse =
          await fetch("/api/user/crossings", {
            cache: "no-store",
          });

        if (userResponse.ok) {
          const userJson =
            await userResponse.json();

          const personalList =
            Array.isArray(userJson)
              ? userJson
              : [];

          const normalized =
            personalList
              .map((crossing: any) => ({
                id: String(
                  crossing.crossing_id ??
                    crossing.id ??
                    ""
                ),
                name: String(
                  crossing.name ?? ""
                ),
              }))
              .filter(
                (crossing: CrossingSummary) =>
                  crossing.id &&
                  crossing.name
              );

          if (!cancelled) {
            /*
             * Eingeloggter User:
             * Turso ist die Quelle der Wahrheit.
             *
             * Falls noch keine Schranke
             * gespeichert wurde, bleibt Kirchlengern
             * als Fallback erhalten.
             */
            setSaved(
              normalized.length > 0
                ? normalized
                : [DEFAULT_CROSSING]
            );

            const rawActive =
              localStorage.getItem(
                STORAGE_KEY_ACTIVE
              );

            const activeExists =
              normalized.some(
                (crossing: CrossingSummary) =>
                  crossing.id === rawActive
              );

            if (activeExists) {
              setActiveIdState(
                rawActive
              );
            } else {
              setActiveIdState(
                normalized[0]?.id ??
                  DEFAULT_CROSSING.id
              );
            }
          }
        } else {
          /*
           * Nicht eingeloggt:
           * bisheriges Verhalten beibehalten.
           */
          const rawActive =
            localStorage.getItem(
              STORAGE_KEY_ACTIVE
            );

          if (!cancelled) {
            setSaved([
              DEFAULT_CROSSING,
            ]);

            setActiveIdState(
              rawActive ??
                DEFAULT_CROSSING.id
            );
          }
        }
      } catch (error) {
        console.error(
          "Failed to initialize crossings:",
          error
        );

        if (!cancelled) {
          setSaved([
            DEFAULT_CROSSING,
          ]);

          setActiveIdState(
            DEFAULT_CROSSING.id
          );
        }
      } finally {
        if (!cancelled) {
          setHydrated(true);
        }
      }
    }

    initialize();

    return () => {
      cancelled = true;
    };
  }, []);

  /*
   * Aktive Schranke lokal merken.
   *
   * Die persönliche Liste selbst wird NICHT
   * mehr in localStorage gespeichert.
   */
  useEffect(() => {
    if (!hydrated || !activeId) {
      return;
    }

    localStorage.setItem(
      STORAGE_KEY_ACTIVE,
      activeId
    );
  }, [
    activeId,
    hydrated,
  ]);

  /*
   * --------------------------------------------------
   * ADD CROSSING
   * --------------------------------------------------
   */
  async function addCrossing(
    crossing: CrossingSummary
  ) {
    try {
      const response =
        await fetch(
          "/api/user/crossings",
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify({
              crossingId:
                crossing.id,
            }),
          }
        );

      if (response.status === 401) {
        /*
         * Nicht eingeloggt:
         * nichts in Turso speichern.
         */
        console.warn(
          "User is not authenticated."
        );

        return;
      }

      if (!response.ok) {
        throw new Error(
          `Failed to add crossing (${response.status})`
        );
      }

      /*
       * Erst nach erfolgreichem
       * Backend-Write UI aktualisieren.
       */
      setSaved((prev) => {
        if (
          prev.some(
            (item) =>
              item.id ===
              crossing.id
          )
        ) {
          return prev;
        }

        return [
          ...prev,
          crossing,
        ];
      });

      setActiveIdState(
        crossing.id
      );
    } catch (error) {
      console.error(
        "Failed to add crossing:",
        error
      );
    }
  }

  /*
   * --------------------------------------------------
   * REMOVE CROSSING
   * --------------------------------------------------
   */
  async function removeCrossing(
    id: string
  ) {
    try {
      const response =
        await fetch(
          "/api/user/crossings",
          {
            method: "DELETE",
            headers: {
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify({
              crossingId: id,
            }),
          }
        );

      if (response.status === 401) {
        console.warn(
          "User is not authenticated."
        );

        return;
      }

      if (!response.ok) {
        throw new Error(
          `Failed to remove crossing (${response.status})`
        );
      }

      /*
       * Backend erfolgreich:
       * aus lokalem UI-State entfernen.
       */
      setSaved((prev) => {
        const next =
          prev.filter(
            (crossing) =>
              crossing.id !== id
          );

        /*
         * Wenn nichts mehr vorhanden ist,
         * wieder auf Kirchlengern zurückfallen.
         */
        return next.length > 0
          ? next
          : [DEFAULT_CROSSING];
      });

      setActiveIdState(
        (current) => {
          if (current !== id) {
            return current;
          }

          const remaining =
            saved.filter(
              (crossing) =>
                crossing.id !== id
            );

          return (
            remaining[0]?.id ??
            DEFAULT_CROSSING.id
          );
        }
      );
    } catch (error) {
      console.error(
        "Failed to remove crossing:",
        error
      );
    }
  }

  /*
   * --------------------------------------------------
   * CONTEXT
   * --------------------------------------------------
   */
  return (
    <CrossingsContext.Provider
      value={{
        saved,
        available,
        activeId,
        setActiveId:
          setActiveIdState,
        addCrossing,
        removeCrossing,
      }}
    >
      {children}
    </CrossingsContext.Provider>
  );
}

export function useCrossings() {
  const ctx =
    useContext(
      CrossingsContext
    );

  if (!ctx) {
    throw new Error(
      "useCrossings must be used within CrossingsProvider"
    );
  }

  return ctx;
}