import "dotenv/config";
import express from "express";
import path from "path";
import cors from "cors";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";
import QRCode from "qrcode";
import { createServer as createViteServer } from "vite";
import { db, recordUserTransaction } from "./server/db.js";
import { initBot, sendBroadcast, checkPaygReactivation, sendDirectMessage, syncAllUsersAndSellersFinancials, applyPaygSettlementToUser, settleSinglePaygPurchase, parseAmountInput, isSellerUnlimitedLimit, executeSellerPortalPurchase, getSellerDiscountForProduct } from "./server/bot.js";
import { getUserAccountingReport, getSystemAccountingReport } from "./server/accounting.js";
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

  // Optional Basic Auth for Admin routes (excluding seller-portal)
  if (process.env.PANEL_USERNAME && process.env.PANEL_PASSWORD) {
    app.use('/api', (req, res, next) => {
      // Exclude seller portal endpoints from admin basic auth
      if (req.path.startsWith('/seller-portal')) {
        return next();
      }
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

  api.get("/backup/plain-download", (req, res) => {
    try {
      const dbPath = path.join(process.cwd(), 'db.json');
      if (!fs.existsSync(dbPath)) {
        return res.status(404).json({ success: false, message: 'فایل دیتابیس یافت نشد.' });
      }
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename=backup_plain_${Date.now()}.json`);
      const fileStream = fs.createReadStream(dbPath);
      fileStream.pipe(res);
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message || 'خطا در دانلود بکاپ.' });
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
      let rawData: any = payload;

      // Unpack string if passed as string
      if (typeof rawData === 'string') {
        const trimmed = rawData.trim();
        try {
          rawData = JSON.parse(trimmed);
        } catch (e) {
          rawData = trimmed;
        }
      }

      // Check if this is an encrypted payload
      let isEncrypted = false;
      if (rawData && typeof rawData === 'object' && rawData.type === 'sanaei_bot_secured_backup') {
        isEncrypted = true;
      } else if (typeof rawData === 'string' && rawData.includes('sanaei_bot_secured_backup')) {
        isEncrypted = true;
      }

      if (isEncrypted) {
        if (!password || password.trim() === '') {
          return res.status(400).json({ success: false, message: 'این فایل پشتیبان با رمز عبور محافظت شده است. لطفاً رمز عبور بکاپ را وارد فرمایید.' });
        }
        try {
          const decryptedData = decryptData(rawData, password.trim());
          parsed = JSON.parse(decryptedData);
        } catch (decryptErr: any) {
          return res.status(400).json({ success: false, message: 'رمز عبور پشتیبان اشتباه است یا ساختار فایل پشتیبان مخدوش می‌باشد.' });
        }
      } else {
        // Plain JSON backup
        if (typeof rawData === 'object' && rawData !== null) {
          parsed = rawData;
        } else {
          try {
            parsed = JSON.parse(String(rawData).trim());
          } catch (e: any) {
            return res.status(400).json({ success: false, message: 'ساختار فایل ارسالی یک JSON معتبر نیست: ' + e.message });
          }
        }
      }
      
      if (!parsed || (typeof parsed !== 'object')) {
        return res.status(400).json({ success: false, message: 'فایل پشتیبان نامعتبر است.' });
      }

      // Ensure basic data structures exist
      if (!parsed.users) parsed.users = [];
      if (!parsed.products) parsed.products = [];
      
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

      if ((!parsed.mroceanPanel || !parsed.mroceanPanel.url) && currentDbState.mroceanPanel && currentDbState.mroceanPanel.url) {
        parsed.mroceanPanel = { ...currentDbState.mroceanPanel, ...parsed.mroceanPanel };
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
    user.isSeller = Boolean(isSeller);
    if (user.isSeller) {
      if (user.debt === undefined) user.debt = 0;
      if (user.debtVolume === undefined) user.debtVolume = 0;
      if (user.debtLimit === undefined) user.debtLimit = 1000000; // Default 1M Toman Limit
      if (user.totalSales === undefined) user.totalSales = 0;
      if (!user.portalUsername) user.portalUsername = user.username || `seller_${user.chatId}`;
      if (!user.portalPassword) user.portalPassword = Math.floor(100000 + Math.random() * 900000).toString();
    } else {
      // Clear portal credentials when reseller access is revoked
      user.portalUsername = undefined;
      user.portalPassword = undefined;
      user.customDisplayPrices = undefined;
    }
    db.saveUser(user);
    res.json({ success: true, user, users: db.getState().users });
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
    if (req.body.portalUsername !== undefined) user.portalUsername = String(req.body.portalUsername).trim();
    if (req.body.portalPassword !== undefined) user.portalPassword = String(req.body.portalPassword).trim();
    
    db.saveUser(user);
    await syncAllUsersAndSellersFinancials();
    const updatedUser = db.getUser(user.chatId) || user;
    await checkPaygReactivation(updatedUser).catch(console.error);
    res.json({ success: true, user: updatedUser, users: db.getState().users });
  });

  api.post("/users/add-seller", async (req, res) => {
    const { chatId, username, debtLimit, isUnlimitedLimit, portalUsername, portalPassword } = req.body;
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
        portalUsername: portalUsername || username || `seller_${numChatId}`,
        portalPassword: portalPassword || Math.floor(100000 + Math.random() * 900000).toString(),
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
      if (portalUsername) user.portalUsername = portalUsername;
      if (portalPassword) user.portalPassword = portalPassword;
      else if (!user.portalPassword) user.portalPassword = Math.floor(100000 + Math.random() * 900000).toString();
      user.debtLimit = finalLimit;
      user.isUnlimitedLimit = unlim;
    }
    db.saveUser(user);
    await syncAllUsersAndSellersFinancials();
    const updated = db.getUser(numChatId) || user;
    await checkPaygReactivation(updated).catch(console.error);
    res.json({ success: true, user: updated, users: db.getState().users });
  });

  api.post("/users/:chatId/portal-credentials", (req, res) => {
    const { portalUsername, portalPassword } = req.body;
    const user = db.getUser(parseInt(req.params.chatId));
    if (!user) return res.status(404).json({ success: false, message: 'همکار یافت نشد' });

    if (portalUsername !== undefined) user.portalUsername = String(portalUsername).trim();
    if (portalPassword !== undefined) user.portalPassword = String(portalPassword).trim();

    db.saveUser(user);
    res.json({
      success: true,
      portalUsername: user.portalUsername,
      portalPassword: user.portalPassword,
      users: db.getState().users
    });
  });

  api.delete("/sellers/:chatId", (req, res) => {
    const user = db.getUser(parseInt(req.params.chatId));
    if (!user) return res.status(404).json({ success: false, message: 'همکار پیدا نشد.' });

    user.isSeller = false;
    user.portalUsername = undefined;
    user.portalPassword = undefined;
    user.customDisplayPrices = undefined;
    user.sellerDiscount = 0;
    user.sellerDiscounts = [];

    db.saveUser(user);
    res.json({ success: true, message: 'همکار با موفقیت حذف گردید و دسترسی پورتال غیرفعال گردید.', users: db.getState().users });
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

  api.post("/settings/portal-domain", (req, res) => {
    const { portalDomain } = req.body;
    const domainStr = portalDomain ? String(portalDomain).trim() : '';
    db.updateState({ portalDomain: domainStr });
    res.json({ success: true, portalDomain: domainStr, state: db.getState() });
  });

  api.post("/users/:chatId/purchases/:purchaseId/toggle-enable", async (req, res) => {
    try {
      const chatId = parseInt(req.params.chatId);
      const user = db.getUser(chatId);
      if (!user) return res.status(404).json({ success: false, message: 'کاربر پیدا نشد' });

      const purchaseId = req.params.purchaseId;
      const purchases = user.purchases || [];
      const purchase = purchases.find((p: any) => 
        p.id === purchaseId || 
        p.subId === purchaseId || 
        (p.id && String(p.id).toLowerCase() === String(purchaseId).toLowerCase())
      );

      if (!purchase) {
        return res.status(404).json({ success: false, message: 'کانفیگ پیدا نشد' });
      }

      const { enable } = req.body;
      const targetEnable = enable !== undefined ? !!enable : !!purchase.disabled;

      // Call MultiPanel service to enable/disable on servers
      await multiPanel.updateClientEnable(purchase, targetEnable);

      purchase.disabled = !targetEnable;
      db.saveUser(user);

      res.json({
        success: true,
        enable: targetEnable,
        message: targetEnable ? 'کانفیگ با موفقیت در سرورها فعال شد.' : 'کانفیگ با موفقیت در سرورها غیرفعال شد.',
        purchase,
        user,
        users: db.getState().users
      });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message || 'خطا در تغییر وضعیت کانفیگ' });
    }
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

  // --- Seller Storefront Web Portal API Endpoints ---
  api.post("/seller-portal/login", (req, res) => {
    const { username, password, chatId } = req.body;
    const state = db.getState();
    const allUsers = state.users || [];

    let targetSeller: any = null;
    if (chatId) {
      targetSeller = allUsers.find((u: any) => String(u.chatId) === String(chatId));
    }
    if (!targetSeller && username) {
      const uLower = String(username).trim().toLowerCase();
      targetSeller = allUsers.find((u: any) => 
        (u.portalUsername && String(u.portalUsername).toLowerCase() === uLower) ||
        (u.username && String(u.username).toLowerCase() === uLower) ||
        (String(u.chatId) === uLower)
      );
    }

    if (!targetSeller) {
      return res.status(404).json({ success: false, message: 'همکار فروشنده‌ای با این مشخصات یافت نشد.' });
    }

    if (!targetSeller.isSeller) {
      return res.status(403).json({ success: false, message: 'دسترسی همکار شما توسط مدیریت لغو گردیده است و امکان ورود به پورتال وجود ندارد.' });
    }

    if (targetSeller.portalPassword && password) {
      if (String(password).trim() !== String(targetSeller.portalPassword).trim()) {
        return res.status(401).json({ success: false, message: 'کلمه عبور وارد شده اشتباه است.' });
      }
    }

    res.json({
      success: true,
      seller: {
        chatId: targetSeller.chatId,
        username: targetSeller.username,
        portalUsername: targetSeller.portalUsername || targetSeller.username || `seller_${targetSeller.chatId}`,
        name: targetSeller.name || targetSeller.username || `همکار ${targetSeller.chatId}`,
        debt: targetSeller.debt || 0,
        debtLimit: targetSeller.debtLimit || 0,
        isUnlimitedLimit: !!targetSeller.isUnlimitedLimit,
        customDisplayPrices: targetSeller.customDisplayPrices || {},
        showCustomPricesOnly: targetSeller.showCustomPricesOnly ?? true
      }
    });
  });

  api.get("/seller-portal/info/:chatId", (req, res) => {
    const chatId = parseInt(req.params.chatId);
    const user = db.getUser(chatId);
    if (!user || !user.isSeller) {
      return res.status(404).json({ success: false, message: 'پنل همکار یافت نشد یا دسترسی غیرمجاز است.' });
    }

    const state = db.getState();
    const categories = (state.categories || []).filter((c: any) => !c.disabled);
    const activeCategoryIds = new Set(categories.map((c: any) => String(c.id)));
    
    // Only return products that are strictly ready for sale:
    // 1. Not disabled
    // 2. Category must not be disabled
    // 3. Must be ready for sale (valid volume/days or pay-as-you-go or valid price)
    const products = (state.products || [])
      .filter((p: any) => {
        if (!p || p.disabled === true || p.enabled === false) return false;
        if (p.categoryId && !activeCategoryIds.has(String(p.categoryId))) return false;
        const isReady = !!p.isPayAsYouGo || (Number(p.volumeGb || 0) > 0 && Number(p.durationDays || 0) > 0) || Number(p.price || 0) > 0;
        return isReady;
      })
      .map((p: any) => {
        const isPAYG = !!p.isPayAsYouGo;
        const sellerDiscount = getSellerDiscountForProduct(user, p);
        let realWholesalePrice = isPAYG ? 0 : p.price;
        if (sellerDiscount > 0 && !isPAYG) {
          realWholesalePrice = Math.max(0, Math.round(p.price * (1 - sellerDiscount / 100)));
        }

        const customPrice = user.customDisplayPrices?.[p.id];

        return {
          id: p.id,
          name: p.name,
          volumeGb: p.volumeGb,
          durationDays: p.durationDays,
          categoryId: p.categoryId,
          isPayAsYouGo: !!p.isPayAsYouGo,
          panelType: p.panelType,
          originalPrice: p.price,
          realWholesalePrice, // Real price charged to seller
          sellerDiscount,
          customDisplayPrice: customPrice !== undefined ? customPrice : null
        };
      });

    // Only return categories that actually have active ready products
    const productCatIds = new Set(products.map((p: any) => String(p.categoryId)).filter(Boolean));
    const activeCategories = categories.filter((c: any) => productCatIds.has(String(c.id)));

    const reportToday = getUserAccountingReport(user, 'today');
    const reportMonthly = getUserAccountingReport(user, 'monthly');
    const reportAll = getUserAccountingReport(user, 'all');

    res.json({
      success: true,
      seller: {
        chatId: user.chatId,
        username: user.username,
        portalUsername: user.portalUsername || user.username || `seller_${user.chatId}`,
        name: user.name || user.username || `همکار ${user.chatId}`,
        debt: user.debt || 0,
        debtLimit: user.debtLimit || 0,
        isUnlimitedLimit: isSellerUnlimitedLimit(user),
        debtVolume: user.debtVolume || 0,
        totalSales: user.totalSales || 0,
        totalPayments: user.totalPayments || 0,
        sellerDiscount: user.sellerDiscount || 0,
        customDisplayPrices: user.customDisplayPrices || {},
        showCustomPricesOnly: user.showCustomPricesOnly ?? true,
        purchases: (user.purchases || []).filter((p: any) => !p.isDeleted),
        transactions: user.transactions || []
      },
      accounting: {
        today: reportToday,
        monthly: reportMonthly,
        all: reportAll
      },
      bankInfo: {
        cardNumber: state.cardNumber || '۶۰۳۷۹۹۷۹۱۲۳۴۵۶۷۸',
        cardHolder: state.cardHolder || 'مدیریت حساب'
      },
      freeTest: {
        enabled: state.freeTestEnabled !== false,
        volumeGb: state.freeTestVolumeGb !== undefined ? Number(state.freeTestVolumeGb) : 1,
        durationDays: state.freeTestDurationDays !== undefined ? Number(state.freeTestDurationDays) : 3
      },
      categories: activeCategories,
      products
    });
  });

  api.post("/seller-portal/submit-debt-payment/:chatId", async (req, res) => {
    try {
      const chatId = parseInt(req.params.chatId);
      const user = db.getUser(chatId);
      if (!user || !user.isSeller) {
        return res.status(404).json({ success: false, message: 'همکار یافت نشد' });
      }

      const { amount, receiptBase64 } = req.body;
      const parsedAmount = parseInt(amount);
      if (isNaN(parsedAmount) || parsedAmount <= 0) {
        return res.status(400).json({ success: false, message: 'مبلغ وارد شده معتبر نمی‌باشد.' });
      }

      const state = db.getState();
      const payId = Math.random().toString(36).substring(2, 10);
      let currentPending = state.pendingPayments || [];

      currentPending.push({
        id: payId,
        chatId,
        amount: parsedAmount,
        receiptBase64: receiptBase64 || undefined,
        timestamp: Date.now(),
        pendingPurchase: { isSellerDebtPayment: true } as any
      });
      db.updateState({ pendingPayments: currentPending });

      const uName = user.username ? `@${user.username}` : `همکار ${user.chatId}`;
      const notifyAdminsMsg = `🔔 <b>درخواست پرداخت بدهی همکار (ثبت شده از پورتال وب)</b>\n\n` +
        `👤 همکار: <b>${uName}</b>\n` +
        `🆔 شناسه کاربری: <code>${chatId}</code>\n` +
        `💰 مبلغ اعلامی فیش: <b>${parsedAmount.toLocaleString()}</b> تومان\n` +
        `📉 بدهی فعلی: <b>${(user.debt || 0).toLocaleString()}</b> تومان\n\n` +
        `جهت بررسی و تایید می‌توانید از پنل مدیریت استفاده نمایید.`;

      // Broadcast to admins
      if (state.adminIds && state.adminIds.length > 0) {
        state.adminIds.forEach((adminId: number) => {
          sendDirectMessage(adminId, notifyAdminsMsg, {
            inline_keyboard: [
              [
                { text: '✅ تایید و کسر از بدهی', callback_data: `approve_pay_${payId}` },
                { text: '❌ رد فیش', callback_data: `reject_pay_${payId}` }
              ]
            ]
          });
        });
      }

      res.json({
        success: true,
        message: `رسید پرداخت مبلغ ${parsedAmount.toLocaleString()} تومان با موفقیت ثبت شد و در انتظار تایید مدیریت قرار گرفت.`
      });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message || 'خطا در ثبت پرداخت' });
    }
  });

  api.post("/seller-portal/save-prices/:chatId", (req, res) => {
    const chatId = parseInt(req.params.chatId);
    const user = db.getUser(chatId);
    if (!user || !user.isSeller) {
      return res.status(404).json({ success: false, message: 'همکار پیدا نشد.' });
    }

    const { customDisplayPrices, showCustomPricesOnly } = req.body;
    if (customDisplayPrices !== undefined) {
      user.customDisplayPrices = customDisplayPrices;
    }
    if (showCustomPricesOnly !== undefined) {
      user.showCustomPricesOnly = !!showCustomPricesOnly;
    }
    db.saveUser(user);
    res.json({ success: true, customDisplayPrices: user.customDisplayPrices, showCustomPricesOnly: user.showCustomPricesOnly });
  });

  api.post("/seller-portal/buy/:chatId", async (req, res) => {
    try {
      const chatId = parseInt(req.params.chatId);
      const { productId, customName } = req.body;
      if (!productId) {
        return res.status(400).json({ success: false, message: 'انتخاب محصول الزامی است.' });
      }

      const purchase = await executeSellerPortalPurchase(chatId, productId, customName);

      let qrCodeDataUrl = '';
      const mainSub = purchase.subUrl || purchase.sanaeiSubUrl || purchase.rebeccaSubUrl || '';
      if (mainSub) {
        try {
          qrCodeDataUrl = await QRCode.toDataURL(mainSub, { width: 400, margin: 2 });
        } catch (e) {}
      }

      const volStr = purchase.isPayAsYouGo ? 'نامحدود (مصرف آزاد)' : `${purchase.volumeGb || 0} گیگابایت`;
      const durStr = purchase.isPayAsYouGo ? 'نامحدود' : `${purchase.durationDays || 0} روز`;

      let cleanMessage = `🚀 <b>سرویس اختصاصی شما آماده استفاده است</b>\n\n` +
        `👤 <b>عنوان سرویس:</b> <code>${customName || purchase.name}</code>\n` +
        `📊 <b>حجم کل:</b> ${volStr}\n` +
        `⏳ <b>مدت اعتبار:</b> ${durStr}\n\n`;

      if (purchase.sanaeiSubUrl) {
        cleanMessage += `🔗 <b>لینک اتصال (سرور ۱):</b>\n<code>${purchase.sanaeiSubUrl}</code>\n\n`;
      }
      if (purchase.rebeccaSubUrl) {
        cleanMessage += `🔗 <b>لینک اتصال (سرور ۲):</b>\n<code>${purchase.rebeccaSubUrl}</code>\n\n`;
      }
      if (!purchase.sanaeiSubUrl && !purchase.rebeccaSubUrl && purchase.subUrl) {
        cleanMessage += `🔗 <b>لینک اتصال:</b>\n<code>${purchase.subUrl}</code>\n\n`;
      }

      cleanMessage += `⚡ <i>جهت اتصال کافیست لینک فوق را کپی و در نرم‌افزار V2Ray / Mahsa / Shadowrocket / Nekobox وارد نمایید.</i>`;

      res.json({
        success: true,
        purchase,
        qrCodeDataUrl,
        cleanMessage
      });
    } catch (e: any) {
      res.status(400).json({ success: false, message: e.message || 'خطا در ثبت سفارش پورتال' });
    }
  });

  api.post("/seller-portal/purchases/:chatId/:purchaseId/renew", async (req, res) => {
    try {
      const chatId = parseInt(req.params.chatId);
      const user = db.getUser(chatId);
      if (!user || !user.isSeller) {
        return res.status(404).json({ success: false, message: 'همکار معتبر نیست.' });
      }

      const purchaseId = req.params.purchaseId;
      const purchases = user.purchases || [];
      const purchase = purchases.find((p: any) => 
        p.id === purchaseId || 
        p.subId === purchaseId || 
        (p.id && String(p.id).toLowerCase() === String(purchaseId).toLowerCase())
      );

      if (!purchase) {
        return res.status(404).json({ success: false, message: 'کانفیگ یافت نشد.' });
      }

      const finalPrice = Number(purchase.price || 0);
      if (!isSellerUnlimitedLimit(user)) {
        const debtLimit = user.debtLimit !== undefined && user.debtLimit > 0 ? user.debtLimit : 1000000;
        if ((user.debt || 0) + finalPrice > debtLimit) {
          return res.status(400).json({
            success: false,
            message: `سقف اعتبار شما برای تمدید این سرویس کافی نیست. (بدهی فعلی: ${(user.debt || 0).toLocaleString()} تومان / سقف: ${debtLimit.toLocaleString()} تومان)`
          });
        }
      }

      const volGb = Number(purchase.volumeGb || 0);
      const durDays = Number(purchase.durationDays || 0);

      // Call multiPanel renew
      await multiPanel.renewClient(purchase, volGb, durDays);

      user.debt = (user.debt || 0) + finalPrice;
      user.debtVolume = (user.debtVolume || 0) + volGb;
      user.totalSales = (user.totalSales || 0) + finalPrice;

      purchase.createdAt = new Date().toISOString();
      purchase.lastUsedBytes = 0;
      purchase.baseSettledBytes = 0;
      if (durDays > 0) {
        purchase.expiryDate = new Date(Date.now() + durDays * 86400000).toISOString();
      }
      purchase.disabled = false;

      recordUserTransaction(user, {
        type: 'purchase',
        amount: finalPrice,
        direction: 'debit',
        description: `تمدید سرویس ${purchase.name} (${volGb} GB / ${durDays} روز) از پورتال وب`,
        configName: purchase.name,
        volumeGb: volGb,
        balanceAfter: user.balance,
        debtAfter: user.debt,
        createdAt: purchase.createdAt
      });

      db.saveUser(user);

      res.json({
        success: true,
        message: `سرویس «${purchase.name}» با موفقیت تمدید گردید و حجم و زمان آن مجدداً تنظیم شد.`,
        purchase,
        debt: user.debt,
        debtVolume: user.debtVolume
      });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message || 'خطا در تمدید سرویس' });
    }
  });

  api.post("/seller-portal/purchases/:chatId/:purchaseId/toggle-enable", async (req, res) => {
    try {
      const chatId = parseInt(req.params.chatId);
      const user = db.getUser(chatId);
      if (!user || !user.isSeller) return res.status(404).json({ success: false, message: 'همکار معتبر نیست.' });

      const purchaseId = req.params.purchaseId;
      const purchases = user.purchases || [];
      const purchase = purchases.find((p: any) => 
        p.id === purchaseId || 
        p.subId === purchaseId || 
        (p.id && String(p.id).toLowerCase() === String(purchaseId).toLowerCase())
      );

      if (!purchase) return res.status(404).json({ success: false, message: 'کانفیگ یافت نشد.' });

      const { enable } = req.body;
      const targetEnable = enable !== undefined ? !!enable : !!purchase.disabled;

      await multiPanel.updateClientEnable(purchase, targetEnable);
      purchase.disabled = !targetEnable;
      db.saveUser(user);

      res.json({
        success: true,
        enable: targetEnable,
        message: targetEnable ? 'کانفیگ با موفقیت در سرور فعال (متصل) شد.' : 'کانفیگ با موفقیت در سرور غیرفعال (قطع) شد.',
        purchase
      });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message || 'خطا در تغییر وضعیت کانفیگ' });
    }
  });

  api.post("/seller-portal/purchases/:chatId/:purchaseId/rename", (req, res) => {
    try {
      const chatId = parseInt(req.params.chatId);
      const user = db.getUser(chatId);
      if (!user || !user.isSeller) return res.status(404).json({ success: false, message: 'همکار معتبر نیست.' });

      const purchaseId = req.params.purchaseId;
      const purchases = user.purchases || [];
      const purchase = purchases.find((p: any) => 
        p.id === purchaseId || 
        p.subId === purchaseId || 
        (p.id && String(p.id).toLowerCase() === String(purchaseId).toLowerCase())
      );

      if (!purchase) return res.status(404).json({ success: false, message: 'کانفیگ یافت نشد.' });

      const { newName } = req.body;
      if (!newName || !newName.trim()) {
        return res.status(400).json({ success: false, message: 'نام جدید وارد نشده است.' });
      }

      purchase.name = newName.trim();
      db.saveUser(user);

      res.json({
        success: true,
        message: 'عنوان کانفیگ با موفقیت تغییر کرد.',
        purchase
      });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message || 'خطا در تغییر نام' });
    }
  });

  api.delete("/seller-portal/purchases/:chatId/:purchaseId", async (req, res) => {
    try {
      const chatId = parseInt(req.params.chatId);
      const user = db.getUser(chatId);
      if (!user || !user.isSeller) return res.status(404).json({ success: false, message: 'همکار معتبر نیست.' });

      const purchaseId = req.params.purchaseId;
      const purchases = user.purchases || [];
      const purchase = purchases.find((p: any) => 
        p.id === purchaseId || 
        p.subId === purchaseId || 
        (p.id && String(p.id).toLowerCase() === String(purchaseId).toLowerCase())
      );

      if (!purchase) return res.status(404).json({ success: false, message: 'کانفیگ یافت نشد.' });

      try {
        await multiPanel.delClient(purchase);
      } catch (delErr: any) {
        console.warn('[MultiPanel delete warning]:', delErr.message);
      }

      purchase.isDeleted = true;
      db.saveUser(user);

      res.json({
        success: true,
        message: 'کانفیگ با موفقیت حذف گردید.'
      });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message || 'خطا در حذف کانفیگ' });
    }
  });

  api.post("/seller-portal/free-test/:chatId", async (req, res) => {
    try {
      const chatId = parseInt(req.params.chatId);
      const user = db.getUser(chatId);
      if (!user || !user.isSeller) return res.status(404).json({ success: false, message: 'همکار معتبر نیست.' });

      const state = db.getState();
      if (state.freeTestEnabled === false) {
        return res.status(400).json({ success: false, message: 'سرویس تست رایگان توسط مدیر غیرفعال است.' });
      }

      const { customName } = req.body;
      const volGb = state.freeTestVolumeGb !== undefined ? Number(state.freeTestVolumeGb) : 1;
      const durDays = state.freeTestDurationDays !== undefined ? Number(state.freeTestDurationDays) : 3;

      const testInboundIds = (state.freeTestInboundIds && state.freeTestInboundIds.length > 0)
        ? state.freeTestInboundIds
        : (state.freeTestInboundId ? [state.freeTestInboundId] : undefined);

      const panelType = (state.freeTestPanel as any) || 'sanaei';
      const cleanCustom = (customName || `test_${Date.now().toString().slice(-4)}`).replace(/[^a-zA-Z0-9_]/g, '_');

      const clientResult = await multiPanel.createClientConfig({
        user,
        product: {
          name: `تست رایگان (${volGb}GB - ${durDays} روز)`,
          volumeGb: volGb,
          durationDays: durDays,
          panelType,
          inboundIds: testInboundIds,
          rebeccaInboundTags: (state.freeTestRebeccaTags && state.freeTestRebeccaTags.length > 0) ? state.freeTestRebeccaTags : state.freeTestRebeccaInbounds,
          limitIp: 1
        },
        customName: cleanCustom
      });

      const newPurchase: any = {
        id: clientResult.clientEmail,
        name: `تست رایگان (${volGb}GB - ${durDays} روز)`,
        price: 0,
        subId: clientResult.subId,
        subUrl: clientResult.subUrl,
        sanaeiSubUrl: clientResult.sanaeiSubUrl,
        rebeccaSubUrl: clientResult.rebeccaSubUrl,
        mroceanSubUrl: clientResult.mroceanSubUrl,
        mroceanPortalUrl: clientResult.mroceanPortalUrl,
        panelType: clientResult.panelType,
        volumeGb: volGb,
        durationDays: durDays,
        createdAt: new Date().toISOString()
      };

      user.purchases = user.purchases || [];
      user.purchases.push(newPurchase);
      db.saveUser(user);

      let qrCodeDataUrl = '';
      const mainSub = newPurchase.subUrl || newPurchase.sanaeiSubUrl || newPurchase.rebeccaSubUrl || '';
      if (mainSub) {
        try {
          qrCodeDataUrl = await QRCode.toDataURL(mainSub, { width: 400, margin: 2 });
        } catch (e) {}
      }

      let cleanMessage = `🎁 <b>اکانت تست رایگان آماده استفاده است</b>\n\n` +
        `👤 <b>عنوان:</b> <code>${customName || newPurchase.name}</code>\n` +
        `📊 <b>حجم تست:</b> ${volGb} گیگابایت\n` +
        `⏳ <b>مدت اعتبار:</b> ${durDays} روز\n\n`;

      if (newPurchase.sanaeiSubUrl) {
        cleanMessage += `🔗 <b>لینک اتصال:</b>\n<code>${newPurchase.sanaeiSubUrl}</code>\n\n`;
      } else if (newPurchase.subUrl) {
        cleanMessage += `🔗 <b>لینک اتصال:</b>\n<code>${newPurchase.subUrl}</code>\n\n`;
      }
      cleanMessage += `⚡ <i>جهت اتصال لینک فوق را در نرم‌افزار وارد نمایید.</i>`;

      res.json({
        success: true,
        message: 'اکانت تست رایگان با موفقیت صادر شد.',
        purchase: newPurchase,
        qrCodeDataUrl,
        cleanMessage
      });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message || 'خطا در ایجاد اکانت تست' });
    }
  });

  app.use("/api", api);

  // Serve static files in production or when dist folder exists
  const distPath = path.join(process.cwd(), 'dist');
  const hasDist = fs.existsSync(path.join(distPath, 'index.html'));

  if (process.env.NODE_ENV === "production" || hasDist) {
    app.use(express.static(distPath, {
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
          res.setHeader('Pragma', 'no-cache');
          res.setHeader('Expires', '0');
        }
      }
    }));
    app.get('*', (req, res) => {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
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
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
