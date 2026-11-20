# Mobilithek-Subscriptions: Profiling und Lebenszyklus

## Ziel

Crossings soll mit möglichst wenigen, aber fachlich ausreichenden Subscriptions zuverlässig skalieren. Entscheidend ist nicht die Zahl der Feed-Treffer allein, sondern die Abdeckung der tatsächlich benötigten Zugfahrten für aktive Bahnübergänge – bei vertretbarem Datenvolumen, Abrufaufwand und Ausfallrisiko.

Der künftige Produktivschwerpunkt ist **Kirchlengern und OWL**. Die aktuell verteilten Testbahnhöfe bleiben vorerst als getrennte Testfälle erhalten. Sie dürfen nicht automatisch aus der Konfiguration verschwinden, nur weil sie außerhalb des späteren Produktivgebiets liegen.

## Was der Profiler jetzt zusätzlich liefert

`npm run profile` im Worker erzeugt weiterhin eine lokale `subscription-profiles.json` und schreibt nichts nach Turso.

Neu im Report:

- `targetGroups.owlFocus`: erkannte Targets aus Kirchlengern/OWL.
- `targetGroups.exploratory`: alle übrigen Targets; das sind weiterhin gültige Testfälle.
- `journeyOverlap`: paarweiser Vergleich der Feeds anhand gehashter Zugfahrt-Fingerprints.
- `exactJourneyRef`: Vergleich mit Anbieter-Journey-Referenz plus Haltestellen- und Fahrplanstruktur.
- `structuralJourney`: Vergleich ohne Anbieter-Journey-Referenz. Das ist ein schwächeres Indiz, weil unterschiedliche Fahrten dieselbe Linie und ähnliche Haltezeiten haben können.

Für die Fingerprints werden mindestens zwei Haltestellenreferenzen und zwei geplante Zeiten verlangt. Damit werden schwache Datensätze – insbesondere GTFS-RT-Daten ohne geplante Zeiten – nicht fälschlich als Dubletten gewertet.

**Wichtig:** Eine hohe Überschneidung ist nur ein Prüfhinweis. Sie löst niemals automatisch das Entfernen einer Subscription aus. Die bisherige Stationsabdeckung im Profiler beruht außerdem auf normalisiertem Namensmatching und ist eine Inventur-Näherung, kein Beweis für produktive Event-Abdeckung.

## Zielbild: Subscription-Lifecycle

Subscriptions sollten künftig nicht mehr allein über nummerierte Environment-Variablen verwaltet werden. Stattdessen brauchen wir einen kleinen, nachvollziehbaren Bestand mit mindestens:

| Feld | Zweck |
|---|---|
| `subscription_id` | Mobilithek-ID |
| `label` | Lesbarer Feed-Name |
| `provider` / `feed_kind` | Quelle und Format |
| `status` | `candidate`, `observing`, `active`, `retiring`, `retired`, `error` |
| `scope` | `owl-core`, `exploratory-test`, später ggf. weitere Regionen |
| `added_at` / `retired_at` | Nachvollziehbarkeit |
| `reason` | Warum der Feed benötigt oder stillgelegt wird |
| `last_profiled_at` | Aktualität der Bewertung |

Die Datenbank soll der führende Bestand sein; Zugangsdaten bleiben in Secrets. Der Worker liest daraus nur die freigegebenen aktiven Subscriptions. Ein Rollout sollte zunächst einen Fallback auf die bisherige Env-Konfiguration behalten.

## Regeln zum Hinzufügen

1. Neue Subscription zunächst als `candidate` registrieren.
2. Mindestens mehrere vollständige Profil-Läufe durchführen (unterschiedliche Tageszeiten und Betriebstage).
3. Prüfen: liefert sie benötigte Zugfahrten für OWL/Kirchlengern, die aktive Feeds nicht liefern?
4. Zusätzliche Abdeckung gegen Mehrverbrauch abwägen: Bytes, Fetch-/Parse-Zeit, Fehlerquote und relevante zusätzliche Journeys.
5. Erst danach auf `active` setzen.

Ein Feed ist nicht allein deshalb nützlich, weil er viele Züge oder viele Stationsnamen enthält.

## Regeln zum Weglassen

1. Kandidat für `retiring` nur bei dauerhaft fehlender zusätzlicher Abdeckung oder belastbar nachgewiesener Redundanz.
2. Vorher mindestens mehrere Tage bzw. repräsentative Betriebstage vergleichen; Baustellen, Wochenenden und Fahrplanwechsel berücksichtigen.
3. Bei möglicher Redundanz die produktiven Event-Ergebnisse mit und ohne Feed im Shadow-Vergleich berechnen.
4. Prüfen, ob irgendein aktiver BÜ seine Primär- oder Sekundärbeobachtung verliert.
5. Erst nach Freigabe aus dem aktiven Abruf nehmen; alte Snapshot-Daten kontrolliert bereinigen und Rollback-Möglichkeit behalten.

Eine Subscription wird also nicht gelöscht, sondern zunächst deaktiviert und für eine definierte Beobachtungszeit als `retired` dokumentiert.

## OWL-Ausbau in Etappen

1. **Jetzt – Inventur:** Alle bestehenden Testbahnhöfe weiter messen; OWL im Report separat ausweisen.
2. **Danach – OWL-Referenzprofil:** Kirchlengern als Kernfall, ergänzt um die tatsächlich benötigten OWL-BÜs und deren EVA-/Routenanforderungen.
3. **Shadow-Auswertung:** Kandidaten-Subscriptions gegen die aktuelle aktive Versorgung vergleichen, ohne Produktionsdaten zu verändern.
4. **Konsolidierung:** Nur nachgewiesen notwendige Feeds aktiv halten.
5. **Skalierung:** Weitere Regionen als eigene Scopes hinzufügen, ohne die OWL-Konfiguration zu vermischen.

## Sicherheitsgrenzen

- Der Profiler ist read-only gegenüber Turso und Produktions-Snapshots.
- Er verändert keine Worker-Environment-Variablen und keine Mobilithek-Subscriptions im Portal.
- Es gibt keine automatische Aktivierung oder Deaktivierung.
- Keine Feed-Entscheidung allein anhand von Bytevolumen, Stationsnamen oder einem einzelnen Profil-Lauf.
- Vor einer produktiven Umstellung sind Tests und ein expliziter Rollback-Pfad erforderlich.
