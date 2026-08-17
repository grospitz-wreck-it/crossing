import Image from "next/image";
import Link from "next/link";
import styles from "./LandingPage.module.css";
import headerFix from "./LandingHeaderFix.module.css";
import hero from "./LandingHero.module.css";
import faq from "./FAQ.module.css";
import media from "./MediaPress.module.css";

const features = [
  { number: "01", icon: "↗", title: "Prognosen", text: "Erkenne frühzeitig, wann die Schranke voraussichtlich schließt und wieder öffnet." },
  { number: "02", icon: "◇", title: "Deine Schranke", text: "Speichere den Bahnübergang, der für deinen Alltag wirklich wichtig ist." },
  { number: "03", icon: "◌", title: "Live", text: "Aktuelle Informationen und Prognosen direkt auf deinem Smartphone." },
];

const faqs = [
  { question: "Ist meineschranke kostenlos?", answer: "Die erste Schranke soll kostenlos sein. Weitere Bahnübergänge können aber hinzugebucht werden, wenn das Angebot ausgebaut wird." },
  { question: "Wie genau sind die Angaben?", answer: "meineschranke berechnet die voraussichtlichen Schließzeiten aus Fahrplan- und verfügbaren Echtzeitdaten und berücksichtigt dabei den erwarteten Zuglauf. Die Angaben sind Prognosen und können sich durch Verspätungen, betriebliche Änderungen oder andere Einflüsse verändern. Die Deutsche Bahn stellt leider nicht alle verfügbaren Daten und APIs öffentlich zur Verfügung." },
  { question: "Werden alle Züge erkannt?", answer: "Derzeit kann meineschranke aus Gründen der Datensicherheit und der verfügbaren Daten nur auf Informationen des Personenverkehrs zugreifen. Güterzüge und andere Verkehre können deshalb aktuell nicht in jedem Fall erkannt oder zuverlässig in die Prognose einbezogen werden. Wir arbeiten daran, die Datengrundlage weiter auszubauen." },
  { question: "Kann ich mehrere Bahnübergänge speichern?", answer: "Ja. Du kannst den Bahnübergang speichern, der für deinen Alltag wichtig ist. Weitere Bahnübergänge können später als Zusatzangebot hinzukommen, wenn meineschranke ausgebaut wird." },
];

const mediaLinks = [
  { badge: "NW", source: "nw.de", title: "Schranken acht Stunden am Tag geschlossen – So soll die Bahnunterführung in Kirchlengern aussehen", href: "https://www.nw.de/lokal/kreis_herford/kirchlengern/23849848_Schranken-acht-Stunden-am-Tag-geschlossen-So-soll-die-Bahnunterfuehrung-in-Kirchlengern-aussehen.html" },
  { badge: "NW", source: "nw.de", title: "Ewiges Warten an Schranken: Wie steht es um eine Bahnunterführung in Kirchlengern?", href: "https://www.nw.de/lokal/kreis_herford/kirchlengern/23754793_Ewiges-Warten-an-Schranken-Wie-steht-es-um-eine-Bahnunterfuehrung-in-Kirchlengern.html" },
  { badge: "WDR", source: "WDR", title: "Bahnübergang Kirchlengern: Stillstand", href: "https://www1.wdr.de/mediathek/video/nrw-video/bahnuebergang-kirchlengern-stillstand-110.html", variant: "wdr" },
  { badge: "WB", source: "westfalen-blatt.de", title: "Bahnübergang Lübbecker Straße: Tunnel statt Schranken?", href: "https://www.westfalen-blatt.de/owl/kreis-herford/kirchlengern/bahnuebergang-luebbecker-strasse-tunnel-strassen-nrw-schranken-2894618", variant: "wb" },
];

export default function LandingPage() {
  return (
    <main className={styles.page}>
      <header className={`${styles.header} ${headerFix.header}`}>
        <Link href="/" className={`${styles.logoLink} ${headerFix.logoLink}`} aria-label="meineschranke Startseite"><Image src="/images/meineschranke_logo.webp" alt="meineschranke" width={236} height={64} priority className={`${styles.logo} ${headerFix.logo}`} /></Link>
        <nav className={`${styles.nav} ${headerFix.nav}`} aria-label="Hauptnavigation"><a href="#funktionen">Funktionen</a><a href="#so-funktionierts">So funktioniert&apos;s</a><a href="#medien">In den Medien</a><a href="#faq">FAQ</a></nav>
      </header>

      <section className={hero.heroWide}>
        <div className={hero.heroVisualWide} aria-hidden="true"><div className={hero.photoWide}><Image src="/images/barrier-open.webp" alt="" fill priority sizes="100vw" /></div></div>
        <div className={hero.heroCopyWide}><p className={`${styles.eyebrow} ${hero.eyebrowWide}`}>BAHNÜBERGÄNGE NEU GEDACHT</p><h1 className={hero.heroTitleWide}>Weniger warten.<br /><em>Mehr wissen.</em></h1><p className={hero.leadWide}>meineschranke zeigt dir, wann der Bahnübergang Kirchlengern voraussichtlich schließt und wann er wieder öffnet.</p><div className={hero.heroActionsWide}><Link href="/app" className={hero.heroPrimaryWide}>Web-App öffnen <span>→</span></Link><a href="/meineschranke.url" download="meineschranke.url" className={`${hero.desktopShortcutWide} ${hero.desktopOnlyWide}`}>↧ <span>Desktop-Verknüpfung herunterladen</span></a></div><div className={hero.trustWide}><span>✓ Kostenlos starten</span><span>✓ Persönliche Schranke</span><span>✓ Live-Prognosen</span></div></div>
      </section>

      <section id="funktionen" className={styles.featureStrip}>{features.map((feature) => <article key={feature.number}><div className={styles.featureIcon}>{feature.icon}</div><div><small>{feature.number}</small><h2>{feature.title}</h2><p>{feature.text}</p></div></article>)}</section>
      <section id="so-funktionierts" className={styles.section}><div className={styles.sectionIntro}><p className={styles.eyebrow}>SO FUNKTIONIERT&apos;S</p><h2>Du willst wissen,<br /><em>wann du weiterfahren kannst?</em></h2><p>meineschranke macht aus Fahrplan- und verfügbaren Echtzeitinformationen eine verständliche Prognose für den Bahnübergang Kirchlengern.</p></div><div className={styles.steps}><article><span>01</span><div className={styles.stepIcon}>⌖</div><h3>Schranke wählen</h3><p>Wähle den Bahnübergang Kirchlengern.</p></article><article><span>02</span><div className={styles.stepIcon}>◷</div><h3>Prognose ansehen</h3><p>Sieh auf einen Blick, wann die nächste Schließung erwartet wird.</p></article><article><span>03</span><div className={styles.stepIcon}>✓</div><h3>Weiterfahren</h3><p>Plane deine Fahrt besser und vermeide unnötige Wartezeit.</p></article></div></section>

      <section id="medien" className={media.mediaSection}><div className={media.mediaCopy}><p className={styles.eyebrow}>IN DEN MEDIEN</p><h2>Der Bahnübergang<br />Kirchlengern<br /><em>in den Medien.</em></h2><p>Lange Wartezeiten, unvorhersehbare Schließungen und Staus – ein Thema, das viele betrifft.</p><p>meineschranke entsteht aus einem ganz konkreten Problem vor Ort.</p></div><div className={media.videoCard}><div className={media.videoEmbed}><iframe src="https://www.youtube.com/embed/uK9DzOVJtIc?si=Oh7HJJFMDSR_WSlX" title="YouTube video player" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerPolicy="strict-origin-when-cross-origin" allowFullScreen /></div><div className={media.videoMeta}><strong>Wenn die Schranke zur Geduldsprobe wird</strong><small>Bericht von RTL West</small></div></div></section>
      <section className={media.mediaLinks} aria-label="Weitere Berichte über den Bahnübergang Kirchlengern">{mediaLinks.map((item) => <a key={item.href} href={item.href} target="_blank" rel="noreferrer" className={media.mediaLink}><b className={`${media.mediaBadge} ${item.variant ? media[item.variant] : ""}`}>{item.badge}</b><span className={media.mediaLinkText}><small>{item.source}</small>{item.title}</span><i className={media.mediaLinkArrow}>↗</i></a>)}</section>

      <section id="ios" className={styles.iosSection}><div><p className={styles.eyebrow}>FÜR UNTERWEGS</p><h2>meineschranke<br /><em>auf dem iPhone.</em></h2><p>Die iOS-App befindet sich im Aufbau. Bald verfügbar im App Store.</p><a href="#ios" className={styles.iosButton}> <span>Bald verfügbar im App Store</span></a></div><div className={styles.iosPhone}><div className={styles.iosPhoneInner}><Image src="/images/meineschranke_logo.webp" alt="" width={112} height={30} /><strong>02:41</strong><span>bis Schranke schließt</span><div>● SCHRANKE OFFEN</div></div></div><div className={styles.iosGlow} /></section>
      <section id="faq" className={faq.faqSection}><div className={faq.faqIntro}><p className={styles.eyebrow}>FAQ</p><h2>Die wichtigsten Fragen.<br /><em>Kurz beantwortet.</em></h2></div><div className={faq.faqList}>{faqs.map((item) => <details key={item.question} className={faq.faqItem}><summary className={faq.faqQuestion}>{item.question}</summary><div className={faq.faqAnswer}>{item.answer}</div></details>)}</div></section>
      <footer className={styles.footer}><div className={styles.footerBrand}><Image src="/images/meineschranke_logo.webp" alt="meineschranke" width={190} height={52} /><p>Prognosen für den Bahnübergang<br />Kirchlengern – einfach und verständlich.</p></div><div><b>NAVIGATION</b><a href="#funktionen">Funktionen</a><a href="#so-funktionierts">So funktioniert&apos;s</a><a href="#medien">In den Medien</a><a href="#faq">FAQ</a></div><div><b>RECHTLICHES</b><Link href="/privacy">Datenschutz</Link><Link href="/imprint">Impressum</Link></div><div><b>KONTAKT</b><a href="mailto:info@meineschranke.de">info@meineschranke.de</a><span className={styles.socials}>◎　✉</span></div><small className={styles.copyright}>© 2026 meineschranke. Ein Angebot der pxxl productions UG (haftungsbeschränkt).</small></footer>
    </main>
  );
}
