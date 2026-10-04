import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";
const withSerwist=withSerwistInit({swSrc:"app/sw.ts",swDest:"public/learning-sw.js",swUrl:"/learning-sw.js",register:false,reloadOnOnline:false,additionalPrecacheEntries:[{url:"/offline",revision:process.env.VERCEL_GIT_COMMIT_SHA||process.env.GITHUB_SHA||"offline-shell-v2"}],globPublicPatterns:["manifest.webmanifest","icons/**/*"],disable:process.env.NODE_ENV!=="production",maximumFileSizeToCacheInBytes:2_000_000});

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Keep Node worker paths intact; bundling rewrites __dirname into .next.
  serverExternalPackages: ["tesseract.js", "tesseract.js-core", "@napi-rs/canvas"],
  outputFileTracingIncludes: {
    "/api/import-file": ["./node_modules/tesseract.js/**", "./node_modules/tesseract.js-core/**", "./node_modules/@napi-rs/canvas/**", "./node_modules/@napi-rs/canvas-linux-x64-gnu/**", "./node_modules/pdfjs-dist/standard_fonts/**", "./node_modules/pdfjs-dist/cmaps/**"],
  },
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
