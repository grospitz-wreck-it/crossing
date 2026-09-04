const baseUrl = process.env.CROSSING_BASE_URL || "https://www.meineschranke.com";
const targets = ["Bünde", "Kaarst"];

const listResponse = await fetch(`${baseUrl}/api/crossings`, { headers: { accept: "application/json" }, cache: "no-store" });
if (!listResponse.ok) {
  console.error(`FAIL: crossing list returned HTTP ${listResponse.status}`);
  console.error((await listResponse.text()).slice(0, 2000));
  process.exit(1);
}

const crossings = await listResponse.json();
let failures = 0;

for (const target of targets) {
  const matches = crossings.filter((crossing) => String(crossing.name || "").toLowerCase().includes(target.toLowerCase()));
  console.log(`\n=== ${target}: ${matches.length} active crossing(s) ===`);

  if (!matches.length) {
    console.error(`FAIL: no active crossing matching ${target}`);
    failures++;
    continue;
  }

  for (const crossing of matches.slice(0, 5)) {
    const url = `${baseUrl}/api/crossings/${encodeURIComponent(crossing.id)}/status`;
    const started = Date.now();
    let response;
    let text;
    try {
      response = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store" });
      text = await response.text();
    } catch (error) {
      console.error(`${crossing.name} [${crossing.id}] ERROR: ${error}`);
      failures++;
      continue;
    }

    const elapsedMs = Date.now() - started;
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      console.error(`${crossing.name} [${crossing.id}] HTTP ${response.status} ${elapsedMs}ms: invalid JSON`);
      failures++;
      continue;
    }

    const trains = Array.isArray(payload.trains) ? payload.trains : [];
    console.log(`${crossing.name} [${crossing.id}] status=${response.status} elapsedMs=${elapsedMs} trains=${trains.length} closures=${payload.closureCount ?? "?"}`);

    if (!response.ok || payload.trainCount !== trains.length || elapsedMs > 15000) {
      console.error(JSON.stringify({ status: response.status, elapsedMs, trainCount: payload.trainCount, trains: trains.length, closureCount: payload.closureCount, error: payload.error }, null, 2));
      failures++;
    }
  }
}

if (failures) {
  console.error(`FAIL: ${failures} regional crossing status check(s) failed.`);
  process.exit(1);
}

console.log("PASS: Bünde and Kaarst crossing status endpoints are reachable and internally consistent.");
