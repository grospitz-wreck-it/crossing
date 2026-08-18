"use client";

import { useEffect, useRef } from "react";
import { useCrossings } from "../context/CrossingsContext";
import styles from "./CrossingSwipeNav.module.css";

const SWIPE_THRESHOLD = 48;
const SWIPE_MAX_DRAG = 140;

function getContent() {
  return document.querySelector<HTMLElement>("main.container");
}

export default function CrossingSwipeNav() {
  const { saved, activeId, setActiveId } = useCrossings();
  const startX = useRef<number | null>(null);
  const startY = useRef<number | null>(null);
  const dragging = useRef(false);
  const direction = useRef<1 | -1 | 0>(0);

  const activeIndex = saved.findIndex((crossing) => crossing.id === activeId);

  function clearDrag() {
    const content = getContent();
    if (content) {
      content.style.removeProperty("--crossing-swipe-x");
      content.classList.remove(styles.dragging, styles.slideNext, styles.slidePrevious);
    }
    dragging.current = false;
    direction.current = 0;
    startX.current = null;
    startY.current = null;
  }

  function selectIndex(index: number, swipeDirection: 1 | -1 = 0) {
    if (index < 0 || index >= saved.length) return;
    const content = getContent();

    if (content && swipeDirection) {
      content.classList.remove(styles.slideNext, styles.slidePrevious);
      // Force a new animation when repeatedly switching quickly.
      void content.offsetWidth;
      content.classList.add(
        swipeDirection > 0 ? styles.slideNext : styles.slidePrevious
      );
    }

    setActiveId(saved[index].id);
  }

  function handleTouchStart(event: TouchEvent) {
    if (event.touches.length !== 1 || saved.length <= 1) return;
    startX.current = event.touches[0].clientX;
    startY.current = event.touches[0].clientY;
    dragging.current = false;
    direction.current = 0;
  }

  function handleTouchMove(event: TouchEvent) {
    if (startX.current === null || startY.current === null) return;

    const touch = event.touches[0];
    if (!touch) return;

    const deltaX = touch.clientX - startX.current;
    const deltaY = touch.clientY - startY.current;

    if (!dragging.current) {
      if (Math.abs(deltaX) < 10 || Math.abs(deltaX) <= Math.abs(deltaY)) return;
      dragging.current = true;
      direction.current = deltaX < 0 ? -1 : 1;
    }

    if (!dragging.current) return;

    const atEdge =
      (direction.current === -1 && activeIndex >= saved.length - 1) ||
      (direction.current === 1 && activeIndex <= 0);

    const drag = atEdge ? deltaX * 0.22 : deltaX;
    const content = getContent();
    if (content) {
      content.classList.add(styles.dragging);
      content.style.setProperty(
        "--crossing-swipe-x",
        `${Math.max(-SWIPE_MAX_DRAG, Math.min(SWIPE_MAX_DRAG, drag))}px`
      );
    }
  }

  function handleTouchEnd(event: TouchEvent) {
    if (startX.current === null || startY.current === null) return;

    const endX = event.changedTouches[0]?.clientX ?? startX.current;
    const endY = event.changedTouches[0]?.clientY ?? startY.current;
    const deltaX = endX - startX.current;
    const deltaY = endY - startY.current;
    const horizontal = Math.abs(deltaX) >= SWIPE_THRESHOLD && Math.abs(deltaX) > Math.abs(deltaY);
    const swipeDirection: 1 | -1 = deltaX < 0 ? -1 : 1;

    if (horizontal && dragging.current) {
      const nextIndex = swipeDirection === -1 ? activeIndex + 1 : activeIndex - 1;
      const canMove = nextIndex >= 0 && nextIndex < saved.length;
      if (canMove) selectIndex(nextIndex, swipeDirection);
    }

    clearDrag();
  }

  useEffect(() => {
    window.addEventListener("touchstart", handleTouchStart, { passive: true });
    window.addEventListener("touchmove", handleTouchMove, { passive: true });
    window.addEventListener("touchend", handleTouchEnd, { passive: true });

    return () => {
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchmove", handleTouchMove);
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
