import { handleRoleUpdate } from "../../../../lib/erp/hr/roleHandlers";

export default async function handler(req, res) {
  if (process.env.NODE_ENV === "development") {
    console.warn("Deprecated API /api/hr/roles/update used. Use /api/erp/hr/roles/update instead.");
  }

  return handleRoleUpdate(req, res);
}
