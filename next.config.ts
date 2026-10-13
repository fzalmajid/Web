import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";
const withSerwist=withSerwistInit({swSrc:"app/sw.ts",swDest:"public/learning-sw.js",swUrl:"/learning-sw.js",register:false,reloadOnOnline:false,additionalPrecacheEntries:[{url:"/offline",revision:process.env.VERCEL_GIT_COMMIT_SHA||process.env.GITHUB_SHA||"offline-shell-v2"}],globPublicPatterns:["manifest.webmanifest","icons/**/*"],disable:process.env.NODE_ENV!=="production",maximumFileSizeToCacheInBytes:2_000_000});

// The integration supplies server configuration. Only the public endpoint URLs
// are included in browser bundles; database credentials and cookie keys stay on
// the server. Explicit endpoints also support a later provider/project move.
const neonAuthUrl = process.env.NEXT_PUBLIC_NEON_AUTH_URL || process.env.NEON_AUTH_BASE_URL || "";
let neonDataUrl = process.env.NEXT_PUBLIC_NEON_DATA_API_URL || process.env.NEON_DATA_API_URL || "";
if (!neonDataUrl && neonAuthUrl) {
  const endpoint = new URL(neonAuthUrl);
  if (endpoint.protocol === "https:" && endpoint.hostname.includes(".neonauth.")) {
    endpoint.hostname = endpoint.hostname.replace(".neonauth.", ".apirest.");
    endpoint.pathname = endpoint.pathname.replace(/\/auth\/?$/, "/rest/v1");
    neonDataUrl = endpoint.toString().replace(/\/$/, "");
  }
}

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_NEON_AUTH_URL: neonAuthUrl,
    NEXT_PUBLIC_NEON_DATA_API_URL: neonDataUrl,
  },
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
