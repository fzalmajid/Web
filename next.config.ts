import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";
const withSerwist=withSerwistInit({swSrc:"app/sw.ts",swDest:"public/learning-sw.js",swUrl:"/learning-sw.js",register:false,reloadOnOnline:false,globPublicPatterns:["manifest.webmanifest","icons/**/*"],disable:process.env.NODE_ENV!=="production",maximumFileSizeToCacheInBytes:2_000_000});

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers(){return [{source:"/learning-assets/:path*",headers:[{key:"Access-Control-Allow-Origin",value:"*"}]},{source:"/ebook-reader.js",headers:[{key:"Access-Control-Allow-Origin",value:"*"}]}];},
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

export default withSerwist(nextConfig);
