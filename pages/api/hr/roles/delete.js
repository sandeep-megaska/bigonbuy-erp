import { handleRoleDelete } from "../../../../lib/erp/hr/roleHandlers";

export default async function handler(req, res) {
  if (process.env.NODE_ENV !== "production") {
    console.warn("[DEPRECATED API] /api/hr/roles/delete called; use /api/hr/roles/delete");
  }

  return handleRoleDelete(req, res);
}
