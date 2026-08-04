[English](../operations.md) | [Русский](../ru/operations.md) | [Español](operations.md)

# Operaciones

Los operadores son responsables de la base de datos, los secretos, el proxy
HTTPS, las copias de seguridad, la supervisión, la secuencia de actualizaciones
y los registros de infraestructura. Los archivos de Compose ofrecen una base para un
solo host; no proporcionan PostgreSQL gestionado, alta disponibilidad,
almacenamiento remoto de copias de seguridad, certificados ni alertas.

Una instalación creada con el [Inicio rápido](quick-start.md) puede usar
`sudo badaction doctor`, `status`, `logs`, `backup`, `start`, `stop` y
`restart`. Ese ayudante incluye la capa Compose opcional de Caddy. Los comandos
explícitos siguientes siguen siendo útiles para comprender y personalizar cada
operación.

Los comandos siguientes usan `.env.production` y ambos archivos de Compose.
Ejecútalos desde la copia de trabajo revisada del repositorio. Nunca pegues valores de
entorno expandidos, cookies de visitante, fragmentos de invitación, URL de
reclamación de propietario ni contenido de usuario en una incidencia o registro público.

## Estado y supervisión

La ruta no autenticada `GET /api/health` devuelve
`Cache-Control: no-store` y uno de estos resultados:

```json
{ "status": "ok" }
```

con HTTP 200, o:

```json
{ "status": "unavailable" }
```

con HTTP 503. Una respuesta 200 significa que:

- la configuración obligatoria del entorno de ejecución se ha analizado correctamente;
- la aplicación no está en estado de vaciado;
- PostgreSQL ha respondido a `SELECT 1` dentro del límite de 1.5 segundos de la
  aplicación.

No comprueba el conjunto de migraciones aplicado, la sesión `LISTEN` de tiempo
real, el progreso de la limpieza de retención, la transmisión del proxy, la
antigüedad de las copias de seguridad, el espacio en disco ni una operación
completa de tablero. Por tanto, la comprobación de estado puede permanecer en verde aunque el
tiempo real o la limpieza estén mal configurados.

Usa la ruta para comprobar la disponibilidad y compleméntala con:

- alertas de reinicio de contenedores, CPU, memoria, sistema de archivos y
  capacidad de PostgreSQL;
- `prisma migrate status` contra la base de datos prevista durante las
  actualizaciones;
- supervisión de eventos de limpieza y alertas ante resultados parciales o
  fallidos;
- un flujo sintético de tablero que verifique HTTPS, persistencia de cookies,
  membresía, una mutación, invalidación SSE y exportación sin conservar
  credenciales reales;
- comprobaciones de antigüedad de copias de seguridad y simulacros de
  restauración programados.

Empieza el diagnóstico con el estado y registros de alcance limitado:

```bash
docker compose \
  --env-file .env.production \
  -f docker-compose.yml \
  -f docker-compose.production.yml \
  --profile app \
  ps

docker compose \
  --env-file .env.production \
  -f docker-compose.yml \
  -f docker-compose.production.yml \
  --profile app \
  logs --tail 100 migrate app postgres

curl --fail --show-error --silent https://retro.example.com/api/health
```

Sanea los registros antes de compartirlos. Consulta
[Solución de problemas](troubleshooting.md) para los modos de fallo habituales.

## Copias de seguridad

Haz copias de seguridad de PostgreSQL independientemente del volumen con nombre
de Docker. Un volumen conserva datos cuando se reemplaza un contenedor, pero no
protege frente a la pérdida del host, errores del operador, corrupción o cambios
destructivos del esquema.

El comando siguiente crea en el host una copia de seguridad lógica de
PostgreSQL en formato personalizado. Sustituye el nombre del archivo de salida según tu
política de retención:

```bash
install -d -m 700 backups
umask 077
docker compose \
  --env-file .env.production \
  -f docker-compose.yml \
  -f docker-compose.production.yml \
  exec -T postgres \
  sh -c 'pg_dump --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --format=custom --no-owner --no-privileges' \
  > backups/badaction.dump
```

Un `pg_dump` en línea es coherente transaccionalmente, pero las escrituras
aceptadas después de su instantánea no forman parte del archivo. Define una
estrategia de mantenimiento o recuperación continua cuando esa ventana de
pérdida sea inaceptable. Para instalaciones grandes, considera copias físicas
nativas del proveedor y recuperación a un momento dado además de los volcados lógicos.

Para cada copia de seguridad:

1. Registra la revisión del código fuente de la aplicación, la versión principal
   de PostgreSQL y la marca de tiempo UTC por separado del volcado.
2. Cífrala, restringe el acceso y cópiala fuera del host de la aplicación.
3. Verifica que `pg_restore --list` pueda leerla.
4. Restáurala regularmente en un entorno PostgreSQL 16 aislado y ejecuta
   comprobaciones a nivel de aplicación.
5. Aplica una política de retención de copias de seguridad coherente con tus
   compromisos de privacidad.

Las copias de seguridad contienen títulos y contenido de tableros, nombres
visibles, votos, elementos de acción, historial de membresías y hashes de
credenciales. Pueden conservar datos después de que la limpieza de retención los
elimine de la base activa. Protégelas y hazlas caducar como datos sensibles; la
retención de la aplicación no borra copias de seguridad independientes ni registros
del proxy.

No uses como copia de seguridad una copia del sistema de archivos de un
directorio de datos PostgreSQL activo, salvo que la plataforma PostgreSQL
proporcione un procedimiento documentado de instantáneas coherentes.

## Simulacro de restauración

Prueba las restauraciones fuera de la base de datos activa. Usa PostgreSQL 16 y
una base de datos vacía; nunca restaures sobre la única copia actual.

Para un simulacro local, copia la plantilla de producción a un `.env.restore`
separado e ignorado. Rellena cada campo vacío con valores nuevos exclusivos de
pruebas, mantén distintos los tres roles y contraseñas de base de datos, elige
valores libres para `POSTGRES_PORT` y `APP_PORT`, y usa un
`DOCKER_APP_ORIGIN` local que coincida. El nombre explícito del proyecto asigna
al simulacro un volumen separado. Inicia el servicio PostgreSQL de producción
para crear los roles restringidos de migración y ejecución:

```bash
cp deploy/production.env.example .env.restore
# Rellena todos los campos vacíos con valores de prueba aislados.
docker compose \
  --env-file .env.restore \
  -f docker-compose.yml \
  -f docker-compose.production.yml \
  --project-name badaction-restore \
  up --detach --wait postgres
```

Restaura directamente en el `POSTGRES_DB` vacío. Conecta con el rol
administrativo, pero usa `--role` para que el migrador sea propietario de los
objetos restaurados y sus privilegios predeterminados concedan acceso a datos al
rol de ejecución:

```bash
docker compose \
  --env-file .env.restore \
  -f docker-compose.yml \
  -f docker-compose.production.yml \
  --project-name badaction-restore \
  exec -T postgres \
  sh -c 'pg_restore --username "$POSTGRES_USER" --role "$POSTGRES_MIGRATOR_USER" --dbname "$POSTGRES_DB" --exit-on-error --no-owner --no-privileges' \
  < backups/badaction.dump
```

Inicia el perfil de producción contra la base restaurada:

```bash
docker compose \
  --env-file .env.restore \
  -f docker-compose.yml \
  -f docker-compose.production.yml \
  --project-name badaction-restore \
  --profile app \
  up --detach --wait --wait-timeout 240
```

Un host completamente separado es aún más seguro. Después de restaurar:

1. Confirma que el contenedor de migración de una sola ejecución terminó
   correctamente. Su script auxiliar aplica las migraciones progresivas y elimina el
   acceso del rol de ejecución a `_prisma_migrations`.
2. Comprueba el estado y los recuentos de filas; después crea un tablero sintético
   nuevo para verificar membresías, actualizaciones en tiempo real y
   exportaciones.

Los secretos HMAC nuevos no pueden validar intencionadamente credenciales de
sesión o invitación preexistentes restauradas. Un simulacro de continuidad de
credenciales requiere una copia de los secretos HMAC originales controlada por
separado y una credencial de prueba dedicada; trata ese simulacro como un
procedimiento sensible de producción.

No publiques datos de usuarios restaurados ni uses una cookie de producción
de un usuario corriente contra la instancia de prueba. Elimina el entorno del
simulacro mediante su procedimiento aprobado de destrucción de datos después de
registrar el resultado.

Cuando hayas confirmado que los datos restaurados son desechables, elimina el
conjunto y el volumen aislados:

```bash
docker compose \
  --env-file .env.restore \
  -f docker-compose.yml \
  -f docker-compose.production.yml \
  --project-name badaction-restore \
  --profile app \
  down --volumes --remove-orphans
```

Para una recuperación real, detén todos los procesos de escritura de la aplicación,
aprovisiona un destino PostgreSQL 16 limpio con roles distintos para
administración, migraciones y ejecución, restaura la copia seleccionada como rol
migrador, aplica solo las migraciones progresivas requeridas por la versión de
aplicación elegida y verifícala de forma aislada antes de cambiar la conexión de
la aplicación. Mantén intacta y con acceso restringido la base de datos anterior
hasta que se acepte la recuperación.

## Actualizaciones y migraciones progresivas

Las migraciones de Prisma son progresivas. El proyecto no garantiza que una
aplicación antigua pueda ejecutarse contra un esquema recién migrado ni que
procesos de escritura antiguos y nuevos puedan ejecutarse simultáneamente. Usa una ventana de
mantenimiento coordinada salvo que se haya verificado que las migraciones
concretas son seguras con versiones mezcladas.

Para la configuración base de Compose:

1. Revisa las diferencias del código fuente y cada migración SQL nueva. Comprueba la
   compatibilidad con PostgreSQL 16, los bloqueos, las conversiones de datos, el
   espacio libre necesario y la duración prevista en una copia restaurada con
   tamaño equivalente a producción.
2. Construye u obtén un par de imágenes `migrate` y `app` correspondiente antes
   de la interrupción.
3. Crea y verifica una copia de seguridad.
4. Detén todos los procesos de escritura de la aplicación.
5. Ejecuta `prisma migrate deploy` mediante la imagen nueva del migrador.
6. Inicia la aplicación nueva y verifica el estado de las migraciones, la comprobación de estado y
   un flujo integral desechable.

Los comandos principales de Compose son:

```bash
docker compose \
  --env-file .env.production \
  -f docker-compose.yml \
  -f docker-compose.production.yml \
  --profile app \
  build migrate app

docker compose \
  --env-file .env.production \
  -f docker-compose.yml \
  -f docker-compose.production.yml \
  --profile app \
  stop app

docker compose \
  --env-file .env.production \
  -f docker-compose.yml \
  -f docker-compose.production.yml \
  --profile app \
  run --rm migrate

docker compose \
  --env-file .env.production \
  -f docker-compose.yml \
  -f docker-compose.production.yml \
  --profile app \
  up --detach --wait --wait-timeout 240
```

Con imágenes preconstruidas, descarga el par de imágenes verificado y omite el
paso de compilación. El servicio `migrate` normal puede volver a comprobar las
migraciones durante `up`; `migrate deploy` está diseñado para aplicar solo las
migraciones pendientes.

La ruta de estado no confirma el estado de las migraciones. Comprueba la
salida y los registros del migrador y ejecuta `npm run prisma:status` desde un entorno
de código fuente de confianza usando el `DATABASE_URL` exacto del destino.

No hay migraciones descendentes automatizadas. Si una reversión de la aplicación
no es compatible con el esquema migrado, restaura la copia de seguridad previa
a la actualización en una base de datos nueva y despliega contra ella la
aplicación antigua correspondiente. No edites una migración aplicada, ejecutes
`prisma migrate reset`, elimines esquemas ni trunques tablas para improvisar un
reversión sobre datos valiosos.

## Limpieza de retención

Cada tablero recibe una marca de tiempo de caducidad inmutable al crearse. El tablero
deja de ser accesible cuando caduca; la eliminación física ocurre en una pasada
de limpieza y no está garantizada en el segundo exacto de caducidad.

La limpieza integrada está habilitada de forma predeterminada. Cada proceso de
la aplicación intenta una pasada al arrancar y después de
`RETENTION_CLEANUP_INTERVAL_MINUTES`. Varias réplicas se coordinan mediante un
bloqueo consultivo de PostgreSQL y un marcador de intervalo mínimo almacenado en
la base de datos, de modo que solo un intento integrado realiza trabajo en cada
intervalo que corresponda. Cada intento usa lotes acotados y los conjuntos
grandes de filas dependientes de tableros se eliminan en bloques. Se informa de
un tablero o clase de limpieza que falle sin revertir todo el trabajo
independiente restante.

Supervisa los eventos estructurados de la aplicación:

- `retention_cleanup_completed`;
- `retention_cleanup_aborted`;
- `retention_cleanup_skipped_advisory_lock`;
- `retention_cleanup_skipped_minimum_interval`.

Trata un `failedSteps` no vacío, un `boardDeleteFailures` positivo, abortos
repetidos o la ausencia de ejecuciones correctas como una alerta. La actividad
de limpieza añade una sesión PostgreSQL temporal por cada réplica que lo
intenta y puede generar carga en la base de datos; ajusta el intervalo y el
tamaño del lote según la capacidad observada.

Si `RETENTION_CLEANUP_ENABLED=false`, configura un programador externo de
confianza. Desde una copia de trabajo completa del código fuente, con las dependencias y
el `DATABASE_URL` de destino, una pasada manual es:

```bash
DATABASE_URL='postgresql://...' npm run cleanup:expired -- 1000
```

El argumento opcional de lote debe ser un entero de `1` a `10000`. El comando
imprime un resultado JSON y termina con código distinto de cero si la pasada es
incompleta o falla. Usa el mismo bloqueo consultivo, pero no aplica el intervalo
mínimo del programador integrado, por lo que debes elegir deliberadamente la
cadencia externa.

El flujo de trabajo de GitHub Actions incluido es solo una plantilla manual que
se inicia con `workflow_dispatch`; de forma predeterminada no tiene una
programación horaria. El responsable de una copia derivada puede añadir
deliberadamente una programación solo después de configurar un entorno
`production` protegido con el secreto `DATABASE_URL` y supervisión de las
ejecuciones. Conceder a un ejecutor alojado de CI acceso directo a la base de
datos es una decisión de despliegue, no un requisito. Las ejecuciones integradas
y externas son seguras ante concurrencia gracias al bloqueo consultivo, pero las
ejecuciones redundantes aún consumen recursos.

Nunca deshabilites la limpieza sin un programa de sustitución. Verifica que las
copias de seguridad y los registros de infraestructura tengan políticas de
eliminación separadas; la limpieza de datos activos no puede borrar sus copias.

## Apagado ordenado

El proceso supervisor controla Next.js. Al recibir el primer `SIGTERM` o `SIGINT`, comienza
el vaciado, hace que `/api/health` devuelva 503, solicita al ciclo de vida de la
aplicación que detenga la limpieza, cierra la conexión de escucha compartida de PostgreSQL
y después reenvía la señal al proceso del servidor.

El ciclo de vida de la aplicación espera hasta 25 segundos. El supervisor
espera hasta 30 segundos para la preparación del apagado y el servicio de
Compose dispone de un período de gracia de 60 segundos. Configura cualquier
orquestador o gestor de servicios externo con al menos 60 segundos y retira
rápidamente del tráfico una instancia en vaciado. Una segunda señal puede
forzar la terminación; úsala únicamente cuando aceptes interrumpir trabajo.

Detén la aplicación sin eliminar los datos de PostgreSQL:

```bash
docker compose \
  --env-file .env.production \
  -f docker-compose.yml \
  -f docker-compose.production.yml \
  --profile app \
  stop app
```

Observa el estado 503 de vaciado y una salida limpia del contenedor en la
automatización del despliegue. No trates una parada forzada como un apagado
ordenado correcto.

## Varias réplicas

Todas las réplicas deben usar la misma base de datos, origen público y secretos
actuales de la aplicación. Las notificaciones de PostgreSQL llegan a la conexión
de escucha persistente de cada réplica, por lo que no se requiere afinidad de
sesión con una misma réplica para entregar eventos. La limpieza integrada se
coordina mediante el bloqueo consultivo y el marcador de intervalo de la base de
datos.

El escalado sigue requiriendo un diseño explícito:

- cada réplica añade un grupo de conexiones de Prisma y una conexión de escucha
  persistente después de usar el tiempo real, además de conexiones temporales de
  limpieza;
- el límite de flujos SSE en proceso es local a una réplica, por lo que la capa
  de entrada también debe aplicar una política global de conexiones y
  solicitudes;
- todas las réplicas deben detenerse para una migración que no sea segura con
  versiones mezcladas;
- los archivos de Compose incluidos no despliegan ni balancean varias réplicas;
- la comprobación de estado puede ser correcta en una réplica aunque su conexión
  de escucha o ruta de proxy esté averiada.

Haz pruebas de carga del comportamiento de solicitudes, flujos, reconexiones y
limpieza con el proxy y el agrupador de conexiones de base de datos reales antes
de aumentar el número de réplicas.

## Reclamación de propietario asistida por el operador

Badaction no tiene recuperación de cuentas. Borrar la cookie de visitante del
navegador del propietario hace perder la credencial que resuelve su membresía.
El UUID de un tablero por sí solo no demuestra la propiedad.

El repositorio incluye un comando limitado de operador para un tablero sin
propietario activo. Úsalo solo después de que un proceso independiente verifique
al solicitante y autorice la recuperación. El servicio se niega a emitir una
reclamación mientras exista una membresía de propietario activa; durante el
intento se revoca una fila de propietario vinculada a una sesión anónima
caducada o revocada. Perder una cookie mientras su sesión y fila de propietario
sigan activas no se puede recuperar con este comando y requiere una decisión de
incidente separada y revisada.

Ejecuta el comando desde una copia de trabajo completa y protegida del código fuente,
con los valores exactos de producción `DATABASE_URL`, `APP_ORIGIN`,
`VISITOR_TOKEN_SECRET`, `BOARD_ACCESS_SECRET` y `RATE_LIMIT_KEY_SECRET`
inyectados bajo sus nombres del entorno de ejecución:

```bash
npm ci
npm run prisma:generate
npm run access:claim-owner -- <board-uuid>
```

El comando valida la configuración de producción antes de mutar el estado.
Revoca una reclamación de propietario pendiente anterior, crea una reclamación
de un solo uso que caduca como máximo después de 24 horas o al caducar el
tablero, e imprime la URL `/join#token` resultante. Esa URL es una credencial
al portador.

No redirijas la URL a registros compartidos, transcripciones de comandos, incidencias,
analítica, capturas de pantalla ni conversaciones. Entrégala fuera de banda al
propietario verificado, registra solo metadatos de auditoría no secretos y
confirma el canje. Volver a ejecutar el comando invalida la reclamación de
propietario anterior que no se haya canjeado.

Lee [Seguridad y privacidad](security-and-privacy.md) para conocer el modelo de
acceso y datos, y [Configuración](configuration.md) antes de cambiar
credenciales, retención, confianza en proxies o ajustes de base de datos.
