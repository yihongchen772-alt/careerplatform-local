import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Spreadsheet import sends the file to a Server Action as base64, which
      // inflates it by ~33%. The 1MB default rejected a real 2.5MB 秋招信息表
      // with "Body exceeded 1 MB limit", surfacing as an unhandled rejection
      // rather than a usable message. 16mb covers the 10MB cap the import
      // action itself enforces, base64 overhead included.
      bodySizeLimit: "16mb",
    },
  },
};

export default nextConfig;
