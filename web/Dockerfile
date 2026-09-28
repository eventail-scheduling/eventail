FROM node:26-alpine AS build
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
# Node 25+ images no longer bundle corepack.
RUN npm install -g corepack && corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml /app/
WORKDIR /app
RUN --mount=type=cache,id=pnpm,target=/pnpm/store CI=true pnpm install --frozen-lockfile
COPY index.html tsconfig.json vite.config.ts /app/
COPY src /app/src
RUN pnpm build

FROM nginxinc/nginx-unprivileged:alpine
COPY ./nginx.conf /etc/nginx/conf.d/default.conf
COPY ./public/runtime-env.js.tpl /usr/share/nginx/html/runtime-env.js.tpl
COPY --chmod=755 ./docker-runtime-env.sh /docker-entrypoint.d/eventail-runtime-env.sh
COPY --from=build /app/dist /usr/share/nginx/html
