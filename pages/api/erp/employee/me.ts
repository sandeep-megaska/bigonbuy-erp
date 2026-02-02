import type { NextApiRequest, NextApiResponse } from "next";
import { requireEmployeeSession } from "../../../../lib/erp/employeeAuth";

type MeResponse =
  | { ok: true; session: unknown }
  | { ok: false; error: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<MeResponse>) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const session = await requireEmployeeSession(req, res);
  if (!session) return;

  return res.status(200).json({ ok: true, session });
}
