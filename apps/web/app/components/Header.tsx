"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCrossings } from "../context/CrossingsContext";
import AppIcon from "./AppIcon";

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
          {inManager ? "Mein Profil" : activeCrossing?.name ?? "Bahnübergang"}
        </div>
      </div>
      <Link
        className="appHeaderMenuButton"
        href={inManager ? "/app" : "/app/meine-schranken"}
        aria-label={inManager ? "Zur BÜ-Übersicht" : "Schranken und Profil öffnen"}
        title={inManager ? "Zur BÜ-Übersicht" : "Schranken und Profil"}
      >
        {inManager ? (
          <AppIcon name="arrow-left" size={21} />
        ) : (
          <AppIcon name="menu" size={21} />
        )}
      </Link>
    </header>
  );
}
