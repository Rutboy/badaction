[English](../quick-start.md) | [Русский](../ru/quick-start.md) | [Español](quick-start.md)

# Inicio rápido: instalación guiada en un servidor

Esta es la ruta de producción más sencilla para quien empieza con el
autohospedaje. El instalador solicita un dominio y un correo electrónico,
genera todas las contraseñas de base de datos y secretos de la aplicación,
instala Docker cuando hace falta, inicia la aplicación y configura HTTPS
automático mediante Caddy.

El resultado es una instalación en un solo servidor. El servidor, DNS, copias
de seguridad, actualizaciones y supervisión siguen siendo tu responsabilidad.
Las guías detalladas de [Despliegue](deployment.md),
[Configuración](configuration.md) y [Operaciones](operations.md) siguen siendo
la referencia para instalaciones personalizadas o críticas.

## Qué necesitas antes de empezar

- Un servidor Linux nuevo con una IP pública y acceso `root` o `sudo`. El
  instalador puede instalar Docker automáticamente en Debian y Ubuntu. En otra
  distribución Linux, instala primero Docker Engine con Compose v2 y Git.
- Como mínimo práctico, 2 GB de RAM y 10 GB de disco libre. Un servidor pequeño
  puede necesitar swap durante la compilación; los datos, imágenes, registros y
  copias consumirán más espacio con el tiempo.
- Un dominio o subdominio bajo tu control, como `retro.example.com`.
- Un correo para avisos de certificados TLS. Caddy lo guarda en el entorno
  privado y lo envía a la autoridad de certificación.
- Los puertos TCP entrantes `80` y `443` abiertos en el cortafuegos o grupo de
  seguridad del proveedor. Restringe SSH a direcciones administrativas de
  confianza cuando sea posible.
- Un destino cifrado separado para copias de la base y los secretos. Un volumen
  Docker en el mismo servidor da persistencia, pero no es una copia de seguridad.

El instalador guiado está pensado para un host nuevo. No elimina un servidor
web existente, no reemplaza un `.env.production` administrado manualmente y no
borra volúmenes Docker.

## 1. Apunta el dominio al servidor

En el panel del registrador o proveedor DNS, crea:

- un registro `A` para el nombre elegido que apunte a la IPv4 pública del
  servidor;
- un registro `AAAA` solo si el servidor tiene IPv6 pública funcional y un
  cortafuegos configurado para ella.

Para la primera instalación, usa registros DNS normales sin modo CDN o proxy.
Elimina registros `A` o `AAAA` obsoletos para el mismo nombre. La propagación
puede tardar. Finalmente, este comando en el servidor debe mostrar una dirección
que reconozcas:

```bash
getent ahosts retro.example.com
```

Sustituye `retro.example.com` por tu nombre real en todos los ejemplos. Caddy
solo puede obtener un certificado público cuando el dominio llega a este
servidor y los puertos `80` y `443` son accesibles.

## 2. Descarga y ejecuta el instalador

Conéctate por SSH. Descarga primero el script en vez de enviar un programa
remoto directamente a un shell privilegiado:

```bash
curl --fail --show-error --location \
  https://raw.githubusercontent.com/Rutboy/badaction/main/deploy/install.sh \
  --output /tmp/badaction-install.sh
sudo bash /tmp/badaction-install.sh
```

Si falta `curl` en un Debian o Ubuntu nuevo, instálalo primero:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl
```

El script solicita:

1. el dominio sin `https://`, puerto, ruta ni barra final;
2. el correo usado para avisos del certificado TLS;
3. confirmar que las direcciones DNS mostradas llevan a este servidor;
4. permiso para instalar Docker desde el repositorio apt oficial cuando no
   existen Docker Engine y Compose v2 funcionales.

No tienes que inventar ni copiar contraseñas. El instalador genera seis valores
independientes de 256 bits: tres contraseñas PostgreSQL y tres secretos de la
aplicación. Nunca los imprime.

Para revisar el plan sin cambiar el servidor:

```bash
bash /tmp/badaction-install.sh \
  --dry-run \
  --domain retro.example.com \
  --email admin@example.com \
  --yes
```

La primera compilación puede tardar varios minutos. Es seguro volver a ejecutar
el instalador tras corregir un error: reutiliza su configuración protegida y no
elimina los volúmenes PostgreSQL o Caddy.

## Qué cambia el instalador

De forma predeterminada, el script descargado:

1. clona la rama `main` actual en `/opt/badaction`, o usa el checkout que
   contiene el script si se ejecuta desde un clon;
2. instala Git y los paquetes oficiales de Docker Engine cuando faltan en
   Debian o Ubuntu;
3. escribe `/opt/badaction/.env.production` con modo `600`, credenciales
   generadas y roles distintos de administración, migración y aplicación;
4. elige puertos de bucle local libres para los mapeos directos de aplicación y
   PostgreSQL;
5. compila las imágenes de migración y aplicación sin `root`, inicializa
   PostgreSQL 16 y aplica migraciones progresivas;
6. inicia Caddy en los puertos TCP públicos `80` y `443`; Caddy obtiene y
   renueva el certificado HTTPS y reenvía tráfico al servicio privado;
7. fija el límite de confianza al único salto Caddy y desactiva la compresión
   hacia el upstream durante los eventos SSE;
8. instala `/usr/local/bin/badaction` como acceso a comandos cotidianos seguros.

Solo Caddy se publica en Internet. Los puertos host de la aplicación y
PostgreSQL siguen ligados a `127.0.0.1`. El volumen de datos de Caddy conserva
certificados y claves privadas al reemplazar contenedores.

## 3. Verifica el resultado

Ejecuta las comprobaciones básicas integradas:

```bash
sudo badaction doctor
```

Valida Compose, muestra los contenedores y comprueba los endpoints de salud
privado y HTTPS público. Una respuesta sana es `{"status":"ok"}`.

Abre `https://retro.example.com` en un navegador y realiza una prueba funcional
desechable:

1. Confirma que el navegador muestra un certificado HTTPS válido.
2. Crea un tablero de prueba.
3. Abre una invitación de participante en una ventana privada/incógnita.
4. Cambia una tarjeta en una ventana y confirma que la otra se actualiza sin
   recargar manualmente.
5. Prueba una exportación y elimina el tablero desde la ventana del propietario.

No publiques URL de tableros, invitaciones, cookies ni capturas con datos reales.

## 4. Protege la instalación

Antes de invitar a un equipo real:

- Guarda una copia externa cifrada de `.env.production`. Perder o cambiar sus
  secretos puede invalidar accesos del navegador e invitaciones. No pongas el
  archivo en Git, correo, chat ni incidencias.
- Crea la primera copia de la base:

  ```bash
  sudo badaction backup
  ```

  El comando crea un dump privado con fecha en `/opt/badaction/backups`, verifica
  que PostgreSQL puede leer su catálogo e imprime la ruta. Cópialo a un almacén
  cifrado fuera del servidor; una copia local también se pierde con el host.

- Configura copias externas programadas, retención, vigilancia de disco y
  simulacros de restauración. Sigue [Copias de seguridad](operations.md#copias-de-seguridad)
  antes de guardar datos de producción.
- Supervisa `https://retro.example.com/api/health`, reinicios de contenedores,
  disco libre, capacidad PostgreSQL y fallos de limpieza. Un endpoint verde no
  demuestra por sí solo que funcionen tiempo real o copias.
- Mantén al día las actualizaciones de seguridad del sistema y Docker Engine.
  No expongas el socket Docker ni añadas usuarios no fiables al grupo `docker`:
  controlar Docker equivale prácticamente a acceso `root`.

Los puertos publicados por Docker pueden interactuar de forma inesperada con
cortafuegos del host como UFW. Confirma alcance y restricciones en el
cortafuegos del proveedor y lee la
[advertencia de Docker](https://docs.docker.com/engine/install/ubuntu/#firewall-limitations)
si el host tiene reglas propias.

## Comandos cotidianos

Puedes ejecutarlos desde cualquier directorio:

| Tarea                                        | Comando                     |
| -------------------------------------------- | --------------------------- |
| Diagnóstico básico completo                  | `sudo badaction doctor`     |
| Estado de contenedores                       | `sudo badaction status`     |
| Últimos registros de aplicación y proxy      | `sudo badaction logs`       |
| Registro de un servicio                      | `sudo badaction logs caddy` |
| Dump verificado de la base                   | `sudo badaction backup`     |
| Detener todos los contenedores correctamente | `sudo badaction stop`       |
| Compilar cambios e iniciar el conjunto       | `sudo badaction start`      |
| Reiniciar aplicación y proxy                 | `sudo badaction restart`    |

Los registros pueden contener metadatos operativos. Límpialos antes de
compartirlos y nunca publiques credenciales, cookies, fragmentos de invitación,
URL de recuperación del propietario ni contenido de tableros.

## Actualizaciones

Todavía no hay ramas de versiones; las correcciones de seguridad llegan a
`main`. No configures un `git pull` desatendido. Antes de actualizar, revisa los
cambios y migraciones, crea y mueve fuera del servidor una copia verificada y
planifica mantenimiento según
[Actualizaciones y migraciones](operations.md#actualizaciones-y-migraciones-progresivas).

Tras esa revisión, la secuencia básica para `/opt/badaction` es:

```bash
cd /opt/badaction
sudo badaction backup
sudo git pull --ff-only
sudo bash deploy/install.sh --yes
sudo badaction doctor
```

El instalador reutiliza el entorno y los secretos existentes. Rechaza cambiar
silenciosamente el dominio o correo TLS. Las migraciones solo avanzan; la guía
de operaciones explica compatibilidad, copias y límites de reversión.

## Si la instalación no termina

El script se detiene en la primera comprobación fallida y no borra datos.
Soluciones frecuentes:

- **El dominio no resuelve:** corrige `A`/`AAAA`, espera y repite el comando.
- **El puerto 80 o 443 está ocupado:** detén o reconfigura Nginx, Apache, Caddy
  o el proxy de un panel existente. El Caddy guiado necesita ambos puertos TCP.
- **Docker está instalado pero no disponible:** ejecuta
  `sudo systemctl status docker`. El instalador no reemplaza una instalación de
  contenedores averiada o conflictiva.
- **HTTPS público aún no está listo:** ejecuta `sudo badaction logs caddy`,
  revisa DNS y el cortafuegos del proveedor, espera un minuto y usa
  `sudo badaction doctor`.
- **Un contenedor no está sano:** ejecuta `sudo badaction status` y
  `sudo badaction logs postgres migrate app caddy`.
- **Se detecta un volumen o proyecto `badaction-production`:** detente y busca el
  entorno y las copias de esa instalación. El asistente rechaza conectar
  credenciales nuevas a datos posiblemente valiosos. No borres el volumen solo
  para continuar.
- **Falta memoria o disco:** añade swap o amplía el servidor, libera solo
  espacio seguro y repite. No borres volúmenes Docker desconocidos.

Consulta [Solución de problemas](troubleshooting.md) para otros casos. Para un
proxy propio, PostgreSQL existente, varias réplicas, un registro externo o un
gestor de secretos, usa la guía avanzada de [Despliegue](deployment.md) en lugar
de la capa Caddy guiada.
