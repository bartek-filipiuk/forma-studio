import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: process.env.FORMA_TEST_URL ?? "http://127.0.0.1:8080",
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: {
      executablePath: process.env.FORMA_CHROMIUM_PATH,
      args: ["--enable-unsafe-swiftshader"],
    },
  },
});
