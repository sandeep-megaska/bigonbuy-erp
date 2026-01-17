import { supabase } from "../supabaseClient";

const ERP_ASSETS_BUCKET = "erp-assets";

export function isExternalUrl(value: string) {
  return /^https?:\/\//i.test(value);
}

export async function resolveErpAssetUrl(path?: string | null) {
  if (!path) return null;
  if (isExternalUrl(path)) return path;

  const { data, error } = await supabase.storage.from(ERP_ASSETS_BUCKET).createSignedUrl(path, 3600);
  if (error) return null;
  return data?.signedUrl ?? null;
}

export async function uploadErpAsset(path: string, file: File) {
  return supabase.storage.from(ERP_ASSETS_BUCKET).upload(path, file, { upsert: true });
}
