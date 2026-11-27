# meineschranke-fuel

Separater Cloudflare Worker für den zentralen Tankerkönig-Cache. Die bestehenden
Worker `meineschranke` (Mobilithek) und `meineschranke-openboards` bleiben
unverändert.

## Laufzeit

- Cron: alle 5 Minuten
- Pro Lauf maximal ein Tankerkönig-Request
- Zusätzlicher atomarer Turso-Lock: mindestens 60 Sekunden zwischen externen Requests
- `list.php`: Tankstellen je aktivem Pilot-Bahnübergang, Radius 5 km
- `prices.php`: Preisabfrage in Gruppen von maximal 10 Stations-IDs
- Preis-Refresh-Zielintervall: 20 Minuten je Station
- Fehler-Retry: nach 10 Minuten

## Secrets

Im Verzeichnis des Repository-Roots ausführen:

```bash
npx wrangler secret put TURSO_DATABASE_URL --config workers/fuel-refresh/wrangler.jsonc
npx wrangler secret put TURSO_AUTH_TOKEN --config workers/fuel-refresh/wrangler.jsonc
npx wrangler secret put TANKERKOENIG_API_KEY --config workers/fuel-refresh/wrangler.jsonc
npx wrangler secret put FUEL_REFRESH_RUN_TOKEN --config workers/fuel-refresh/wrangler.jsonc
```

Die drei Datenbank-/API-Secrets müssen dieselben Turso-Zugangsdaten bzw. den
Tankerkönig-Key verwenden, die für die Anwendung vorgesehen sind. Für
`FUEL_REFRESH_RUN_TOKEN` einen eigenen, zufälligen Wert verwenden.

## Deploy und Test

```bash
npx wrangler deploy --config workers/fuel-refresh/wrangler.jsonc
```

Healthcheck (read-only):

```bash
curl https://meineschranke-fuel.<account-subdomain>.workers.dev/health
```

Manueller Lauf (POST, benötigt den separaten Run-Token):

```bash
curl -X POST https://meineschranke-fuel.<account-subdomain>.workers.dev/run \
  -H "Authorization: Bearer $FUEL_REFRESH_RUN_TOKEN"
```

Der Cron läuft unabhängig davon. `/run` führt ebenfalls höchstens eine
fällige Aktualisierung aus und unterliegt demselben globalen API-Lock.
