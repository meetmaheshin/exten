/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  trailingSlash: true,
  generateBuildId: async () => `build-${Date.now()}`,
};

module.exports = nextConfig;
