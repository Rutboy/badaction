[English](quick-start.md) | [Русский](ru/quick-start.md) | [Español](es/quick-start.md)

# Quick Start: a guided server installation

This is the easiest production path for someone who is new to self-hosting. The
installer asks for a domain and an email address, generates all database
passwords and application secrets, installs Docker when needed, starts the
application, and configures automatic HTTPS through Caddy.

The result is a single-server installation. You still own the server, DNS,
backups, updates, and monitoring. The detailed [Deployment](deployment.md),
[Configuration](configuration.md), and [Operations](operations.md) guides remain
the source for custom or business-critical installations.

## What you need before starting

Prepare these items first:

- A fresh Linux server with a public IP address and `root` or `sudo` access. The
  installer can install Docker automatically on Debian and Ubuntu. On another
  Linux distribution, install Docker Engine with Compose v2 and Git first.
- A practical minimum of 2 GB RAM and 10 GB free disk space. A small server may
  need swap while building the images; database content, images, logs, and
  backups require additional space over time.
- A domain or subdomain you control, such as `retro.example.com`.
- An email address for automatic TLS certificate notices. It is stored in the
  private installation environment and sent to the certificate authority by
  Caddy.
- Inbound TCP ports `80` and `443` open in the hosting-provider firewall or
  security group. Keep SSH restricted to trusted administrator addresses when
  possible.
- A separate encrypted destination for database and secret backups. A Docker
  volume on the same server is persistence, not a backup.

The guided installer is intended for a fresh host. It does not remove an
existing web server, rewrite an existing manually managed `.env.production`, or
delete Docker volumes.

## 1. Point the domain to the server

Open the DNS panel at your domain registrar or DNS provider and create:

- an `A` record for the chosen name pointing to the server's public IPv4
  address;
- an `AAAA` record only if the server has working public IPv6 and its firewall
  is configured for it.

For the first installation, use ordinary DNS records without a CDN or proxy
mode. Remove stale `A` or `AAAA` records for the same name. DNS changes may take
time to propagate. From the server, this command should eventually show an
address you recognize:

```bash
getent ahosts retro.example.com
```

Replace `retro.example.com` in every example with your real name. Caddy can
obtain a public certificate only after the domain reaches this server and ports
`80` and `443` are reachable.

## 2. Download and run the installer

Connect to the server over SSH. Download the script first, rather than piping a
remote program directly into a privileged shell:

```bash
curl --fail --show-error --location \
  https://raw.githubusercontent.com/Rutboy/badaction/main/deploy/install.sh \
  --output /tmp/badaction-install.sh
sudo bash /tmp/badaction-install.sh
```

If `curl` is missing on a fresh Debian or Ubuntu host, install it first:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl
```

The script asks for:

1. the domain only, without `https://`, a port, a path, or a trailing slash;
2. the email address used for TLS certificate notices;
3. confirmation that the displayed DNS addresses route to this server;
4. permission to install Docker from Docker's official apt repository when a
   working Docker Engine and Compose v2 are not already present.

You do not need to invent or copy any passwords. The installer generates six
independent 256-bit values: three PostgreSQL passwords and three application
secrets. It never prints them.

To see the planned work without changing the server, use:

```bash
bash /tmp/badaction-install.sh \
  --dry-run \
  --domain retro.example.com \
  --email admin@example.com \
  --yes
```

Depending on the server and network, the first image build can take several
minutes. It is safe to rerun the installer after fixing a reported error. The
installer reuses its existing protected configuration and never deletes the
PostgreSQL or Caddy volumes.

## What the installer changes

By default, the downloaded installer:

1. clones the current `main` branch into `/opt/badaction` (or uses the checkout
   containing the script when run from a clone);
2. installs Git and the official Docker Engine packages when they are missing
   on Debian or Ubuntu;
3. writes `/opt/badaction/.env.production` with mode `600` and generated
   credentials, using distinct admin, migrator, and runtime database roles;
4. chooses free loopback ports for the direct application and PostgreSQL host
   mappings;
5. builds the migrator and non-root application images, initializes PostgreSQL
   16, and applies forward migrations;
6. starts Caddy on public TCP ports `80` and `443`; Caddy obtains and renews the
   HTTPS certificate and proxies requests to the private application service;
7. sets the trusted proxy boundary to the single bundled Caddy hop and disables
   upstream compression while streaming SSE events;
8. installs `/usr/local/bin/badaction` as a shortcut for safe everyday commands.

Only Caddy is published publicly. The application and PostgreSQL host ports
remain bound to `127.0.0.1`. Caddy's data volume preserves certificates and
private keys across container replacement.

## 3. Verify the result

Run the built-in basic checks:

```bash
sudo badaction doctor
```

It validates Compose configuration, shows container state, checks the private
loopback health endpoint, and checks the public HTTPS health endpoint. A healthy
response is `{"status":"ok"}`.

Then open `https://retro.example.com` in a browser and complete a disposable
functional check:

1. Confirm that the browser reports a valid HTTPS certificate.
2. Create a test board.
3. Open a participant invitation in a private/incognito browser window.
4. Add or change a card in one window and confirm the other updates without a
   manual reload.
5. Test an export, then delete the disposable board from the owner window.

Do not publish board URLs, invitation links, browser cookies, or screenshots
containing real team data.

## 4. Protect the installation

Before inviting a real team:

- Store an encrypted off-server copy of `.env.production`. Losing or changing
  its application secrets can invalidate existing browser access and
  invitations. Never put the file in Git, email, chat, or an issue.
- Create the first database backup:

  ```bash
  sudo badaction backup
  ```

  The command creates a private timestamped dump in `/opt/badaction/backups`,
  verifies that PostgreSQL can read its catalog, and prints its path. Copy it to
  encrypted storage outside this server. A local dump is still lost when the
  server is lost.

- Arrange scheduled off-server backups, retention, free-disk monitoring, and
  regular restore drills. Follow [Backups and restore](operations.md#backups)
  before treating the instance as production data storage.
- Monitor `https://retro.example.com/api/health`, container restarts, free disk,
  PostgreSQL capacity, and failed retention cleanup events. A green health
  endpoint alone does not prove that realtime delivery or backups work.
- Keep the host OS and Docker Engine security updates current. Do not expose
  the Docker socket or add untrusted users to the `docker` group; Docker control
  is effectively root access.

Docker-published ports can interact unexpectedly with host firewall tools such
as UFW. Confirm reachability and restrictions at the hosting-provider firewall,
and read Docker's [firewall warning](https://docs.docker.com/engine/install/ubuntu/#firewall-limitations)
when the host has custom rules.

## Everyday commands

Run these from any directory:

| Task                              | Command                     |
| --------------------------------- | --------------------------- |
| Full basic check                  | `sudo badaction doctor`     |
| Container status                  | `sudo badaction status`     |
| Last application and proxy logs   | `sudo badaction logs`       |
| Logs for one service              | `sudo badaction logs caddy` |
| Create a verified database dump   | `sudo badaction backup`     |
| Gracefully stop all containers    | `sudo badaction stop`       |
| Build changes and start the stack | `sudo badaction start`      |
| Restart the application and proxy | `sudo badaction restart`    |

Logs may still contain operational metadata. Sanitize them before sharing and
never publish credentials, cookies, invitation fragments, owner-claim URLs, or
board content.

## Updates

There are no release branches yet; security fixes target the current `main`
branch. Do not enable an unattended `git pull`. Before each update, read the
changes and migrations, create and move a verified backup off-server, and plan
a maintenance window as described in [Updates and forward migrations](operations.md#updates-and-forward-migrations).

For the default `/opt/badaction` installation, the basic update sequence after
that review is:

```bash
cd /opt/badaction
sudo badaction backup
sudo git pull --ff-only
sudo bash deploy/install.sh --yes
sudo badaction doctor
```

The installer reuses the existing environment and secrets. It refuses to
silently change the domain or TLS email. Database migrations are forward-only;
the detailed operations guide explains backup, compatibility, and rollback
limits.

## If installation does not finish

The script stops at the first failed safety check and does not delete data.
Common fixes are:

- **The domain does not resolve:** correct the DNS `A`/`AAAA` records, wait, and
  rerun the same command.
- **Port 80 or 443 is in use:** stop or reconfigure the existing Nginx, Apache,
  Caddy, or control-panel proxy. The guided Caddy service must own both TCP
  ports.
- **Docker is installed but unavailable:** run `sudo systemctl status docker`.
  The installer will not replace a broken or conflicting container setup.
- **Public HTTPS is not ready:** run `sudo badaction logs caddy`, verify DNS and
  provider firewall rules, wait a minute, then run `sudo badaction doctor`.
- **A container is unhealthy:** run `sudo badaction status` and
  `sudo badaction logs postgres migrate app caddy`.
- **An existing `badaction-production` volume or project is reported:** stop and
  find the environment and backups that belong to that installation. The
  installer deliberately refuses to attach newly generated credentials to
  possibly valuable existing data. Do not delete the volume just to continue.
- **The build runs out of memory or disk:** add swap or resize the server, free
  safe unused space, and rerun. Do not delete unknown Docker volumes.

For less common cases, see [Troubleshooting](troubleshooting.md). For a custom
proxy, an existing PostgreSQL server, multiple replicas, external image
registry, or a manually managed secret store, use the advanced
[Deployment guide](deployment.md) instead of the guided Caddy layer.
