FROM node:22-alpine

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

# Limpiar devDependencies para reducir tamaño
RUN npm prune --production

# Exponer puerto (Railway usa variable PORT)
EXPOSE ${PORT:-4000}

# Iniciar aplicación en producción
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]