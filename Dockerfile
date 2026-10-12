# Digest-pinned official Bookworm images, resolved on 2026-10-04.
FROM node:24.19.0-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df AS node-build
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
COPY tests ./tests
RUN npm run build && npm prune --omit=dev --ignore-scripts
# Copy only Node's two non-glibc shared libraries into the Python runtime.
# Both source images use Debian Bookworm; no mutable apt transaction is needed.
RUN mkdir /node-libraries \
    && cp -L /usr/lib/*-linux-gnu/libstdc++.so.6 /node-libraries/ \
    && cp -L /lib/*-linux-gnu/libgcc_s.so.1 /node-libraries/

FROM python:3.12.13-slim-bookworm@sha256:4766d8b510c428e595d74b9cc5bbb2fae8e26316fffb4adc89908d79aacd58a2 AS python-build
COPY analytics/requirements.lock /tmp/requirements.lock
RUN python -m venv /opt/venv \
    && /opt/venv/bin/python -m pip install --no-cache-dir --only-binary=:all: -r /tmp/requirements.lock \
    && /opt/venv/bin/python -m pip check

FROM python:3.12.13-slim-bookworm@sha256:4766d8b510c428e595d74b9cc5bbb2fae8e26316fffb4adc89908d79aacd58a2 AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    ECHOCLASS_DATA_DIR=/app/data \
    ECHOCLASS_SEED_DEMO=0 \
    ECHOCLASS_SCIENTIFIC_ENABLED=0 \
    ECHOCLASS_GROUNDED_AI_ENABLED=0 \
    ECHOCLASS_PYTHON=/opt/venv/bin/python \
    PYTHONDONTWRITEBYTECODE=1 \
    OPENBLAS_NUM_THREADS=1 \
    OMP_NUM_THREADS=1 \
    MKL_NUM_THREADS=1 \
    NUMEXPR_NUM_THREADS=1
COPY --from=node-build /usr/local/bin/node /usr/local/bin/node
COPY --from=node-build /node-libraries/ /usr/local/lib/
COPY --from=node-build /usr/local/LICENSE /usr/local/share/licenses/node/LICENSE
COPY --from=node-build /usr/share/doc/libstdc++6/copyright /usr/local/share/licenses/node/libstdc++-copyright
COPY --from=node-build /usr/share/doc/libgcc-s1/copyright /usr/local/share/licenses/node/libgcc-copyright
COPY --from=python-build /opt/venv /opt/venv
RUN ldconfig \
    && test "$(node --version)" = "v24.19.0" \
    && test "$(/opt/venv/bin/python --version)" = "Python 3.12.13" \
    && groupadd --gid 1000 echoclass \
    && useradd --uid 1000 --gid 1000 --no-create-home --shell /usr/sbin/nologin echoclass
WORKDIR /app
COPY --from=node-build /build/dist/src ./dist/src
COPY --from=node-build /build/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY analytics/echoclass_analytics ./analytics/echoclass_analytics
COPY analytics/experiments ./analytics/experiments
COPY analytics/requirements.lock ./analytics/requirements.lock
COPY public ./public
COPY resources ./resources
COPY tests/fixtures/scientific/synthetic-envelope.json ./tests/fixtures/scientific/synthetic-envelope.json
COPY scripts/start-production.mjs scripts/scientific-demo.mjs scripts/project-trace.mjs scripts/method-study.mjs scripts/followup-design.mjs scripts/container-health.mjs scripts/container-verify.mjs ./scripts/
RUN mkdir -p /app/data /app/uploads \
    && chown 1000:1000 /app/data /app/uploads \
    && chmod 700 /app/data /app/uploads
USER 1000:1000
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=45s --retries=3 CMD ["node", "scripts/container-health.mjs"]
# Scientific execution requires an init parent: Compose supplies init:true;
# direct docker run must use --init. No worker socket is published.
CMD ["node", "scripts/start-production.mjs"]
