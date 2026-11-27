// The supervisor's and the store officer's pages on a phone, a tablet and a computer, in
// both languages.
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./staff-session";

const AREAS = [
  {
    path: "supervisor",
    username: "amit",
    pages: ["", "/trucks", "/done", "/profile"],
    numbers: 5,
    // A bottom tab, then a page chosen in the drawer.
    tab: { name: "Done", route: "done", title: "Done today" },
    drawer: { name: "Profile", route: "profile" },
  },
  {
    path: "store",
    username: "ram",
    pages: ["", "/approvals", "/trucks", "/history"],
    numbers: 6,
    tab: { name: "History", route: "history", title: "History" },
    drawer: { name: "Trucks on site", route: "trucks" },
  },
];

const SIZES = [
  { name: "phone", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "computer", width: 1440, height: 900 },
];

const sidewaysScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

for (const area of AREAS) {
  for (const size of SIZES) {
    test(`${area.path} pages fit a ${size.name}`, async ({ page, context }) => {
      const phone = size.width < 768;
      await page.setViewportSize(size);
      await signIn(context, area.username);

      for (const language of ["en", "hi"]) {
        await page.goto(`/${area.path}`);
        await page.evaluate(
          (staff) =>
            localStorage.setItem(
              "trinetra.language",
              JSON.stringify({ state: { staff }, version: 0 }),
            ),
          language,
        );
        for (const route of area.pages) {
          await page.goto(`/${area.path}${route}`);
          await expect(page.locator("html")).toHaveAttribute("lang", language);
          await expect(page.getByTestId("connection")).toBeVisible();
          expect(await sidewaysScroll(page), `${language} ${route || "home"}`).toBeLessThanOrEqual(
            0,
          );

          // A phone has tabs at the bottom; wider screens have the sidebar.
          await expect(page.getByTestId("sidebar")).toBeVisible({ visible: !phone });
          const tabs = page.getByRole("navigation", { name: /^(Main pages|मुख्य पेज)$/ });
          await expect(tabs).toBeVisible({ visible: phone });
          const current = (phone ? tabs : page.getByTestId("sidebar")).locator(
            '[aria-current="page"]',
          );
          await expect(current).toHaveAttribute("href", `/${area.path}${route}`);
        }

        await page.goto(`/${area.path}`);
        // Real numbers: nothing on the staff pages is a sample.
        await expect(page.getByTestId("kpi")).toHaveCount(area.numbers);
        await expect(page.getByTestId("sample")).toHaveCount(0);
      }
    });
  }

  test(`${area.path} tabs and drawer move between pages on a phone`, async ({ page, context }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(context, area.username);
    await page.goto(`/${area.path}`);
    await expect(page.getByTestId("connection")).toHaveText("Online");

    const tabs = page.getByRole("navigation", { name: "Main pages" });
    await tabs.getByRole("link", { name: area.tab.name }).click();
    await expect(page).toHaveURL(new RegExp(`/${area.path}/${area.tab.route}$`));
    await expect(page.getByRole("heading", { level: 1, name: area.tab.title })).toBeVisible();

    await page.getByRole("button", { name: "Open menu" }).click();
    const drawer = page.getByRole("dialog", { name: "Menu" });
    await drawer.getByRole("link", { name: area.drawer.name }).click();
    // The drawer closes once a page is chosen.
    await expect(drawer).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/${area.path}/${area.drawer.route}$`));
    // Moving between pages keeps the live connection.
    await expect(page.getByTestId("connection")).toHaveText("Online");
  });
}
