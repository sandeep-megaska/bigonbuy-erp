import { createContext, useContext } from "react";

type MfgBranding = {
  vendor_logo_url: string | null;
  company_megaska_logo_url: string | null;
};

export type MfgContextValue = {
  vendorCode: string;
  vendorName: string;
  branding: MfgBranding;
  loading: boolean;
  error: string;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
};

export const MfgContext = createContext<MfgContextValue | null>(null);

export function useMfgContext() {
  const value = useContext(MfgContext);
  if (!value) {
    throw new Error("useMfgContext must be used inside MfgLayout");
  }
  return value;
}
