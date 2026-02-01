import type { NextApiHandler, NextApiRequest, NextApiResponse } from "next";

type Handler = (req: NextApiRequest, res: NextApiResponse) => void | Promise<void>;

export const wrap = (handler: Handler): NextApiHandler =>
  async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected error";
      if (!res.headersSent) {
        res.status(500).json({ ok: false, error: message });
      }
    }
  };
