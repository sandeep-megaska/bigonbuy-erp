import { handleRoleList } from "../../../../lib/erp/hr/roleHandlers";

export default async function handler(req, res) {
  if (process.env.NODE_ENV === "development") {
    console.warn("Deprecated API /api/hr/roles/list used. Use /api/erp/hr/roles/list instead.");
  }

  return handleRoleList(req, res);
}
