"use client";

import { useMemo } from "react";
import styles from "./MyCrossingsMap.module.css";

type Crossing = {
  id: string;
  name: string;
  lat?: number | null;
  lon?: number | null;
};

type Props = {
  crossings: Crossing[];
  activeId: string | null;
  favoriteId?: string | null;
  onSelect: (id: string) => void;
};

export default function MyCrossingsMap({
  crossings,
  activeId,
  favoriteId,
  onSelect,
}: Props) {
  const points = useMemo(() => {
    const valid = crossings.filter(
      (c) =>
        typeof c.lat === "number" &&
        Number.isFinite(c.lat) &&
        typeof c.lon === "number" &&
        Number.isFinite(c.lon),
    );

    if (!valid.length) return [];

    const lats = valid.map((c) => c.lat as number);
    const lons = valid.map((c) => c.lon as number);

    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLon = Math.min(...lons);
    const maxLon = Math.max(...lons);

    const latSpan = Math.max(maxLat - minLat, 0.01);
    const lonSpan = Math.max(maxLon - minLon, 0.01);

    /*
     * Etwas Innenabstand, damit Marker nicht direkt am Rand kleben.
     */
    const padding = 14;

    return valid.map((crossing) => {
      const x =
        padding +
        (((crossing.lon as number) - minLon) / lonSpan) *
          (100 - padding * 2);

      /*
       * Latitude wächst nach Norden, CSS-y aber nach unten.
       */
      const y =
        100 -
        padding -
        (((crossing.lat as number) - minLat) / latSpan) *
          (100 - padding * 2);

      return {
        crossing,
        x,
        y,
      };
    });
  }, [crossings]);

  if (!points.length) {
    return (
      <div className={styles.empty}>
        <span className={styles.emptyIcon}>⌖</span>
        <span>Für deine Schranken sind noch keine Koordinaten verfügbar.</span>
      </div>
    );
  }

  return (
    <div className={styles.map} aria-label="Meine Schranken Karte">
      <div className={styles.grid} />

      <div className={styles.railLine} />
      <div className={`${styles.railLine} ${styles.railLineSecondary}`} />

      {points.map(({ crossing, x, y }) => {
        const active = crossing.id === activeId;
        const favorite = crossing.id === favoriteId;

        return (
          <button
            key={crossing.id}
            type="button"
            className={`${styles.marker} ${
              active ? styles.markerActive : ""
            } ${favorite ? styles.markerFavorite : ""}`}
            style={{
              left: `${x}%`,
              top: `${y}%`,
            }}
            onClick={() => onSelect(crossing.id)}
            aria-label={`${crossing.name}${
              favorite ? ", Favorit" : ""
            }`}
          >
            {favorite && (
              <span className={styles.star}>★</span>
            )}
            <span className={styles.dot} />
            <span className={styles.tooltip}>
              {crossing.name}
            </span>
          </button>
        );
      })}

      <div className={styles.legend}>
        <span className={styles.legendDot} />
        <span>Meine Schranken</span>
      </div>
    </div>
  );
}
