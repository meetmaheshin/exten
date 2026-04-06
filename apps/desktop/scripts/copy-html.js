const fs = require("fs");
const path = require("path");

const pairs = [
  ["src/renderer/login/index.html", "dist/renderer/login/index.html"],
  ["src/renderer/picker/index.html", "dist/renderer/picker/index.html"],
];

for (const [src, dest] of pairs) {
  const destDir = path.dirname(dest);
  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(src, dest);
  console.log(`Copied ${src} → ${dest}`);
}
