// @ts-check
const { defineConfig, devices } = require("@playwright/test");

const PORT = 8799;

module.exports = defineConfig({
  testDir: ".",
  fullyParallel: true,
  expect: { timeout: 10_000 },
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
  },
  // The real standard-library server serves the frontend; tests mock only GitHub and Gemini.
  webServer: {
    command: `python -m repolens.web --port ${PORT}`,
    cwd: "..",
    url: `http://127.0.0.1:${PORT}/healthz`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "phone", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, hasTouch: true } },
  ],
});
