import { auth } from "../../../../auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Nicht angemeldet" }, { status: 401 });

  try {
    const url = new URL("https://v2.jokeapi.dev/joke/Any");
    url.searchParams.set("lang", "de");
    url.searchParams.set("blacklistFlags", "nsfw,racist,sexist,explicit");
    url.searchParams.set("safe-mode", "");
    const response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`JokeAPI HTTP ${response.status}`);
    const joke = await response.json();
    if (joke?.error) throw new Error(joke.message || "JokeAPI returned an error");
    if (joke.lang !== "de") throw new Error("JokeAPI lieferte keinen deutschen Witz.");
    return Response.json({
      id: joke.id,
      category: joke.category,
      type: joke.type,
      joke: joke.type === "single" ? joke.joke : null,
      setup: joke.type === "twopart" ? joke.setup : null,
      delivery: joke.type === "twopart" ? joke.delivery : null,
      source: "JokeAPI",
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("[JOKES] fetch failed:", error);
    return Response.json({ error: "Gerade ist kein Witz verfügbar. Versuch es bitte später erneut." }, { status: 502 });
  }
}
