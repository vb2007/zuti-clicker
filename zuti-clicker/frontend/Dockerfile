FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .

ARG VITE_API_BASE_URL=https://zuticlicker-api.vb2007.hu
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

# Off by default - see src/utils/featureFlags.ts. Baked in at build time like
# VITE_API_BASE_URL above; there is no runtime env for this static-nginx image,
# so flipping it means rebuilding, not editing an .env.
ARG VITE_ENABLE_QUICK_RESET=false
ENV VITE_ENABLE_QUICK_RESET=$VITE_ENABLE_QUICK_RESET

RUN pnpm build

FROM nginx:stable-alpine
# curl is more portable than BusyBox wget for healthchecks
RUN apk add --no-cache curl
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -fsS http://localhost/ > /dev/null || exit 1
