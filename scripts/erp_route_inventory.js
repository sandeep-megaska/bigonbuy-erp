const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..");
const pagesRoot = path.join(repoRoot, "pages", "erp");
const outputPath = path.join(repoRoot, "public", "erp-routes.generated.json");
const PAGE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx"]);

const moduleByPrefix = [
  { prefix: "/erp/analytics", module: "analytics" },
  { prefix: "/erp/hr", module: "hr" },
  { prefix: "/erp/inventory", module: "inventory" },
  { prefix: "/erp/procurement", module: "procurement" },
  { prefix: "/erp/finance", module: "finance" },
  { prefix: "/erp/admin", module: "admin" },
  { prefix: "/erp/integrations", module: "integrations" },
  { prefix: "/erp/oms", module: "integrations" },
  { prefix: "/erp/reports", module: "reports" },
];

const ensurePosixPath = (value) => value.split(path.sep).join("/");

const isPageFile = (filePath) => PAGE_EXTENSIONS.has(path.extname(filePath));

const isDynamicSegment = (segment) => /\[.+\]/.test(segment);

const inferModule = (routePath) => {
  for (const entry of moduleByPrefix) {
    if (routePath === entry.prefix || routePath.startsWith(`${entry.prefix}/`)) {
      return entry.module;
    }
  }
  return "misc";
};

const getGitLastModified = (relativePath) => {
  try {
    const output = execSync(`git log -1 --format=%cI -- "${relativePath}"`, {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    return output || null;
  } catch (error) {
    return null;
  }
};

const getFileLastModified = (absolutePath, relativePath) => {
  const gitTimestamp = getGitLastModified(relativePath);
  if (gitTimestamp) return gitTimestamp;
  const stats = fs.statSync(absolutePath);
  return stats.mtime.toISOString();
};

const getRoutePath = (absolutePath) => {
  const relativeToPages = ensurePosixPath(
    path.relative(path.join(repoRoot, "pages"), absolutePath)
  );
  const withoutExtension = relativeToPages.replace(/\.[^.]+$/, "");
  if (withoutExtension.endsWith("/index")) {
    const trimmed = withoutExtension.slice(0, -"/index".length);
    return trimmed === "" ? "/" : `/${trimmed}`;
  }
  return `/${withoutExtension}`;
};

const walkPages = (dir, entries = []) => {
  const dirEntries = fs.readdirSync(dir, { withFileTypes: true });
  dirEntries.forEach((entry) => {
    const absolutePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkPages(absolutePath, entries);
      return;
    }
    if (entry.isFile() && isPageFile(entry.name)) {
      entries.push(absolutePath);
    }
  });
  return entries;
};

const buildInventory = () => {
  if (!fs.existsSync(pagesRoot)) {
    console.error("ERP pages directory not found:", pagesRoot);
    process.exit(1);
  }

  const entries = walkPages(pagesRoot);
  const routes = entries.map((absolutePath) => {
    const routePath = getRoutePath(absolutePath);
    const relativePath = ensurePosixPath(path.relative(repoRoot, absolutePath));
    const segments = routePath.split("/").filter(Boolean);
    return {
      routePath,
      filePath: relativePath,
      isDynamic: segments.some(isDynamicSegment),
      isIndex: path.basename(absolutePath).startsWith("index."),
      lastModified: getFileLastModified(absolutePath, relativePath),
      inferredModule: inferModule(routePath),
    };
  });

  routes.sort((a, b) => {
    if (a.routePath === b.routePath) {
      return a.filePath.localeCompare(b.filePath);
    }
    return a.routePath.localeCompare(b.routePath);
  });

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(routes, null, 2)}\n`, "utf8");
  console.log(`ERP route inventory written to ${ensurePosixPath(outputPath)}`);
};

buildInventory();
