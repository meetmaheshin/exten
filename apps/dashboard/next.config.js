/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  generateBuildId: async () => `build-${Date.now()}`,
};

module.exports = nextConfig;
