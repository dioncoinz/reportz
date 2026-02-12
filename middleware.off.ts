import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  const res = await updateSession(request);

  const pathname = request.nextUrl.pathname;

  const isAuthRoute = pathname.startsWith("/login");
  const isAppRoute = pathname.startsWith("/reports"); // expand later

  // If visiting app routes, require a session cookie (Supabase will enforce RLS anyway,
  // but this gives a friendly redirect)
  if (isAppRoute) {
    // quick check: presence of access token cookie
    const hasSbCookie = request.cookies
      .getAll()
      .some((c) => c.name.startsWith("sb-"));

    if (!hasSbCookie && !isAuthRoute) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      return NextResponse.redirect(url);
    }
  }

  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
