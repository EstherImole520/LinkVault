import path from "node:path";

import { expect, test } from "@playwright/test";

const sizes = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
];

const screenshotDir = path.resolve(process.cwd(), "..", "docs", "screenshots");

test("layouts fit every target width and capture screenshots", async ({ page, request }) => {
  const existing = (await (await request.get("/api/bookmarks")).json()) as { id: number }[];
  for (const item of existing) {
    await request.delete(`/api/bookmarks/${item.id}`);
  }

  const samples = [
    {
      title: "FastAPI Documentation",
      url: "https://fastapi.tiangolo.com/tutorial/security/oauth2-jwt/#configure-the-app",
      description:
        "Complete guide to OAuth2 with password hashing and bearer tokens for a production-ready API.",
      category: "Documentation",
      is_favorite: true,
    },
    {
      title: "TypeScript Handbook",
      url: "https://www.typescriptlang.org/docs/handbook/2/everyday-types.html",
      description: "A practical walkthrough of everyday TypeScript types.",
      category: "Learning",
    },
    {
      title: "PostgreSQL Exercises",
      url: "https://pgexercises.com/questions/basic/",
      description: "Interactive SQL practice against a realistic schema.",
      category: "Practice",
    },
    {
      title: "Vite Guide",
      url: "https://vite.dev/guide/",
      description: "Getting started with the Vite build tool.",
      category: "Tools",
    },
  ];

  for (const sample of samples) {
    const response = await request.post("/api/bookmarks", { data: sample });
    expect(response.ok()).toBeTruthy();
  }

  for (const size of sizes) {
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.goto("/");
    await expect(page.getByTestId("bookmark-card")).toHaveCount(samples.length);

    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${size.name} horizontal overflow`).toBeLessThanOrEqual(1);

    await page.screenshot({
      path: path.join(screenshotDir, `dashboard-${size.name}.png`),
      fullPage: true,
    });
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByTestId("add-bookmark").click();
  await expect(page.getByTestId("bookmark-dialog")).toBeVisible();
  await page.screenshot({
    path: path.join(screenshotDir, "add-bookmark-dialog.png"),
  });
});
