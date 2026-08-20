import styles from "./LoadingScreen.module.css";

export default function LoadingScreen() {
  return (
    <main className={styles.loadingScreen}>
      <div className={styles.loadingOverlay} />

      <img
        src="/images/meineschranke_logo.webp"
        alt="Meine Schranke"
        className={styles.loadingLogo}
      />

      <div className={styles.loadingBar}>
        <div className={styles.loadingBarFill} />
      </div>
    </main>
  );
}
