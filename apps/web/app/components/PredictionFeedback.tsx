"use client";

import { useEffect, useState } from "react";
import styles from "./PredictionFeedback.module.css";

const ACTIVE_KEY = "crossing-app:active-crossing";
const RATED_PREFIX = "crossing-app:rated-prediction:";

const ratings = [
  { value: 5, icon: "👍", label: "Sehr gut" },
  { value: 4, icon: "👍", label: "Gut" },
  { value: 3, icon: "😐", label: "Okay" },
  { value: 2, icon: "👎", label: "Schlecht" },
  { value: 1, icon: "👎", label: "Sehr schlecht" },
];

function makePredictionId(crossingId: string, phase: any) {
  const trainIds = (phase?.trains ?? [])
    .map((train: any) => String(train.id ?? ""))
    .sort()
    .join(",");

  return `${crossingId}:${phase?.start ?? ""}:${phase?.end ?? ""}:${trainIds}`;
}

export default function PredictionFeedback() {
  const [predictionId, setPredictionId] = useState<string | null>(null);
  const [rated, setRated] = useState(false);
  const [sending, setSending] = useState(false);
  const [thanks, setThanks] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadPrediction() {
      const crossingId =
        window.localStorage.getItem(ACTIVE_KEY) ?? "kirchlengern";

      try {
        const response = await fetch(
          `/api/crossings/${encodeURIComponent(crossingId)}/status`,
          { cache: "no-store" }
        );

        if (!response.ok) return;

        const data = await response.json();
        if (!data?.phase?.start || !data?.phase?.end) return;

        const id = makePredictionId(crossingId, data.phase);
        const alreadyRated =
          window.localStorage.getItem(RATED_PREFIX + id) === "1";

        if (!cancelled) {
          setPredictionId(id);
          setRated(alreadyRated);
        }
      } catch (error) {
        console.error("Prediction feedback load failed", error);
      }
    }

    loadPrediction();

    return () => {
      cancelled = true;
    };
  }, []);

  async function rate(value: number) {
    if (!predictionId || sending || rated) return;

    setSending(true);

    try {
      const crossingId =
        window.localStorage.getItem(ACTIVE_KEY) ?? "kirchlengern";

      const response = await fetch("/api/prediction-feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          predictionId,
          crossingId,
          rating: value,
        }),
      });

      if (!response.ok) throw new Error(`Feedback failed: ${response.status}`);

      window.localStorage.setItem(RATED_PREFIX + predictionId, "1");
      setRated(true);
      setThanks(true);
    } catch (error) {
      console.error("Prediction feedback failed", error);
    } finally {
      setSending(false);
    }
  }

  if (!predictionId || rated && !thanks) return null;

  return (
    <section className={styles.feedback} aria-label="Prognose bewerten">
      <div className={styles.copy}>
        <span className={styles.eyebrow}>GEMEINSAM BESSER</span>
        <h2>War die Prognose zutreffend?</h2>
        <p>
          Ein Klick hilft uns, die Prognosen für diesen Bahnübergang weiter zu verbessern.
        </p>
      </div>

      {thanks ? (
        <div className={styles.thanks}>✓ Danke – dein Feedback hilft bei der Verbesserung.</div>
      ) : (
        <div className={styles.ratingRow}>
          {ratings.map((rating) => (
            <button
              key={rating.value}
              type="button"
              className={styles.ratingButton}
              onClick={() => rate(rating.value)}
              disabled={sending}
              aria-label={rating.label}
            >
              <span>{rating.icon}</span>
              <small>{rating.label}</small>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
