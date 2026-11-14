import {defineConfig} from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  workers: 1,
  timeout: 30_000,
  projects: [{name: 'production'}, {name: 'development'}],
  webServer: {
    command: 'pnpm --filter @flightsim-things/interface dev',
    url: 'http://127.0.0.1:5173',
    timeout: 30_000,
  },
});
