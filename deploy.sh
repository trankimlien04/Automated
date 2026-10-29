#!/bin/bash
# ========================================================
# SMART LIBRARY 4.0 - PRODUCTION DEPLOYMENT SCRIPT (DOCKER)
# ========================================================

set -e

# Colors for terminal output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================================${NC}"
echo -e "${BLUE}   🚀 SMART LIBRARY 4.0 - DOCKER DEPLOYMENT AUTOMATION  ${NC}"
echo -e "${BLUE}========================================================${NC}"

# 1. Check Docker & Docker Compose
if ! command -v docker &> /dev/null; then
    echo -e "${RED}[ERROR] Docker is not installed. Please install Docker first.${NC}"
    exit 1
fi

if ! docker compose version &> /dev/null; then
    echo -e "${RED}[ERROR] Docker Compose V2 is not available.${NC}"
    exit 1
fi

if ! docker info &> /dev/null; then
    echo -e "${RED}[ERROR] Docker Daemon is not running! Please start Docker Desktop or the docker service first.${NC}"
    exit 1
fi

# 2. Check or create .env file
if [ ! -f .env ]; then
    echo -e "${YELLOW}[NOTICE] .env not found. Copying from .env.example...${NC}"
    cp .env.example .env
    echo -e "${GREEN}[OK] Created .env file. Please review and update secrets if needed.${NC}"
fi

# 3. Pull latest code if git repo
if [ -d .git ]; then
    echo -e "${BLUE}[STEP 1/4] Pulling latest git changes...${NC}"
    git pull || echo -e "${YELLOW}[WARN] Could not pull from git, continuing with local files...${NC}"
fi

# 4. Building and deploying Docker containers
echo -e "${BLUE}[STEP 2/4] Building Docker containers (Client, Server, MySQL)...${NC}"
docker compose build --parallel

echo -e "${BLUE}[STEP 3/4] Starting services with Docker Compose...${NC}"
docker compose down --remove-orphans || true
docker compose up -d

# 5. Verify service health
echo -e "${BLUE}[STEP 4/4] Verifying health status of services...${NC}"
echo "Waiting for services to become healthy (up to 40 seconds)..."

sleep 10
docker compose ps

echo -e "${GREEN}========================================================${NC}"
echo -e "${GREEN}  🎉 SMART LIBRARY 4.0 DEPLOYED SUCCESSFULLY!            ${NC}"
echo -e "${GREEN}========================================================${NC}"
echo -e "Frontend Web App : http://localhost:${APP_PORT:-8088}"
echo -e "Backend API      : http://localhost:${BACKEND_PORT:-5001}/api (hoac reverse proxy qua /api)"
echo -e "Database         : MySQL on port ${DB_EXTERNAL_PORT:-3308}"
echo -e ""
echo -e "Check live logs with: ${YELLOW}docker compose logs -f${NC}"
echo -e "Stop services with  : ${YELLOW}docker compose down${NC}"
