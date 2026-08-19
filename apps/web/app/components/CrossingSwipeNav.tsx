"use client";

import { useEffect, useRef, useState } from "react";
import { useCrossings } from "../context/CrossingsContext";
import styles from "./CrossingSwipeNav.module.css";

const SWIPE_THRESHOLD = 48;
const SWIPE_ANIMATION_MS = 220;

type Props = {
  children?: React.ReactNode;
};

export default function CrossingSwipeNav({ children }: Props) {
  const { saved, activeId, setActiveId } = useCrossings();
  const startX = useRef<number | null>(null);
  const startY = useRef<number | null>(null);
  const pointerId = useRef<number | null>(null);
  const animationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [dragX, setDragX] = useState(0);
  const [animating, setAnimating] = useState(false);

  const activeIndex = saved.findIndex((crossing) => crossing.id === activeId);

  function selectIndex(index: number) {
    if (index < 0 || index >= saved.length || index === activeIndex) return;
    setActiveId(saved[index].id);
  }

  function resetGesture() {
    startX.current = null;
    startY.current = null;
    pointerId.current = null;
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (animating || saved.length <= 1) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;

    startX.current = event.clientX;
    startY.current = event.clientY;
    pointerId.current = event.pointerId;
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (
      animating ||
      startX.current === null ||
      startY.current === null ||
      pointerId.current !== event.pointerId
    ) {
      return;
    }

    const deltaX = event.clientX - startX.current;
    const deltaY = event.clientY - startY.current;

    // Keep normal vertical page scrolling intact.
    if (Math.abs(deltaY) > Math.abs(deltaX) && Math.abs(deltaY) > 8) {
      return;
    }

    // Resist dragging beyond the first/last crossing.
    const atStart = activeIndex <= 0 && deltaX > 0;
    const atEnd = activeIndex >= saved.length - 1 && deltaX < 0;
    const resistance = atStart || atEnd ? 0.28 : 1;

    setDragX(deltaX * resistance);
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (
      startX.current === null ||
      startY.current === null ||
      pointerId.current !== event.pointerId
    ) {
      return;
    }

    const deltaX = event.clientX - startX.current;
    const deltaY = event.clientY - startY.current;
    resetGesture();

    if (
      Math.abs(deltaX) < SWIPE_THRESHOLD ||
      Math.abs(deltaX) <= Math.abs(deltaY)
    ) {
      setAnimating(true);
      setDragX(0);
      window.setTimeout(() => setAnimating(false), 160);
      return;
    }

    const direction = deltaX < 0 ? -1 : 1;
    const nextIndex = activeIndex + (direction < 0 ? 1 : -1);

    if (nextIndex < 0 || nextIndex >= saved.length) {
      setAnimating(true);
      setDragX(0);
      window.setTimeout(() => setAnimating(false), 160);
      return;
    }

    // First animate the current crossing out of the viewport.
    setAnimating(true);
    setDragX(direction * window.innerWidth * -1);

    animationTimer.current = window.setTimeout(() => {
      const nextId = saved[nextIndex].id;

      // Put the new crossing just outside the opposite edge without animation.
      setActiveId(nextId);
      setAnimating(false);
      setDragX(direction * window.innerWidth);

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setAnimating(true);
          setDragX(0);

          animationTimer.current = window.setTimeout(() => {
            setAnimating(false);
          }, SWIPE_ANIMATION_MS);
        });
      });
    }, SWIPE_ANIMATION_MS);
  }

  function handlePointerCancel() {
    resetGesture();
    setAnimating(true);
    setDragX(0);
    window.setTimeout(() => setAnimating(false), 160);
  }

  useEffect(() => {
    return () => {
      if (animationTimer.current) {
        clearTimeout(animationTimer.current);
      }
    };
  }, []);

  return (
    <div
      className={styles.gestureStage}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      style={{
        transform: `translate3d(${dragX}px, 0, 0)`,
        transition: animating
          ? `transform ${SWIPE_ANIMATION_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`
          : "none",
      }}
    >
      {children}

      {saved.length > 1 && (
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
      )}
    </div>
  );
}
