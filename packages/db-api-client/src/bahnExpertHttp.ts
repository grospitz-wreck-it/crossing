const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

export async function fetchBahnExpertJson(
  url: string,
  label: string
) {
  const res = await fetch(url, {
    cache: "no-store",
    headers: {
      accept: "application/json",
      "user-agent": BROWSER_USER_AGENT,
    },
  });

  const text = await res.text();

  if (!res.ok || !text) {
    throw new Error(
      `${label} ${res.status} ${res.statusText}`.trim()
    );
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(
      `${label} invalid JSON: ${String(error)}`
    );
  }
}
