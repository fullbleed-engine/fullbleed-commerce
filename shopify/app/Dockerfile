# Build from the repository root:
# docker build -f shopify/app/Dockerfile -t fullbleed-commerce .
FROM node:24.21.0-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /commerce

FROM base AS build
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --omit=dev
COPY shopify/app/package.json shopify/app/package-lock.json ./shopify/app/
RUN cd shopify/app && npm ci --ignore-scripts
COPY src ./src
COPY pro ./pro
COPY shopify ./shopify
WORKDIR /commerce/shopify/app
RUN mkdir -p public/fonts && cp /commerce/node_modules/fullbleed/assets/fonts/* public/fonts/
RUN npx --no-install prisma generate && npm run build \
    && npm prune --omit=dev --ignore-scripts

FROM base AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends gosu tini \
    && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production PORT=3000 DATABASE_URL=file:/data/commerce.sqlite
COPY --from=build /commerce/node_modules ./node_modules
COPY --from=build /commerce/package.json ./package.json
COPY --from=build /commerce/shopify/app/node_modules ./shopify/app/node_modules
COPY --from=build /commerce/shopify/app/build ./shopify/app/build
COPY --from=build /commerce/shopify/app/prisma ./shopify/app/prisma
COPY --from=build /commerce/shopify/app/scripts ./shopify/app/scripts
COPY --from=build /commerce/shopify/privacy.js ./shopify/privacy.js
COPY --from=build /commerce/shopify/app/package.json ./shopify/app/package.json
COPY LICENSE ./LICENSE
COPY LICENSES ./LICENSES
COPY shopify/app/LICENSE.md ./shopify/app/LICENSE.md
COPY --chmod=755 shopify/app/scripts/container-start.sh /usr/local/bin/fullbleed-commerce
RUN mkdir /data && chown node:node /data && chmod 700 /data
WORKDIR /commerce/shopify/app
USER node
EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "-g", "--", "/usr/local/bin/fullbleed-commerce"]
CMD ["serve"]
