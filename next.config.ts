import type { NextConfig } from "next";

const isGitHubPages = process.env.GITHUB_PAGES === "true";
const githubPagesBasePath = process.env.NEXT_PUBLIC_GITHUB_PAGES_BASE_PATH || "/RangeGuard";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  ...(isGitHubPages
    ? {
        output: "export" as const,
        trailingSlash: true,
        basePath: githubPagesBasePath,
        assetPrefix: `${githubPagesBasePath}/`,
        images: {
          unoptimized: true,
        },
      }
    : {}),
};

export default nextConfig;
