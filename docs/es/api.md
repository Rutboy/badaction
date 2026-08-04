[English](../api.md) | [Русский](../ru/api.md) | [Español](api.md)

# API orientada al navegador

Badaction expone rutas HTTP que utiliza su propia interfaz web. Es una API
interna de la aplicación, documentada para ayudar a quienes contribuyen y a los
operadores de autohospedaje a entender el sistema en ejecución. **No es un
contrato público estable de integración**: las rutas, los campos de
solicitud y respuesta, los códigos de error y los límites pueden cambiar junto
con la interfaz, sin garantías de versionado semántico ni un período de
compatibilidad.

Usa las exportaciones para extraer datos de tableros de la aplicación. Si
construyes un cliente externo, fíjalo a una revisión concreta de Badaction y
pruébalo durante cada actualización.

La implementación en `src/app/api/`, sus validadores y sus servicios es
autoritativa. Esta página resume intencionadamente la interfaz en lugar de
definir un esquema independiente.

## Convenciones

- La ruta base es `/api` en el mismo origen que la aplicación web.
- Las rutas JSON usan JSON UTF-8. Las mutaciones JSON requieren
  `Content-Type: application/json` y normalmente aceptan como máximo 16 KiB.
- La aplicación establece y lee la cookie firmada `visitor_token`. Las
  solicitudes del navegador usan credenciales del mismo origen; no hay un modo
  de autenticación mediante un token al portador ni una clave de API.
- Las operaciones protegidas de un tablero requieren una sesión anónima activa
  y una membresía activa para ese tablero. El UUID de un tablero es solo un
  dato de localización.
- En las solicitudes que cambian estado se comprueban los metadatos de mismo
  origen del navegador. Si se incluye una cabecera `Origin`, debe coincidir
  exactamente con el origen canónico de la aplicación.
- Las respuestas de tableros, mutaciones, acceso, exportación y errores usan
  `Cache-Control: no-store`.
- Los ID que crea la aplicación son UUID v4. Las rutas de contenido exigen
  sintaxis UUID v4; las rutas de gestión de acceso aceptan sintaxis UUID de
  forma más general. Todos los UUID aceptados se canonicalizan a minúsculas.
- Las marcas de tiempo son cadenas ISO 8601. Las revisiones de tablero son cadenas
  decimales canónicos no negativos porque proceden de `bigint` de PostgreSQL.
- Salvo que se indique otra cosa, las mutaciones JSON correctas devuelven `200`.
  Las rutas de creación devuelven `201`; algunas eliminaciones de acceso y
  de tableros devuelven `204` sin cuerpo.

## Modelo de acceso

La cookie es necesaria, pero por sí sola no concede acceso a todos los tableros.
El servidor la resuelve como una sesión anónima y después busca una membresía
del tablero:

- `OWNER` puede gestionar los ajustes, el acceso, las columnas, los grupos, los
  elementos de acción, el restablecimiento de votos y la eliminación del
  tablero.
- `PARTICIPANT` puede leer y exportar el tablero, votar, crear tarjetas,
  gestionar las tarjetas creadas por la membresía actual, renombrar esa
  membresía y abandonar el tablero.

Cuando la sesión no tiene una membresía activa, el acceso acotado al tablero se
enmascara normalmente como `404 BOARD_NOT_FOUND`. Los clientes no deben tratar
el conocimiento de un UUID como autorización. Consulta
[Arquitectura](architecture.md) y
[Seguridad y privacidad](security-and-privacy.md) para conocer el modelo
completo.

## Instantánea del tablero

`GET /api/boards/{boardId}?limit=50` devuelve la instantánea autoritativa que usa la
interfaz. `limit` se aplica a la primera página de elementos de nivel superior de cada
columna; su valor predeterminado es 50 y debe estar entre 1 y 100.

La respuesta tiene esta forma general:

```json
{
  "id": "board UUID",
  "title": "Retrospective title",
  "revision": "12",
  "createdAt": "marca de tiempo ISO",
  "expiresAt": "marca de tiempo ISO",
  "settings": {
    "cardsEnabled": true,
    "votingEnabled": true,
    "readOnly": false
  },
  "viewer": {
    "role": "OWNER",
    "displayName": "Владелец"
  },
  "capabilities": {
    "canManageSettings": true,
    "canManageAccess": true,
    "canManageColumns": true,
    "canManageGroups": true,
    "canManageActionItems": true,
    "canResetVotes": true,
    "canDeleteBoard": true,
    "canLeaveBoard": false,
    "canCreateCards": true,
    "canVote": true
  },
  "columns": [],
  "remainingVotesByColumn": {},
  "actionItems": []
}
```

Cada columna contiene `id`, `title`, `position`, `voteLimit`, una página
`items`, `totalCount` y `nextCursor`. Un elemento es una tarjeta o un grupo. Las
tarjetas incluyen texto, autor opcional, orden, estado de voto, capacidades de
quien consulta y marcas de tiempo. Los grupos incluyen sus tarjetas, el ID de la
tarjeta principal, un título opcional, estado de voto agregado, capacidades y
marcas de tiempo. Los elementos de acción incluyen texto, responsable opcional,
estado de finalización, orden, ID opcional de la tarjeta de origen y marcas de tiempo.

## Familias de rutas

### Tableros

| Método y ruta                  | Acceso                                            | Solicitud                                                         | Resultado                                                                                                                                             |
| ------------------------------ | ------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/boards`             | Cookie de visitante; no requiere membresía previa | `{title}`                                                         | `201` con ID y URL del tablero, título, revisión y marcas de tiempo. También crea la sesión, la membresía del propietario y las columnas por defecto. |
| `GET /api/boards/{boardId}`    | Miembro                                           | Consulta `{limit?}`                                               | Instantánea del tablero descrita anteriormente.                                                                                                       |
| `PATCH /api/boards/{boardId}`  | Propietario                                       | Uno o más de `{title?, cardsEnabled?, votingEnabled?, readOnly?}` | Revisión, título y ajustes actuales.                                                                                                                  |
| `DELETE /api/boards/{boardId}` | Propietario                                       | Sin cuerpo                                                        | `204`; elimina el tablero y sus datos dependientes.                                                                                                   |

No existe una ruta que enumere todos los tableros propiedad del navegador
actual.

### Columnas

| Método y ruta                                        | Acceso      | Solicitud                                                     | Resultado                                                                  |
| ---------------------------------------------------- | ----------- | ------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `POST /api/boards/{boardId}/columns`                 | Propietario | `{title, voteLimit, placement, expectedRevision}`             | `201` con revisión y columna.                                              |
| `PATCH /api/boards/{boardId}/columns/{columnId}`     | Propietario | `{title?, voteLimit?, expectedRevision?}`                     | Revisión y columna. Se requiere `expectedRevision` al cambiar `voteLimit`. |
| `POST /api/boards/{boardId}/columns/{columnId}/move` | Propietario | `{placement, expectedRevision}`                               | Revisión y columna.                                                        |
| `DELETE /api/boards/{boardId}/columns/{columnId}`    | Propietario | Un formulario explícito de eliminación con `expectedRevision` | Revisión. No se puede eliminar la última columna.                          |

`placement` identifica los ID de las columnas vecinas mediante
`{beforeColumnId, afterColumnId}`; cualquiera de los vecinos puede ser `null` en
un extremo. Para eliminar una columna no vacía se necesita
`{strategy: "moveCards", targetColumnId, expectedRevision}` o
`{strategy: "deleteCards", confirmDeleteCards: true, expectedRevision}`. Para
una columna vacía basta con `{expectedRevision}`.

Los tableros admiten como máximo 10 columnas. Los títulos de columna contienen
1–80 caracteres después de trim y `voteLimit` es un entero de 0 a 20.

### Tarjetas y paginación

| Método y ruta                                    | Acceso                       | Solicitud                                                             | Resultado                                                          |
| ------------------------------------------------ | ---------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `GET /api/boards/{boardId}/cards`                | Miembro                      | Consulta `{columnId, cursor?, limit?}`                                | Una página de elementos de una columna.                            |
| `POST /api/boards/{boardId}/cards`               | Miembro                      | `{columnId, text, author?}`                                           | `201` con revisión y tarjeta.                                      |
| `PATCH /api/boards/{boardId}/cards/{cardId}`     | Propietario o creador actual | `{text?, author?}`                                                    | Revisión y tarjeta.                                                |
| `POST /api/boards/{boardId}/cards/{cardId}/move` | Propietario o creador actual | `{targetColumnId, placement, voteSortedColumnIds?, expectedRevision}` | Revisión y tarjeta. Primero hay que desagrupar tarjetas agrupadas. |
| `DELETE /api/boards/{boardId}/cards/{cardId}`    | Propietario o creador actual | `{expectedRevision}`                                                  | Revisión.                                                          |

La consulta de página requiere `columnId`. El valor predeterminado de `limit` es
50 y admite 1–100. La respuesta contiene
`{columnId, revision, items, totalCount, nextCursor}`. Pasa el `nextCursor` opaco
sin modificar para obtener otra página del mismo tablero y columna. Un cursor
mal formado, obsoleto o que no corresponda devuelve `400 INVALID_CURSOR`.

El texto de una tarjeta contiene 1–1000 caracteres después de trim. `author` es
`null` o contiene 1–120 caracteres después de trim. El límite total de tarjetas
se controla con `BOARD_CARD_LIMIT` y se aplica de forma transaccional.

La colocación de elementos usa `{before, after}`, donde cada referencia no nula
es `{kind: "CARD" | "GROUP", id}`. Las referencias describen elementos
adyacentes de nivel superior en la columna de destino. Si un trabajo concurrente
hace que la colocación quede obsoleta, el servidor devuelve un conflicto de
revisión.

`voteSortedColumnIds` puede contener como máximo los ID de las columnas de
origen y destino. El campo pide al servidor que materialice atómicamente su
orden actual por número de votos junto con el movimiento, para que salir de esa
vista conserve el orden visible.

### Votos

| Método y ruta                                      | Acceso      | Solicitud                                         | Resultado                                                                                                          |
| -------------------------------------------------- | ----------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `PUT /api/boards/{boardId}/cards/{cardId}/vote`    | Miembro     | Sin cuerpo                                        | `{revision, cardId, voteCount, viewerHasVoted, remainingVotesInColumn}`. Repetir la solicitud es idempotente.      |
| `DELETE /api/boards/{boardId}/cards/{cardId}/vote` | Miembro     | Sin cuerpo                                        | La misma forma de estado de voto. Repetir la solicitud es idempotente.                                             |
| `POST /api/boards/{boardId}/votes/reset`           | Propietario | `{confirmation: "RESET_VOTES", expectedRevision}` | Revisión y número de votos eliminados.                                                                             |
| `POST /api/boards/{boardId}/cards/{cardId}/like`   | Miembro     | Sin cuerpo                                        | Adaptador de compatibilidad obsoleto. Devuelve `Deprecation: true`; los clientes nuevos deben usar `PUT .../vote`. |

Una identidad de visitante acotada al tablero puede votar una vez por tarjeta y
no más que el `voteLimit` de la columna de destino. Un límite de cero desactiva
el voto en esa columna. Los votos y las plazas de cuota de PostgreSQL son
autoritativos.

### Grupos

| Método y ruta                                         | Acceso      | Solicitud                                                             | Resultado                                                                         |
| ----------------------------------------------------- | ----------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `POST /api/boards/{boardId}/groups`                   | Propietario | `{columnId, cardIds, primaryCardId, title?, expectedRevision}`        | `201` con revisión y grupo.                                                       |
| `PATCH /api/boards/{boardId}/groups/{groupId}`        | Propietario | `{title?, primaryCardId?, expectedRevision?}`                         | Revisión y grupo. Se requiere `expectedRevision` al cambiar la tarjeta principal. |
| `POST /api/boards/{boardId}/groups/{groupId}/move`    | Propietario | `{targetColumnId, placement, voteSortedColumnIds?, expectedRevision}` | Revisión y grupo.                                                                 |
| `POST /api/boards/{boardId}/groups/{groupId}/ungroup` | Propietario | `{expectedRevision}`                                                  | Revisión y las tarjetas restauradas como elementos de nivel superior.             |

Un grupo nuevo contiene 2–100 tarjetas únicas de una misma columna.
`primaryCardId` debe estar incluido en `cardIds`. El título de un grupo es
`null` o contiene 1–120 caracteres después de trim. Cuando es `null`, los
clientes muestran el texto de la tarjeta principal como nombre efectivo del
grupo y las exportaciones materializan ese valor alternativo en el título del
grupo exportado. El `voteCount` de un grupo es el número de identidades de
visitante distintas, acotadas al tablero, que votaron por alguna tarjeta del
grupo; varios votos de una identidad contribuyen uno al total del grupo.

### Elementos de acción

| Método y ruta                                                 | Acceso      | Solicitud                                                                                                                          | Resultado                                |
| ------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `POST /api/boards/{boardId}/action-items`                     | Propietario | `{source: "manual", text, assignee?}`, `{source: "card", sourceCardId, assignee?}` o `{source: "group", sourceGroupId, assignee?}` | `201` con revisión y elemento de acción. |
| `PATCH /api/boards/{boardId}/action-items/{actionItemId}`     | Propietario | Uno o más de `{text?, assignee?, completed?}`                                                                                      | Revisión y elemento de acción.           |
| `POST /api/boards/{boardId}/action-items/{actionItemId}/move` | Propietario | `{placement, expectedRevision}`                                                                                                    | Revisión y elemento de acción.           |
| `DELETE /api/boards/{boardId}/action-items/{actionItemId}`    | Propietario | `{expectedRevision}`                                                                                                               | Revisión.                                |

El texto manual contiene 1–1000 caracteres después de trim. Un elemento de
acción creado a partir de una tarjeta copia el texto actual de esa tarjeta y
almacena una referencia a su origen. Un elemento de acción creado a partir de
un grupo copia su título explícito o, cuando es `null`, el texto de la tarjeta
principal; su referencia de tarjeta de origen apunta a esa tarjeta principal.
`assignee` es `null` o contiene 1–120 caracteres después de trim. Un tablero
admite como máximo 200 elementos de acción.

La colocación de elementos de acción usa
`{beforeActionItemId, afterActionItemId}`, con un vecino `null` en cualquiera de
los extremos.

### Invitaciones y membresías

| Método y ruta                                             | Acceso                                 | Solicitud                                                        | Resultado                                                                          |
| --------------------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `POST /api/invitations/redeem`                            | Cookie de visitante e invitación bruta | `{token, displayName?}`                                          | Detalles de la membresía: ID de tablero, ID de membresía, rol y nombre visible.    |
| `GET /api/boards/{boardId}/invitations`                   | Propietario                            | Sin cuerpo                                                       | `{invitations}` con metadatos, uso y estado activo; nunca incluye tokens en bruto. |
| `POST /api/boards/{boardId}/invitations`                  | Propietario                            | `{maxUses}` opcional; sin cuerpo usa los valores predeterminados | `201` con ID, caducidad, `maxUses` y el único `joinPath` en bruto que se devuelve. |
| `DELETE /api/boards/{boardId}/invitations/{invitationId}` | Propietario                            | Sin cuerpo                                                       | `204`; revoca una invitación de participante activa.                               |
| `GET /api/boards/{boardId}/members`                       | Propietario                            | Sin cuerpo                                                       | ID de la membresía del propietario actual y lista de participantes activos.        |
| `DELETE /api/boards/{boardId}/members/{membershipId}`     | Propietario                            | Sin cuerpo                                                       | `204`; revoca una membresía de participante activa.                                |
| `PATCH /api/boards/{boardId}/membership`                  | Miembro                                | `{displayName}`                                                  | Nombre visible actualizado y revisión del tablero.                                 |
| `DELETE /api/boards/{boardId}/membership`                 | Participante                           | Sin cuerpo                                                       | `204`; abandona el tablero. El propietario debe eliminar el tablero en su lugar.   |

Las invitaciones de participante permiten un uso de forma predeterminada y
aceptan `maxUses` entre 1 y 100. Normalmente caducan a los siete días o cuando
caduca el tablero, lo que ocurra primero. La URL tiene la forma `/join#token`;
trátala como una credencial al portador.

Una sesión puede poseer como máximo 20 tableros activos. Cada tablero admite
como máximo 20 invitaciones de participante activas, 100 participantes activos,
500 filas históricas de invitaciones de participante y 500 filas históricas de
membresías de participante; al agotar un límite se devuelve `422`.

### Exportaciones

| Método y ruta                           | Acceso  | Resultado                                                                       |
| --------------------------------------- | ------- | ------------------------------------------------------------------------------- |
| `GET /api/boards/{boardId}/export.json` | Miembro | Instantánea JSON descargable.                                                   |
| `GET /api/boards/{boardId}/export.csv`  | Miembro | CSV UTF-8 descargable con BOM y neutralización de fórmulas de hojas de cálculo. |
| `GET /api/boards/{boardId}/export.md`   | Miembro | Resumen Markdown escapado y descargable.                                        |

Las exportaciones contienen el estado completo del tablero en lugar de datos
paginados y, por tanto, tienen límites de seguridad separados. Un tablero
demasiado grande devuelve `422 BOARD_EXPORT_LIMIT_EXCEEDED`.

### Eventos en tiempo real

`GET /api/boards/{boardId}/events` abre un flujo SSE para un miembro. Los
clientes pueden enviar la última revisión decimal aplicada por completo en
`Last-Event-ID`.

El servidor emite:

```text
event: board.ready
data: {"boardId":"...","revision":"12"}

id: 13
event: board.invalidate
data: {"boardId":"...","revision":"13","type":"card.created"}
```

`board.invalidate` significa «obtener el estado autoritativo en esta revisión o
una posterior»; no contiene el recurso modificado. Si `Last-Event-ID` está por
detrás del estado actual, la primera invalidación tiene el tipo `resync`. Cada
12 segundos se escribe un comentario de mantenimiento `: heartbeat`. El acceso se vuelve a
validar cada 30 segundos y la conexión se cierra cuando se pierde el acceso o el
proceso de escucha de PostgreSQL deja de estar disponible.

Las respuestas usan `text/event-stream`,
`Cache-Control: no-store, no-transform` y `X-Accel-Buffering: no`. Los proxies no
deben almacenar el flujo en búfer ni en caché, ni comprimirlo.

### Estado

`GET /api/health` no requiere autenticación:

- `200 {"status":"ok"}` significa que la configuración del entorno de ejecución es válida,
  el proceso no se está vaciando y PostgreSQL ha respondido a una consulta
  ligera dentro del tiempo de espera de la comprobación de estado.
- `503 {"status":"unavailable"}` significa que una de esas comprobaciones ha
  fallado.

La comprobación de estado no demuestra que las migraciones estén al día, que `LISTEN` en tiempo
real funcione, que la limpieza tenga éxito ni que las copias de seguridad se
puedan restaurar.

## Revisiones y cambios concurrentes

Las mutaciones de ordenación y destructivas incluyen `expectedRevision`. Los
objetos de colocación describen los vecinos previstos del elemento. El servidor
bloquea el tablero, comprueba la revisión y la colocación, aplica el cambio,
incrementa la revisión y publica una invalidación en tiempo real dentro de la
misma transacción.

Una solicitud obsoleta normalmente recibe:

```json
{
  "error": {
    "code": "STALE_BOARD_REVISION",
    "message": "...",
    "details": {
      "currentRevision": "13"
    }
  }
}
```

Actualiza el tablero, reconstruye la colocación a partir del estado nuevo y pide
al usuario que vuelva a intentarlo cuando corresponda. No repitas a ciegas una
solicitud destructiva contra una revisión nueva.

## Errores

Los errores JSON tienen una forma estable dentro de una revisión concreta del
código fuente:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "...",
    "details": {}
  }
}
```

`details` es opcional y solo contiene información estructurada segura. Los
mensajes de error actuales son textos de interfaz de usuario y pueden estar
localizados; los clientes deben decidir según el estado HTTP y `error.code`,
pero aun así deben tratar los códigos como específicos de la versión porque la
API no ofrece compatibilidad pública.

Los estados habituales son:

| Estado | Significado                                                                                                                     |
| ------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `400`  | UUID, consulta, cursor, JSON, longitud de contenido o revisión no válidos, o cuerpo de solicitud inesperado.                    |
| `401`  | La sesión anónima está inactiva en un flujo donde no se enmascara como tablero no encontrado.                                   |
| `403`  | Origen incorrecto, se requiere rol de propietario/creador de tarjeta u operación prohibida.                                     |
| `404`  | No hay acceso al tablero o el recurso solicitado y acotado al tablero no es visible.                                            |
| `409`  | Revisión obsoleta, modo de solo lectura o función deshabilitada, like heredado duplicado, estado de propiedad u otro conflicto. |
| `413`  | El cuerpo de la solicitud supera el límite configurado.                                                                         |
| `415`  | Una ruta JSON no ha recibido `application/json`.                                                                                |
| `422`  | Se ha agotado un límite de tablero, columna, invitación, participante, voto, exportación o historial.                           |
| `429`  | Se ha superado un límite de solicitudes o flujos. La respuesta incluye `Retry-After` cuando está disponible.                    |
| `500`  | Fallo interno inesperado con una respuesta genérica.                                                                            |
| `503`  | PostgreSQL o la configuración de tiempo real no están disponibles temporalmente.                                                |

## Límites de frecuencia actuales

Estos valores son detalles de implementación, no una garantía de nivel de
servicio. Los límites normales por visitante usan una identidad derivada de la
credencial. Los límites por IP de confianza son protecciones adicionales contra
el abuso y solo se aplican cuando `TRUSTED_PROXY_HOPS` es distinto de cero y
está configurado correctamente.

| Ámbito de la operación                          | Límite por visitante | Límite por IP de confianza |    Ventana |
| ----------------------------------------------- | -------------------: | -------------------------: | ---------: |
| Crear un tablero                                |                   10 |                        100 | 10 minutos |
| Mutación estándar de contenido, por ámbito      |                   30 |                        300 |   1 minuto |
| Crear o eliminar un voto                        |                   20 |                        200 |   1 minuto |
| Lecturas de instantáneas y páginas de elementos |                  120 |                      1,200 |   1 minuto |
| Negociaciones SSE                               |                   30 |                        300 |   1 minuto |
| Exportaciones                                   |                   10 |                        100 |   1 minuto |
| Canjear una invitación                          |                   20 |                        200 | 10 minutos |

La gestión de invitaciones y miembros tiene límites por visitante específicos
de cada ruta, entre 5 y 60 solicitudes por minuto. El adaptador de like obsoleto
permite 20 solicitudes por visitante y 200 solicitudes por IP de confianza por
minuto. Un límite amplio por IP de confianza previo a la autenticación de 3,000
solicitudes por minuto cubre las rutas de tableros e invitaciones incluidas en
el selector.

Los contadores de limitación de frecuencia se almacenan en PostgreSQL y se
comparten entre réplicas. Además, SSE permite como máximo tres flujos
concurrentes para una identidad de visitante acotada al tablero en cada proceso
de la aplicación; ese límite de concurrencia no es global entre réplicas.

## Indicaciones de compatibilidad

- No extraigas datos del HTML renderizado como si fuera una API.
- No fabriques ni conserves la cookie de visitante de otro usuario.
- No decodifiques cursores ni presupongas que los campos de ordenación de la
  base de datos permanecerán sin cambios.
- No deduzcas el acceso a partir de un UUID de tablero ni de una respuesta
  correcta anterior.
- Trata SSE como una invalidación y actualiza siempre el estado autoritativo.
- Espera que la interfaz y la API cambien atómicamente en revisiones futuras.
