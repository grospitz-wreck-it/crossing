"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useCrossings } from "../context/CrossingsContext";
import styles from "./CrossingSwipeNav.module.css";

const SWIPE_THRESHOLD = 48;
const SWIPE_ANIMATION_MS = 220;

type Props = {
  children?: React.ReactNode;
};

export default function CrossingSwipeNav({ children }: Props) {
  const { saved, activeId, setActiveId } = useCrossings();
  const pathname = usePathname();
  const showIndicators = pathname !== "/app/meine-schranken";
  const enableCrossingSwipe = pathname === "/app";
  const startX = useRef<number | null>(null);
  const startY = useRef<number | null>(null);
  const pointerId = useRef<number | null>(null);
  const animationTimer = useRef<number | null>(null);

  const [dragX, setDragX] = useState(0);
  const [animating, setAnimating] = useState(false);

  const activeIndex = saved.findIndex((crossing) => crossing.id === activeId);

  function resetGesture() {
    startX.current = null;
    startY.current = null;
    pointerId.current = null;
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (animating || saved.length <= 1) return;
    if (event.target instanceof Element && event.target.closest("[data-no-crossing-swipe]")) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    startX.current = event.clientX;
    startY.current = event.clientY;
    pointerId.current = event.pointerId;
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (animating || startX.current === null || startY.current === null || pointerId.current !== event.pointerId) return;

    const deltaX = event.clientX - startX.current;
    const deltaY = event.clientY - startY.current;

    if (Math.abs(deltaY) > Math.abs(deltaX) && Math.abs(deltaY) > 8) return;

    const atStart = activeIndex <= 0 && deltaX > 0;
    const atEnd = activeIndex >= saved.length - 1 && deltaX < 0;
    const resistance = atStart || atEnd ? 0.28 : 1;
    setDragX(deltaX * resistance);
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (startX.current === null || startY.current === null || pointerId.current !== event.pointerId) return;

    const deltaX = event.clientX - startX.current;
    const deltaY = event.clientY - startY.current;
    resetGesture();

    if (Math.abs(deltaX) < SWIPE_THRESHOLD || Math.abs(deltaX) <= Math.abs(deltaY)) {
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

    setAnimating(true);
    setDragX(direction * window.innerWidth);

    animationTimer.current = window.setTimeout(() => {
      const nextId = saved[nextIndex].id;
      setActiveId(nextId);
      setAnimating(false);
      setDragX(-direction * window.innerWidth);

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setAnimating(true);
          setDragX(0);
          animationTimer.current = window.setTimeout(() => setAnimating(false), SWIPE_ANIMATION_MS);
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
      if (animationTimer.current !== null) window.clearTimeout(animationTimer.current);
    };
  }, []);

  return (
    <>
      {showIndicators && saved.length > 1 && (
        <nav className={styles.nav} aria-label="Meine Bahnübergänge">
          <div className={styles.dots}>
            {saved.map((crossing, index) => (
              <span
                key={crossing.id}
                className={`${styles.dot} ${index === activeIndex ? styles.active : ""}`}
                aria-label={`${crossing.name}${index === activeIndex ? ", aktiv" : ""}`}
                aria-current={index === activeIndex ? "true" : undefined}
              />
            ))}
          </div>
        </nav>
      )}

      <div
        className={styles.gestureStage}
        onPointerDown={enableCrossingSwipe ? handlePointerDown : undefined}
        onPointerMove={enableCrossingSwipe ? handlePointerMove : undefined}
        onPointerUp={enableCrossingSwipe ? handlePointerUp : undefined}
        onPointerCancel={enableCrossingSwipe ? handlePointerCancel : undefined}
        style={enableCrossingSwipe ? {
          transform: `translate3d(${dragX}px, 0, 0)`,
          transition: animating
            ? `transform ${SWIPE_ANIMATION_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`
            : "none",
        } : undefined}
      >
        {children}
      </div>
    </>
  );
}
