# Stage 1: Build
FROM node:22-alpine AS builder

WORKDIR /usr/src/app

# Copiar archivos de dependencias
COPY package*.json ./
COPY prisma ./prisma

# Instalar todas las dependencias (incluyendo dev)
RUN npm ci

# Copiar código fuente
COPY . .

# Generar cliente de Prisma
RUN npx prisma generate

# Compilar aplicación
RUN npm run build

# Stage 2: Production
FROM node:22-alpine AS production

WORKDIR /usr/src/app

# Copiar archivos necesarios desde builder
COPY --from=builder /usr/src/app/package*.json ./
COPY --from=builder /usr/src/app/prisma ./prisma
COPY --from=builder /usr/src/app/dist ./dist
COPY --from=builder /usr/src/app/node_modules ./node_modules

# Exponer puerto (Railway usa variable PORT)
EXPOSE ${PORT:-4000}

# Iniciar aplicación en producción
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]