import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { getCompanyLogosSignedUrlsIfNeeded } from "./companySettings";

export type CompanyBranding = {
  companyName: string;
  legalName: string;
  gstin: string;
  addressText: string;
  poTermsText: string;
  currencyCode: string;
  bigonbuyLogoUrl: string | null;
  megaskaLogoUrl: string | null;
  poFooterAddressText: string;
  footerText: string;
  contactEmail: string;
  contactPhone: string;
  website: string;
  loaded: boolean;
};

let cachedBranding: CompanyBranding | null = null;
let brandingPromise: Promise<CompanyBranding> | null = null;

async function fetchBranding(): Promise<CompanyBranding> {
  const fallback: CompanyBranding = {
    companyName: "",
    legalName: "",
    gstin: "",
    addressText: "",
    poTermsText: "",
    currencyCode: "INR",
    bigonbuyLogoUrl: null,
    megaskaLogoUrl: null,
    poFooterAddressText: "",
    footerText: "",
    contactEmail: "",
    contactPhone: "",
    website: "",
    loaded: true,
  };

  try {
    const logoRes = await getCompanyLogosSignedUrlsIfNeeded();

    const companyId = logoRes.settings?.company_id || null;

    let companyName = "";
    let legalName = "";
    let currencyCode = "INR";
    if (companyId) {
      const { data, error } = await supabase
        .from("erp_companies")
        .select("legal_name, brand_name, currency_code")
        .eq("id", companyId)
        .maybeSingle();

      if (error) throw new Error(error.message);

      companyName = data?.brand_name || data?.legal_name || "";
      legalName = data?.legal_name || "";
      currencyCode = data?.currency_code || currencyCode;
    }

    return {
      companyName,
      legalName: logoRes.settings?.legal_name || legalName,
      gstin: logoRes.settings?.gstin ?? "",
      addressText: logoRes.settings?.address_text ?? "",
      poTermsText: logoRes.settings?.po_terms_text ?? "",
      currencyCode,
      bigonbuyLogoUrl: logoRes.bigonbuyUrl ?? null,
      megaskaLogoUrl: logoRes.megaskaUrl ?? null,
      poFooterAddressText: logoRes.settings?.po_footer_address_text ?? "",
      footerText: "",
      contactEmail: logoRes.settings?.contact_email ?? "",
      contactPhone: logoRes.settings?.contact_phone ?? "",
      website: logoRes.settings?.website ?? "",
      loaded: true,
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
      return () => {
        active = false;
      };
    }

    if (!brandingPromise) {
      brandingPromise = fetchBranding().finally(() => {
        brandingPromise = null;
      });
    }

    brandingPromise
      ?.then((result) => {
        cachedBranding = result;
        if (active) setBranding(result);
      })
      .catch(() => {
        if (active) setBranding(null);
      });

    return () => {
      active = false;
    };
  }, []);

  return branding;
}
