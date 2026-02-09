import { defineConfig, devices } from "@playwright/test";

const PORT = 3005;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
    testDir: "./e2e",
    timeout: 45_000,
    expect: {
        timeout: 10_000,
    },
    fullyParallel: true,
    reporter: "list",
    use: {
        baseURL: BASE_URL,
        trace: "on-first-retry",
    },
    projects: [
        {
            name: "chromium",
            use: { ...devices["Desktop Chrome"] },
        },
    ],
    webServer: {
        command: `bun run start -- --hostname 127.0.0.1 --port ${PORT}`,
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        cwd: __dirname,
        stdout: "pipe",
        stderr: "pipe",
        env: {
            NODE_ENV: "production",
        },
    },
});
