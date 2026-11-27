import { randomUUID } from "crypto";
import { auth } from "../../../../auth";
import { authDb } from "../../../lib/auth-db";
import { sql } from "drizzle-orm";
import { FREE_CROSSING_LIMIT, PREMIUM_CROSSING_PACKAGE } from "../../../lib/subscription-config";

type Crossing = {
  id: string;
  name: string;
};

type SavedCrossing = {
  id: string;
  crossing_id: string;
  name: string;
  eva: string | null;
  lat: number | null;
  lon: number | null;
  label: string | null;
  sort_order: number;
  notifications_enabled: number;
  live_activity_enabled: number;
  created_at: string;
  updated_at: string;
  isFavorite: boolean;
};

async function getFavoriteId(userId: string): Promise<string | null> {
  const result = await authDb.all<{ default_crossing_id: string | null }>(
    sql`
      SELECT default_crossing_id
      FROM user_settings
      WHERE user_id = ${userId}
      LIMIT 1
    `,
  );

  return result[0]?.default_crossing_id ?? null;
}

async function setFavorite(
  userId: string,
  crossingId: string | null,
) {
  await authDb.run(sql`
    INSERT INTO user_settings (
      user_id,
      default_crossing_id
    )
    VALUES (
      ${userId},
      ${crossingId}
    )
    ON CONFLICT(user_id)
    DO UPDATE SET
      default_crossing_id = excluded.default_crossing_id,
      updated_at = datetime('now')
  `);
}

export async function GET() {
  const session = await auth();

  if (!session?.user?.id) {
    return Response.json(
      { error: "Nicht angemeldet" },
      { status: 401 },
    );
  }

  const userId = session.user.id;

  const [result, favoriteId] = await Promise.all([
    authDb.all<SavedCrossing>(sql`
      SELECT
        uc.id,
        uc.crossing_id AS crossing_id,
        c.name,
        c.eva,
        c.lat,
        c.lon,
        uc.label,
        uc.sort_order,
        uc.notifications_enabled,
        uc.live_activity_enabled,
        uc.created_at,
        uc.updated_at,
        CASE
          WHEN uc.crossing_id = (
            SELECT default_crossing_id
            FROM user_settings
            WHERE user_id = ${userId}
            LIMIT 1
          )
          THEN 1
          ELSE 0
        END AS isFavorite
      FROM user_crossings uc
      INNER JOIN crossings c
        ON c.id = uc.crossing_id
      WHERE uc.user_id = ${userId}
      ORDER BY
        isFavorite DESC,
        uc.sort_order ASC,
        uc.created_at ASC
    `),
    getFavoriteId(userId),
  ]);

  return Response.json({
    crossings: result,
    favoriteId,
    maxFreeCrossings: FREE_CROSSING_LIMIT,
    premiumPackage: PREMIUM_CROSSING_PACKAGE,
  });
}

export async function POST(request: Request) {
  const session = await auth();

  if (!session?.user?.id) {
    return Response.json(
      { error: "Nicht angemeldet" },
      { status: 401 },
    );
  }

  const userId = session.user.id;

  let body: { crossingId?: string };

  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "Ungültiger JSON-Body" },
      { status: 400 },
    );
  }

  const crossingId = body.crossingId?.trim();

  if (!crossingId) {
    return Response.json(
      { error: "crossingId fehlt" },
      { status: 400 },
    );
  }

  const crossingRows = await authDb.all<Crossing>(sql`
    SELECT
      id,
      name
    FROM crossings
    WHERE id = ${crossingId}
    LIMIT 1
  `);

  const crossing = crossingRows[0];

  if (!crossing) {
    return Response.json(
      { error: "Bahnübergang nicht gefunden" },
      { status: 404 },
    );
  }

  /*
   * Bestehende Zuordnung ist kein neuer BÜ.
   * Deshalb zuerst prüfen, ob der User diesen BÜ
   * bereits gespeichert hat.
   */
  const existingRows = await authDb.all<{ id: string }>(sql`
    SELECT id
    FROM user_crossings
    WHERE user_id = ${userId}
      AND crossing_id = ${crossingId}
    LIMIT 1
  `);

  if (existingRows.length > 0) {
    const favoriteId = await getFavoriteId(userId);

    return Response.json({
      success: true,
      alreadySaved: true,
      crossing: {
        id: crossing.id,
        name: crossing.name,
      },
      favoriteId,
      maxFreeCrossings: FREE_CROSSING_LIMIT,
    });
  }

  const countRows = await authDb.all<{ count: number }>(sql`
    SELECT COUNT(*) AS count
    FROM user_crossings
    WHERE user_id = ${userId}
  `);

  const count = Number(countRows[0]?.count ?? 0);

  if (count >= FREE_CROSSING_LIMIT) {
    return Response.json(
      {
        error: `Du kannst maximal ${FREE_CROSSING_LIMIT} Bahnübergänge kostenlos speichern.`,
        code: "MAX_FREE_CROSSINGS",
        maxFreeCrossings: FREE_CROSSING_LIMIT,
      },
      { status: 409 },
    );
  }

  const id = randomUUID();

  await authDb.run(sql`
    INSERT INTO user_crossings (
      id,
      user_id,
      crossing_id,
      sort_order
    )
    VALUES (
      ${id},
      ${userId},
      ${crossingId},
      ${count}
    )
  `);

  /*
   * Der erste gespeicherte BÜ wird automatisch Favorit.
   */
  let favoriteId = await getFavoriteId(userId);

  if (!favoriteId) {
    await setFavorite(userId, crossingId);
    favoriteId = crossingId;
  }

  return Response.json({
    success: true,
    crossing: {
      id: crossing.id,
      name: crossing.name,
    },
    favoriteId,
    maxFreeCrossings: FREE_CROSSING_LIMIT,
  });
}

export async function PATCH(request: Request) {
  const session = await auth();

  if (!session?.user?.id) {
    return Response.json(
      { error: "Nicht angemeldet" },
      { status: 401 },
    );
  }

  const userId = session.user.id;

  let body: {
    crossingId?: string;
    action?: string;
  };

  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "Ungültiger JSON-Body" },
      { status: 400 },
    );
  }

  const crossingId = body.crossingId?.trim();

  if (!crossingId) {
    return Response.json(
      { error: "crossingId fehlt" },
      { status: 400 },
    );
  }

  if (body.action !== "favorite") {
    return Response.json(
      { error: "Unbekannte Aktion" },
      { status: 400 },
    );
  }

  const savedRows = await authDb.all<{ id: string }>(sql`
    SELECT id
    FROM user_crossings
    WHERE user_id = ${userId}
      AND crossing_id = ${crossingId}
    LIMIT 1
  `);

  if (savedRows.length === 0) {
    return Response.json(
      { error: "Bahnübergang ist nicht gespeichert" },
      { status: 404 },
    );
  }

  await setFavorite(userId, crossingId);

  return Response.json({
    success: true,
    favoriteId: crossingId,
  });
}

export async function DELETE(request: Request) {
  const session = await auth();

  if (!session?.user?.id) {
    return Response.json(
      { error: "Nicht angemeldet" },
      { status: 401 },
    );
  }

  const userId = session.user.id;

  let body: { crossingId?: string };

  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "Ungültiger JSON-Body" },
      { status: 400 },
    );
  }

  const crossingId = body.crossingId?.trim();

  if (!crossingId) {
    return Response.json(
      { error: "crossingId fehlt" },
      { status: 400 },
    );
  }

  const favoriteId = await getFavoriteId(userId);

  await authDb.run(sql`
    DELETE FROM user_crossings
    WHERE user_id = ${userId}
      AND crossing_id = ${crossingId}
  `);

  /*
   * Wird der Favorit entfernt, wählen wir automatisch
   * den nächsten gespeicherten BÜ.
   */
  if (favoriteId === crossingId) {
    const replacementRows = await authDb.all<{ crossing_id: string }>(sql`
      SELECT crossing_id
      FROM user_crossings
      WHERE user_id = ${userId}
      ORDER BY sort_order ASC, created_at ASC
      LIMIT 1
    `);

    const replacement = replacementRows[0];
    await setFavorite(
      userId,
      replacement?.crossing_id ?? null,
    );

    return Response.json({
      success: true,
      crossingId,
      favoriteId: replacement?.crossing_id ?? null,
    });
  }

  return Response.json({
    success: true,
    crossingId,
    favoriteId,
  });
}
