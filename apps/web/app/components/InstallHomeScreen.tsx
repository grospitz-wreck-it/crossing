"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import styles from "./InstallHomeScreen.module.css";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

export default function InstallHomeScreen() {
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const ua = window.navigator.userAgent;
    setIsIos(/iPhone|iPad|iPod/i.test(ua));
    const standalone = window.matchMedia("(display-mode: standalone)").matches
      || (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
    setInstalled(standalone);

    const handlePrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    const handleInstalled = () => {
      setInstalled(true);
      setInstallPrompt(null);
      setShowHelp(false);
    };

    window.addEventListener("beforeinstallprompt", handlePrompt);
    window.addEventListener("appinstalled", handleInstalled);
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js").catch((error) => {
        console.error("Service worker registration failed:", error);
      });
    }
    return () => {
      window.removeEventListener("beforeinstallprompt", handlePrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  async function install() {
    if (installPrompt) {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === "accepted") setInstalled(true);
      setInstallPrompt(null);
      return;
    }
    setShowHelp(true);
  }

  if (installed) return null;

  return (
    <div className={styles.wrap}>
      <button type="button" className={styles.installButton} onClick={() => void install()}>
        <span className={styles.installIcon} aria-hidden="true">＋</span>
        <span><strong>Zum Homescreen hinzufügen</strong><small>meineschranke wie eine App nutzen</small></span>
        <span className={styles.arrow} aria-hidden="true">→</span>
      </button>
      {showHelp && (
        <div className={styles.backdrop} role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setShowHelp(false);
        }}>
          <section className={styles.help} role="dialog" aria-modal="true" aria-labelledby="install-help-title">
            <button type="button" className={styles.close} onClick={() => setShowHelp(false)} aria-label="Schließen">×</button>
            <span className={styles.eyebrow}>MEINESCHRANKE FÜR UNTERWEGS</span>
            <h2 id="install-help-title">Auf deinen Homescreen</h2>
            {isIos ? (
              <ol>
                <li>Öffne meineschranke in <strong>Safari</strong>.</li>
                <li>Tippe unten auf <strong>Teilen</strong> (das Quadrat mit Pfeil).</li>
                <li>Wähle <strong>„Zum Home-Bildschirm“</strong> und bestätige.</li>
              </ol>
            ) : (
              <ol>
                <li>Öffne die Seite in <strong>Chrome</strong> oder einem unterstützten Browser.</li>
                <li>Öffne das Browser-Menü und wähle <strong>„App installieren“</strong> oder <strong>„Zum Startbildschirm hinzufügen“</strong>.</li>
              </ol>
            )}
            <Link className={styles.openApp} href="/app">Jetzt zur App <span>→</span></Link>
          </section>
        </div>
      )}
    </div>
  );
}
