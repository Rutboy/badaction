import { plural, type MessageShape } from "./types.ts";

export const coreEn = {
  metadata: {
    title: "Sprint retrospective",
    description: "A lightweight retrospective board with no registration",
    joinTitle: "Join board",
  },
  common: {
    productName: "badaction",
    cancel: "Cancel",
    close: "Close",
    save: "Save",
    saving: "Saving…",
    delete: "Delete",
    edit: "Edit",
    add: "Add",
    create: "Create",
    download: "Download",
    copy: "Copy",
    copied: "Copied",
    loading: "Loading…",
    retry: "Try again",
    backHome: "Back to home",
    yes: "yes",
    no: "no",
    enabled: "enabled",
    disabled: "disabled",
    unnamed: "Untitled",
  },
  language: {
    label: "Language",
    menuLabel: "Choose interface language",
    current: "Current language: {language}",
  },
  memberDefaults: {
    owner: "Owner",
    participant: "Participant",
  },
  defaultColumns: {
    wentWell: "Went well",
    couldImprove: "Could improve",
  },
  export: {
    createdAt: "Created",
    expiresAt: "Expires",
    cards: "Cards",
    voting: "Voting",
    readOnly: "Read-only",
    group: "Group",
    primary: "primary",
    author: "Author",
    votes: "Votes",
    noCards: "No cards.",
    columnHeading: "{title} (vote limit: {count})",
    actionItems: "Action items",
    noActionItems: "No action items.",
    assignee: "Assignee",
  },
  home: {
    title: "A simple retrospective for your team",
    description:
      "Collect feedback, vote on what matters, and capture action items on one board.",
    privacy: "No registration. Data is retained for a limited time.",
    boardTitleLabel: "Retrospective name",
    boardTitlePlaceholder: "For example, Team retro for July",
    create: "Create board",
    creating: "Creating…",
    titleRequired: "Enter a retrospective name.",
    createFailed: "Could not create the board. Try again.",
    accessibleBoards: "Your boards",
    accessibleBoardsDescription: "Active boards available in this browser.",
    ownerRole: "Owner",
    participantRole: "Participant",
    expiresAt: "Available until {date}",
    openBoard: "Open board “{title}”",
  },
  join: {
    title: "Join the retrospective",
    description: "Confirm the invitation. Adding your name is optional.",
    nameLabel: "Your name (optional)",
    namePlaceholder: "For example, Alex",
    submit: "Join",
    submitting: "Checking invitation…",
    invalidInvitation: "The invitation is missing or invalid.",
    redeemFailed: "Could not accept the invitation.",
    redeemNetworkFailed:
      "Could not accept the invitation. Check your connection.",
  },
  notFound: {
    page: "Page not found",
    board: "Board not found",
    boardUnavailable: "Board unavailable",
    boardDescription:
      "The board does not exist, has expired, or your access was revoked.",
  },
  serviceUnavailable: {
    eyebrow: "Service unavailable",
    title: "The board could not be loaded",
    description:
      "The service is temporarily unavailable. Try again in a few moments.",
  },
  errorBoundary: {
    title: "Something went wrong",
    description: "The page could not be loaded. Try again.",
    retry: "Try again",
  },
  errors: {
    unknown: "Something went wrong. Try again.",
    invalidResponse: "The server returned an invalid response. Try again.",
    network: "Check your connection and try again.",
    api: {
      VALIDATION_ERROR: "Check the entered information and try again.",
      INVALID_CURSOR: "This page marker is invalid or out of date.",
      BOARD_OWNER_REQUIRED: "Only the board owner can perform this action.",
      CARD_OWNER_REQUIRED:
        "You can only change cards created with your current access.",
      BOARD_NOT_FOUND: "The board was not found or access has been revoked.",
      COLUMN_NOT_FOUND: "The column was not found.",
      CARD_NOT_FOUND: "The card was not found.",
      GROUP_NOT_FOUND: "The group was not found.",
      ACTION_ITEM_NOT_FOUND: "The action item was not found.",
      STALE_BOARD_REVISION: "The board changed. Refresh it and try again.",
      BOARD_READ_ONLY: "The board is read-only.",
      CARDS_DISABLED: "Cards are disabled on this board.",
      VOTING_DISABLED: "Voting is disabled on this board.",
      VOTE_LIMIT_CONFLICT:
        "The new limit is below the number of votes already used.",
      VOTE_MOVE_CONFLICT:
        "Moving this item would exceed the target column's vote limit.",
      CARD_GROUPED: "Ungroup the card before moving it on its own.",
      COLUMN_NOT_EMPTY: "The column contains cards. Choose how to handle them.",
      LAST_COLUMN_DELETE_FORBIDDEN: "The final board column cannot be deleted.",
      BOARD_CARD_LIMIT_REACHED: "This board has reached its card limit.",
      BOARD_COLUMN_LIMIT_REACHED: "This board has reached its column limit.",
      BOARD_ACTION_ITEM_LIMIT_REACHED:
        "This board has reached its action item limit.",
      COLUMN_VOTE_LIMIT_REACHED: "No votes remain in this column.",
      BOARD_EXPORT_LIMIT_EXCEEDED: "This board is too large to export safely.",
      ANONYMOUS_SESSION_INACTIVE:
        "Your anonymous session is no longer active. Refresh and try again.",
      SESSION_BOARD_LIMIT_REACHED:
        "This browser has reached its active board limit.",
      BOARD_INVITATION_HISTORY_LIMIT_REACHED:
        "This board has reached its invitation history limit.",
      BOARD_INVITATION_LIMIT_REACHED:
        "This board has reached its active invitation limit.",
      BOARD_MEMBERSHIP_HISTORY_LIMIT_REACHED:
        "This board has reached its membership history limit.",
      BOARD_OWNER_ALREADY_EXISTS: "This board already has an owner.",
      BOARD_PARTICIPANT_LIMIT_REACHED:
        "This board has reached its participant limit.",
      INVITATION_INVALID:
        "This invitation is invalid, expired, or has already been used.",
      INVITATION_NOT_FOUND: "The invitation was not found.",
      MEMBERSHIP_NOT_FOUND: "The participant was not found.",
      OWNER_CANNOT_LEAVE: "The board owner cannot leave the board.",
      LIKES_NOT_ALLOWED: "Voting is not available in this column.",
      LIKE_ALREADY_EXISTS: "You have already voted for this card.",
      DATABASE_UNAVAILABLE: "The service is temporarily unavailable.",
      RATE_LIMIT_EXCEEDED: "Too many requests. Try again later.",
      FORBIDDEN_ORIGIN: "This request is not allowed.",
      INVALID_CONTENT_LENGTH: "The request size is invalid.",
      INVALID_JSON: "The request contains invalid JSON.",
      PAYLOAD_TOO_LARGE: "The request is too large.",
      UNEXPECTED_REQUEST_BODY: "This request must not contain a body.",
      UNSUPPORTED_MEDIA_TYPE: "The request must use application/json.",
      INTERNAL_ERROR: "An internal server error occurred.",
    },
  },
  counts: {
    items: plural({ one: "{count} item", other: "{count} items" }),
    votes: plural({ one: "{count} vote", other: "{count} votes" }),
    participants: plural({
      one: "{count} participant",
      other: "{count} participants",
    }),
    cards: plural({ one: "{count} card", other: "{count} cards" }),
    actionItems: plural({
      one: "{count} action item",
      other: "{count} action items",
    }),
  },
} as const;

export const coreRu = {
  metadata: {
    title: "Ретроспектива спринта",
    description: "Минималистичная доска ретроспективы без регистрации",
    joinTitle: "Войти на доску",
  },
  common: {
    productName: "badaction",
    cancel: "Отмена",
    close: "Закрыть",
    save: "Сохранить",
    saving: "Сохраняем…",
    delete: "Удалить",
    edit: "Изменить",
    add: "Добавить",
    create: "Создать",
    download: "Скачать",
    copy: "Копировать",
    copied: "Скопировано",
    loading: "Загрузка…",
    retry: "Повторить",
    backHome: "Вернуться на главную",
    yes: "да",
    no: "нет",
    enabled: "включено",
    disabled: "выключено",
    unnamed: "Без названия",
  },
  language: {
    label: "Язык",
    menuLabel: "Выбрать язык интерфейса",
    current: "Текущий язык: {language}",
  },
  memberDefaults: {
    owner: "Владелец",
    participant: "Участник",
  },
  defaultColumns: {
    wentWell: "Что прошло хорошо",
    couldImprove: "Что можно улучшить",
  },
  export: {
    createdAt: "Создана",
    expiresAt: "Истекает",
    cards: "Карточки",
    voting: "Голосование",
    readOnly: "Только чтение",
    group: "Группа",
    primary: "основная",
    author: "Автор",
    votes: "Голоса",
    noCards: "Нет карточек.",
    columnHeading: "{title} (лимит голосов: {count})",
    actionItems: "Решения",
    noActionItems: "Нет решений.",
    assignee: "Ответственный",
  },
  home: {
    title: "Простая ретроспектива для вашей команды",
    description:
      "Соберите обратную связь, проголосуйте за важное и зафиксируйте решения на одной доске.",
    privacy: "Без регистрации. Данные хранятся ограниченное время.",
    boardTitleLabel: "Название ретроспективы",
    boardTitlePlaceholder: "Например, Ретро команды за июль",
    create: "Создать доску",
    creating: "Создаём…",
    titleRequired: "Введите название ретроспективы.",
    createFailed: "Не удалось создать доску. Попробуйте ещё раз.",
    accessibleBoards: "Ваши доски",
    accessibleBoardsDescription: "Активные доски, доступные в этом браузере.",
    ownerRole: "Владелец",
    participantRole: "Участник",
    expiresAt: "Доступна до {date}",
    openBoard: "Открыть доску «{title}»",
  },
  join: {
    title: "Присоединиться к ретроспективе",
    description:
      "Подтвердите вход по приглашению. Имя указывать необязательно.",
    nameLabel: "Ваше имя (необязательно)",
    namePlaceholder: "Например, Алексей",
    submit: "Присоединиться",
    submitting: "Проверяем приглашение…",
    invalidInvitation: "Приглашение отсутствует или повреждено.",
    redeemFailed: "Не удалось принять приглашение.",
    redeemNetworkFailed:
      "Не удалось принять приглашение. Проверьте соединение.",
  },
  notFound: {
    page: "Страница не найдена",
    board: "Доска не найдена",
    boardUnavailable: "Доска недоступна",
    boardDescription:
      "Доска не существует, срок хранения истёк или ваш доступ был отозван.",
  },
  serviceUnavailable: {
    eyebrow: "Сервис недоступен",
    title: "Не удалось загрузить доску",
    description:
      "Сервис временно недоступен. Повторите попытку через несколько минут.",
  },
  errorBoundary: {
    title: "Что-то пошло не так",
    description: "Не удалось загрузить страницу. Повторите попытку.",
    retry: "Повторить",
  },
  errors: {
    unknown: "Что-то пошло не так. Попробуйте ещё раз.",
    invalidResponse: "Сервер вернул некорректный ответ. Попробуйте ещё раз.",
    network: "Проверьте соединение и повторите попытку.",
    api: {
      VALIDATION_ERROR: "Проверьте введённые данные и повторите попытку.",
      INVALID_CURSOR: "Указатель страницы некорректен или устарел.",
      BOARD_OWNER_REQUIRED: "Это действие доступно только владельцу доски.",
      CARD_OWNER_REQUIRED:
        "Можно изменять только карточки, созданные с текущим доступом.",
      BOARD_NOT_FOUND: "Доска не найдена или доступ к ней отозван.",
      COLUMN_NOT_FOUND: "Колонка не найдена.",
      CARD_NOT_FOUND: "Карточка не найдена.",
      GROUP_NOT_FOUND: "Группа не найдена.",
      ACTION_ITEM_NOT_FOUND: "Решение не найдено.",
      STALE_BOARD_REVISION:
        "Доска изменилась. Обновите данные и повторите действие.",
      BOARD_READ_ONLY: "Доска находится в режиме только для чтения.",
      CARDS_DISABLED: "Работа с карточками на этой доске отключена.",
      VOTING_DISABLED: "Голосование на этой доске отключено.",
      VOTE_LIMIT_CONFLICT:
        "Новый лимит меньше уже использованного количества голосов.",
      VOTE_MOVE_CONFLICT: "Перемещение превысит лимит голосов целевой колонки.",
      CARD_GROUPED: "Сначала разъедините группу, чтобы переместить карточку.",
      COLUMN_NOT_EMPTY:
        "Колонка содержит карточки. Выберите, что с ними сделать.",
      LAST_COLUMN_DELETE_FORBIDDEN: "Нельзя удалить последнюю колонку доски.",
      BOARD_CARD_LIMIT_REACHED: "На доске достигнут лимит карточек.",
      BOARD_COLUMN_LIMIT_REACHED: "На доске достигнут лимит колонок.",
      BOARD_ACTION_ITEM_LIMIT_REACHED: "На доске достигнут лимит решений.",
      COLUMN_VOTE_LIMIT_REACHED:
        "В этой колонке не осталось доступных голосов.",
      BOARD_EXPORT_LIMIT_EXCEEDED:
        "Доска слишком велика для безопасного экспорта.",
      ANONYMOUS_SESSION_INACTIVE:
        "Анонимная сессия больше не активна. Обновите страницу и повторите запрос.",
      SESSION_BOARD_LIMIT_REACHED:
        "В этом браузере достигнут лимит активных досок.",
      BOARD_INVITATION_HISTORY_LIMIT_REACHED:
        "На доске достигнут лимит истории приглашений.",
      BOARD_INVITATION_LIMIT_REACHED:
        "На доске достигнут лимит активных приглашений.",
      BOARD_MEMBERSHIP_HISTORY_LIMIT_REACHED:
        "На доске достигнут лимит истории участников.",
      BOARD_OWNER_ALREADY_EXISTS: "У этой доски уже есть владелец.",
      BOARD_PARTICIPANT_LIMIT_REACHED: "На доске достигнут лимит участников.",
      INVITATION_INVALID:
        "Приглашение некорректно, истекло или уже использовано.",
      INVITATION_NOT_FOUND: "Приглашение не найдено.",
      MEMBERSHIP_NOT_FOUND: "Участник не найден.",
      OWNER_CANNOT_LEAVE: "Владелец не может покинуть доску.",
      LIKES_NOT_ALLOWED: "Голосование в этой колонке недоступно.",
      LIKE_ALREADY_EXISTS: "Вы уже проголосовали за эту карточку.",
      DATABASE_UNAVAILABLE: "Сервис временно недоступен.",
      RATE_LIMIT_EXCEEDED: "Слишком много запросов. Попробуйте позже.",
      FORBIDDEN_ORIGIN: "Этот запрос запрещён.",
      INVALID_CONTENT_LENGTH: "Размер запроса некорректен.",
      INVALID_JSON: "Запрос содержит некорректный JSON.",
      PAYLOAD_TOO_LARGE: "Запрос слишком большой.",
      UNEXPECTED_REQUEST_BODY: "Этот запрос не должен содержать тело.",
      UNSUPPORTED_MEDIA_TYPE: "Запрос должен использовать application/json.",
      INTERNAL_ERROR: "Произошла внутренняя ошибка сервера.",
    },
  },
  counts: {
    items: plural({
      one: "{count} элемент",
      few: "{count} элемента",
      many: "{count} элементов",
      other: "{count} элемента",
    }),
    votes: plural({
      one: "{count} голос",
      few: "{count} голоса",
      many: "{count} голосов",
      other: "{count} голоса",
    }),
    participants: plural({
      one: "{count} участник",
      few: "{count} участника",
      many: "{count} участников",
      other: "{count} участника",
    }),
    cards: plural({
      one: "{count} карточка",
      few: "{count} карточки",
      many: "{count} карточек",
      other: "{count} карточки",
    }),
    actionItems: plural({
      one: "{count} решение",
      few: "{count} решения",
      many: "{count} решений",
      other: "{count} решения",
    }),
  },
} satisfies MessageShape<typeof coreEn>;

export const coreEs = {
  metadata: {
    title: "Retrospectiva de sprint",
    description: "Un tablero de retrospectiva sencillo y sin registro",
    joinTitle: "Unirse al tablero",
  },
  common: {
    productName: "badaction",
    cancel: "Cancelar",
    close: "Cerrar",
    save: "Guardar",
    saving: "Guardando…",
    delete: "Eliminar",
    edit: "Editar",
    add: "Añadir",
    create: "Crear",
    download: "Descargar",
    copy: "Copiar",
    copied: "Copiado",
    loading: "Cargando…",
    retry: "Reintentar",
    backHome: "Volver al inicio",
    yes: "sí",
    no: "no",
    enabled: "activado",
    disabled: "desactivado",
    unnamed: "Sin título",
  },
  language: {
    label: "Idioma",
    menuLabel: "Elegir el idioma de la interfaz",
    current: "Idioma actual: {language}",
  },
  memberDefaults: {
    owner: "Propietario",
    participant: "Participante",
  },
  defaultColumns: {
    wentWell: "Salió bien",
    couldImprove: "Se puede mejorar",
  },
  export: {
    createdAt: "Creado",
    expiresAt: "Caduca",
    cards: "Tarjetas",
    voting: "Votación",
    readOnly: "Solo lectura",
    group: "Grupo",
    primary: "principal",
    author: "Autor",
    votes: "Votos",
    noCards: "No hay tarjetas.",
    columnHeading: "{title} (límite de votos: {count})",
    actionItems: "Acciones",
    noActionItems: "No hay acciones.",
    assignee: "Responsable",
  },
  home: {
    title: "Una retrospectiva sencilla para tu equipo",
    description:
      "Recopila comentarios, vota lo más importante y registra las acciones en un solo tablero.",
    privacy: "Sin registro. Los datos se conservan durante un tiempo limitado.",
    boardTitleLabel: "Nombre de la retrospectiva",
    boardTitlePlaceholder: "Por ejemplo, Retrospectiva del equipo de julio",
    create: "Crear tablero",
    creating: "Creando…",
    titleRequired: "Escribe un nombre para la retrospectiva.",
    createFailed: "No se pudo crear el tablero. Inténtalo de nuevo.",
    accessibleBoards: "Tus tableros",
    accessibleBoardsDescription:
      "Tableros activos disponibles en este navegador.",
    ownerRole: "Propietario",
    participantRole: "Participante",
    expiresAt: "Disponible hasta el {date}",
    openBoard: "Abrir el tablero «{title}»",
  },
  join: {
    title: "Unirse a la retrospectiva",
    description: "Confirma la invitación. Indicar tu nombre es opcional.",
    nameLabel: "Tu nombre (opcional)",
    namePlaceholder: "Por ejemplo, Alex",
    submit: "Unirse",
    submitting: "Comprobando la invitación…",
    invalidInvitation: "La invitación no existe o no es válida.",
    redeemFailed: "No se pudo aceptar la invitación.",
    redeemNetworkFailed:
      "No se pudo aceptar la invitación. Comprueba tu conexión.",
  },
  notFound: {
    page: "Página no encontrada",
    board: "Tablero no encontrado",
    boardUnavailable: "Tablero no disponible",
    boardDescription:
      "El tablero no existe, ha caducado o se ha revocado tu acceso.",
  },
  serviceUnavailable: {
    eyebrow: "Servicio no disponible",
    title: "No se pudo cargar el tablero",
    description:
      "El servicio no está disponible temporalmente. Inténtalo de nuevo en unos minutos.",
  },
  errorBoundary: {
    title: "Algo salió mal",
    description: "No se pudo cargar la página. Inténtalo de nuevo.",
    retry: "Intentar de nuevo",
  },
  errors: {
    unknown: "Algo salió mal. Inténtalo de nuevo.",
    invalidResponse:
      "El servidor devolvió una respuesta no válida. Inténtalo de nuevo.",
    network: "Comprueba tu conexión e inténtalo de nuevo.",
    api: {
      VALIDATION_ERROR:
        "Comprueba los datos introducidos e inténtalo de nuevo.",
      INVALID_CURSOR:
        "El marcador de página no es válido o está desactualizado.",
      BOARD_OWNER_REQUIRED:
        "Solo la persona propietaria puede realizar esta acción.",
      CARD_OWNER_REQUIRED:
        "Solo puedes cambiar las tarjetas creadas con tu acceso actual.",
      BOARD_NOT_FOUND: "No se encontró el tablero o se revocó el acceso.",
      COLUMN_NOT_FOUND: "No se encontró la columna.",
      CARD_NOT_FOUND: "No se encontró la tarjeta.",
      GROUP_NOT_FOUND: "No se encontró el grupo.",
      ACTION_ITEM_NOT_FOUND: "No se encontró la acción.",
      STALE_BOARD_REVISION:
        "El tablero cambió. Actualízalo e inténtalo de nuevo.",
      BOARD_READ_ONLY: "El tablero es de solo lectura.",
      CARDS_DISABLED: "Las tarjetas están desactivadas en este tablero.",
      VOTING_DISABLED: "La votación está desactivada en este tablero.",
      VOTE_LIMIT_CONFLICT:
        "El nuevo límite es inferior al número de votos ya usados.",
      VOTE_MOVE_CONFLICT:
        "El movimiento superaría el límite de votos de la columna de destino.",
      CARD_GROUPED: "Separa la tarjeta del grupo antes de moverla por sí sola.",
      COLUMN_NOT_EMPTY:
        "La columna contiene tarjetas. Elige qué hacer con ellas.",
      LAST_COLUMN_DELETE_FORBIDDEN:
        "No se puede eliminar la última columna del tablero.",
      BOARD_CARD_LIMIT_REACHED:
        "El tablero ha alcanzado el límite de tarjetas.",
      BOARD_COLUMN_LIMIT_REACHED:
        "El tablero ha alcanzado el límite de columnas.",
      BOARD_ACTION_ITEM_LIMIT_REACHED:
        "El tablero ha alcanzado el límite de acciones.",
      COLUMN_VOTE_LIMIT_REACHED: "No quedan votos en esta columna.",
      BOARD_EXPORT_LIMIT_EXCEEDED:
        "El tablero es demasiado grande para exportarlo de forma segura.",
      ANONYMOUS_SESSION_INACTIVE:
        "Tu sesión anónima ya no está activa. Actualiza la página e inténtalo de nuevo.",
      SESSION_BOARD_LIMIT_REACHED:
        "Este navegador ha alcanzado el límite de tableros activos.",
      BOARD_INVITATION_HISTORY_LIMIT_REACHED:
        "El tablero ha alcanzado el límite del historial de invitaciones.",
      BOARD_INVITATION_LIMIT_REACHED:
        "El tablero ha alcanzado el límite de invitaciones activas.",
      BOARD_MEMBERSHIP_HISTORY_LIMIT_REACHED:
        "El tablero ha alcanzado el límite del historial de participantes.",
      BOARD_OWNER_ALREADY_EXISTS: "Este tablero ya tiene propietario.",
      BOARD_PARTICIPANT_LIMIT_REACHED:
        "El tablero ha alcanzado el límite de participantes.",
      INVITATION_INVALID:
        "La invitación no es válida, ha caducado o ya se ha utilizado.",
      INVITATION_NOT_FOUND: "No se encontró la invitación.",
      MEMBERSHIP_NOT_FOUND: "No se encontró a la persona participante.",
      OWNER_CANNOT_LEAVE:
        "La persona propietaria no puede abandonar el tablero.",
      LIKES_NOT_ALLOWED: "La votación no está disponible en esta columna.",
      LIKE_ALREADY_EXISTS: "Ya has votado por esta tarjeta.",
      DATABASE_UNAVAILABLE: "El servicio no está disponible temporalmente.",
      RATE_LIMIT_EXCEEDED: "Demasiadas solicitudes. Inténtalo más tarde.",
      FORBIDDEN_ORIGIN: "Esta solicitud no está permitida.",
      INVALID_CONTENT_LENGTH: "El tamaño de la solicitud no es válido.",
      INVALID_JSON: "La solicitud contiene JSON no válido.",
      PAYLOAD_TOO_LARGE: "La solicitud es demasiado grande.",
      UNEXPECTED_REQUEST_BODY: "Esta solicitud no debe contener un cuerpo.",
      UNSUPPORTED_MEDIA_TYPE: "La solicitud debe usar application/json.",
      INTERNAL_ERROR: "Se produjo un error interno del servidor.",
    },
  },
  counts: {
    items: plural({ one: "{count} elemento", other: "{count} elementos" }),
    votes: plural({ one: "{count} voto", other: "{count} votos" }),
    participants: plural({
      one: "{count} participante",
      other: "{count} participantes",
    }),
    cards: plural({ one: "{count} tarjeta", other: "{count} tarjetas" }),
    actionItems: plural({ one: "{count} acción", other: "{count} acciones" }),
  },
} satisfies MessageShape<typeof coreEn>;
