# Server image. The web bundle is optional: set SERVE_WEB_DIST=true and copy
# web/dist in to have the same process serve the SPA.
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev || npm install --omit=dev

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY shared ./shared
COPY server ./server
EXPOSE 4000
USER node
# Migrate on boot so a fresh container is usable without a second command.
CMD ["sh", "-c", "npm run migrate --workspace server && node server/src/index.js"]
