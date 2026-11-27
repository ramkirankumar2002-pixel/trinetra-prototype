// What every staff page is checked for, and its pictures: on a laptop and a phone, in
// English and Hindi, without leaving the state the page is in.
import { mkdir } from "node:fs/promises";
import { expect, type Page } from "@playwright/test";

export const PHONE = { width: 390, height: 844 };
export const LAPTOP = { width: 1366, height: 768 };

export const noSidewaysScroll = async (page: Page, name: string) => {
  const extra = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(extra, `${name}: nothing scrolls sideways`).toBeLessThanOrEqual(0);
};

/** Every button and tab can be hit with a thumb. */
export async function bigEnough(page: Page, name: string) {
  const small = await page.evaluate(() =>
    [
      ...document.querySelectorAll(
        "main button, main a[data-slot='button'], main label.cursor-pointer",
      ),
    ]
      .filter((element) => {
        const box = element.getBoundingClientRect();
        return box.width > 0 && box.height > 0 && box.height < 47.5;
      })
      .map(
        (element) => `${element.textContent?.trim()} (${element.getBoundingClientRect().height})`,
      ),
  );
  expect(small, `${name}: buttons are at least 48 px tall`).toEqual([]);
}

/**
 * Checks the page at both sizes in both languages and, with a folder, saves the four
 * pictures. Leaves it in English at `back`.
 */
export async function lookAt(
  page: Page,
  name: string,
  options: { folder: string | null; back: { width: number; height: number } },
): Promise<void> {
  const { folder, back } = options;
  if (folder) await mkdir(folder, { recursive: true });
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  const shoot = async (language: "en" | "hi") => {
    for (const [device, size] of [
      ["laptop", LAPTOP],
      ["mobile", PHONE],
    ] as const) {
      await page.setViewportSize(size);
      await noSidewaysScroll(page, `${name} ${language} ${device}`);
      if (device === "mobile") await bigEnough(page, `${name} ${language}`);
      if (!folder) continue;
      // A tall picture of the whole page, with the bars where they belong.
      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      await page.setViewportSize({ width: size.width, height: Math.max(size.height, height) });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.evaluate(() => document.fonts.ready);
      await page.waitForFunction(() =>
        [...document.images].every((image) => image.complete && image.naturalWidth > 0),
      );
      await page.screenshot({
        path: `${folder}${name}-${device}-${language}.png`,
        animations: "disabled",
        // Messages that fade away are not part of the screen.
        style: "ol[tabindex='-1']{visibility:hidden!important}",
      });
    }
  };
  /** The language switch is in the sidebar (laptop) and under the login card. */
  const choose = async (language: string) => {
    await page.setViewportSize(LAPTOP);
    await page.getByRole("button", { name: language, exact: true }).first().click();
  };
  await shoot("en");
  await choose("हिंदी");
  await expect(page.locator("html")).toHaveAttribute("lang", "hi");
  await shoot("hi");
  await choose("English");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.setViewportSize(back);
}
