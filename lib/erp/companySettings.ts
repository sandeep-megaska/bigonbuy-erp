import { supabase } from "../supabaseClient";

export type CompanySettings = {
  company_id: string;
  bigonbuy_logo_path?: string | null;
  megaska_logo_path?: string | null;
  setup_completed?: boolean | null;
  setup_completed_at?: string | null;
  updated_by?: string | null;
};

export type CompanyLogoKind = "bigonbuy" | "megaska";

async function getCurrentCompanyId() {
  const { data, error } = await supabase.rpc("erp_current_company_id");
  if (error) {
    throw new Error(error.message);
  }
  return data as string;
}

export async function getCompanySettings() {
  const { data, error } = await supabase
    .from("erp_company_settings")
    .select("company_id, bigonbuy_logo_path, megaska_logo_path, setup_completed, setup_completed_at")
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data as CompanySettings | null;
}

export async function updateCompanySettings(payload: Partial<CompanySettings>) {
  const companyId = await getCurrentCompanyId();
  const { data, error } = await supabase
    .from("erp_company_settings")
    .update(payload)
    .eq("company_id", companyId)
    .select("company_id, bigonbuy_logo_path, megaska_logo_path, setup_completed, setup_completed_at")
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data as CompanySettings | null;
}

export async function uploadCompanyLogo(kind: CompanyLogoKind, file: File) {
  const companyId = await getCurrentCompanyId();
  const extension = file.name.split(".").pop() || "png";
  const path = `company/${companyId}/logos/${kind}.${extension.toLowerCase()}`;

  const { error } = await supabase.storage
    .from("erp-assets")
    .upload(path, file, { upsert: true, contentType: file.type || "application/octet-stream" });

  if (error) {
    throw new Error(error.message);
  }

  return path;
}

export async function getCompanyLogosSignedUrlsIfNeeded() {
  const settings = await getCompanySettings();
  const storage = supabase.storage.from("erp-assets");

  async function resolveUrl(path?: string | null) {
    if (!path) return null;
    const { data: signed, error } = await storage.createSignedUrl(path, 3600);
    if (!error && signed?.signedUrl) {
      return signed.signedUrl;
    }
    const { data } = storage.getPublicUrl(path);
    return data?.publicUrl ?? null;
  }

  const [bigonbuyUrl, megaskaUrl] = await Promise.all([
    resolveUrl(settings?.bigonbuy_logo_path ?? null),
    resolveUrl(settings?.megaska_logo_path ?? null),
  ]);

  return {
    settings,
    bigonbuyUrl,
    megaskaUrl,
  };
}


