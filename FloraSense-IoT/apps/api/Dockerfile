FROM node:22-alpine

RUN apk add --no-cache openssl

WORKDIR /app

# Copiar manifiestos del monorepo para aprovechar cache de capas
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json

RUN npm install

# Copiar código fuente de la API y esquema Prisma
COPY apps/api ./apps/api

# Normalizar saltos de línea del entrypoint (seguridad en Windows)
RUN tr -d '\r' < /app/apps/api/docker-entrypoint.sh > /usr/local/bin/api-entrypoint.sh && \
    chmod +x /usr/local/bin/api-entrypoint.sh

WORKDIR /app/apps/api

# Generar Prisma Client (usando la versión local 6.x de apps/api)
RUN ./node_modules/.bin/prisma generate

EXPOSE 3001

ENTRYPOINT ["/usr/local/bin/api-entrypoint.sh"]
CMD ["npm", "run", "start:dev"]
