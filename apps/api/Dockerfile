FROM node:22-slim AS base
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY prisma ./prisma
COPY prisma.config.ts tsconfig.json ./
COPY src ./src

RUN npx prisma generate

ENV NODE_ENV=production
EXPOSE 4010

CMD ["sh", "-c", "npx prisma migrate deploy && npm start"]
