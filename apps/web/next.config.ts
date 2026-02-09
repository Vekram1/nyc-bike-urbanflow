import path from "node:path";
import type { NextConfig } from "next";

const workspaceRoot = path.join(__dirname, "..", "..");

const nextConfig: NextConfig = {
    reactCompiler: true,
    turbopack: {
        root: workspaceRoot,
    },
    outputFileTracingRoot: workspaceRoot,
};

export default nextConfig;
