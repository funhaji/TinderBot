#!/bin/bash
# Complete Deployment Script - Run this on your server
# This will fix the button immediately and prepare for full feature deployment

set -e

echo "================================"
echo "TinderBot Feature Deployment"
echo "================================"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration - EDIT THESE
DB_USER="your_user"
DB_NAME="your_database"
BOT_DIR="/opt/TinderBot"

echo "Step 1: Stopping bot..."
sudo systemctl stop tinderbot
echo -e "${GREEN}✓ Bot stopped${NC}"
echo ""

echo "Step 2: Updating explorer button in database..."
psql -U $DB_USER -d $DB_NAME <<EOF
UPDATE bot_config 
SET document = jsonb_set(
  jsonb_set(
    document,
    '{explorer_main,rows,0,1,fa}',
    '"لایک + دایرکت 💌"'
  ),
  '{explorer_main,rows,0,1,en}',
  '"Like + Direct Message 💌"'
),
updated_at = now()
WHERE id = 1;

SELECT 
  '✓ Button Updated Successfully' as status,
  document->'explorer_main'->'rows'->0->1->>'fa' as persian_text,
  document->'explorer_main'->'rows'->0->1->>'en' as english_text
FROM bot_config 
WHERE id = 1;
EOF
echo -e "${GREEN}✓ Button updated to دایرکت${NC}"
echo ""

echo "Step 3: Ensuring migrations folder exists..."
mkdir -p $BOT_DIR/dist/db/migrations
cp -r $BOT_DIR/src/db/migrations/*.sql $BOT_DIR/dist/db/migrations/ 2>/dev/null || true
echo -e "${GREEN}✓ Migrations copied${NC}"
echo ""

echo "Step 4: Verifying new translations..."
if grep -q "دایرکت" $BOT_DIR/dist/i18n/index.js; then
    echo -e "${GREEN}✓ New translations found in build${NC}"
else
    echo -e "${YELLOW}⚠ Translations may need rebuild${NC}"
fi
echo ""

echo "Step 5: Starting bot..."
sudo systemctl start tinderbot
sleep 2
echo -e "${GREEN}✓ Bot started${NC}"
echo ""

echo "Step 6: Checking bot status..."
sudo systemctl status tinderbot --no-pager | head -n 5
echo ""

echo "Step 7: Watching logs (Ctrl+C to exit)..."
echo -e "${YELLOW}Look for: Bot started successfully${NC}"
echo ""
sudo journalctl -u tinderbot -f

# This script will:
# 1. Stop the bot
# 2. Update the button text in database
# 3. Ensure migrations are in place
# 4. Start the bot
# 5. Show status and logs
