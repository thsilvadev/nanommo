# Build stage
FROM node:20-bookworm AS builder

WORKDIR /app

# Copy workspace root and package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api

# Install dependencies
RUN npm install -g pnpm && pnpm install --frozen-lockfile

# Build - must be in root to access workspace properly
RUN cd apps/api && pnpm build

# Runtime stage
FROM node:20-bookworm

WORKDIR /app/apps/api

# Copy from builder
COPY --from=builder /app/node_modules /app/node_modules
COPY --from=builder /app/apps/api/node_modules ./node_modules
COPY --from=builder /app/packages/shared /app/packages/shared
COPY --from=builder /app/apps/api/dist/apps/api/src ./src
COPY --from=builder /app/apps/api/package.json ./

# Copy data files from root (DataService loads process.cwd()/../../ = /app)
COPY *.json /app/

EXPOSE 3000

CMD ["node", "src/main.js"]