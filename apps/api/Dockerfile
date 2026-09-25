# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy workspace root and package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api

# Install dependencies
RUN npm install -g pnpm
RUN pnpm install --frozen-lockfile

# Build - must be in root to access workspace properly
RUN cd apps/api && pnpm build

# Runtime stage
FROM node:20-alpine

WORKDIR /app

# Copy from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/api/dist/apps/api/src ./src
COPY --from=builder /app/apps/api/package.json ./

# Copy data files from root
COPY *.json ./

EXPOSE 3000

CMD ["node", "src/main.js"]
