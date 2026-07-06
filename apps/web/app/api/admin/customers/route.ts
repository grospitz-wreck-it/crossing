import { db } from "@/app/lib/db";

function id() {
  return crypto.randomUUID();
}

export async function GET() {
  const result =
    await db.execute(`
      SELECT *
      FROM customers
      ORDER BY name
    `);

  return Response.json(
    result.rows
  );
}

export async function POST(
  request: Request
) {
  try {
    const body =
      await request.json();

    const customerId =
      id();

    await db.execute({
      sql: `
        INSERT INTO customers (
          id,
          name,
          active,
          created_at
        )
        VALUES (
          ?,
          ?,
          1,
          datetime('now')
        )
      `,
      args: [
        customerId,
        (body.name ?? "").trim(),
      ],
    });

    return Response.json({
      ok: true,
      id: customerId,
    });
  } catch (error) {
    console.error(
      "CUSTOMER ERROR",
      error
    );

    return Response.json(
      {
        error: String(error),
      },
      {
        status: 500,
      }
    );
  }
}