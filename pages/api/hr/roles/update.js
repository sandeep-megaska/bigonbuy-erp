import { handleRoleUpdate } from "../../../../lib/erp/hr/roleHandlers";

export default async function handler(req, res) {
  if (process.env.NODE_ENV !== "production") {
    console.warn("[DEPRECATED API] /api/hr/roles/update called; use /api/erp/hr/roles/update");
  }

  return handleRoleUpdate(req, res);
}
