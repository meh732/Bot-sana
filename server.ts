import "dotenv/config";
import express from "express";
import path from "path";
import cors from "cors";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";
import { createServer as createViteServer } from "vite";
import { db } from "./server/db.js";
import { initBot, sendBroadcast, checkPaygReactivation, sendDirectMessage, syncAllUsersAndSellersFinancials, applyPaygSettlementToUser, settleSinglePaygPurchase, parseAmountInput, isSellerUnlimitedLimit } from "./server/bot.js";
import { xui } from "./server/xui.js";
import { rebecca } from "./server/rebecca.js";
import { mrocean } from "./server/mrocean.js";
import { multiPanel } from "./server/multiPanel.js";
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
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

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

  // Init Telegram Bot & Synchronize Seller Financials
  initBot();
  syncAllUsersAndSellersFinancials().catch(err => {
    console.error('[Startup Financials Sync Error]', err.message);
  });

  // ----- Admin API ----- //
  const api = express.Router();

  api.get("/state", (req, res) => {
    const state = db.getState();
    // Hide passwords in UI
    const safeState = {
      ...state,
      panel: {
        ...state.panel,
        password: state.panel.password ? '********' : ''
      },
      rebeccaPanel: state.rebeccaPanel ? {
        ...state.rebeccaPanel,
        password: state.rebeccaPanel.password ? '********' : ''
      } : undefined,
      mroceanPanel: state.mroceanPanel ? {
        ...state.mroceanPanel,
        password: state.mroceanPanel.password ? '********' : ''
      } : undefined
    };
    res.json(safeState);
  });

  api.post("/update-settings", (req, res) => {
    const { 
      botToken, 
      freeTestVolumeGb, 
      freeTestDurationDays, 
      freeTestEnabled, 
      freeTestPanel,
      freeTestInboundId, 
      freeTestInboundIds,
      freeTestRebeccaInbounds,
      freeTestRebeccaTags,
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
      freeTestPanel: freeTestPanel || 'sanaei',
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
    if (freeTestRebeccaInbounds !== undefined) updates.freeTestRebeccaInbounds = freeTestRebeccaInbounds;
    if (freeTestRebeccaTags !== undefined) updates.freeTestRebeccaTags = freeTestRebeccaTags;
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

  api.post("/update-rebecca-panel", async (req, res) => {
    const { url, username, password, apiKey, inboundTags, subUrlBase, enabled } = req.body;
    const currentState = db.getState();
    
    const newRebecca = { ...(currentState.rebeccaPanel || {}) };
    if (url !== undefined) newRebecca.url = url;
    if (username !== undefined) newRebecca.username = username;
    if (password && password !== '********') newRebecca.password = password;
    if (apiKey !== undefined) newRebecca.apiKey = apiKey;
    if (inboundTags !== undefined) newRebecca.inboundTags = Array.isArray(inboundTags) ? inboundTags : [];
    if (subUrlBase !== undefined) newRebecca.subUrlBase = subUrlBase;
    if (enabled !== undefined) newRebecca.enabled = Boolean(enabled);

    db.updateState({ rebeccaPanel: newRebecca });
    res.json({ success: true });
  });

  api.get("/rebecca-inbounds", async (req, res) => {
    try {
      const inbounds = await rebecca.getInbounds();
      res.json({ success: true, inbounds: inbounds || [] });
    } catch (e: any) {
      res.json({ success: false, message: e.message, inbounds: [] });
    }
  });

  api.post("/test-rebecca-connection", async (req, res) => {
    try {
      const { url, username, password, apiKey } = req.body;
      let result;
      if (url) {
        result = await rebecca.testConnection({ url, username, password, apiKey });
      } else {
        result = await rebecca.testConnection();
      }
      res.json(result);
    } catch (e: any) {
      res.json({ success: false, message: e.message });
    }
  });

  api.post("/update-mrocean-panel", async (req, res) => {
    const { url, username, password, apiKey, serviceId, subUrlBase, enabled } = req.body;
    const currentState = db.getState();
    
    const newMrOcean = { ...(currentState.mroceanPanel || {}) };
    if (url !== undefined) newMrOcean.url = url;
    if (username !== undefined) newMrOcean.username = username;
    if (password && password !== '********') newMrOcean.password = password;
    if (apiKey !== undefined) newMrOcean.apiKey = apiKey;
    if (serviceId !== undefined) newMrOcean.serviceId = serviceId;
    if (subUrlBase !== undefined) newMrOcean.subUrlBase = subUrlBase;
    if (enabled !== undefined) newMrOcean.enabled = Boolean(enabled);

    db.updateState({ mroceanPanel: newMrOcean });
    res.json({ success: true });
  });

  api.post("/test-mrocean-connection", async (req, res) => {
    try {
      const { url, username, password, apiKey, serviceId } = req.body;
      let result;
      if (url && username) {
        result = await mrocean.testConnection({ url, username, password, apiKey, serviceId });
      } else {
        result = await mrocean.testConnection();
      }
      res.json(result);
    } catch (e: any) {
      res.json({ success: false, message: e.message });
    }
  });

  api.get("/mrocean-dashboard", async (req, res) => {
    try {
      const dash = await mrocean.getDashboard();
      res.json({ success: true, dashboard: dash });
    } catch (e: any) {
      res.json({ success: false, message: e.message });
    }
  });

  api.get("/mrocean-services", async (req, res) => {
    try {
      const services = await mrocean.getServices();
      res.json({ success: true, services });
    } catch (e: any) {
      res.json({ success: false, message: e.message, services: [] });
    }
  });

  api.get("/mrocean-inbounds", async (req, res) => {
    try {
      const inbounds = await mrocean.getInbounds();
      res.json({ success: true, inbounds });
    } catch (e: any) {
      res.json({ success: false, message: e.message, inbounds: [] });
    }
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
        console.log(`[X-UI Test] Running test with provided credentials for url: ${url}`);
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
      if (!payload) {
        return res.status(400).json({ success: false, message: 'محتوای فایل پشتیبان ارسال نشده است.' });
      }
      
      let parsed: any = null;
      let rawJsonStr = typeof payload === 'object' ? JSON.stringify(payload) : String(payload).trim();

      // Determine if this is an encrypted backup
      let isEncrypted = false;
      try {
        const temp = JSON.parse(rawJsonStr);
        if (temp && temp.type === 'sanaei_bot_secured_backup') {
          isEncrypted = true;
        }
      } catch (e) {
        // Not a standard JSON or raw encrypted string
        isEncrypted = true; 
      }

      if (isEncrypted) {
        if (!password) {
          return res.status(400).json({ success: false, message: 'این فایل پشتیبان رمزگذاری شده است. لطفاً رمز عبور بکاپ را وارد کنید.' });
        }
        try {
          const decryptedData = decryptData(rawJsonStr, password);
          parsed = JSON.parse(decryptedData);
        } catch (decryptErr: any) {
          return res.status(400).json({ success: false, message: 'رمز عبور پشتیبان اشتباه است یا ساختار فایل پشتیبان مخدوش می‌باشد.' });
        }
      } else {
        try {
          parsed = JSON.parse(rawJsonStr);
        } catch (e: any) {
          return res.status(400).json({ success: false, message: 'ساختار فایل ارسالی یک JSON معتبر نیست: ' + e.message });
        }
      }
      
      if (!parsed || !parsed.users) {
        return res.status(400).json({ success: false, message: 'فایل پشتیبان معتبر نیست. ساختار دیتابیس یا لیست کاربران یافت نشد.' });
      }
      
      // Smart Merging: Prevent wiping critical connection parameters with empty values from the backup
      const currentDbState = db.getState();
      
      if ((!parsed.botToken || parsed.botToken.trim() === '') && currentDbState.botToken) {
        parsed.botToken = currentDbState.botToken;
      }
      
      if ((!parsed.adminIds || parsed.adminIds.length === 0) && currentDbState.adminIds && currentDbState.adminIds.length > 0) {
        parsed.adminIds = currentDbState.adminIds;
      }
      
      if ((!parsed.panel || !parsed.panel.url) && currentDbState.panel && currentDbState.panel.url) {
        parsed.panel = { ...currentDbState.panel, ...parsed.panel };
      }
      
      if ((!parsed.rebeccaPanel || !parsed.rebeccaPanel.url) && currentDbState.rebeccaPanel && currentDbState.rebeccaPanel.url) {
        parsed.rebeccaPanel = { ...currentDbState.rebeccaPanel, ...parsed.rebeccaPanel };
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
      const { filename, password } = req.body;
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
      let parsed: any = null;

      try {
        parsed = JSON.parse(rawData);
      } catch (e) {
        if (!password) {
          return res.status(400).json({ success: false, message: 'این فایل پشتیبان رمزگذاری شده است. لطفاً رمز عبور بکاپ را وارد کنید.' });
        }
        try {
          const decrypted = decryptData(rawData, password);
          parsed = JSON.parse(decrypted);
        } catch (decryptErr) {
          return res.status(400).json({ success: false, message: 'رمز عبور وارد شده نامعتبر است یا فایل مخدوش می‌باشد.' });
        }
      }

      if (!parsed || !parsed.panel || !parsed.users) {
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

    if (product.rebeccaInboundTags !== undefined) {
      product.rebeccaInboundTags = Array.isArray(product.rebeccaInboundTags) ? product.rebeccaInboundTags : [];
    }

    if (!product.panelType) {
      product.panelType = 'sanaei';
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

  api.post("/products/bulk-update-inbounds", (req, res) => {
    const { productIds, inboundIds, inboundId, panelType, rebeccaInboundTags } = req.body;
    if (!Array.isArray(productIds) || productIds.length === 0) {
      return res.status(400).json({ success: false, message: 'لیست محصولات جهت ویرایش گروهی الزامی است.' });
    }

    const parsedInboundId = inboundId !== undefined ? parseInboundId(inboundId) : undefined;
    const parsedInboundIds = inboundIds !== undefined ? parseInboundIds(inboundIds) : undefined;
    const parsedRebeccaInbounds = rebeccaInboundTags !== undefined ? (Array.isArray(rebeccaInboundTags) ? rebeccaInboundTags : []) : undefined;

    const state = db.getState();
    const newProducts = state.products.map(p => {
      if (productIds.includes(p.id)) {
        const updated: any = { ...p };
        if (parsedInboundId !== undefined) updated.inboundId = parsedInboundId;
        if (parsedInboundIds !== undefined) updated.inboundIds = parsedInboundIds;
        if (parsedRebeccaInbounds !== undefined) updated.rebeccaInboundTags = parsedRebeccaInbounds;
        if (panelType !== undefined) updated.panelType = panelType;
        return updated;
      }
      return p;
    });

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
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ success: false, message: 'مبلغ نامعتبر است' });
    }

    if (user.isSeller) {
      user.totalPayments = (user.totalPayments || 0) + parsedAmount;
      user.debt = Math.max(0, (user.debt || 0) - parsedAmount);
      applyPaygSettlementToUser(user, parsedAmount, user.debt === 0);
      db.saveUser(user);
      checkPaygReactivation(user).catch(console.error);

      const sellerMsg = `🎉 <b>مبلغ ${parsedAmount.toLocaleString()} تومان توسط مدیریت به حساب واریزی‌ها/پرداخت‌های شما ثبت شد.</b>\n\n` +
        `▫️ کل واریزی‌ها و تسویه‌ها: <b>${(user.totalPayments || 0).toLocaleString()}</b> تومان\n` +
        `▫️ بدهی باقیمانده به مدیریت: <b>${(user.debt || 0).toLocaleString()}</b> تومان`;
      sendDirectMessage(user.chatId, sellerMsg).catch(console.error);

      return res.json({ success: true, balance: user.balance, debt: user.debt, totalPayments: user.totalPayments });
    }

    user.balance = (user.balance || 0) + parsedAmount;
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

  api.post("/users/:chatId/seller-limits", async (req, res) => {
    const { debtLimit, debtVolume, debt, sellerDiscount, sellerDiscounts, isUnlimitedLimit } = req.body;
    const user = db.getUser(parseInt(req.params.chatId));
    if (!user) return res.status(404).json({ success: false, message: 'کاربر پیدا نشد' });
    
    if (debtLimit !== undefined) {
      const parsed = parseAmountInput(debtLimit);
      if (parsed !== null) {
        user.debtLimit = parsed;
        user.isUnlimitedLimit = parsed <= 0;
      }
    }
    if (isUnlimitedLimit !== undefined) {
      user.isUnlimitedLimit = !!isUnlimitedLimit;
      if (user.isUnlimitedLimit) {
        user.debtLimit = 0;
      }
    }
    if (debtVolume !== undefined) user.debtVolume = Number(debtVolume) || 0;
    if (debt !== undefined) {
      const parsedDebt = parseAmountInput(debt);
      const newDebt = parsedDebt !== null ? Math.max(0, parsedDebt) : Math.max(0, Number(debt) || 0);
      const oldDebt = user.debt || 0;
      if (newDebt < oldDebt) {
        const diffSettled = oldDebt - newDebt;
        user.totalPayments = (user.totalPayments || 0) + diffSettled;
        applyPaygSettlementToUser(user, diffSettled, newDebt === 0);
      }
      user.debt = newDebt;
    }
    if (sellerDiscount !== undefined) user.sellerDiscount = Number(sellerDiscount) || 0;
    if (sellerDiscounts !== undefined) user.sellerDiscounts = sellerDiscounts;
    
    db.saveUser(user);
    await syncAllUsersAndSellersFinancials();
    const updatedUser = db.getUser(user.chatId) || user;
    await checkPaygReactivation(updatedUser).catch(console.error);
    res.json({ success: true, user: updatedUser, users: db.getState().users });
  });

  api.post("/users/add-seller", async (req, res) => {
    const { chatId, username, debtLimit, isUnlimitedLimit } = req.body;
    if (!chatId) {
      return res.status(400).json({ success: false, message: 'شناسه عددی کاربری الزاماً باید فرستاده شود.' });
    }
    const numChatId = parseInt(chatId);
    if (isNaN(numChatId)) {
      return res.status(400).json({ success: false, message: 'شناسه عددی وارد شده معتبر نمی‌باشد.' });
    }

    const parsedLimit = parseAmountInput(debtLimit);
    const unlim = isUnlimitedLimit === true || (parsedLimit !== null && parsedLimit <= 0);
    const finalLimit = unlim ? 0 : (parsedLimit === null ? 1000000 : parsedLimit);

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
        debtLimit: finalLimit,
        isUnlimitedLimit: unlim,
        totalSales: 0,
        totalPayments: 0,
        sellerDiscount: 0,
        sellerDiscounts: [],
        purchases: []
      };
    } else {
      user.isSeller = true;
      if (username) user.username = username;
      user.debtLimit = finalLimit;
      user.isUnlimitedLimit = unlim;
    }
    db.saveUser(user);
    await syncAllUsersAndSellersFinancials();
    const updated = db.getUser(numChatId) || user;
    await checkPaygReactivation(updated).catch(console.error);
    res.json({ success: true, user: updated, users: db.getState().users });
  });

  api.post("/users/:chatId/settle", (req, res) => {
    const user = db.getUser(parseInt(req.params.chatId));
    if (!user) return res.status(404).json({ success: false });
    const settledAmount = user.debt || 0;
    user.totalPayments = (user.totalPayments || 0) + settledAmount;
    user.debt = 0;
    user.debtVolume = 0; // Reset active package volume debt too
    applyPaygSettlementToUser(user, settledAmount, true);
    db.saveUser(user);

    const settleMsg = `💵 <b>حساب بدهی شما توسط مدیریت تسویه گردید.</b>\n\n` +
      `▫️ مبلغ تسویه شده: <b>${settledAmount.toLocaleString()}</b> تومان\n` +
      `▫️ بدهی فعلی: <b>0</b> تومان\n` +
      `▫️ مجموع کل پرداخت‌ها و تسویه‌ها: <b>${(user.totalPayments || 0).toLocaleString()}</b> تومان\n\n` +
      `⚡ کلیه کانفیگ‌های مصرف آزاد (PAYG) تا حجم مصرفی فعلی تسویه و محاسبه جدید از این به بعد اعمال می‌گردد.`;
    sendDirectMessage(user.chatId, settleMsg).catch(console.error);

    res.json({ success: true, debt: user.debt, debtVolume: user.debtVolume, totalPayments: user.totalPayments, user });
  });

  api.post("/users/:chatId/purchases/:purchaseId/settle-payg", async (req, res) => {
    const user = db.getUser(parseInt(req.params.chatId));
    if (!user) return res.status(404).json({ success: false, message: 'کاربر پیدا نشد' });
    const result = settleSinglePaygPurchase(user, req.params.purchaseId);
    if (!result.success) return res.status(400).json(result);
    await syncAllUsersAndSellersFinancials();
    const updated = db.getUser(parseInt(req.params.chatId));
    res.json({ success: true, message: result.message, user: updated, users: db.getState().users });
  });

  api.post("/users/:chatId/purchases/:purchaseId/set-base-volume", async (req, res) => {
    const { baseGb } = req.body;
    const user = db.getUser(parseInt(req.params.chatId));
    if (!user) return res.status(404).json({ success: false, message: 'کاربر پیدا نشد' });
    const parsedGb = parseFloat(baseGb);
    if (isNaN(parsedGb) || parsedGb < 0) {
      return res.status(400).json({ success: false, message: 'مقدار گیگابایت نامعتبر است' });
    }
    const baseBytes = Math.round(parsedGb * 1024 * 1024 * 1024);
    const result = settleSinglePaygPurchase(user, req.params.purchaseId, baseBytes);
    if (!result.success) return res.status(400).json(result);
    await syncAllUsersAndSellersFinancials();
    const updated = db.getUser(parseInt(req.params.chatId));
    res.json({ success: true, message: result.message, user: updated, users: db.getState().users });
  });

  api.post("/users/:chatId/recalculate", async (req, res) => {
    const user = db.getUser(parseInt(req.params.chatId));
    if (!user) return res.status(404).json({ success: false, message: 'کاربر پیدا نشد' });
    await syncAllUsersAndSellersFinancials();
    const updated = db.getUser(parseInt(req.params.chatId));
    res.json({ success: true, user: updated, users: db.getState().users });
  });

  api.post("/sellers/sync-financials", async (req, res) => {
    const result = await syncAllUsersAndSellersFinancials();
    res.json({ success: true, updatedCount: result.updatedCount, users: db.getState().users });
  });

  app.use("/api", api);

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        watch: {
          ignored: ['**/db.json', '**/db.json.bak', '**/*.json', '**/backups/**', '**/*.log', '**/auto_backup_*']
        }
      },
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
