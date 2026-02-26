FROM node:20-alpine AS builder
WORKDIR /app
RUN apk add --no-cache sqlite
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache sqlite
COPY package*.json ./
RUN npm ci --only=production
COPY --from=builder /app/dist ./dist
RUN mkdir -p /data && chown -R node:node /data /app
USER node
ENV NODE_ENV=production
# По умолчанию userbot. Для обычного бота: CMD ["node", "dist/bot.js"]
CMD ["node", "dist/index.js"]
