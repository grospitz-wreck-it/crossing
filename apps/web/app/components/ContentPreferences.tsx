"use client";

import { useEffect, useState } from "react";
import styles from "./ContentPreferences.module.css";

type FuelType = "e5" | "e10" | "diesel";
type Preferences = { newsEnabled: boolean; fuelEnabled: boolean; fuelType: FuelType | null; jokesEnabled: boolean };
const initial: Preferences = { newsEnabled: false, fuelEnabled: false, fuelType: null, jokesEnabled: false };
const fuelLabels: Record<FuelType, string> = { e5: "Super E5", e10: "Super E10", diesel: "Diesel" };

export default function ContentPreferences() {
  const [prefs, setPrefs] = useState<Preferences>(initial);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingFuel, setEditingFuel] = useState(false);
  const [draftFuel, setDraftFuel] = useState<FuelType>("e5");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/user/content-preferences", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Einstellungen konnten nicht geladen werden.");
        return response.json();
      })
      .then((data) => { if (!cancelled) { setPrefs(data); setDraftFuel(data.fuelType || "e5"); } })
      .catch((error) => { if (!cancelled) setNotice(error.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  async function save(patch: Partial<Preferences>) {
    setSaving(true); setNotice("");
    try {
      const response = await fetch("/api/user/content-preferences", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Einstellung konnte nicht gespeichert werden.");
      setPrefs(data);
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Speichern fehlgeschlagen.");
      return false;
    } finally { setSaving(false); }
  }

  async function toggle(key: "newsEnabled" | "jokesEnabled", value: boolean) {
    await save({ [key]: value });
  }

  async function toggleFuel(value: boolean) {
    if (!value) {
      setEditingFuel(false);
      await save({ fuelEnabled: false, fuelType: null });
      return;
    }
    setDraftFuel(prefs.fuelType || "e5");
    setEditingFuel(true);
  }

  async function confirmFuel() {
    const ok = await save({ fuelEnabled: true, fuelType: draftFuel });
    if (ok) setEditingFuel(false);
  }

  return (
    <section className={styles.panel}>
      <div className={styles.heading}>
        <span className={styles.eyebrow}>PERSONALISIEREN</span>
        <h2>Dein Content</h2>
        <p>Wähle aus, welche zusätzlichen Inhalte in deiner Schranken-Übersicht erscheinen sollen.</p>
      </div>
      {loading ? <div className={styles.loading}>Einstellungen werden geladen …</div> : (
        <div className={styles.rows}>
          <div className={styles.row}>
            <span className={styles.icon}>📰</span>
            <span className={styles.copy}><strong>News</strong><small>Lokale Informationen und redaktionelle Inhalte</small></span>
            <button type="button" role="switch" aria-checked={prefs.newsEnabled} disabled={saving} className={prefs.newsEnabled ? styles.switchOn : styles.switch} onClick={() => void toggle("newsEnabled", !prefs.newsEnabled)}><span /></button>
          </div>
          <div className={styles.row}>
            <span className={styles.icon}>⛽</span>
            <span className={styles.copy}><strong>Spritpreise</strong><small>{prefs.fuelEnabled && prefs.fuelType ? fuelLabels[prefs.fuelType] : "Günstigster Preis in der Nähe deiner Schranke"}</small></span>
            {prefs.fuelEnabled && !editingFuel && <button className={styles.edit} type="button" aria-label="Spritart ändern" title="Spritart ändern" onClick={() => { setDraftFuel(prefs.fuelType || "e5"); setEditingFuel(true); }}><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 5 4 4M4 20l4.5-1 10.2-10.2a2.1 2.1 0 0 0-3-3L5.5 16 4 20Z"/></svg></button>}
            <button type="button" role="switch" aria-checked={prefs.fuelEnabled} disabled={saving} className={prefs.fuelEnabled ? styles.switchOn : styles.switch} onClick={() => void toggleFuel(!prefs.fuelEnabled)}><span /></button>
          </div>
          {editingFuel && (
            <div className={styles.fuelEditor}>
              <strong>Welche Spritsorte tankst du?</strong>
              <div className={styles.fuelOptions}>
                {(["e5", "e10", "diesel"] as FuelType[]).map((type) => (
                  <button key={type} type="button" className={draftFuel === type ? styles.fuelSelected : styles.fuelOption} onClick={() => setDraftFuel(type)} aria-pressed={draftFuel === type}>{fuelLabels[type]}</button>
                ))}
              </div>
              <div className={styles.editorActions}>
                <button type="button" onClick={() => setEditingFuel(false)} className={styles.cancel}>Abbrechen</button>
                <button type="button" onClick={() => void confirmFuel()} disabled={saving} className={styles.confirm}>{saving ? "Speichert …" : "Auswahl speichern"}</button>
              </div>
            </div>
          )}
          <div className={styles.row}>
            <span className={styles.icon}>😄</span>
            <span className={styles.copy}><strong>Witze</strong><small>Zufällige Gags direkt in deiner Übersicht</small></span>
            <button type="button" role="switch" aria-checked={prefs.jokesEnabled} disabled={saving} className={prefs.jokesEnabled ? styles.switchOn : styles.switch} onClick={() => void toggle("jokesEnabled", !prefs.jokesEnabled)}><span /></button>
          </div>
        </div>
      )}
      {notice && <p className={styles.notice} role="status">{notice}</p>}
      <p className={styles.footnote}>Du kannst alle Inhalte jederzeit wieder ausschalten. Deine Auswahl wird mit deinem Konto gespeichert.</p>
    </section>
  );
}
