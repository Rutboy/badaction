[English](../troubleshooting.md) | [Русский](../ru/troubleshooting.md) | [Español](troubleshooting.md)

# Solución de problemas

Empieza por el estado de los contenedores y por registros de alcance limitado. No
pegues URL de bases de datos, cookies, fragmentos de invitación, URL de
reclamación de propietario ni contenido de tarjetas en una incidencia.

```bash
docker compose --profile app ps
docker compose --profile app logs migrate app postgres
curl -i http://localhost:3000/api/health
```

## El puerto de la aplicación ya está en uso

Elige otro puerto en la interfaz de bucle local y haz que coincida con el origen canónico:

```bash
APP_PORT=3100 DOCKER_APP_ORIGIN=http://localhost:3100 \
  docker compose --profile app up --build
```

Para desarrollar en el host, cambia a la vez `APP_ORIGIN` y el puerto que se
pasa a Next.js. Mezclar `localhost` y `127.0.0.1` también crea ámbitos de cookie
distintos en el navegador.

## PostgreSQL no llega a estar saludable

Comprueba `docker compose logs postgres` y verifica que el puerto del host esté
disponible. El contenedor escucha internamente en 5432 incluso cuando
`POSTGRES_PORT` cambia la asignación del host. Los contenedores de la aplicación
deben usar el nombre de servicio `postgres`, no `localhost`.

Los volúmenes con nombre existentes conservan la base de datos y los roles
creados durante el primer arranque. Cambiar después cualquier valor
`POSTGRES_*` no reescribe el clúster ni vuelve a ejecutar
`deploy/init-production-db.sh`. Aplica en PostgreSQL un cambio revisado de roles
o contraseñas y actualiza la URL correspondiente, o restaura una copia en un
volumen recién configurado. No elimines un volumen salvo que su contenido sea
desechable. Cambiar `COMPOSE_PROJECT_NAME` selecciona silenciosamente otro
volumen con nombre.

## Falla el contenedor de migración

Revisa `docker compose logs migrate`. Las causas habituales son un
`DOCKER_MIGRATOR_DATABASE_URL` no válido (o `DOCKER_DATABASE_URL` en local),
permisos insuficientes sobre el esquema, un servidor que no es PostgreSQL 16 o
un cambio de esquema manual/interrumpido.
Comprueba el estado de las migraciones en la base de datos prevista:

```bash
DATABASE_URL='postgresql://...' npm run prisma:status
```

No edites archivos de migración ya aplicados ni uses `prisma migrate reset` con
datos valiosos. Haz una copia de seguridad de la base de datos antes de reparar
un incidente de migración.

### Prisma muestra una advertencia sobre `onDelete: SetNull`

`prisma validate` muestra una advertencia para la relación de origen de una
tarea. La migración aplicada de PostgreSQL 16 usa deliberadamente la lista de
columnas `ON DELETE SET NULL (source_card_id)`: al eliminar, borra el origen
opcional y conserva el `board_id` obligatorio. El esquema de Prisma no puede
expresar esta forma de la restricción. Considera la migración como fuente de la
verdad y no la sustituyas por una restricción compuesta `SET NULL` ordinaria.

## La comprobación de estado devuelve 503

`GET /api/health` devuelve 503 mientras el proceso se está vaciando, cuando la
configuración del entorno de ejecución no es válida o cuando falla su breve consulta a la
base de datos. La ruta no verifica la versión de las migraciones, la
conexión de escucha en tiempo real, el programador de limpieza, las copias de seguridad ni
el comportamiento del proxy externo. Revisa los registros de la aplicación y de la
base de datos antes de reiniciar repetidamente.

## Producción rechaza la configuración al arrancar

La configuración superpuesta de producción requiere tanto
`DOCKER_MIGRATOR_DATABASE_URL` con el rol migrador como
`DOCKER_RUNTIME_DATABASE_URL` con el rol restringido de la aplicación. Los tres
nombres de rol y sus contraseñas deben ser distintos entre sí, y cada contraseña
debe contener al menos 32 caracteres. Codifica en las URL los caracteres
reservados de las contraseñas. La aplicación también requiere un `APP_ORIGIN`
HTTPS exacto y tres secretos diferentes de al menos 32 caracteres. `APP_ORIGIN`
no debe contener ruta, consulta, fragmento, credenciales ni barra final. Se
rechazan los marcadores de ejemplo de desarrollo conocidos. Consulta
[Configuración](configuration.md) para conocer los rangos aceptados.

## Las mutaciones devuelven un error de origen

El origen del navegador debe coincidir exactamente con `APP_ORIGIN`, incluidos
el esquema, el nombre de host y el puerto. Configura las cabeceras de reenvío en el proxy
HTTPS, pero no establezcas `TRUSTED_PROXY_HOPS` por encima de cero salvo que la
cadena de proxies esté controlada y su valor `X-Forwarded-For` sea fiable.

## La URL de un tablero devuelve «no encontrado»

El UUID de un tablero es un dato de localización, no una credencial de acceso. El mismo
navegador también debe conservar una sesión de visitante activa y una membresía
del tablero. Borrar las cookies, cambiar de perfil de navegador o de nombre de host,
abandonar un tablero o ser eliminado invalida ese acceso. Los participantes
necesitan una invitación nueva. El acceso del propietario no puede recuperarse
solo a partir del UUID; usa el procedimiento del operador descrito en
[Operaciones](operations.md) únicamente después de verificar a quien lo
solicita.

## Un enlace de invitación no funciona

Los tokens de invitación aparecen después de `#` y los procesa el navegador;
los fragmentos no se envían en las solicitudes HTTP. Usa la URL completa
`/join#token` en el mismo navegador que debe recibir la membresía. El enlace
también puede haber caducado, estar revocado o haber agotado sus usos. Nunca
publiques la URL al pedir ayuda.

## Las actualizaciones en tiempo real se retrasan o se reconectan

El cliente vuelve a la conciliación periódica, por lo que el tablero puede
seguir funcionando con actualizaciones más lentas. Para que SSE funcione con
normalidad, verifica que el proxy:

- desactive el almacenamiento en búfer de respuestas, el caché y la compresión
  para la ruta de eventos;
- use un tiempo de espera de lectura del servicio superior mayor que la señal de
  mantenimiento de 12 segundos;
- no transforme las respuestas `text/event-stream`.

La URL de base de datos que usa la aplicación debe permitir una sesión
persistente de PostgreSQL para `LISTEN`. La agrupación solo por transacción es
incompatible. La comprobación de estado puede seguir en verde aunque esta ruta
no funcione, así que revisa la actividad de red del navegador y los registros de
la aplicación. Consulta [Despliegue](deployment.md).

## Las pruebas de navegador no pueden iniciar Chromium

Instala únicamente el navegador de Playwright admitido por este proyecto:

```bash
npx playwright install chromium
```

En hosts Linux de CI, Playwright puede necesitar las dependencias de sistema que
documenta. El proyecto no declara compatibilidad con Firefox o WebKit.

## Una imagen autónoma no supera la comprobación de licencias

Construye mediante el script del repositorio para sanear la salida autónoma y
generar los avisos de sus dependencias:

```bash
npm run build
npm run check:standalone
```

El paso de preparación también rechaza archivos de entorno en
`.next/standalone`.

## Pedir ayuda

Usa el proceso descrito en [Soporte](../../SUPPORT.md). Si sospechas de una
vulnerabilidad, usa el canal privado de [Seguridad](../../SECURITY.md) en lugar
de una incidencia pública.
