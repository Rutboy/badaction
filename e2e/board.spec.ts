import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  expect,
  test,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";

// The flow handles a raw invitation credential before redeem. Never
// persist that URL in Playwright traces, videos or automatic failure captures.
test.use({ trace: "off", video: "off", screenshot: "off" });

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const productScreenshotPath = resolve(
  repositoryRoot,
  "docs/assets/product-board.png",
);
const productMobileScreenshotPath = resolve(
  repositoryRoot,
  "docs/assets/product-board-mobile.png",
);

const boardPathPattern =
  /\/boards\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;

const waitForBoard = async (page: Page, title: string) => {
  await expect(
    page.getByRole("heading", { name: title, level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByRole("status", {
      name: "Состояние синхронизации: Онлайн",
    }),
  ).toBeVisible();
};

const createBoard = async (page: Page, title: string): Promise<string> => {
  await page.goto("/");
  await page.getByLabel("Название ретроспективы").fill(title);
  await page.getByRole("button", { name: "Создать доску" }).click();
  await page.waitForURL(boardPathPattern);
  const match = new URL(page.url()).pathname.match(boardPathPattern);
  if (!match) {
    throw new Error("Created board URL does not contain a canonical UUID");
  }
  await waitForBoard(page, title);
  return match[1];
};

const createInvitation = async (page: Page, maxUses = 1): Promise<string> => {
  const trigger = page.getByRole("button", { name: "Пригласить" });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Управление доской" });
  await dialog.getByLabel("Количество входов").fill(String(maxUses));
  await dialog.getByRole("button", { name: "Создать ссылку" }).click();
  await expect(
    dialog.getByText(
      maxUses === 1 ? "Доступен 1 вход." : `Доступно ${maxUses} входа.`,
    ),
  ).toBeVisible();
  const invitation = dialog.getByLabel("Ссылка показывается только сейчас");
  const value = await invitation.inputValue();
  const invitationIsValid = /\/join#[A-Za-z0-9_-]{43}$/.test(value);
  await invitation.evaluate((element) => {
    (element as HTMLInputElement).value = "";
  });
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  if (!invitationIsValid) {
    throw new Error("Invitation URL does not contain a valid fragment token");
  }
  return value;
};

test("owner can create a shared invitation with a bounded number of entries", async ({
  page,
}) => {
  let boardId: string | null = null;

  try {
    boardId = await createBoard(page, "Ретро с общей ссылкой");
    await createInvitation(page, 2);
    const response = await page.request.get(
      `/api/boards/${boardId}/invitations`,
    );
    expect(response.ok()).toBe(true);
    const payload = (await response.json()) as {
      invitations: Array<{
        active: boolean;
        maxUses: number;
        useCount: number;
      }>;
    };
    expect(payload.invitations[0]).toMatchObject({
      active: true,
      maxUses: 2,
      useCount: 0,
    });
  } finally {
    if (boardId) {
      await page.request.delete(`/api/boards/${boardId}`);
    }
  }
});

const openInvitation = async (page: Page, invitationUrl: string) => {
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded" }),
    page.evaluate((target) => window.location.assign(target), invitationUrl),
  ]);
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            window.location.pathname === "/join" && window.location.hash === "",
        ),
      { message: "Invitation fragment was not cleared after navigation" },
    )
    .toBe(true);
};

const joinBoard = async (
  page: Page,
  invitationUrl: string,
  displayName: string,
  boardTitle: string,
) => {
  await openInvitation(page, invitationUrl);
  await page.getByLabel("Ваше имя").fill(displayName);
  await page.getByRole("button", { name: "Присоединиться" }).click();
  await page.waitForURL(boardPathPattern);
  await waitForBoard(page, boardTitle);
};

const column = (page: Page, title: string): Locator =>
  page.getByRole("region", { name: title, exact: true });

const card = (page: Page, columnTitle: string, text: string): Locator =>
  column(page, columnTitle).getByLabel(`Карточка «${text.slice(0, 80)}»`, {
    exact: true,
  });

const actionItem = (page: Page, text: string): Locator =>
  column(page, "Решения").getByLabel(`Решение «${text.slice(0, 80)}»`, {
    exact: true,
  });

const createCard = async (
  page: Page,
  columnTitle: string,
  text: string,
  author?: string,
) => {
  const targetColumn = column(page, columnTitle);
  await targetColumn
    .getByRole("button", {
      name: `Добавить карточку в колонку «${columnTitle}»`,
    })
    .click();
  const form = targetColumn.getByRole("form", {
    name: `Новая карточка в колонке «${columnTitle}»`,
  });
  const textarea = form.getByLabel("Текст карточки");
  await expect(textarea).toBeFocused();
  await textarea.fill(text);
  if (author) {
    await form.getByRole("button", { name: "Указать автора" }).click();
    await form
      .getByLabel(`Автор карточки в колонке «${columnTitle}»`)
      .fill(author);
  }
  await form.getByRole("button", { name: "Добавить" }).click();
  await expect(card(page, columnTitle, text)).toBeVisible();
  const cancel = form.getByRole("button", { name: "Отмена" });
  if (await cancel.isVisible()) {
    await cancel.click();
  }
  await expect(form).toHaveCount(0);
};

const expectTouchTarget = async (locator: Locator) => {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, "Touch target must have a layout box").not.toBeNull();
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
};

const expectNoPageOverflow = async (page: Page) => {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(
    dimensions.clientWidth + 1,
  );
};

const expectDefaultBoardFits = async (page: Page) => {
  const canvas = page.getByTestId("board-canvas");
  await expect(canvas).toBeVisible();
  const canvasMetrics = await canvas.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(canvasMetrics.scrollWidth).toBeLessThanOrEqual(
    canvasMetrics.clientWidth + 1,
  );

  const canvasBox = await canvas.boundingBox();
  expect(canvasBox, "Board canvas must have a layout box").not.toBeNull();
  for (const title of ["Что прошло хорошо", "Что можно улучшить", "Решения"]) {
    const region = column(page, title);
    await expect(region).toBeVisible();
    const regionBox = await region.boundingBox();
    expect(regionBox, `${title} must have a layout box`).not.toBeNull();
    expect(regionBox?.x ?? 0).toBeGreaterThanOrEqual((canvasBox?.x ?? 0) - 1);
    expect((regionBox?.x ?? 0) + (regionBox?.width ?? 0)).toBeLessThanOrEqual(
      (canvasBox?.x ?? 0) + (canvasBox?.width ?? 0) + 1,
    );
  }
};

const expectBoardCanvasUsesHorizontalScroll = async (page: Page) => {
  await expectNoPageOverflow(page);
  const canvas = page.getByTestId("board-canvas");
  const canvasMetrics = await canvas.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(canvasMetrics.scrollWidth).toBeGreaterThan(canvasMetrics.clientWidth);

  const settledLeftBoundary = await canvas.evaluate(async (element) => {
    const afterNextPaint = () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });

    element.scrollTo({ left: element.scrollWidth });
    await afterNextPaint();
    element.scrollTo({ left: 0 });
    await afterNextPaint();

    return element.scrollLeft;
  });
  expect(settledLeftBoundary).toBeLessThanOrEqual(1);
  const viewport = page.viewportSize();
  const canvasBox = await canvas.boundingBox();
  const firstColumnBox = await column(page, "Что прошло хорошо").boundingBox();
  const secondColumnBox = await column(
    page,
    "Что можно улучшить",
  ).boundingBox();
  expect(viewport, "Viewport must be configured").not.toBeNull();
  expect(canvasBox, "Board canvas must have a layout box").not.toBeNull();
  expect(firstColumnBox, "First column must have a layout box").not.toBeNull();
  expect((firstColumnBox?.x ?? 0) - (canvasBox?.x ?? 0)).toBeGreaterThan(0);
  expect(
    secondColumnBox,
    "Second column must have a layout box",
  ).not.toBeNull();
  expect(firstColumnBox?.width ?? 0).toBeLessThan(viewport?.width ?? 0);
  expect(secondColumnBox?.x ?? Number.POSITIVE_INFINITY).toBeLessThan(
    viewport?.width ?? 0,
  );
};

const openSettingsWithKeyboard = async (page: Page): Promise<Locator> => {
  const overflow = page.getByRole("button", {
    name: "Дополнительные действия",
  });
  await overflow.focus();
  await page.keyboard.press("Enter");
  const settingsItem = page.getByRole("menuitem", { name: "Настройки" });
  await expect(settingsItem).toBeVisible();
  await settingsItem.focus();
  await page.keyboard.press("Enter");

  const dialog = page.getByRole("dialog", { name: "Управление доской" });
  await expect(dialog).toBeVisible();
  await expect
    .poll(() =>
      dialog.evaluate((element) => element.contains(document.activeElement)),
    )
    .toBe(true);
  return dialog;
};

const touchDrag = async (
  context: BrowserContext,
  page: Page,
  source: Locator,
  target: Locator,
) => {
  await source.scrollIntoViewIfNeeded();
  await target.scrollIntoViewIfNeeded();
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  if (!sourceBox || !targetBox) {
    throw new Error("Touch drag source or target is outside the viewport");
  }

  const start = {
    x: sourceBox.x + sourceBox.width / 2,
    y: sourceBox.y + sourceBox.height / 2,
  };
  const end = {
    x: targetBox.x + Math.min(targetBox.width / 2, 120),
    y: targetBox.y + Math.min(targetBox.height / 2, 180),
  };
  const session = await context.newCDPSession(page);
  let touchActive = false;
  try {
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ ...start, id: 1, radiusX: 3, radiusY: 3, force: 1 }],
    });
    touchActive = true;
    await page.waitForTimeout(400);
    for (const progress of [0.25, 0.5, 0.75, 1]) {
      await session.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          {
            x: start.x + (end.x - start.x) * progress,
            y: start.y + (end.y - start.y) * progress,
            id: 1,
            radiusX: 3,
            radiusY: 3,
            force: 1,
          },
        ],
      });
      await page.waitForTimeout(80);
    }
    await session.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    touchActive = false;
  } finally {
    if (touchActive) {
      await session
        .send("Input.dispatchTouchEvent", {
          type: "touchCancel",
          touchPoints: [],
        })
        .catch(() => undefined);
    }
    await session.detach();
  }
};

const mouseDrag = async (page: Page, source: Locator, target: Locator) => {
  await source.scrollIntoViewIfNeeded();
  await target.scrollIntoViewIfNeeded();
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  if (!sourceBox || !targetBox) {
    throw new Error("Pointer drag source or target is outside the viewport");
  }

  const startX = sourceBox.x + sourceBox.width / 2;
  const startY = sourceBox.y + sourceBox.height / 2;
  const endX = targetBox.x + Math.min(targetBox.width / 2, 120);
  const endY = targetBox.y + Math.min(targetBox.height / 2, 180);
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 12, startY + 12, { steps: 3 });
  await page.mouse.move(endX, endY, { steps: 12 });
  await page.mouse.up();
};

const deleteBoard = async (
  context: BrowserContext,
  boardId: string,
  origin: string,
) => {
  const response = await context.request.delete(`/api/boards/${boardId}`, {
    headers: { Origin: origin },
    timeout: 10_000,
  });
  if (![204, 404].includes(response.status())) {
    throw new Error(`Board cleanup failed with ${response.status()}`);
  }
};

const feedbackColumnOrder = (page: Page): Promise<Array<string | null>> =>
  page
    .getByTestId("board-canvas")
    .locator(':scope > li[aria-label^="Колонка «"]')
    .evaluateAll((items) =>
      items.map((item) => item.getAttribute("aria-label")),
    );

test("quick column flow supports desktop, mobile, keyboard and full column management", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const context = page.context();
  const baseURL = test.info().project.use.baseURL as string;
  const origin = new URL(baseURL).origin;
  const boardTitle = "Проверка управления колонками";
  const columnTitle = "Без голосования";
  const renamedColumnTitle = "Без голосования — обновлена";
  let boardId: string | null = null;
  let flowError: unknown = null;

  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    boardId = await createBoard(page, boardTitle);

    const quickColumnTrigger = page.getByRole("button", {
      name: "Добавить колонку",
    });
    await quickColumnTrigger.focus();
    await page.keyboard.press("Enter");
    const quickColumnDialog = page.getByRole("dialog", {
      name: "Добавить колонку",
    });
    const quickColumnTitle = quickColumnDialog.getByLabel("Название");
    await expect(quickColumnTitle).toBeFocused();
    await quickColumnTitle.fill(columnTitle);
    await quickColumnDialog.getByLabel("Лимит голосов").fill("0");
    await quickColumnDialog
      .getByRole("button", { name: "Добавить колонку" })
      .click();
    await expect(quickColumnDialog).toBeHidden();
    await expect(quickColumnTrigger).toBeFocused();

    const zeroVoteColumn = column(page, columnTitle);
    await expect(zeroVoteColumn).toBeVisible();
    await expect(
      zeroVoteColumn.getByText("Голосование выключено", { exact: true }),
    ).toBeVisible();
    await expect(
      zeroVoteColumn.getByRole("button", {
        name: /Проголосовать|Отменить голос/,
      }),
    ).toHaveCount(0);
    const headings = await page
      .getByTestId("board-canvas")
      .locator(":scope > li > section[role=region] h3")
      .allTextContents();
    expect(headings.at(-1)).toBe("Решения");
    expect(headings.at(-2)).toBe(columnTitle);

    const beforeMove = await feedbackColumnOrder(page);
    const columnMoveHandle = zeroVoteColumn.getByRole("button", {
      name: `Переместить колонку «${columnTitle}»`,
    });
    await columnMoveHandle.focus();
    await page.keyboard.press("Space");
    await page.keyboard.press("ArrowLeft");
    const moveResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname.startsWith(
          `/api/boards/${boardId}/columns/`,
        ) &&
        new URL(response.url()).pathname.endsWith("/move"),
      { timeout: 20_000 },
    );
    await page.keyboard.press("Space");
    expect((await moveResponse).ok()).toBe(true);
    const afterMove = await feedbackColumnOrder(page);
    expect(afterMove).not.toEqual(beforeMove);
    await page.reload();
    await waitForBoard(page, boardTitle);
    expect(await feedbackColumnOrder(page)).toEqual(afterMove);

    const columnActionsTrigger = column(page, columnTitle).getByRole("button", {
      name: `Действия с колонкой «${columnTitle}»`,
    });
    await columnActionsTrigger.focus();
    await page.keyboard.press("Enter");
    const configureColumnItem = page.getByRole("menuitem", {
      name: "Настроить колонку",
    });
    await configureColumnItem.focus();
    await page.keyboard.press("Enter");
    const focusedManagementDialog = page.getByRole("dialog", {
      name: "Управление доской",
    });
    const focusedColumnTitleId = await focusedManagementDialog
      .locator('input[id^="column-title-"]')
      .evaluateAll(
        (inputs, expectedTitle) =>
          inputs.find(
            (input) => (input as HTMLInputElement).value === expectedTitle,
          )?.id ?? null,
        columnTitle,
      );
    if (!focusedColumnTitleId) {
      throw new Error("Could not find the context-selected column settings");
    }
    const focusedColumnTitleInput = focusedManagementDialog.locator(
      `#${focusedColumnTitleId}`,
    );
    await expect(focusedColumnTitleInput).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(focusedManagementDialog).toBeHidden();
    await expect(columnActionsTrigger).toBeFocused();

    const overflow = page.getByRole("button", {
      name: "Дополнительные действия",
    });
    await overflow.click();
    await page.getByRole("menuitem", { name: "Управление колонками" }).click();
    const managementDialog = page.getByRole("dialog", {
      name: "Управление доской",
    });
    const columnTitleId = await managementDialog
      .locator('input[id^="column-title-"]')
      .evaluateAll(
        (inputs, expectedTitle) =>
          inputs.find(
            (input) => (input as HTMLInputElement).value === expectedTitle,
          )?.id ?? null,
        columnTitle,
      );
    if (!columnTitleId) {
      throw new Error("Could not find the quick-created column settings");
    }
    const columnTitleInput = managementDialog.locator(`#${columnTitleId}`);
    const columnForm = columnTitleInput.locator("xpath=ancestor::form");
    await columnTitleInput.fill(renamedColumnTitle);
    const saveColumn = columnForm.getByRole("button", { name: "Сохранить" });
    await saveColumn.click();
    await expect(saveColumn).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(managementDialog).toBeHidden();
    await expect(overflow).toBeFocused();
    await expect(column(page, renamedColumnTitle)).toBeAttached();

    await overflow.click();
    await page.getByRole("menuitem", { name: "Управление колонками" }).click();
    const reopenedManagementDialog = page.getByRole("dialog", {
      name: "Управление доской",
    });
    const renamedColumnInput = reopenedManagementDialog.locator(
      `#${columnTitleId}`,
    );
    const renamedColumnForm = renamedColumnInput.locator(
      "xpath=ancestor::form",
    );
    await renamedColumnForm.getByRole("button", { name: "Удалить" }).click();
    const deleteColumnDialog = page.getByRole("dialog", {
      name: "Удалить колонку?",
    });
    await expect(
      deleteColumnDialog.getByText(
        `Колонка «${renamedColumnTitle}» будет удалена.`,
      ),
    ).toBeVisible();
    await deleteColumnDialog
      .getByRole("button", { name: "Удалить колонку" })
      .click();
    await expect(deleteColumnDialog).toBeHidden();
    await expect(renamedColumnInput).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(reopenedManagementDialog).toBeHidden();
    await expect(overflow).toBeFocused();
    await expect(column(page, renamedColumnTitle)).toHaveCount(0);

    await page.setViewportSize({ width: 390, height: 844 });
    await expectNoPageOverflow(page);
    const toolbarInsets = await page
      .getByTestId("board-toolbar")
      .evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          top: Number.parseFloat(style.paddingTop),
          right: Number.parseFloat(style.paddingRight),
          left: Number.parseFloat(style.paddingLeft),
        };
      });
    expect(toolbarInsets.top).toBeGreaterThanOrEqual(8);
    expect(toolbarInsets.right).toBeGreaterThanOrEqual(16);
    expect(toolbarInsets.left).toBeGreaterThanOrEqual(16);
    const canvasInsets = await page
      .getByTestId("board-canvas")
      .evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          right: Number.parseFloat(style.paddingRight),
          bottom: Number.parseFloat(style.paddingBottom),
          left: Number.parseFloat(style.paddingLeft),
        };
      });
    expect(canvasInsets.right).toBeGreaterThanOrEqual(16);
    expect(canvasInsets.bottom).toBeGreaterThanOrEqual(12);
    expect(canvasInsets.left).toBeGreaterThanOrEqual(16);

    await expect(quickColumnTrigger).toBeHidden();
    await overflow.click();
    const mobileQuickColumnItem = page.getByRole("menuitem", {
      name: "Добавить колонку",
    });
    await expectTouchTarget(mobileQuickColumnItem);
    await mobileQuickColumnItem.focus();
    await page.keyboard.press("Enter");
    await expect(quickColumnTitle).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(quickColumnDialog).toBeHidden();
    await expect(overflow).toBeFocused();
  } catch (error) {
    flowError = error;
    throw error;
  } finally {
    if (boardId) {
      try {
        await deleteBoard(context, boardId, origin);
      } catch (cleanupError) {
        if (!flowError) {
          throw cleanupError;
        }
        console.error("Board cleanup also failed after the column E2E error");
      }
    }
  }
});

test("board modes, vote reset, action items and exports remain available through the redesigned UI", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const context = page.context();
  const baseURL = test.info().project.use.baseURL as string;
  const origin = new URL(baseURL).origin;
  const boardTitle = "Проверка режимов и решений";
  const sourceCardText = "Превратить наблюдение в решение";
  const copiedActionText = "Превратить наблюдение в решение";
  const editedActionText = "Превратить наблюдение в проверяемое решение";
  const manualActionText = "Второе решение для изменения порядка";
  let boardId: string | null = null;
  let flowError: unknown = null;

  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    boardId = await createBoard(page, boardTitle);
    await createCard(page, "Что прошло хорошо", sourceCardText, "Владелец");

    const sourceCard = card(page, "Что прошло хорошо", sourceCardText);
    const voteButton = sourceCard.getByRole("button", {
      name: `Проголосовать за карточку «${sourceCardText}»`,
    });
    await voteButton.click();
    await expect(
      sourceCard.getByRole("button", {
        name: `Отменить голос за карточку «${sourceCardText}»`,
      }),
    ).toHaveAttribute("aria-pressed", "true");

    const overflow = page.getByRole("button", {
      name: "Дополнительные действия",
    });
    let managementDialog = await openSettingsWithKeyboard(page);
    const cardsEnabled = managementDialog.getByRole("checkbox", {
      name: /Сбор карточек/,
    });
    const votingEnabled = managementDialog.getByRole("checkbox", {
      name: /Голосование/,
    });
    await cardsEnabled.uncheck();
    await votingEnabled.uncheck();
    await managementDialog
      .getByRole("button", { name: "Сохранить настройки" })
      .click();
    await expect(
      managementDialog.getByText("Все изменения сохранены", { exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(overflow).toBeFocused();
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "Сбор карточек и голосование выключены" }),
    ).toBeVisible();
    await expect(
      column(page, "Что прошло хорошо").getByRole("button", {
        name: "Добавить карточку в колонку «Что прошло хорошо»",
      }),
    ).toHaveCount(0);
    await expect(
      sourceCard.getByRole("button", {
        name: /голос за карточку/,
      }),
    ).toBeDisabled();

    managementDialog = await openSettingsWithKeyboard(page);
    await managementDialog
      .getByRole("checkbox", { name: /Сбор карточек/ })
      .check();
    await managementDialog
      .getByRole("checkbox", { name: /Голосование/ })
      .check();
    await managementDialog
      .getByRole("button", { name: "Сохранить настройки" })
      .click();
    await expect(
      managementDialog.getByText("Все изменения сохранены", { exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(
      sourceCard.getByRole("button", {
        name: `Отменить голос за карточку «${sourceCardText}»`,
      }),
    ).toBeVisible();

    managementDialog = await openSettingsWithKeyboard(page);
    await managementDialog
      .getByRole("button", { name: "Опасные действия" })
      .click();
    await managementDialog
      .getByRole("button", { name: "Сбросить", exact: true })
      .click();
    const resetDialog = page.getByRole("dialog", {
      name: "Сбросить все голоса?",
    });
    await resetDialog
      .getByLabel("Введите СБРОСИТЬ для подтверждения")
      .fill("СБРОСИТЬ");
    await resetDialog.getByRole("button", { name: "Сбросить голоса" }).click();
    await expect(resetDialog).toBeHidden();
    await page.keyboard.press("Escape");
    await expect(voteButton).toHaveAttribute("aria-pressed", "false");

    await sourceCard
      .getByRole("button", { name: "Действия с карточкой" })
      .click();
    await page.getByRole("menuitem", { name: "Создать решение" }).click();
    const fromCardDialog = page.getByRole("dialog", {
      name: "Создать решение",
    });
    await fromCardDialog.getByLabel("Ответственный").fill("Команда E2E");
    await fromCardDialog.getByRole("button", { name: "Создать" }).click();
    const copiedAction = actionItem(page, copiedActionText);
    await expect(copiedAction).toBeVisible();
    await expect(copiedAction).toContainText("Ответственный: Команда E2E");

    const actions = column(page, "Решения");
    const actionComposerTrigger = actions.getByRole("button", {
      name: "Добавить решение",
    });
    await actionComposerTrigger.click();
    await actions.getByLabel("Новое решение").fill(manualActionText);
    await actions.getByRole("button", { name: "Добавить" }).click();
    await expect(actionItem(page, manualActionText)).toBeVisible();

    const beforeActionMove = await actions
      .locator('ol > li[aria-label^="Решение «"]')
      .evaluateAll((items) =>
        items.map((item) => item.getAttribute("aria-label")),
      );
    const actionMoveHandle = actionItem(page, manualActionText).getByRole(
      "button",
      { name: /^Переместить решение «/ },
    );
    const manualActionIndex = beforeActionMove.indexOf(
      `Решение «${manualActionText}»`,
    );
    expect(manualActionIndex).toBeGreaterThanOrEqual(0);
    await actionMoveHandle.focus();
    await page.keyboard.press("Space");
    await page.keyboard.press(
      manualActionIndex === 0 ? "ArrowDown" : "ArrowUp",
    );
    const actionMoveResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname.startsWith(
          `/api/boards/${boardId}/action-items/`,
        ) &&
        new URL(response.url()).pathname.endsWith("/move"),
      { timeout: 20_000 },
    );
    await page.keyboard.press("Space");
    expect((await actionMoveResponse).ok()).toBe(true);
    const afterActionMove = await actions
      .locator('ol > li[aria-label^="Решение «"]')
      .evaluateAll((items) =>
        items.map((item) => item.getAttribute("aria-label")),
      );
    expect(afterActionMove).not.toEqual(beforeActionMove);

    await copiedAction
      .getByRole("button", { name: "Действия с решением" })
      .click();
    await page.getByRole("menuitem", { name: "Изменить" }).click();
    const editActionDialog = page.getByRole("dialog", {
      name: "Изменить решение",
    });
    await editActionDialog.getByLabel("Действие").fill(editedActionText);
    await editActionDialog.getByRole("button", { name: "Сохранить" }).click();
    const editedAction = actionItem(page, editedActionText);
    await expect(editedAction).toBeVisible();
    await editedAction
      .getByRole("button", { name: "Действия с решением" })
      .click();
    await page.getByRole("menuitem", { name: "Удалить" }).click();
    const deleteActionDialog = page.getByRole("dialog", {
      name: "Удалить решение?",
    });
    await deleteActionDialog.getByRole("button", { name: "Удалить" }).click();
    await expect(editedAction).toHaveCount(0);

    await overflow.click();
    await page.getByRole("menuitem", { name: "Экспорт" }).click();
    const exportDialog = page.getByRole("dialog", {
      name: "Управление доской",
    });
    for (const format of ["JSON", "CSV", "Markdown"] as const) {
      const exportLink = exportDialog.getByRole("link", {
        name: `Экспорт ${format}`,
      });
      await expect(exportLink).toHaveAttribute(
        "href",
        `/api/boards/${boardId}/export.${format === "Markdown" ? "md" : format.toLowerCase()}`,
      );
      const href = await exportLink.getAttribute("href");
      if (!href) {
        throw new Error(`Missing ${format} export href`);
      }
      const exportResponse = await context.request.get(href);
      expect(exportResponse.status()).toBe(200);
      expect(exportResponse.headers()["cache-control"]).toContain("no-store");
    }
    await page.keyboard.press("Escape");
    await expect(overflow).toBeFocused();
  } catch (error) {
    flowError = error;
    throw error;
  } finally {
    if (boardId) {
      try {
        await deleteBoard(context, boardId, origin);
      } catch (cleanupError) {
        if (!flowError) {
          throw cleanupError;
        }
        console.error("Board cleanup also failed after the modes E2E error");
      }
    }
  }
});

test("product release flow covers access, realtime, content and accessible DnD", async ({
  browser,
  page: ownerPage,
}) => {
  test.setTimeout(180_000);
  const boardTitle = "Ретро перед релизом";
  const ownerContext = ownerPage.context();
  const baseURL = test.info().project.use.baseURL as string;
  let participantContext: BrowserContext | null = null;
  let replayContext: BrowserContext | null = null;
  let boardId: string | null = null;
  let productScreenshot: Buffer | null = null;
  let productMobileScreenshot: Buffer | null = null;
  let flowError: unknown = null;

  try {
    await ownerPage.setViewportSize({ width: 1440, height: 1000 });
    await ownerPage.emulateMedia({ reducedMotion: "reduce" });
    participantContext = await browser.newContext({
      baseURL,
      hasTouch: true,
      locale: "ru-RU",
      timezoneId: "UTC",
      viewport: { width: 1440, height: 1000 },
    });
    const participantPage = await participantContext.newPage();
    replayContext = await browser.newContext({
      baseURL,
      locale: "ru-RU",
      timezoneId: "UTC",
    });
    const replayPage = await replayContext.newPage();

    boardId = await createBoard(ownerPage, boardTitle);
    const viewportMeta = ownerPage.locator('meta[name="viewport"]');
    await expect(viewportMeta).toHaveAttribute("content", /width=device-width/);
    await expect(viewportMeta).toHaveAttribute("content", /initial-scale=1/);
    await expect(viewportMeta).toHaveAttribute("content", /viewport-fit=cover/);
    await expect(viewportMeta).toHaveAttribute(
      "content",
      /interactive-widget=resizes-content/,
    );
    for (const viewport of [
      { width: 1280, height: 800 },
      { width: 1440, height: 1000 },
    ]) {
      await ownerPage.setViewportSize(viewport);
      await expectNoPageOverflow(ownerPage);
      await expectDefaultBoardFits(ownerPage);
    }
    await ownerPage.setViewportSize({ width: 1000, height: 768 });
    await expectBoardCanvasUsesHorizontalScroll(ownerPage);
    // A 720 CSS-pixel viewport is the reflow proxy for 200% zoom at the
    // 1440px desktop acceptance size. Only the board canvas may overflow.
    await ownerPage.setViewportSize({ width: 720, height: 500 });
    await expectBoardCanvasUsesHorizontalScroll(ownerPage);
    await expect(
      ownerPage.getByRole("button", { name: "Дополнительные действия" }),
    ).toBeVisible();
    await ownerPage.setViewportSize({ width: 1440, height: 1000 });
    expect(
      await ownerPage.evaluate(
        () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      ),
    ).toBe(true);

    const renameTrigger = ownerPage.getByRole("button", {
      name: "Переименовать доску",
    });
    await renameTrigger.focus();
    await ownerPage.keyboard.press("Enter");
    const titleInput = ownerPage.getByLabel("Название доски");
    await expect(titleInput).toBeFocused();
    await ownerPage.keyboard.press("Escape");
    await expect(renameTrigger).toBeFocused();
    await ownerPage.keyboard.press("Enter");
    await expect(titleInput).toBeFocused();
    await ownerPage.keyboard.press("Enter");
    await expect(renameTrigger).toBeFocused();

    await ownerPage.setViewportSize({ width: 390, height: 844 });
    const mobileInviteTrigger = ownerPage.getByRole("button", {
      name: "Пригласить",
    });
    await mobileInviteTrigger.click();
    const mobileManagementDialog = ownerPage.getByRole("dialog", {
      name: "Управление доской",
    });
    const mobileManagementBox = await mobileManagementDialog.boundingBox();
    expect(
      mobileManagementBox,
      "Mobile management dialog must have a layout box",
    ).not.toBeNull();
    expect(
      mobileManagementBox?.x ?? Number.POSITIVE_INFINITY,
    ).toBeLessThanOrEqual(1);
    expect(
      mobileManagementBox?.y ?? Number.POSITIVE_INFINITY,
    ).toBeLessThanOrEqual(1);
    expect(mobileManagementBox?.width ?? 0).toBeGreaterThanOrEqual(389);
    expect(mobileManagementBox?.height ?? 0).toBeGreaterThanOrEqual(843);
    await ownerPage.keyboard.press("Escape");
    await expect(mobileInviteTrigger).toBeFocused();
    await ownerPage.setViewportSize({ width: 1440, height: 1000 });

    const deniedResponse = await participantPage.goto(`/boards/${boardId}`);
    expect(deniedResponse?.status()).toBe(404);
    expect(deniedResponse?.headers()["content-type"]).toContain("text/html");
    await expect(
      participantPage.getByRole("heading", {
        name: "Доска недоступна",
        level: 1,
      }),
    ).toBeVisible();
    const deniedApiResponse = await participantContext.request.get(
      `/api/boards/${boardId}`,
    );
    expect(deniedApiResponse.status()).toBe(404);
    expect(await deniedApiResponse.json()).toEqual({
      error: {
        code: "BOARD_NOT_FOUND",
        message: "Board not found.",
      },
    });

    const invitationUrl = await createInvitation(ownerPage);
    await joinBoard(participantPage, invitationUrl, "Участник E2E", boardTitle);
    await openInvitation(replayPage, invitationUrl);
    await replayPage.getByLabel("Ваше имя").fill("Повторный вход");
    await replayPage.getByRole("button", { name: "Присоединиться" }).click();
    const replayError =
      "Приглашение некорректно, истекло или уже использовано.";
    await expect(
      replayPage.getByRole("alert").filter({ hasText: replayError }),
    ).toHaveText(replayError);

    for (const viewport of [
      { width: 768, height: 1024 },
      { width: 390, height: 844 },
      { width: 360, height: 800 },
    ]) {
      await participantPage.setViewportSize(viewport);
      await expect(
        participantPage.getByRole("heading", { name: boardTitle, level: 1 }),
      ).toBeVisible();
      await expectBoardCanvasUsesHorizontalScroll(participantPage);
      const responsiveToolbar = participantPage.getByTestId("board-toolbar");
      await expect(responsiveToolbar).toBeVisible();
      const responsiveToolbarBox = await responsiveToolbar.boundingBox();
      expect(
        responsiveToolbarBox,
        "Responsive toolbar must have a layout box",
      ).not.toBeNull();
      expect(
        (responsiveToolbarBox?.x ?? 0) + (responsiveToolbarBox?.width ?? 0),
      ).toBeLessThanOrEqual(viewport.width + 1);
      expect(
        responsiveToolbarBox?.height ?? Number.POSITIVE_INFINITY,
      ).toBeLessThanOrEqual(65);
      await expectTouchTarget(
        participantPage.getByRole("button", {
          name: "Дополнительные действия",
        }),
      );
      await expectTouchTarget(
        column(participantPage, "Что прошло хорошо").getByRole("button", {
          name: "Добавить карточку в колонку «Что прошло хорошо»",
        }),
      );
    }

    await column(
      participantPage,
      "Что можно улучшить",
    ).scrollIntoViewIfNeeded();
    await expect(column(participantPage, "Что можно улучшить")).toBeVisible();
    const mobileActions = participantPage.getByRole("region", {
      name: "Решения",
    });
    await mobileActions.scrollIntoViewIfNeeded();
    await expect(mobileActions).toBeVisible();
    await participantPage.setViewportSize({ width: 1440, height: 1000 });
    await participantPage
      .getByTestId("board-canvas")
      .evaluate((element) => element.scrollTo({ left: 0 }));

    const keyboardComposerTrigger = column(
      ownerPage,
      "Что прошло хорошо",
    ).getByRole("button", {
      name: "Добавить карточку в колонку «Что прошло хорошо»",
    });
    await keyboardComposerTrigger.focus();
    await ownerPage.keyboard.press("Enter");
    const keyboardComposer = column(ownerPage, "Что прошло хорошо").getByRole(
      "form",
      {
        name: "Новая карточка в колонке «Что прошло хорошо»",
      },
    );
    const keyboardComposerTextarea =
      keyboardComposer.getByLabel("Текст карточки");
    await expect(keyboardComposerTextarea).toBeFocused();
    await ownerPage.keyboard.press("Escape");
    await expect(keyboardComposer).toHaveCount(0);
    await expect(keyboardComposerTrigger).toBeFocused();

    await keyboardComposerTrigger.focus();
    await ownerPage.keyboard.press("Enter");
    await keyboardComposerTextarea.fill("Создано с клавиатуры");
    await ownerPage.keyboard.press("Control+Enter");
    await expect(
      card(ownerPage, "Что прошло хорошо", "Создано с клавиатуры"),
    ).toBeVisible();
    await expect(keyboardComposerTextarea).toBeFocused();
    await ownerPage.keyboard.press("Escape");
    await expect(keyboardComposer).toHaveCount(0);
    await expect(keyboardComposerTrigger).toBeFocused();

    await createCard(
      participantPage,
      "Что прошло хорошо",
      "Первый сигнал",
      "Участник E2E",
    );
    await createCard(participantPage, "Что прошло хорошо", "Второй сигнал");
    await expect(
      card(ownerPage, "Что прошло хорошо", "Первый сигнал"),
    ).toBeVisible();
    await expect(
      card(ownerPage, "Что прошло хорошо", "Второй сигнал"),
    ).toBeVisible();

    await createCard(
      ownerPage,
      "Что можно улучшить",
      "Карточка владельца",
      "Владелец",
    );
    const participantOwnerCard = card(
      participantPage,
      "Что можно улучшить",
      "Карточка владельца",
    );
    await expect(participantOwnerCard).toBeVisible();
    await expect(
      participantOwnerCard.getByRole("button", {
        name: "Действия с карточкой",
      }),
    ).toHaveCount(0);

    const ownerCard = card(
      ownerPage,
      "Что можно улучшить",
      "Карточка владельца",
    );
    await ownerCard
      .getByRole("button", { name: "Действия с карточкой" })
      .click();
    await ownerPage.getByRole("menuitem", { name: "Изменить" }).click();
    const ownerEditDialog = ownerPage.getByRole("dialog", {
      name: "Изменить карточку",
    });
    await ownerEditDialog
      .getByLabel("Текст карточки")
      .fill("Карточка владельца — обновлена");
    await ownerEditDialog.getByRole("button", { name: "Сохранить" }).click();
    await expect(
      card(
        participantPage,
        "Что можно улучшить",
        "Карточка владельца — обновлена",
      ),
    ).toBeVisible();

    await mouseDrag(
      ownerPage,
      card(
        ownerPage,
        "Что можно улучшить",
        "Карточка владельца — обновлена",
      ).getByRole("button", {
        name: "Переместить карточку «Карточка владельца — обновлена»",
      }),
      column(ownerPage, "Что прошло хорошо").getByRole("list", {
        name: "Что прошло хорошо",
      }),
    );
    await expect(
      card(
        participantPage,
        "Что прошло хорошо",
        "Карточка владельца — обновлена",
      ),
    ).toBeVisible();

    await createCard(
      ownerPage,
      "Что можно улучшить",
      "Цель touch-перемещения",
      "Владелец",
    );
    const participantTouchTarget = card(
      participantPage,
      "Что можно улучшить",
      "Цель touch-перемещения",
    );
    await expect(participantTouchTarget).toBeVisible();
    await expect(
      participantTouchTarget.getByRole("button", {
        name: "Проголосовать за карточку «Цель touch-перемещения»",
      }),
    ).toBeEnabled();

    const firstCard = card(
      participantPage,
      "Что прошло хорошо",
      "Первый сигнал",
    );
    await firstCard
      .getByRole("button", { name: "Действия с карточкой" })
      .click();
    await participantPage.getByRole("menuitem", { name: "Изменить" }).click();
    const editDialog = participantPage.getByRole("dialog", {
      name: "Изменить карточку",
    });
    await editDialog
      .getByLabel("Текст карточки")
      .fill("Первый сигнал — уточнён");
    await editDialog.getByRole("button", { name: "Сохранить" }).click();
    await expect(
      card(ownerPage, "Что прошло хорошо", "Первый сигнал — уточнён"),
    ).toBeVisible();

    const touchSource = card(
      participantPage,
      "Что прошло хорошо",
      "Первый сигнал — уточнён",
    ).getByRole("button", {
      name: "Переместить карточку «Первый сигнал — уточнён»",
    });
    await participantPage.setViewportSize({ width: 1024, height: 768 });
    await expectNoPageOverflow(participantPage);
    await expect(column(participantPage, "Что прошло хорошо")).toBeVisible();
    await expect(column(participantPage, "Что можно улучшить")).toBeVisible();
    await expectTouchTarget(touchSource);
    const touchMoveResponse = participantPage.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname.startsWith(
          `/api/boards/${boardId}/cards/`,
        ) &&
        new URL(response.url()).pathname.endsWith("/move"),
      { timeout: 20_000 },
    );
    await touchDrag(
      participantContext,
      participantPage,
      touchSource,
      participantTouchTarget,
    );
    expect((await touchMoveResponse).ok()).toBe(true);
    await expect(
      card(participantPage, "Что можно улучшить", "Первый сигнал — уточнён"),
    ).toBeVisible();
    await expect(
      card(ownerPage, "Что можно улучшить", "Первый сигнал — уточнён"),
    ).toBeVisible();
    await participantPage.setViewportSize({ width: 1440, height: 1000 });
    await participantPage.reload();
    await waitForBoard(participantPage, boardTitle);
    await expect(
      card(participantPage, "Что можно улучшить", "Первый сигнал — уточнён"),
    ).toBeVisible();

    for (const text of ["Третий сигнал", "Четвёртый сигнал", "Пятый сигнал"]) {
      await createCard(participantPage, "Что прошло хорошо", text);
    }

    const beforeKeyboardMove = await column(
      participantPage,
      "Что прошло хорошо",
    )
      .getByRole("list", { name: "Что прошло хорошо" })
      .locator(":scope > li")
      .evaluateAll((items) =>
        items.map((item) => item.getAttribute("aria-label")),
      );
    const keyboardHandle = card(
      participantPage,
      "Что прошло хорошо",
      "Пятый сигнал",
    ).getByRole("button", { name: "Переместить карточку «Пятый сигнал»" });
    await keyboardHandle.focus();
    await participantPage.keyboard.press("Space");
    await participantPage.keyboard.press("ArrowDown");
    const keyboardMoveResponse = participantPage.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname.startsWith(
          `/api/boards/${boardId}/cards/`,
        ) &&
        new URL(response.url()).pathname.endsWith("/move"),
      { timeout: 20_000 },
    );
    await participantPage.keyboard.press("Space");
    expect((await keyboardMoveResponse).ok()).toBe(true);
    await expect(keyboardHandle).toBeEnabled();
    await expect(
      participantPage.getByText(/Новый порядок сохранён/),
    ).toBeAttached();
    const afterKeyboardMove = await column(participantPage, "Что прошло хорошо")
      .getByRole("list", { name: "Что прошло хорошо" })
      .locator(":scope > li")
      .evaluateAll((items) =>
        items.map((item) => item.getAttribute("aria-label")),
      );
    expect(afterKeyboardMove).not.toEqual(beforeKeyboardMove);
    await participantPage.reload();
    await waitForBoard(participantPage, boardTitle);
    const persistedKeyboardOrder = await column(
      participantPage,
      "Что прошло хорошо",
    )
      .getByRole("list", { name: "Что прошло хорошо" })
      .locator(":scope > li")
      .evaluateAll((items) =>
        items.map((item) => item.getAttribute("aria-label")),
      );
    expect(persistedKeyboardOrder).toEqual(afterKeyboardMove);

    for (const text of ["Второй сигнал", "Третий сигнал", "Четвёртый сигнал"]) {
      await card(participantPage, "Что прошло хорошо", text)
        .getByRole("button", { name: `Проголосовать за карточку «${text}»` })
        .click();
    }
    await expect(
      column(participantPage, "Что прошло хорошо").getByText("0 из 3 голосов", {
        exact: true,
      }),
    ).toBeVisible();
    const exhaustedVote = card(
      participantPage,
      "Что прошло хорошо",
      "Пятый сигнал",
    ).getByRole("button", { name: "Проголосовать за карточку «Пятый сигнал»" });
    await expect(exhaustedVote).toBeDisabled();
    const snapshotResponse = await participantContext.request.get(
      `/api/boards/${boardId}`,
    );
    expect(snapshotResponse.status()).toBe(200);
    const snapshot = (await snapshotResponse.json()) as {
      columns: Array<{
        items: Array<{ kind: "CARD" | "GROUP"; id: string; text?: string }>;
      }>;
    };
    const exhaustedCard = snapshot.columns
      .flatMap((snapshotColumn) => snapshotColumn.items)
      .find((item) => item.kind === "CARD" && item.text === "Пятый сигнал");
    expect(exhaustedCard).toBeDefined();
    const exhaustedResponse = await participantContext.request.put(
      `/api/boards/${boardId}/cards/${exhaustedCard?.id}/vote`,
      { headers: { Origin: baseURL } },
    );
    expect(exhaustedResponse.status()).toBe(422);
    expect(await exhaustedResponse.json()).toMatchObject({
      error: { code: "COLUMN_VOTE_LIMIT_REACHED" },
    });
    await card(participantPage, "Что прошло хорошо", "Второй сигнал")
      .getByRole("button", {
        name: "Отменить голос за карточку «Второй сигнал»",
      })
      .click();
    await expect(exhaustedVote).toBeEnabled();
    await exhaustedVote.click();
    const activeVote = card(
      participantPage,
      "Что прошло хорошо",
      "Пятый сигнал",
    ).getByRole("button", {
      name: "Отменить голос за карточку «Пятый сигнал»",
    });
    await expect(activeVote).toHaveAttribute("aria-pressed", "true");
    await expect(activeVote.locator("svg")).toHaveClass(/fill-current/);
    await expect(
      card(ownerPage, "Что прошло хорошо", "Пятый сигнал").getByRole("button", {
        name: "Проголосовать за карточку «Пятый сигнал»",
      }),
    ).toContainText("1");

    const ownerColumn = column(ownerPage, "Что прошло хорошо");
    const columnActionsTrigger = ownerColumn.getByRole("button", {
      name: "Действия с колонкой «Что прошло хорошо»",
    });
    await columnActionsTrigger.focus();
    await ownerPage.keyboard.press("Enter");
    const groupCardsMenuItem = ownerPage.getByRole("menuitem", {
      name: "Объединить карточки",
    });
    await expect(groupCardsMenuItem).toBeVisible();
    await groupCardsMenuItem.focus();
    await ownerPage.keyboard.press("Enter");
    const groupDialog = ownerPage.getByRole("dialog", {
      name: "Объединить карточки",
    });
    await expect(groupDialog).toBeVisible();
    await ownerPage.keyboard.press("Escape");
    await expect(groupDialog).toBeHidden();
    await expect(columnActionsTrigger).toBeFocused();
    await columnActionsTrigger.click();
    await ownerPage
      .getByRole("menuitem", { name: "Объединить карточки" })
      .click();
    await groupDialog.getByLabel("Третий сигнал").check();
    await groupDialog.getByLabel("Четвёртый сигнал").check();
    await groupDialog.getByLabel("Название группы").fill("Общие наблюдения");
    await groupDialog.getByRole("button", { name: "Объединить" }).click();
    await expect(
      ownerPage.getByText("Общие наблюдения", { exact: true }),
    ).toBeVisible();
    await expect(
      participantPage.getByText("Общие наблюдения", { exact: true }),
    ).toBeVisible();

    const actions = ownerPage.getByRole("region", { name: "Решения" });
    await expect(actions).toBeVisible();
    const actionComposerTrigger = actions.getByRole("button", {
      name: "Добавить решение",
    });
    await actionComposerTrigger.click();
    await actions
      .getByLabel("Новое решение")
      .fill("Проверить метрики через неделю");
    await actions
      .getByRole("button", { name: "Указать ответственного" })
      .click();
    await actions.getByLabel("Ответственный").fill("Команда");
    await actions.getByRole("button", { name: "Добавить" }).click();
    await expect(
      actions.getByText("Проверить метрики через неделю", { exact: true }),
    ).toBeVisible();
    await expect(
      participantPage.getByText("Проверить метрики через неделю", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(actionComposerTrigger).toBeFocused();

    const completion = actions.getByRole("checkbox", {
      name: "Отметить решение выполненным",
    });
    await completion.click();
    await expect(
      actions.getByRole("checkbox", { name: "Вернуть решение в работу" }),
    ).toBeChecked();
    await expect(
      participantPage.getByRole("img", {
        name: "Статус решения: выполнено",
      }),
    ).toBeVisible();

    if (process.env.UPDATE_PRODUCT_SCREENSHOT === "1") {
      await ownerContext.addCookies([
        {
          name: "badaction_locale",
          value: "en",
          url: baseURL,
          sameSite: "Lax",
        },
      ]);
      await ownerPage.reload();
      await expect(ownerPage.locator("html")).toHaveAttribute("lang", "en");
      await expect(
        ownerPage.getByRole("heading", { name: boardTitle, level: 1 }),
      ).toBeVisible();
      await expect(
        ownerPage.getByRole("status", { name: "Sync status: Online" }),
      ).toBeVisible();
      await expect(
        ownerPage.getByRole("region", {
          name: "Что прошло хорошо",
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        ownerPage.getByRole("button", { name: "More actions" }),
      ).toBeVisible();
      await expect(ownerPage.locator("[data-sonner-toast]")).toHaveCount(0);
      await ownerPage.setViewportSize({ width: 1440, height: 1000 });
      await ownerPage
        .getByTestId("board-canvas")
        .evaluate((element) => element.scrollTo({ left: 0 }));
      productScreenshot = await ownerPage.screenshot({
        fullPage: false,
        animations: "disabled",
        mask: [ownerPage.locator("time")],
        maskColor: "#e4e4e7",
        style: "nextjs-portal { display: none !important; }",
      });
      await ownerPage.setViewportSize({ width: 390, height: 844 });
      await expectNoPageOverflow(ownerPage);
      await ownerPage
        .getByTestId("board-canvas")
        .evaluate((element) => element.scrollTo({ left: 0 }));
      productMobileScreenshot = await ownerPage.screenshot({
        fullPage: false,
        animations: "disabled",
        mask: [ownerPage.locator("time")],
        maskColor: "#e4e4e7",
        style: "nextjs-portal { display: none !important; }",
      });
      await ownerPage.setViewportSize({ width: 1440, height: 1000 });
      await ownerContext.addCookies([
        {
          name: "badaction_locale",
          value: "ru",
          url: baseURL,
          sameSite: "Lax",
        },
      ]);
      await ownerPage.reload();
      await expect(ownerPage.locator("html")).toHaveAttribute("lang", "ru");
      await waitForBoard(ownerPage, boardTitle);
      await expect(
        ownerPage.getByRole("region", {
          name: "Что прошло хорошо",
          exact: true,
        }),
      ).toBeVisible();
    }

    await ownerPage.getByRole("button", { name: "Действия с группой" }).click();
    await ownerPage
      .getByRole("menuitem", { name: "Распустить группу" })
      .click();
    const ungroupDialog = ownerPage.getByRole("dialog", {
      name: "Распустить группу?",
    });
    await ungroupDialog.getByRole("button", { name: "Распустить" }).click();
    await expect(
      ownerPage.getByText("Общие наблюдения", { exact: true }),
    ).toHaveCount(0);
    await expect(
      card(ownerPage, "Что прошло хорошо", "Третий сигнал"),
    ).toBeVisible();

    await participantContext.setOffline(true);
    const degradedConnectionStatus = participantPage.getByRole("status", {
      name: /Состояние синхронизации: (Переподключение…|Резервное обновление)/,
    });
    const persistentConnectionNotice = participantPage.getByText(
      /(?:Соединение для обновлений в реальном времени прервано|Обновления в реальном времени недоступны)/,
    );
    await expect(persistentConnectionNotice).toHaveCount(0);
    await expect(degradedConnectionStatus).toBeVisible({ timeout: 30_000 });
    await expect(degradedConnectionStatus).toHaveCount(1);
    await expect(persistentConnectionNotice).toBeVisible({ timeout: 25_000 });
    await expect(degradedConnectionStatus).toHaveCount(1);

    const toolbarOverflow = ownerPage.getByRole("button", {
      name: "Дополнительные действия",
    });
    const settingsDialog = await openSettingsWithKeyboard(ownerPage);
    await settingsDialog.getByRole("button", { name: "О доске" }).click();
    await expect(
      settingsDialog.getByText("Данные хранятся до", { exact: true }),
    ).toBeVisible();
    await settingsDialog.getByRole("button", { name: "Основное" }).click();
    await settingsDialog
      .getByRole("checkbox", { name: /Только чтение/ })
      .check();
    await settingsDialog
      .getByRole("button", { name: "Сохранить настройки" })
      .click();
    await expect(
      settingsDialog.getByText("Все изменения сохранены", { exact: true }),
    ).toBeVisible();
    await ownerPage.keyboard.press("Escape");
    await expect(toolbarOverflow).toBeFocused();
    await expect(
      ownerPage
        .getByRole("status")
        .filter({ hasText: /Доска открыта только для чтения/ }),
    ).toBeVisible();

    await participantContext.setOffline(false);
    await expect(
      participantPage.getByRole("status", {
        name: "Состояние синхронизации: Онлайн",
      }),
    ).toBeVisible({
      timeout: 45_000,
    });
    await expect(persistentConnectionNotice).toHaveCount(0);
    await expect(
      participantPage
        .getByRole("status")
        .filter({ hasText: /Доска открыта только для чтения/ }),
    ).toBeVisible();
    await expect(
      column(participantPage, "Что прошло хорошо").getByRole("button", {
        name: "Добавить карточку в колонку «Что прошло хорошо»",
      }),
    ).toHaveCount(0);

    const cardToDelete = card(ownerPage, "Что прошло хорошо", "Пятый сигнал");
    const reopenSettings = await openSettingsWithKeyboard(ownerPage);
    await reopenSettings
      .getByRole("checkbox", { name: /Только чтение/ })
      .uncheck();
    await reopenSettings
      .getByRole("button", { name: "Сохранить настройки" })
      .click();
    await expect(
      reopenSettings.getByText("Все изменения сохранены", { exact: true }),
    ).toBeVisible();
    await ownerPage.keyboard.press("Escape");
    await expect(toolbarOverflow).toBeFocused();
    await expect(
      ownerPage
        .getByRole("status")
        .filter({ hasText: /Доска открыта только для чтения/ }),
    ).toHaveCount(0);

    const longText = `Проверка переноса ${"я".repeat(1000)}`.slice(0, 1000);
    expect(longText).toHaveLength(1000);
    await createCard(ownerPage, "Что можно улучшить", longText);
    const longCard = card(ownerPage, "Что можно улучшить", longText);
    expect(
      await longCard.evaluate(
        (element) => element.scrollWidth <= element.clientWidth + 1,
      ),
    ).toBe(true);

    await cardToDelete
      .getByRole("button", { name: "Действия с карточкой" })
      .click();
    await ownerPage.getByRole("menuitem", { name: "Удалить" }).click();
    const deleteDialog = ownerPage.getByRole("dialog", {
      name: "Удалить карточку?",
    });
    await deleteDialog.getByRole("button", { name: "Удалить" }).click();
    await expect(
      card(participantPage, "Что прошло хорошо", "Пятый сигнал"),
    ).toHaveCount(0);

    const longColumnTitle =
      "Очень длинное название колонки для проверки переноса без горизонтального переполнения".slice(
        0,
        80,
      );
    await toolbarOverflow.click();
    await ownerPage
      .getByRole("menuitem", { name: "Управление колонками" })
      .click();
    const columnManagementDialog = ownerPage.getByRole("dialog", {
      name: "Управление доской",
    });
    const sourceColumnTitleId = await columnManagementDialog
      .locator('input[id^="column-title-"]')
      .evaluateAll(
        (inputs) =>
          inputs.find(
            (input) =>
              (input as HTMLInputElement).value === "Что можно улучшить",
          )?.id ?? null,
      );
    if (!sourceColumnTitleId) {
      throw new Error("Could not find the source column title input");
    }
    const sourceColumnTitleInput = columnManagementDialog.locator(
      `#${sourceColumnTitleId}`,
    );
    const sourceColumnForm = sourceColumnTitleInput.locator(
      "xpath=ancestor::form",
    );
    await sourceColumnTitleInput.fill(longColumnTitle);
    const saveColumnButton = sourceColumnForm.getByRole("button", {
      name: "Сохранить",
    });
    await saveColumnButton.click();
    await expect(saveColumnButton).toBeDisabled();
    await ownerPage.keyboard.press("Escape");
    await expect(toolbarOverflow).toBeFocused();

    const longColumn = column(ownerPage, longColumnTitle);
    await expect(longColumn).toBeVisible();
    const longColumnHeading = longColumn.getByRole("heading", {
      name: longColumnTitle,
      level: 3,
    });
    expect(
      await longColumnHeading.evaluate(
        (element) => element.scrollWidth <= element.clientWidth + 1,
      ),
    ).toBe(true);
    await expect(column(participantPage, longColumnTitle)).toBeVisible();

    const accessTrigger = ownerPage.getByRole("button", {
      name: "Пригласить",
    });
    await accessTrigger.click();
    const accessDialog = ownerPage.getByRole("dialog", {
      name: "Управление доской",
    });
    const revokeParticipant = accessDialog.getByRole("button", {
      name: "Отозвать доступ участника Участник E2E",
    });
    await expect(revokeParticipant).toBeVisible();
    await revokeParticipant.click();
    const revokeDialog = ownerPage.getByRole("dialog", {
      name: "Отозвать доступ?",
    });
    await revokeDialog.getByRole("button", { name: "Отозвать доступ" }).click();
    await expect(revokeDialog).toBeHidden();
    await expect(revokeParticipant).toHaveCount(0);
    const revokedAccessResponse = await participantContext.request.get(
      `/api/boards/${boardId}`,
    );
    expect(revokedAccessResponse.status()).toBe(404);
    expect(await revokedAccessResponse.json()).toMatchObject({
      error: { code: "BOARD_NOT_FOUND" },
    });
    await ownerPage.keyboard.press("Escape");
    await expect(accessDialog).toBeHidden();
    await expect(accessTrigger).toBeFocused();
  } catch (error) {
    flowError = error;
    throw error;
  } finally {
    await participantContext?.setOffline(false).catch(() => undefined);
    let cleanupError: unknown = null;
    try {
      if (boardId) {
        await deleteBoard(ownerContext, boardId, new URL(baseURL).origin);
      }
    } catch (error) {
      cleanupError = error;
    } finally {
      await Promise.allSettled([
        replayContext?.close(),
        participantContext?.close(),
      ]);
    }
    if (cleanupError) {
      if (!flowError) {
        throw cleanupError;
      }
      console.error("Board cleanup also failed after the E2E flow error");
    }
  }

  if (productScreenshot && productMobileScreenshot) {
    await mkdir(dirname(productScreenshotPath), { recursive: true });
    await Promise.all([
      writeFile(productScreenshotPath, productScreenshot),
      writeFile(productMobileScreenshotPath, productMobileScreenshot),
    ]);
  }
});
