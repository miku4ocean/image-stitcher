import { test, expect } from '@playwright/test';
import path from 'path';

test('上傳兩張圖後顯示裁切介面且順序正確', async ({ page }) => {
  await page.goto('file://' + path.resolve('index.html'));
  await page.setInputFiles('#fileInput', [
    'tests/fixtures/1.png',
    'tests/fixtures/2.png',
  ]);
  const names = page.locator('.crop-name');
  await expect(names.nth(0)).toContainText('1.png');
  await expect(names.nth(1)).toContainText('2.png');
});

test('拼接後結果 canvas 有內容', async ({ page }) => {
  await page.goto('file://' + path.resolve('index.html'));
  await page.setInputFiles('#fileInput', [
    'tests/fixtures/1.png',
    'tests/fixtures/2.png',
  ]);
  await page.waitForSelector('.crop-selection');
  await page.click('#processBtn');
  const width = await page.locator('#resultCanvas').evaluate(
    (c: HTMLCanvasElement) => c.width
  );
  expect(width).toBeGreaterThan(0);
});