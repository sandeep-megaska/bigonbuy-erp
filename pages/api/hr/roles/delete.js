import { handleRoleDelete } from "../../../../lib/erp/hr/roleHandlers";

export default async function handler(req, res) {
  if (process.env.NODE_ENV === "development") {
    console.warn("Deprecated API /api/hr/roles/delete used. Use /api/erp/hr/roles/delete instead.");
  }

  return handleRoleDelete(req, res);
}
