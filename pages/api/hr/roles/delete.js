import { handleRoleDelete } from "../../../../lib/erp/hr/roleHandlers";

export default async function handler(req, res) {
  return handleRoleDelete(req, res);
}
