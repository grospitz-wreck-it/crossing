import Link from "next/link";
import "../legal.css";

export const metadata = {
  title: "Impressum | meineschranke",
};

export default function ImprintPage() {
  return (
    <main className="legalPage">
      <div className="legalPageInner">
        <Link href="/" className="legalBack">← Zurück zu meineschranke</Link>
        <p className="legalEyebrow">RECHTLICHES</p>
        <h1>Impressum</h1>
        <p className="legalLead">Angaben zum Anbieter von meineschranke.</p>

        <section className="legalSection">
          <h2>Anbieter</h2>
          <p>pxxl productions UG (haftungsbeschränkt)</p>
          <p>meineschranke ist ein Produkt bzw. Angebot dieser Gesellschaft.</p>
        </section>

        <section className="legalSection">
          <h2>Kontakt</h2>
          <p>E-Mail: <a href="mailto:info@meineschranke.de">info@meineschranke.de</a></p>
        </section>

        <section className="legalSection">
          <h2>Vertretungsberechtigung und Registerangaben</h2>
          <p>
            Die vollständigen Angaben zu Geschäftsführung, Anschrift, Registergericht,
            Registernummer und gegebenenfalls Umsatzsteuer-Identifikationsnummer sind
            im zentralen Impressum der pxxl productions UG aufgeführt.
          </p>
          <p>
            <a href="https://www.pxxl.com/imprint" target="_blank" rel="noreferrer">
              Zum vollständigen Unternehmens-Impressum von pxxl productions →
            </a>
          </p>
        </section>

        <section className="legalSection">
          <h2>Verantwortlichkeit für Inhalte</h2>
          <p>
            Die Inhalte von meineschranke werden mit größtmöglicher Sorgfalt erstellt.
            Für die Richtigkeit, Vollständigkeit und Aktualität der bereitgestellten
            Informationen wird im Rahmen der gesetzlichen Vorschriften keine Gewähr übernommen.
          </p>
        </section>

        <section className="legalSection">
          <h2>Externe Links</h2>
          <p>
            Diese Website kann Links zu externen Angeboten enthalten. Auf deren Inhalte
            besteht kein Einfluss. Für die Inhalte der verlinkten Seiten ist jeweils der
            dortige Betreiber verantwortlich.
          </p>
        </section>

        <div className="legalNote">
          Die vollständigen Unternehmensangaben findest du im zentralen Impressum von
          pxxl productions. Dieses Impressum ist auf meineschranke als Produktangebot
          der pxxl productions UG zugeschnitten.
        </div>
      </div>
    </main>
  );
}
