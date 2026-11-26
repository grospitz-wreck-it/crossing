"use client";

import styles from "./LoadingScreen.module.css";

type LoadingScreenProps = { message?: string; detail?: string };

export default function LoadingScreen({ message, detail }: LoadingScreenProps) {
  return (
    <main className={styles.loadingScreen} role="status" aria-live="polite">
      <div className={styles.loadingOverlay} />
      <div className={styles.splashContent}>
        <img
          src="/images/meineschranke_logo.webp"
          alt="Meine Schranke"
          className={styles.loadingLogo}
        />
        {message && <p className={styles.loadingMessage}>{message}</p>}
        {detail && <p className={styles.loadingDetail}>{detail}</p>}
        <div className={styles.loadingBar} aria-label="Schranke öffnet sich">
          <div className={styles.loadingBarFill} />
        </div>
      </div>
    </main>
  );
}
