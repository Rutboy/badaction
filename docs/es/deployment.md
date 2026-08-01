[English](../deployment.md) | [Русский](../ru/deployment.md) | [Español](deployment.md)

# Despliegue

Este repositorio proporciona una configuración base de Docker Compose para un
host Linux. Construye imágenes separadas para migración y aplicación, inicia
PostgreSQL 16, ejecuta migraciones progresivas de Prisma y vincula los puertos
de la base de datos y de la aplicación a la interfaz de bucle local.

No es una plataforma de producción gestionada completa. Antes de prestar
servicio a equipos reales, el operador debe proporcionar DNS, terminación HTTPS,
un proxy inverso configurado correctamente, copias de seguridad y simulacros de
restauración, supervisión, gestión de secretos y seguridad del host y de la base
de datos. El volumen con nombre incluido aporta persistencia, no es una copia de
seguridad ni un diseño de alta disponibilidad.

## Requisitos previos

- Una revisión del código fuente de Badaction que se haya revisado.
- Docker con BuildKit y el comando de Compose v2 (`docker compose`). El proyecto
  no declara una versión mínima de Docker o Compose.
- Espacio suficiente en el host para imágenes, datos de PostgreSQL y copias de
  seguridad separadas.
- Un nombre DNS y un proxy inverso que termine HTTPS.
- Seis credenciales generadas de forma independiente: tres contraseñas de roles
  PostgreSQL y tres secretos HMAC de la aplicación.
- Un destino de copias de seguridad probado y un operador capaz de restaurar
  PostgreSQL 16.

La cadena de migraciones incluida admite PostgreSQL 16 en el esquema `public`.
No se admiten otras versiones principales de PostgreSQL ni esquemas
alternativos.

## Preparar el entorno

Copia la plantilla de producción a un archivo ignorado y restringe sus
permisos:

```bash
cp deploy/production.env.example .env.production
chmod 600 .env.production
```

Genera un valor nuevo seis veces y guarda cada resultado por separado:

```bash
openssl rand -hex 32
```

Edita `.env.production` y completa todos los campos vacíos. En particular:

- `POSTGRES_PASSWORD`, `POSTGRES_MIGRATOR_PASSWORD` y
  `POSTGRES_RUNTIME_PASSWORD` deben ser diferentes; los nombres asociados de
  los roles administrativo, migrador y de ejecución también deben ser distintos y
  coincidir con `[a-z_][a-z0-9_]{0,62}`;
- `DOCKER_MIGRATOR_DATABASE_URL` debe usar el rol migrador y
  `DOCKER_RUNTIME_DATABASE_URL`, el rol de ejecución. Ambas usan el nombre de host de
  servicio de Compose `postgres`, por ejemplo
  `postgresql://badaction_app:HEX_PASSWORD@postgres:5432/retro?schema=public`;
- `DOCKER_VISITOR_TOKEN_SECRET`, `DOCKER_BOARD_ACCESS_SECRET` y
  `DOCKER_RATE_LIMIT_KEY_SECRET` deben ser valores distintos, no valores de relleno y
  de al menos 32 caracteres;
- `DOCKER_APP_ORIGIN` debe ser el origen HTTPS público exacto, sin barra final,
  ruta, parámetros de consulta ni fragmento, por ejemplo `https://retro.example.com`.

Las contraseñas generadas en hexadecimal no necesitan codificación de URL. Si
una contraseña de base de datos contiene caracteres reservados de URL,
codifícala mediante escapes porcentuales en cada URL de base de datos afectada. Nunca
incluyas `.env.production` en una revisión, lo copies a una imagen ni imprimas su
configuración expandida de Compose en un registro público.

`COMPOSE_PROJECT_NAME=badaction-production` mantiene este conjunto y su volumen con
nombre separados del inicio rápido local. Al iniciar por primera vez un volumen
vacío, `deploy/init-production-db.sh` crea roles distintos, sin privilegios de
superusuario, para las migraciones y la ejecución. Como la cadena de migraciones
ejecuta `CREATE SCHEMA IF NOT EXISTS public`, el rol migrador recibe `CREATE`
sobre la propia base de datos y crea y posee los objetos de `public`; el rol de
ejecución no recibe ese privilegio y no puede crear objetos del esquema. Los
scripts de inicialización de PostgreSQL no se
ejecutan de nuevo en un volumen existente. En una instalación existente,
aprovisiona los roles y concede permisos mediante un cambio de base de datos
revisado, y actualiza las dos URL; no cambies el nombre del proyecto ni elimines
el volumen como atajo.

El archivo base `docker-compose.yml` contiene valores predeterminados
predecibles para desarrollo local. Incluye siempre
`docker-compose.production.yml` en una instancia compartida o pública; la
configuración superpuesta hace obligatorios la URL de base de datos, el origen
público y las credenciales.

Valida la interpolación antes de construir:

```bash
docker compose \
  --env-file .env.production \
  -f docker-compose.yml \
  -f docker-compose.production.yml \
  --profile app \
  config --quiet
```

`config --quiet` comprueba la sintaxis de Compose y la interpolación obligatoria.
La validación del entorno de ejecución aún ocurre en la aplicación: comprueba el origen, la
calidad de los secretos, los rangos numéricos y la disponibilidad de la base de
datos. Consulta [Configuración](configuration.md) para conocer cada ajuste y las
consecuencias de su rotación.

## Construir e iniciar

Construye ambos artefactos desde la copia de trabajo revisada:

```bash
docker compose \
  --env-file .env.production \
  -f docker-compose.yml \
  -f docker-compose.production.yml \
  --profile app \
  build migrate app
```

Después inicia el conjunto y espera al control de estado de la aplicación:

```bash
docker compose \
  --env-file .env.production \
  -f docker-compose.yml \
  -f docker-compose.production.yml \
  --profile app \
  up --detach --wait --wait-timeout 240
```

PostgreSQL debe estar saludable primero. A continuación, el contenedor
`migrate` de una sola ejecución ejecuta `prisma migrate deploy`; el contenedor
`app`, sin privilegios de superusuario, solo se inicia cuando las migraciones terminan
correctamente. Inspecciona el estado efectivo sin exponer valores de entorno:

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
```

Los registros aún pueden contener metadatos operativos. No publiques registros que
contengan contenido de tableros, cookies, URL de bases de datos, fragmentos de
invitación ni URL de reclamación de propietario.

Los ajustes opcionales `DOCKER_RUNNER_IMAGE` y `DOCKER_MIGRATOR_IMAGE`
seleccionan imágenes preconstruidas. Establece ambos en artefactos procedentes
del mismo código fuente revisado y conjunto de migraciones, preferiblemente
referencias a resúmenes criptográficos inmutables. No mezcles una imagen de aplicación con un
migrador de otra versión. Cuando uses imágenes preconstruidas, descárgalas y
pruébalas mediante tu propio proceso de cadena de suministro, e inicia con `--no-build`
en lugar de reconstruir sobre la referencia proporcionada.

## Proxy inverso HTTPS y SSE

Compose publica la aplicación como `127.0.0.1:${APP_PORT}:3000`. Un proxy
inverso en el mismo host puede enviar tráfico HTTPS público a esa dirección de
bucle local. Si el proxy se ejecuta en otro host o en otra red de contenedores,
esta base necesita un cambio de red explícito; no expongas el puerto de Node
directamente a Internet.

Establece las cabeceras de reenvío de confianza habituales para todas las
solicitudes. Para la ruta de eventos del tablero, conserva la semántica de
transmisión:

- usa HTTP/1.1 o posterior hacia el servicio superior;
- desactiva el almacenamiento en búfer de respuestas, el caché, la compresión y
  las transformaciones;
- mantén abierta la conexión con el servicio superior con un tiempo de espera
  de lectura superior a la señal de mantenimiento de 12 segundos;
- transmite rápidamente las desconexiones para que el servidor pueda liberar
  capacidad de flujos.

La aplicación ya devuelve `text/event-stream`,
`Cache-Control: no-store, no-transform`, `Connection: keep-alive` y
`X-Accel-Buffering: no`. La configuración del proxy sigue siendo necesaria. El
siguiente fragmento de Nginx ilustra el comportamiento requerido y debe
integrarse con la política TLS y de seguridad del operador:

```nginx
location ~ ^/api/boards/[0-9a-f-]+/events$ {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header Accept-Encoding "";
    proxy_buffering off;
    proxy_cache off;
    gzip off;
    proxy_read_timeout 60s;
    proxy_send_timeout 60s;
}
```

El cliente también concilia el estado autoritativo del tablero cada 30 segundos
y el servidor vuelve a comprobar el acceso al flujo cada 30 segundos. Esta
alternativa reduce el impacto de un fallo transitorio de SSE, pero no convierte
en aceptable una configuración incorrecta del proxy o del proceso de escucha.

`TRUSTED_PROXY_HOPS` solo controla qué dirección de `X-Forwarded-For` se puede
usar para los límites de abuso secundarios. Mantenlo en `0` salvo que todos los
saltos dentro del límite de confianza configurado estén controlados y
documentados. En una ruta directa Nginx-a-aplicación, `1` suele ser el límite del
proxy; los balanceadores de carga adicionales cambian ese número. Un valor
positivo incorrecto puede confiar en direcciones aportadas por atacantes o
agrupar clientes no relacionados.

## Semántica de las conexiones de PostgreSQL

La aplicación usa el mismo `DATABASE_URL` para tres tipos de acceso:

- el grupo de conexiones de Prisma usado para solicitudes y migraciones;
- una sesión `pg` persistente por proceso de aplicación después de su primer
  flujo en tiempo real, usada para `LISTEN` de PostgreSQL;
- una sesión `pg` temporal durante cada intento de limpieza de retención, usada
  para mantener un bloqueo consultivo.

Usa una conexión directa a PostgreSQL o un agrupador de conexiones que conserve la afinidad de
sesión. La agrupación solo por transacción es incompatible tanto con `LISTEN` como
con el bloqueo de limpieza. Una respuesta correcta de `/api/health` no demuestra
que estas funciones de sesión operen, porque la ruta de estado solo ejecuta
un breve `SELECT 1`.

Reserva conexiones de base de datos para cada réplica de la aplicación: cada
una tiene su propio grupo de conexiones de Prisma y proceso de escucha en tiempo real, y la limpieza
añade brevemente otra sesión. El repositorio no establece un tamaño universal
para el grupo de conexiones de Prisma porque la capacidad depende del host y de la base de
datos. Prueba el flujo completo del tablero con la topología de conexiones
elegida antes de exponerlo.

## Verificar el despliegue

Primero consulta la ruta por la interfaz de bucle local desde el host:

```bash
curl --fail --show-error --silent http://127.0.0.1:3000/api/health
```

Cuando DNS y TLS estén activos, consulta la ruta pública y verifica el
certificado:

```bash
curl --fail --show-error --silent https://retro.example.com/api/health
```

Una respuesta saludable es `{"status":"ok"}`. Significa que la configuración
del entorno de ejecución se ha analizado, que el proceso no se está vaciando y que una
consulta a la base de datos con un tiempo de espera de 1,5 segundos ha tenido éxito. No
verifica el estado de las migraciones, la entrega en tiempo real, el progreso de
la limpieza, las copias de seguridad, el almacenamiento en búfer del proxy, el
espacio disponible ni el flujo público de tableros.

Completa una comprobación funcional desechable a través del origen público:

1. Crea un tablero en un perfil de navegador.
2. Canjea una invitación de participante en otro perfil.
3. Confirma que las actualizaciones llegan a ambos perfiles sin recarga manual.
4. Prueba una mutación y una exportación.
5. Elimina el tablero desechable desde el perfil del propietario.

No registres URL de invitación, cookies ni contenido de tableros durante las
pruebas. Supervisa los registros de la aplicación y de PostgreSQL, y confirma la
salida de eventos de limpieza de retención.

## Apagado y límites del despliegue

Usa Compose para enviar `SIGTERM` a la aplicación en lugar de matar el proceso:

```bash
docker compose \
  --env-file .env.production \
  -f docker-compose.yml \
  -f docker-compose.production.yml \
  --profile app \
  stop app
```

Durante el apagado, la aplicación marca la comprobación de estado como no disponible, cancela o
espera a la limpieza y cierra el proceso de escucha de PostgreSQL. El límite interno de su
ciclo de vida es de 25 segundos, el límite de preparación del supervisor es de
30 segundos y Compose permite 60 segundos antes de forzar la terminación. Da a
cualquier otro orquestador al menos el mismo período de gracia. Una segunda
señal de terminación puede forzar la muerte del proceso.

La configuración incluida es un punto de partida para un solo host. No
proporciona conmutación automática por error, despliegues progresivos, cambios de esquema sin
interrupción, automatización de certificados, copias de seguridad remotas, registros
centralizados, métricas, alertas, límites de recursos ni un límite global de
conexiones SSE. Varias réplicas pueden compartir una base de datos y coordinar
la limpieza integrada, pero multiplican el uso de conexiones y los límites de
flujos locales; diseña y prueba los límites del tráfico entrante y la secuencia de
actualización antes de ampliar el sistema.

Usa [Operaciones](operations.md) para los procedimientos de copia de seguridad,
restauración, migración progresiva, retención, estado y recuperación del
propietario. Usa [Solución de problemas](troubleshooting.md) cuando fallen las
comprobaciones de inicio, base de datos o tiempo real.
