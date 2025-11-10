FROM node:22-alpine AS builder

WORKDIR /usr/src/app

# Copiar archivos de dependencias
COPY package*.json ./
COPY prisma ./prisma

# Instalar dependencias
RUN npm ci

# Copiar código fuente
COPY . .

# Generar cliente de Prisma
RUN npx prisma generate

# Compilar aplicación
RUN npm run build

# Imagen de producción
FROM node:22-alpine

WORKDIR /usr/src/app

# Copiar archivos necesarios
COPY package*.json ./
COPY prisma ./prisma

# Instalar solo dependencias de producción
RUN npm ci --only=production

# Copiar build y prisma generado
COPY --from=builder /usr/src/app/dist ./dist
COPY --from=builder /usr/src/app/node_modules/.prisma ./node_modules/.prisma

# Exponer puerto (Railway usa variable PORT)
EXPOSE ${PORT:-4000}

# Iniciar aplicación en producción
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]