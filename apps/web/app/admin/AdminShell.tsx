"use client";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import AdminIcon, { type AdminIconName } from "./components/AdminIcon";
import styles from "./AdminShell.module.css";
import "./admin-tailwind.css";

type NavItem = [string, string, AdminIconName];
type NavGroup = { label: string; items: NavItem[] };
const groups: NavGroup[] = [
  { label: "ÜBERSICHT", items: [["/admin", "Dashboard", "home"]] },
  { label: "BETRIEB", items: [["/admin/crossings", "Bahnübergänge", "railway"], ["/admin/measurements", "Messungen", "clock"]] },
  { label: "VERMARKTUNG", items: [["/admin/ads", "Werbung & Kampagnen", "megaphone"], ["/admin/content", "Content-Studio", "pencil"], ["/admin/customers", "Kunden", "users"]] },
  { label: "DATEN & SYSTEM", items: [["/admin/crossings/api", "DB API & Verbrauch", "activity"], ["/admin/crossings/forecasts", "Prognosen", "chart"]] },
];

export default function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const activeItem = groups.flatMap((group) => group.items)
    .filter(([href]) => pathname === href || (href !== "/admin" && pathname.startsWith(href + "/")))
    .sort(([a], [b]) => b.length - a.length)[0];
  const [campaignCount, setCampaignCount] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/admin/campaigns", { cache: "no-store" })
      .then((r) => r.ok ? r.json() : [])
      .then((data) => { if (alive) setCampaignCount(Array.isArray(data) ? data.length : 0); })
      .catch(() => { if (alive) setCampaignCount(null); });
    return () => { alive = false; };
  }, []);

  return <div className={styles.shell}>
    <aside className={styles.sidebar}>
      <a href="/admin" className={styles.brand}>
        <img src="/images/meineschranke_logo.webp" alt="meineschranke" />
        <span><b>CONTROL CENTER</b><small>Administration</small></span>
      </a>
      <nav aria-label="Admin Navigation">
        {groups.map((group) => <div className={styles.group} key={group.label}>
          <div className={styles.label}>{group.label}</div>
          {group.items.map(([href, label, icon]) => <a key={href} href={href}
            className={activeItem?.[0] === href ? styles.active : styles.link}>
            <AdminIcon name={icon} className={styles.navIcon} size={17} />
            <span>{label}</span>
            {href === "/admin/ads" && campaignCount !== null && <em>{campaignCount}</em>}
          </a>)}
        </div>)}
      </nav>
      <div className={styles.sidebarFoot}><i /> Systembereich</div>
    </aside>
    <div className={styles.workspace}>
      <header className={styles.topbar}>
        <div><span>MEINESCHRANKE</span><b>/</b><strong>{activeItem?.[1] || "Administration"}</strong></div>
        <a href="/admin">Zur Übersicht <AdminIcon name="arrow-up-right" size={13} /></a>
      </header>
      <main className={styles.content}>{children}</main>
    </div>
  </div>;
}
