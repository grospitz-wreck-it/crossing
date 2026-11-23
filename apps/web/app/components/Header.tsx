"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCrossings } from "../context/CrossingsContext";

export default function Header() {
  const { saved, activeId } = useCrossings();
  const pathname = usePathname();
  const inManager = pathname === "/app/meine-schranken";
  const activeCrossing = saved.find((c) => c.id === activeId) ?? saved[0];

  return (
    <header className="appHeader">
      <div className="appHeaderBrand">
        <span className="appHeaderEyebrow">MEINESCHRANKE</span>
        <div className="appHeaderTitle">
          {inManager ? "Mein Bereich" : activeCrossing?.name ?? "Bahnübergang"}
        </div>
      </div>
      <Link
        className="appHeaderMenuButton"
        href={inManager ? "/app" : "/app/meine-schranken"}
        aria-label={inManager ? "Zur BÜ-Übersicht" : "Schranken und Profil öffnen"}
        title={inManager ? "Zur BÜ-Übersicht" : "Schranken und Profil"}
      >
        {inManager ? (
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5m7 7-7-7 7-7" /></svg>
        ) : (
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
        )}
      </Link>
    </header>
  );
}
