FROM node:20-slim AS builder

WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
COPY prisma/ ./prisma/
RUN npm ci
RUN DATABASE_URL='postgresql://placeholder:placeholder@localhost:5432/placeholder' DIRECT_URL='postgresql://placeholder:placeholder@localhost:5432/placeholder' npx prisma generate
COPY src/ ./src/
COPY tsconfig.json ./
RUN npm run build

FROM node:20-slim AS runtime

WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
COPY prisma/ ./prisma/
RUN DATABASE_URL='postgresql://placeholder:placeholder@localhost:5432/placeholder' DIRECT_URL='postgresql://placeholder:placeholder@localhost:5432/placeholder' npm ci --omit=dev
RUN DATABASE_URL='postgresql://placeholder:placeholder@localhost:5432/placeholder' DIRECT_URL='postgresql://placeholder:placeholder@localhost:5432/placeholder' npx prisma generate
COPY --from=builder /app/dist ./dist

USER node
CMD ["node", "dist/bot.js"]
