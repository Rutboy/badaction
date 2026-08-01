import { plural, type MessageShape } from "./types.ts";

export const settingsEn = {
  settings: {
    errors: {
      savedRefreshFailed:
        "The change was saved, but the board could not be refreshed. Check your connection.",
      actionFailed: "Could not complete the action.",
      saveBoard: "Could not save the board settings.",
      createColumn: "Could not create the column.",
      saveColumn: "Could not save the column.",
      deleteColumn: "Could not delete the column.",
      resetVotes: "Could not reset the votes.",
    },
    general: {
      heading: "General",
      description: "Retrospective name and operating modes.",
      boardTitle: "Board name",
      titleValidation: "Enter between 1 and 120 characters.",
      modesLegend: "Board modes",
      cardsTitle: "Card collection",
      cardsDescription:
        "The team can add and edit the cards available to them.",
      votingTitle: "Voting",
      votingDescription:
        "Participants can add and remove votes within each column's limit.",
      readOnlyTitle: "Read-only",
      readOnlyDescription:
        "Content cannot be changed, but export and access management remain available.",
      unsaved: "There are unsaved changes",
      saved: "All changes are saved",
      saveButton: "Save settings",
      savedToast: "Board settings saved",
    },
    columns: {
      heading: "Columns",
      description: "Configure each column's name and vote limit separately.",
      readOnlyNotice: "Turn off Read-only in General to change columns.",
      titleLabel: "Name",
      voteLimitLabel: "Votes",
      itemCount: plural({
        one: "{formattedCount} item",
        other: "{formattedCount} items",
      }),
      deleteButton: "Delete",
      saveButton: "Save",
      newHeading: "New column",
      newDescription: "It will appear before the fixed Action items column.",
      addButton: "Add column",
      createdToast: "Column created",
      updatedToast: "Column updated",
      enableCardsFirst:
        "Enable and save card collection before handling this column's contents.",
      deleteTitle: "Delete column?",
      deleteNamedDescription: "Column “{column}” will be deleted.",
      deleteDescription: "The column will be deleted.",
      strategyLabel: "What to do with the contents",
      chooseAction: "Choose an action",
      moveCards: "Move to another column",
      deleteCards: "Delete with the cards",
      targetLabel: "Target column",
      chooseTarget: "Choose a column",
      moveLimitWarning:
        "The move will be canceled if the votes exceed the target column's limit.",
      deleteToken: "DELETE",
      deleteTokenPrompt: "Type {token}",
      emptyDescription: "The column is empty. This cannot be undone.",
      deleteConfirmButton: "Delete column",
      deletedToast: "Column deleted",
    },
    danger: {
      heading: "Danger zone",
      description: "These changes cannot be undone.",
      resetTitle: "Reset all votes",
      resetDescription: "Removes votes from every feedback column.",
      resetButton: "Reset",
      resetUnavailable: "Reset is unavailable while Read-only mode is enabled.",
      confirmTitle: "Reset all votes?",
      confirmDescription:
        "Votes in every column will be deleted and cannot be recovered.",
      resetToken: "RESET",
      resetTokenPrompt: "Type {token} to confirm",
      confirmButton: "Reset votes",
      resetToast: "All votes reset",
    },
  },
  access: {
    errors: {
      load: "Could not load the access settings.",
      loadNetwork: "Could not load the access settings. Check your connection.",
      invalidMaxUses: "Enter a whole number from {min} to {max}.",
      createInvitation: "Could not create the invitation.",
      createInvitationNetwork:
        "Could not create the invitation. Check your connection.",
      copy: "The browser could not copy the link. Select and copy it manually.",
      revokeInvitation: "Could not revoke the invitation.",
      revokeInvitationNetwork:
        "Could not revoke the invitation. Check your connection.",
      revokeParticipant: "Could not revoke the participant's access.",
      revokeParticipantNetwork:
        "Could not revoke the participant's access. Check your connection.",
      leave: "Could not leave the board.",
      leaveNetwork: "Could not leave the board. Check your connection.",
      deleteBoard: "Could not delete the board.",
      deleteBoardNetwork: "Could not delete the board. Check your connection.",
      displayNameValidation: "Enter between 1 and 80 characters.",
      rename: "Could not change the name.",
      renameNetwork: "Could not change the name. Check your connection.",
    },
    profile: {
      heading: "Your name",
      description: "It is shown on this board and is not linked to an account.",
      inputLabel: "Your name on the board",
      save: "Save",
      savedToast: "Name changed",
    },
    danger: {
      heading: "Delete board",
      description:
        "Cards, votes, action items, invitations, and access grants will be deleted.",
      openButton: "Delete",
      confirmTitle: "Delete board?",
      confirmDescription:
        "The data and every access grant will be permanently deleted.",
      deleteToken: "DELETE",
      tokenPrompt: "Type {token} to confirm",
      confirmationLabel: "Board deletion confirmation",
      confirmButton: "Delete board",
    },
    participation: {
      heading: "Participation",
      current: "You are participating as {name}.",
      leaveTitle: "Leave board",
      leaveDescription:
        "You will need a new invitation from the owner to return.",
      leaveOpenButton: "Leave",
      confirmTitle: "Leave board?",
      confirmDescription:
        "Your current anonymous access will be revoked. The board link alone will not restore it.",
      confirmButton: "Leave board",
    },
    invitation: {
      heading: "Access",
      description: "Create one link for the number of participants you need.",
      maxUsesLabel: "Number of entries",
      createLink: "Create link",
      createdToast: plural({
        one: "Invitation for {formattedCount} entry created",
        other: "Invitation for {formattedCount} entries created",
      }),
      copiedToast: "Link copied",
      freshLabel: "This link is shown only now",
      freshDescription: plural({
        one: "{formattedCount} entry is available. You can revoke the link at any time. Anyone with it can claim the available entry.",
        other:
          "{formattedCount} entries are available. You can revoke the link at any time. Anyone with it can claim one available entry.",
      }),
      copyButton: "Copy",
      listHeading: "Invitations",
      count: plural({
        one: "{formattedCount} invitation",
        other: "{formattedCount} invitations",
      }),
      loading: "Loading access…",
      empty: "No invitations yet.",
      createdAt: "Created {date}",
      active: "Active",
      closed: "Closed",
      usage: "Used {used} of {total}; expires {date}",
      revokeLabel: "Revoke invitation",
      revokedToast: "Invitation revoked",
      revokeTitle: "Revoke invitation?",
      revokeDescription:
        "The link will stop working if the participant has not used it yet.",
      revokeButton: "Revoke",
    },
    participant: {
      heading: "Participants",
      description: "Revoked access will close after the next access check.",
      count: plural({
        one: "{formattedCount} participant",
        other: "{formattedCount} participants",
      }),
      empty: "No active participants yet.",
      since: "Since {date}",
      revokeLabel: "Revoke access for {name}",
      revokedToast: "Participant access revoked",
      revokeTitle: "Revoke access?",
      revokeDescription:
        "The participant will lose access to the board and will need a new invitation to return.",
      revokeButton: "Revoke access",
    },
  },
} as const;

export const settingsRu = {
  settings: {
    errors: {
      savedRefreshFailed:
        "Изменение сохранено, но обновить доску не удалось. Проверьте соединение.",
      actionFailed: "Не удалось выполнить действие.",
      saveBoard: "Не удалось сохранить настройки доски.",
      createColumn: "Не удалось создать колонку.",
      saveColumn: "Не удалось сохранить колонку.",
      deleteColumn: "Не удалось удалить колонку.",
      resetVotes: "Не удалось сбросить голоса.",
    },
    general: {
      heading: "Основное",
      description: "Название и режимы работы ретроспективы.",
      boardTitle: "Название доски",
      titleValidation: "Введите от 1 до 120 символов.",
      modesLegend: "Режимы доски",
      cardsTitle: "Сбор карточек",
      cardsDescription:
        "Команда может добавлять и изменять доступные ей карточки.",
      votingTitle: "Голосование",
      votingDescription:
        "Участники могут ставить и снимать голоса в пределах лимита колонки.",
      readOnlyTitle: "Только чтение",
      readOnlyDescription:
        "Содержимое нельзя менять, но экспорт и управление доступом остаются доступны.",
      unsaved: "Есть несохранённые изменения",
      saved: "Все изменения сохранены",
      saveButton: "Сохранить настройки",
      savedToast: "Настройки доски сохранены",
    },
    columns: {
      heading: "Колонки",
      description: "Название и лимит голосов настраиваются отдельно.",
      readOnlyNotice:
        "Снимите режим «Только чтение» в разделе «Основное», чтобы изменить колонки.",
      titleLabel: "Название",
      voteLimitLabel: "Голосов",
      itemCount: plural({
        one: "{formattedCount} элемент",
        few: "{formattedCount} элемента",
        many: "{formattedCount} элементов",
        other: "{formattedCount} элемента",
      }),
      deleteButton: "Удалить",
      saveButton: "Сохранить",
      newHeading: "Новая колонка",
      newDescription: "Она появится перед фиксированной колонкой «Решения».",
      addButton: "Добавить колонку",
      createdToast: "Колонка создана",
      updatedToast: "Колонка обновлена",
      enableCardsFirst:
        "Сначала включите и сохраните сбор карточек, чтобы обработать содержимое колонки.",
      deleteTitle: "Удалить колонку?",
      deleteNamedDescription: "Колонка «{column}» будет удалена.",
      deleteDescription: "Колонка будет удалена.",
      strategyLabel: "Что сделать с содержимым",
      chooseAction: "Выберите действие",
      moveCards: "Переместить в другую колонку",
      deleteCards: "Удалить вместе с карточками",
      targetLabel: "Целевая колонка",
      chooseTarget: "Выберите колонку",
      moveLimitWarning:
        "Перенос отменится, если голоса не помещаются в лимит целевой колонки.",
      deleteToken: "УДАЛИТЬ",
      deleteTokenPrompt: "Введите {token}",
      emptyDescription: "Колонка пуста. Это действие нельзя отменить.",
      deleteConfirmButton: "Удалить колонку",
      deletedToast: "Колонка удалена",
    },
    danger: {
      heading: "Опасные действия",
      description: "Эти изменения нельзя отменить.",
      resetTitle: "Сбросить все голоса",
      resetDescription: "Удаляет голоса во всех колонках обратной связи.",
      resetButton: "Сбросить",
      resetUnavailable: "Сброс недоступен, пока включён режим «Только чтение».",
      confirmTitle: "Сбросить все голоса?",
      confirmDescription:
        "Голоса во всех колонках будут удалены без возможности восстановления.",
      resetToken: "СБРОСИТЬ",
      resetTokenPrompt: "Введите {token} для подтверждения",
      confirmButton: "Сбросить голоса",
      resetToast: "Все голоса сброшены",
    },
  },
  access: {
    errors: {
      load: "Не удалось загрузить настройки доступа.",
      loadNetwork:
        "Не удалось загрузить настройки доступа. Проверьте соединение.",
      invalidMaxUses: "Введите целое число от {min} до {max}.",
      createInvitation: "Не удалось создать приглашение.",
      createInvitationNetwork:
        "Не удалось создать приглашение. Проверьте соединение.",
      copy: "Браузер не разрешил скопировать ссылку. Выделите её вручную.",
      revokeInvitation: "Не удалось отозвать приглашение.",
      revokeInvitationNetwork:
        "Не удалось отозвать приглашение. Проверьте соединение.",
      revokeParticipant: "Не удалось отозвать доступ участника.",
      revokeParticipantNetwork:
        "Не удалось отозвать доступ участника. Проверьте соединение.",
      leave: "Не удалось покинуть доску.",
      leaveNetwork: "Не удалось покинуть доску. Проверьте соединение.",
      deleteBoard: "Не удалось удалить доску.",
      deleteBoardNetwork: "Не удалось удалить доску. Проверьте соединение.",
      displayNameValidation: "Введите от 1 до 80 символов.",
      rename: "Не удалось изменить имя.",
      renameNetwork: "Не удалось изменить имя. Проверьте соединение.",
    },
    profile: {
      heading: "Ваше имя",
      description: "Оно отображается на этой доске и не связано с аккаунтом.",
      inputLabel: "Ваше имя на доске",
      save: "Сохранить",
      savedToast: "Имя изменено",
    },
    danger: {
      heading: "Удалить доску",
      description:
        "Карточки, голоса, решения, приглашения и доступы будут удалены.",
      openButton: "Удалить",
      confirmTitle: "Удалить доску?",
      confirmDescription:
        "Данные и все права доступа будут удалены без возможности восстановления.",
      deleteToken: "УДАЛИТЬ",
      tokenPrompt: "Введите {token} для подтверждения",
      confirmationLabel: "Подтверждение удаления доски",
      confirmButton: "Удалить доску",
    },
    participation: {
      heading: "Участие",
      current: "Вы участвуете как {name}.",
      leaveTitle: "Покинуть доску",
      leaveDescription:
        "Для повторного входа понадобится новое приглашение владельца.",
      leaveOpenButton: "Выйти",
      confirmTitle: "Покинуть доску?",
      confirmDescription:
        "Текущий анонимный доступ будет отозван. Один лишь идентификатор доски не вернёт доступ.",
      confirmButton: "Покинуть доску",
    },
    invitation: {
      heading: "Доступ",
      description: "Создайте одну ссылку для нужного количества участников.",
      maxUsesLabel: "Количество входов",
      createLink: "Создать ссылку",
      createdToast: plural({
        one: "Приглашение на {formattedCount} вход создано",
        few: "Приглашение на {formattedCount} входа создано",
        many: "Приглашение на {formattedCount} входов создано",
        other: "Приглашение на {formattedCount} входа создано",
      }),
      copiedToast: "Ссылка скопирована",
      freshLabel: "Ссылка показывается только сейчас",
      freshDescription: plural({
        one: "Доступен {formattedCount} вход. Ссылку можно отозвать в любой момент. Любой получивший её сможет занять доступный вход.",
        few: "Доступно {formattedCount} входа. Ссылку можно отозвать в любой момент. Любой получивший её сможет занять один из доступных входов.",
        many: "Доступно {formattedCount} входов. Ссылку можно отозвать в любой момент. Любой получивший её сможет занять один из доступных входов.",
        other:
          "Доступно {formattedCount} входа. Ссылку можно отозвать в любой момент. Любой получивший её сможет занять один из доступных входов.",
      }),
      copyButton: "Скопировать",
      listHeading: "Приглашения",
      count: plural({
        one: "{formattedCount} приглашение",
        few: "{formattedCount} приглашения",
        many: "{formattedCount} приглашений",
        other: "{formattedCount} приглашения",
      }),
      loading: "Загружаем доступы…",
      empty: "Приглашений пока нет.",
      createdAt: "Создано {date}",
      active: "Активно",
      closed: "Закрыто",
      usage: "Использовано {used} из {total}; до {date}",
      revokeLabel: "Отозвать приглашение",
      revokedToast: "Приглашение отозвано",
      revokeTitle: "Отозвать приглашение?",
      revokeDescription:
        "Ссылка перестанет работать, если участник ещё не использовал её.",
      revokeButton: "Отозвать",
    },
    participant: {
      heading: "Участники",
      description: "Отозванный доступ закроется после ближайшей проверки.",
      count: plural({
        one: "{formattedCount} участник",
        few: "{formattedCount} участника",
        many: "{formattedCount} участников",
        other: "{formattedCount} участника",
      }),
      empty: "Активных участников пока нет.",
      since: "С {date}",
      revokeLabel: "Отозвать доступ участника {name}",
      revokedToast: "Доступ участника отозван",
      revokeTitle: "Отозвать доступ?",
      revokeDescription:
        "Участник потеряет доступ к доске. Для возвращения понадобится новое приглашение.",
      revokeButton: "Отозвать доступ",
    },
  },
} satisfies MessageShape<typeof settingsEn>;

export const settingsEs = {
  settings: {
    errors: {
      savedRefreshFailed:
        "El cambio se guardó, pero no se pudo actualizar el tablero. Comprueba tu conexión.",
      actionFailed: "No se pudo completar la acción.",
      saveBoard: "No se pudo guardar la configuración del tablero.",
      createColumn: "No se pudo crear la columna.",
      saveColumn: "No se pudo guardar la columna.",
      deleteColumn: "No se pudo eliminar la columna.",
      resetVotes: "No se pudieron restablecer los votos.",
    },
    general: {
      heading: "General",
      description: "Nombre y modos de funcionamiento de la retrospectiva.",
      boardTitle: "Nombre del tablero",
      titleValidation: "Escribe entre 1 y 120 caracteres.",
      modesLegend: "Modos del tablero",
      cardsTitle: "Recopilación de tarjetas",
      cardsDescription:
        "El equipo puede añadir y editar las tarjetas disponibles.",
      votingTitle: "Votación",
      votingDescription:
        "Las personas participantes pueden añadir y retirar votos dentro del límite de cada columna.",
      readOnlyTitle: "Solo lectura",
      readOnlyDescription:
        "No se puede cambiar el contenido, pero siguen disponibles la exportación y la gestión del acceso.",
      unsaved: "Hay cambios sin guardar",
      saved: "Todos los cambios están guardados",
      saveButton: "Guardar configuración",
      savedToast: "Configuración del tablero guardada",
    },
    columns: {
      heading: "Columnas",
      description:
        "Configura por separado el nombre y el límite de votos de cada columna.",
      readOnlyNotice:
        "Desactiva «Solo lectura» en General para cambiar las columnas.",
      titleLabel: "Nombre",
      voteLimitLabel: "Votos",
      itemCount: plural({
        one: "{formattedCount} elemento",
        other: "{formattedCount} elementos",
      }),
      deleteButton: "Eliminar",
      saveButton: "Guardar",
      newHeading: "Nueva columna",
      newDescription: "Aparecerá antes de la columna fija Acciones.",
      addButton: "Añadir columna",
      createdToast: "Columna creada",
      updatedToast: "Columna actualizada",
      enableCardsFirst:
        "Activa y guarda la recopilación de tarjetas antes de gestionar el contenido de esta columna.",
      deleteTitle: "¿Eliminar la columna?",
      deleteNamedDescription: "Se eliminará la columna «{column}».",
      deleteDescription: "Se eliminará la columna.",
      strategyLabel: "Qué hacer con el contenido",
      chooseAction: "Elige una acción",
      moveCards: "Mover a otra columna",
      deleteCards: "Eliminar con las tarjetas",
      targetLabel: "Columna de destino",
      chooseTarget: "Elige una columna",
      moveLimitWarning:
        "El traslado se cancelará si los votos superan el límite de la columna de destino.",
      deleteToken: "ELIMINAR",
      deleteTokenPrompt: "Escribe {token}",
      emptyDescription:
        "La columna está vacía. Esta acción no se puede deshacer.",
      deleteConfirmButton: "Eliminar columna",
      deletedToast: "Columna eliminada",
    },
    danger: {
      heading: "Acciones peligrosas",
      description: "Estos cambios no se pueden deshacer.",
      resetTitle: "Restablecer todos los votos",
      resetDescription:
        "Elimina los votos de todas las columnas de comentarios.",
      resetButton: "Restablecer",
      resetUnavailable:
        "El restablecimiento no está disponible mientras esté activado Solo lectura.",
      confirmTitle: "¿Restablecer todos los votos?",
      confirmDescription:
        "Los votos de todas las columnas se eliminarán y no se podrán recuperar.",
      resetToken: "RESTABLECER",
      resetTokenPrompt: "Escribe {token} para confirmar",
      confirmButton: "Restablecer votos",
      resetToast: "Todos los votos restablecidos",
    },
  },
  access: {
    errors: {
      load: "No se pudo cargar la configuración de acceso.",
      loadNetwork:
        "No se pudo cargar la configuración de acceso. Comprueba tu conexión.",
      invalidMaxUses: "Escribe un número entero del {min} al {max}.",
      createInvitation: "No se pudo crear la invitación.",
      createInvitationNetwork:
        "No se pudo crear la invitación. Comprueba tu conexión.",
      copy: "El navegador no pudo copiar el enlace. Selecciónalo y cópialo manualmente.",
      revokeInvitation: "No se pudo revocar la invitación.",
      revokeInvitationNetwork:
        "No se pudo revocar la invitación. Comprueba tu conexión.",
      revokeParticipant:
        "No se pudo revocar el acceso de la persona participante.",
      revokeParticipantNetwork:
        "No se pudo revocar el acceso de la persona participante. Comprueba tu conexión.",
      leave: "No se pudo abandonar el tablero.",
      leaveNetwork: "No se pudo abandonar el tablero. Comprueba tu conexión.",
      deleteBoard: "No se pudo eliminar el tablero.",
      deleteBoardNetwork:
        "No se pudo eliminar el tablero. Comprueba tu conexión.",
      displayNameValidation: "Escribe entre 1 y 80 caracteres.",
      rename: "No se pudo cambiar el nombre.",
      renameNetwork: "No se pudo cambiar el nombre. Comprueba tu conexión.",
    },
    profile: {
      heading: "Tu nombre",
      description:
        "Se muestra en este tablero y no está vinculado a una cuenta.",
      inputLabel: "Tu nombre en el tablero",
      save: "Guardar",
      savedToast: "Nombre cambiado",
    },
    danger: {
      heading: "Eliminar tablero",
      description:
        "Se eliminarán las tarjetas, los votos, las acciones, las invitaciones y los accesos.",
      openButton: "Eliminar",
      confirmTitle: "¿Eliminar el tablero?",
      confirmDescription:
        "Los datos y todos los permisos de acceso se eliminarán de forma permanente.",
      deleteToken: "ELIMINAR",
      tokenPrompt: "Escribe {token} para confirmar",
      confirmationLabel: "Confirmación de eliminación del tablero",
      confirmButton: "Eliminar tablero",
    },
    participation: {
      heading: "Participación",
      current: "Participas como {name}.",
      leaveTitle: "Abandonar el tablero",
      leaveDescription:
        "Necesitarás una nueva invitación de la persona propietaria para volver.",
      leaveOpenButton: "Salir",
      confirmTitle: "¿Abandonar el tablero?",
      confirmDescription:
        "Se revocará tu acceso anónimo actual. El enlace del tablero no bastará para recuperarlo.",
      confirmButton: "Abandonar el tablero",
    },
    invitation: {
      heading: "Acceso",
      description:
        "Crea un enlace para el número de participantes que necesites.",
      maxUsesLabel: "Número de accesos",
      createLink: "Crear enlace",
      createdToast: plural({
        one: "Invitación para {formattedCount} acceso creada",
        other: "Invitación para {formattedCount} accesos creada",
      }),
      copiedToast: "Enlace copiado",
      freshLabel: "Este enlace solo se muestra ahora",
      freshDescription: plural({
        one: "Hay {formattedCount} acceso disponible. Puedes revocar el enlace en cualquier momento. Quien lo reciba podrá ocupar el acceso disponible.",
        other:
          "Hay {formattedCount} accesos disponibles. Puedes revocar el enlace en cualquier momento. Quien lo reciba podrá ocupar uno de ellos.",
      }),
      copyButton: "Copiar",
      listHeading: "Invitaciones",
      count: plural({
        one: "{formattedCount} invitación",
        other: "{formattedCount} invitaciones",
      }),
      loading: "Cargando accesos…",
      empty: "Aún no hay invitaciones.",
      createdAt: "Creada el {date}",
      active: "Activa",
      closed: "Cerrada",
      usage: "Usada {used} de {total}; caduca el {date}",
      revokeLabel: "Revocar invitación",
      revokedToast: "Invitación revocada",
      revokeTitle: "¿Revocar la invitación?",
      revokeDescription:
        "El enlace dejará de funcionar si la persona participante aún no lo ha usado.",
      revokeButton: "Revocar",
    },
    participant: {
      heading: "Participantes",
      description:
        "El acceso revocado se cerrará tras la siguiente comprobación.",
      count: plural({
        one: "{formattedCount} participante",
        other: "{formattedCount} participantes",
      }),
      empty: "Aún no hay participantes activos.",
      since: "Desde el {date}",
      revokeLabel: "Revocar el acceso de {name}",
      revokedToast: "Acceso de la persona participante revocado",
      revokeTitle: "¿Revocar el acceso?",
      revokeDescription:
        "La persona participante perderá el acceso al tablero y necesitará una nueva invitación para volver.",
      revokeButton: "Revocar acceso",
    },
  },
} satisfies MessageShape<typeof settingsEn>;
