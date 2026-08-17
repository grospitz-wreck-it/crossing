import Link from "next/link";
import "../legal.css";

export const metadata = {
  title: "Datenschutz | meineschranke",
};

export default function PrivacyPage() {
  return (
    <main className="legalPage">
      <div className="legalPageInner">
        <Link href="/" className="legalBack">← Zurück zu meineschranke</Link>
        <p className="legalEyebrow">RECHTLICHES</p>
        <h1>Datenschutz</h1>
        <p className="legalLead">
          Informationen darüber, welche personenbezogenen Daten bei der Nutzung von
          meineschranke verarbeitet werden und welche Rechte du hast.
        </p>

        <section className="legalSection">
          <h2>1. Verantwortlicher</h2>
          <p>
            Verantwortlich für die Verarbeitung personenbezogener Daten im Zusammenhang
            mit meineschranke ist die pxxl productions UG (haftungsbeschränkt).
          </p>
          <p>
            Kontakt: <a href="mailto:info@meineschranke.de">info@meineschranke.de</a>
          </p>
          <p>
            Die vollständigen Unternehmensangaben findest du im
            <a href="https://www.pxxl.com/privacy" target="_blank" rel="noreferrer"> zentralen Datenschutzbereich von pxxl productions</a>.
          </p>
        </section>

        <section className="legalSection">
          <h2>2. Nutzung von meineschranke</h2>
          <p>
            meineschranke verarbeitet Daten, die erforderlich sind, um Bahnübergänge,
            Fahrplaninformationen und daraus berechnete Prognosen bereitzustellen.
            Für die Nutzung der öffentlichen Landingpage ist grundsätzlich keine
            Registrierung erforderlich.
          </p>
        </section>

        <section className="legalSection">
          <h2>3. Benutzerkonto und Anmeldung</h2>
          <p>
            Wenn du dich registrierst oder anmeldest, werden die für das Benutzerkonto
            erforderlichen Angaben verarbeitet. Dazu gehören insbesondere deine
            E-Mail-Adresse sowie die von deinem gewählten Login-Anbieter übermittelten
            Kontoinformationen.
          </p>
          <p>
            Die Anmeldung kann über Google erfolgen. Dabei gelten zusätzlich die
            Datenschutzbestimmungen des jeweiligen Anbieters.
          </p>
        </section>

        <section className="legalSection">
          <h2>4. Persönliche Schranken</h2>
          <p>
            Wenn du Bahnübergänge in deinem Benutzerkonto speicherst, verarbeiten wir
            diese Auswahl zusammen mit deiner Benutzerkonto-ID. Diese Daten werden
            benötigt, damit meineschranke deine persönlichen Bahnübergänge anzeigen
            und verwalten kann.
          </p>
        </section>

        <section className="legalSection">
          <h2>5. Technische Dienste</h2>
          <p>
            meineschranke nutzt technische Dienstleister für Hosting, Datenbankbetrieb
            und Authentifizierung. Dabei können personenbezogene Daten im Rahmen der
            technischen Bereitstellung verarbeitet werden.
          </p>
          <ul>
            <li>Vercel für Hosting und Bereitstellung der Webanwendung</li>
            <li>Turso/LibSQL für die Speicherung der Anwendungs- und Kontodaten</li>
            <li>Google für die optionale Anmeldung über ein Google-Konto</li>
          </ul>
        </section>

        <section className="legalSection">
          <h2>6. Bahn- und Fahrplandaten</h2>
          <p>
            Für die Prognosen verarbeitet meineschranke Fahrplan- und, soweit verfügbar,
            Echtzeitinformationen zum Schienenverkehr. Diese Daten werden genutzt, um
            voraussichtliche Schließ- und Öffnungszeiten von Bahnübergängen zu berechnen.
          </p>
        </section>

        <section className="legalSection">
          <h2>7. Server- und Sicherheitsprotokolle</h2>
          <p>
            Beim Aufruf der Website können technisch notwendige Informationen wie
            IP-Adresse, Zeitpunkt, angeforderte Ressource und technische Angaben zum
            verwendeten Browser verarbeitet werden. Dies dient dem sicheren und
            stabilen Betrieb der Anwendung sowie der Fehleranalyse.
          </p>
        </section>

        <section className="legalSection">
          <h2>8. Cookies und ähnliche Technologien</h2>
          <p>
            meineschranke verwendet technisch notwendige Cookies bzw. vergleichbare
            Speichermechanismen, soweit diese für Anmeldung, Sitzung und Betrieb der
            Webanwendung erforderlich sind. Nicht notwendige Tracking- oder
            Werbecookies werden auf dieser Landingpage nicht ohne die erforderliche
            Einwilligung eingesetzt.
          </p>
        </section>

        <section className="legalSection">
          <h2>9. Deine Rechte</h2>
          <p>
            Du hast nach Maßgabe der gesetzlichen Vorschriften insbesondere das Recht
            auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung,
            Datenübertragbarkeit und Widerspruch gegen bestimmte Verarbeitungen.
            Außerdem besteht ein Beschwerderecht bei einer Datenschutzaufsichtsbehörde.
          </p>
          <p>
            Für Datenschutzanfragen kannst du dich an
            <a href="mailto:info@meineschranke.de"> info@meineschranke.de</a> wenden.
          </p>
        </section>

        <section className="legalSection">
          <h2>10. Änderungen</h2>
          <p>
            Diese Datenschutzerklärung kann angepasst werden, wenn sich die technische
            Umsetzung, die eingesetzten Dienste oder rechtliche Anforderungen ändern.
            Die jeweils aktuelle Fassung wird auf dieser Seite veröffentlicht.
          </p>
        </section>

        <div className="legalNote">
          Diese Datenschutzerklärung ist auf die aktuelle meineschranke-Webanwendung
          zugeschnitten. Die vollständigen Unternehmensangaben und die zentrale
          Datenschutzerklärung von pxxl productions findest du ebenfalls auf der
          Website von pxxl productions.
        </div>
      </div>
    </main>
  );
}
