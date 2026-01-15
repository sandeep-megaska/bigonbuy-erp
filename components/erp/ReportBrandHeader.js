import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { getCompanyLogosSignedUrlsIfNeeded } from "../../lib/erp/companySettings";

export default function ReportBrandHeader({ companyId }) {
  const [companyName, setCompanyName] = useState("");
  const [logos, setLogos] = useState({ bigonbuyUrl: null, megaskaUrl: null });

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const [{ data, error }, logoRes] = await Promise.all([
          supabase
            .from("erp_companies")
            .select("legal_name, brand_name, name")
            .eq("id", companyId)
            .maybeSingle(),
          getCompanyLogosSignedUrlsIfNeeded(),
        ]);

        if (!active) return;

        if (error) {
          throw new Error(error.message);
        }

        setCompanyName(data?.legal_name || data?.brand_name || data?.name || "");
        setLogos({
          bigonbuyUrl: logoRes.bigonbuyUrl,
          megaskaUrl: logoRes.megaskaUrl,
        });
      } catch (err) {
        console.error("Failed to load report branding", err);
      }
    })();

    return () => {
      active = false;
    };
  }, [companyId]);

  return (
    <div style={brandRowStyle}>
      <div style={brandLeftStyle}>
        {logos.bigonbuyUrl ? (
          <img src={logos.bigonbuyUrl} alt="Bigonbuy logo" style={bigonbuyLogoStyle} />
        ) : (
          <div style={logoFallbackStyle}>BIGONBUY</div>
        )}
        <div>
          <p style={companyNameStyle}>{companyName || "Company"}</p>
          <p style={companySubtitleStyle}>HR Reports</p>
        </div>
      </div>
      {logos.megaskaUrl ? (
        <img src={logos.megaskaUrl} alt="Megaska logo" style={megaskaLogoStyle} />
      ) : null}
    </div>
  );
}

const brandRowStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 16,
  flexWrap: "wrap",
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  padding: "16px 20px",
  marginBottom: 20,
  backgroundColor: "#f8fafc",
};

const brandLeftStyle = {
  display: "flex",
  alignItems: "center",
  gap: 16,
};

const bigonbuyLogoStyle = {
  height: 48,
  width: "auto",
  objectFit: "contain",
};

const megaskaLogoStyle = {
  height: 36,
  width: "auto",
  objectFit: "contain",
};

const logoFallbackStyle = {
  padding: "8px 12px",
  borderRadius: 999,
  backgroundColor: "#111827",
  color: "#fff",
  fontSize: 12,
  letterSpacing: "0.08em",
  fontWeight: 700,
};

const companyNameStyle = {
  margin: 0,
  fontSize: 16,
  fontWeight: 700,
  color: "#111827",
};

const companySubtitleStyle = {
  margin: "4px 0 0",
  fontSize: 12,
  color: "#6b7280",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
};
