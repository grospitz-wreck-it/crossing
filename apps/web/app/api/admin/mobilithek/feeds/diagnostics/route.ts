import { NextResponse } from "next/server";
import { getMobilithekTrainDiagnostics } from "../../../../../../../../packages/db-api-client/src/mobilithekTimetable";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Admin-only, read-only feed diagnostics.
 * Fetches each configured Mobilithek subscription and reports its own
 * transport size, fetch/parse duration, feed type and parsed category counts.
 * It does not write snapshots or alter forecast/matching behavior.
 */
export async function GET() {
  try {
    const diagnostics = await getMobilithekTrainDiagnostics();
    return NextResponse.json(diagnostics, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
