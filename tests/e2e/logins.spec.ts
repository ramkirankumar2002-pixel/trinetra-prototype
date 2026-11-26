// Phase 9 "Done when": each role logs in through the website's own /api, sees its page,
// and is refused on the other roles' pages.
import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";
import { SEED_USERS } from "@trinetra/shared/seed";
import { expectDriverRules } from "./driver-rules";
import { WEB_URL } from "./playwright.config";

const ROLES = [
  {
    path: "kiosk",
    username: "wb01",
    size: { width: 1366, height: 768 },
    // A heading of the Ready screen, to see the language change.
    english: "Ready to collect",
    hindi: "पर्ची तैयार है",
  },
  {
    path: "supervisor",
    username: "amit",
    size: { width: 390, height: 760 },
    english: "Trucks for me",
    hindi: "मेरे ट्रक",
  },
  {
    path: "store",
    username: "ram",
    size: { width: 390, height: 760 },
    english: "Requests to decide",
    hindi: "फ़ैसले के अनुरोध",
  },
] as const;

function seedUser(username: string) {
  const user = SEED_USERS.find((item) => item.username === username);
  if (!user) throw new Error(`No seeded user ${username}.`);
  return user;
}

const pageAt = (path: string) => new RegExp(`^${WEB_URL}${path}$`);

/**
 * Lets a test cut the live connection. (Playwright's offline mode leaves an open WebSocket
 * connected.) Call before the page is opened.
 */
async function liveLink(page: Page) {
  let down = false;
  /** Connections that Socket.IO has moved to their WebSocket. */
  const upgraded = new Set<WebSocketRoute>();
  // A new page load starts again.
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) upgraded.clear();
  });
  await page.routeWebSocket(/\/socket\.io\//, (socket) => {
    if (down) return void socket.close();
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      // Socket.IO's "upgrade" packet: from now on only the WebSocket is used.
      if (message === "5") upgraded.add(socket);
      server.send(message);
    });
  });
  await page.route(/\/socket\.io\//, (route) => (down ? route.abort() : route.continue()));
  return {
    async cut() {
      // Before the upgrade a request still waits on the server, and would stay open.
      await expect.poll(() => upgraded.size).toBeGreaterThan(0);
      down = true;
      await Promise.all([...upgraded].map((socket) => socket.close()));
      upgraded.clear();
    },
    restore() {
      down = false;
    },
  };
}

/**
 * Runs `action` where the language switch and Logout are: in the bar on the kiosk, in
 * the drawer on a phone (which is closed again if it is still open).
 */
async function inMenu(page: Page, area: string, action: () => Promise<void>) {
  if (area === "kiosk") return action();
  await page.getByRole("button", { name: /^(Open menu|मेनू खोलें)$/ }).click();
  const close = page.getByRole("button", { name: /^(Close menu|मेनू बंद करें)$/ });
  await expect(close).toBeVisible();
  await action();
  if (await close.isVisible()) await close.click();
  await expect(close).toHaveCount(0);
}

async function logIn(page: Page, username: string, pin: string) {
  await page.getByLabel("Username").fill(username);
  const pad = page.getByRole("group", { name: "Number pad" });
  for (const digit of pin) await pad.getByRole("button", { name: digit, exact: true }).click();
  await page.getByRole("button", { name: "Log in", exact: true }).click();
}

for (const role of ROLES) {
  test.describe(role.path, () => {
    test.use({ viewport: role.size });

    test("logs in, shows its page, is refused elsewhere and logs out", async ({
      page,
      context,
    }) => {
      const user = seedUser(role.username);
      const apiCalls: string[] = [];
      page.on("request", (request) => {
        const url = new URL(request.url());
        if (url.pathname.startsWith("/api/")) apiCalls.push(url.origin);
      });

      const link = await liveLink(page);

      // Without a login, the page leads to its own login.
      await page.goto(`/${role.path}`);
      await expect(page).toHaveURL(pageAt(`/${role.path}/login`));
      await logIn(page, user.username, user.pin);

      // The shell: who is logged in and the live connection.
      await expect(page).toHaveURL(pageAt(`/${role.path}`));
      if (role.path !== "kiosk") {
        await expect(page.getByText("Welcome,")).toBeVisible();
        await expect(page.getByRole("heading", { name: `Welcome, ${user.name}` })).toBeVisible();
      }
      await expect(page.getByTestId("connection")).toHaveText("Online");
      await expect(page.getByText(role.english)).toBeVisible();
      if (role.path === "kiosk") await expectDriverRules(page);

      // The login cookie belongs to the website, and scripts cannot read it.
      const cookie = (await context.cookies(WEB_URL)).find(
        (item) => item.name === "trinetra_session",
      );
      expect(cookie).toMatchObject({ domain: "localhost", httpOnly: true, sameSite: "Lax" });
      // Every API call went to the website's own address.
      expect(apiCalls.length).toBeGreaterThan(0);
      expect([...new Set(apiCalls)]).toEqual([WEB_URL]);

      // The language switch changes the shell, and is remembered for staff only.
      await inMenu(page, role.path, () => page.getByRole("button", { name: "हिंदी" }).click());
      await expect(page.getByText(role.hindi)).toBeVisible();
      await expect(page.getByTestId("connection")).toHaveText("ऑनलाइन");
      await expect(page.locator("html")).toHaveAttribute("lang", "hi");
      if (role.path === "kiosk") await expectDriverRules(page);
      await page.reload();
      await expect(page.getByText(role.path === "kiosk" ? role.english : role.hindi)).toBeVisible();
      // The kiosk starts in English again, and its one button offers only the other one.
      if (role.path !== "kiosk") {
        await inMenu(page, role.path, () => page.getByRole("button", { name: "English" }).click());
      }
      await expect(page.getByText(role.english)).toBeVisible();

      // The live connection drops, and comes back.
      await expect(page.getByTestId("connection")).toHaveText("Online");
      await link.cut();
      await expect(page.getByTestId("connection")).toHaveText("Offline — reconnecting");
      link.restore();
      await expect(page.getByTestId("connection")).toHaveText("Online");

      // The other parts refuse this role, each at its own login.
      for (const other of ROLES.filter((item) => item.path !== role.path)) {
        await page.goto(`/${other.path}`);
        await expect(page).toHaveURL(pageAt(`/${other.path}/login`));
        await expect(page.getByText(`You are logged in as ${user.name}`)).toBeVisible();
        await expect(page.getByText(other.english)).toHaveCount(0);
      }

      // Log out asks first.
      await page.goto(`/${role.path}`);
      await expect(page.getByTestId("connection")).toHaveText("Online");
      const dialog = page.getByRole("dialog", { name: "Log out?" });
      // On a phone the drawer is a dialog too; only it holds the Logout button.
      const logout = page.getByRole("button", { name: "Log out" });
      await inMenu(page, role.path, async () => {
        // The weighbridge shows no Logout to drivers: staff hold the logo for it.
        if (role.path === "kiosk") {
          await page.getByTestId("rail-logo").hover();
          await page.mouse.down();
          await expect(page.getByRole("dialog", { name: "For staff" })).toBeVisible();
          await page.mouse.up();
        }
        await logout.click();
        await dialog.getByRole("button", { name: "No" }).click();
        await expect(dialog).toHaveCount(0);
        await logout.click();
        await dialog.getByRole("button", { name: "Yes" }).click();
        await expect(page).toHaveURL(pageAt(`/${role.path}/login`));
      });
      await expect(page).toHaveURL(pageAt(`/${role.path}/login`));
      expect(await context.cookies(WEB_URL)).toEqual([]);

      // And the page is closed again.
      await page.goto(`/${role.path}`);
      await expect(page).toHaveURL(pageAt(`/${role.path}/login`));
    });
  });
}
