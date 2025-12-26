import Link from "next/link";

export default function Home() {
  return (
    <div style={{ padding: 40, fontFamily: "system-ui" }}>
      <h1>Bigonbuy Console</h1>
      <p>Select a module:</p>

      <ul style={{ lineHeight: 2 }}>
        <li>
          <Link href="/erp">📦 ERP Dashboard</Link>
        </li>
      </ul>

      <p style={{ marginTop: 24, opacity: 0.7 }}>
        (Internal use only)
      </p>
    </div>
  );
}
