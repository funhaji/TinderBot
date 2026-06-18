#!/bin/bash
# Automatic deployment script with git conflict handling
# Run this to update your bot from GitHub

set -e  # Exit on error

echo "🚀 Starting automated deployment..."
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Step 1: Try to pull
echo "📥 Pulling latest changes from GitHub..."
if git pull; then
    echo -e "${GREEN}✅ Pull successful!${NC}"
else
    echo -e "${YELLOW}⚠️  Pull failed - likely due to local changes${NC}"
    echo ""
    echo "🔧 Resetting local changes and trying again..."
    
    # Reset any local changes
    git reset --hard
    
    echo "📥 Pulling again after reset..."
    if git pull; then
        echo -e "${GREEN}✅ Pull successful after reset!${NC}"
    else
        echo -e "${RED}❌ Pull failed even after reset${NC}"
        echo "Please check your git configuration or network connection"
        exit 1
    fi
fi

echo ""

# Step 2: Build
echo "🔨 Building project..."
if npm run build; then
    echo -e "${GREEN}✅ Build successful!${NC}"
else
    echo -e "${RED}❌ Build failed${NC}"
    echo "Check the error messages above"
    exit 1
fi

echo ""

# Step 3: Copy migrations
echo "📦 Copying SQL migrations..."
mkdir -p dist/db/migrations
cp src/db/migrations/*.sql dist/db/migrations/
echo -e "${GREEN}✅ Migrations copied${NC}"

echo ""

# Step 4: Restart service
echo "🔄 Restarting bot service..."
if sudo systemctl restart tinderbot; then
    echo -e "${GREEN}✅ Service restarted!${NC}"
else
    echo -e "${RED}❌ Service restart failed${NC}"
    echo "You may need to check service status manually"
    exit 1
fi

echo ""

# Step 5: Wait a moment for service to start
echo "⏳ Waiting for service to start..."
sleep 3

# Step 6: Check service status
echo "📊 Checking service status..."
if sudo systemctl is-active --quiet tinderbot; then
    echo -e "${GREEN}✅ Bot is running!${NC}"
else
    echo -e "${RED}⚠️  Bot may not be running properly${NC}"
    echo "Checking logs..."
    sudo journalctl -u tinderbot -n 20 --no-pager
    exit 1
fi

echo ""

# Step 7: Show recent logs
echo "📝 Recent logs:"
echo "─────────────────────────────────────────"
sudo journalctl -u tinderbot -n 15 --no-pager
echo "─────────────────────────────────────────"

echo ""
echo -e "${GREEN}✅ Deployment complete!${NC}"
echo ""
echo "🎯 What was deployed:"
echo "   • Latest code from GitHub"
echo "   • Fresh build"
echo "   • SQL migrations"
echo "   • Bot restarted"
echo ""
echo "📊 To monitor live logs:"
echo "   sudo journalctl -u tinderbot -f"
echo ""
echo "🧪 To test features:"
echo "   Send /admin to the bot and check Page 2"
echo ""
echo "✨ Done!"
