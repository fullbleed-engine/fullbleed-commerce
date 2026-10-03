# Build from the repository root; no WordPress or Shopify code is served here.
FROM node:24.21.0-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS dependencies
WORKDIR /renderer
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --omit=dev

FROM node:24.21.0-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS runtime
WORKDIR /renderer
ENV NODE_ENV=production PORT=9480 BIND_HOST=0.0.0.0
COPY --from=dependencies /renderer/node_modules ./node_modules
COPY package.json ./package.json
COPY src ./src
COPY pro/designs.js ./pro/designs.js
COPY automation/server.mjs automation/renderer.js ./automation/
COPY LICENSE ./LICENSE
COPY LICENSES ./LICENSES
USER node
EXPOSE 9480
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "--input-type=module", "-e", "const r=await fetch('http://127.0.0.1:9480/health',{signal:AbortSignal.timeout(3000)});if(!r.ok||!(await r.json()).ready)process.exit(1)"]
CMD ["node", "automation/server.mjs"]
