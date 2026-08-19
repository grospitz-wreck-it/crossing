import { NextResponse } from "next/server";
import { getMobilithekTrainDiagnostics } from "../../../lib/mobilithekTimetable";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json({ ok: true, ...(await getMobilithekTrainDiagnostics()) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}
