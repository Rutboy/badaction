[English](../development.md) | [Русский](../ru/development.md) | [Español](development.md)

# Desarrollo

Lee [Contribuir](../../CONTRIBUTING.md) antes de proponer un cambio. Esta página
describe el flujo de desarrollo específico del repositorio.

## Estructura del repositorio

- `src/app` contiene las páginas de App Router y los gestores de rutas HTTP.
- `src/components` contiene la interfaz del producto y primitivas de interfaz
  reutilizables.
- `src/lib/services` contiene las operaciones de negocio y las transacciones de
  base de datos.
- `src/lib/access` contiene las sesiones anónimas, membresías, invitaciones y
  comprobaciones de roles.
- `src/lib/realtime` contiene las notificaciones de PostgreSQL y el
  comportamiento SSE.
- `src/lib/ratelimit`, `src/lib/validators` y `src/lib/errors` proporcionan
  protecciones compartidas para las solicitudes.
- `prisma/schema.prisma` y `prisma/migrations` definen el esquema de PostgreSQL y
  el historial de migraciones progresivas.
- `scripts` contiene ejecutores de integración protegidos, comandos operativos
  y comprobaciones del repositorio.
- `e2e` contiene el conjunto de pruebas de navegador para Chromium.

La dirección de dependencias preferida es interfaz → gestor de rutas → servicio →
Prisma → PostgreSQL. Los componentes de servidor pueden llamar directamente a los
servicios. Mantén la autorización y los invariantes sensibles a concurrencia en
los servicios o en la base de datos, en lugar de duplicarlos en el navegador.

## Configuración

Sigue el procedimiento de desarrollo desde el código fuente de
[Primeros pasos](getting-started.md):

```bash
npm ci
cp .env.example .env
docker compose up -d postgres
npm run prisma:generate
npm run prisma:deploy
npm run dev
```

Usa Node.js 22.23.2 y npm 10.9.8. El archivo de bloqueo y `package.json` deben cambiar
juntos cuando se modifican dependencias de forma intencionada.

## Comprobaciones rápidas

Ejecuta durante el desarrollo las comprobaciones pertinentes para tu cambio:

```bash
npm run typecheck
npm test
npm run lint
npm run format:check
```

Antes de enviar una solicitud de cambios, ejecuta las comprobaciones locales más
amplias:

```bash
npm run check:docs
npm run check:repo
npm run security:check
npm run check:licenses
npm run build
npm run check:standalone
```

`npm run audit:dependencies` consulta el servicio de avisos de npm y por tanto
requiere acceso a la red. Revisa cada hallazgo; no ocultes un aviso de severidad
alta únicamente para que el comando se complete correctamente.

## Pruebas de base de datos y navegador

Las pruebas de base de datos pueden borrar o reescribir datos de prueba. Se
omiten o rechazan salvo que el ejecutor reciba una marca explícita que confirme
que los datos son desechables. Nunca uses estos comandos con datos de
producción, compartidos o valiosos por cualquier otro motivo.

El conjunto de comprobaciones básicas de Docker crea un proyecto de Compose aislado y un volumen
temporal, comprueba migraciones, estado, acceso, persistencia tras reinicio y
apagado ordenado, y después elimina ese proyecto:

```bash
TEST_DATABASE_IS_DISPOSABLE=1 npm run test:docker
```

Para el conjunto de pruebas de base de datos ejecutado desde el host, proporciona primero una
base de datos PostgreSQL 16 que hayas creado específicamente para pruebas:

```bash
TEST_DATABASE_IS_DISPOSABLE=1 DATABASE_URL='postgresql://...' \
  npm run test:database
```

El script auxiliar de Playwright crea y elimina de forma predeterminada un esquema
temporal:

```bash
TEST_DATABASE_IS_DISPOSABLE=1 DATABASE_URL='postgresql://...' \
  npm run test:e2e
```

Instala Chromium con `npx playwright install chromium`. En `package.json` hay
otros ejecutores protegidos de limpieza, actualización y comprobación básica de acceso.

## Cambios de esquema

Usa una base de datos de desarrollo local y desechable al crear una migración:

```bash
npm run prisma:migrate
npm run prisma:generate
```

Incluye en la revisión el directorio de migración nuevo y los cambios generados
relacionados con el esquema. Nunca edites una migración ya aplicada para cambiar
un esquema desplegado. Describe en la solicitud de cambios las conversiones de datos,
restricciones de compatibilidad, requisitos de copia de seguridad y estrategia
de reversión. Producción aplica las migraciones existentes con
`npm run prisma:deploy`; nunca usa `migrate dev` ni `migrate reset`.

## Convenciones de código e interfaz

- Mantén TypeScript en modo estricto y realiza una acotación explícita de tipos en entradas
  desconocidas.
- Usa los patrones existentes de validación, errores, servicios e interfaz antes
  de añadir una abstracción o dependencia nueva.
- Conserva la navegación mediante teclado, la visibilidad del foco, el HTML
  semántico y el diseño móvil.
- No renderices HTML proporcionado por usuarios.
- Mantén en ruso los textos de la aplicación visibles para el usuario hasta que
  la aplicación disponga de un sistema de localización intencionado.
- Añade pruebas para éxito, fallos de autorización, entradas no válidas y los
  límites de concurrencia pertinentes.

## Documentación y capturas de pantalla

Las páginas en inglés son autoritativas. Actualiza las traducciones al ruso y al
español en el mismo cambio, conservando comandos, nombres de variables y
limitaciones. El comprobador de documentación valida las páginas obligatorias,
los selectores de idioma y los enlaces locales.

Las capturas del producto están en `docs/assets`. Deben usar datos sintéticos y
no mostrar URL de tableros, credenciales de invitación o reclamación de
propietario, cookies, información personal ni infraestructura del operador. La
generación de capturas usa el ejecutor protegido de Playwright; inspecciona la
imagen antes de incluirla en una revisión.

## Dependencias, licencias y ayuda de IA

Prefiere las dependencias existentes. Si añades una, revisa su estado de
mantenimiento, licencia, paquetes transitivos e impacto en el entorno de ejecución. Actualiza
`package-lock.json` y los avisos de terceros cuando sea necesario; después
ejecuta las comprobaciones de licencias y seguridad.

Se aceptan contribuciones con ayuda de IA, pero la persona que contribuye sigue
siendo responsable de entender el cambio, verificar su procedencia y licencia,
eliminar datos sensibles de la instrucción o del entorno, y aportar las mismas pruebas
y evidencias de revisión que para un trabajo escrito manualmente.
