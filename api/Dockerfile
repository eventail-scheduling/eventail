FROM node:26-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
# Node 25+ images no longer bundle corepack.
RUN npm install -g corepack && corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY api/package.json api/
COPY web/package.json web/

FROM base AS prod-deps
RUN --mount=type=cache,id=pnpm,target=/pnpm/store CI=true pnpm install --frozen-lockfile
# A --prod install at the workspace root would carry every package's
# dependencies, and pnpm's node_modules are symlinks into the root store, so
# copying them out does not yield a working tree.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store CI=true pnpm deploy --filter api --prod /out

FROM base AS build
RUN --mount=type=cache,id=pnpm,target=/pnpm/store CI=true pnpm install --frozen-lockfile
COPY api/tsconfig.json api/tsconfig.build.json api/
COPY api/src api/src
RUN pnpm --filter api run build

FROM node:26-alpine
WORKDIR /app
COPY --from=prod-deps /out/node_modules /app/node_modules
COPY --from=build /app/api/dist /app
COPY api/package.json /app/package.json
COPY api/email-templates /app/email-templates
ENV NODE_ENV="production"
USER 1000:1000

ENTRYPOINT [ "node", "--enable-source-maps", "--import=./register-crash-logger.js" ]
CMD [ "./index.js" ]
