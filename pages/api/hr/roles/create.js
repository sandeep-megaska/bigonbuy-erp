import { handleRoleCreate } from "../../../../lib/erp/hr/roleHandlers";

export default async function handler(req, res) {
  if (process.env.NODE_ENV !== "production") {
    console.warn("[DEPRECATED API] /api/hr/roles/create called; use /api/erp/hr/roles/create");
  }

  return handleRoleCreate(req, res);
}
