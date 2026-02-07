import type { NextApiRequest, NextApiResponse } from "next";

/**
 * Return the LAST matching cookie value (important when duplicates exist with different Path).
 */
export function getCookieLast(req: NextApiRequest, name: string): string | null {
  const raw = req.headers.cookie || "";
  const parts = raw.split(";").map((p) => p.trim());
  let found: string | null = null;
  for (const p of parts) {
    if (p.startsWith(name + "=")) {
      found = decodeURIComponent(p.slice(name.length + 1));
    }
  }
  return found;
}

/**
 * Append a single Set-Cookie header safely (backward compatible name).
 */
export function setCookie(res: NextApiResponse, cookie: string) {
  const prev = res.getHeader("Set-Cookie");
  const prevArr = typeof prev === "string" ? [prev] : Array.isArray(prev) ? prev : [];
  res.setHeader("Set-Cookie", [...prevArr, cookie]);
}

/** Alias: some code may use appendSetCookie */
export const appendSetCookie = setCookie;

/**
 * Append multiple Set-Cookie values safely.
 */
export function setCookies(res: NextApiResponse, cookies: string[]) {
  const prev = res.getHeader("Set-Cookie");
  const prevArr = typeof prev === "string" ? [prev] : Array.isArray(prev) ? prev : [];
  res.setHeader("Set-Cookie", [...prevArr, ...cookies]);
}

/** Alias: some code may use appendSetCookies */
export const appendSetCookies = setCookies;

export function buildHttpOnlyCookie(opts: {
  name: string;
  value: string;
  path: string;
  maxAge: number;
  secure: boolean;
}) {
  return [
    `${opts.name}=${opts.value}`,
    `Path=${opts.path}`,
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${opts.maxAge}`,
    opts.secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

/**
 * Clears mfg_session cookie for BOTH current and legacy paths.
 * Use this in logout and anywhere you need to force-remove duplicates.
 */
export function clearMfgSessionCookies(res: NextApiResponse, secure: boolean) {
  setCookies(res, [
    buildHttpOnlyCookie({ name: "mfg_session", value: "", path: "/", maxAge: 0, secure }),
    buildHttpOnlyCookie({ name: "mfg_session", value: "", path: "/mfg", maxAge: 0, secure }),
  ]);
}
