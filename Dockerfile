FROM node:22-alpine AS build
RUN apk add --no-cache openssl

WORKDIR /app

COPY package.json package-lock.json* ./

RUN npm ci && npm cache clean --force

COPY . .

RUN npm run prisma -- generate && npm run build && npm prune --omit=dev

FROM node:22-alpine AS runtime
RUN apk add --no-cache openssl
WORKDIR /app
EXPOSE 3000
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/build ./build
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/app ./app
COPY --from=build --chown=node:node /app/scripts ./scripts
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/tsconfig.json ./
USER node

CMD ["npm", "run", "docker-start"]
