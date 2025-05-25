# Use Node.js 20 runtime
FROM node:20-alpine AS builder

# Set working directory
WORKDIR /app

# Enable corepack for pnpm
RUN corepack enable

# Copy package files
COPY package.json tsconfig.json sst-env.d.ts ./

# Install all dependencies (including dev dependencies for building)
RUN pnpm install

# Copy source code
COPY entrypoint.ts ./

# Build TypeScript
RUN pnpm build

# Production stage
FROM node:20-alpine AS production

# Set working directory
WORKDIR /app

# Enable corepack for pnpm
RUN corepack enable

# Copy package files
COPY package.json ./

# Install only production dependencies
RUN pnpm install --prod

# Copy built JavaScript from builder stage
COPY --from=builder /app/dist ./dist

# Run the compiled JavaScript
CMD ["node", "dist/entrypoint.js"]

