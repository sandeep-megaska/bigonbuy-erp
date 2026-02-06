#!/usr/bin/env node

/**
 * Lightweight verifier for the ERP employee login linking flow.
 * - Confirms required environment variables are set.
 * - Prints manual QA steps and curl templates for the link API.
 */

const requiredEnv = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "ERP_REDIRECT_URL",
];

const missing = requiredEnv.filter((key) => !process.env[key]);

console.log("== ERP link employee login sanity check ==");
console.log("\nEnvironment variables:");
requiredEnv.forEach((key) => {
  const value = process.env[key];
  const status = value ? "present" : "MISSING";
  console.log(`- ${key}: ${status}${value ? "" : ""}`);
});

if (missing.length > 0) {
  console.log(
    `\n⚠️ Missing env vars: ${missing.join(
      ", ",
    )}. Set them before attempting the linking flow.`,
  );
  process.exitCode = 1;
}

const redirectTo = process.env.ERP_REDIRECT_URL || "<ERP_REDIRECT_URL>";
const apiUrl = "http://localhost:3000/api/hr/link-employee-user";

console.log("\nNext steps for manual QA when dev server is running:");
console.log("1) Start the Next.js dev server: npm run dev");
console.log(
  "2) Sign in via the UI as an owner/admin/hr user and capture the sb-access-token from the session.",
);
console.log(
  "3) Use the token in the Authorization header to call the link API. Example:",
);
console.log(`\n   curl -X POST ${apiUrl} \\`);
console.log("     -H \"Authorization: Bearer <ACCESS_TOKEN>\" \\");
console.log("     -H \"Content-Type: application/json\" \\");
console.log(
  "     -d '{\"company_id\":\"<COMPANY_UUID>\",\"employee_id\":\"<EMPLOYEE_UUID>\",\"employee_email\":\"user@example.com\"}'",
);
console.log("\nExpected responses:");
console.log("- Success: { ok: true, result: { employee_user_map_id, company_user_id } }");
console.log("- Warning: { ok: true, warning: \"Linked but failed to send reset email\", email_error, result }");
console.log("- Error:   { ok: false, error, details? }");

console.log("\nPassword reset link redirect target will use:");
console.log(`- redirectTo: ${redirectTo}`);

console.log(
  "\nSupabase service key should only be used for auth user lookup/creation. All mapping writes happen via the RPC using the end-user session.",
);

console.log("\nDone.");
