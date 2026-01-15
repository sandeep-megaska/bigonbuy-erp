import { useEffect, useState } from "react";
import { getCompanyLogosSignedUrlsIfNeeded } from "./companySettings";

type BrandingState = {
  bigonbuyLogoUrl: string | null;
  megaskaLogoUrl: string | null;
  loaded: boolean;
};

export function useCompanyBranding() {
  const [branding, setBranding] = useState<BrandingState>({
    bigonbuyLogoUrl: null,
    megaskaLogoUrl: null,
    loaded: false,
  });

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const logos = await getCompanyLogosSignedUrlsIfNeeded();
        if (!active) return;

        setBranding({
          bigonbuyLogoUrl: logos.bigonbuyUrl ?? null,
          megaskaLogoUrl: logos.megaskaUrl ?? null,
          loaded: true,
        });
      } catch {
        if (!active) return;
        setBranding((prev) => ({ ...prev, loaded: true }));
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  return branding;
}
