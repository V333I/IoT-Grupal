#!/bin/sh
set -e

echo "[api] Generando cliente Prisma..."
./node_modules/.bin/prisma generate

echo "[api] Sincronizando esquema con PostgreSQL..."
./node_modules/.bin/prisma db push --skip-generate

echo "[api] Verificando usuario admin semilla..."
node --experimental-strip-types seed-admin.ts || echo "[api] Aviso: seed-admin finalizó con advertencia"

echo "[api] Iniciando servidor NestJS..."
exec "$@"
