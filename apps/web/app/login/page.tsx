"use client";

import Image from "next/image";
import { signIn } from "next-auth/react";
import styles from "./Login.module.css";

export default function LoginPage() {
  async function handleGoogleLogin() {
    await signIn("google", {
      callbackUrl: "/app",
    });
  }

  return (
    <main className={styles.page}>
      <div className={styles.backdrop} aria-hidden="true" />
      <section className={styles.shell}>
        <div className={styles.brand}>
          <Image src="/images/meineschranke_logo.webp" alt="meineschranke" width={245} height={66} priority />
        </div>

        <div className={styles.card}>
          <div className={styles.eyebrow}>DEINE PERSÖNLICHE SCHRANKE</div>
          <h1>Willkommen bei<br /><span>meineschranke.</span></h1>
          <p className={styles.lead}>Melde dich an, um deine persönliche Schranke zu speichern und die Prognosen für Kirchlengern zu nutzen.</p>

          <button type="button" className={styles.google} onClick={handleGoogleLogin}>
            <svg className={styles.googleLogo} viewBox="0 0 24 24" aria-hidden="true">
              <path fill="#4285F4" d="M21.35 12.23c0-.78-.07-1.53-.22-2.23H12v4.22h5.23a4.47 4.47 0 0 1-1.94 2.93v2.44h3.14c1.84-1.69 2.92-4.18 2.92-7.36Z" />
              <path fill="#34A853" d="M12 21.6c2.63 0 4.84-.87 6.45-2.36l-3.14-2.44c-.87.58-1.98.93-3.31.93-2.54 0-4.69-1.72-5.46-4.03H3.3v2.52A9.74 9.74 0 0 0 12 21.6Z" />
              <path fill="#FBBC05" d="M6.54 13.7a5.85 5.85 0 0 1 0-3.4V7.78H3.3a9.76 9.76 0 0 0 0 8.44l3.24-2.52Z" />
              <path fill="#EA4335" d="M12 6.27c1.43 0 2.72.49 3.73 1.46l2.79-2.79C16.84 3.39 14.63 2.4 12 2.4a9.74 9.74 0 0 0-8.7 5.38l3.24 2.52C7.31 7.99 9.46 6.27 12 6.27Z" />
            </svg>
            <span>Mit Google anmelden</span>
          </button>

          <div className={styles.divider}><span>oder</span></div>
          <div className={styles.hint}>Weitere Anmeldeoptionen folgen.</div>
          <a href="/" className={styles.back}>← Zur Startseite</a>
        </div>

        <p className={styles.legal}>Mit der Anmeldung stimmst du den geltenden Datenschutzbestimmungen zu.</p>
      </section>
    </main>
  );
}
