import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
  type Request,
} from "@playwright/test";

// Invitation redemption briefly handles a raw credential. Keep all automatic
// browser artifacts disabled so it cannot be persisted by the test runner.
test.use({ trace: "off", video: "off", screenshot: "off" });

const boardIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type BoardState = {
  revision: string;
  expiresAt: string;
  columns: Array<{
    id: string;
    title: string;
    position: number;
    voteLimit: number;
  }>;
};

type BoardLocaleCase = {
  browserLocale: string;
  locale: "en" | "ru" | "es";
  homeTitle: string;
  boardTitleLabel: string;
  createButton: string;
  titleRequired: string;
  rateLimitError: string;
  syncOnline: string;
  defaultColumns: readonly [string, string];
  moreActions: string;
  managementEntry: string;
  managementTitle: string;
  interfaceSection: string;
  interfaceHeading: string;
  interfacePersonal: string;
  aboutSection: string;
  expiresLabel: string;
  moveColumn: string;
  dragCanceled: string;
  targetLanguage: string;
  targetLocale: "en" | "ru" | "es";
  targetInterfaceHeading: string;
};

const boardLocaleCases: readonly BoardLocaleCase[] = [
  {
    browserLocale: "en-US",
    locale: "en",
    homeTitle: "A simple retrospective for your team",
    boardTitleLabel: "Retrospective name",
    createButton: "Create board",
    titleRequired: "Enter a retrospective name.",
    rateLimitError: "Too many requests. Try again later.",
    syncOnline: "Sync status: Online",
    defaultColumns: ["Went well", "Could improve"],
    moreActions: "More actions",
    managementEntry: "Settings",
    managementTitle: "Board management",
    interfaceSection: "Interface",
    interfaceHeading: "Interface",
    interfacePersonal:
      "This is a personal setting for this browser. It does not change the board or affect other participants.",
    aboutSection: "About",
    expiresLabel: "Data retained until",
    moveColumn: "Move column “Went well”",
    dragCanceled: "Move canceled: Column “Went well”.",
    targetLanguage: "Español",
    targetLocale: "es",
    targetInterfaceHeading: "Interfaz",
  },
  {
    browserLocale: "ru-RU",
    locale: "ru",
    homeTitle: "Простая ретроспектива для вашей команды",
    boardTitleLabel: "Название ретроспективы",
    createButton: "Создать доску",
    titleRequired: "Введите название ретроспективы.",
    rateLimitError: "Слишком много запросов. Попробуйте позже.",
    syncOnline: "Состояние синхронизации: Онлайн",
    defaultColumns: ["Что прошло хорошо", "Что можно улучшить"],
    moreActions: "Дополнительные действия",
    managementEntry: "Настройки",
    managementTitle: "Управление доской",
    interfaceSection: "Интерфейс",
    interfaceHeading: "Интерфейс",
    interfacePersonal:
      "Это персональная настройка этого браузера. Она не изменяет доску и не влияет на других участников.",
    aboutSection: "О доске",
    expiresLabel: "Данные хранятся до",
    moveColumn: "Переместить колонку «Что прошло хорошо»",
    dragCanceled: "Перемещение отменено: Колонка «Что прошло хорошо».",
    targetLanguage: "English",
    targetLocale: "en",
    targetInterfaceHeading: "Interface",
  },
  {
    browserLocale: "es-MX",
    locale: "es",
    homeTitle: "Una retrospectiva sencilla para tu equipo",
    boardTitleLabel: "Nombre de la retrospectiva",
    createButton: "Crear tablero",
    titleRequired: "Escribe un nombre para la retrospectiva.",
    rateLimitError: "Demasiadas solicitudes. Inténtalo más tarde.",
    syncOnline: "Estado de sincronización: En línea",
    defaultColumns: ["Salió bien", "Se puede mejorar"],
    moreActions: "Más acciones",
    managementEntry: "Configuración",
    managementTitle: "Gestión del tablero",
    interfaceSection: "Interfaz",
    interfaceHeading: "Interfaz",
    interfacePersonal:
      "Esta es una preferencia personal de este navegador. No cambia el tablero ni afecta a otras personas.",
    aboutSection: "Acerca del tablero",
    expiresLabel: "Datos conservados hasta",
    moveColumn: "Mover la columna «Salió bien»",
    dragCanceled: "Movimiento cancelado: Columna «Salió bien».",
    targetLanguage: "Русский",
    targetLocale: "ru",
    targetInterfaceHeading: "Интерфейс",
  },
];

const boardSortLabels = {
  en: {
    columnActions: (title: string) => `Actions for column “${title}”`,
    label: "Card order",
    original: "Original order",
    originalTooltip: "Show cards in their saved order",
    byVoteCount: "By vote count",
    byVoteCountTooltip:
      "Sort cards by vote count. Moving a card makes this the saved order.",
  },
  ru: {
    columnActions: (title: string) => `Действия с колонкой «${title}»`,
    label: "Порядок карточек",
    original: "Обычный порядок",
    originalTooltip: "Показать карточки в сохранённом порядке",
    byVoteCount: "По числу голосов",
    byVoteCountTooltip:
      "Сортировать карточки по числу голосов. При перемещении карточки этот порядок станет обычным.",
  },
  es: {
    columnActions: (title: string) => `Acciones de la columna «${title}»`,
    label: "Orden de las tarjetas",
    original: "Orden original",
    originalTooltip: "Mostrar las tarjetas en el orden guardado",
    byVoteCount: "Por número de votos",
    byVoteCountTooltip:
      "Ordenar las tarjetas por número de votos. Al mover una tarjeta, este pasa a ser el orden guardado.",
  },
} as const;

const getBaseURL = (): string => {
  const baseURL = test.info().project.use.baseURL;
  if (typeof baseURL !== "string") {
    throw new Error("The i18n E2E suite requires a Playwright baseURL");
  }
  return baseURL;
};

const createLocaleContext = (
  browser: Browser,
  baseURL: string,
  locale: string,
  viewport = { width: 1280, height: 800 },
): Promise<BrowserContext> =>
  browser.newContext({
    baseURL,
    locale,
    timezoneId: "UTC",
    viewport,
  });

const languageTrigger = (
  scope: Page | Locator,
  locale: "en" | "ru" | "es",
): Locator =>
  scope
    .getByRole("button")
    .filter({ hasText: new RegExp(`^${locale.toUpperCase()}`) })
    .first();

const expectNoPageOverflow = async (page: Page) => {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(
    dimensions.clientWidth + 1,
  );
};

const expectNoHorizontalOverflow = async (locator: Locator) => {
  const dimensions = await locator.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(
    dimensions.clientWidth + 1,
  );
};

const expectLocalizedColumnSortMenu = async (
  page: Page,
  locale: "en" | "ru" | "es",
  columnTitle: string,
) => {
  const labels = boardSortLabels[locale];
  const trigger = page.getByRole("button", {
    name: labels.columnActions(columnTitle),
    exact: true,
  });
  await trigger.click();
  await expect(page.getByText(labels.label, { exact: true })).toBeVisible();
  const original = page.getByRole("menuitemradio", {
    name: labels.original,
    exact: true,
  });
  await expect(original).toHaveAttribute("aria-checked", "true");
  await expect(original).toHaveAttribute("title", labels.originalTooltip);
  await expect(
    page.getByRole("menuitemradio", {
      name: labels.byVoteCount,
      exact: true,
    }),
  ).toHaveAttribute("title", labels.byVoteCountTooltip);
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
};

const waitForBoard = async (page: Page, title: string, syncOnline: string) => {
  await expect(
    page.getByRole("heading", { name: title, level: 1 }),
  ).toBeVisible();
  await expect(page.getByRole("status", { name: syncOnline })).toBeVisible();
};

const submitBoardCreation = async (
  page: Page,
  createButton: string,
): Promise<string> => {
  const createResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      response.request().method() === "POST" && url.pathname === "/api/boards"
    );
  });
  await page.getByRole("button", { name: createButton, exact: true }).click();
  const response = await createResponse;
  expect(response.status()).toBe(201);
  const payload = (await response.json()) as { id?: unknown };
  if (typeof payload.id !== "string" || !boardIdPattern.test(payload.id)) {
    throw new Error("Board creation returned an invalid identifier");
  }
  return payload.id;
};

const fetchBoard = async (
  context: BrowserContext,
  boardId: string,
): Promise<BoardState> => {
  const response = await context.request.get(`/api/boards/${boardId}`);
  expect(response.status()).toBe(200);
  return (await response.json()) as BoardState;
};

const compactColumns = (board: BoardState) =>
  board.columns.map(({ id, title, position, voteLimit }) => ({
    id,
    title,
    position,
    voteLimit,
  }));

const deleteBoard = async (
  context: BrowserContext,
  boardId: string,
  origin: string,
) => {
  const response = await context.request.delete(`/api/boards/${boardId}`, {
    headers: { Origin: origin },
  });
  if (![204, 404].includes(response.status())) {
    throw new Error(`Board cleanup failed with ${response.status()}`);
  }
};

const openBoardInterface = async (
  page: Page,
  localeCase: Pick<
    BoardLocaleCase,
    | "moreActions"
    | "managementEntry"
    | "managementTitle"
    | "interfaceSection"
    | "interfaceHeading"
  >,
): Promise<Locator> => {
  await page
    .getByRole("button", { name: localeCase.moreActions, exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: localeCase.managementEntry, exact: true })
    .click();
  const panel = page.getByTestId("board-management-panel");
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAccessibleName(localeCase.managementTitle);
  await panel
    .getByRole("button", { name: localeCase.interfaceSection, exact: true })
    .click();
  await expect(
    panel.getByRole("heading", {
      name: localeCase.interfaceHeading,
      level: 2,
      exact: true,
    }),
  ).toBeVisible();
  return panel;
};

const selectLanguage = async (
  page: Page,
  scope: Page | Locator,
  currentLocale: "en" | "ru" | "es",
  targetLanguage: string,
) => {
  await languageTrigger(scope, currentLocale).click();
  await page
    .getByRole("menuitem", { name: targetLanguage, exact: true })
    .click();
};

test.describe("locale smoke", () => {
  test("SSR resolves unsupported, Russian, and regional Spanish browser locales", async ({
    browser,
  }) => {
    const baseURL = getBaseURL();
    const cases = [
      {
        browserLocale: "de-DE",
        resolvedLocale: "en",
        homeTitle: "A simple retrospective for your team",
      },
      {
        browserLocale: "ru-RU",
        resolvedLocale: "ru",
        homeTitle: "Простая ретроспектива для вашей команды",
      },
      {
        browserLocale: "es-MX",
        resolvedLocale: "es",
        homeTitle: "Una retrospectiva sencilla para tu equipo",
      },
    ] as const;

    for (const localeCase of cases) {
      const context = await createLocaleContext(
        browser,
        baseURL,
        localeCase.browserLocale,
      );
      try {
        const page = await context.newPage();
        const response = await page.goto("/");
        if (!response) {
          throw new Error("Home navigation did not return an HTTP response");
        }
        expect(response.status()).toBe(200);
        const serverHtml = await response.text();
        expect(serverHtml).toMatch(
          new RegExp(`<html[^>]*lang="${localeCase.resolvedLocale}"`),
        );
        expect(serverHtml).toContain(localeCase.homeTitle);
        await expect(page.locator("html")).toHaveAttribute(
          "lang",
          localeCase.resolvedLocale,
        );
        await expect(
          page.getByRole("heading", {
            name: localeCase.homeTitle,
            level: 1,
          }),
        ).toBeVisible();
        for (const otherLocaleCase of boardLocaleCases) {
          if (otherLocaleCase.locale !== localeCase.resolvedLocale) {
            await expect(
              page.getByRole("heading", {
                name: otherLocaleCase.homeTitle,
                level: 1,
              }),
            ).toHaveCount(0);
          }
        }
        if (localeCase.browserLocale === "de-DE") {
          const cookiesBeforeSelection = await context.cookies(baseURL);
          expect(
            cookiesBeforeSelection.find(
              (cookie) => cookie.name === "badaction_locale",
            ),
          ).toBeUndefined();
          await selectLanguage(page, page, "en", "English");
          await expect
            .poll(async () => {
              const cookies = await context.cookies(baseURL);
              return cookies.find(
                (cookie) => cookie.name === "badaction_locale",
              )?.value;
            })
            .toBe("en");
        }
      } finally {
        await context.close();
      }
    }
  });

  test("keyboard language switch overrides the browser without losing a typed title", async ({
    browser,
  }) => {
    const baseURL = getBaseURL();
    const context = await createLocaleContext(browser, baseURL, "ru-RU");
    try {
      const page = await context.newPage();
      await page.goto("/");
      const draftTitle = "Незавершённое ретро i18n";
      await page.getByLabel("Название ретроспективы").fill(draftTitle);

      const trigger = languageTrigger(page, "ru");
      await trigger.focus();
      await page.keyboard.press("Enter");
      const english = page.getByRole("menuitem", {
        name: "English",
        exact: true,
      });
      await expect(english).toBeVisible();
      await english.focus();
      await page.keyboard.press("Enter");

      await expect(page.locator("html")).toHaveAttribute("lang", "en");
      await expect(page).toHaveTitle("Sprint retrospective");
      await expect(
        page.getByRole("heading", {
          name: "A simple retrospective for your team",
          level: 1,
        }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", {
          name: "Простая ретроспектива для вашей команды",
          level: 1,
        }),
      ).toHaveCount(0);
      await expect(page.getByLabel("Retrospective name")).toHaveValue(
        draftTitle,
      );
      await expect(languageTrigger(page, "en")).toBeFocused();
      await expect
        .poll(async () => {
          const cookies = await context.cookies(baseURL);
          return cookies.find((cookie) => cookie.name === "badaction_locale")
            ?.value;
        })
        .toBe("en");

      const response = await page.reload();
      if (!response) {
        throw new Error("Reload did not return an HTTP response");
      }
      const serverHtml = await response.text();
      expect(serverHtml).toMatch(/<html[^>]*lang="en"/);
      await expect(page.locator("html")).toHaveAttribute("lang", "en");
      await expect(
        page.getByRole("heading", {
          name: "A simple retrospective for your team",
          level: 1,
        }),
      ).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test("validation and API errors follow the active locale", async ({
    browser,
  }) => {
    const baseURL = getBaseURL();

    for (const localeCase of boardLocaleCases) {
      const context = await createLocaleContext(
        browser,
        baseURL,
        localeCase.browserLocale,
      );
      try {
        const page = await context.newPage();
        await page.goto("/");
        await page
          .getByRole("button", { name: localeCase.createButton, exact: true })
          .click();
        await expect(page.locator("#board-title-error")).toHaveText(
          localeCase.titleRequired,
        );

        await page.route("**/api/boards", async (route) => {
          await route.fulfill({
            status: 429,
            contentType: "application/json",
            body: JSON.stringify({
              error: {
                code: "RATE_LIMIT_EXCEEDED",
                message: "Too many requests. Try again later.",
              },
            }),
          });
        });
        await page
          .getByLabel(localeCase.boardTitleLabel)
          .fill(`Localized error ${localeCase.locale}`);
        await page
          .getByRole("button", { name: localeCase.createButton, exact: true })
          .click();
        await expect(page.locator("#board-title-error")).toHaveText(
          localeCase.rateLimitError,
        );
      } finally {
        await context.close();
      }
    }
  });

  test("localized board defaults remain board data after switching the interface", async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const baseURL = getBaseURL();
    const origin = new URL(baseURL).origin;

    for (const [index, localeCase] of boardLocaleCases.entries()) {
      const mobile = localeCase.locale === "es";
      const context = await createLocaleContext(
        browser,
        baseURL,
        localeCase.browserLocale,
        mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 },
      );
      let boardId: string | null = null;
      try {
        const page = await context.newPage();
        await page.goto("/");
        await expect(page.locator("html")).toHaveAttribute(
          "lang",
          localeCase.locale,
        );
        await expect(
          page.getByRole("heading", {
            name: localeCase.homeTitle,
            level: 1,
          }),
        ).toBeVisible();
        if (mobile) {
          await expectNoPageOverflow(page);
        }

        const boardTitle = `i18n board ${localeCase.locale} ${Date.now()} ${index}`;
        await page.getByLabel(localeCase.boardTitleLabel).fill(boardTitle);
        boardId = await submitBoardCreation(page, localeCase.createButton);
        await page.waitForURL(new RegExp(`/boards/${boardId}$`));
        await waitForBoard(page, boardTitle, localeCase.syncOnline);
        await expectLocalizedColumnSortMenu(
          page,
          localeCase.locale,
          localeCase.defaultColumns[0],
        );
        if (mobile) {
          await expectNoPageOverflow(page);
        }

        const beforeSwitch = await fetchBoard(context, boardId);
        expect(compactColumns(beforeSwitch)).toEqual([
          {
            id: expect.any(String),
            title: localeCase.defaultColumns[0],
            position: 1024,
            voteLimit: 3,
          },
          {
            id: expect.any(String),
            title: localeCase.defaultColumns[1],
            position: 2048,
            voteLimit: 3,
          },
        ]);

        const columnHandle = page.getByRole("button", {
          name: localeCase.moveColumn,
          exact: true,
        });
        await columnHandle.focus();
        await page.keyboard.press("Space");
        await expect(columnHandle).toHaveAttribute("aria-pressed", "true");
        await page.keyboard.press("Escape");
        await expect(
          page.getByText(localeCase.dragCanceled, { exact: true }).first(),
        ).toBeAttached();

        const panel = await openBoardInterface(page, localeCase);
        const interfaceContent = panel.getByRole("region", {
          name: localeCase.interfaceHeading,
          exact: true,
        });
        await expect(
          interfaceContent.getByText(localeCase.interfacePersonal, {
            exact: true,
          }),
        ).toBeVisible();
        if (mobile) {
          await expectNoPageOverflow(page);
          await expectNoHorizontalOverflow(interfaceContent);
        }
        await panel
          .getByRole("button", { name: localeCase.aboutSection, exact: true })
          .click();
        const expiryRow = panel
          .getByText(localeCase.expiresLabel, { exact: true })
          .locator("..");
        await expect(expiryRow.locator("time")).toHaveText(
          new Intl.DateTimeFormat(localeCase.locale, {
            dateStyle: "long",
            timeZone: "UTC",
          }).format(new Date(beforeSwitch.expiresAt)),
        );
        if (mobile) {
          await expectNoPageOverflow(page);
        }
        await panel
          .getByRole("button", {
            name: localeCase.interfaceSection,
            exact: true,
          })
          .click();
        await selectLanguage(
          page,
          panel,
          localeCase.locale,
          localeCase.targetLanguage,
        );
        await expect(page.locator("html")).toHaveAttribute(
          "lang",
          localeCase.targetLocale,
        );
        await expect(
          panel.getByRole("heading", {
            name: localeCase.targetInterfaceHeading,
            level: 2,
            exact: true,
          }),
        ).toBeVisible();
        await expect
          .poll(async () => {
            const cookies = await context.cookies(baseURL);
            return cookies.find((cookie) => cookie.name === "badaction_locale")
              ?.value;
          })
          .toBe(localeCase.targetLocale);

        const afterSwitch = await fetchBoard(context, boardId);
        expect(afterSwitch.revision).toBe(beforeSwitch.revision);
        expect(compactColumns(afterSwitch)).toEqual(
          compactColumns(beforeSwitch),
        );
        await page.keyboard.press("Escape");
        await expect(panel).toBeHidden();
        await expectLocalizedColumnSortMenu(
          page,
          localeCase.targetLocale,
          localeCase.defaultColumns[0],
        );
        for (const title of localeCase.defaultColumns) {
          await expect(
            page.getByRole("region", { name: title, exact: true }),
          ).toBeVisible();
        }
      } finally {
        try {
          if (boardId) {
            await deleteBoard(context, boardId, origin);
          }
        } finally {
          await context.close();
        }
      }
    }
  });

  test("owner and participant keep personal locales without mutating the shared board", async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const baseURL = getBaseURL();
    const origin = new URL(baseURL).origin;
    const ownerLocale = boardLocaleCases[0];
    const participantLocale = boardLocaleCases[2];
    const ownerContext = await createLocaleContext(
      browser,
      baseURL,
      ownerLocale.browserLocale,
    );
    const participantContext = await createLocaleContext(
      browser,
      baseURL,
      participantLocale.browserLocale,
    );
    let boardId: string | null = null;
    let ownerPage: Page | null = null;
    let participantPage: Page | null = null;
    const observedMutations: string[] = [];

    try {
      ownerPage = await ownerContext.newPage();
      await ownerPage.goto("/");
      const boardTitle = `Shared i18n board ${Date.now()}`;
      await ownerPage.getByLabel(ownerLocale.boardTitleLabel).fill(boardTitle);
      boardId = await submitBoardCreation(ownerPage, ownerLocale.createButton);
      await ownerPage.waitForURL(new RegExp(`/boards/${boardId}$`));
      await waitForBoard(ownerPage, boardTitle, ownerLocale.syncOnline);

      const invitationResponse = await ownerContext.request.post(
        `/api/boards/${boardId}/invitations`,
        {
          headers: {
            Origin: origin,
            "Content-Type": "application/json",
          },
          data: { maxUses: 1 },
        },
      );
      expect(invitationResponse.status()).toBe(201);
      const invitationPayload = (await invitationResponse.json()) as {
        joinPath?: unknown;
      };
      let invitationToken = "";
      {
        const candidate = invitationPayload.joinPath;
        const validCredential =
          typeof candidate === "string" &&
          /^\/join#[A-Za-z0-9_-]{43}$/.test(candidate);
        expect(validCredential).toBe(true);
        if (!validCredential || typeof candidate !== "string") {
          throw new Error("Invitation creation returned an invalid credential");
        }
        invitationToken = candidate.slice("/join#".length);
      }
      invitationPayload.joinPath = undefined;

      const redeemResponse = await participantContext.request.post(
        "/api/invitations/redeem",
        {
          headers: {
            Origin: origin,
            "Content-Type": "application/json",
          },
          data: {
            token: invitationToken,
            displayName: "Participante i18n",
          },
        },
      );
      invitationToken = "";
      expect(redeemResponse.status()).toBe(200);

      participantPage = await participantContext.newPage();
      await participantPage.goto(`/boards/${boardId}`);
      await waitForBoard(
        participantPage,
        boardTitle,
        participantLocale.syncOnline,
      );
      await expect(ownerPage.locator("html")).toHaveAttribute("lang", "en");
      await expect(participantPage.locator("html")).toHaveAttribute(
        "lang",
        "es",
      );

      const beforeSwitch = await fetchBoard(ownerContext, boardId);
      const participantBeforeSwitch = await fetchBoard(
        participantContext,
        boardId,
      );
      expect(participantBeforeSwitch.revision).toBe(beforeSwitch.revision);

      const observeBoardMutation = (request: Request) => {
        const url = new URL(request.url());
        if (
          url.pathname.startsWith(`/api/boards/${boardId}`) &&
          !["GET", "HEAD", "OPTIONS"].includes(request.method())
        ) {
          observedMutations.push(`${request.method()} ${url.pathname}`);
        }
      };
      ownerPage.on("request", observeBoardMutation);
      participantPage.on("request", observeBoardMutation);

      const ownerPanel = await openBoardInterface(ownerPage, ownerLocale);
      await selectLanguage(ownerPage, ownerPanel, "en", "Русский");
      await expect(ownerPage.locator("html")).toHaveAttribute("lang", "ru");
      await expect(
        ownerPanel.getByRole("heading", {
          name: "Интерфейс",
          level: 2,
          exact: true,
        }),
      ).toBeVisible();
      await expect(participantPage.locator("html")).toHaveAttribute(
        "lang",
        "es",
      );

      const participantPanel = await openBoardInterface(participantPage, {
        ...participantLocale,
        managementEntry: "Participación",
      });
      await selectLanguage(participantPage, participantPanel, "es", "English");
      await expect(participantPage.locator("html")).toHaveAttribute(
        "lang",
        "en",
      );
      await expect(
        participantPanel.getByRole("heading", {
          name: "Interface",
          level: 2,
          exact: true,
        }),
      ).toBeVisible();
      await expect(ownerPage.locator("html")).toHaveAttribute("lang", "ru");

      await expect
        .poll(async () => {
          const [ownerCookies, participantCookies] = await Promise.all([
            ownerContext.cookies(baseURL),
            participantContext.cookies(baseURL),
          ]);
          return {
            owner: ownerCookies.find(
              (cookie) => cookie.name === "badaction_locale",
            )?.value,
            participant: participantCookies.find(
              (cookie) => cookie.name === "badaction_locale",
            )?.value,
          };
        })
        .toEqual({ owner: "ru", participant: "en" });

      const [ownerAfterSwitch, participantAfterSwitch] = await Promise.all([
        fetchBoard(ownerContext, boardId),
        fetchBoard(participantContext, boardId),
      ]);
      expect(ownerAfterSwitch.revision).toBe(beforeSwitch.revision);
      expect(participantAfterSwitch.revision).toBe(beforeSwitch.revision);
      expect(compactColumns(ownerAfterSwitch)).toEqual(
        compactColumns(beforeSwitch),
      );
      expect(compactColumns(participantAfterSwitch)).toEqual(
        compactColumns(beforeSwitch),
      );
      expect(observedMutations).toEqual([]);

      await Promise.all([
        ownerPage.keyboard.press("Escape"),
        participantPage.keyboard.press("Escape"),
      ]);
      await Promise.all([
        expect(ownerPanel).toBeHidden(),
        expect(participantPanel).toBeHidden(),
      ]);

      for (const page of [ownerPage, participantPage]) {
        await expect(
          page.getByRole("heading", { name: boardTitle, level: 1 }),
        ).toBeVisible();
        for (const title of ownerLocale.defaultColumns) {
          await expect(
            page.getByRole("region", { name: title, exact: true }),
          ).toBeVisible();
        }
      }

      ownerPage.off("request", observeBoardMutation);
      participantPage.off("request", observeBoardMutation);
    } finally {
      try {
        if (boardId) {
          await deleteBoard(ownerContext, boardId, origin);
        }
      } finally {
        await Promise.allSettled([
          participantContext.close(),
          ownerContext.close(),
        ]);
      }
    }
  });
});
