"use client";

import styles from "./LoadingScreen.module.css";

type LoadingScreenProps = { message?: string; detail?: string };

export default function LoadingScreen({ message, detail }: LoadingScreenProps) {
  return (
    <main className={styles.loadingScreen} role="status" aria-live="polite">
      <div className={styles.loadingOverlay} />
      <div className={styles.splashContent}>
        <div className={styles.loadingBar} aria-label="Schranken-Animation">
          <div className={styles.loadingBarFill} />
        </div>

        <img
          src="/images/meineschranke_logo_trans.webp"
          alt="Meine Schranke"
          className={styles.loadingLogo}
        />

        <div className={styles.loadingCopy}>
          <span className={styles.loadingEyebrow}>Einen Moment bitte</span>
          {message && <p className={styles.loadingMessage}>{message}</p>}
          {detail && <p className={styles.loadingDetail}>{detail}</p>}
          <div className={styles.loadingProgress} aria-hidden="true">
            <span />
          </div>
        </div>
      </div>
    </main>
  );
}
