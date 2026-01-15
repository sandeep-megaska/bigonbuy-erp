import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { getCompanyLogosSignedUrlsIfNeeded } from "./companySettings";

export type CompanyBranding = {
  companyName: string;
  bigonbuyLogoUrl: string | null;
  megaskaLogoUrl: string | null;
};

let cachedBranding: CompanyBranding | null = null;
let brandingPromise: Promise<CompanyBranding> | null = null;

async function fetchBranding(): Promise<CompanyBranding> {
  const fallback: CompanyBranding = {
    companyName: "",
    bigonbuyLogoUrl: null,
    megaskaLogoUrl: null,
  };

  try {
    const logoRes = await getCompanyLogosSignedUrlsIfNeeded();
    const companyId = logoRes.settings?.company_id;
    if (!companyId) {
      return {
        companyName: "",
        bigonbuyLogoUrl: logoRes.bigonbuyUrl ?? null,
        megaskaLogoUrl: logoRes.megaskaUrl ?? null,
      };
    }

    const { data, error } = await supabase
      .from("erp_companies")
     .select("legal_name, brand_name")

      .eq("id", companyId)
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    return {
      companyName: data?.brand_name || data?.legal_name || "",

      bigonbuyLogoUrl: logoRes.bigonbuyUrl ?? null,
      megaskaLogoUrl: logoRes.megaskaUrl ?? null,
    };
  } catch (err) {
    console.error("Failed to load company branding", err);
    return fallback;
  }
}

export function useCompanyBranding() {
  const [branding, setBranding] = useState<CompanyBranding | null>(cachedBranding);

  useEffect(() => {
    let active = true;

    if (cachedBranding) {
      setBranding(cachedBranding);
      return;
    }

    if (!brandingPromise) {
      brandingPromise = fetchBranding().finally(() => {
        brandingPromise = null;
      });
    }

    brandingPromise
      ?.then((result) => {
        cachedBranding = result;
        if (active) {
          setBranding(result);
        }
      })
      .catch(() => {
        if (active) {
          setBranding(null);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  return branding;
}
