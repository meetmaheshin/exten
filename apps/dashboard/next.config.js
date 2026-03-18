/** @type {import('next').NextConfig} */
const nextConfig = {
  generateBuildId: async () => `build-${Date.now()}`,
};

module.exports = nextConfig;
