# Tencent Lighthouse: isolated read-only showcase

Application source: `eba19f1443d85bc20b7a9dd12c13ba80bdd7db22`
(`3.0.0-beta.25`). These files do not record completed public-site acceptance.

Target: Ubuntu 24.04 (`noble`), Linux `amd64`, 2 vCPU, 2 GB memory and 40 GB disk.
The operator observed Docker **29.9.1** and Compose plugin **5.6.0** after setup
on 19 October 2026. These are host details, not application-image or traffic
acceptance. The container supplies Node 24/Python 3.12.13 independently of old PM2.

## Independent deployment boundary

| Listener / resource | Use |
| --- | --- |
| Existing `80`, `3000`, `3001` | Preserve existing sites and processes |
| New public HTTP `8080` | Nginx exact read-only route boundary |
| New `127.0.0.1:3002` | Container upstream; do not open in the cloud firewall |
| Container `3000` | Internal application port, distinct from host port 3000 |
| Compose project `echoclass-showcase` | Separate container, network and fresh named volumes |

Keep one application instance on a local filesystem. Do not reuse old classroom
volumes, bind mounts, databases or accounts, and do not run an acceptance seeder.

## Files

- `preflight.sh` is **read-only**: OS, architecture, resources, known TCP ports
  and program versions. It neither uses sudo nor contacts Docker's daemon, dumps
  configuration, reads credentials or inspects process command lines.
- `install-docker-ubuntu24.sh` is **mutating host setup**, for an approved fresh
  Docker installation on Ubuntu 24.04/amd64. It uses the official apt repository,
  refuses conflicting runtime packages or duplicate Docker apt sources, and
  does not remove packages or overwrite different existing Docker keys/sources.
  Existing Docker is checked against the local Unix socket without upgrading it.
  The script requests needrestart's list mode, cleans its own temporary files,
  and does not add users to the Docker group. Its markers concern Docker only.
  Apt versions are not pinned: record what was installed and do not use this
  script as an upgrade procedure.
- `nginx-http.conf.example` is an HTTP **review template**, not an install script.
  Only its new `8080` listener is configured. Replace the `.invalid` hostname
  in both `server_name` and the Host check before using it.

Docker setup follows the [official Ubuntu apt instructions](https://docs.docker.com/engine/install/ubuntu/).

## Exact public routes

| GET / HEAD route | Behavior |
| --- | --- |
| `/` | Project overview and inline synthetic figures |
| `/engineering` | Engineering reading and browser-only design illustration |
| `/walkthrough` | Synthetic evidence trail |
| `/static/project.css` | Shared stylesheet |
| `/static/followup-design.js` | Interaction script, without imports or fetches |
| `/classroom`, `/demo` | Fixed English/Chinese scope notices from Nginx |

Other paths, including `/api/health`, return 404 **through the public proxy**.
Non-GET/HEAD methods return 405; unknown hosts are rejected. There is no broad
API/static proxy or file alias. The internal container health check still
accesses its own application endpoint directly. Allowed upstream HEAD requests
are fetched as GET because the current page router handles GET only; the client
receives normal HEAD body suppression. Query strings/cookies retain the original
English-first reading and `?lang=zh` switching.

The allowlist was checked against `project-page.ts`, `walkthrough-page.ts`,
`page-routes.ts`, `static-files.ts`, `project.css` and `followup-design.js` at the
revision above. Figures are inline SVG; CSS has no external asset URLs/imports;
the design script has no network requests/module imports. Recheck after changes.

The two classroom notices are HTTP 200 responses, not redirects or functioning
classrooms. They explicitly say that accounts, writes and uploads are not
enabled, and link to the reviewed public source and English/Chinese project
entry points. They always contain both languages, have no forms/scripts and
never reach Node, the database or a provider. No key is needed for this showcase.

## Build and start this project only

From the reviewed source checkout's root in its own deployment directory:

```bash
git rev-parse HEAD
bash deploy/tencent-showcase/preflight.sh

ECHOCLASS_SHOWCASE_ROOT="$PWD"
showcase_compose() {
  sudo -n env ECHOCLASS_HOST_PORT=3002 ECHOCLASS_SCIENTIFIC_ENABLED=0 \
    docker --host unix:///var/run/docker.sock compose \
    --project-name echoclass-showcase \
    --project-directory "$ECHOCLASS_SHOWCASE_ROOT" \
    --file "$ECHOCLASS_SHOWCASE_ROOT/docker-compose.yml" "$@"
}

showcase_compose config --quiet
showcase_compose build --pull
showcase_compose up --detach --wait --wait-timeout 90
curl --fail --silent --show-error http://127.0.0.1:3002/api/health
```

Supply the environment **after sudo on every invocation**: sudo may otherwise
lose exported variables and fall back to the original host port 3000. Inspect
the resolved configuration and verify the sole host binding is `127.0.0.1:3002`.
Do not add another Compose `ports` entry casually: list merging can retain an
unwanted binding. The source Compose fixes `ECHOCLASS_SEED_DEMO=0` and
`ECHOCLASS_GROUNDED_AI_ENABLED=0`; this wrapper also disables the scientific
worker. No provider key or `.env` is needed. Never run the test seeder here.

Named volumes persist on normal restarts. Avoid `down --volumes` and global
Docker prune commands. Image tags are daemon-wide: the source's `echoclass:local`
tag needs a separate override before cohosting another EchoClass Docker project.
On a shared 2 GB host, build sequentially and monitor available memory/disk;
no concurrent-build capacity or public-traffic limit has been established.

## Configure the new entrance and verify

1. Check that `8080` and `3002` are free. Review existing Nginx includes/defaults;
   integrate the rejecting default only on `8080`, with no duplicate default for
   that port. Preserve old `80`/`3000`/`3001`. Replace both example Host values
   with the actual domain/IP, retaining the new `8080` Host-port check.
2. Run the server's real `nginx -t` before reload. The template assumes Nginx is
   the direct public edge and overwrites XFF with `$remote_addr`. CDN/load-balancer
   use needs a separate trusted-IP review. Configure bounded log retention.
3. Review cloud/host firewalls for public `8080`; never publish `3002` or worker
   ports. Docker-published ports can interact with host firewall rules: establish
   the actual loopback binding rather than relying on a firewall assumption.
4. Externally check `http://ACTUAL_HOST:8080/`, all three pages in English/Chinese,
   both assets, both classroom notices and their links, HEAD responses, POST
   rejection, blocked APIs/unknown paths and unknown Host. Confirm notices have
   no account controls/upstream calls. Recheck every old site/listener afterward.
5. HTTPS is **not configured by this HTTP template**. Review the real domain,
   DNS and existing `443` setup before adding TLS and renewal. Retain the same
   path/method/Host restrictions; HTTP-only acceptance is not HTTPS acceptance.

The [container contract](../../docs/scientific-deployment.md) governs image,
state, worker and acceptance. This display mode does not prove worker readiness
or offer stored reports. Historical key rotation and old-data migration remain
separate unverified tasks.

中文：独立 Docker 项目使用新公网入口 `8080` 和本机上游 `127.0.0.1:3002`，
保留旧 `80`、`3000`、`3001`。范围限于三个阅读页面、两个必要资源和两个双语
课堂说明页。Docker 安装、应用构建、公网访问和 HTTPS 应分别据实验收。
