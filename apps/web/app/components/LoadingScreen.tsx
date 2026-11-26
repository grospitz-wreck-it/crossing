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
        <svg className={styles.barrierScene} viewBox="0 0 420 220" role="img" aria-label="Animierte Bahnschranke">
          <defs>
            <linearGradient id="barrier-metal" x1="0" x2="1" y1="0" y2="1">
              <stop offset="0" stopColor="#7f8b9b" />
              <stop offset=".5" stopColor="#3d4858" />
              <stop offset="1" stopColor="#202b3a" />
            </linearGradient>
            <pattern id="barrier-stripes" width="34" height="34" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="17" height="34" fill="#fff" />
              <rect x="17" width="17" height="34" fill="#e3343f" />
            </pattern>
            <filter id="barrier-shadow" x="-30%" y="-30%" width="160%" height="180%">
              <feDropShadow dx="0" dy="8" stdDeviation="7" floodColor="#1c2938" floodOpacity=".2" />
            </filter>
          </defs>
          <ellipse cx="210" cy="190" rx="142" ry="13" fill="#26364b" opacity=".12" />
          <path d="M52 188H368" stroke="#8492a4" strokeWidth="5" strokeLinecap="round" opacity=".65" />
          <path d="M72 179H348" stroke="#fff" strokeWidth="3" strokeDasharray="12 12" opacity=".9" />
          <g filter="url(#barrier-shadow)">
            <rect x="190" y="137" width="40" height="48" rx="8" fill="url(#barrier-metal)" />
            <rect x="198" y="120" width="24" height="25" rx="6" fill="#263445" />
            <circle cx="210" cy="125" r="15" fill="#d5dce5" stroke="#344255" strokeWidth="5" />
            <g className={styles.barrierArm}>
              <rect x="64" y="117" width="150" height="16" rx="8" fill="url(#barrier-stripes)" stroke="#fff" strokeWidth="2" />
              <rect x="64" y="117" width="18" height="16" rx="7" fill="#e3343f" />
              <circle cx="72" cy="125" r="3" fill="#fff" opacity=".9" />
            </g>
            <rect x="188" y="173" width="44" height="13" rx="5" fill="#253447" />
          </g>
          <g className={styles.signalLights}>
            <rect x="258" y="65" width="48" height="64" rx="13" fill="#263445" />
            <circle cx="282" cy="84" r="10" fill="#f0444e" />
            <circle cx="282" cy="110" r="10" fill="#f0444e" />
            <circle cx="282" cy="84" r="15" fill="#f0444e" opacity=".16" />
            <circle cx="282" cy="110" r="15" fill="#f0444e" opacity=".16" />
          </g>
        </svg>
        <div className={styles.loadingTrack}>
          <span />
        </div>
      </div>
    </main>
  );
}
