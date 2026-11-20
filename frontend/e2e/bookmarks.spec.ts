import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const bookmark = (overrides: Record<string, unknown> = {}) => ({
  title: "Example bookmark",
  url: "https://example.com",
  description: "A useful link",
  category: "Reference",
  ...overrides,
});

async function resetBookmarks(request: APIRequestContext): Promise<void> {
  const response = await request.get("/api/bookmarks");
  const items = (await response.json()) as { id: number }[];
  for (const item of items) {
    await request.delete(`/api/bookmarks/${item.id}`);
  }
}

async function seed(request: APIRequestContext, payload: Record<string, unknown>) {
  const response = await request.post("/api/bookmarks", { data: bookmark(payload) });
  expect(response.ok()).toBeTruthy();
}

async function addViaUi(page: Page, payload: Record<string, string>): Promise<void> {
  await page.getByTestId("add-bookmark").click();
  await page.getByTestId("title-input").fill(payload.title ?? "");
  await page.getByTestId("url-input").fill(payload.url ?? "");
  if (payload.description) {
    await page.getByTestId("description-input").fill(payload.description);
  }
  if (payload.category) {
    await page.getByTestId("category-input").fill(payload.category);
  }
  await page.getByTestId("save-bookmark").click();
}

test.beforeEach(async ({ page, request }) => {
  await resetBookmarks(request);
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("e2e-initialised")) {
      localStorage.removeItem("linkvault-theme");
      sessionStorage.setItem("e2e-initialised", "1");
    }
  });
  await page.goto("/");
});

test("shows the empty state and zero stats", async ({ page }) => {
  await expect(page.getByTestId("empty-state")).toContainText("No bookmarks yet");
  await expect(page.getByTestId("stats-total")).toHaveText("0");
  await expect(page.getByTestId("stats-favorites")).toHaveText("0");
  await expect(page.getByTestId("result-summary")).toHaveText("0 bookmarks");
});

test("adds a bookmark through the dialog", async ({ page }) => {
  await addViaUi(page, {
    title: "Playwright Docs",
    url: "https://playwright.dev/docs/intro",
    description: "Browser automation documentation",
    category: "Documentation",
  });

  await expect(page.getByTestId("toast")).toHaveText("Bookmark added");
  await expect(page.getByTestId("bookmark-card")).toHaveCount(1);
  await expect(page.getByTestId("bookmark-card")).toContainText("Playwright Docs");
  await expect(page.getByTestId("stats-total")).toHaveText("1");
  await expect(page.getByTestId("bookmark-dialog")).not.toBeVisible();

  const link = page.getByRole("link", { name: "Playwright Docs" });
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");
});

test("rejects unsafe URLs before submitting", async ({ page }) => {
  await page.getByTestId("add-bookmark").click();
  await page.getByTestId("title-input").fill("Unsafe link");
  await page.getByTestId("url-input").fill("javascript:alert(1)");
  await page.getByTestId("save-bookmark").click();

  await expect(page.getByText("Enter a valid http:// or https:// URL.")).toBeVisible();
  await expect(page.getByTestId("bookmark-dialog")).toBeVisible();
  await expect(page.getByTestId("bookmark-card")).toHaveCount(0);

  await page.getByTestId("url-input").fill("https://safe.example.com");
  await page.getByTestId("save-bookmark").click();
  await expect(page.getByTestId("bookmark-card")).toHaveCount(1);
});

test("edits an existing bookmark", async ({ page, request }) => {
  await seed(request, { title: "Old title", category: "Reading" });
  await page.reload();

  await page.getByTestId("edit-bookmark").click();
  await expect(page.getByTestId("bookmark-dialog")).toBeVisible();
  await page.getByTestId("title-input").fill("New title");
  await page.getByTestId("category-input").fill("Research");
  await page.getByTestId("save-bookmark").click();

  await expect(page.getByTestId("toast")).toHaveText("Bookmark updated");
  await expect(page.getByTestId("bookmark-card")).toContainText("New title");
  await expect(page.getByTestId("bookmark-card")).toContainText("Research");
});

test("toggles favorites and filters the favorites view", async ({ page, request }) => {
  await seed(request, { title: "Favorite me", category: "Tools" });
  await page.reload();

  await page.getByTestId("favorite-button").click();
  await expect(page.getByTestId("toast")).toHaveText("Added to favorites");
  await expect(page.getByTestId("favorite-button")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("stats-favorites")).toHaveText("1");

  await page.getByTestId("nav-favorites").click();
  await expect(page.getByTestId("bookmark-card")).toHaveCount(1);
  await expect(page.getByTestId("bookmark-card")).toContainText("Favorite me");

  await page.getByTestId("favorite-button").click();
  await expect(page.getByTestId("empty-state")).toContainText("No favorites yet");
  await expect(page.getByTestId("stats-favorites")).toHaveText("0");
});

test("searches, filters by category, and sorts", async ({ page, request }) => {
  await seed(request, { title: "Zebra Guide", url: "https://zebra.example.com", category: "Reading" });
  await seed(request, {
    title: "API Reference",
    url: "https://api.example.com/docs",
    description: "REST endpoints",
    category: "Documentation",
  });
  await seed(request, {
    title: "alpha tutorial",
    url: "https://alpha.example.com/learn",
    description: "Beginner guide",
    category: "Learning",
  });
  await page.reload();
  await expect(page.getByTestId("bookmark-card")).toHaveCount(3);

  await page.getByTestId("search").fill("beginner");
  await expect(page.getByTestId("bookmark-card")).toHaveCount(1);
  await expect(page.getByTestId("bookmark-card")).toContainText("alpha tutorial");

  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.getByTestId("bookmark-card")).toHaveCount(3);

  await page.getByTestId("category-filter").filter({ hasText: "Documentation" }).click();
  await expect(page.getByTestId("bookmark-card")).toHaveCount(1);
  await expect(page.getByTestId("bookmark-card")).toContainText("API Reference");

  await page.getByTestId("category-filter").filter({ hasText: "All categories" }).click();
  await page.getByTestId("sort").selectOption("alpha");
  const titles = await page.locator('[data-testid="bookmark-card"] h3').allTextContents();
  expect(titles).toEqual(["alpha tutorial", "API Reference", "Zebra Guide"]);
});

test("deletes a bookmark after confirmation", async ({ page, request }) => {
  await seed(request, { title: "Temporary link" });
  await page.reload();

  page.on("dialog", (dialog) => void dialog.accept());
  await page.getByTestId("delete-bookmark").click();

  await expect(page.getByTestId("toast")).toHaveText("Bookmark deleted");
  await expect(page.getByTestId("empty-state")).toContainText("No bookmarks yet");
  await expect(page.getByTestId("stats-total")).toHaveText("0");
});

test("switches themes and remembers the choice", async ({ page }) => {
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByTestId("theme-toggle").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByTestId("theme-toggle")).toHaveAttribute("aria-pressed", "true");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("opens the mobile navigation drawer", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId("nav-all")).not.toBeVisible();

  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.getByTestId("nav-all")).toBeVisible();
  await page.getByTestId("nav-favorites").click();
  await expect(page.getByTestId("nav-favorites")).toBeHidden();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Favorites");
});
