"use client";

import styles from "./LoadingScreen.module.css";

type LoadingScreenProps = { message?: string; detail?: string };

export default function LoadingScreen({ message, detail }: LoadingScreenProps) {
  return (
    <main className={styles.loadingScreen}>
      <div className={styles.loadingOverlay} />
      <img
        src="/images/meineschranke_logo.webp"
        alt="Meine Schranke"
        className={styles.loadingLogo}
      />
      {message && <p className={styles.loadingMessage}>{message}</p>}
      {detail && <p className={styles.loadingDetail}>{detail}</p>}
      <div className={styles.loadingBar}>
        <div className={styles.loadingBarFill} />
      </div>
    </main>
  );
}
