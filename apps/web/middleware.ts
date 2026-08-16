import { NextRequest, NextResponse } from "next/server";

function unauthorized() {
  return new NextResponse("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Crossings Admin"',
      "Cache-Control": "no-store",
    },
  });
}

function isValidCredentials(request: NextRequest) {
  const authorization = request.headers.get("authorization");

  if (!authorization?.startsWith("Basic ")) {
    return false;
  }

  try {
    const encoded = authorization.slice(6);
    const decoded = atob(encoded);

    const separator = decoded.indexOf(":");

    if (separator === -1) {
      return false;
    }

    const username = decoded.slice(0, separator);
    const password = decoded.slice(separator + 1);

    return (
      username === process.env.ADMIN_BASIC_USER &&
      password === process.env.ADMIN_BASIC_PASSWORD
    );
  } catch {
    return false;
  }
}

export function middleware(request: NextRequest) {
  if (!isValidCredentials(request)) {
    return unauthorized();
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/admin/:path*",
    "/api/admin/:path*",
  ],
};
