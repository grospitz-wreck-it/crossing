"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useCrossings } from "../../context/CrossingsContext";

const MAX_FREE_CROSSINGS = 5;

type Crossing = {
  id: string;
  name: string;
  lat?: number;
  lon?: number;
  state?: string;
  city?: string;
  postal_code?: string;
};

function sortGerman(values: string[]) {
  return [...values].sort((a, b) =>
    a.localeCompare(b, "de-DE"),
  );
}

export default function CrossingSelectionPage() {
  const router = useRouter();

  const {
    saved,
    activeId,
    setActiveId,
    addCrossing,
  } = useCrossings();

  const [states, setStates] = useState<string[]>([]);
  const [cities, setCities] = useState<string[]>([]);
  const [crossings, setCrossings] = useState<Crossing[]>([]);

  const [state, setState] = useState("");
  const [cityQuery, setCityQuery] = useState("");
  const [city, setCity] = useState("");

  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(true);
  const [error, setError] = useState("");

  const citySuggestions = useMemo(() => {
    const q = cityQuery.trim().toLocaleLowerCase("de-DE");

    if (!q) {
      return cities.slice(0, 12);
    }

    return cities
      .filter((item) =>
        item.toLocaleLowerCase("de-DE").includes(q),
      )
      .slice(0, 12);
  }, [cities, cityQuery]);

  // Bundesländer laden
  useEffect(() => {
    let cancelled = false;

    async function loadStates() {
      try {
        const response = await fetch(
          "/api/crossings/search",
          { cache: "no-store" },
        );

        if (!response.ok) {
          throw new Error("Search API failed");
        }

        const data = await response.json();

        if (cancelled) return;

        setStates(sortGerman(data.states ?? []));
        setReady(data.ready !== false);
      } catch {
        if (!cancelled) {
          setError(
            "Die BÜ-Suche konnte nicht geladen werden.",
          );
        }
      }
    }

    loadStates();

    return () => {
      cancelled = true;
    };
  }, []);

  // Städte laden
  useEffect(() => {
    if (!state) {
      setCities([]);
      setCity("");
      return;
    }

    let cancelled = false;

    async function loadCities() {
      setLoading(true);
      setError("");

      try {
        const response = await fetch(
          `/api/crossings/search?state=${encodeURIComponent(state)}`,
          { cache: "no-store" },
        );

        if (!response.ok) {
          throw new Error("City search failed");
        }

        const data = await response.json();

        if (cancelled) return;

        setCities(sortGerman(data.cities ?? []));
      } catch {
        if (!cancelled) {
          setError(
            "Die Städte konnten nicht geladen werden.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadCities();

    return () => {
      cancelled = true;
    };
  }, [state]);

  // BÜs laden
  useEffect(() => {
    if (!state || !city) {
      setCrossings([]);
      return;
    }

    let cancelled = false;

    async function loadCrossings() {
      setLoading(true);
      setError("");

      try {
        const params = new URLSearchParams({
          state,
          city,
        });

        const response = await fetch(
          `/api/crossings/search?${params.toString()}`,
          { cache: "no-store" },
        );

        if (!response.ok) {
          throw new Error("Crossing search failed");
        }

        const data = await response.json();

        if (cancelled) return;

        setCrossings(data.crossings ?? []);
      } catch {
        if (!cancelled) {
          setError(
            "Die Bahnübergänge konnten nicht geladen werden.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadCrossings();

    return () => {
      cancelled = true;
    };
  }, [state, city]);

  async function selectCrossing(crossing: Crossing) {
    setError("");

    if (saved.some((item) => item.id === crossing.id)) {
      setActiveId(crossing.id);
      router.push("/app");
      return;
    }

    if (saved.length >= MAX_FREE_CROSSINGS) {
      setError(
        `Du kannst kostenlos maximal ${MAX_FREE_CROSSINGS} Bahnübergänge auswählen.`,
      );
      return;
    }

    await addCrossing({
      id: crossing.id,
      name: crossing.name,
    });

    setActiveId(crossing.id);
    router.push("/app");
  }

  return (
    <main className="crossingSelection">
      <section className="crossingSelectionCard">
        <div className="crossingSelectionEyebrow">
          MEINE BAHNÜBERGÄNGE
        </div>

        <h1>
          Welche Bahnübergänge
          <br />
          möchtest du im Blick behalten?
        </h1>

        <p className="crossingSelectionIntro">
          Wähle bis zu {MAX_FREE_CROSSINGS} kostenlose
          Bahnübergänge.
        </p>

        <div className="crossingSelectionCount">
          {saved.length} / {MAX_FREE_CROSSINGS}
        </div>

        {!ready && (
          <div className="crossingSelectionInfo">
            Die Ortsdatenbank wird gerade vorbereitet.
          </div>
        )}

        <label className="crossingSelectionLabel">
          Bundesland
        </label>

        <select
          className="crossingSelectionInput"
          value={state}
          onChange={(event) => {
            setState(event.target.value);
            setCity("");
            setCityQuery("");
            setCrossings([]);
          }}
        >
          <option value="">
            Bundesland auswählen
          </option>

          {states.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>

        {state && (
          <>
            <label className="crossingSelectionLabel">
              Stadt
            </label>

            <input
              className="crossingSelectionInput"
              value={cityQuery}
              onChange={(event) => {
                setCityQuery(event.target.value);
                setCity("");
                setCrossings([]);
              }}
              placeholder="Stadt eingeben …"
              autoComplete="off"
            />

            {cityQuery && !city && (
              <div className="crossingSelectionSuggestions">
                {citySuggestions.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => {
                      setCity(item);
                      setCityQuery(item);
                    }}
                  >
                    {item}
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {city && (
          <div className="crossingSelectionList">
            <div className="crossingSelectionLabel">
              Bahnübergänge in {city}
            </div>

            {loading && (
              <div className="crossingSelectionEmpty">
                Lade Bahnübergänge …
              </div>
            )}

            {!loading && crossings.length === 0 && (
              <div className="crossingSelectionEmpty">
                Keine Bahnübergänge gefunden.
              </div>
            )}

            {!loading &&
              crossings.map((crossing) => {
                const selected = saved.some(
                  (item) => item.id === crossing.id,
                );

                return (
                  <button
                    key={crossing.id}
                    type="button"
                    className={`crossingSelectionItem ${
                      selected
                        ? "crossingSelectionItemSelected"
                        : ""
                    }`}
                    onClick={() =>
                      selectCrossing(crossing)
                    }
                  >
                    <span>
                      <strong>{crossing.name}</strong>

                      {selected && (
                        <small>
                          Bereits ausgewählt
                        </small>
                      )}
                    </span>

                    <span>
                      {selected ? "✓" : "+"}
                    </span>
                  </button>
                );
              })}
          </div>
        )}

        {error && (
          <div className="crossingSelectionError">
            {error}
          </div>
        )}

        {saved.length > 0 && (
          <button
            type="button"
            className="crossingSelectionContinue"
            onClick={() => {
              if (activeId) {
                router.push("/app");
              }
            }}
          >
            Zur App
          </button>
        )}
      </section>
    </main>
  );
}
