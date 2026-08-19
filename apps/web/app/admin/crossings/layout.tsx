import type { ReactNode } from "react";
import ForecastOverlay from "./ForecastOverlay";
import ApiBudgetPanel from "./ApiBudgetPanel";
import styles from "./layout.module.css";

export default function CrossingsAdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <span className={styles.brandMark}>↗</span>
          <span><strong>meine</strong><b>schranke</b></span>
        </div>
        <nav className={styles.nav} aria-label="Admin Navigation">
          <div className={styles.navLabel}>ÜBERSICHT</div>
          <a href="/admin" className={styles.navItem}>⌂ <span>Dashboard</span></a>
          <a href="/admin/crossings" className={`${styles.navItem} ${styles.active}`}>◫ <span>Bahnübergänge</span></a>
          <div className={styles.navLabel}>DATEN</div>
          <a href="/admin/crossings" className={styles.navItem}>⌁ <span>Prognosen</span></a>
          <a href="/admin/crossings" className={styles.navItem}>▣ <span>DB-Stationen</span></a>
          <a href="/admin/crossings" className={styles.navItem}>▤ <span>Fahrpläne</span></a>
          <div className={styles.navLabel}>SYSTEM</div>
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
