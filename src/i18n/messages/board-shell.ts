import type { MessageShape } from "./types.ts";

export const boardShellEn = {
  boardShell: {
    toolbar: {
      titleLength: "Enter between 1 and 120 characters.",
      renameFailed: "Could not rename the board.",
      renameNetworkFailed: "Could not rename the board. Check your connection.",
      titleLabel: "Board name",
      saveTitle: "Save board name",
      cancelRename: "Cancel board rename",
      rename: "Rename board",
      addColumn: "Add column",
      column: "Column",
      invite: "Invite",
      currentParticipant: "Current participant: {name}",
      moreActions: "More actions",
      settings: "Settings",
      manageColumns: "Manage columns",
      manageAccess: "Manage access",
      participation: "Participation",
      export: "Export",
      retention: "Data retention",
    },
    connection: {
      ariaLabel: "Sync status: {status}",
      connectingLabel: "Connecting…",
      connectingHint: "Connecting realtime updates.",
      onlineLabel: "Online",
      onlineHint: "Changes are saved automatically.",
      reconnectingLabel: "Reconnecting…",
      reconnectingHint: "Restoring the realtime connection.",
      pollingLabel: "Periodic refresh",
      pollingHint: "The board is periodically checked against the server.",
    },
    notice: {
      readOnly:
        "The board is read-only — its content cannot be changed right now.",
      cardsAndVotingDisabled:
        "Card collection and voting have been disabled by the owner.",
      cardsDisabled:
        "Card collection is disabled, but voting remains available.",
      votingDisabled: "Voting is disabled, but cards can still be added.",
      reconnecting:
        "The realtime connection was interrupted. Changes will be checked when the connection is restored.",
      polling: "Realtime is unavailable — the board is using periodic refresh.",
      staleSnapshot: "{message} The last loaded version remains on screen.",
    },
    management: {
      title: "Board management",
      ownerDescription: "Settings, access, export, and retention in one place.",
      participantDescription:
        "Your interface, access, export, and retention information.",
      navigationLabel: "Board management sections",
      sections: {
        general: "General",
        columns: "Columns",
        access: "Access",
        participation: "Participation",
        interface: "Interface",
        export: "Export",
        about: "About",
        danger: "Dangerous actions",
      },
      interface: {
        title: "Interface",
        description:
          "Choose the language used for controls, messages, and accessibility text.",
        languageLabel: "Interface language",
        personal:
          "This is a personal setting for this browser. It does not change the board or affect other participants.",
      },
      export: {
        title: "Export",
        description: "Exports reflect the board's current state.",
        jsonDescription: "Complete board structure for processing and backup.",
        csvDescription: "Tabular data for spreadsheet applications.",
        markdownDescription: "Readable text for documents and notes.",
        download: "Download",
        downloadLabel: "Export {format}",
      },
      about: {
        title: "About this board",
        description: "Access and retention details for this retrospective.",
        name: "Name",
        access: "Your access",
        owner: "Owner",
        participant: "Participant",
        expiresAt: "Data retained until",
        sessionDescription:
          "Accounts are not used. Access is tied to this browser's anonymous session.",
        clearingData:
          "Clearing browser data will remove the current access. A participant will need a new invitation.",
      },
    },
    page: {
      accessLost: "The board was not found or access has been revoked.",
      syncFailed: "Could not sync the board.",
      syncNetworkFailed: "Could not sync the board. Check your connection.",
      loadCardsFailed: "Could not load cards.",
      wrongColumnPage: "The server returned a page for another column.",
      loadCardsNetworkFailed: "Could not load cards. Check your connection.",
      cardAdded: "Card added",
      voteNetworkFailed: "Could not vote. Check your connection.",
      removeVoteNetworkFailed:
        "Could not remove the vote. Check your connection.",
      unavailable: "Board unavailable",
      notFound: "Board not found",
      backHome: "Back to home",
    },
    dnd: {
      instructions:
        "Press Space or Enter to start moving. Use the arrow keys, then press Space or Enter to confirm. Press Escape to cancel.",
      dragStart: "Started moving: {label}.",
      dragOver: "{source} is over {target}.",
      dragCanceled: "Move canceled: {label}.",
      dragDropped: "Move completed: {label}. Saving the new position.",
      item: "Item",
      unchanged: "The position of {label} did not change.",
      changedByParticipant:
        "Move canceled. The board was changed by another participant. Try again.",
      itemMissing: "The item being moved no longer exists.",
      loadTargetColumn: "Load all cards in the target column first.",
      loadSourceColumn: "Load all cards in the source column first.",
      computeFailed: "Could not determine the new position.",
      columnsUpdated: "Column order updated",
      cardMoved: "Card moved",
      groupMoved: "Group moved",
      actionsUpdated: "Action item order updated",
      invalidRevision:
        "The order was saved, but the server returned an invalid board revision.",
      saveFailed: "Could not save the new order.",
      savedRefreshFailed:
        "The new order was saved, but the latest board state could not be loaded yet.",
      orderSaved: "{result}. New order saved.",
      canceledWithError: "Move canceled. {message}",
      saving: "Saving order",
    },
  },
} as const;

export const boardShellRu = {
  boardShell: {
    toolbar: {
      titleLength: "Введите от 1 до 120 символов.",
      renameFailed: "Не удалось переименовать доску.",
      renameNetworkFailed:
        "Не удалось переименовать доску. Проверьте соединение.",
      titleLabel: "Название доски",
      saveTitle: "Сохранить название",
      cancelRename: "Отменить переименование",
      rename: "Переименовать доску",
      addColumn: "Добавить колонку",
      column: "Колонка",
      invite: "Пригласить",
      currentParticipant: "Текущий участник: {name}",
      moreActions: "Дополнительные действия",
      settings: "Настройки",
      manageColumns: "Управление колонками",
      manageAccess: "Управление доступом",
      participation: "Участие",
      export: "Экспорт",
      retention: "Срок хранения",
    },
    connection: {
      ariaLabel: "Состояние синхронизации: {status}",
      connectingLabel: "Подключение…",
      connectingHint: "Подключаем обновления в реальном времени.",
      onlineLabel: "Онлайн",
      onlineHint: "Изменения сохраняются автоматически.",
      reconnectingLabel: "Переподключение…",
      reconnectingHint:
        "Восстанавливаем соединение для обновлений в реальном времени.",
      pollingLabel: "Резервное обновление",
      pollingHint: "Доска периодически сверяется с сервером.",
    },
    notice: {
      readOnly:
        "Доска открыта только для чтения — содержимое временно нельзя изменять.",
      cardsAndVotingDisabled:
        "Сбор карточек и голосование выключены владельцем.",
      cardsDisabled:
        "Сбор карточек выключен, но голосование остаётся доступным.",
      votingDisabled:
        "Голосование выключено, карточки по-прежнему можно добавлять.",
      reconnecting:
        "Соединение для обновлений в реальном времени прервано. Изменения будут сверены после восстановления связи.",
      polling:
        "Обновления в реальном времени недоступны — доска обновляется периодической сверкой.",
      staleSnapshot:
        "{message} Последняя загруженная версия остаётся на экране.",
    },
    management: {
      title: "Управление доской",
      ownerDescription:
        "Настройки, доступ, экспорт и срок хранения в одном месте.",
      participantDescription:
        "Ваш интерфейс, доступ, экспорт и информация о хранении.",
      navigationLabel: "Разделы управления доской",
      sections: {
        general: "Основное",
        columns: "Колонки",
        access: "Доступ",
        participation: "Участие",
        interface: "Интерфейс",
        export: "Экспорт",
        about: "О доске",
        danger: "Опасные действия",
      },
      interface: {
        title: "Интерфейс",
        description:
          "Выберите язык элементов управления, сообщений и текстов для специальных возможностей.",
        languageLabel: "Язык интерфейса",
        personal:
          "Это персональная настройка этого браузера. Она не изменяет доску и не влияет на других участников.",
      },
      export: {
        title: "Экспорт",
        description: "Выгрузка отражает актуальное состояние доски.",
        jsonDescription:
          "Полная структура доски для обработки и резервной копии.",
        csvDescription: "Табличный формат для электронных таблиц.",
        markdownDescription: "Читаемый текст для документов и заметок.",
        download: "Скачать",
        downloadLabel: "Экспорт {format}",
      },
      about: {
        title: "О доске",
        description: "Доступ и срок хранения этой ретроспективы.",
        name: "Название",
        access: "Ваш доступ",
        owner: "Владелец",
        participant: "Участник",
        expiresAt: "Данные хранятся до",
        sessionDescription:
          "Аккаунты не используются. Доступ привязан к анонимной сессии этого браузера.",
        clearingData:
          "Очистка данных браузера приведёт к потере текущего доступа. Участнику понадобится новое приглашение.",
      },
    },
    page: {
      accessLost: "Доска не найдена или доступ к ней отозван.",
      syncFailed: "Не удалось синхронизировать доску.",
      syncNetworkFailed:
        "Не удалось синхронизировать доску. Проверьте соединение.",
      loadCardsFailed: "Не удалось загрузить карточки.",
      wrongColumnPage: "Сервер вернул страницу другой колонки.",
      loadCardsNetworkFailed:
        "Не удалось загрузить карточки. Проверьте соединение.",
      cardAdded: "Карточка добавлена",
      voteNetworkFailed: "Не удалось проголосовать. Проверьте соединение.",
      removeVoteNetworkFailed: "Не удалось снять голос. Проверьте соединение.",
      unavailable: "Доска недоступна",
      notFound: "Доска не найдена",
      backHome: "Вернуться на главную",
    },
    dnd: {
      instructions:
        "Нажмите Пробел или Enter, чтобы начать перемещение. Используйте стрелки, затем Пробел или Enter для подтверждения. Escape отменяет перемещение.",
      dragStart: "Начато перемещение: {label}.",
      dragOver: "{source} над {target}.",
      dragCanceled: "Перемещение отменено: {label}.",
      dragDropped: "Перемещение завершено: {label}. Сохраняем новое положение.",
      item: "Элемент",
      unchanged: "Позиция {label} не изменена.",
      changedByParticipant:
        "Перемещение отменено. Доска изменилась у другого участника. Повторите действие.",
      itemMissing: "Перемещаемый элемент больше не существует.",
      loadTargetColumn: "Сначала загрузите все карточки целевой колонки.",
      loadSourceColumn: "Сначала загрузите все карточки исходной колонки.",
      computeFailed: "Не удалось вычислить новую позицию.",
      columnsUpdated: "Порядок колонок обновлён",
      cardMoved: "Карточка перемещена",
      groupMoved: "Группа перемещена",
      actionsUpdated: "Порядок решений обновлён",
      invalidRevision:
        "Порядок сохранён, но сервер вернул некорректную версию доски.",
      saveFailed: "Не удалось сохранить новый порядок.",
      savedRefreshFailed:
        "Новый порядок сохранён, но получить актуальное состояние доски пока не удалось.",
      orderSaved: "{result}. Новый порядок сохранён.",
      canceledWithError: "Перемещение отменено. {message}",
      saving: "Сохраняем порядок",
    },
  },
} satisfies MessageShape<typeof boardShellEn>;

export const boardShellEs = {
  boardShell: {
    toolbar: {
      titleLength: "Escribe entre 1 y 120 caracteres.",
      renameFailed: "No se pudo cambiar el nombre del tablero.",
      renameNetworkFailed:
        "No se pudo cambiar el nombre del tablero. Comprueba tu conexión.",
      titleLabel: "Nombre del tablero",
      saveTitle: "Guardar el nombre del tablero",
      cancelRename: "Cancelar el cambio de nombre",
      rename: "Cambiar el nombre del tablero",
      addColumn: "Añadir columna",
      column: "Columna",
      invite: "Invitar",
      currentParticipant: "Participante actual: {name}",
      moreActions: "Más acciones",
      settings: "Configuración",
      manageColumns: "Gestionar columnas",
      manageAccess: "Gestionar acceso",
      participation: "Participación",
      export: "Exportar",
      retention: "Conservación de datos",
    },
    connection: {
      ariaLabel: "Estado de sincronización: {status}",
      connectingLabel: "Conectando…",
      connectingHint: "Conectando las actualizaciones en tiempo real.",
      onlineLabel: "En línea",
      onlineHint: "Los cambios se guardan automáticamente.",
      reconnectingLabel: "Reconectando…",
      reconnectingHint: "Restableciendo la conexión en tiempo real.",
      pollingLabel: "Actualización periódica",
      pollingHint: "El tablero se comprueba periódicamente con el servidor.",
    },
    notice: {
      readOnly:
        "El tablero es de solo lectura; su contenido no se puede cambiar ahora.",
      cardsAndVotingDisabled:
        "La persona propietaria ha desactivado las tarjetas y la votación.",
      cardsDisabled:
        "Las tarjetas están desactivadas, pero la votación sigue disponible.",
      votingDisabled:
        "La votación está desactivada, pero aún se pueden añadir tarjetas.",
      reconnecting:
        "La conexión en tiempo real se interrumpió. Los cambios se comprobarán cuando se restablezca.",
      polling:
        "La conexión en tiempo real no está disponible; el tablero usa actualizaciones periódicas.",
      staleSnapshot:
        "{message} La última versión cargada permanece en pantalla.",
    },
    management: {
      title: "Gestión del tablero",
      ownerDescription:
        "Configuración, acceso, exportación y conservación en un solo lugar.",
      participantDescription:
        "Tu interfaz, acceso, exportación e información de conservación.",
      navigationLabel: "Secciones de gestión del tablero",
      sections: {
        general: "General",
        columns: "Columnas",
        access: "Acceso",
        participation: "Participación",
        interface: "Interfaz",
        export: "Exportar",
        about: "Acerca del tablero",
        danger: "Acciones peligrosas",
      },
      interface: {
        title: "Interfaz",
        description:
          "Elige el idioma de los controles, mensajes y textos de accesibilidad.",
        languageLabel: "Idioma de la interfaz",
        personal:
          "Esta es una preferencia personal de este navegador. No cambia el tablero ni afecta a otras personas.",
      },
      export: {
        title: "Exportar",
        description: "Las exportaciones reflejan el estado actual del tablero.",
        jsonDescription:
          "Estructura completa del tablero para procesarla y guardarla.",
        csvDescription:
          "Datos tabulares para aplicaciones de hojas de cálculo.",
        markdownDescription: "Texto legible para documentos y notas.",
        download: "Descargar",
        downloadLabel: "Exportar {format}",
      },
      about: {
        title: "Acerca del tablero",
        description: "Detalles de acceso y conservación de esta retrospectiva.",
        name: "Nombre",
        access: "Tu acceso",
        owner: "Propietario",
        participant: "Participante",
        expiresAt: "Datos conservados hasta",
        sessionDescription:
          "No se usan cuentas. El acceso está vinculado a la sesión anónima de este navegador.",
        clearingData:
          "Al borrar los datos del navegador se perderá el acceso actual. Un participante necesitará una invitación nueva.",
      },
    },
    page: {
      accessLost: "No se encontró el tablero o se revocó el acceso.",
      syncFailed: "No se pudo sincronizar el tablero.",
      syncNetworkFailed:
        "No se pudo sincronizar el tablero. Comprueba tu conexión.",
      loadCardsFailed: "No se pudieron cargar las tarjetas.",
      wrongColumnPage: "El servidor devolvió una página de otra columna.",
      loadCardsNetworkFailed:
        "No se pudieron cargar las tarjetas. Comprueba tu conexión.",
      cardAdded: "Tarjeta añadida",
      voteNetworkFailed: "No se pudo votar. Comprueba tu conexión.",
      removeVoteNetworkFailed:
        "No se pudo retirar el voto. Comprueba tu conexión.",
      unavailable: "Tablero no disponible",
      notFound: "Tablero no encontrado",
      backHome: "Volver al inicio",
    },
    dnd: {
      instructions:
        "Pulsa Espacio o Intro para empezar a mover. Usa las flechas y pulsa Espacio o Intro para confirmar. Pulsa Escape para cancelar.",
      dragStart: "Movimiento iniciado: {label}.",
      dragOver: "{source} está sobre {target}.",
      dragCanceled: "Movimiento cancelado: {label}.",
      dragDropped:
        "Movimiento completado: {label}. Guardando la nueva posición.",
      item: "Elemento",
      unchanged: "La posición de {label} no cambió.",
      changedByParticipant:
        "Movimiento cancelado. Otra persona cambió el tablero. Inténtalo de nuevo.",
      itemMissing: "El elemento que se estaba moviendo ya no existe.",
      loadTargetColumn:
        "Carga primero todas las tarjetas de la columna de destino.",
      loadSourceColumn:
        "Carga primero todas las tarjetas de la columna de origen.",
      computeFailed: "No se pudo determinar la nueva posición.",
      columnsUpdated: "Orden de las columnas actualizado",
      cardMoved: "Tarjeta movida",
      groupMoved: "Grupo movido",
      actionsUpdated: "Orden de las acciones actualizado",
      invalidRevision:
        "El orden se guardó, pero el servidor devolvió una revisión del tablero no válida.",
      saveFailed: "No se pudo guardar el nuevo orden.",
      savedRefreshFailed:
        "El nuevo orden se guardó, pero aún no se pudo cargar el estado más reciente del tablero.",
      orderSaved: "{result}. Nuevo orden guardado.",
      canceledWithError: "Movimiento cancelado. {message}",
      saving: "Guardando el orden",
    },
  },
} satisfies MessageShape<typeof boardShellEn>;
