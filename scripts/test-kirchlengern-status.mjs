const url = process.env.CROSSING_STATUS_URL || "https://www.meineschranke.com/api/crossings/kirchlengern-bahnhof-lubbecker-str-b8095d49/status";

const started = Date.now();
const response = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store" });
const elapsedMs = Date.now() - started;

console.log(`status=${response.status} elapsedMs=${elapsedMs}`);

const text = await response.text();
let payload;
try {
  payload = JSON.parse(text);
} catch {
  console.error(text.slice(0, 2000));
  process.exit(1);
}

if (!response.ok) {
  console.error(JSON.stringify(payload, null, 2));
  process.exit(1);
}

const trains = Array.isArray(payload.trains) ? payload.trains : [];
console.log(JSON.stringify({
  state: payload.state,
  trainCount: payload.trainCount,
  closureCount: payload.closureCount,
  trains: trains.map((train) => ({
    line: train.line,
    category: train.category,
    journeyNumber: train.journeyNumber,
    origin: train.origin,
    destination: train.destination,
    direction: train.direction,
    crossingTime: train.crossingTime,
    etaSeconds: train.etaSeconds,
  })),
}, null, 2));

if (elapsedMs > 15000) {
  console.error(`FAIL: crossing status took ${elapsedMs}ms (> 15000ms)`);
  process.exit(1);
}

if (payload.trainCount !== trains.length) {
  console.error("FAIL: trainCount does not match trains.length");
  process.exit(1);
}

console.log("PASS: Kirchlengern crossing status endpoint is reachable and internally consistent.");
