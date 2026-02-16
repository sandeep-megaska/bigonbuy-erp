import { createCsvBlob, triggerDownload } from "../../../components/inventory/csvUtils";
import { supabase } from "../../supabaseClient";

export async function downloadCsvWithSession(url: string, filename: string) {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;

  if (sessionError) {
    throw new Error(sessionError.message || "Failed to read auth session.");
  }

  if (!token) {
    throw new Error("You must be signed in to export CSV.");
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const csv = await response.text();
  if (!response.ok) {
    throw new Error(csv || "Failed to export CSV.");
  }

  triggerDownload(filename, createCsvBlob(csv));
}
