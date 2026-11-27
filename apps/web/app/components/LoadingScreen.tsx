"use client";

import styles from "./LoadingScreen.module.css";

type LoadingScreenProps = {
  message?: string;
  detail?: string;
  progress?: number;
  onComplete?: () => void;
};

export default function LoadingScreen({ message, detail, progress = 0, onComplete }: LoadingScreenProps) {
  return (
    <main className={`${styles.loadingScreen} splash-active`} role="status" aria-live="polite">
      <div className={styles.loadingOverlay} />
      <div className={styles.splashContent}>
        <img
          src="/images/meineschranke_logo_trans.webp"
          alt="Meine Schranke"
          className={styles.loadingLogo}
        />

        <div className={styles.loadingBar} aria-label="Schranken-Animation">
          <div
            className={styles.loadingBarFill}
            style={{ transform: `rotate(${-70 * Math.max(0, Math.min(100, progress)) / 100}deg)` }}
            onTransitionEnd={(event) => {
              if (event.currentTarget === event.target && event.propertyName === "transform" && progress >= 100) {
                onComplete?.();
              }
            }}
          />
        </div>

        <div className={styles.loadingCopy}>
          <span className={styles.loadingEyebrow}>Einen Moment bitte</span>
          {message && <p className={styles.loadingMessage}>{message}</p>}
          <p className={styles.loadingDetail} aria-hidden={!detail}>{detail || "\u00a0"}</p>
          <div className={styles.loadingProgress} aria-hidden="true">
            <span />
          </div>
        </div>
      </div>
    </main>
  );
}
