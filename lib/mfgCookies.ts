import type { NextApiRequest, NextApiResponse } from "next";

const MFG_SESSION_COOKIE = "mfg_session";

export function getCookieLast(req: NextApiRequest, name: string): string | null {
  const raw = req.headers.cookie || "";
  const parts = raw.split(";").map((part) => part.trim()).filter(Boolean);

  let cookieValue: string | null = null;
  for (const part of parts) {
    if (part.startsWith(`${name}=`)) {
      cookieValue = decodeURIComponent(part.slice(name.length + 1));
    }
  }

  return cookieValue;
}

export function setCookie(res: NextApiResponse, cookieString: string): void {
  const previous = res.getHeader("Set-Cookie");
  const next =
    typeof previous === "string"
      ? [previous, cookieString]
      : Array.isArray(previous)
        ? [...previous, cookieString]
        : [cookieString];

  res.setHeader("Set-Cookie", next);
}

export function clearMfgSessionCookies(res: NextApiResponse): void {
  const secure = process.env.NODE_ENV === "production";

  const rootCookie = [
    `${MFG_SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");

  const mfgCookie = [
    `${MFG_SESSION_COOKIE}=`,
    "Path=/mfg",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");

  setCookie(res, rootCookie);
  setCookie(res, mfgCookie);
}
