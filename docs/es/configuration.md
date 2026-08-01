[English](../configuration.md) | [Русский](../ru/configuration.md) | [Español](configuration.md)

# Configuración

Badaction lee los ajustes del entorno de ejecución desde variables de entorno. Para
desarrollar desde el código fuente se suele cargar un `.env` ignorado que se
copia de `.env.example`. Docker Compose lee variables del host y asigna sus
valores `DOCKER_*` a los nombres del entorno de ejecución dentro de los
contenedores de la aplicación y del migrador.

Nunca incluyas archivos de entorno reales en una revisión. Usa un gestor de secretos o
un archivo propiedad del operador con permisos restrictivos, y no imprimas
valores de entorno expandidos en registros de CI o soporte.

## Ajustes del entorno de ejecución

La aplicación Node lee los siguientes ajustes.

| Variable                             | Obligatoria | Valor predeterminado                                     | Propósito                                                                                                                                                                                             | Notas de seguridad                                                                                                                                                                    |
| ------------------------------------ | ----------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                       | Sí          | Ninguno                                                  | Conecta Prisma, las migraciones, el tiempo real y la limpieza con PostgreSQL 16. El esquema admitido es `public`; usa `?schema=public`.                                                               | Trata la URL completa como un secreto. Debe proporcionar semántica de sesión; la agrupación solo por transacción rompe el tiempo real y el bloqueo de limpieza.                       |
| `APP_ORIGIN`                         | Producción  | Fuera de producción, se infiere de la solicitud si falta | Define el origen canónico exacto del navegador usado para comprobar mutaciones y generar URL de reclamación del propietario.                                                                          | Producción requiere HTTPS. Se rechazan credenciales, rutas, parámetros de consulta, fragmentos y una barra final; HTTP solo se acepta para `localhost`.                               |
| `VISITOR_TOKEN_SECRET`               | Producción  | Valor de desarrollo integrado fuera de producción        | Firma la cookie de visitante y deriva la identidad de voto acotada al tablero.                                                                                                                        | Usa un valor independiente, que no sea de relleno, de al menos 32 caracteres. La rotación invalida cookies y cambia la identidad de voto.                                             |
| `BOARD_ACCESS_SECRET`                | Producción  | Valor de desarrollo integrado fuera de producción        | Deriva hashes de sesiones anónimas e invitaciones.                                                                                                                                                    | Usa un valor independiente, que no sea de relleno, de al menos 32 caracteres. La rotación rompe la resolución del acceso y las invitaciones existentes.                               |
| `RATE_LIMIT_KEY_SECRET`              | Producción  | Valor de desarrollo integrado fuera de producción        | Deriva claves respaldadas por base de datos para límites por visitante e IP de confianza.                                                                                                             | Usa un valor independiente, que no sea de relleno, de al menos 32 caracteres. La rotación reinicia la continuidad con los registros existentes.                                       |
| `TRUSTED_PROXY_HOPS`                 | No          | `0`; entero `0`–`10`                                     | Selecciona el límite de confianza de `X-Forwarded-For` para límites secundarios de abuso por IP. Con `0`, siguen aplicándose los límites por visitante, pero se ignora la IP reenviada.               | Establece un valor positivo solo para una cadena de proxies controlada y documentada; un límite incorrecto puede confiar en entradas de atacantes o agrupar clientes no relacionados. |
| `BOARD_RETENTION_DAYS`               | No          | `90`; entero `1`–`365`                                   | Establece `expiresAt` al crear un tablero nuevo. Cambiarlo no reescribe las horas de caducidad de tableros existentes.                                                                                | Una retención más corta limita la exposición de datos activos, pero las copias de seguridad y los registros de infraestructura necesitan políticas de eliminación propias.            |
| `BOARD_CARD_LIMIT`                   | No          | `500`; entero `1`–`10000`                                | Limita las tarjetas de un tablero y acota el trabajo de exportación. Reducirlo por debajo de los datos existentes puede bloquear tarjetas nuevas y hacer fallar una exportación que supere el límite. | Elige un valor acotado adecuado para la capacidad de la base de datos y las solicitudes; no lo uses como sustituto de los controles de abuso del tráfico entrante.                    |
| `RETENTION_CLEANUP_ENABLED`          | No          | `true`; exactamente `true`, `false`, `1` o `0`           | Habilita el programador de limpieza integrado en cada proceso Node de la aplicación.                                                                                                                  | Si se deshabilita, es obligatorio un programa externo supervisado para aplicar la eliminación física.                                                                                 |
| `RETENTION_CLEANUP_INTERVAL_MINUTES` | No          | `60`; entero `1`–`1440`                                  | Establece la espera entre intentos de limpieza integrada y el intervalo mínimo coordinado en la base de datos entre réplicas. También se intenta una limpieza al arrancar.                            | Equilibra el retraso de eliminación y la carga de la base de datos; alerta sobre ejecuciones ausentes o fallidas en lugar de suponer que la cadencia configurada tuvo éxito.          |
| `RETENTION_CLEANUP_BATCH_SIZE`       | No          | `1000`; entero `1`–`10000`                               | Acota candidatos y trabajo masivo en una pasada de limpieza; los registros dependientes de cada tablero también se eliminan en bloques internos.                                                      | Los lotes grandes pueden aumentar la carga y la presión de bloqueos. Mide con datos restaurados de tamaño equivalente a producción antes de aumentarlos.                              |
| `NEXT_TELEMETRY_DISABLED`            | No          | `1` en las imágenes de compilación y ejecución de Docker | Desactiva la telemetría de Next.js cuando se establece en `1` durante una compilación o ejecución desde el código fuente.                                                                             | Mantenlo como se muestra cuando la política de despliegue prohíba la telemetría de la plataforma.                                                                                     |

`NODE_ENV`, `PORT` y `HOSTNAME` son ajustes del proceso o la plataforma, no
configuración del producto Badaction. La imagen de la aplicación los fija en `production`,
`3000` y `0.0.0.0`. Cambia la asignación del host de Compose con `APP_PORT`; no
cambies el puerto del contenedor salvo que también personalices la imagen y los
controles de estado. Next.js proporciona `NEXT_RUNTIME` y `NEXT_PHASE`, que no deben ser
configurados por un operador.

### Origen canónico

`APP_ORIGIN` es autoritativo para las comprobaciones del origen de las
mutaciones y las URL de reclamación de propietario generadas. Exacto significa
que el esquema, el host y el puerto no predeterminado explícito deben coincidir
con la cabecera `Origin` del navegador. Los siguientes son orígenes distintos:

```text
https://retro.example.com
https://retro.example.com:8443
http://localhost:3000
http://127.0.0.1:3000
```

Solo se acepta la forma HTTP de `localhost`, y únicamente para uso local. Un
proxy inverso no puede compensar un `APP_ORIGIN` incorrecto; establece
directamente el origen HTTPS público.

### URL y esquema de la base de datos

Las migraciones, las consultas de Prisma, las consultas de limpieza en SQL
directo, el bloqueo consultivo y la ruta `LISTEN/NOTIFY` se prueban con PostgreSQL
16 y el esquema `public`. Una URL habitual del entorno de ejecución de producción es:

```text
postgresql://badaction_app:URL_ENCODED_PASSWORD@postgres:5432/retro?schema=public
```

El nombre de host `postgres` es válido dentro de la red de Compose. Un proceso
ejecutado desde el código fuente en el host normalmente usa `localhost` y
`POSTGRES_PORT`. Si un proveedor externo requiere TLS, añade los parámetros SSL
que admita y verifica tanto Prisma como la conexión de escucha en tiempo real.
No uses un agrupador de conexiones que opere solo por transacción: `LISTEN` y
los bloqueos consultivos necesitan sesiones persistentes.

La configuración base de producción usa otra URL para el migrador. La cadena de
migraciones ejecuta `CREATE SCHEMA IF NOT EXISTS public`, por lo que el rol
migrador recibe `CREATE` sobre la propia base de datos y puede crear y poseer
objetos en `public`. El rol de la aplicación de larga duración no recibe ese
permiso y solo dispone de los privilegios de datos necesarios para el esquema
actual. Mantén separados ambos roles, contraseñas y URL.

Los esquemas alternativos de PostgreSQL no son compatibles con las consultas
operativas actuales. Cambiar solo el parámetro de consulta `schema` de Prisma es
insuficiente.

### Secretos de la aplicación y rotación

Genera cada secreto de la aplicación de forma independiente, por ejemplo con
`openssl rand -hex 32`. En producción, el entorno de ejecución valida la longitud
y los marcadores habituales de valores de relleno y rechaza que coincidan los tres valores
configurados.

No hay rotación integrada con doble clave. Trata un cambio directo como un
incidente o una migración de datos coordinada:

- rotar `VISITOR_TOKEN_SECRET` invalida las cookies de visitante existentes y
  cambia las identidades de voto acotadas al tablero; las filas de votos
  existentes permanecen, pero los navegadores ya no presentan la identidad
  anterior;
- rotar `BOARD_ACCESS_SECRET` cambia los hashes de sesión e invitación, de modo
  que las membresías existentes y los tokens de invitación en bruto no pueden
  resolverse a partir de sus credenciales de navegador actuales;
- rotar `RATE_LIMIT_KEY_SECRET` cambia el espacio de nombres de las claves de
  limitación de frecuencia y descarta de hecho la continuidad con los registros existentes.

Haz una copia de seguridad de la base de datos, define la recuperación de
usuarios y la reversión, y prueba la rotación en una copia restaurada antes de
cambiar cualquiera de estos valores. Perder los valores actuales tiene las
mismas consecuencias que rotarlos.

## Ajustes de Docker Compose

El archivo base de Compose es para desarrollo mediante la interfaz de bucle
invertido. La configuración
superpuesta de producción y `deploy/production.env.example` exigen valores del
operador para un uso compartido o público.

| Variable                       | Valor base predeterminado  | Comportamiento en producción                              | Efecto                                                                                                                                                      |
| ------------------------------ | -------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `COMPOSE_PROJECT_NAME`         | Derivado del directorio    | Plantilla: `badaction-production`                         | Da al conjunto de producción y a su volumen con nombre un espacio de nombres estable y separado del inicio rápido local.                                    |
| `POSTGRES_DB`                  | `retro`                    | Opcional; la plantilla usa `retro`                        | Base de datos que crea la imagen PostgreSQL cuando el volumen está vacío.                                                                                   |
| `POSTGRES_USER`                | `postgres`                 | Obligatorio en la configuración superpuesta de producción | Rol administrativo creado por la imagen PostgreSQL en un volumen vacío. La aplicación no lo usa.                                                            |
| `POSTGRES_PASSWORD`            | `postgres`                 | Obligatorio en la configuración superpuesta de producción | Contraseña inicial del `POSTGRES_USER` administrativo; la inicialización de producción exige al menos 32 caracteres.                                        |
| `POSTGRES_MIGRATOR_USER`       | Ninguno                    | Obligatorio en la configuración superpuesta de producción | Rol sin privilegios de superusuario creado en un volumen vacío; recibe `CREATE` sobre la base de datos y crea y posee los objetos de migración en `public`. |
| `POSTGRES_MIGRATOR_PASSWORD`   | Ninguno                    | Obligatorio en la configuración superpuesta de producción | Contraseña del rol migrador; al menos 32 caracteres y distinta de las contraseñas administrativa y del entorno de ejecución.                                |
| `POSTGRES_RUNTIME_USER`        | Ninguno                    | Obligatorio en la configuración superpuesta de producción | Rol sin privilegios de superusuario creado en un volumen vacío con acceso a datos, pero sin permisos para crear objetos de esquema.                         |
| `POSTGRES_RUNTIME_PASSWORD`    | Ninguno                    | Obligatorio en la configuración superpuesta de producción | Contraseña del rol de la aplicación de larga duración; al menos 32 caracteres y distinta de las contraseñas administrativa y del migrador.                  |
| `POSTGRES_PORT`                | `5432`                     | Opcional                                                  | Publica PostgreSQL como `127.0.0.1:<value>`. No cambia el puerto interno `5432`.                                                                            |
| `APP_PORT`                     | `3000`                     | Opcional                                                  | Publica la aplicación como `127.0.0.1:<value>`. No cambia el puerto interno `3000`.                                                                         |
| `DOCKER_DATABASE_URL`          | URL local predecible       | No se usa en la configuración superpuesta de producción   | Se pasa a ambos contenedores únicamente mediante el archivo Compose de desarrollo por la interfaz de bucle local.                                           |
| `DOCKER_MIGRATOR_DATABASE_URL` | Ninguno                    | Obligatorio en la configuración superpuesta de producción | Se pasa al migrador de una sola ejecución como `DATABASE_URL`; usa el rol migrador y `postgres:5432` para el servicio incluido.                             |
| `DATABASE_RUNTIME_ROLE`        | Ninguno                    | Derivado de `POSTGRES_RUNTIME_USER`                       | Ajuste interno del migrador: valida el rol de ejecución y revoca su acceso a `_prisma_migrations` tras una migración correcta.                              |
| `DOCKER_RUNTIME_DATABASE_URL`  | Ninguno                    | Obligatorio en la configuración superpuesta de producción | Se pasa a la aplicación de larga duración como `DATABASE_URL`; usa el rol de ejecución restringido y un punto de conexión que conserve sesiones.            |
| `DOCKER_APP_ORIGIN`            | `http://localhost:3000`    | Obligatorio en la configuración superpuesta de producción | Se pasa a la aplicación como `APP_ORIGIN`; usa el origen HTTPS externo, no la dirección del servicio superior en la interfaz de bucle local.                |
| `DOCKER_VISITOR_TOKEN_SECRET`  | Valor local predecible     | Obligatorio en la configuración superpuesta de producción | Se pasa como `VISITOR_TOKEN_SECRET`.                                                                                                                        |
| `DOCKER_BOARD_ACCESS_SECRET`   | Valor local predecible     | Obligatorio en la configuración superpuesta de producción | Se pasa como `BOARD_ACCESS_SECRET`.                                                                                                                         |
| `DOCKER_RATE_LIMIT_KEY_SECRET` | Valor local predecible     | Obligatorio en la configuración superpuesta de producción | Se pasa como `RATE_LIMIT_KEY_SECRET`.                                                                                                                       |
| `DOCKER_RUNNER_IMAGE`          | `badaction-runner:local`   | Opcional                                                  | Selecciona una imagen preconstruida de la aplicación. Emparéjala con la imagen de migración correspondiente.                                                |
| `DOCKER_MIGRATOR_IMAGE`        | `badaction-migrator:local` | Opcional                                                  | Selecciona una imagen de migración preconstruida. Emparéjala con la imagen de aplicación correspondiente.                                                   |

Compose transmite las variables del entorno de ejecución `TRUSTED_PROXY_HOPS`,
`BOARD_RETENTION_DAYS`, `BOARD_CARD_LIMIT`, `RETENTION_CLEANUP_ENABLED`,
`RETENTION_CLEANUP_INTERVAL_MINUTES` y `RETENTION_CLEANUP_BATCH_SIZE` con los
mismos nombres y los valores predeterminados de la tabla del entorno de ejecución.

Los ajustes `POSTGRES_*` y `deploy/init-production-db.sh` solo inicializan un
directorio de datos PostgreSQL vacío. Cambiarlos cuando el volumen con nombre ya
existe no renombra la base de datos, crea roles, concede privilegios ni actualiza
contraseñas. Modifica un volumen existente mediante administración de
PostgreSQL, actualiza después la URL correspondiente y reinicia el servicio
afectado. Nunca elimines un volumen para aplicar un cambio salvo que todos sus
tableros sean desechables o se hayan restaurado en otro lugar. Cambiar
`COMPOSE_PROJECT_NAME` selecciona otro conjunto y volumen; no migra datos.

Para desarrollo local, mantén alineados `APP_PORT` y `DOCKER_APP_ORIGIN`. Detrás
de un proxy inverso HTTPS, `DOCKER_APP_ORIGIN` es el origen externo y `APP_PORT`
es únicamente el puerto del servicio superior en la interfaz de bucle local.

## Ajustes exclusivos de pruebas

Las siguientes variables son protecciones o controles para los scripts auxiliares de
pruebas del repositorio. No son configuración de producción.

| Variable                                   | Valores aceptados                                             | Propósito                                                                                                                                                                                                                                                                              |
| ------------------------------------------ | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TEST_DATABASE_IS_DISPOSABLE`              | Exactamente `1`                                               | Obligatorio para los ejecutores destructivos de base de datos, limpieza, actualización, acceso, navegador y comprobación básica de Docker. Es una afirmación humana de seguridad, no una validación automática de la URL. Nunca lo establezcas para datos de producción o compartidos. |
| `RUN_DATABASE_TESTS`                       | Exactamente `1`                                               | Habilita casos de integración de base de datos que el ejecutor de pruebas de Node omite en caso contrario. `test:database` lo establece para su proceso hijo; el ejecutor de actualización lo exige explícitamente.                                                                    |
| `ACCESS_SMOKE_PORT`                        | Entero `1024`–`65535`; sin valor elige un puerto libre        | Sustituye el puerto del host reservado por `test:access-smoke`.                                                                                                                                                                                                                        |
| `E2E_PORT`                                 | Entero `1024`–`65535`; el script suele elegir un puerto libre | Selecciona el puerto local del servidor web de Playwright. La configuración directa de Playwright usa `3100` de forma predeterminada.                                                                                                                                                  |
| `PLAYWRIGHT_EXTERNAL_SERVER`               | `0` o `1`; valor predeterminado `0`                           | Hace que el script E2E pruebe un servidor ya activo en la interfaz de bucle local en vez de crear un esquema y servidor temporales.                                                                                                                                                    |
| `PLAYWRIGHT_EXTERNAL_SERVER_IS_DISPOSABLE` | `0` o `1`                                                     | Debe ser `1` en modo de servidor externo y no debe existir en caso contrario. Confirma que los datos de la aplicación externa pueden modificarse.                                                                                                                                      |
| `PLAYWRIGHT_BASE_URL`                      | Origen exacto `http://localhost:<port>`                       | Solo se requiere en modo de servidor externo y debe coincidir exactamente con `APP_ORIGIN`. Los orígenes de producción se rechazan de forma intencionada.                                                                                                                              |
| `SMOKE_BASE_URL`                           | URL; valor predeterminado `http://localhost:3000`             | Destino de bajo nivel para `smoke:access`. Los scripts auxiliares del repositorio normalmente lo establecen.                                                                                                                                                                           |
| `SMOKE_ORIGIN`                             | Origen; valor predeterminado `SMOKE_BASE_URL`                 | Cabecera `Origin` usada por la comprobación básica de acceso. Los scripts del repositorio normalmente la establecen.                                                                                                                                                                   |
| `DOCKER_SMOKE_SKIP_BUILD`                  | `0` o `1`                                                     | Con `1`, `test:docker` omite las compilaciones y requiere `DOCKER_RUNNER_IMAGE` y `DOCKER_MIGRATOR_IMAGE`.                                                                                                                                                                             |
| `DOCKER_SMOKE_PRODUCTION`                  | `0` o `1`                                                     | Con `1`, `test:docker` añade la configuración superpuesta de producción y verifica roles separados sin privilegios de superusuario para migración y ejecución.                                                                                                                         |
| `CI`                                       | Establecido por el proveedor de CI                            | Habilita comprobaciones más estrictas de pruebas enfocadas o inestables en Playwright y los informes de CI.                                                                                                                                                                            |

El script `docs:screenshot` establece internamente
`UPDATE_PRODUCT_SCREENSHOT`; usa ese script npm en lugar de establecer la
variable directamente.

Cada ejecutor de pruebas que cree, elimine, haga caducar o borre datos debe
apuntar a una base de datos PostgreSQL aislada. Un esquema temporal de Prisma no
convierte en segura una base de datos que sea valiosa por cualquier otro motivo.
Consulta [Desarrollo](development.md) para conocer los comandos admitidos.

## Comprobación previa de la configuración

Para la configuración base de Compose, valida la interpolación obligatoria sin
mostrar el modelo expandido que contiene secretos:

```bash
docker compose \
  --env-file .env.production \
  -f docker-compose.yml \
  -f docker-compose.production.yml \
  --profile app \
  config --quiet
```

Después del inicio, consulta `/api/health` y realiza las comprobaciones
funcionales de [Despliegue](deployment.md). La comprobación de estado valida la
forma de los ajustes del entorno de ejecución y una consulta breve a la base de
datos, pero no valida el estado de
las migraciones, el comportamiento de sesión en tiempo real, la ejecución de la
retención, las copias de seguridad ni la configuración del proxy.
