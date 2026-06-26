export async function GET() {
  return Response.json({
    state: "OPEN",
    nextCloseIn: 120,
    expectedClosedDuration: 60,
  });
}