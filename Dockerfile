# ---------- Build Stage ----------
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all deps (including dev for TypeScript build)
RUN npm install

# Copy source code
COPY . .

# Build TypeScript -> dist/
RUN npm run build


# ---------- Production Stage ----------
FROM node:20-alpine

WORKDIR /app

# Copy only necessary files from builder
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# Remove dev dependencies (keep it lean)
RUN npm prune --production

# Expose port (change if needed)
EXPOSE 2000

# Start app
CMD ["node", "dist/index.js"]