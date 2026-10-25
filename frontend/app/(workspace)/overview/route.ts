import { NextResponse, type NextRequest } from "next/server";

/**
 * Replaced by /home ("This week") in the new information architecture (5.3). A real HTTP redirect, so old links and
 * bookmarks work without JavaScript. 307 (temporary) while the renovation may still move routes.
 */
export function GET(request: NextRequest) {
  const url = new URL("/home", request.url);
  url.search = request.nextUrl.search;
  return NextResponse.redirect(url, 307);
}
