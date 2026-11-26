// The kiosk's driver rules (docs/design/STYLE_GUIDE.md), measured in the browser: nothing
// scrolls, text is at least 32 px and buttons are at least 96 px tall.
import { expect, type Page } from "@playwright/test";

export const KIOSK_SIZES = [
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
] as const;

export async function expectDriverRules(page: Page) {
  const broken = await page.evaluate(() => {
    const problems: string[] = [];
    const kiosk = document.querySelector('[data-theme="kiosk"]');
    if (!kiosk) return ["there is no kiosk screen"];
    const name = (element: Element) =>
      `${element.tagName.toLowerCase()} "${element.textContent?.trim().slice(0, 40)}"`;

    for (const box of [document.documentElement, ...kiosk.querySelectorAll("main")]) {
      if (box.scrollHeight > box.clientHeight + 1 || box.scrollWidth > box.clientWidth + 1) {
        problems.push(
          `${box.tagName} scrolls: ${box.scrollWidth}×${box.scrollHeight} in ` +
            `${box.clientWidth}×${box.clientHeight}`,
        );
      }
    }

    for (const element of kiosk.querySelectorAll<HTMLElement>("*")) {
      const box = element.getBoundingClientRect();
      // Hidden, or only for screen readers.
      if (box.width <= 1 || box.height <= 1 || element.closest(".sr-only")) continue;
      const ownText = [...element.childNodes].some(
        (node) => node.nodeType === Node.TEXT_NODE && node.textContent!.trim() !== "",
      );
      if (ownText) {
        const size = parseFloat(getComputedStyle(element).fontSize);
        // The product's name under the logo is branding: no driver has to read it.
        if (size < 32 && !element.closest("[data-brand-tagline]")) {
          problems.push(`text ${size}px: ${name(element)}`);
        }
        if (box.bottom > innerHeight + 1 || box.right > innerWidth + 1) {
          problems.push(`off the screen: ${name(element)}`);
        }
        // Words that do not fit their box.
        if (element.scrollWidth > element.clientWidth + 1 && element.clientWidth > 0) {
          problems.push(`cut off: ${name(element)}`);
        }
      }
      // Lines that do not fit the height of a button or a box spill out of it.
      if (
        element.matches("button, [data-fits]") &&
        element.scrollHeight > element.clientHeight + 2
      ) {
        problems.push(`spills out: ${name(element)}`);
      }
      if (element.matches("button, a[data-slot=button]")) {
        if (box.height < 95.5) problems.push(`button ${box.height}px tall: ${name(element)}`);
        if (box.bottom > innerHeight + 1)
          problems.push(`button below the screen: ${name(element)}`);
      }
    }
    return problems;
  });
  expect(broken).toEqual([]);
}
