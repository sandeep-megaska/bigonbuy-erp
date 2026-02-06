import { handleRoleCreate } from "../../../../lib/erp/hr/roleHandlers";

export default async function handler(req, res) {
  return handleRoleCreate(req, res);
}
