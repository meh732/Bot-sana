import "dotenv/config";
import express from "express";
import path from "path";
import cors from "cors";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";
import { createServer as createViteServer } from "vite";
import { db } from "./server/db.js";
import { initBot, sendBroadcast, checkPaygReactivation, sendDirectMessage } from "./server/bot.js";
import { xui } from "./server/xui.js";
import { encryptData, decryptData } from "./server/crypto.js";

// Helpers to parse inbound IDs dynamically (supports string tags like "d1" or numbers like 1)
function parseInboundId(val: any): string | number | undefined {
  if (val === undefined || val === null || val === '') return undefined;
  const num = Number(val);
  return isNaN(num) ? String(val).trim() : num;
}

function parseInboundIds(vals: any): (string | number)[] {
  if (!Array.isArray(vals)) return [];
  return vals
    .map(val => {
      if (val === undefined || val === null || val === '') return null;
      const num = Number(val);
      return isNaN(num) ? String(val).trim() : num;
    })
    .filter((val): val is string | number => val !== null && val !== '');
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(cors());
  app.use(express.json());

  // Optional Basic Auth for the Panel
  if (process.env.PANEL_USERNAME && process.env.PANEL_PASSWORD) {
    app.use((req, res, next) => {
      const b64auth = (req.headers.authorization || '').split(' ')[1] || '';
      const [login, password] = Buffer.from(b64auth, 'base64').toString().split(':');

      if (login === process.env.PANEL_USERNAME && password === process.env.PANEL_PASSWORD) {
        return next();
      }

      res.set('WWW-Authenticate', 'Basic realm="Admin Panel"');
      res.status(401).send('Authentication required.');
    });
  }

  // Init Telegram Bot
  initBot();

  // ----- Admin API ----- //
  const api = express.Router();

  api.get("/state", (req, res) => {
    const state = db.getState();
    // Hide password in UI
    const safeState = {
      ...state,
      panel: {
        ...state.panel,
        password: state.panel.password ? '********' : ''
      }
    };
    res.json(safeState);
  });

  api.post("/update-settings", (req, res) => {
    const { 
      botToken, 
      freeTestVolumeGb, 
      freeTestDurationDays, 
      freeTestEnabled, 
      freeTestInboundId, 
      freeTestInboundIds,
      referralRewardToman, 
      adminIds, 
      cardNumber, 
      cardHolder, 
      supportUsername, 
      coupons,
      autoBackupIntervalHours,
      autoBackupPassword,
      forceJoinEnabled,
      forceJoinChannels
    } = req.body;
    
    const updates: any = { 
      botToken, 
      freeTestVolumeGb: Number(freeTestVolumeGb) || 0, 
      freeTestDurationDays: Number(freeTestDurationDays) || 0,
      freeTestEnabled: freeTestEnabled !== undefined ? Boolean(freeTestEnabled) : true,
      referralRewardToman: Number(referralRewardToman) || 0 
    };

    if (cardNumber !== undefined) updates.cardNumber = cardNumber;
    if (cardHolder !== undefined) updates.cardHolder = cardHolder;
    if (supportUsername !== undefined) updates.supportUsername = supportUsername;
    if (coupons !== undefined) updates.coupons = coupons;
    if (autoBackupIntervalHours !== undefined) updates.autoBackupIntervalHours = Number(autoBackupIntervalHours);
    if (autoBackupPassword !== undefined) updates.autoBackupPassword = autoBackupPassword;
    if (forceJoinEnabled !== undefined) updates.forceJoinEnabled = Boolean(forceJoinEnabled);
    if (forceJoinChannels !== undefined) updates.forceJoinChannels = forceJoinChannels;
    if (freeTestInboundId !== undefined) {
      updates.freeTestInboundId = parseInboundId(freeTestInboundId);
    }
    if (freeTestInboundIds !== undefined) {
      updates.freeTestInboundIds = parseInboundIds(freeTestInboundIds);
    }

    if (adminIds !== undefined) {
      updates.adminIds = Array.isArray(adminIds)
        ? adminIds.map((id: any) => parseInt(id)).filter((id: number) => !isNaN(id))
        : [];
    }

    db.updateState(updates);
    
    // Start or restart bot if token is present
    if (botToken) {
      console.log('[Bot] Triggering initBot from settings update endpoint.');
      initBot();
    }
    res.json({ success: true });
  });

  api.post("/update-panel", async (req, res) => {
    const { url, username, password, inboundId, inboundIds, apiKey, subUrlBase } = req.body;
    const currentState = db.getState();
    
    const newPanel = { ...currentState.panel };
    if (url !== undefined) newPanel.url = url;
    if (username !== undefined) newPanel.username = username;
    if (password && password !== '********') newPanel.password = password;
    if (inboundId !== undefined) newPanel.inboundId = parseInboundId(inboundId);
    if (inboundIds !== undefined) {
      newPanel.inboundIds = parseInboundIds(inboundIds);
    }
    if (apiKey !== undefined) newPanel.apiKey = apiKey;
    if (subUrlBase !== undefined) newPanel.subUrlBase = subUrlBase;

    db.updateState({ panel: newPanel });
    res.json({ success: true });
  });

  api.post("/broadcast", async (req, res) => {
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ success: false, message: 'متن پیام الزامی است.' });
    }
    try {
      const stats = await sendBroadcast(message);
      res.json({ success: true, ...stats });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message || 'خطا در ارسال پیام همگانی.' });
    }
  });

  api.get("/xui-inbounds", async (req, res) => {
    try {
      const inbounds = await xui.getInbounds();
      if (inbounds && inbounds.length > 0) {
        xui.selfHealProductsAndInbounds(inbounds);
      }
      res.json({ success: true, inbounds: inbounds || [] });
    } catch (e: any) {
      // Still good to have a backup catch although xui.getInbounds now suppresses most errors
      res.json({ success: false, message: e.message, inbounds: [] });
    }
  });

  api.post("/test-panel-connection", async (req, res) => {
    try {
      const { url, username, password, apiKey } = req.body;
      let result;
      
      if (url) {
        // Create a temporary state for testing
        const tempXui = new (xui.constructor as any)();
        // Manually patch state for this test if possible, or just update the DB temporarily
        // But cleaner is to pass the credentials to testConnection
        console.log(`[X-UI Test] Running test with provided credentials for url: ${url}`);
        
        // Let's modify xui.testConnection to take optional params
        result = await (xui as any).testConnection({ url, username, password, apiKey });
      } else {
        result = await xui.testConnection();
      }
      res.json(result);
    } catch (e: any) {
       res.json({ success: false, message: e.message });
    }
  });

  api.post("/backup", (req, res) => {
    try {
      const { password } = req.body;
      if (!password) {
        return res.status(400).json({ success: false, message: 'رمز عبور برای رمزگذاری فایل بکاپ الزامی است.' });
      }
      
      const dbPath = path.join(process.cwd(), 'db.json');
      if (!fs.existsSync(dbPath)) {
        return res.status(404).json({ success: false, message: 'فایل دیتابیس یافت نشد.' });
      }
      
      const rawData = fs.readFileSync(dbPath, 'utf8');
      const encryptedPayload = encryptData(rawData, password);
      
      res.json({ success: true, payload: encryptedPayload });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message || 'خطا در ایجاد بکاپ.' });
    }
  });

  api.post("/restore", (req, res) => {
    try {
      const { payload, password } = req.body;
      if (!payload || !password) {
        return res.status(400).json({ success: false, message: 'مقادیر بکاپ و رمز عبور الزامی می‌باشند.' });
      }
      
      const decryptedData = decryptData(payload, password);
      const parsed = JSON.parse(decryptedData);
      
      if (!parsed.users || !parsed.panel) {
        return res.status(400).json({ success: false, message: 'فایل پشتیبان معتبر نیست. بخش‌های حیاتی خالی هستند.' });
      }
      
      // Write to db.json and update memory state
      const dbPath = path.join(process.cwd(), 'db.json');
      fs.writeFileSync(dbPath, JSON.stringify(parsed, null, 2), 'utf8');
      db.updateState(parsed);
      
      // Re-initialize the Telegram bot
      initBot();
      
      res.json({ success: true, message: 'موفقیت‌آمیز: کل دیتابیس و تنظیمات با موفقیت بازیابی شد.' });
    } catch (e: any) {
      res.status(400).json({ success: false, message: e.message || 'خطا در رمزگشایی یا بازیابی دیتابیس.' });
    }
  });

  api.get("/backup/local-list", (req, res) => {
    try {
      const BACKUPS_DIR = path.join(process.cwd(), 'backups');
      if (!fs.existsSync(BACKUPS_DIR)) {
        fs.mkdirSync(BACKUPS_DIR, { recursive: true });
      }
      
      const files = fs.readdirSync(BACKUPS_DIR)
        .filter(f => f.startsWith('backup_') && f.endsWith('.json'))
        .map(f => {
          const filePath = path.join(BACKUPS_DIR, f);
          const stat = fs.statSync(filePath);
          return {
            filename: f,
            createdAt: stat.mtime.toISOString(),
            sizeBytes: stat.size,
            type: f.startsWith('backup_manual_') ? 'manual' : 'auto'
          };
        })
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)); // Newest first

      res.json({ success: true, files });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message || 'خطا در بازخوانی لیست نقاط بازیابی.' });
    }
  });

  api.post("/backup/create-local", (req, res) => {
    try {
      const filename = db.createManualBackup();
      res.json({ success: true, filename });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message || 'خطا در ایجاد نقطه بازیابی جدید.' });
    }
  });

  api.post("/backup/restore-local", (req, res) => {
    try {
      const { filename } = req.body;
      if (!filename) {
        return res.status(400).json({ success: false, message: 'نام فایل پشتیبان الزامی است.' });
      }

      const BACKUPS_DIR = path.join(process.cwd(), 'backups');
      const backupPath = path.join(BACKUPS_DIR, filename);

      // Simple security check (prevent directory traversal)
      if (!filename.startsWith('backup_') || !filename.endsWith('.json') || filename.includes('/') || filename.includes('..')) {
        return res.status(400).json({ success: false, message: 'نام فایل معتبر نیست.' });
      }

      if (!fs.existsSync(backupPath)) {
        return res.status(404).json({ success: false, message: 'فایل نقطه پشتیبان یافت نشد.' });
      }

      const rawData = fs.readFileSync(backupPath, 'utf8');
      const parsed = JSON.parse(rawData);

      if (!parsed.panel || !parsed.users) {
        return res.status(400).json({ success: false, message: 'ساختار فایل پشتیبان معتبر نیست.' });
      }

      // Overwrite db.json
      const dbPath = path.join(process.cwd(), 'db.json');
      fs.writeFileSync(dbPath, JSON.stringify(parsed, null, 2), 'utf8');
      
      // Update DB state
      db.updateState(parsed);

      // Re-initialize bot
      initBot();

      res.json({ success: true, message: 'موفقیت‌آمیز: کل دیتابیس با موفقیت به این نقطه بازیابی بازگردانده شد.' });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message || 'خطا در بازیابی اطلاعات با فایل نقطه‌ای.' });
    }
  });

  api.delete("/backup/delete-local/:filename", (req, res) => {
    try {
      const { filename } = req.params;
      if (!filename) {
        return res.status(400).json({ success: false, message: 'نام فایل الزامی است.' });
      }

      const BACKUPS_DIR = path.join(process.cwd(), 'backups');
      const backupPath = path.join(BACKUPS_DIR, filename);

      // Security check (prevent directory traversal)
      if (!filename.startsWith('backup_') || !filename.endsWith('.json') || filename.includes('/') || filename.includes('..')) {
        return res.status(400).json({ success: false, message: 'نام فایل معتبر نیست.' });
      }

      if (fs.existsSync(backupPath)) {
        fs.unlinkSync(backupPath);
        res.json({ success: true });
      } else {
        res.status(404).json({ success: false, message: 'فایل پیدا نشد.' });
      }
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message || 'خطا در حذف فایل پشتیبان.' });
    }
  });

  api.get("/backup/plain-download", (req, res) => {
    try {
      const dbPath = path.join(process.cwd(), 'db.json');
      if (!fs.existsSync(dbPath)) {
        return res.status(404).json({ success: false, message: 'فایل دیتابیس اصلی یافت نشد.' });
      }
      const rawData = fs.readFileSync(dbPath, 'utf8');
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename=sanaei_bot_plain_backup_${Date.now()}.json`);
      res.send(rawData);
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message || 'خطا در دانلود دیتابیس.' });
    }
  });

  api.post("/categories", (req, res) => {
    const category = req.body;
    if (!category.id) {
      category.id = uuidv4();
    }
    const state = db.getState();
    const existingIndex = (state.categories || []).findIndex(c => c.id === category.id);
    const newCategories = [...(state.categories || [])];
    if (existingIndex >= 0) {
      newCategories[existingIndex] = category;
    } else {
      newCategories.push(category);
    }
    db.updateState({ categories: newCategories });
    res.json({ success: true, categories: newCategories });
  });

  api.delete("/categories/:id", (req, res) => {
    const state = db.getState();
    const newCategories = (state.categories || []).filter(c => c.id !== req.params.id);
    db.updateState({ categories: newCategories });
    res.json({ success: true });
  });

  api.post("/products", (req, res) => {
    const product = req.body;
    if (!product.id) {
      product.id = uuidv4();
    }

    if (product.inboundId !== undefined) {
      product.inboundId = parseInboundId(product.inboundId);
    }

    if (product.limitIp !== undefined) {
      product.limitIp = parseInt(product.limitIp) || 0;
    }

    if (product.inboundIds !== undefined) {
      product.inboundIds = parseInboundIds(product.inboundIds);
    }

    const state = db.getState();
    const existingIndex = state.products.findIndex(p => p.id === product.id);
    const newProducts = [...state.products];
    if (existingIndex >= 0) {
      newProducts[existingIndex] = product;
    } else {
      newProducts.push(product);
    }
    db.updateState({ products: newProducts });
    res.json({ success: true, products: newProducts });
  });

  api.delete("/products/:id", (req, res) => {
    const state = db.getState();
    const newProducts = state.products.filter(p => p.id !== req.params.id);
    db.updateState({ products: newProducts });
    res.json({ success: true });
  });

  api.post("/users/:chatId/charge", (req, res) => {
    const { amount } = req.body;
    const user = db.getUser(parseInt(req.params.chatId));
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    const parsedAmount = parseInt(amount);
    user.balance += parsedAmount;
    db.saveUser(user);
    checkPaygReactivation(user).catch(console.error);

    // Notify user of charge
    const manualChargeMsg = `🎉 <b>حساب کاربری شما توسط مدیریت مبلغ ${parsedAmount.toLocaleString()} تومان شارژ شد!</b>\n\n` +
      `💰 موجودی جدید حساب شما: <b>${user.balance.toLocaleString()}</b> تومان\n\n` +
      `🛒 <b>هم‌اکنون با زدن دکمه زیر می‌توانید محصول یا سرویس مورد نظر خود را خریداری کنید:</b>`;
    sendDirectMessage(user.chatId, manualChargeMsg, {
      inline_keyboard: [
        [{ text: '🛍 خرید و ثبت سفارش', callback_data: 'buy_service_now' }]
      ]
    }).catch(console.error);

    res.json({ success: true, balance: user.balance });
  });

  api.post("/users/:chatId/role", (req, res) => {
    const { isSeller } = req.body;
    const user = db.getUser(parseInt(req.params.chatId));
    if (!user) return res.status(404).json({ success: false });
    user.isSeller = isSeller;
    if (isSeller) {
      if (user.debt === undefined) user.debt = 0;
      if (user.debtVolume === undefined) user.debtVolume = 0;
      if (user.debtLimit === undefined) user.debtLimit = 1000000; // Default 1M Toman Limit
      if (user.totalSales === undefined) user.totalSales = 0;
    }
    db.saveUser(user);
    res.json({ success: true });
  });

  api.post("/users/:chatId/reset-test", (req, res) => {
    const { testUsed } = req.body;
    const user = db.getUser(parseInt(req.params.chatId));
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    user.testUsed = !!testUsed;
    db.saveUser(user);
    res.json({ success: true, testUsed: user.testUsed });
  });

  api.post("/users/:chatId/seller-limits", (req, res) => {
    const { debtLimit, debtVolume, debt, sellerDiscount, sellerDiscounts } = req.body;
    const user = db.getUser(parseInt(req.params.chatId));
    if (!user) return res.status(404).json({ success: false, message: 'کاربر پیدا نشد' });
    
    if (debtLimit !== undefined) user.debtLimit = Number(debtLimit);
    if (debtVolume !== undefined) user.debtVolume = Number(debtVolume);
    if (debt !== undefined) user.debt = Number(debt);
    if (sellerDiscount !== undefined) user.sellerDiscount = Number(sellerDiscount);
    if (sellerDiscounts !== undefined) user.sellerDiscounts = sellerDiscounts;
    
    db.saveUser(user);
    res.json({ success: true, user });
  });

  api.post("/users/add-seller", (req, res) => {
    const { chatId, username, debtLimit } = req.body;
    if (!chatId) {
      return res.status(400).json({ success: false, message: 'شناسه عددی کاربری الزاماً باید فرستاده شود.' });
    }
    const numChatId = parseInt(chatId);
    if (isNaN(numChatId)) {
      return res.status(400).json({ success: false, message: 'شناسه عددی وارد شده معتبر نمی‌باشد.' });
    }

    let user = db.getUser(numChatId);
    if (!user) {
      user = {
        chatId: numChatId,
        username: username || '',
        balance: 0,
        testUsed: false,
        registeredAt: new Date().toISOString(),
        isSeller: true,
        debt: 0,
        debtVolume: 0,
        debtLimit: Number(debtLimit) || 1000000,
        totalSales: 0,
        purchases: []
      };
    } else {
      user.isSeller = true;
      if (user.debt === undefined) user.debt = 0;
      if (user.debtVolume === undefined) user.debtVolume = 0;
      if (debtLimit !== undefined) user.debtLimit = Number(debtLimit);
    }

    db.saveUser(user);
    res.json({ success: true, users: db.getState().users });
  });

  api.post("/users/:chatId/settle", (req, res) => {
    const user = db.getUser(parseInt(req.params.chatId));
    if (!user) return res.status(404).json({ success: false });
    user.debt = 0;
    user.debtVolume = 0; // Reset active package volume debt too
    db.saveUser(user);
    res.json({ success: true, debt: user.debt, debtVolume: user.debtVolume });
  });

  app.use("/api", api);

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
