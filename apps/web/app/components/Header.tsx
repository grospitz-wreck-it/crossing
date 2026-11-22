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
      <div className="appHeaderTitle">
        {inManager ? "Mein Bereich" : activeCrossing?.name ?? "Bahnübergang"}
      </div>
      <Link
        className="appHeaderMenuButton"
        href={inManager ? "/app" : "/app/meine-schranken"}
        aria-label={inManager ? "Zur BÜ-Übersicht" : "Schranken und Profil öffnen"}
        title={inManager ? "Zur BÜ-Übersicht" : "Schranken und Profil"}
      >
        {inManager ? "←" : "☰"}
      </Link>
    </header>
  );
}
