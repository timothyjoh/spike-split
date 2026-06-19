import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  reporter: "list",
  outputDir: "test-results",
  use: {
    baseURL: "http://localhost:3001",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "DB_PATH=./data/e2e.db npm start",
    port: 3001,
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
