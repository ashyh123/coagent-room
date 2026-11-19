import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const errors = [];

function fail(msg) {
  errors.push(msg);
}

function getTrackedFiles() {
  const out = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" });
  return out
    .split(/\r?\n/)
    .map((f) => f.trim())
    .filter(Boolean);
}

const trackedFiles = getTrackedFiles();
const textExts = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".yml",
  ".yaml",
  ".css",
  ".html",
  ".sh",
]);

// 1. Control characters & basic secret leak scan
const secretPatterns = [
  { name: "OpenAI key prefix", re: /\bsk-proj-[A-Za-z0-9_-]{12,}\b/ },
  { name: "GitHub PAT (ghp_)", re: /\bghp_[A-Za-z0-9]{20,}\b/ },
  { name: "GitHub OAuth token (gho_)", re: /\bgho_[A-Za-z0-9]{20,}\b/ },
];

for (const rel of trackedFiles) {
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) continue;
  const ext = path.extname(rel).toLowerCase();
  if (!textExts.has(ext) && path.basename(rel) !== "LICENSE") continue;

  const content = fs.readFileSync(full, "utf8");

  // Disallow ASCII control chars except \t (0x09), \n (0x0a), \r (0x0d)
  for (let i = 0; i < content.length; i++) {
    const code = content.charCodeAt(i);
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) {
      fail(`Control character 0x${code.toString(16)} found in ${rel}`);
      break;
    }
  }

  // Skip self for secret regex literals
  if (rel !== "scripts/ci/check-hygiene.mjs") {
    for (const pat of secretPatterns) {
      if (pat.re.test(content)) {
        fail(`Possible secret (${pat.name}) detected in ${rel}`);
      }
    }
  }
}

// 2. Module boundary checks
const importRe = /(?:import|export)\s+(?:[^'"]*?\s+from\s+)?["']([^"']+)["']|require\(["']([^"']+)["']\)/g;

for (const rel of trackedFiles) {
  if (!rel.endsWith(".ts") && !rel.endsWith(".tsx") && !rel.endsWith(".js") && !rel.endsWith(".mjs")) {
    continue;
  }
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) continue;
  const content = fs.readFileSync(full, "utf8");

  let match;
  while ((match = importRe.exec(content)) !== null) {
    const spec = match[1] || match[2];
    if (!spec) continue;

    if (rel.startsWith("packages/protocol/src/")) {
      if (spec.startsWith("node:")) {
        fail(`Module boundary: ${rel} must not import "${spec}" (protocol must stay browser/LAN-HTTP safe)`);
      }
      if (spec.includes("apps/")) {
        fail(`Module boundary: ${rel} must not depend on apps/* ("${spec}")`);
      }
    }

    if ((rel.startsWith("apps/server/src/") || rel.startsWith("apps/cli/src/")) && spec.includes("apps/web")) {
      fail(`Module boundary: ${rel} must not import apps/web ("${spec}")`);
    }

    if (rel.startsWith("apps/web/src/") && (spec.includes("apps/server") || spec.includes("apps/cli"))) {
      fail(`Module boundary: ${rel} must not import server/cli ("${spec}")`);
    }
  }
}

// 3. docs/README.md index completeness & link check
const docsDir = path.join(root, "docs");
const docsReadmePath = path.join(docsDir, "README.md");
if (fs.existsSync(docsDir)) {
  if (!fs.existsSync(docsReadmePath)) {
    fail("docs/README.md is missing");
  } else {
    const readme = fs.readFileSync(docsReadmePath, "utf8");
    const docFiles = fs
      .readdirSync(docsDir)
      .filter((f) => f.endsWith(".md") && f !== "README.md");

    for (const docFile of docFiles) {
      if (!readme.includes(`(${docFile})`) && !readme.includes(`./${docFile}`)) {
        fail(`docs/${docFile} is not indexed in docs/README.md`);
      }
    }

    const linkRe = /\[[^\]]+\]\(([^)]+)\)/g;
    let lm;
    while ((lm = linkRe.exec(readme)) !== null) {
      const target = lm[1];
      if (target.startsWith("http://") || target.startsWith("https://") || target.startsWith("#")) {
        continue;
      }
      const resolved = path.resolve(docsDir, target.split("#")[0]);
      if (!fs.existsSync(resolved)) {
        fail(`Broken link in docs/README.md: ${target}`);
      }
    }
  }
}

// 4. Orphan test check: any workspace with *.test.ts must have a test script in package.json
const workspacesWithTests = new Set();
for (const rel of trackedFiles) {
  if (/^(packages|apps)\/[^/]+\/.*\.test\.(ts|tsx|js|mjs)$/.test(rel)) {
    const wsDir = rel.split("/").slice(0, 2).join("/");
    workspacesWithTests.add(wsDir);
  }
}

for (const wsDir of workspacesWithTests) {
  const pkgPath = path.join(root, wsDir, "package.json");
  if (!fs.existsSync(pkgPath)) {
    fail(`Workspace ${wsDir} has test files but no package.json`);
    continue;
  }
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  if (!pkg.scripts || !pkg.scripts.test) {
    fail(`Orphan tests in ${wsDir}: package.json is missing a "test" script`);
  }
}

if (errors.length > 0) {
  console.error("Repo hygiene check FAILED:\n");
  for (const err of errors) {
    console.error(`  - ${err}`);
  }
  process.exit(1);
}

console.log(`Repo hygiene check PASSED (${trackedFiles.length} tracked files checked).`);
