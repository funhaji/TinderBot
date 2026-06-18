#!/bin/bash
# Quick deployment script for new features
# Run this on your server: bash DEPLOY_FEATURES.sh

set -e  # Exit on error

echo "🚀 Deploying new features..."
echo ""

# Stop the bot
echo "⏸️  Stopping bot..."
sudo systemctl stop tinderbot

# Backup current dist (just in case)
echo "💾 Creating backup..."
if [ -d "dist" ]; then
    cp -r dist dist.backup.$(date +%Y%m%d_%H%M%S)
fi

# Clean and rebuild
echo "🔨 Building..."
rm -rf dist
npm run build

# Copy SQL migrations
echo "📦 Copying migrations..."
mkdir -p dist/db/migrations
cp src/db/migrations/*.sql dist/db/migrations/

# Start the bot
echo "▶️  Starting bot..."
sudo systemctl start tinderbot

echo ""
echo "⏳ Waiting for bot to start..."
sleep 3

# Check status
echo ""
echo "📊 Bot status:"
sudo systemctl status tinderbot --no-pager | head -10

echo ""
echo "📝 Recent logs:"
sudo journalctl -u tinderbot -n 20 --no-pager

echo ""
echo "✅ Deployment complete!"
echo ""
echo "🎯 New features available:"
echo "   1. Username sharing in mystery chats"
echo "   2. Inactive user reminders (runs daily at 10 AM)"
echo "   3. Button editor in admin panel (Page 2)"
echo "   4. Improved like notifications"
echo ""
echo "🔧 Admin panel: Send /admin to test button editor"
echo "📖 Full documentation: See FEATURES_IMPLEMENTED.md"
