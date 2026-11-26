// Logging in without the login page, for tests and screenshots that are about other pages.
import { expect, type BrowserContext } from "@playwright/test";
import { SEED_USERS } from "@trinetra/shared/seed";
import { WEB_URL } from "./playwright.config";

export async function signIn(context: BrowserContext, username: string) {
  const user = SEED_USERS.find((item) => item.username === username);
  if (!user) throw new Error(`No seeded user ${username}.`);
  const answer = await context.request.post(`${WEB_URL}/api/auth/login`, {
    data: { username, pin: user.pin },
  });
  expect(answer.status()).toBe(200);
}
