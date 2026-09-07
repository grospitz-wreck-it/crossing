import { spawn } from "node:child_process";

const SOUTH = 47.25;
const WEST = 5.85;
const NORTH = 55.10;
const EAST = 15.10;

// 1° x 1° Tiles.
// Kleine Überlappung verhindert Probleme an Tile-Grenzen.
const STEP = 1.0;
const OVERLAP = 0.03;

function runTile(bbox, index, total) {
  return new Promise((resolve) => {
    const [south, west, north, east] = bbox;

    console.log(
      `\n============================================================`
    );
    console.log(
      `[GERMANY OSM] Tile ${index}/${total}: ` +
      `${south.toFixed(2)},${west.toFixed(2)},` +
      `${north.toFixed(2)},${east.toFixed(2)}`
    );
    console.log(
      `============================================================`
    );

    const child = spawn(
      "node",
      [
        "scripts/osm/import-level-crossings.mjs",
        "--bbox",
        `${south},${west},${north},${east}`,
      ],
      {
        cwd: process.cwd(),
        stdio: "inherit",
        env: {
        ...process.env,
        TURSO_DATABASE_URL: process.env.TURSO_DATABASE_URL,
        TURSO_AUTH_TOKEN: process.env.TURSO_AUTH_TOKEN,
      },
      }
    );

    child.on("close", (code) => {
      if (code === 0) {
        console.log(
          `[GERMANY OSM] Tile ${index}/${total} erfolgreich`
        );
      } else {
        console.error(
          `[GERMANY OSM] Tile ${index}/${total} FEHLER (exit ${code})`
        );
      }

      resolve(code === 0);
    });

    child.on("error", (error) => {
      console.error(
        `[GERMANY OSM] Tile ${index}/${total} konnte nicht gestartet werden:`,
        error.message
      );

      resolve(false);
    });
  });
}

async function main() {
  const stateFile = ".osm-germany-import-state.json";

  let state = {
    nextTile: 0,
    successful: 0,
    failed: [],
  };

  try {
    const raw = await import("node:fs/promises");
    const content = await raw.readFile(stateFile, "utf8");
    state = JSON.parse(content);

    console.log(
      `[GERMANY OSM] Resume-State gefunden: ` +
      `weiter bei Tile ${(state.nextTile ?? 0) + 1}`
    );
  } catch {
    console.log("[GERMANY OSM] Kein Resume-State vorhanden – starte bei Tile 1");
  }

  const tiles = [];

  for (let south = SOUTH; south < NORTH; south += STEP) {
    for (let west = WEST; west < EAST; west += STEP) {
      const tileSouth = Math.max(SOUTH, south - OVERLAP);
      const tileWest = Math.max(WEST, west - OVERLAP);
      const tileNorth = Math.min(NORTH, south + STEP + OVERLAP);
      const tileEast = Math.min(EAST, west + STEP + OVERLAP);

      tiles.push([
        tileSouth,
        tileWest,
        tileNorth,
        tileEast,
      ]);
    }
  }

  const fs = await import("node:fs/promises");

  console.log(`\n[GERMANY OSM] ${tiles.length} Tiles`);
  console.log(
    `[GERMANY OSM] Deutschland: ` +
    `${SOUTH},${WEST} → ${NORTH},${EAST}`
  );

  const startIndex = Math.max(
    0,
    Math.min(Number(state.nextTile) || 0, tiles.length)
  );

  for (let i = startIndex; i < tiles.length; i++) {
    const ok = await runTile(
      tiles[i],
      i + 1,
      tiles.length
    );

    if (ok) {
      state.successful = Number(state.successful || 0) + 1;

      // Dieses Tile ist dauerhaft erledigt.
      state.nextTile = i + 1;

      // Fehlerliste bereinigen, falls das Tile später erfolgreich war.
      state.failed = Array.isArray(state.failed)
        ? state.failed.filter((n) => n !== i + 1)
        : [];

      await fs.writeFile(
        stateFile,
        JSON.stringify(state, null, 2)
      );
    } else {
      state.failed = Array.isArray(state.failed)
        ? state.failed
        : [];

      if (!state.failed.includes(i + 1)) {
        state.failed.push(i + 1);
      }

      // Wichtig:
      // Auch bei einem Fehler gehen wir weiter.
      // nextTile wird trotzdem auf das nächste Tile gesetzt.
      state.nextTile = i + 1;

      await fs.writeFile(
        stateFile,
        JSON.stringify(state, null, 2)
      );
    }
  }

  console.log("\n============================================================");
  console.log("[GERMANY OSM] IMPORT-DURCHLAUF ABGESCHLOSSEN");
  console.log("============================================================");
  console.log(`Erfolgreiche Tiles: ${state.successful}`);
  console.log(
    `Fehlgeschlagene Tiles: ${
      Array.isArray(state.failed) ? state.failed.length : 0
    }`
  );

  if (state.failed?.length) {
    console.log(
      `Fehlgeschlagene Tiles: ${state.failed.join(", ")}`
    );
    console.log(
      "\n⚠️ Diese Tiles können anschließend gezielt erneut importiert werden."
    );
  } else {
    console.log("\n✅ Alle Deutschland-Tiles erfolgreich.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
