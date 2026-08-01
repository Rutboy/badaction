[English](../getting-started.md) | [Русский](../ru/getting-started.md) | [Español](getting-started.md)

# Primeros pasos

Badaction puede ejecutarse por completo en contenedores o con Node.js en el host
y PostgreSQL en un contenedor. Ambos métodos usan las mismas migraciones
progresivas de Prisma.

La interfaz de la aplicación está actualmente en ruso. La documentación en
inglés, ruso y español describe el mismo comportamiento de la aplicación.

## Requisitos

Para usar contenedores, instala Docker con BuildKit y el comando de Compose v2
(`docker compose`). El proyecto no declara una versión mínima de Docker o
Compose.

Para desarrollar desde el código fuente, usa:

- Node.js 22.23.2;
- npm 10.9.8;
- PostgreSQL 16;
- Playwright 1.62.1 con su compilación de Chromium, solo para pruebas de
  navegador.

Las versiones exactas de Node y npm se registran en `.nvmrc` y `package.json`.
No se admiten otras versiones principales de PostgreSQL porque la cadena de
migraciones depende del comportamiento de PostgreSQL 16.

## Inicio rápido con contenedores

Clona el repositorio e inicia el perfil de la aplicación:

```bash
git clone https://github.com/Rutboy/badaction.git
cd badaction
docker compose --profile app up --build
```

Compose inicia PostgreSQL, ejecuta una vez las migraciones y después inicia el
contenedor de la aplicación sin privilegios de superusuario. Abre
<http://localhost:3000>. Comprueba la disponibilidad con:

```bash
curl --fail http://localhost:3000/api/health
```

Las credenciales predeterminadas son valores de desarrollo deliberadamente
predecibles. Los puertos de la base de datos y de la aplicación están vinculados
a la interfaz de bucle local, por lo que esta configuración de Compose no debe exponerse
directamente a una red.

Detén el conjunto en primer plano con `Ctrl+C` y después elimina sus contenedores
y su red:

```bash
docker compose --profile app down
```

El volumen con nombre `postgres-data` permanece y conserva los tableros entre
reinicios. Para eliminar permanentemente esa base de datos local, y solo cuando
sus datos sean desechables, ejecuta:

```bash
docker compose --profile app down --volumes
```

Si el puerto 3000 está ocupado, mantén alineados el puerto público y el origen
canónico:

```bash
APP_PORT=3100 DOCKER_APP_ORIGIN=http://localhost:3100 \
  docker compose --profile app up --build
```

La configuración de producción es deliberadamente distinta. Sigue
[Despliegue](deployment.md) antes de exponer una instancia.

## Configuración para desarrollar desde el código fuente

Instala las dependencias fijadas en `package-lock.json`, crea un archivo de
entorno local e inicia PostgreSQL:

```bash
npm ci
cp .env.example .env
docker compose up -d postgres
npm run prisma:generate
npm run prisma:deploy
npm run dev
```

Abre <http://localhost:3000>. Los secretos de desarrollo de `.env.example` son
exclusivos de un entorno de bucle local. No los reutilices en una instancia compartida
o pública y no incluyas `.env` en una revisión.

Detén Next.js con `Ctrl+C`. Detén la base de datos sin eliminar su volumen:

```bash
npm run db:stop
```

## Pruebas de navegador

Instala una vez el navegador admitido por Playwright:

```bash
npx playwright install chromium
```

Las pruebas de navegador y base de datos exigen deliberadamente una marca
explícita que confirme que los datos son desechables. Consulta
[Desarrollo](development.md) antes de ejecutarlas; nunca apuntes esos comandos a
una base de datos que contenga información que necesites conservar.

## Siguientes pasos

- Lee [Seguridad y privacidad](security-and-privacy.md) antes de compartir
  tableros.
- Usa [Configuración](configuration.md) al cambiar límites o puertos.
- Consulta [Solución de problemas](troubleshooting.md) si falla el inicio o las
  comprobaciones de salud.
