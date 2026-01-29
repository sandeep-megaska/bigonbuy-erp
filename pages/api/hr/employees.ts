import type { NextApiRequest, NextApiResponse } from "next";
import handleEmployees from "../../../lib/erp/hr/employeesHandler";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (process.env.NODE_ENV === "development") {
    console.warn("Deprecated API /api/hr/employees used. Use /api/erp/hr/employees instead.");
  }

  return handleEmployees(req, res);
}
