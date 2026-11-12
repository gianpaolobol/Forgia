import {defineConfig} from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  workers: 1,
  timeout: 45000,
  use: {
    baseURL: 'http://127.0.0.1:8081',
    headless: true,
    launchOptions: process.env.FORGIA_CHROMIUM ? {executablePath: process.env.FORGIA_CHROMIUM} : {},
    viewport: {width: 1365, height: 950},
  },
  reporter: 'list',
});
