import Link from "next/link";

export const metadata = {
  title: "Impressum | MeineSchranke",
};

export default function ImprintPage() {
  return (
    <main className="legalPage">
      <div className="legalPageInner">
        <Link href="/" className="legalBack">← Zurück zu MeineSchranke</Link>
        <p className="legalEyebrow">RECHTLICHES</p>
        <h1>Impressum</h1>
        <p className="legalLead">Angaben gemäß den gesetzlichen Informationspflichten.</p>

        <section className="legalSection">
          <h2>Anbieter</h2>
          <p>
            pxxl productions UG (haftungsbeschränkt)<br />
            Deutschland
          </p>
        </section>

        <section className="legalSection">
          <h2>Vertreten durch</h2>
          <p>Geschäftsführung der pxxl productions UG (haftungsbeschränkt)</p>
        </section>

        <section className="legalSection">
          <h2>Kontakt</h2>
          <p>
            E-Mail: <a href="mailto:info@meineschranke.de">info@meineschranke.de</a>
          </p>
        </section>

        <section className="legalSection">
          <h2>Unternehmensangaben</h2>
          <p>
            Bitte entnehmen Sie die vollständigen Unternehmens- und Registerangaben
            dem zentralen Impressum der pxxl productions UG.
          </p>
          <p>
            <a href="https://www.pxxl.com/imprint" target="_blank" rel="noreferrer">
              Vollständiges Unternehmens-Impressum bei pxxl productions →
            </a>
          </p>
        </section>

        <section className="legalSection">
          <h2>Verantwortlichkeit für Inhalte</h2>
          <p>
            Die Inhalte von MeineSchranke werden mit größtmöglicher Sorgfalt erstellt.
            Für die Richtigkeit, Vollständigkeit und Aktualität können wir jedoch keine
            Gewähr übernehmen, soweit gesetzlich zulässig.
          </p>
        </section>

        <section className="legalSection">
          <h2>Haftung für Links</h2>
          <p>
            Diese Website kann Links zu externen Angeboten enthalten. Für deren Inhalte
            ist jeweils der Betreiber des verlinkten Angebots verantwortlich.
          </p>
        </section>

        <div className="legalNote">
          Diese Seite gehört zum Angebot der pxxl productions UG (haftungsbeschränkt).
          MeineSchranke ist ein Produkt dieser Gesellschaft.
        </div>
      </div>
    </main>
  );
}
