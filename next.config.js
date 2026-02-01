/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return {
      fallback: [
        { source: "/api/company-users/:path*", destination: "/api/erp/company-users/:path*" },
        { source: "/api/dev/:path*", destination: "/api/erp/dev/:path*" },
        { source: "/api/employees/:path*", destination: "/api/erp/employees/:path*" },
        { source: "/api/finance/:path*", destination: "/api/erp/finance/:path*" },
        { source: "/api/hr/:path*", destination: "/api/erp/hr/:path*" },
        { source: "/api/me/:path*", destination: "/api/erp/me/:path*" },
        { source: "/api/oms/:path*", destination: "/api/erp/oms/:path*" },
        { source: "/api/payroll/:path*", destination: "/api/erp/payroll/:path*" },
        { source: "/api/payslips/:path*", destination: "/api/erp/payslips/:path*" },
        { source: "/api/ui/:path*", destination: "/api/erp/ui/:path*" },
      ],
    };
  },
};

module.exports = nextConfig;
