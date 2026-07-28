# Sanaei Telegram Bot & Admin Panel

A comprehensive solution to automate X-UI (Sanaei) VPN account distribution via Telegram Bot, featuring an integrated React web dashboard, dynamic X-UI connecting, and multiple admin options.

## Features
- Fully automated Telegram Bot for purchasing and test account creation
- Integrated X-UI (Sanaei panel) client manager via APIs
- User referral and reward system
- Backup and restore directly from Telegram bot (`db.json` file)
- Modern, professional UI web dashboard

## 📤 نحوه آپلود و بروزرسانی پروژه در گیت‌هاب (Push to GitHub)

برای اینکه بتوانید دستور نصب تک‌خطی زیر را روی سرور خود اجرا کنید، ابتدا باید آخرین کد ادیت شده‌ی ربات خود را در گیت‌هاب آپلود (Push) کنید. مراحل زیر را در کامپیوتر شخصی خود انجام دهید:

1. **دانلود فایل پروژه:** از منوی تنظیمات (چرخ‌دنده بالا سمت راست در این محیط ویرایشگر) گزینه **"Export as ZIP"** را بزنید تا کل فایل‌های پروژه به صورت فشرده دانلود شوند.
2. **استخراج فایل:** فایل ZIP دانلود شده را در یک پوشه فرستاده و استخراج (unzip) کنید.
3. **باز کردن ترمینال (یا گیت‌بش):** ترمینال سورس را در پوشه استخراج شده باز کنید و دستورات زیر را ترتیب وارد کنید:
   ```bash
   # مقداردهی اولیه ریپازیتوری
   git init

   # اد کردن لینک ریپازیتوری خودتان
   git remote add origin https://github.com/meh732/botsel.git

   # اضافه کردن تمام فایل‌ها به استیج گیت
   git add .

   # ثبت کامیت تغییرات با نام دلخواه
   git commit -m "Update robot and web admin control features"

   # ارسال کدها به برنچ اصلی گیت‌هاب
   git branch -M main
   git push -u origin main --force
   ```
*(نکته: در صورتی که پسورد گیت‌هاب خواست، باید از رمز عبور توکن توسعه‌دهنده یا GitHub Personal Access Token استفاده کنید).*

## 🚀 Installation on VPS (Linux Ubuntu/Debian)

Use the automated one-line setup command on your fresh Linux VPS to download from your botsel repository:
```bash
sudo bash <(curl -fsSL https://raw.githubusercontent.com/meh732/botsel/main/install.sh)
```

*(If you haven't uploaded this to GitHub yet, clone the repo manually, then run `sudo bash install.sh` inside the folder).*

## 🌐 Installation on Shared Linux Hosting (cPanel/DirectAdmin)

If you strictly want to host this on cPanel (Shared Hosting):

1. Login to cPanel and open **"Setup Node.js App"**.
2. Click **"Create Application"**.
3. Set **Node.js version** to `20.x` or latest.
4. Set **Application mode** to `Production`.
5. Specify the Application root (e.g., `sanaei-bot`) and URL.
6. **Upload your code:** Archive all files (except `node_modules` and `.git`), upload to the `sanaei-bot` folder via File Manager, and extract.
7. Note: Shared hosting environments often prevent apps from binding to arbitrary ports using Express, they use Passenger to proxy. Open `server.ts` or `dist/server.cjs` and ensure your app binds to the provided `process.env.PORT` instead of hardcoding `3000`. So make sure you run `npm run build` on your PC first, or run it through cPanel Terminal! 
8. Open cPanel Terminal, go to the folder and run `npm install` and then `npm run build`.
9. Go back to "Setup Node.js App" and set **Application startup file** to `dist/server.cjs` (you may need to create a simple `app.js` that `require('./dist/server.cjs')` if Passenger complains). 
10. Click **Start App**.

*Note: VPS is generally recommended for background bots like node-telegram-bot-api polling.*

## Admin Access
Once started, the first user to `/start` the Telegram bot will become the **Admin**. They can use `/admin` inside Telegram to get backups and configure panel settings. Web panel is accessible at Server IP port 3000.
