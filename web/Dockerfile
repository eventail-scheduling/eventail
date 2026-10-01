FROM node:26-alpine AS build
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
# Node 25+ images no longer bundle corepack.
RUN npm install -g corepack && corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY api/package.json api/
COPY web/package.json web/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store CI=true pnpm install --frozen-lockfile
COPY web/index.html web/tsconfig.json web/vite.config.ts web/
COPY web/src web/src
RUN pnpm --filter web run build

FROM nginxinc/nginx-unprivileged:alpine
COPY ./web/nginx.conf /etc/nginx/conf.d/default.conf
COPY ./web/public/runtime-env.js.tpl /usr/share/nginx/html/runtime-env.js.tpl
COPY --chmod=755 ./web/docker-runtime-env.sh /docker-entrypoint.d/eventail-runtime-env.sh
COPY --from=build /app/web/dist /usr/share/nginx/html
