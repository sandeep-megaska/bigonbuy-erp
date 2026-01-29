import type { NextApiRequest, NextApiResponse } from "next";
import handleEmployees from "../../../../../lib/erp/hr/employeesHandler";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  return handleEmployees(req, res);
}
