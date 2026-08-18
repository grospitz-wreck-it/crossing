"use client";

import { useEffect, useRef } from "react";
import { useCrossings } from "../context/CrossingsContext";
import styles from "./CrossingSwipeNav.module.css";

const SWIPE_THRESHOLD = 48;

export default function CrossingSwipeNav() {
  const { saved, activeId, setActiveId } = useCrossings();
  const startX = useRef<number | null>(null);
  const startY = useRef<number | null>(null);

  const activeIndex = saved.findIndex((crossing) => crossing.id === activeId);

  function selectIndex(index: number) {
    if (index < 0 || index >= saved.length) return;
    setActiveId(saved[index].id);
  }

  function handleTouchStart(event: TouchEvent) {
    if (event.touches.length !== 1) return;
    startX.current = event.touches[0].clientX;
    startY.current = event.touches[0].clientY;
  }

  function handleTouchEnd(event: TouchEvent) {
    if (startX.current === null || startY.current === null) return;

    const endX = event.changedTouches[0]?.clientX ?? startX.current;
    const endY = event.changedTouches[0]?.clientY ?? startY.current;
    const deltaX = endX - startX.current;
    const deltaY = endY - startY.current;

    startX.current = null;
    startY.current = null;

    if (Math.abs(deltaX) < SWIPE_THRESHOLD || Math.abs(deltaX) <= Math.abs(deltaY)) {
      return;
    }

    if (deltaX < 0) {
      selectIndex(activeIndex + 1);
    } else {
      selectIndex(activeIndex - 1);
    }
  }

  useEffect(() => {
    window.addEventListener("touchstart", handleTouchStart, { passive: true });
    window.addEventListener("touchend", handleTouchEnd, { passive: true });

    return () => {
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchend", handleTouchEnd);
    };
  });

  if (saved.length <= 1) return null;

  return (
    <nav className={styles.nav} aria-label="Meine Bahnübergänge">
      <div className={styles.dots}>
        {saved.map((crossing, index) => (
          <button
            key={crossing.id}
            type="button"
            className={`${styles.dot} ${index === activeIndex ? styles.active : ""}`}
            onClick={() => selectIndex(index)}
            aria-label={`${crossing.name} auswählen`}
            aria-current={index === activeIndex ? "true" : undefined}
          />
        ))}
      </div>
    </nav>
  );
}
