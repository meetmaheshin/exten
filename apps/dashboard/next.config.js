/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  trailingSlash: true,
  basePath: "/dashboard",
  generateBuildId: async () => `build-${Date.now()}`,
};

module.exports = nextConfig;
