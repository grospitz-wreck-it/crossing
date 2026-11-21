const fs = require("node:fs");
const path = require("node:path");

const packageEntry = require.resolve("db-stations");
const packageDir = path.dirname(packageEntry);
const source = path.join(packageDir, "data.ndjson");
const targetDir = path.join(process.cwd(), "data");
const target = path.join(targetDir, "db-stations.ndjson");

if (!fs.existsSync(source)) {
  throw new Error(`db-stations catalogue missing from installed package: ${source}`);
}

fs.mkdirSync(targetDir, { recursive: true });
fs.copyFileSync(source, target);

const bytes = fs.statSync(target).size;
if (bytes < 100_000) {
  throw new Error(`DB station catalogue looks incomplete (${bytes} bytes)`);
}

console.log(`Prepared DB station catalogue (${bytes} bytes)`);
