# Stage 1: Builder
FROM node:20-bookworm AS builder

WORKDIR /app

# Install dependencies (including dev dependencies for building)
COPY package*.json ./
RUN npm ci

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Prune dev dependencies so we only copy production deps
RUN npm prune --production

# Stage 2: Production
FROM node:20-bookworm-slim

# Install Puppeteer dependencies
# Note: "bookworm" tag ensures compatibility with the builder stage libraries
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Set Puppeteer to use system Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV NODE_ENV=production

WORKDIR /app

# Copy built artifacts and dependencies from builder
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/public ./public
COPY --from=builder /app/dist ./dist

# Create data directory
RUN mkdir -p /app/data

EXPOSE 3000

CMD ["node", "dist/index.js"]
