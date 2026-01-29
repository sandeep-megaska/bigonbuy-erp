import type { NextApiRequest, NextApiResponse } from "next";
import handleEmployees from "../../../lib/erp/hr/employeesHandler";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (process.env.NODE_ENV !== "production") {
    console.warn("[DEPRECATED API] /api/hr/employees called; use /api/erp/hr/employees");
  }

  return handleEmployees(req, res);
}
