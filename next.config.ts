import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Hugging Face Transformers.js runs only inside a browser worker.
  webpack: (config) => {
    config.resolve.alias = { ...config.resolve.alias, "onnxruntime-node$": false, "sharp$": false };
    return config;
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "20mb"
    }
  }
};

export default nextConfig;
