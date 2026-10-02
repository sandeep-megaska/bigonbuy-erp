import { supabase } from "../supabaseClient";

export const BRANDING_LOGO_BUCKET = "employee-documents";

export type CompanySettings = {
  company_id: string;
  bigonbuy_logo_path?: string | null;
  megaska_logo_path?: string | null;
  logo_url?: string | null;
  legal_name?: string | null;
  gstin?: string | null;
  address_text?: string | null;
  po_terms_text?: string | null;
  po_footer_address_text?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  website?: string | null;
  setup_completed?: boolean | null;
  setup_completed_at?: string | null;
  updated_by?: string | null;
};

export type CompanyLogoKind = "bigonbuy" | "megaska";

const ALLOWED_LOGO_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export function isAllowedCompanyLogoFile(file: File) {
  return ALLOWED_LOGO_MIME_TYPES.has(file.type);
}

function getLogoExtension(file: File) {
  if (file.type === "image/jpeg") return "jpg";
  if (file.type === "image/webp") return "webp";
  return "png";
}

async function getCurrentCompanyId() {
  const { data, error } = await supabase.rpc("erp_current_company_id");
  if (error) throw new Error(error.message);
  return data as string;
}

export async function getCompanySettings() {
  const { data, error } = await supabase
    .from("erp_company_settings")
    .select(
      "company_id, bigonbuy_logo_path, megaska_logo_path, legal_name, gstin, address_text, po_terms_text, po_footer_address_text, contact_email, contact_phone, website, setup_completed, setup_completed_at"
    )
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data as CompanySettings | null;
}

export async function updateCompanySettings(payload: Partial<CompanySettings>) {
  const { data, error } = await supabase.rpc("erp_company_settings_update", {
    p_payload: payload,
  });

  if (error) throw new Error(error.message);
  if (!data) return null;

  return getCompanySettings();
}

export async function uploadCompanyLogo(kind: CompanyLogoKind, file: File) {
  const companyId = await getCurrentCompanyId();
  if (!isAllowedCompanyLogoFile(file)) {
    throw new Error("Logo must be a PNG, JPEG, or WebP image.");
  }

  const extension = getLogoExtension(file);
  const path = `organizations/${companyId}/branding/logo-${Date.now()}.${extension}`;

  const { error } = await supabase.storage
    .from(BRANDING_LOGO_BUCKET)
    .upload(path, file, { upsert: false, contentType: file.type });

  if (error) throw new Error(error.message);
  return path;
}

export async function getCompanyLogosSignedUrlsIfNeeded() {
  const settings = await getCompanySettings();
  async function resolveUrl(path?: string | null) {
    if (!path) return null;

    const bucket = path.startsWith("organizations/") ? BRANDING_LOGO_BUCKET : "erp-assets";
    const storage = supabase.storage.from(bucket);

    // Prefer signed URL (private bucket safe)
    const { data: signed, error } = await storage.createSignedUrl(path, 3600);
    if (!error && signed?.signedUrl) return signed.signedUrl;

    // Fallback to public URL (in case bucket is public)
    const { data } = storage.getPublicUrl(path);
    return data?.publicUrl ?? null;
  }

  const [bigonbuyUrl, megaskaUrl] = await Promise.all([
    resolveUrl(settings?.bigonbuy_logo_path ?? null),
    resolveUrl(settings?.megaska_logo_path ?? null),
  ]);

  return { settings, bigonbuyUrl, megaskaUrl };
}
