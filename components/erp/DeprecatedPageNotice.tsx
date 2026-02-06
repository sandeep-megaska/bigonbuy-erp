import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import { supabase } from "../../lib/supabaseClient";

type DeprecatedPageNoticeProps = {
  title: string;
  newHref: string;
  message?: string;
  autoRedirectSeconds?: number | null;
};

export default function DeprecatedPageNotice({
  title,
  newHref,
  message,
  autoRedirectSeconds = 3,
}: DeprecatedPageNoticeProps) {
  const router = useRouter();
  const hasTrackedRef = useRef(false);

  useEffect(() => {
    if (!autoRedirectSeconds || autoRedirectSeconds <= 0) return;
    const timer = setTimeout(() => {
      router.replace(newHref);
    }, autoRedirectSeconds * 1000);
    return () => clearTimeout(timer);
  }, [autoRedirectSeconds, newHref, router]);

  useEffect(() => {
    if (!router.isReady || hasTrackedRef.current) return;
    hasTrackedRef.current = true;

    const trackDeprecatedHit = async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const accessToken = sessionData?.session?.access_token;
        if (!accessToken) return;
        const route = router.asPath.split("?")[0] || router.asPath;
        await fetch("/api/ops/ui/route-hit", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            route,
            kind: "deprecated",
            referrer: typeof document === "undefined" ? null : document.referrer || null,
            meta: {
              newHref,
              autoRedirectSeconds,
            },
          }),
        });
      } catch {
        // Fail silently for telemetry.
      }
    };

    void trackDeprecatedHit();
  }, [autoRedirectSeconds, newHref, router.asPath, router.isReady]);

  return (
    <section style={noticeStyle} aria-live="polite">
      <div style={badgeStyle}>Moved</div>
      <div style={contentStyle}>
        <div style={titleStyle}>{title}</div>
        <div style={messageStyle}>
          {message ?? "This page is deprecated. Use the button below to continue."}
        </div>
      </div>
      <Link href={newHref} style={buttonStyle}>
        Go to new page
      </Link>
    </section>
  );
}

const noticeStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 16,
  padding: "16px 20px",
  borderRadius: 12,
  border: "1px solid #e5e7eb",
  backgroundColor: "#f8fafc",
  color: "#0f172a",
  marginBottom: 20,
};

const badgeStyle: CSSProperties = {
  padding: "4px 10px",
  borderRadius: 999,
  backgroundColor: "#e0f2fe",
  color: "#0369a1",
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
};

const contentStyle: CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  gap: 4,
};

const titleStyle: CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
};

const messageStyle: CSSProperties = {
  fontSize: 13,
  color: "#475569",
};

const buttonStyle: CSSProperties = {
  padding: "8px 14px",
  borderRadius: 8,
  backgroundColor: "#111827",
  color: "#fff",
  textDecoration: "none",
  fontSize: 13,
  fontWeight: 600,
};
