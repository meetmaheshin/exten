const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// 1. Compile TypeScript
execSync("npx tsc", { stdio: "inherit", cwd: path.join(__dirname, "..") });

// 2. Copy HTML files
const pairs = [
  ["src/renderer/login/index.html", "dist/renderer/login/index.html"],
  ["src/renderer/picker/index.html", "dist/renderer/picker/index.html"],
];
for (const [src, dest] of pairs) {
  const destDir = path.dirname(path.join(__dirname, "..", dest));
  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(
    path.join(__dirname, "..", src),
    path.join(__dirname, "..", dest)
  );
}

console.log("Build complete.");
