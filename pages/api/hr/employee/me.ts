import type { NextApiRequest, NextApiResponse } from "next";
import { requireEmployeeSession } from "../../../../lib/erp/employeeAuth";

type MeResponse =
  | {
      ok: true;
      session: {
        employee_id: string;
        company_id: string;
        employee_code: string;
        display_name: string;
        must_reset_password: boolean;
        role_keys: string[];
      };
    }
  | { ok: false; error: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<MeResponse>) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const session = await requireEmployeeSession(req, res);
  if (!session) return;

  return res.status(200).json({
    ok: true,
    session: {
      employee_id: session.employee_id,
      company_id: session.company_id,
      employee_code: session.employee_code,
      display_name: session.display_name,
      must_reset_password: session.must_reset_password,
      role_keys: session.role_keys,
    },
  });
}
