import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

test.beforeEach(async ({ page }) => {
  const username = process.env.FORMA_TEST_USERNAME;
  const password = process.env.FORMA_TEST_PASSWORD;
  test.skip(!username || !password, "Set credentials for a disposable acceptance owner.");
  const response = await page.request.post("/api/auth/login", {
    headers: { "X-Forma-Request": "1" }, data: { username, password },
  });
  expect(response.status()).toBe(200);
});

async function cached(page: Page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem("forma.studio.v1")!));
}

async function newPico(page: Page) {
  await page.goto("/app");
  await page.getByRole("button", { name: "Mój warsztat" }).click();
  await page.getByRole("button", { name: "Nowy PICO", exact: false }).click();
}

test("dimensions commit, cancel, validate and undo without no-op revisions", async ({ page }) => {
  await newPico(page);
  const wall = page.getByRole("spinbutton", { name: "Ścianka", exact: true });
  await wall.fill("3");
  await wall.press("Enter");
  expect((await cached(page)).project.parts[0].params.wall).toBe(3);
  const revision = (await cached(page)).project.revision;
  await wall.focus();
  await wall.press("Tab");
  expect((await cached(page)).project.revision).toBe(revision);
  await wall.fill("4");
  await wall.press("Escape");
  await expect(wall).toHaveValue("3");
  expect((await cached(page)).project.revision).toBe(revision);
  await wall.fill("100");
  await wall.press("Enter");
  await expect(wall).toHaveValue("3");
  expect((await cached(page)).project.revision).toBe(revision);
  await page.getByRole("button", { name: "Cofnij", exact: true }).click();
  await expect(wall).toHaveValue("2.4");
  await page.getByRole("button", { name: "Ponów", exact: true }).click();
  await expect(wall).toHaveValue("3");
  expect((await cached(page)).project.revision).toBeGreaterThan(revision);
});

test("names follow undo and empty edits restore the committed value", async ({ page }) => {
  await newPico(page);
  for (const label of ["Nazwa części", "Nazwa projektu"]) {
    const field = page.getByRole("textbox", { name: label, exact: true });
    const original = await field.inputValue();
    await field.fill("QA renamed");
    await field.press("Enter");
    await page.getByRole("button", { name: "Cofnij", exact: true }).click();
    await expect(field).toHaveValue(original);
    await field.fill("");
    await field.press("Enter");
    await expect(field).toHaveValue(original);
  }
});

test("a stale tab cannot overwrite a newer save", async ({ page, context }) => {
  await newPico(page);
  await page.getByRole("button", { name: "Zapisz", exact: true }).click();
  await expect(page.locator(".status-right")).toContainText("Zapisano");
  const second = await context.newPage();
  await second.goto("/app");
  await expect(second.getByRole("spinbutton", { name: "Ścianka", exact: true })).toHaveValue("2.4");
  await page.getByRole("spinbutton", { name: "Ścianka", exact: true }).fill("4");
  await page.getByRole("spinbutton", { name: "Ścianka", exact: true }).press("Control+s");
  await expect(page.locator(".status-right")).toContainText("Zapisano");
  const id = (await cached(page)).project.id;
  await second.getByRole("spinbutton", { name: "Ścianka", exact: true }).fill("5");
  await second.getByRole("spinbutton", { name: "Ścianka", exact: true }).press("Enter");
  await second.getByRole("button", { name: "Zapisz", exact: true }).click();
  await expect(second.getByRole("status")).toContainText("Projekt zmienił się w innej karcie");
  const server = await (await page.request.get(`/api/projects/${id}`)).json();
  expect(server.project.parts[0].params.wall).toBe(4);
  expect(server.version).toBe(2);
});

test("chat rejects a response to an outdated document", async ({ page }) => {
  await newPico(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let received = false;
  await page.route("**/api/chat", async (route) => {
    const response = await route.fetch();
    received = true;
    await gate;
    await route.fulfill({ response });
  });
  await page.getByRole("textbox", { name: "Polecenie projektowania" }).fill("ścianka 3 mm");
  await page.getByRole("button", { name: "Wyślij polecenie" }).click();
  await expect.poll(() => received).toBe(true);
  const wall = page.getByRole("spinbutton", { name: "Ścianka", exact: true });
  await wall.fill("4");
  await wall.press("Enter");
  release();
  await expect(page.locator(".chat-messages")).toContainText("Projekt zmienił się podczas odpowiedzi");
  await expect(wall).toHaveValue("4");
});

test("live chat, CAD worker, save/reopen, STL import and real 3MF download", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await newPico(page);
  await expect(page.getByText("Warsztat połączony", { exact: true })).toBeVisible();
  const title = `Acceptance ${Date.now()}`;
  await page.getByRole("textbox", { name: "Nazwa projektu", exact: true }).fill(title);
  await page.getByRole("textbox", { name: "Nazwa projektu", exact: true }).press("Enter");
  const wall = page.getByRole("spinbutton", { name: "Ścianka", exact: true });
  await wall.fill("3");
  await wall.press("Enter");
  await page.getByRole("textbox", { name: "Polecenie projektowania" }).fill("ustaw ściankę na 3,5 mm");
  await page.getByRole("button", { name: "Wyślij polecenie" }).click();
  await expect(wall).toHaveValue("3.5");
  const previewResponse = page.waitForResponse(async (response) => {
    if (!response.url().includes("/api/jobs/") || response.request().method() !== "GET") return false;
    const body = await response.json();
    return body.kind === "preview" && body.status === "succeeded";
  });
  await page.getByRole("button", { name: "Sprawdź i pokaż CAD" }).click();
  await expect(page.getByText("sprawdzona", { exact: true })).toBeVisible({ timeout: 90_000 });
  await writeFile(testInfo.outputPath("preview.json"), JSON.stringify(await (await previewResponse).json(), null, 2));
  await wall.focus();
  await wall.press("Control+s");
  await expect(page.locator(".status-right")).toContainText("Zapisano");
  const saved = await cached(page);
  await writeFile(testInfo.outputPath("project.forma.json"), JSON.stringify(saved.project, null, 2));
  await page.reload();
  await expect(wall).toHaveValue("3.5");
  await expect(page.locator(".status-right")).toContainText("Zapisano");
  await page.getByRole("button", { name: "Mój warsztat" }).click();
  await page.getByRole("button", { name: "Pokaż projekty zapisane na backendzie" }).click();
  await page.getByRole("button", { name: title, exact: false }).click();
  await expect(wall).toHaveValue("3.5");
  expect((await cached(page)).project.id).toBe(saved.project.id);

  await page.getByRole("button", { name: "Eksportuj", exact: true }).click();
  const singleDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Eksportuj projekt" }).click();
  await expect(page.locator(".success-notice")).toBeVisible({ timeout: 90_000 });
  await (await singleDownload).saveAs(testInfo.outputPath("base.3mf"));
  await page.getByRole("button", { name: "Wybierz wszystkie" }).click();
  const plateDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Eksportuj projekt" }).click();
  await expect(page.locator(".success-notice")).toBeVisible({ timeout: 90_000 });
  await (await plateDownload).saveAs(testInfo.outputPath("plate.3mf"));
  await page.getByRole("button", { name: "Zamknij", exact: true }).click();

  await page.locator('input[type="file"][accept=".stl,.glb"]').setInputFiles({
    name: "broken.stl", mimeType: "model/stl", buffer: Buffer.from("not STL"),
  });
  await expect(page.getByRole("status")).toContainText("Nieprawidłowy STL");
  expect((await cached(page)).project.parts).toHaveLength(7);
  const source = resolve("../../samples/exports/pico-base.stl");
  await page.locator('input[type="file"][accept=".stl,.glb"]').setInputFiles(source);
  await expect(page.getByRole("textbox", { name: "Nazwa części" })).toHaveValue("pico-base.stl");
  await expect(page.getByText("Wczytywanie siatki…")).toHaveCount(0);
  await expect(page.getByText("Plik niedostępny")).toHaveCount(0);
  const mesh = (await cached(page)).project.parts.at(-1);
  const original = await page.request.get(`/api/assets/${mesh.asset_id}/content`);
  expect(await original.body()).toEqual(await readFile(source));
  await page.getByRole("button", { name: "Usuń część", exact: true }).click();
  expect((await cached(page)).project.parts).toHaveLength(7);
  await page.getByRole("button", { name: "Cofnij", exact: true }).click();
  await page.getByRole("button", { name: "pico-base.stl", exact: true }).click();
  await page.getByRole("button", { name: "Eksportuj", exact: true }).click();
  await expect(page.getByText("Importowane siatki nie są objęte eksportem CAD")).toBeVisible();
  await expect(page.getByRole("button", { name: "Eksportuj projekt" })).toBeDisabled();
  await page.keyboard.press("Delete");
  expect((await cached(page)).project.parts).toHaveLength(8);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Zapisz", exact: true }).click();
  await expect(page.locator(".status-right")).toContainText("Zapisano");
  const reloadedMesh = page.waitForResponse((response) => response.url().endsWith(`/api/assets/${mesh.asset_id}/content`));
  await page.reload();
  await expect(page.getByRole("button", { name: "pico-base.stl", exact: true })).toBeVisible();
  await reloadedMesh;
  await expect(page.getByText("Wczytywanie siatki…")).toHaveCount(0);
  await expect(page.getByText("Plik niedostępny")).toHaveCount(0);
  await page.getByRole("button", { name: "Dopasuj widok", exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath("workshop.png") });
  expect(errors).toEqual([]);
});
