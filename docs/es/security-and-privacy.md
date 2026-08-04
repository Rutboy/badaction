[English](../security-and-privacy.md) | [Русский](../ru/security-and-privacy.md) | [Español](security-and-privacy.md)

# Seguridad y privacidad

Badaction es una herramienta de colaboración sin cuentas, no un servicio de
anonimato. No pide a los usuarios que registren una cuenta, pero almacena el
contenido de los tableros y registros de acceso acotados al navegador, y un
despliegue puede procesar metadatos de red y operación. No la uses para
información que no sería segura si el operador de la base de datos o del host
pudiera leerla.

Para informar de una posible vulnerabilidad, sigue las instrucciones de
comunicación privada de [SECURITY.md](../../SECURITY.md). No incluyas tokens de
invitación, URL de reclamación de propietario, cookies de visitante, contenido
de tableros privados, volcados de base de datos ni secretos de producción en una
incidencia pública.

## Objetivos de seguridad

La aplicación está diseñada para proteger:

- el contenido de tableros privados frente a quien solo conozca o adivine su
  UUID;
- la integridad del tablero frente a quien no tenga una membresía activa o el
  rol requerido;
- los límites de voto y los invariantes de ordenación bajo solicitudes
  concurrentes;
- las credenciales en bruto de sesiones e invitaciones frente a su exposición
  mediante filas de la base de datos;
- la disponibilidad de las solicitudes mediante cargas útiles acotadas, paginación,
  límites de datos y limitación de frecuencia; y
- las interacciones del navegador frente a ataques habituales entre sitios, de
  incrustación en marcos, detección de contenido y renderizado inseguro.

Las amenazas principales consideradas son la enumeración de UUID, las
credenciales al portador robadas o reproducidas, las mutaciones entre sitios, el
contenido malicioso aportado por usuarios, las entradas mal formadas, las
mutaciones concurrentes, las carreras de cuota, las exportaciones demasiado
grandes, la inyección de fórmulas de hojas de cálculo, un volumen abusivo de
solicitudes, los clientes obsoletos y los proxies mal configurados.

## Exclusiones explícitas

Badaction no afirma proporcionar:

- anonimato absoluto ni imposibilidad de vinculación;
- cifrado de extremo a extremo o en el cliente;
- protección frente a un administrador con acceso al host, la base de datos,
  las copias de seguridad o los secretos;
- prueba de que un nombre visible, autor o responsable representa a una persona
  concreta;
- recuperación basada en cuentas después de perder la credencial del
  navegador;
- protección para una credencial copiada de un navegador comprometido o
  compartida por su titular; ni
- resistencia ilimitada a ataques de denegación de servicio.

El host, la base de datos, el navegador, el proxy inverso, el conjunto de
observabilidad y el sistema de copias de seguridad siguen formando parte de la
base de computación de confianza del despliegue.

## Datos almacenados por la aplicación

El esquema de PostgreSQL puede contener:

- títulos y ajustes de tableros, números de revisión, horas de creación y de
  caducidad;
- títulos, orden y límites de voto de las columnas;
- texto de tarjetas, texto opcional de autor, orden, pertenencia a grupos y
  marcas de tiempo;
- títulos de grupos y relaciones con la tarjeta principal;
- texto de elementos de acción, texto opcional de responsable, estado de
  finalización, relaciones opcionales con la tarjeta de origen y marcas de tiempo;
- votos vinculados a tarjetas, columnas, plazas de cuota y una identidad de
  visitante derivada y acotada al tablero;
- hashes de credenciales de sesiones anónimas, horas de caducidad y marcas de tiempo
  de revocación;
- membresías de tableros, roles, nombres visibles, horas de creación y
  marcas de tiempo de revocación;
- hashes de tokens de invitación, límites de uso, contadores de uso, horas de
  caducidad, referencias a la sesión creadora y marcas de tiempo de revocación;
- historial de canjes de invitaciones; y
- claves con hash de registros de limitación de frecuencia, contadores y horas de
  reinicio.

El texto introducido por usuarios se almacena sin cifrar en la capa de la
aplicación. Usa almacenamiento y copias de seguridad cifrados si tu entorno lo
requiere. La aplicación no almacena intencionadamente en PostgreSQL tokens de
invitación en bruto ni cargas útiles de credenciales de sesiones anónimas en bruto;
almacena hashes derivados mediante HMAC. La cookie de visitante firmada
permanece en el navegador y se presenta con las solicitudes.

La infraestructura externa a la aplicación también puede observar marcas de tiempo,
direcciones IP, agentes de usuario, rutas de solicitudes, estados de respuesta y
volumen de tráfico. La ruta de un tablero contiene su UUID. Los tokens de
invitación se sitúan después de `#` en `/join#token`, por lo que un navegador
conforme no envía ese fragmento en la solicitud HTTP inicial; sin embargo, el
canje en el cliente envía posteriormente el token en el cuerpo JSON.

## Modelo de credencial del navegador y sesión

La cookie `visitor_token` es una credencial aleatoria, firmada y acotada al
navegador. Se configura como `HttpOnly`, `SameSite=Lax`, con ámbito `/` y como
`Secure` en producción. Su edad máxima es de 400 días y una credencial válida se
vuelve a firmar periódicamente sin cambiar su identidad.

La carga útil de la cookie se deriva mediante HMAC para obtener un hash de
credencial de sesión anónima en el servidor. Las identidades de visitante
específicas de tablero que se usan para votar se derivan por separado, por lo
que el valor de voto almacenado queda acotado a un tablero. Las identidades de
limitación de frecuencia también se derivan antes de aplicar hash a las claves
de los registros de limitación.

Poseer una cookie válida es necesario, pero no basta para acceder a un tablero.
Una operación protegida también requiere una sesión anónima activa y una
membresía activa para el tablero solicitado, que no debe haber caducado. Las
sesiones revocadas se conservan como marcadores de eliminación hasta que termina la
vida útil de su credencial, para impedir que una cookie antigua todavía válida
pueda recrear una sesión activa mediante inserción o actualización.

La página principal muestra títulos de tableros únicamente para las membresías
activas de la sesión anónima actual y mientras esos tableros no hayan caducado.
Se excluyen las membresías revocadas, los tableros caducados y los tableros
asociados a otra credencial del navegador.

No hay cuentas, contraseñas ni recuperación por correo electrónico. Borrar la
cookie, usar otro perfil de navegador, rotar secretos de credenciales sin un
plan de migración o perder la credencial de cualquier otra forma puede impedir
permanentemente que el usuario acceda a las membresías existentes.

## Acceso al tablero y roles

El UUID de un tablero es un dato de localización, no una credencial. Conocer el UUID por sí
solo no autoriza lecturas, mutaciones, exportaciones ni flujos de eventos. Las
solicitudes sin una membresía activa se enmascaran como
`404 BOARD_NOT_FOUND` para reducir la enumeración de tableros.

Los roles de membresía se limitan a:

- `OWNER`: gestiona los ajustes, columnas, grupos, elementos de acción,
  invitaciones, participantes, restablecimiento de votos y eliminación del
  tablero; y
- `PARTICIPANT`: consulta el tablero, vota, crea tarjetas, gestiona las tarjetas
  creadas por la membresía actual, cambia el nombre de esa membresía y puede
  abandonar el tablero.

La creación del tablero, la creación de la sesión, la membresía del propietario
y la creación de columnas predeterminadas se realizan en una sola transacción.
Las operaciones que cambian el acceso bloquean el tablero, la membresía o la
invitación activa pertinente y usan transacciones serializables con reintentos
cuando la concurrencia es relevante. Los índices de la base de datos también
impiden varios propietarios activos o membresías activas duplicadas.

El modo de solo lectura bloquea los cambios de contenido y los votos, pero no
impide que el propietario cambie los ajustes del tablero o elimine el tablero.
Los propietarios deben usarlo como control de colaboración, no como retención
legal ni archivo inmutable.

## Invitaciones y recuperación del propietario

Los tokens de invitación de participantes y de reclamación del propietario son
credenciales al portador. Cualquiera que posea un token válido en bruto puede
canjearlo, sujeto a caducidad, revocación, límites de uso, límites del tablero y
las reglas de canje existentes.

Trata cada valor `/join#token` como información sensible:

- envíalo solo a sus destinatarios mediante un canal privado adecuado;
- no lo pegues en incidencias, conversaciones, analítica, capturas de pantalla ni registros;
- revoca las invitaciones de participantes que se hayan expuesto o ya no sean
  necesarias; y
- recuerda que las invitaciones de participante multiuso pueden conceder varias
  membresías antes de alcanzar el máximo configurado.

Solo la respuesta de creación de una invitación contiene la ruta de acceso del
participante en bruto. Las respuestas del historial de invitaciones contienen
metadatos y contadores de uso, pero nunca reconstruyen el token.

El comando de reclamación del propietario, exclusivo del operador, imprime una
URL de propietario de un solo uso. Está pensado para un procedimiento de
recuperación verificado cuando un tablero no tiene propietario activo. Su salida
es una credencial: verifica al solicitante fuera de banda, protege los registros de
terminal y CI, evita que se capture en el historial del intérprete de órdenes y entrega la URL de
forma privada. No debe exponerse como ruta pública de autoservicio.

## Protecciones de solicitudes y contenido

Las rutas que cambian estado validan `Sec-Fetch-Site` y, cuando está
presente, exigen que `Origin` coincida con el origen canónico de la aplicación.
La cookie firmada `SameSite=Lax` proporciona otra barrera frente a solicitudes
entre sitios. Producción debe establecer `APP_ORIGIN` en el origen HTTPS público
exacto y conservar las cabeceras pertinentes a través del proxy inverso.

Las entradas JSON se validan estrictamente y normalmente se limitan a 16 KiB.
Los UUID se canonicalizan antes de la derivación acotada al tablero y de la
limitación de frecuencia. Las rutas sin cuerpo rechazan cuerpos
inesperados. Las respuestas de error usan una forma segura
`{error: {code, message, details?}}` y no exponen trazas de pila ni mensajes de
Prisma en bruto.

React renderiza el contenido de usuario como texto; la aplicación no usa HTML
proporcionado por usuarios. Las cabeceras de respuesta globales incluyen una
política de seguridad de contenidos (Content Security Policy), restricciones de
incrustación en marcos, una política sin información de referencia,
protección del tipo de contenido, permisos restringidos del navegador y HSTS en
producción. Las páginas de tableros y las respuestas de la API se marcan para no
ser indexadas, y las respuestas con estado privado usan
`Cache-Control: no-store`.

Las exportaciones JSON y Markdown escapan los datos según su formato. La salida
CSV es UTF-8 con BOM, pone entre comillas las celdas de texto, escapa comillas y
saltos de línea y antepone un prefijo a los valores que podrían interpretarse
como fórmulas de hoja de cálculo. Los archivos exportados siguen conteniendo
datos privados del tablero y deben tratarse como tales.

## Votos, límites y controles de abuso

Los votos usan una identidad de visitante derivada y acotada al tablero. Las
restricciones de unicidad de PostgreSQL permiten como máximo un voto de esa
identidad sobre una tarjeta y reservan plazas de cuota por columna. La base de
datos es autoritativa; el estado del navegador solo sirve de ayuda para la
interfaz de usuario.

Los registros de frecuencia de solicitudes se comparten mediante PostgreSQL, lo
que hace efectivos los principales límites entre réplicas de la aplicación. La
clave normal se deriva de la credencial del visitante y del ámbito de la
operación. Solo se aplica un segundo límite por IP de confianza cuando está
configurado `TRUSTED_PROXY_HOPS`. Configura la topología exacta del proxy:
confiar en un número de saltos incorrecto puede hacer que las direcciones
reenviadas queden bajo control de un atacante o agrupar a usuarios no
relacionados bajo una misma identidad.

Los límites de frecuencia mitigan el abuso habitual, pero no sustituyen los
controles a nivel de red, los límites de conexiones, la supervisión de recursos
ni la protección del servicio superior frente a denegación de servicio. El límite de flujos
SSE concurrentes es local al proceso, por lo que un despliegue con varias
réplicas también debe aplicar límites de conexión razonables en su balanceador
de carga.

## Retención y eliminación

Los tableros nuevos reciben una marca de tiempo de caducidad basada en
`BOARD_RETENTION_DAYS`, cuyo valor predeterminado es 90 y admite 1–365 días.
Cambiar este ajuste solo afecta a los tableros que se creen posteriormente. Una
vez alcanzada la caducidad, las lecturas normales y las comprobaciones de acceso
rechazan inmediatamente el tablero.

La limpieza de retención en segundo plano elimina los tableros caducados y sus
filas dependientes en bloques acotados, y después elimina sesiones anónimas
caducadas sin referencias y registros de limitación de frecuencia caducados. La
limpieza es asíncrona: una fila puede permanecer físicamente presente durante
algún tiempo después de dejar de ser accesible, especialmente tras una
interrupción o un fallo de limpieza. Las copias de seguridad, réplicas de base
de datos, instantáneas y registros externos pueden conservar datos durante más tiempo
que la base de datos activa.

La eliminación de un tablero iniciada por el propietario elimina inmediatamente
el tablero y sus datos dependientes dentro de la transacción de la aplicación,
siempre que la operación de base de datos tenga éxito. Cuando un participante
abandona el tablero o el propietario revoca un acceso, las filas históricas de
membresía o invitación se conservan hasta la limpieza de retención del tablero;
el acceso se marca como revocado en lugar de borrar todo el historial asociado.

Los operadores deben documentar por separado sus períodos reales de retención
de copias de seguridad y registros, verificar los resultados de la limpieza y
facilitar los avisos que exija su jurisdicción. La aplicación no proporciona un
flujo automatizado para verificar la identidad de un sujeto de datos.

## Registros y observabilidad

La limpieza de retención emite contadores operativos estructurados y evita
deliberadamente registrar UUID de tableros cuando falla la eliminación de un
padre. Otros componentes de la plataforma pueden registrar solicitudes de forma
predeterminada.

Configura el servidor de la aplicación, el proxy inverso, la plataforma de
contenedores, la base de datos, la supervisión y el sistema de seguimiento de
errores para que no registren:

- cookies ni cabeceras similares a las de autorización;
- cuerpos de solicitudes JSON ni contenido de tableros introducido por
  usuarios;
- tokens de invitación ni URL de reclamación de propietario;
- archivos exportados;
- variables de entorno, cadenas de conexión o cargas útiles del gestor de secretos;
  ni
- errores completos de base de datos que puedan contener detalles de conexión.

Restringe el acceso a los registros operativos necesarios, usa un período de
retención explícito y prueba la redacción. Nunca habilites registros SQL detallados o
de cuerpos de solicitudes contra una base de datos con datos reales de tableros
sin un procedimiento de incidente temporal y revisado.

## Lista de refuerzo para operadores

- Termina TLS en un límite de confianza y establece el `APP_ORIGIN` HTTPS
  exacto.
- Genera valores independientes y de alta entropía para
  `VISITOR_TOKEN_SECRET`, `BOARD_ACCESS_SECRET` y `RATE_LIMIT_KEY_SECRET`;
  guárdalos en un gestor de secretos, no en un repositorio ni una imagen.
- Planifica la rotación de secretos. Rotar los secretos de visitante o acceso al
  tablero sin una migración de doble clave o un procedimiento de recuperación
  invalida las credenciales o invitaciones existentes.
- Usa un rol dedicado de PostgreSQL con privilegios mínimos y mantén la base de
  datos en una red privada.
- Cifra el almacenamiento y las copias de seguridad de la base de datos,
  restringe el acceso a las copias y prueba regularmente la restauración en un
  entorno aislado.
- Aplica las migraciones antes de dirigir tráfico a una versión nueva de la
  aplicación. No ejecutes a la vez procesos de escritura antiguos y nuevos incompatibles.
- Usa una conexión directa a PostgreSQL o una conexión en modo sesión para
  `LISTEN` y los bloqueos consultivos de sesión; la agrupación solo por transacción es
  incompatible.
- Establece `TRUSTED_PROXY_HOPS` solo después de documentar la cadena real de
  proxies.
- Conserva en el proxy las cabeceras de seguridad y `no-store`; desactiva el
  almacenamiento en búfer y el caché para la ruta SSE.
- Supervisa `503`, `429`, eventos de fallo de limpieza, capacidad de la base de
  datos, uso de conexiones y actividad de invitaciones inusual sin recopilar el
  contenido de los tableros.
- Mantén Node.js, Next.js, PostgreSQL, las imágenes base y las dependencias en
  actualizaciones de seguridad admitidas.
- Restringe el acceso al comando de reclamación de propietario y entrega las
  credenciales generadas fuera de banda.
- Confirma que los mapas de código fuente, archivos `.env`, cachés de compilación, volcados
  de base de datos y registros no se incluyan en imágenes o artefactos publicados.

## Informar de vulnerabilidades

Usa el proceso descrito en [SECURITY.md](../../SECURITY.md). Incluye la versión o
la revisión afectada, pasos reproducibles con datos sintéticos, el impacto y
cualquier mitigación sugerida. No realices pruebas en sistemas o tableros que no
sean tuyos, no degrades un servicio público, no accedas al contenido de otro
usuario ni conserves datos obtenidos accidentalmente.
