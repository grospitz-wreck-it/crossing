"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./page.module.css";

type Customer = {
  id: string;
  name: string;
  active: number | boolean;
  campaign_count: number | string;
  running_campaign_count: number | string;
  active_campaign_count: number | string;
  calculated_revenue: number | string;
};

const n = (value: number | string | null | undefined) => Number(value ?? 0);
const money = (value: number | string) => new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 2 }).format(n(value));

export default function CustomersPage() {
  const [rows, setRows] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<"asc" | "desc">("asc");
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");

  async function load() {
    setLoadError("");
    try {
      const response = await fetch("/api/admin/customers", { cache: "no-store" });
      if (!response.ok) throw new Error("Kunden konnten nicht geladen werden.");
      setRows(await response.json());
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Laden fehlgeschlagen.");
    } finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);

  const sortedRows = useMemo(() => [...rows].sort((a, b) =>
    sort === "asc" ? a.name.localeCompare(b.name, "de", { sensitivity: "base" }) : b.name.localeCompare(a.name, "de", { sensitivity: "base" })
  ), [rows, sort]);

  const totals = useMemo(() => rows.reduce((sum, row) => ({
    campaigns: sum.campaigns + n(row.campaign_count),
    running: sum.running + n(row.running_campaign_count),
    active: sum.active + n(row.active_campaign_count),
    revenue: sum.revenue + n(row.calculated_revenue),
  }), { campaigns: 0, running: 0, active: 0, revenue: 0 }), [rows]);

  async function createCustomer(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) { setError("Bitte einen Kundennamen eingeben."); return; }
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/admin/customers", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Kunde konnte nicht angelegt werden.");
      setName(""); setShowCreate(false); await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Anlegen fehlgeschlagen.");
    } finally { setSaving(false); }
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div><span className={styles.eyebrow}>VERMARKTUNG</span><h1>Kunden</h1><p>Kunden, Kampagnen und bisher erzieltes Werbevolumen im Überblick.</p></div>
        <button className={styles.primary} onClick={() => { setError(""); setShowCreate(true); }}><span>＋</span> Kunde anlegen</button>
      </header>

      <section className={styles.kpis} aria-label="Kundenkennzahlen">
        <article className={styles.kpi}><span>Kunden</span><strong>{rows.length}</strong><small>Gesamtbestand</small></article>
        <article className={styles.kpi}><span>Kampagnen</span><strong>{totals.campaigns}</strong><small>Über alle Kunden</small></article>
        <article className={styles.kpi}><span>Aktive Kampagnen</span><strong>{totals.active}</strong><small>{totals.running} im aktuellen Laufzeitraum</small></article>
        <article className={styles.kpi}><span>Berechneter Werbeumsatz</span><strong>{money(totals.revenue)}</strong><small>Auslieferung und hinterlegten Fixpreisen</small></article>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHead}><div><h2>Kundenübersicht</h2><span>{rows.length} Kunden</span></div>
          <button className={styles.sort} onClick={() => setSort(value => value === "asc" ? "desc" : "asc")}>Alphabetisch {sort === "asc" ? "A–Z ↑" : "Z–A ↓"}</button>
        </div>
        {loadError && <p className={styles.error}>{loadError}</p>}
        {loading ? <p className={styles.empty}>Kunden werden geladen …</p> : sortedRows.length === 0 ? <p className={styles.empty}>Noch keine Kunden angelegt.</p> :
          <div className={styles.tableWrap}><table className={styles.table}>
            <thead><tr><th>Kunde</th><th>Kampagnen</th><th>Laufend</th><th>Aktiv</th><th className={styles.money}>Werbeumsatz</th></tr></thead>
            <tbody>{sortedRows.map(row => <tr key={row.id}>
              <td><strong>{row.name}</strong></td><td>{n(row.campaign_count)}</td><td>{n(row.running_campaign_count)}</td>
              <td><span className={n(row.active_campaign_count) > 0 ? styles.active : styles.inactive}>{n(row.active_campaign_count)}</span></td>
              <td className={styles.money}>{money(row.calculated_revenue)}</td>
            </tr>)}</tbody>
          </table></div>
        }
        <p className={styles.note}>Umsatz ist eine Berechnung: CPM-Kampagnen nach ausgelieferten Impressions, Fixpreis-Kampagnen nach hinterlegtem Fixpreis. Rechnungen und Zahlungseingänge werden nicht erfasst.</p>
      </section>

      {showCreate && <div className={styles.modalBackdrop} role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !saving) setShowCreate(false); }}>
        <form className={styles.modal} onSubmit={createCustomer}>
          <div className={styles.modalHead}><div><span className={styles.eyebrow}>KUNDENVERWALTUNG</span><h2>Neuen Kunden anlegen</h2></div><button type="button" className={styles.close} onClick={() => setShowCreate(false)} aria-label="Schließen">×</button></div>
          <label htmlFor="customer-name">Kundenname</label>
          <input id="customer-name" autoFocus value={name} onChange={event => setName(event.target.value)} placeholder="z. B. Gemeinde Kirchlengern" />
          {error && <p className={styles.error}>{error}</p>}
          <div className={styles.modalActions}><button type="button" className={styles.secondary} onClick={() => setShowCreate(false)} disabled={saving}>Abbrechen</button><button className={styles.primary} type="submit" disabled={saving}>{saving ? "Wird angelegt …" : "Kunde anlegen"}</button></div>
        </form>
      </div>}
    </main>
  );
}
