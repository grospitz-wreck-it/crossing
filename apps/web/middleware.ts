import { NextRequest, NextResponse } from "next/server";

function unauthorized() {
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Crossings Admin"', "Cache-Control": "no-store" },
  });
}

function isValidCredentials(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Basic ")) return false;
  try {
    const decoded = atob(authorization.slice(6));
    const separator = decoded.indexOf(":");
    if (separator === -1) return false;
    return decoded.slice(0, separator) === process.env.ADMIN_BASIC_USER && decoded.slice(separator + 1) === process.env.ADMIN_BASIC_PASSWORD;
  } catch {
    return false;
  }
}

export function middleware(request: NextRequest) {
  if (!isValidCredentials(request)) return unauthorized();

  // POST must reach the canonical crossings route. It contains the complete
  // OSM -> station catalog -> prediction-rule derivation. The old /save
  // handler only persisted the form payload and referenced the obsolete
  // crossing_station_links schema.
  if (request.method === "DELETE" && request.nextUrl.pathname === "/api/admin/crossings") {
    const url = request.nextUrl.clone();
    url.pathname = "/api/admin/crossings/delete";
    return NextResponse.rewrite(url);
  }

  return NextResponse.next();
}

export const config = { matcher: ["/admin/:path*", "/api/admin/:path*"] };
