"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import styles from "./ContentPreferences.module.css";
import AppIcon, { type AppIconName } from "./AppIcon";

type FuelType = "e5" | "e10" | "diesel";
type ContentKind = "news" | "fuel" | "jokes";
type Preferences = {
  newsEnabled: boolean;
  fuelEnabled: boolean;
  fuelType: FuelType | null;
  jokesEnabled: boolean;
  contentOrder: ContentKind[];
};
const DEFAULT_CONTENT_ORDER: ContentKind[] = ["news", "fuel", "jokes"];
const initial: Preferences = {
  newsEnabled: false,
  fuelEnabled: false,
  fuelType: null,
  jokesEnabled: false,
  contentOrder: DEFAULT_CONTENT_ORDER,
};
const fuelLabels: Record<FuelType, string> = { e5: "Super E5", e10: "Super E10", diesel: "Diesel" };
const kindLabels: Record<ContentKind, string> = { news: "News", fuel: "Spritpreise", jokes: "Witze" };
const kindIcons: Record<ContentKind, AppIconName> = { news: "newspaper", fuel: "fuel", jokes: "laugh" };

function normalizeContentOrder(value: unknown): ContentKind[] {
  const allowed: ContentKind[] = ["news", "fuel", "jokes"];
  const requested = Array.isArray(value)
    ? value.filter((item): item is ContentKind => allowed.includes(item as ContentKind))
    : [];
  return [...new Set<ContentKind>([...requested, ...DEFAULT_CONTENT_ORDER])];
}

export default function ContentPreferences() {
  const [prefs, setPrefs] = useState<Preferences>(initial);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingFuel, setEditingFuel] = useState(false);
  const [draftFuel, setDraftFuel] = useState<FuelType>("e5");
  const [dragging, setDragging] = useState<ContentKind | null>(null);
  const [notice, setNotice] = useState("");
  const orderRef = useRef<ContentKind[]>([...DEFAULT_CONTENT_ORDER]);
  const dragRef = useRef<{ pointerId: number; kind: ContentKind; lastTarget: ContentKind } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/user/content-preferences", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Einstellungen konnten nicht geladen werden.");
        return response.json();
      })
      .then((data) => {
        if (!cancelled) {
          const contentOrder = normalizeContentOrder(data.contentOrder);
          orderRef.current = contentOrder;
          setPrefs({ ...initial, ...data, contentOrder });
          setDraftFuel(data.fuelType || "e5");
        }
      })
      .catch((error) => { if (!cancelled) setNotice(error.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  async function save(patch: Partial<Preferences>) {
    setSaving(true);
    setNotice("");
    try {
      const response = await fetch("/api/user/content-preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Einstellung konnte nicht gespeichert werden.");
      const contentOrder = normalizeContentOrder(data.contentOrder ?? orderRef.current);
      orderRef.current = contentOrder;
      setPrefs({ ...initial, ...data, contentOrder });
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Speichern fehlgeschlagen.");
      return false;
    } finally {
      setSaving(false);
    }
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

  function moveKind(from: ContentKind, to: ContentKind) {
    const order = [...orderRef.current];
    const fromIndex = order.indexOf(from);
    const toIndex = order.indexOf(to);
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;
    order.splice(fromIndex, 1);
    order.splice(toIndex, 0, from);
    orderRef.current = order;
    setPrefs((current) => ({ ...current, contentOrder: order }));
  }

  async function persistOrder() {
    await save({ contentOrder: orderRef.current });
  }

  function startDrag(kind: ContentKind, event: React.PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    event.preventDefault();
    dragRef.current = { pointerId: event.pointerId, kind, lastTarget: kind };
    setDragging(kind);
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* capture may be unavailable */ }
  }

  function moveDrag(event: React.PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const target = document.elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>("[data-content-order-item]")
      ?.dataset.contentOrderItem as ContentKind | undefined;
    if (target && ["news", "fuel", "jokes"].includes(target) && target !== drag.lastTarget) {
      moveKind(drag.kind, target);
      drag.lastTarget = target;
    }
  }

  async function endDrag(event: React.PointerEvent<HTMLButtonElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(null);
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* already released */ }
    await persistOrder();
  }

  function handleOrderKeyDown(kind: ContentKind, event: React.KeyboardEvent<HTMLButtonElement>) {
    const delta = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    if (!delta) return;
    event.preventDefault();
    const order = [...orderRef.current];
    const index = order.indexOf(kind);
    const targetIndex = index + delta;
    if (targetIndex < 0 || targetIndex >= order.length) return;
    const target = order[targetIndex];
    moveKind(kind, target);
    void persistOrder();
  }

  function renderRow(kind: ContentKind) {
    const enabled = kind === "news" ? prefs.newsEnabled : kind === "fuel" ? prefs.fuelEnabled : prefs.jokesEnabled;
    return (
      <Fragment key={kind}>
        <div
          className={dragging === kind ? `${styles.row} ${styles.rowDragging}` : styles.row}
          data-content-order-item={kind}
        >
          <button
            type="button"
            className={styles.dragHandle}
            aria-label={`Reihenfolge von ${kindLabels[kind]} ändern. Mit Pfeil hoch oder runter verschieben.`}
            title="Ziehen zum Sortieren"
            onPointerDown={(event) => startDrag(kind, event)}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onKeyDown={(event) => handleOrderKeyDown(kind, event)}
          >
            <svg viewBox="0 0 16 20" width="16" height="20" aria-hidden="true">
              <circle cx="4" cy="4" r="1.4" fill="currentColor" />
              <circle cx="12" cy="4" r="1.4" fill="currentColor" />
              <circle cx="4" cy="10" r="1.4" fill="currentColor" />
              <circle cx="12" cy="10" r="1.4" fill="currentColor" />
              <circle cx="4" cy="16" r="1.4" fill="currentColor" />
              <circle cx="12" cy="16" r="1.4" fill="currentColor" />
            </svg>
          </button>
          <span className={styles.icon}><AppIcon name={kindIcons[kind]} size={20} strokeWidth={1.8} /></span>
          <span className={styles.copy}>
            <strong>{kindLabels[kind]}</strong>
            {kind === "fuel" && prefs.fuelEnabled && prefs.fuelType && <small>{fuelLabels[prefs.fuelType]}</small>}
          </span>
          {kind === "fuel" && prefs.fuelEnabled && !editingFuel && (
            <button
              className={styles.edit}
              type="button"
              aria-label="Spritart ändern"
              title="Spritart ändern"
              onClick={() => { setDraftFuel(prefs.fuelType || "e5"); setEditingFuel(true); }}
            >
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m15 5 4 4M4 20l4.5-1 10.2-10.2a2.1 2.1 0 0 0-3-3L5.5 16 4 20Z"/>
              </svg>
            </button>
          )}
          {kind === "fuel" ? (
            <button
              type="button"
              role="switch"
              aria-checked={prefs.fuelEnabled}
              disabled={saving}
              className={prefs.fuelEnabled ? styles.switchOn : styles.switch}
              onClick={() => void toggleFuel(!prefs.fuelEnabled)}
            ><span /></button>
          ) : (
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              disabled={saving}
              className={enabled ? styles.switchOn : styles.switch}
              onClick={() => void toggle(kind === "news" ? "newsEnabled" : "jokesEnabled", !enabled)}
            ><span /></button>
          )}
        </div>
        {kind === "fuel" && editingFuel && (
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
      </Fragment>
    );
  }

  return (
    <section className={styles.panel}>
      <div className={styles.heading}>
        <span className={styles.eyebrow}>PERSONALISIEREN</span>
        <h2>Mein Content</h2>
        <p>Halte das Griffsymbol gedrückt und ziehe deine Inhalte in die gewünschte Reihenfolge.</p>
      </div>
      {loading ? <div className={styles.loading}>Einstellungen werden geladen …</div> : (
        <div className={styles.rows}>
          {prefs.contentOrder.map(renderRow)}
        </div>
      )}
      {notice && <p className={styles.notice} role="status">{notice}</p>}
    </section>
  );
}
