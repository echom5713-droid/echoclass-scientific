# Running the scientific container

The container packages the Node application and its supervised Python calculation worker. It is a single-host, local-filesystem deployment: SQLite, the append-only report inputs and the worker lock live together. It does not add a distributed queue, a hosted inference service or a production-readiness claim.

**Existing deployment upgrade:** the previous Compose file mounted host `./data` and `./uploads` directories. This version uses named volumes. Running the new configuration does not import the old host directories and can therefore appear to start with an empty database. Before upgrading an existing installation, preserve its backups, review its schema and choose an explicit restore or a reviewed bind-mount override with correct UID 1000 permissions. The fresh-start commands below are not an existing-data migration procedure.

## Build and run

Use Docker Engine with Compose v2 on Linux. The dedicated CI job tests Linux `amd64`; other CPU architectures are not covered by that acceptance result.

```bash
docker compose build --pull
ECHOCLASS_SCIENTIFIC_ENABLED=1 docker compose up --detach --wait
```

Open `http://127.0.0.1:3000`. The default host binding is loopback, so these commands do not publish the application to the internet. The image and Compose configuration leave scientific execution disabled unless explicitly enabled. No demo accounts, provider credentials or classroom observations are installed. A fresh deployment therefore has no teacher account; the container check below provisions disposable synthetic accounts only for acceptance testing.

The offline case needs no account or API key:

```bash
docker compose run --rm --no-deps echoclass node scripts/scientific-demo.mjs --text
docker compose run --rm --no-deps echoclass node scripts/scientific-demo.mjs --json
docker compose run --rm --no-deps echoclass node scripts/method-study.mjs --text
```

These commands run the already compiled image; `npm` and TypeScript are deliberately absent from the runtime. Build with `npm ci` in the build stage, then prune development dependencies. `scientific-demo.mjs` sends the committed synthetic fixture through Python, parses strict JSON and validates the result through the Node contract before printing it.

`method-study.mjs` runs all 60 declared synthetic trials, including the Node/Python input bridge and strict output checks. Its five hashed study source files are included. The numerical study needs no Matplotlib; figure rendering remains a separate source-checkout step.

Compose supplies `init: true`. If running the image directly, use `docker run --init` when enabling scientific execution. The worker checks its supervisor and rejects Node as PID 1; the init parent also forwards shutdown signals and reaps orphaned processes. Only port 3000 is exposed. Python binds to a random loopback port and receives a generated process-local token from its supervisor.

## What is fixed, and what is measured

| Component           | Container policy                                                                                                                         |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Node                | Official `24.19.0-bookworm-slim` image, index digest `sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df`           |
| Python              | Official `3.12.13-slim-bookworm` image, index digest `sha256:4766d8b510c428e595d74b9cc5bbb2fae8e26316fffb4adc89908d79aacd58a2`           |
| JavaScript packages | `package-lock.json`, `npm ci --ignore-scripts`, production dependencies only in the runtime                                              |
| Scientific packages | All 31 direct and transitive versions in `analytics/requirements.lock`; binary wheels only; `pip check` at build time                    |
| Runtime identity    | Actual Python version, scientific package versions, numerical-library configuration, architecture and host kernel recorded by the worker |
| CPU concurrency     | Numerical-library thread counts fixed at 1                                                                                               |

The base-image digests were resolved from Docker's registry on 2026-10-04. Node's binary and its Bookworm `libstdc++` / `libgcc_s` libraries are copied into the Python Bookworm runtime; this avoids an unpinned operating-system package installation. Build-time execution checks both interpreter versions. No operating-system compiler, npm installation or TypeScript compiler is added to the final stage.

This is a version-locked build recipe, not a claim of bit-identical image rebuilding. The Python lock currently pins versions without wheel-content hashes. Base images stay fixed until deliberately updated, so security fixes need a reviewed digest update and a rerun of acceptance. A container shares its host kernel, which contributes to EchoClass's environment fingerprint. A report from a different host may therefore require numerical comparison rather than exact reproduction; never remove the environment check to obtain a green label.

## Writable state and privileges

The runtime is UID/GID `1000:1000`. Application code, Python sources and the retrieval corpus remain owned by root. Compose mounts the root filesystem read-only, drops all Linux capabilities, disables privilege escalation and supplies a small `/tmp` tmpfs. Named volumes provide `/app/data` and `/app/uploads`. New volumes inherit the image directory ownership; an existing volume with different ownership must be assessed before use.

Keep the data mount at `/app/data`: the existing practice-answer repository also uses that fixed path. The public retrieval corpus is `resources/knowledge/echoclass-guide.md`, outside both writable volumes, so a fresh data volume cannot hide it. The Docker build context uses an allowlist and the final image copies runtime paths explicitly; local `.env` files, Git history, databases, evidence uploads and backups are not part of the image.

These permissions support a single trusted local filesystem. Network shares, multiple application replicas sharing one database, externally supplied volumes and the old schema-v7 database upgrade are not covered by the container acceptance run. Preserve backups and use the existing restoration/upgrade review before introducing historical classroom state. Do not use the synthetic seeder against real data.

## Acceptance checks

The [Scientific container workflow](../.github/workflows/scientific-container.yml) builds the actual image on each pull request and uses a uniquely named, disposable Compose project. It then:

1. Creates a fresh volume, generates an ephemeral password and session, and adds 20 explicitly synthetic records with synthetic review events. The seeder requires `ECHOCLASS_CONTAINER_TEST=1` and refuses a nonempty data directory.
2. Starts the normal production entrypoint with the supervised worker enabled.
3. Verifies UID/GID 1000, read-only root, the writable data mount, corpus placement, exact interpreter/package versions and the absence of development dependencies, Git history and environment files.
4. Creates a scientific run over real HTTP, waits for its sealed result, checks the tested tie and unmeasured candidate, and requests exact reproduction.
5. Retrieves a cited bootstrap explanation from the packaged corpus, runs the offline CLI's strict validation and executes the complete 60-trial method study from the image.
6. Restarts the application, replays the same request and checks that the original run and result survive, then reproduces them again.
7. Prints bounded logs and the built image identity, and removes only that CI project's synthetic volumes.

The Docker health check establishes HTTP liveness and SQLite mode. It does **not** establish worker readiness; the completed scientific run is a separate acceptance requirement. A passing local source check is likewise not a passing container build. Read the workflow result for the exact submitted commit before treating packaging as verified.

For an isolated local acceptance run, choose a new project name and execute the same steps:

```bash
export COMPOSE_PROJECT_NAME=echoclass-container-review
export ECHOCLASS_SCIENTIFIC_ENABLED=1
docker compose build --pull
docker compose run --rm --no-deps -e ECHOCLASS_CONTAINER_TEST=1 echoclass node scripts/container-verify.mjs seed
docker compose up --detach --wait --wait-timeout 90
docker compose exec -T -e ECHOCLASS_CONTAINER_TEST=1 echoclass node scripts/container-verify.mjs verify
docker compose exec -T echoclass node scripts/method-study.mjs --text
docker compose restart
docker compose up --detach --wait --wait-timeout 90
docker compose exec -T -e ECHOCLASS_CONTAINER_TEST=1 echoclass node scripts/container-verify.mjs replay
```

Use `docker compose down --volumes` only after confirming this project contains disposable test state. Normal classroom shutdown should retain its volumes. Container acceptance establishes the packaged synthetic path and persistence behavior; it does not validate an experimental conclusion, authorize release of data/assets, or replace an independent security and statistical review.

The implementation follows Docker's guidance on [multi-stage builds and digest pinning](https://docs.docker.com/build/building/best-practices/) and [Compose service isolation](https://docs.docker.com/reference/compose-file/services/).
