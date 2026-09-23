#!/bin/bash

# --- Persian Colors for Terminal Output ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0;3c' # No Color
CLEAR='\033[0m'

echo -e "${BLUE}===============================================${CLEAR}"
echo -e "${YELLOW}   🔄 سیستم راه‌اندازی مجدد و پاکسازی هوشمند ربات   ${CLEAR}"
echo -e "${BLUE}===============================================${CLEAR}"

# 1. Kill duplicate processes on port 3000
echo -e "${YELLOW}🔹 ۱. در حال بررسی و بستن پروسه‌های فعال روی پورت 3000...${CLEAR}"
PID_3000=$(lsof -t -i:3000)
if [ ! -z "$PID_3000" ]; then
    echo -e "${RED}⚠️ پروسه‌های فعال روی پورت 3000 یافت شد (PID: $PID_3000). در حال بستن فورس...${CLEAR}"
    kill -9 $PID_3000 2>/dev/null
    echo -e "${GREEN}✅ پورت 3000 کاملاً آزاد شد.${CLEAR}"
else
    echo -e "${GREEN}✅ هیچ پروسه‌ای روی پورت 3000 فعال نبود.${CLEAR}"
fi

# 2. Kill all background/stale Node/TSX process matching server/bot
echo -e "${YELLOW}🔹 ۲. در حال پاکسازی پروسه‌های مزاحم و تکراری Node/tsx...${CLEAR}"
pkill -9 -f "server.ts" 2>/dev/null
pkill -9 -f "dist/server.cjs" 2>/dev/null
pkill -9 -f "tsx" 2>/dev/null
echo -e "${GREEN}✅ تمامی پروسه‌های هم‌پوشان و قدیمی با موفقیت متوقف شدند.${CLEAR}"

# 3. Clean and build the project to ensure correct compilation
echo -e "${YELLOW}🔹 ۳. در حال کامپایل و بیلد مجدد پروژه جهت اعمال کدهای جدید...${CLEAR}"
npm run clean 2>/dev/null
npm run build

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ پروژه با موفقیت کامپایل و بیلد گردید.${CLEAR}"
else
    echo -e "${RED}❌ خطا در کامپایل پروژه. لطفاً خطاها را بررسی کنید.${CLEAR}"
    exit 1
fi

# 4. Start the application
echo -e "${BLUE}===============================================${CLEAR}"
echo -e "${YELLOW}🔹 ۴. راه‌اندازی مجدد سرور:${CLEAR}"
echo -e "${BLUE}===============================================${CLEAR}"

if command -v pm2 &> /dev/null
then
    echo -e "${YELLOW}ℹ️ سیستم PM2 شناسایی شد. در حال راه‌اندازی مجدد از طریق PM2...${CLEAR}"
    pm2 delete "sanaei-bot" 2>/dev/null
    pm2 start dist/server.cjs --name "sanaei-bot"
    pm2 save
    echo -e "${GREEN}✅ ربات با نام 'sanaei-bot' به صورت موفقیت‌آمیز در پس‌زمینه PM2 راه‌اندازی شد.${CLEAR}"
else
    echo -e "${YELLOW}⚠️ ابزار PM2 نصب نیست. ربات به صورت مستقیم در پس‌زمینه اجرا می‌شود...${CLEAR}"
    nohup npm start > bot_output.log 2>&1 &
    echo -e "${GREEN}✅ ربات با موفقیت در پس‌زمینه اجرا شد (لاگ‌ها در فایل bot_output.log ذخیره می‌شوند).${CLEAR}"
fi

echo -e "${GREEN}===============================================${CLEAR}"
echo -e "${GREEN}🎉 سیستم با موفقیت به روزرسانی و راه‌اندازی مجدد شد!${CLEAR}"
echo -e "${GREEN}===============================================${CLEAR}"
