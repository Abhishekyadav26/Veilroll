/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // near-connect ships browser bundles; keep node built-ins out of the client.
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = { ...config.resolve.fallback, fs: false, net: false, tls: false };
    }
    return config;
  },
};

export default nextConfig;
