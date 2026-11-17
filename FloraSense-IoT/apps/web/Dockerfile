FROM node:22-alpine

WORKDIR /app

# Copiar manifiestos del monorepo
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json

RUN npm install --workspace=apps/web --no-audit --no-fund && \
    npm cache clean --force && \
    rm -rf /root/.npm /tmp/*

# Copiar código fuente del frontend
COPY apps/web ./apps/web

WORKDIR /app/apps/web

EXPOSE 3000

CMD ["npm", "run", "dev", "--", "-H", "0.0.0.0"]
