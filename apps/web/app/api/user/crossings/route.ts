import { randomUUID } from "crypto";
import { auth } from "../../../../auth";
import { authDb } from "../../../lib/auth-db";
import { sql } from "drizzle-orm";

type Crossing = {
  id: string;
  name: string;
};

export async function GET() {
  const session = await auth();

  if (!session?.user?.id) {
    return Response.json(
      { error: "Nicht angemeldet" },
      { status: 401 },
    );
  }

  const result = await authDb.all(sql`
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
      uc.updated_at
    FROM user_crossings uc
    INNER JOIN crossings c
      ON c.id = uc.crossing_id
    WHERE uc.user_id = ${session.user.id}
    ORDER BY uc.sort_order ASC, uc.created_at ASC
  `);

  return Response.json(result);
}

export async function POST(request: Request) {
  const session = await auth();

  if (!session?.user?.id) {
    return Response.json(
      { error: "Nicht angemeldet" },
      { status: 401 },
    );
  }

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

  const crossing = await authDb.get<Crossing>(sql`
    SELECT
      id,
      name
    FROM crossings
    WHERE id = ${crossingId}
    LIMIT 1
  `);

  if (!crossing) {
    return Response.json(
      { error: "Bahnübergang nicht gefunden" },
      { status: 404 },
    );
  }

  const id = randomUUID();

  await authDb.run(sql`
    INSERT OR IGNORE INTO user_crossings (
      id,
      user_id,
      crossing_id
    )
    VALUES (
      ${id},
      ${session.user.id},
      ${crossingId}
    )
  `);

  return Response.json({
    success: true,
    crossing: {
      id: crossing.id,
      name: crossing.name,
    },
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

  await authDb.run(sql`
    DELETE FROM user_crossings
    WHERE user_id = ${session.user.id}
      AND crossing_id = ${crossingId}
  `);

  return Response.json({
    success: true,
    crossingId,
  });
}