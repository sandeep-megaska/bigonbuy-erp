import handleLinkEmployeeUser from "../../../lib/erp/hr/linkEmployeeUserHandler";

export default async function handler(req, res) {
  if (process.env.NODE_ENV === "development") {
    console.warn(
      "Deprecated API /api/hr/link-employee-user used. Use /api/erp/hr/link-employee-user instead."
    );
  }

  return handleLinkEmployeeUser(req, res);
}
