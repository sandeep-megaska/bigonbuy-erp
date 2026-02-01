import { handleRoleList } from "../../../../lib/erp/hr/roleHandlers";

export default async function handler(req, res) {
  if (process.env.NODE_ENV !== "production") {
    console.warn("[DEPRECATED API] /api/hr/roles/list called; use /api/hr/roles/list");
  }

  return handleRoleList(req, res);
}
