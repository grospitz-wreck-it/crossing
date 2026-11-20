/**
 * Builds a conservative SQLite JSON1 prefilter for snapshot rows.
 *
 * The application still performs the authoritative EVA/name/route matching
 * after loading rows. This predicate only removes journeys whose calls cannot
 * possibly mention any configured observation station.
 */
export type SnapshotObservationStation = {
  eva?: string;
  station?: string;
};

export function buildSnapshotCallPrefilter(
  stations: SnapshotObservationStation[],
): { sql: string; args: string[] } {
  const refs = Array.from(new Set(
    stations.map((station) => String(station.eva || "").trim()).filter(Boolean),
  ));
  const nameTokens = Array.from(new Set(
    stations.flatMap((station) =>
      String(station.station || "")
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[\\u0300-\\u036f]/g, "")
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length >= 4),
    ),
  ));

  const predicates: string[] = [];
  const args: string[] = [];

  for (const eva of refs) {
    predicates.push(
      "(json_extract(call.value, '$.stopPointRef') LIKE ? OR " +
      "json_extract(call.value, '$.stopPlaceRef') LIKE ?)",
    );
    args.push(`%${eva}%`, `%${eva}%`);
  }

  for (const token of nameTokens) {
    predicates.push(
      "(lower(json_extract(call.value, '$.name')) LIKE ? OR " +
      "lower(json_extract(call.value, '$.stopPointName')) LIKE ? OR " +
      "lower(json_extract(call.value, '$.stopPlaceName')) LIKE ?)",
    );
    const pattern = `%${token}%`;
    args.push(pattern, pattern, pattern);
  }

  // With no station identifiers we must not narrow the result set.
  if (!predicates.length) return { sql: "", args: [] };

  return {
    sql: `AND EXISTS (
      SELECT 1
      FROM json_each(
        CASE
          WHEN json_valid(s.calls_json) THEN s.calls_json
          ELSE '[]'
        END
      ) AS call
      WHERE ${predicates.join(" OR ")}
    )`,
    args,
  };
}
