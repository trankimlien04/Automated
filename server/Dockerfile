# ========================================================
# SMART LIBRARY BACKEND DOCKERFILE
# Node.js 20 on Alpine Linux with multi-stage / cached deps
# ========================================================

FROM node:20-alpine AS base

# Install build dependencies for native packages (bcrypt)
RUN apk add --no-cache python3 make g++ wget

WORKDIR /app

# Copy dependency definition
COPY package.json package-lock.json ./

# Install only production dependencies
RUN npm ci --omit=dev

# Copy application source code
COPY . .

# Expose backend API port
EXPOSE 5000

# Set environment
ENV NODE_ENV=production
ENV PORT=5000

# Docker Healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:5000/api/health || exit 1

# Start production server
CMD ["node", "index.js"]
