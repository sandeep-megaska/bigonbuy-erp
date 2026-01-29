import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect } from "react";
import type { CSSProperties } from "react";

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
  autoRedirectSeconds = null,
}: DeprecatedPageNoticeProps) {
  const router = useRouter();

  useEffect(() => {
    if (!autoRedirectSeconds || autoRedirectSeconds <= 0) return;
    const timer = setTimeout(() => {
      router.replace(newHref);
    }, autoRedirectSeconds * 1000);
    return () => clearTimeout(timer);
  }, [autoRedirectSeconds, newHref, router]);

  return (
    <section style={noticeStyle} aria-live="polite">
      <div style={badgeStyle}>Moved</div>
      <div style={contentStyle}>
        <div style={titleStyle}>{title}</div>
        <div style={messageStyle}>
          {message ?? "This page has moved to a new location. Use the button below to continue."}
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
