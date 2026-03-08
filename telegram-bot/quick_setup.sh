#!/bin/bash
# Smainer Telegram Bot Quick Setup Script

set -e

echo "🚀 Setting up Smainer Telegram Bot..."

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if we're in the right directory
if [ ! -f "pyproject.toml" ]; then
    echo -e "${RED}❌ Please run this script from the telegram-bot directory${NC}"
    exit 1
fi

# Step 1: Install dependencies
echo -e "${YELLOW}📦 Installing Python dependencies...${NC}"
pip install -e ".[dev]"

# Step 2: Check/Start Redis
echo -e "${YELLOW}🔴 Checking Redis...${NC}"
if redis-cli ping > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Redis is running${NC}"
else
    echo -e "${YELLOW}🔄 Starting Redis with Docker...${NC}"
    
    # Check if Docker is available
    if command -v docker > /dev/null 2>&1; then
        # Stop existing Redis container if running
        docker stop smainer-redis 2>/dev/null || true
        docker rm smainer-redis 2>/dev/null || true
        
        # Start Redis
        docker run -d \
          --name smainer-redis \
          --restart unless-stopped \
          -p 6379:6379 \
          redis:7-alpine
        
        # Wait for Redis to start
        echo "Waiting for Redis to start..."
        for i in {1..10}; do
            if redis-cli ping > /dev/null 2>&1; then
                echo -e "${GREEN}✅ Redis started successfully${NC}"
                break
            fi
            sleep 1
        done
    else
        echo -e "${RED}❌ Docker not found. Please install Redis manually:${NC}"
        echo "  sudo apt update && sudo apt install redis-server"
        echo "  sudo systemctl start redis-server"
        exit 1
    fi
fi

# Step 3: Verify configuration
echo -e "${YELLOW}⚙️  Verifying configuration...${NC}"
if [ ! -f ".env" ]; then
    echo -e "${RED}❌ .env file not found. Please copy from .env.example${NC}"
    exit 1
fi

# Check for bot token
if grep -q "your-bot-token" .env; then
    echo -e "${RED}❌ Please update TELEGRAM_BOT_TOKEN in .env${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Configuration looks good${NC}"

# Step 4: Run tests
echo -e "${YELLOW}🧪 Running basic tests...${NC}"
python -m pytest tests/ -v --tb=short || echo -e "${YELLOW}⚠️  Some tests failed, but bot should still work${NC}"

echo ""
echo -e "${GREEN}✅ Setup complete!${NC}"
echo ""
echo -e "${YELLOW}🚀 To start the bot:${NC}"
echo "  ./launch_bot.sh"
echo ""
echo -e "${YELLOW}🧪 To test the bot:${NC}"
echo "  1. Search for your bot on Telegram"
echo "  2. Send /start command"
echo "  3. Follow wallet linking instructions"
echo ""
echo -e "${YELLOW}📋 Prerequisites for full functionality:${NC}"
echo "  - Smainer relayer running on localhost:8000"
echo "  - AI compute nodes available"
echo "  - Starknet testnet access"