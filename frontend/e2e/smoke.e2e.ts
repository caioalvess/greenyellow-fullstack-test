import { test, expect } from '@playwright/test';

/**
 * Smoke E2E da UI.
 *
 * Locale fixado em `pt` via localStorage antes do carregamento da pagina
 * (addInitScript) — assim os seletores por nome usam labels conhecidos e
 * nao dependem do `navigator.language` do ambiente de CI.
 *
 * Os 3 cenarios:
 *  1. Landing: logo + toggle de tema atualiza `data-theme` no <html>.
 *  2. I18n: trocar para EN muda o heading "Consulta" pra "Query".
 *  3. Preset de data: clicar em "Últimos 30 dias" preenche os dois campos
 *     de data no formato DD-MM-AAAA — exercita o novo feature + a
 *     integracao com p-calendar.
 */

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('gy-locale', 'pt'));
});

test.describe('GreenYellow — Smoke', () => {
  test('landing + theme toggle muda data-theme', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('img[alt="GreenYellow"]')).toBeVisible();

    const initial = await page.evaluate(() =>
      document.documentElement.getAttribute('data-theme'),
    );
    await page.getByRole('button', { name: /Mudar para tema/ }).click();
    const after = await page.evaluate(() =>
      document.documentElement.getAttribute('data-theme'),
    );
    expect(after).not.toBe(initial);
  });

  test('i18n pt → en troca labels na hora', async ({ page }) => {
    await page.goto('/');
    await expect(
      page.getByRole('heading', { name: 'Consulta' }),
    ).toBeVisible();

    await page.getByRole('button', { name: /Escolher idioma/i }).click();
    await page.getByRole('menuitem', { name: /English/ }).click();

    await expect(page.getByRole('heading', { name: 'Query' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Results' })).toBeVisible();
  });

  test('preset "Últimos 30 dias" preenche as datas', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Últimos 30 dias' }).click();

    const start = await page.locator('#dateInitial').inputValue();
    const end = await page.locator('#finalDate').inputValue();

    // Formato DD-MM-AAAA imposto pela date-mask + dateFormat do p-calendar
    expect(start).toMatch(/^\d{2}-\d{2}-\d{4}$/);
    expect(end).toMatch(/^\d{2}-\d{2}-\d{4}$/);
    expect(start).not.toBe(end);
  });
});
