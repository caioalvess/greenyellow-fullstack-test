import { defineConfig, devices } from '@playwright/test';

/**
 * Config do Playwright para os testes E2E do frontend.
 *
 * - `webServer` usa `npm start` pra garantir que o dev server esta de pe' antes
 *   dos testes; se o `PLAYWRIGHT_BASE_URL` estiver setado, Playwright nao sobe
 *   nada e usa a URL externa (usado quando os testes rodam contra prod ou
 *   o dev ja' esta rodando em outro container).
 * - `testDir` e' separado do unit (src/) pra nao colidir com Jest.
 * - Apenas Chromium por padrao: reduz tempo total e e' suficiente pra smoke
 *   tests. Dar pra expandir pra webkit/firefox se necessario.
 */
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:4200';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  fullyParallel: true,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: 'npm start',
        url: baseURL,
        reuseExistingServer: true,
        timeout: 90_000,
      },
});
