import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "test/e2e",
  fullyParallel: true,
  forbidOnly: true,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:47821",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "node scripts/serve-demo.ts examples/astro/dist 47821",
      url: "http://127.0.0.1:47821",
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      // The same demo built with layout.blocking false (DEMO_VARIANT=nonblocking).
      command: "node scripts/serve-demo.ts examples/astro/dist-nonblocking 47822",
      url: "http://127.0.0.1:47822",
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      // The same demo built with Astro's ClientRouter (DEMO_VARIANT=router).
      command: "node scripts/serve-demo.ts examples/astro/dist-router 47823",
      url: "http://127.0.0.1:47823",
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
