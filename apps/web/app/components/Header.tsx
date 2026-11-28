"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import AppIcon from "./AppIcon";

export default function Header() {
  const pathname = usePathname();
  const inManager = pathname === "/app/meine-schranken";

  return (
    <header className="appHeader">
      <Link className="appHeaderLogoLink" href="/app" aria-label="Meine Schranke – Startseite">
        <img
          src="/images/meineschranke_logo_trans.webp"
          alt="Meine Schranke"
          className="appHeaderLogo"
        />
      </Link>
      <Link
        className="appHeaderMenuButton"
        href={inManager ? "/app" : "/app/meine-schranken"}
        aria-label={inManager ? "Zur BÜ-Übersicht" : "Schranken und Profil öffnen"}
        title={inManager ? "Zur BÜ-Übersicht" : "Schranken und Profil"}
      >
        {inManager ? <AppIcon name="arrow-left" size={21} /> : <AppIcon name="menu" size={21} />}
      </Link>
    </header>
  );
}
