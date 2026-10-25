// @ts-check
const { test, expect } = require("@playwright/test");
const { mockApis } = require("./fixtures");

async function examine(page) {
  await page.goto("/");
  await page.getByLabel("Repository to examine").fill("https://github.com/example/demo");
  await page.getByRole("button", { name: "Examine", exact: true }).click();
  await expect(page.locator("#record")).toBeVisible();
}

async function expectNoHorizontalOverflow(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe("examination", () => {
  test("renders the record, lines and prescription", async ({ page }) => {
    await mockApis(page);
    await examine(page);

    await expect(page.locator("#scoreValue")).toHaveText("81");
    await expect(page.locator("#acuityValue")).toHaveText("20/32");
    await expect(page.locator("#patchStrip .patch")).toHaveCount(8);
    await expect(page.locator("#checksGrid .line")).toHaveCount(8);
    await expect(page.locator(".chart-row.is-reached .chart-snellen")).toHaveText("20/32");

    const rx = page.locator("#actionsList .rx-line");
    await expect(rx).toHaveCount(2);
    await expect(rx.first()).toContainText("No hardcoded secrets"); // credentials are prioritised first
    await expect(rx.first()).toContainText("config/settings.py:12");
  });

  test("filters lines by status", async ({ page }) => {
    await mockApis(page);
    await examine(page);
    await page.getByRole("button", { name: "Blocking", exact: true }).click();
    await expect(page.locator("#checksGrid .line")).toHaveCount(1);
    await expect(page.locator("#checksGrid")).toContainText("No hardcoded secrets");
  });

  test("shows a readable error when the URL is rejected", async ({ page }) => {
    await page.route("**/api/report", (route) => route.fulfill({ status: 400, json: { error: "paste a public https://github.com/owner/repository URL" } }));
    await page.goto("/");
    await page.getByLabel("Repository to examine").fill("https://gitlab.com/a/b");
    await page.getByRole("button", { name: "Examine", exact: true }).click();
    await expect(page.locator("#formStatus")).toHaveClass(/is-error/);
    await expect(page.locator("#formStatus")).toContainText("Paste a public");
  });
});

test.describe("inspection slip", () => {
  test("opens with evidence and closes with Escape", async ({ page }) => {
    await mockApis(page);
    await examine(page);
    await page.locator('[data-check-id="secrets"]').click();
    const slip = page.locator("#checkDetail");
    await expect(slip).toBeVisible();
    await expect(slip.getByRole("heading", { name: "No hardcoded secrets" })).toBeVisible();
    await expect(slip).toContainText("config/settings.py:12");
    await page.keyboard.press("Escape");
    await expect(slip).toBeHidden();
  });
});

test.describe("the examiner", () => {
  test("Gemini plan, then a follow-up that sends history and focus", async ({ page }) => {
    const questions = await mockApis(page);
    await examine(page);
    await page.locator('[data-check-id="secrets"]').click();
    await page.getByRole("button", { name: /Ask the examiner about this line/ }).click();

    const panel = page.locator("#assistantPanel");
    await expect(panel).toBeVisible();
    await panel.getByRole("button", { name: "Review & plan" }).click();
    await expect(panel.locator(".answer-steps li")).toHaveCount(2);
    await expect(panel).toContainText("gemini-test");
    expect(questions[0].focus).toBe("secrets");

    await panel.getByRole("button", { name: "How do I purge it from history?" }).click();
    await expect(panel.locator(".entry-a").last()).toContainText("git filter-repo");
    expect(questions[1].question).toBe("How do I purge it from history?");
    expect(questions[1].history.at(-1).text).toContain("Step 2: Load it from the environment");
    await expect(page.locator("#exportWorkflow")).toBeEnabled();
  });

  test("offline mode answers without calling the API", async ({ page }) => {
    const questions = await mockApis(page);
    await examine(page);
    await page.locator("#assistantLauncher").click();
    const panel = page.locator("#assistantPanel");
    await panel.getByRole("radio", { name: "Offline" }).check();
    await panel.getByLabel("Ask the examiner").fill("Build a fix plan");
    await panel.getByRole("button", { name: "Send question" }).click();
    await expect(panel.locator(".entry-a").last()).toContainText("Offline examiner");
    await expect(panel.locator(".answer-steps li")).toHaveCount(2);
    expect(questions).toHaveLength(0);
  });
});

test.describe("case files", () => {
  test("a saved examination reopens from history.html", async ({ page }) => {
    await mockApis(page);
    await examine(page);
    await page.goto("/history.html");
    const row = page.getByRole("link", { name: "example/demo" });
    await expect(row).toBeVisible();
    await row.click();
    await expect(page.locator("#reportView")).toBeVisible();
    await expect(page.locator("#reportRx")).toContainText("No hardcoded secrets");
  });
});

test("unknown paths render the designed 404", async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  const response = await page.goto("/definitely/not/here");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: /out of focus/ })).toBeVisible();
});

for (const theme of ["light", "dark"]) {
  test(`no horizontal overflow in the ${theme} theme`, async ({ page }) => {
    await page.addInitScript((value) => localStorage.setItem("repolens-theme", value), theme);
    await mockApis(page);
    await examine(page);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expectNoHorizontalOverflow(page);
    await page.goto("/history.html");
    await expectNoHorizontalOverflow(page);
  });
}
