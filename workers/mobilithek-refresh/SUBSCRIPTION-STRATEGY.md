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

## DB OpenBoards als zentrale Echtzeitquelle

Die Deutsche Bahn stellt OpenBoards mit einem Free-Nutzungsplan von **10 Anfragen pro Sekunde** bereit. Die API liefert Abfahrten und Ankünfte für deutsche Eisenbahnstationen (schwere Schiene), inklusive Soll-/Prognosezeiten, Gleisen, Via-Halten, Ausfällen und Hinweisen. Die Endpunkte sind getrennte POST-Aufrufe für `/arrivals` und `/departures`.

Für Crossings ist das ein viel gezielterer Ansatz als das regelmäßige Herunterladen großer regionaler Mobilithek-SIRI-Feeds: Wir fragen nur die EVAs ab, die aus dem aktuellen Bedarf aktiver Bahnübergänge hervorgehen, bündeln mehrere EVAs pro Anfrage und aktualisieren die Beobachtungen bedarfsgesteuert.

### Bereits im Repository vorhanden

- `openBoardsClient.ts`: API-Client mit EVA-Batches, 20-Sekunden-Cache und In-Flight-Deduplizierung.
- `openBoardsNormalizer.ts`: Normalisierung von Abfahrts-/Ankunftszeilen und Via-EVAs.
- `openBoardsScheduler.ts`: Zusammenfassung aktiver EVA-Bedarfe in deduplizierte Jobs.
- `openBoardsQueueStore.ts`: persistente Queue, atomare Job-Claims, Backoff und ein globaler DB-basierter Request-Slot.
- `008_openboards_scheduler.sql`: Tabellen für Queue und globalen Scheduler-Zustand.

**Der entscheidende Punkt:** Diese Teile sind bislang nur ein Fundament. Der Queue-Store und der globale Limiter sind noch nicht in einen laufenden Refresh-Worker eingebunden; der OpenBoards-Client verwendet aktuell zusätzlich nur einen pro Runtime geltenden In-Memory-Limiter. Die API wird daher noch nicht produktiv zur Versorgung der Prognose genutzt.

### Zielarchitektur

1. Ein eigener OpenBoards-Refresh-Worker läuft unabhängig vom Mobilithek-Worker.
2. Er liest den aktuellen aktiven Bedarf aus Turso und ermittelt daraus die Beobachtungs-EVAs.
3. Gleiche EVAs werden über mehrere Bahnübergänge hinweg dedupliziert und in kleine EVA-Batches gebündelt.
4. Für jede Batch werden Ankunfts- und Abfahrtstafel als getrennte Jobs geplant.
5. Jeder echte Upstream-Aufruf reserviert zuerst atomar einen globalen Request-Slot in Turso. Damit gilt das Limit über mehrere Worker-Instanzen hinweg; wir zielen bewusst auf etwa 6–7 Requests/s statt die 10/s auszureizen.
6. Die Antworten werden normalisiert und als eigene OpenBoards-Beobachtungen gespeichert. Die bestehende Mobilithek-Tabelle und ihre Leser werden zunächst nicht umgedeutet.
7. Erst nach einem Shadow-Vergleich werden OpenBoards-Daten in die Prognose übernommen. Mobilithek bleibt bis zum Nachweis der Abdeckung als Fallback/Ergänzung verfügbar.

### Fachliche Grenzen

OpenBoards liefert nur Eisenbahnverkehre („schwere Schiene“), keine Busse, U-Bahnen oder Straßenbahnen. Außerdem ist eine Bahnhofstafel keine garantierte vollständige Zuglauf-API: Die Via-Halte sind wertvoller Laufwegkontext, aber nicht zwingend eine vollständige Streckenliste. Deshalb muss das Matching über konkrete EVA-Referenzen und die vorhandenen Strecken-/BÜ-Regeln erfolgen; ein bloßer Textvergleich der Bahnhofsnamen reicht nicht.

Für Kirchlengern und OWL wird OpenBoards zuerst als gezielte Referenzversorgung aufgebaut. Die übrigen Testbahnhöfe bleiben eigene Testfälle und werden nicht stillschweigend entfernt.

### Rollout-Schranken

- Erst separater Worker und eigene Beobachtungstabelle, kein Überschreiben von Mobilithek-Snapshots.
- Erst read-only/Shadow-Auswertung, keine Prognoseumschaltung.
- Keine automatische Reduktion von Mobilithek, bevor die OpenBoards-Abdeckung je aktivem BÜ nachgewiesen ist.
- Erst nach erfolgreichem Build, kontrollierten API-Proben und fachlichem Vergleich produktiv aktivieren.

## Implementierungsstand OpenBoards Shadow Worker (20.11.2026)

Der erste getrennte Worker liegt unter `workers/openboards-refresh/`.

Bereits umgesetzt:
- eigener Wrangler-Worker mit Cron-Ausführung einmal pro Minute;
- eigene Demand-Ermittlung aus aktiven Crossing-Zuordnungen;
- OWL-Kernstandorte mit Priorität 10 / Standardintervall 60 Sekunden;
- übrige aktive Test-/Explorationsstandorte mit Priorität 100 / Standardintervall 300 Sekunden;
- deduplizierte EVA-Batches, getrennt nach Prioritätsgruppe und Ankunft/Abfahrt;
- persistente Queue mit atomarem Claiming und Fehler-Backoff;
- accountweiter Turso-Request-Slot mit 150 ms Abstand (ca. 6,7 Requests/Sekunde);
- explizite Credential-Übergabe für Cloudflare Worker ohne Node-`process.env`;
- eigene Tabellen für OpenBoards-Beobachtungen und Refresh-Läufe (Migration 009);
- erfolgreiche Antworten ersetzen nur den jeweiligen EVA-/Richtungsbestand; Fehler lassen letzte erfolgreiche Beobachtungen unangetastet.

Wichtige Grenze:
- Der Worker schreibt ausschließlich nach `openboards_observations`, `openboards_refresh_jobs`,
  `openboards_scheduler_state` und `openboards_refresh_runs`.
- Er verändert weder `mobilithek_train_snapshot` noch die Forecast-Ausgabe.
- Es gibt noch keine OpenBoards-Prognoseintegration und keinen produktiven Quellenwechsel.
- Vor dem ersten Lauf müssen Migration 008 und 009 auf derselben Turso-Datenbank angewendet
  und die vier Secrets gesetzt sein. Deployment und Live-Test sind noch nicht erfolgt.

Setup und Betriebsdetails stehen in `workers/openboards-refresh/README.md`.
Zusätzlich ist der quellenneutrale Vertrag `TrainObservation` in
`packages/shared-types/src/index.ts` angelegt. Der DB-Client kann gespeicherte
OpenBoards-Beobachtungen lesen und über `toTrainObservation()` in diesen Vertrag
überführen. OpenBoards-Laufwege bleiben dabei ausdrücklich als `partial` oder
`unknown` markiert. Die bestehende Timetable-Prognose (Plan + Fchg, Laufwegprüfung,
konfigurierte Offsets und Zwei-Punkt-Interpolation) bleibt unverändert und ist
weiterhin die Referenz für den späteren Shadow-Vergleich.
