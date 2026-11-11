import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (): string => (JSON.parse(readFileSync(path.join(here, ".fixture.json"), "utf8")) as { root: string }).root;

/**
 * Presentations in the browser: the flag hides the tab, settings turn
 * it on, a project's deck is created from its context tab and lands on disk as
 * a folder, the editor shows the slides' renders and saves an edit (the
 * file changes, the warning shows), present mode steps through the slides,
 * the palette finds the deck, and removal moves the folder to the trash.
 */
test.describe("presentations", () => {
  const project = "relaunch-site";
  const deckDir = () => path.join(fixture(), "kraftwerk-data", "projects", project, "presentations", "town-hall");

  test.beforeAll(async ({ request }) => {
    await request.put("/api/settings", { data: { projects: { enabled: true }, presentations: { enabled: false } } });
    await request.post("/api/projects", { data: { title: "Relaunch site", slug: project } });
  });
  test.afterAll(async ({ request }) => {
    await request.delete(`/api/projects/${project}`);
    await request.put("/api/settings", { data: { projects: { enabled: false }, presentations: { enabled: false } } });
  });

  test("the context column and the top navigation have no presentations until settings turn the feature on", async ({ page }) => {
    await page.goto(`/#/projects/${project}`);
    await expect(page.getByRole("tab", { name: /presentations/ })).toHaveCount(0);
    await expect(page.locator(".rail a[href='#/presentations']")).toHaveCount(0);
    await expect(page.locator(".global-nav a", { hasText: "files" })).toBeVisible();
    await expect(page.locator(".global-nav a[href='#/presentations']")).toHaveCount(0);

    await page.goto("/#/settings");
    await page.getByRole("checkbox", { name: /make slide decks/ }).check();
    await page.getByRole("button", { name: "save changes" }).click();
    await expect(page.getByText("saved")).toBeVisible();
    expect(readFileSync(path.join(fixture(), "kraftwerk.yml"), "utf8")).toMatch(/^presentations: \{\}$/m);

    await page.goto(`/#/projects/${project}`);
    // A project's decks are a tab of its context column; the rail has neither a presentations group nor rows under a project.
    await expect(page.locator(".rail a[href='#/presentations']")).toHaveCount(0);
    await expect(page.getByRole("tab", { name: /presentations/ })).toBeVisible();
    await expect(page.locator(".rail [data-nested]")).toHaveCount(0);
    // Expert mode's top navigation gets the page too; simple mode has no top navigation at all.
    await page.locator(".global-nav a[href='#/presentations']").click();
    await expect(page).toHaveURL(/#\/presentations$/);
    await expect(page.locator(".global-nav a[href='#/presentations']")).toHaveAttribute("aria-current", "page");
  });

  test("a deck is created from the project's presentations tab and is a folder; the editor shows its slides", async ({ page }) => {
    await page.goto(`/#/projects/${project}`);
    await page.getByRole("tab", { name: /presentations/ }).click();
    await expect(page.locator(".ctx").getByText("No presentations linked.")).toBeVisible();
    await page.locator(".ctx").getByRole("link", { name: "new presentation" }).click();
    await expect(page).toHaveURL(new RegExp(`#/projects/${project}/presentations/new$`));
    await page.getByRole("textbox", { name: "presentation title" }).fill("Town hall");
    await page.getByRole("button", { name: "create presentation" }).click();
    await expect(page).toHaveURL(new RegExp(`#/projects/${project}/presentations/town-hall$`));
    expect(existsSync(path.join(deckDir(), "deck.md"))).toBe(true);
    expect(readFileSync(path.join(deckDir(), "deck.md"), "utf8")).toMatch(/^title: Town hall$/m);
    const thumbs = page.getByRole("list", { name: "slides" }).getByRole("listitem");
    await expect(thumbs).toHaveCount(2);
    // The slide is live HTML in the theme: its title is text on the page, not a picture of it.
    const stage = page.getByRole("group", { name: "slide" });
    await expect(stage.locator(".deck-slide.deck-theme-default.layout-title [data-slot='title']")).toHaveText("Town hall");
    await expect(page.getByText("no warnings on this slide")).toBeVisible();
  });

  test("on the slide: type in place, format, move with undo, insert a text box and a theme piece, switch the theme; present mode steps through", async ({ page }) => {
    // A workspace theme beside the built-in one, for the design panel.
    const theme = path.join(fixture(), "kraftwerk-data", "presentations", "templates", "brand");
    mkdirSync(theme, { recursive: true });
    writeFileSync(path.join(theme, "template.yml"), "name: Brand\ncolors: { accent: '#AA0000' }\nlayouts:\n  title:\n    slots:\n      title: { kind: text, x: 0.5, y: 2, w: 9, h: 1.5, size: 44, required: true }\n      subtitle: { kind: text, x: 0.5, y: 3.6, w: 9, h: 0.6, size: 16 }\n  content:\n    slots:\n      title: { kind: text, x: 0.5, y: 0.3, w: 9, h: 0.8, size: 28 }\n      body: { kind: markdown, x: 0.5, y: 1.2, w: 9, h: 4 }\n");
    writeFileSync(path.join(theme, "theme.css"), ".slot-title { text-transform: uppercase; }\n");

    await page.goto(`/#/projects/${project}/presentations/town-hall`);
    const stage = page.getByRole("group", { name: "slide" });
    const slot = (n: string) => stage.locator(`.deck-slot[data-slot='${n}']`);
    const deck = () => readFileSync(path.join(deckDir(), "deck.md"), "utf8");

    // A double click types into the title where it stands; the heading of slide 1 changes.
    await slot("title").dblclick();
    const field = page.getByRole("textbox", { name: "title on the slide" });
    await expect(field).toHaveText("Town hall");
    await field.press("ControlOrMeta+a");
    await page.keyboard.type("Town hall 2026");
    await field.press("ControlOrMeta+Enter");
    await expect.poll(deck).toMatch(/^# Town hall 2026$/m);
    await expect(slot("title")).toHaveText("Town hall 2026");

    // Selected, its bar changes the look for this slide only.
    await slot("title").click();
    await page.getByRole("toolbar", { name: "title format" }).getByRole("button", { name: "larger" }).click();
    await expect.poll(deck).toMatch(/^slots:\n  title:\n    size: 54$/m);

    // Dragged, it moves at once and is written as the slide's own position; ⌘Z puts it back.
    const before = (await slot("title").boundingBox())!;
    await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
    await page.mouse.down();
    await page.mouse.move(before.x + before.width / 2 + 60, before.y + before.height / 2 + 120, { steps: 6 });
    await page.mouse.up();
    const after = (await slot("title").boundingBox())!;
    expect(after.y - before.y).toBeGreaterThan(80);
    await expect.poll(deck).toMatch(/^  title:\n    size: 54\n    x: [\d.]+\n    y: [\d.]+$/m);
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(deck).toMatch(/^slots:\n  title:\n    size: 54\n---$/m);

    // A new text box is a slot of the slide's own, typed as it looks.
    await page.getByRole("button", { name: "text", exact: true }).click();
    const box = page.getByRole("textbox", { name: "text1 on the slide" });
    await box.press("ControlOrMeta+a");
    await page.keyboard.type("A free ");
    await page.keyboard.press("ControlOrMeta+b");
    await page.keyboard.type("note");
    await box.press("ControlOrMeta+Enter");
    await expect.poll(deck).toMatch(/::text1::\nA free \*\*note\*\*/);
    await expect.poll(deck).toMatch(/^  text1:\n    kind: markdown$/m);

    // A piece of the theme (HTML) lands as an html slot; its source opens beside the slide and the slide follows it.
    await page.getByRole("button", { name: "more", exact: true }).click();
    await page.getByRole("menu", { name: "insert" }).getByRole("menuitem", { name: /Key figures/ }).click();
    await expect(slot("keyfigures1").locator(".kpi")).toHaveCount(3);
    await expect.poll(deck).toMatch(/::keyfigures1::\n<div class="kpis">/);
    await slot("keyfigures1").dblclick();
    const src = page.getByRole("textbox", { name: "keyfigures1 source text" });
    await src.fill('<div class="kpis"><div class="kpi"><strong>42</strong><span>answers</span></div></div>');
    await expect(slot("keyfigures1").locator(".kpi strong")).toHaveText("42");
    await expect.poll(deck).toMatch(/<strong>42<\/strong>/);
    await page.getByRole("button", { name: "close source" }).click();

    // The design panel switches the theme; the slide takes it at once.
    await page.getByRole("button", { name: "design" }).click();
    await page.reload();
    await page.getByRole("button", { name: "design" }).click();
    await page.getByRole("button", { name: "theme Brand" }).click();
    await expect(stage.locator(".deck-slide.deck-theme-brand")).toBeVisible();
    await expect.poll(deck).toMatch(/^template: brand$/m);
    await page.getByRole("button", { name: "theme Default" }).click();
    await expect.poll(deck).toMatch(/^template: default$/m);

    // Slide 2: its markdown beside it; a missing picture is a warning.
    const thumbs = page.getByRole("list", { name: "slides" }).getByRole("listitem");
    await thumbs.nth(1).getByRole("button", { name: "slide 2" }).click();
    await page.getByRole("combobox", { name: "layout" }).selectOption("image");
    await page.getByRole("button", { name: "markdown", exact: true }).click();
    await page.getByRole("textbox", { name: "slide content" }).fill("# Picture\n\n::image::\n![x](assets/nope.png)");
    await expect.poll(deck).toMatch(/layout: image\n---\n# Picture\n\n::image::\n!\[x\]\(assets\/nope\.png\)/);
    await expect(page.getByRole("list", { name: "warnings" })).toContainText("image not found: assets/nope.png");

    await page.getByRole("link", { name: "present", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`#/projects/${project}/presentations/town-hall/present$`));
    const region = page.getByRole("region", { name: "presentation" });
    await expect(region.getByRole("img", { name: "slide 1 of 2" })).toBeVisible();
    await page.keyboard.press("ArrowRight");
    await expect(region.getByRole("img", { name: "slide 2 of 2" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(new RegExp(`#/projects/${project}/presentations/town-hall$`));
  });

  test("like ChatGPT's editor: several boxes at once, right click, the format panel, shapes, hidden slides, the grid, presenter view and the docked agent chat", async ({ page }) => {
    await page.goto(`/#/projects/${project}/presentations/town-hall`);
    const stage = page.getByRole("group", { name: "slide" });
    const slot = (n: string) => stage.locator(`.deck-slot[data-slot='${n}']`);
    const deck = () => readFileSync(path.join(deckDir(), "deck.md"), "utf8");
    const thumbs = page.getByRole("list", { name: "slides" }).getByRole("listitem");
    await thumbs.nth(0).getByRole("button", { name: /^slide 1/ }).click();

    // The key figures from the last test lie over the others: Delete takes a selected box away.
    await slot("keyfigures1").click({ position: { x: 10, y: 10 } });
    await page.keyboard.press("Delete");
    await expect(slot("keyfigures1")).toHaveCount(0);
    await expect(thumbs).toHaveCount(2);
    await expect.poll(deck).not.toMatch(/keyfigures1/);

    // ⇧-click adds to the selection; aligning several lines them up with each other.
    await slot("title").click({ position: { x: 20, y: 10 } });
    await slot("text1").click({ modifiers: ["Shift"] });
    const bar = page.getByRole("toolbar", { name: "selection" });
    await expect(bar).toContainText("2 boxes");
    await bar.getByRole("button", { name: "align left" }).click();
    await expect.poll(deck).toMatch(/^  text1:\n(    .*\n)*    x: 0\.44$/m);

    // Right click: the layer order is the slide's own.
    await slot("text1").click({ button: "right" });
    await page.getByRole("menu", { name: "box" }).getByRole("menuitem", { name: /Bring to front/ }).click();
    await expect.poll(deck).toMatch(/^  text1:\n(    .*\n)*    z: \d+$/m);

    // The format panel: rotation, corners, a fill, a shadow — the box shows them at once.
    await slot("text1").click();
    await page.getByRole("toolbar", { name: "text1 format" }).getByRole("button", { name: "format" }).click();
    const panel = page.getByRole("region", { name: "format" });
    await panel.getByRole("spinbutton", { name: "°" }).fill("12");
    await panel.getByRole("button", { name: "fill accent" }).click();
    await panel.getByRole("checkbox", { name: "shadow" }).check();
    await expect(slot("text1")).toHaveCSS("transform", /matrix\(0\.97/);
    await expect.poll(deck).toMatch(/^    rotate: 12$/m);
    await expect.poll(deck).toMatch(/^    fill: accent$/m);
    await expect.poll(deck).toMatch(/^    shadow: true$/m);
    // ⌘C ⌘V: a copy lands beside it as a box of its own.
    await page.keyboard.press("Escape");
    await slot("text1").click();
    await page.keyboard.press("ControlOrMeta+c");
    await page.keyboard.press("ControlOrMeta+v");
    await expect(slot("text2")).toHaveText("A free note");
    await expect.poll(deck).toMatch(/::text2::\nA free \*\*note\*\*/);
    await page.keyboard.press("Delete");
    await expect(slot("text2")).toHaveCount(0);

    // Shapes are boxes too.
    await page.getByRole("button", { name: "shapes", exact: true }).click();
    await page.getByRole("menu", { name: "shapes" }).getByRole("menuitem", { name: "Circle" }).click();
    await expect(slot("circle1")).toHaveCSS("border-radius", /px/);
    await expect.poll(deck).toMatch(/^  circle1:\n    kind: html/m);

    // A hidden slide stays in the deck, out of the grid's count of shown slides and out of present mode.
    await thumbs.nth(1).click({ button: "right" });
    await page.getByRole("menu", { name: "slide actions" }).getByRole("menuitem", { name: /Hide/ }).click();
    await expect.poll(deck).toMatch(/^hidden: true$/m);
    await page.getByRole("button", { name: "grid view" }).click();
    await expect(page.getByRole("list", { name: "all slides" }).getByRole("listitem")).toHaveCount(2);
    await expect(page.getByRole("list", { name: "all slides" })).toContainText("hidden");
    await page.getByRole("button", { name: "grid view" }).click();

    // Presenter view: the slide, what comes next, the notes, a clock; the hidden slide is not among them.
    await page.goto(`/#/projects/${project}/presentations/town-hall/presenter/1`);
    const presenter = page.getByRole("region", { name: "presenter view" });
    await expect(presenter.getByRole("img", { name: "slide 1 of 1" })).toBeVisible();
    await expect(presenter).toContainText("the end");
    await expect(presenter.getByLabel("elapsed time")).toHaveText(/^\d\d:\d\d$/);
    await page.keyboard.press("Escape");

    // Showing it again, then the agent beside the deck: the request opens the docked chat with the deck and the slide named.
    await thumbs.nth(1).click({ button: "right" });
    await page.getByRole("menu", { name: "slide actions" }).getByRole("menuitem", { name: /Show/ }).click();
    await expect.poll(deck).not.toMatch(/^hidden: true$/m);
    await page.getByRole("textbox", { name: "ask an agent" }).fill("tighten the title");
    await page.getByRole("button", { name: "send to an agent" }).click();
    const chat = page.getByRole("region", { name: "agent chat" });
    await expect(chat).toBeVisible();
    await expect(chat).toContainText("tighten the title");
    await expect(chat).toContainText('presentation "Town hall"');
  });

  test("review and sharing: comments on a box with a pin, answered and resolved; a link to share; an edit made elsewhere merges with the one made here", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto(`/#/projects/${project}/presentations/town-hall`);
    const stage = page.getByRole("group", { name: "slide" });
    const slot = (n: string) => stage.locator(`.deck-slot[data-slot='${n}']`);
    const deck = () => readFileSync(path.join(deckDir(), "deck.md"), "utf8");
    const thumbs = page.getByRole("list", { name: "slides" }).getByRole("listitem");
    await thumbs.nth(0).getByRole("button", { name: /^slide 1/ }).click();

    // Right click → Comment…: a comment on the box, a pin on it, a count on the slide and the bar.
    await slot("text1").click({ button: "right" });
    await page.getByRole("menu", { name: "box" }).getByRole("menuitem", { name: /Comment/ }).click();
    const panel = page.getByRole("region", { name: "comments" });
    await expect(panel).toContainText("box text1");
    await panel.getByRole("textbox", { name: "new comment" }).fill("Say who the note is for");
    await panel.getByRole("button", { name: "comment", exact: true }).click();
    await expect(panel.getByRole("list", { name: "comment list" })).toContainText("Say who the note is for");
    await expect(stage.getByRole("button", { name: "1 comment on text1" })).toBeVisible();
    await expect(page.getByRole("button", { name: "comments", exact: true })).toContainText("1");
    expect(readFileSync(path.join(deckDir(), "comments.json"), "utf8")).toMatch(/"slot": "text1"/);
    await expect.poll(deck).toMatch(/^id: s\w+$/m);

    // Answered and resolved: the pin goes, the count goes.
    const item = panel.getByRole("listitem").first();
    await item.getByRole("textbox", { name: /^reply to/ }).fill("For the editors");
    await item.getByRole("textbox", { name: /^reply to/ }).press("Enter");
    await expect(item).toContainText("For the editors");
    await item.getByRole("button", { name: "resolve" }).click();
    await expect(stage.getByRole("button", { name: /comment on text1/ })).toHaveCount(0);
    expect(readFileSync(path.join(deckDir(), "comments.json"), "utf8")).toMatch(/"resolved": true/);
    await panel.getByRole("button", { name: "close comments" }).click();

    // Share: the link to present mode lands on the clipboard.
    await page.getByRole("button", { name: "share" }).click();
    await page.getByRole("menu", { name: "share" }).getByRole("menuitem", { name: /present mode/ }).click();
    await expect(page.getByRole("status")).toContainText(`#/projects/${project}/presentations/town-hall/present`);
    expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/presentations\/town-hall\/present$/);

    // An agent (here: the file written directly) changes slide 2 while slide 1 is edited here: both changes stay.
    const before = deck();
    writeFileSync(path.join(deckDir(), "deck.md"), before.replace("# Picture", "# Picture from elsewhere"));
    await slot("text1").click();
    await page.getByRole("toolbar", { name: "text1 format" }).getByRole("button", { name: "larger" }).click();
    await expect.poll(deck).toMatch(/# Picture from elsewhere/);
    await expect.poll(deck).toMatch(/^  text1:\n(    .*\n)*    size: 19$/m);
    await expect(thumbs.nth(1)).toBeVisible();
  });

  test("two editors on one deck see each other: an avatar in the bar, a dot on the slide, their box outlined with their name; gone when they close", async ({ page, context }) => {
    await page.goto(`/#/projects/${project}/presentations/town-hall`);
    const other = await context.newPage();
    await other.goto(`/#/projects/${project}/presentations/town-hall`);
    const here = page.getByRole("group", { name: "also here" });
    await expect(here.getByRole("button")).toHaveCount(1);
    await expect(other.getByRole("group", { name: "also here" }).getByRole("button")).toHaveCount(1);

    // The other tab goes to slide 2 and selects a box: this tab sees where.
    await other.getByRole("list", { name: "slides" }).getByRole("listitem").nth(1).getByRole("button", { name: /^slide 2/ }).click();
    await expect(here.getByRole("button", { name: /on slide 2$/ })).toBeVisible();
    await expect(page.getByRole("list", { name: "slides" }).getByRole("listitem").nth(1).getByLabel(/ here$/)).toBeVisible();
    const box = other.getByRole("group", { name: "slide" }).locator(".deck-slot").first();
    const slot = await box.getAttribute("data-slot");
    await box.click();
    await here.getByRole("button", { name: /on slide 2$/ }).click();
    await expect(page.getByRole("group", { name: "slide" }).getByRole("note", { name: new RegExp(`is on ${slot}$`) })).toBeVisible();

    await other.close();
    await expect(here).toHaveCount(0);
  });

  test("like ChatGPT, a deck starts from a brief (typed or from a notes file) that goes to an agent beside it; a box has one-click requests", async ({ page }) => {
    await page.goto(`/#/projects/${project}/presentations/new`);
    await page.getByRole("textbox", { name: "brief" }).fill("Quarterly update for the board: revenue up 12 %, two new customers, hiring paused.");
    await page.getByLabel("notes files").setInputFiles({ name: "q3-notes.md", mimeType: "text/markdown", buffer: Buffer.from("# Q3\n- churn 2 %\n") });
    await expect(page.getByRole("textbox", { name: "brief" })).toHaveValue(/--- q3-notes.md ---\n# Q3\n- churn 2 %/);
    await expect(page.getByRole("textbox", { name: "presentation title" })).toHaveValue("q3 notes");
    await page.getByRole("textbox", { name: "presentation title" }).fill("Board update");
    await page.getByRole("button", { name: "create with an agent" }).click();
    await expect(page).toHaveURL(new RegExp(`#/projects/${project}/presentations/board-update$`));
    const chat = page.getByRole("region", { name: "agent chat" });
    await expect(chat).toContainText("Build this presentation from my brief");
    await expect(chat).toContainText("revenue up 12 %");
    await expect(chat).toContainText("churn 2 %");
    // A reload does not send the brief again: the same chat, opened from the bar, has it once.
    await page.reload();
    await page.getByRole("button", { name: "chat", exact: true }).click();
    await expect(chat).toContainText("revenue up 12 %");
    await expect(chat.getByText("Build this presentation from my brief")).toHaveCount(1);

    // The (fake) agent asks once per turn; allowing it ends the turn.
    await chat.getByRole("button", { name: "Allow", exact: true }).click();
    await expect(chat.getByText("is waiting for you")).toHaveCount(0);
    // One click on a box: "Shorten" goes to the same agent with the box and the slide named.
    const title = page.getByRole("group", { name: "slide" }).locator(".deck-slot[data-slot='title']");
    await title.click();
    await page.getByRole("toolbar", { name: "title format" }).getByRole("button", { name: "ask an agent about this box" }).click();
    await page.getByRole("menu", { name: "ask an agent" }).getByRole("menuitem", { name: "Shorten" }).click();
    await expect(chat).toContainText('In the box "title" on slide 1: Shorten it to the essentials');
  });

  test("a chart's data is a grid: change a value, rename a category, add a series and switch the kind; the slide and deck.md follow", async ({ page }) => {
    await page.goto(`/#/projects/${project}/presentations/town-hall`);
    const deck = () => readFileSync(path.join(deckDir(), "deck.md"), "utf8");
    await page.getByRole("button", { name: "chart", exact: true }).click();
    const grid = page.getByRole("group", { name: "chart data" });
    await expect(grid).toBeVisible();
    await grid.getByRole("textbox", { name: "Series 1 · B" }).fill("9");
    await grid.getByRole("textbox", { name: "category 1" }).fill("Week 1");
    await grid.getByRole("button", { name: "add series" }).click();
    await grid.getByRole("textbox", { name: "series 2 name" }).fill("Plan");
    await grid.getByRole("button", { name: "add row" }).click();
    await grid.getByRole("combobox", { name: "chart kind" }).selectOption("line");
    await expect.poll(deck).toMatch(/kind: line\ntitle: Chart title\ncategories: \[Week 1, B, C, Item 4\]\nseries:\n  - name: Series 1\n    values: \[3, 9, 4, 0\]\n  - name: Plan\n    values: \[0, 0, 0, 0\]/);
    // The slide draws it: a line chart has polylines.
    await expect(page.getByRole("group", { name: "slide" }).locator(".deck-slot.kind-chart svg polyline")).toHaveCount(2);
    // The source tab shows the same block; edited there, the grid reads it again.
    await page.getByRole("tab", { name: "source" }).click();
    const src = page.getByRole("textbox", { name: /source text$/ });
    await expect(src).toHaveValue(/values: \[3, 9, 4, 0\]/);
    await src.fill((await src.inputValue()).replace("values: [3, 9, 4, 0]", "values: [3, 9, 4, 7]"));
    await page.getByRole("tab", { name: "data" }).click();
    await expect(grid.getByRole("textbox", { name: "Series 1 · Item 4" })).toHaveValue("7");
  });

  test("version history: an agent's rewrite keeps the version before it; restoring it is an edit ⌘Z takes back", async ({ page }) => {
    await page.goto(`/#/projects/${project}/presentations/town-hall`);
    const deck = () => readFileSync(path.join(deckDir(), "deck.md"), "utf8");
    const thumbs = page.getByRole("list", { name: "slides" }).getByRole("listitem");
    await expect(thumbs.first()).toBeVisible();
    const before = deck();
    const count = await thumbs.count();
    // An agent replaces the whole deck while it is open.
    writeFileSync(path.join(deckDir(), "deck.md"), "---\ntitle: Town hall\n---\n# Rewritten by an agent\n");
    await expect(thumbs).toHaveCount(1);

    await page.getByRole("button", { name: "version history" }).click();
    const panel = page.getByRole("region", { name: "version history" });
    const versions = panel.getByRole("list", { name: "versions" }).getByRole("listitem");
    await expect(versions.first()).toBeVisible();
    await versions.first().getByRole("button").first().click();
    await expect(panel.getByLabel("slides of this version").locator("> div")).toHaveCount(count);
    await panel.getByRole("button", { name: "restore this version" }).click();
    await expect(thumbs).toHaveCount(count);
    await expect(page.getByRole("status")).toContainText("Restored the version");
    await expect.poll(deck).not.toMatch(/Rewritten by an agent/);
    expect(deck().split("\n---\n").length).toBe(before.split("\n---\n").length);

    // ⌘Z: the agent's version again.
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("ControlOrMeta+z");
    await expect(thumbs).toHaveCount(1);
    await expect.poll(deck).toMatch(/Rewritten by an agent/);
    // Back to the full deck for the tests after this one.
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect.poll(deck).not.toMatch(/Rewritten by an agent/);
  });

  test("a slide's transition is set in the format panel and plays in present mode", async ({ page }) => {
    await page.goto(`/#/projects/${project}/presentations/town-hall`);
    const deck = () => readFileSync(path.join(deckDir(), "deck.md"), "utf8");
    await page.getByRole("list", { name: "slides" }).getByRole("listitem").first().getByRole("button", { name: /^slide 1/ }).click();
    await page.getByRole("button", { name: "format", exact: true }).click();
    await page.getByRole("region", { name: "format" }).getByRole("combobox", { name: "transition" }).selectOption("zoom");
    await expect.poll(deck).toMatch(/^transition: zoom$/m);
    await page.goto(`/#/projects/${project}/presentations/town-hall/present`);
    await expect(page.getByRole("region", { name: "presentation" }).locator("[data-transition='zoom']")).toBeVisible();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("region", { name: "presentation" }).locator("[data-transition='fade']")).toBeVisible();
    await page.keyboard.press("Escape");
  });

  test("slide numbers: off on one slide or for the whole deck from the format panel; present mode follows", async ({ page }) => {
    await page.goto(`/#/projects/${project}/presentations/town-hall`);
    const deck = () => readFileSync(path.join(deckDir(), "deck.md"), "utf8");
    await page.getByRole("list", { name: "slides" }).getByRole("listitem").nth(1).getByRole("button", { name: /^slide 2/ }).click();
    await page.getByRole("button", { name: "format", exact: true }).click();
    const format = page.getByRole("region", { name: "format" });
    const slide = page.getByRole("group", { name: "slide" }).locator(".deck-slide");
    await expect(slide).toHaveAttribute("data-nn", "02");

    await format.getByRole("checkbox", { name: "number on this slide" }).uncheck();
    await expect.poll(deck).toMatch(/^number: false$/m);
    await expect(slide).not.toHaveAttribute("data-nn", /./);
    await format.getByRole("checkbox", { name: "number on this slide" }).check();
    await expect.poll(deck).not.toMatch(/^number: false$/m);
    await expect(slide).toHaveAttribute("data-nn", "02");

    await format.getByRole("checkbox", { name: "slide numbers" }).uncheck();
    await expect.poll(deck).toMatch(/^numbers: false$/m);
    await expect(slide).not.toHaveAttribute("data-nn", /./);
    await expect(format.getByRole("checkbox", { name: "number on this slide" })).toBeDisabled();
    await page.goto(`/#/projects/${project}/presentations/town-hall/present/2`);
    await expect(page.getByRole("region", { name: "presentation" }).locator(".deck-slide")).toBeVisible();
    await expect(page.getByRole("region", { name: "presentation" }).locator(".deck-slide[data-nn]")).toHaveCount(0);
    await page.keyboard.press("Escape");

    await page.goto(`/#/projects/${project}/presentations/town-hall`);
    await page.getByRole("button", { name: "format", exact: true }).click();
    await page.getByRole("region", { name: "format" }).getByRole("checkbox", { name: "slide numbers" }).check();
    await expect.poll(deck).not.toMatch(/^numbers:/m);
  });

  test("a deck is linked from a task (its links) and named in a chat (presentation:…); the deck's share menu lists the task", async ({ page, request }) => {
    await request.put("/api/settings", { data: { boards: { enabled: true } } });
    await request.post("/api/boards/default", { data: { project } });
    const task = (await (await request.post(`/api/boards/tasks/tasks?project=${project}`, { data: { title: "Rehearse the town hall" } })).json()) as { slug: string };
    let chat = "";
    try {
      await page.goto(`/#/projects/${project}/boards/tasks/${task.slug}`);
      const links = page.getByRole("list", { name: "links" });
      await page.getByRole("combobox", { name: "link a presentation" }).selectOption("presentation:town-hall");
      await expect(links.getByRole("link", { name: /Town hall/ })).toBeVisible();
      const taskMd = path.join(fixture(), "kraftwerk-data", "projects", project, "boards", "tasks", "tasks", task.slug, "task.md");
      await expect.poll(() => readFileSync(taskMd, "utf8")).toMatch(/refs:\n\s+- presentation:town-hall/);

      // The deck knows who links it: its share menu lists the task and opens it.
      await links.getByRole("link", { name: /Town hall/ }).click();
      await expect(page).toHaveURL(new RegExp(`#/projects/${project}/presentations/town-hall$`));
      await page.getByRole("button", { name: "share" }).click();
      await page.getByRole("menu", { name: "share" }).getByRole("menuitem", { name: /Rehearse the town hall/ }).click();
      await expect(page).toHaveURL(new RegExp(`#/projects/${project}/boards/tasks/${task.slug}$`));
      await page.getByRole("button", { name: "unlink presentation:town-hall" }).click();
      await expect.poll(() => readFileSync(taskMd, "utf8")).not.toMatch(/presentation:town-hall/);

      // In a chat: "presentation:" offers the decks; the sent token links to the deck (a project's deck opens where it lives).
      chat = ((await (await request.post("/api/chats", { data: { agent: "claude", scope: { kind: "general" } } })).json()) as { id: string }).id;
      await page.goto(`/#/agents/chats/${chat}`);
      const box = page.locator(".composer textarea");
      await box.fill("Look at presentation:tow");
      await page.locator(".skill-menu button", { hasText: "presentation:town-hall" }).click();
      await expect(box).toHaveValue("Look at presentation:town-hall ");
      await page.goto("/#/presentations/town-hall");
      await expect(page).toHaveURL(new RegExp(`#/projects/${project}/presentations/town-hall$`));
    } finally {
      // A chat left behind would make #/agents/chats open it instead of "new chat" in the specs after this one.
      if (chat) await request.delete(`/api/chats/${chat}`);
      await request.delete(`/api/boards/tasks/tasks/${task.slug}?project=${project}`);
      await request.put("/api/settings", { data: { boards: { enabled: false } } });
    }
  });

  test("the palette finds the deck and opens it", async ({ page }) => {
    await page.goto("/#/");
    await page.keyboard.press("ControlOrMeta+k");
    const dialog = page.getByRole("dialog", { name: /jump to/ });
    await page.getByRole("textbox", { name: "search" }).fill("town hall");
    await expect(dialog.getByRole("option")).toHaveCount(1);
    await expect(dialog.getByRole("option")).toContainText("presentation");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`#/projects/${project}/presentations/town-hall`));
  });

  test("remove moves the deck folder to the trash", async ({ page }) => {
    await page.goto(`/#/projects/${project}/presentations/town-hall`);
    await page.getByRole("button", { name: "remove presentation" }).click();
    await page.getByRole("button", { name: "move to trash" }).click();
    await expect(page).toHaveURL(new RegExp(`#/projects/${project}/presentations$`));
    await expect.poll(() => existsSync(deckDir())).toBe(false);
    expect(existsSync(path.join(fixture(), "kraftwerk-data", "trash", "presentations", project, "town-hall", "deck.md"))).toBe(true);
  });
});
