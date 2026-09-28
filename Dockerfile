# syntax=docker/dockerfile:1.7
#
# Capital OS as one image running `next start` (docs/deploy/rev2/image-and-cutover.md).
#
# Build it ONLY with scripts/image-build.sh, which pipes `git archive <commit>` in as the build
# context: exactly the tracked files of one commit, so untracked files, data/, plcos-data and local
# build output cannot enter it. .dockerignore is a second fence for a plain `docker build .`, and the
# `source` stage refuses such a context anyway.
#
# Guards, each of which fails the build:
#   - source:  no .git, nothing under data/ except data/README.md, no plcos-data or data/real path;
#   - build:   `npm run build` ends with scripts/check-build-traces.ts, which refuses any traced
#              file under data/real or plcos-data (and an empty or malformed inventory);
#   - runtime: a last sweep of /app for any data/real or plcos-data path.
# No secrets are passed at build time or baked in; they arrive as env at run time.

ARG NODE_VERSION=26

FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1 \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    npm_config_update_notifier=false \
    npm_config_fund=false \
    npm_config_audit=false
WORKDIR /app

# ---- source: the archived commit, checked before anything runs against it --------------------
FROM base AS source
ARG GIT_COMMIT=""
COPY . .
RUN set -eu; \
    [ -n "$GIT_COMMIT" ] || { echo "Refused: build with scripts/image-build.sh (GIT_COMMIT unset)." >&2; exit 1; }; \
    [ ! -e .git ] || { echo "Refused: the context has .git; it must be a git archive." >&2; exit 1; }; \
    extra="$(find data -mindepth 1 ! -path data/README.md -print -quit 2>/dev/null || true)"; \
    [ -z "$extra" ] || { echo "Refused: the context has files under data/ beyond data/README.md." >&2; exit 1; }; \
    bad="$(find . \( -ipath '*plcos-data*' -o -ipath '*/data/real' -o -ipath '*/data/real/*' \) -print -quit)"; \
    [ -z "$bad" ] || { echo "Refused: a data/real or plcos-data path is in the context." >&2; exit 1; }; \
    printf '%s\n' "$GIT_COMMIT" > .image-commit

# ---- build: next build, then the tracing guard (npm run build = next build && build:traces; the ---
# ---- explicit second run names the directory, so a changed default output cannot skip it) -------
FROM base AS build
COPY --from=source /app/package.json /app/package-lock.json ./
RUN npm ci
COPY --from=source /app ./
ENV DATA_PROFILE=demo NODE_ENV=production
RUN npm run build \
 && node --import tsx scripts/check-build-traces.ts .next \
 && rm -rf .next/cache

# ---- prod-deps: runtime dependencies only, plus tsx at its locked version -----------------------
# The server starts TypeScript import workers through tsx (a devDependency; next.config.ts lists it
# as a server external), so it is installed on its own at exactly the version package-lock.json pins.
FROM base AS prod-deps
COPY --from=source /app/package.json /app/package-lock.json ./
RUN npm ci --omit=dev \
 && TSX_VERSION="$(node -p "require('./package-lock.json').packages['node_modules/tsx'].version")" \
 && npm install --no-save --no-package-lock --omit=dev "tsx@${TSX_VERSION}" \
 && npm cache clean --force

# ---- runtime -------------------------------------------------------------------------------------
FROM base AS runtime
# PGDG supplies the matching major; Debian bookworm's default client is older.
ADD https://www.postgresql.org/media/keys/ACCC4CF8.asc /usr/share/keyrings/postgresql.asc
RUN chmod 644 /usr/share/keyrings/postgresql.asc \
 && apt-get update && apt-get install -y --no-install-recommends ca-certificates gnupg awscli \
 && echo 'deb [signed-by=/usr/share/keyrings/postgresql.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main' > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update && apt-get install -y --no-install-recommends postgresql-client-17 \
 && rm -rf /var/lib/apt/lists/*
ARG GIT_COMMIT=""
LABEL org.opencontainers.image.title="capital-os" \
      org.opencontainers.image.revision="${GIT_COMMIT}"
# The RDS CA bundle, so connections to PL's database verify its certificate (node and libpq).
ADD https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /etc/ssl/certs/rds-global-bundle.pem
RUN chmod 644 /etc/ssl/certs/rds-global-bundle.pem
ENV NODE_ENV=production PORT=8080 GIT_COMMIT=${GIT_COMMIT} \
    NODE_EXTRA_CA_CERTS=/etc/ssl/certs/rds-global-bundle.pem PGSSLROOTCERT=/etc/ssl/certs/rds-global-bundle.pem

# A fixed non-root uid, so the persistent volume's permissions can be set by number.
RUN groupadd --system --gid 10001 plcos \
 && useradd --system --uid 10001 --gid plcos --home-dir /app --shell /usr/sbin/nologin plcos

# Source, build and dependencies are owned by root and read-only to the app user. Only the data root
# (config.data.root, where the persistent volume mounts) and Next's cache are writable.
COPY --from=source /app ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
RUN set -eu; \
    mkdir -p data .next/cache; \
    chown plcos:plcos data .next/cache; \
    bad="$(find /app \( -ipath '*plcos-data*' -o -ipath '*/data/real' -o -ipath '*/data/real/*' \) -print -quit)"; \
    [ -z "$bad" ] || { echo "Refused: a data/real or plcos-data path is in the image." >&2; exit 1; }

USER 10001:10001
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.status===200?0:1),()=>process.exit(1))"]
CMD ["sh", "-c", "exec node node_modules/next/dist/bin/next start --hostname 0.0.0.0 --port \"${PORT:-8080}\""]
