"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import ForecastOverlay from "./ForecastOverlay";
import ApiBudgetPanel from "./ApiBudgetPanel";
import styles from "./layout.module.css";

export default function CrossingsAdminLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const active = (href: string) => pathname === href ? styles.active : "";
  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <a className={styles.brand} href="/admin/crossings" aria-label="meineschranke">
          <img src="/images/meineschranke_logo.webp" alt="meineschranke" />
        </a>
        <nav className={styles.nav} aria-label="Admin Navigation">
          <div className={styles.navLabel}>ÜBERSICHT</div>
          <a href="/admin" className={styles.navItem}>⌂ <span>Dashboard</span></a>
          <a href="/admin/crossings" className={`${styles.navItem} ${active("/admin/crossings")}`}>◫ <span>Bahnübergänge</span></a>
          <div className={styles.navLabel}>DATEN</div>
          <a href="/admin/crossings" className={styles.navItem}>⌁ <span>Prognosen</span></a>
          <a href="/admin/crossings" className={styles.navItem}>▣ <span>DB-Stationen</span></a>
          <a href="/admin/crossings" className={styles.navItem}>▤ <span>Fahrpläne</span></a>
          <div className={styles.navLabel}>SYSTEM</div>
          <a href="/admin/crossings/api" className={`${styles.navItem} ${active("/admin/crossings/api")}`}>◉ <span>DB API</span></a>
          <a href="/admin/crossings" className={styles.navItem}>⚙ <span>Einstellungen</span></a>
        </nav>
        <ApiBudgetPanel />
        <div className={styles.sidebarFoot}><span className={styles.onlineDot} /> System aktiv</div>
      </aside>
      <div className={styles.main}>{children}</div>
      <ForecastOverlay />
    </div>
  );
}
