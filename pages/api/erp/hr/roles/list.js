import { handleRoleList } from "../../../../../lib/erp/hr/roleHandlers";

export default async function handler(req, res) {
  return handleRoleList(req, res);
}
