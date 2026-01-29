import handleLinkEmployeeUser from "../../../lib/erp/hr/linkEmployeeUserHandler";

export default async function handler(req, res) {
  if (process.env.NODE_ENV !== "production") {
    console.warn(
      "[DEPRECATED API] /api/hr/link-employee-user called; use /api/erp/hr/link-employee-user"
    );
  }

  return handleLinkEmployeeUser(req, res);
}
