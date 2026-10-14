import { test, expect } from "@playwright/test";

const username = process.env.FORMA_TEST_USERNAME;
const password = process.env.FORMA_TEST_PASSWORD;

test("public landing is lightweight and login works on desktop and mobile", async ({
  page,
}, info) => {
  const errors: string[] = [];
  const scripts: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (r.resourceType() === "script") scripts.push(r.url());
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Pomysł. Kształt. Coś realnego." }),
  ).toBeVisible();
  await expect(page.locator("canvas")).toHaveCount(0);
  expect(scripts.some((url) => /\/App-/.test(url))).toBe(false);
  await page.screenshot({
    path: info.outputPath("landing-desktop.png"),
    fullPage: true,
  });
  await page.getByRole("link", { name: "Zaloguj się", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Dobrze Cię widzieć." }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("login-desktop.png"),
    fullPage: true,
  });
  await page.getByLabel("Hasło", { exact: true }).fill("visible-test");
  await page.getByRole("button", { name: "Pokaż hasło" }).click();
  await expect(page.getByLabel("Hasło", { exact: true })).toHaveAttribute(
    "type",
    "text",
  );
  await page.getByRole("button", { name: "Ukryj hasło" }).click();
  await page.getByLabel("Hasło", { exact: true }).fill("");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: info.outputPath("login-mobile.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.goto("/");
  await page.screenshot({
    path: info.outputPath("landing-mobile.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("protected workshop redirects, rejects a wrong password, logs in and revokes on logout", async ({
  page,
}) => {
  test.skip(!username || !password, "Use a disposable acceptance owner.");
  await page.goto("/app");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator("canvas")).toHaveCount(0);
  expect((await page.request.get("/api/projects")).status()).toBe(401);
  await page.getByLabel("Login", { exact: true }).fill(username!);
  await page.getByLabel("Hasło", { exact: true }).fill("wrong-password");
  await page
    .getByRole("button", { name: "Wejdź do warsztatu", exact: true })
    .click();
  await expect(page.getByRole("alert")).toHaveText(
    "Nieprawidłowy login lub hasło.",
  );
  await page.getByLabel("Hasło", { exact: true }).fill(password!);
  await page
    .getByRole("button", { name: "Wejdź do warsztatu", exact: true })
    .click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.locator("canvas")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Zapisz", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.locator("canvas")).toBeVisible();
  await page.getByRole("button", { name: "Wyloguj", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect((await page.request.get("/api/projects")).status()).toBe(401);
  await page.goto("/app");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator("canvas")).toHaveCount(0);
});

test("expired server session removes the workshop without deleting recovery data", async ({
  page,
}) => {
  test.skip(!username || !password, "Use a disposable acceptance owner.");
  const login = await page.request.post("/api/auth/login", {
    headers: { "X-Forma-Request": "1" },
    data: { username, password },
  });
  expect(login.status()).toBe(200);
  const session = await login.json();
  await page.goto("/app");
  await expect(page.locator("canvas")).toBeVisible();
  const name = page.getByLabel("Nazwa projektu", { exact: true });
  await name.fill("Local recovery after logout");
  await name.press("Enter");
  const before = await page.evaluate(() =>
    localStorage.getItem("forma.studio.v1"),
  );
  await page.request.post("/api/auth/logout", {
    headers: { "X-Forma-Request": "1", "X-CSRF-Token": session.csrf_token },
  });
  await page.getByRole("button", { name: "Zapisz", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator("canvas")).toHaveCount(0);
  expect(
    await page.evaluate(() => localStorage.getItem("forma.studio.v1")),
  ).toBe(before);
});
