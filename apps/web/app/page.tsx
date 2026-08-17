import Image from "next/image";
import Link from "next/link";
import styles from "./LandingPage.module.css";
import faq from "./FAQ.module.css";

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

export default function LandingPage() {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className={styles.logoLink} aria-label="meineschranke Startseite"><Image src="/images/meineschranke_logo.webp" alt="meineschranke" width={236} height={64} priority className={styles.logo} style={{ width: "clamp(215px, 19vw, 285px)" }} /></Link>
        <nav className={styles.nav} aria-label="Hauptnavigation"><a href="#funktionen">Funktionen</a><a href="#so-funktionierts">So funktioniert&apos;s</a><a href="#medien">In den Medien</a><a href="#faq">FAQ</a></nav>
        <div className={styles.headerActions}><a href="#ios" className={styles.appButton}> <span>iPhone App</span></a><Link href="/app" className={styles.primaryButton}>Web-App öffnen <span>→</span></Link></div>
      </header>

      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>BAHNÜBERGÄNGE NEU GEDACHT</p><h1>Weniger warten.<br /><em>Mehr wissen.</em></h1>
          <p className={styles.lead}>meineschranke zeigt dir, wann der Bahnübergang Kirchlengern voraussichtlich schließt und wann er wieder öffnet.</p>
          <div className={styles.heroActions}><Link href="/app" className={styles.primaryButton}>Web-App öffnen <span>→</span></Link><a href="#ios" className={styles.secondaryButton}> iPhone App</a></div>
          <div className={styles.trustRow}><span>✓ Kostenlos starten</span><span>✓ Persönliche Schranke</span><span>✓ Live-Prognosen</span></div>
        </div>
        <div className={styles.heroVisual} aria-label="meineschranke App Vorschau">
          <div className={styles.photo}><Image src="/images/barrier-open.webp" alt="Bahnübergang Kirchlengern" fill priority sizes="(max-width: 900px) 100vw, 58vw" /></div>
          <div className={styles.phone}><div className={styles.dynamicIsland} /><div className={styles.phoneScreen}>
            <div className={styles.phoneTop}><Image src="/images/meineschranke_logo.webp" alt="" width={116} height={31} /><span>♧</span></div><div className={styles.location}>Kirchlengern</div><div className={styles.statusPill}><i /> SCHRANKE OFFEN</div><div className={styles.timer}>02:41</div><div className={styles.timerLabel}>bis Schranke schließt</div>
            <div className={styles.miniStats}><span><b>23:11</b><small>Schließzeit</small></span><span><b>23:13</b><small>frei</small></span><span><b>2m</b><small>Dauer</small></span></div>
            <div className={styles.trainCard}><p>NÄCHSTER ZUG</p><strong>RB71 <small>+4</small></strong><span>Brake (b Bielefeld) → Rahden</span><b>Verspätung ca. 4 Minuten</b><div className={styles.timeline}><i /><i /><i /></div><div className={styles.times}><span>23:11</span><span>23:13</span><span>23:13</span></div></div>
            <div className={styles.phoneNav}><span>⌂<small>Übersicht</small></span><span>♧<small>Züge</small></span><span className={styles.navActive}>↗</span><span>▥<small>Statistiken</small></span><span>⚙<small>Einstellungen</small></span></div>
          </div></div>
        </div>
      </section>

      <section id="funktionen" className={styles.featureStrip}>{features.map((feature) => <article key={feature.number}><div className={styles.featureIcon}>{feature.icon}</div><div><small>{feature.number}</small><h2>{feature.title}</h2><p>{feature.text}</p></div></article>)}</section>
      <section id="so-funktionierts" className={styles.section}><div className={styles.sectionIntro}><p className={styles.eyebrow}>SO FUNKTIONIERT&apos;S</p><h2>Du willst wissen,<br /><em>wann du weiterfahren kannst?</em></h2><p>meineschranke macht aus Fahrplan- und verfügbaren Echtzeitinformationen eine verständliche Prognose für den Bahnübergang Kirchlengern.</p></div><div className={styles.steps}><article><span>01</span><div className={styles.stepIcon}>⌖</div><h3>Schranke wählen</h3><p>Wähle den Bahnübergang Kirchlengern.</p></article><article><span>02</span><div className={styles.stepIcon}>◷</div><h3>Prognose ansehen</h3><p>Sieh auf einen Blick, wann die nächste Schließung erwartet wird.</p></article><article><span>03</span><div className={styles.stepIcon}>✓</div><h3>Weiterfahren</h3><p>Plane deine Fahrt besser und vermeide unnötige Wartezeit.</p></article></div></section>
      <section id="medien" className={styles.mediaSection}><div className={styles.mediaCopy}><p className={styles.eyebrow}>IN DEN MEDIEN</p><h2>Der Bahnübergang<br />Kirchlengern<br /><em>in den Medien.</em></h2><p>Lange Wartezeiten, unvorhersehbare Schließungen und Staus – ein Thema, das viele betrifft.</p><p>meineschranke entsteht aus einem ganz konkreten Problem vor Ort.</p></div><div className={styles.videoCard}><div className={styles.videoImage}><Image src="/images/barrier-closed.webp" alt="Bahnübergang Kirchlengern" fill sizes="(max-width: 900px) 100vw, 60vw" /><div className={styles.play}>▶</div><span>NW</span></div><div className={styles.videoMeta}><strong>Wenn die Schranke zur Geduldsprobe wird</strong><small>Bericht der Neuen Westfälischen</small></div></div></section>
      <section className={styles.pressGrid}><a href="#medien"><b>NW</b><span><small>nw.de</small>Wenn die Schranke zur Geduldsprobe wird</span><i>↗</i></a><a href="#medien"><b className={styles.green}>WB</b><span><small>westfalen-blatt.de</small>Bahnübergang Kirchlengern: Wie lange müssen Anwohner noch warten?</span><i>↗</i></a><a href="#medien"><b className={styles.paper}>▤</b><span><small>Weitere Berichte</small>Artikel und Hintergründe</span><i>↗</i></a></section>
      <section id="ios" className={styles.iosSection}><div><p className={styles.eyebrow}>FÜR UNTERWEGS</p><h2>meineschranke<br /><em>auf dem iPhone.</em></h2><p>Die iOS-App befindet sich im Aufbau. Bald verfügbar im App Store.</p><a href="#ios" className={styles.iosButton}> <span>Bald verfügbar im App Store</span></a></div><div className={styles.iosPhone}><div className={styles.iosPhoneInner}><Image src="/images/meineschranke_logo.webp" alt="" width={112} height={30} /><strong>02:41</strong><span>bis Schranke schließt</span><div>● SCHRANKE OFFEN</div></div></div><div className={styles.iosGlow} /></section>
      <section id="faq" className={faq.faqSection}><div className={faq.faqIntro}><p className={styles.eyebrow}>FAQ</p><h2>Die wichtigsten Fragen.<br /><em>Kurz beantwortet.</em></h2></div><div className={faq.faqList}>{faqs.map((item) => <details key={item.question} className={faq.faqItem}><summary className={faq.faqQuestion}>{item.question}</summary><div className={faq.faqAnswer}>{item.answer}</div></details>)}</div></section>
      <footer className={styles.footer}><div className={styles.footerBrand}><Image src="/images/meineschranke_logo.webp" alt="meineschranke" width={190} height={52} /><p>Prognosen für den Bahnübergang<br />Kirchlengern – einfach und verständlich.</p></div><div><b>NAVIGATION</b><a href="#funktionen">Funktionen</a><a href="#so-funktionierts">So funktioniert&apos;s</a><a href="#medien">In den Medien</a><a href="#faq">FAQ</a></div><div><b>RECHTLICHES</b><Link href="/privacy">Datenschutz</Link><Link href="/imprint">Impressum</Link></div><div><b>KONTAKT</b><a href="mailto:info@meineschranke.de">info@meineschranke.de</a><span className={styles.socials}>◎　✉</span></div><small className={styles.copyright}>© 2026 meineschranke. Ein Angebot der pxxl productions UG (haftungsbeschränkt).</small></footer>
    </main>
  );
}
