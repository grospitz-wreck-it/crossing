import Link from "next/link";

export default function LandingPage() {
  return (
    <main className="landingPage">
      <section className="landingHero">
        <div className="landingContent">
          <div className="landingLogo">
            MeineSchranke
          </div>

          <div className="landingEyebrow">
            Bahnübergänge neu gedacht
          </div>

          <h1>
            Weniger warten.
            <br />
            <span>Mehr wissen.</span>
          </h1>

          <p className="landingLead">
            MeineSchranke zeigt dir, wann ein
            Bahnübergang voraussichtlich schließt
            und wann er wieder öffnet.
          </p>

          <div className="landingActions">
            <Link
              href="/app"
              className="landingPrimaryButton"
            >
              Web-App öffnen
            </Link>

            <a
              href="#ios"
              className="landingSecondaryButton"
            >
               iPhone App
            </a>
          </div>

          <div className="landingTrust">
            Kostenlos starten · persönliche
            Schranken · Live-Prognosen
          </div>
        </div>

        <div className="landingVisual">
          <div className="phoneMockup">
            <div className="phoneScreen">
              <div className="phoneHeader">
                MeineSchranke
              </div>

              <div className="phoneLocation">
                Kirchlengern
              </div>

              <div className="phoneStatus">
                <div className="phoneStatusDot" />

                <div>
                  <strong>
                    SCHRANKE OFFEN
                  </strong>

                  <span>
                    nächste Schließung
                  </span>
                </div>
              </div>

              <div className="phoneTimer">
                02:41
              </div>

              <div className="phoneCaption">
                bis Schranke schließt
              </div>

              <div className="phoneTrain">
                <span>🚆</span>
                <div>
                  <strong>
                    Nächster Zug
                  </strong>
                  <small>
                    voraussichtlich 14:32
                  </small>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="landingFeatures">
        <div>
          <span>01</span>
          <h2>Prognosen</h2>
          <p>
            Erkenne frühzeitig, wann die
            Schranke schließt.
          </p>
        </div>

        <div>
          <span>02</span>
          <h2>Deine Schranken</h2>
          <p>
            Speichere die Bahnübergänge,
            die für dich wichtig sind.
          </p>
        </div>

        <div>
          <span>03</span>
          <h2>Live</h2>
          <p>
            Aktuelle Informationen direkt
            auf deinem Smartphone.
          </p>
        </div>
      </section>

      <section
        id="ios"
        className="landingDownload"
      >
        <div>
          <div className="landingEyebrow">
            Für unterwegs
          </div>

          <h2>
            MeineSchranke
            <br />
            auf dem iPhone.
          </h2>

          <p>
            Die iOS-App befindet sich im
            Aufbau.
          </p>
        </div>

        <div className="appStorePlaceholder">
          
          <span>
            App Store
            <small>
              Bald verfügbar
            </small>
          </span>
        </div>
      </section>

      <footer className="landingFooter">
        <span>
          © MeineSchranke
        </span>

        <div>
          <a href="#">
            Datenschutz
          </a>

          <a href="#">
            Impressum
          </a>
        </div>
      </footer>
    </main>
  );
}