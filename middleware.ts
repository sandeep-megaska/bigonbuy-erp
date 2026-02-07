import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const vendorSession = req.cookies.get("mfg_vendor_session")?.value;

  const isStatic = pathname.startsWith("/_next") || pathname.startsWith("/favicon") || pathname.startsWith("/public");
  const isMfg = pathname.startsWith("/mfg") || pathname.startsWith("/api/mfg");

  if (vendorSession && !isMfg && !isStatic) {
    const url = req.nextUrl.clone();
    url.pathname = "/mfg/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
