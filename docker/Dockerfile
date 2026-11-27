# syntax=docker/dockerfile:1
#
# AI Watch Web: the Angular app served by Nginx, which also proxies the three read routes of the
# AI Watch server. Build from the repository root:
#   docker build -f docker/Dockerfile -t ai-watch-web:local .
#
# Base images are pinned by digest. `security/refresh_base.py` updates them.
ARG NODE_IMAGE=node:26.13.1-alpine@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5
ARG NGINX_IMAGE=nginxinc/nginx-unprivileged:1.30.6-alpine@sha256:f5116ed4606f3eb015dd4a8e28cb9b351476dc0ad4bc6e9f93b19cec130cdf03

# The build output is plain files and the same on every architecture, so it always runs on the
# machine that builds. This keeps the arm64 image from needing an emulated npm build.
FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS build
WORKDIR /app
ENV NG_CLI_ANALYTICS=false
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY angular.json tsconfig.json tsconfig.app.json ./
COPY public ./public
COPY src ./src
RUN npm run build

FROM ${NGINX_IMAGE}
ARG VERSION=dev
ARG REVISION=unknown
LABEL org.opencontainers.image.title="AI Watch Web" \
      org.opencontainers.image.description="Dashboard for the AI Watch server, served by Nginx" \
      org.opencontainers.image.source="https://github.com/athegreat90/ai-watch-web" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}"

USER root
# The default site and its template step write to /etc/nginx at start, which a read-only root
# cannot allow. Our own entrypoint writes only to /tmp.
RUN rm -rf /etc/nginx/conf.d /docker-entrypoint.d /docker-entrypoint.sh /usr/share/nginx/html/*

# Less code, fewer vulnerabilities. This site never loads the dynamic modules the base image ships
# (geoip, image filter, njs, xslt), and apk removes the libraries only they needed (libxml2, libxslt,
# libgd, expat, fontconfig ...). curl and envsubst are not used either (the health check is wget).
# `apk upgrade` then takes the security fixes Alpine published after the base image was built. That
# makes the build depend on the Alpine mirror of the day, which is the price of not shipping known
# fixable CVEs. The daily scan (security/) is what keeps this honest.
RUN apk del --no-cache nginx-module-geoip nginx-module-image-filter nginx-module-njs nginx-module-xslt \
      curl gettext-envsubst \
 && apk upgrade --no-cache \
 && ! ls /usr/lib/nginx/modules/*.so >/dev/null 2>&1
COPY docker/nginx/nginx.conf /etc/nginx/nginx.conf
COPY docker/nginx/site.conf /etc/nginx/site.conf
COPY docker/nginx/snippets/ /etc/nginx/snippets/
COPY docker/entrypoint.sh /usr/local/bin/aiw-entrypoint
COPY --from=build /app/dist/ai-watch-web/browser /usr/share/nginx/html
RUN chmod 0755 /usr/local/bin/aiw-entrypoint

USER 101
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
ENTRYPOINT ["/usr/local/bin/aiw-entrypoint"]
