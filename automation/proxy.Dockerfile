# Caddy 2.11.7 fixes the HTTP/2 regression in the current official 2.11.6 image.
# Replace only its executable with the checksum-verified upstream release.
FROM caddy:2.11.6-alpine@sha256:c776e0c6413b544d0459665e54ec7b8b2a15000c0cbee8b254da0067b1d184ff
ARG TARGETARCH
RUN case "$TARGETARCH" in \
      amd64) checksum=727b91701a392de6ebc5027509f548bf39979e5216340d0faed8fa5e69c84f8b ;; \
      arm64) checksum=d8fc6d179a5d283028a472a5618564f6ad8a86fed513e64f032b3b0b7cc45e42 ;; \
      *) echo 'Supported renderer proxy architectures: amd64 and arm64' >&2; exit 1 ;; \
    esac \
    && wget -q -O /tmp/caddy.tar.gz "https://github.com/caddyserver/caddy/releases/download/v2.11.7/caddy_2.11.7_linux_${TARGETARCH}.tar.gz" \
    && echo "$checksum  /tmp/caddy.tar.gz" | sha256sum -c - \
    && tar -xzf /tmp/caddy.tar.gz -C /usr/bin caddy \
    && rm /tmp/caddy.tar.gz \
    && caddy version
ENV CADDY_VERSION=v2.11.7
LABEL org.opencontainers.image.version=v2.11.7
