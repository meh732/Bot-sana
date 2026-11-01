import "dotenv/config";
import express from "express";
import path from "path";
import cors from "cors";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";
import QRCode from "qrcode";
import { db, recordUserTransaction, ensureSellerApiKey, generateSellerApiKey } from "./server/db.js";
import { initBot, sendBroadcast, checkPaygReactivation, sendDirectMessage, syncAllUsersAndSellersFinancials, applyPaygSettlementToUser, settleSinglePaygPurchase, parseAmountInput, isSellerUnlimitedLimit, executeSellerPortalPurchase, executeSellerCustomVolumePurchase, getSellerDiscountForProduct, cancelSellerPurchase, getPurchaseLiveUsedBytes } from "./server/bot.js";
import { getUserAccountingReport, getSystemAccountingReport } from "./server/accounting.js";
import { generateUserStatementPdf, parseShamsiDateToTimestamp, PdfRangeOptions } from "./server/pdfGenerator.js";
import { xui } from "./server/xui.js";
import { rebecca } from "./server/rebecca.js";
import { mrocean } from "./server/mrocean.js";
import { panel4 } from "./server/panel4.js";
import { multiPanel } from "./server/multiPanel.js";
import { encryptData, decryptData } from "./server/crypto.js";
import { resellerBotManager } from "./server/resellerBotManager.js";

const currentDir = typeof __dirname !== 'undefined' ? __dirname : process.cwd();

// Global crash protection to keep web panel and Telegram bots online 24/7
process.on('uncaughtException', (err: any) => {
  console.error('[Process UncaughtException - Prevented Crash]:', err?.message || err);
});
process.on('unhandledRejection', (reason: any) => {
  console.error('[Process UnhandledRejection - Prevented Crash]:', reason?.message || reason);
});

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
      // Exclude seller portal, external reseller/provider API endpoints, and any request with API key from admin basic auth
      const hasApiKey = !!(
        req.query.key || req.query.api_key || req.query.apiKey || req.query.token || req.query.code ||
        req.headers['x-api-key'] || req.headers['api-key'] || req.headers['apikey'] ||
        req.headers['token'] || req.headers['Token' as any] || req.headers['auth'] ||
        (req.headers.authorization && !req.headers.authorization.toLowerCase().startsWith('basic '))
      );

      if (
        hasApiKey ||
        req.path.startsWith('/seller-portal') ||
        req.path.startsWith('/v1') ||
        req.path.startsWith('/provider') ||
        req.path.startsWith('/reseller') ||
        req.path.startsWith('/products') ||
        req.path.startsWith('/services')
      ) {
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
    let sellerKeyUpdated = false;
    (state.users || []).forEach(u => {
      if (u.isSeller && !u.apiKey) {
        ensureSellerApiKey(u, false);
        sellerKeyUpdated = true;
      }
    });
    if (sellerKeyUpdated) {
      db.updateState({ users: state.users });
    }
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
      } : undefined,
      panel4: state.panel4 ? {
        ...state.panel4,
        password: state.panel4.password ? '********' : ''
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
      forceJoinChannels,
      customVolumePricePerGb,
      customVolumeMinGb,
      customVolumeDefaultDays,
      customVolumePanelType,
      customVolumeEnabled
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
    if (customVolumePricePerGb !== undefined) updates.customVolumePricePerGb = Number(customVolumePricePerGb);
    if (customVolumeMinGb !== undefined) updates.customVolumeMinGb = Number(customVolumeMinGb);
    if (customVolumeDefaultDays !== undefined) updates.customVolumeDefaultDays = Number(customVolumeDefaultDays);
    if (customVolumePanelType !== undefined) updates.customVolumePanelType = customVolumePanelType;
    if (customVolumeEnabled !== undefined) updates.customVolumeEnabled = Boolean(customVolumeEnabled);
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

  // ----- Panel 4 Endpoints ----- //
  api.post("/update-panel4", async (req, res) => {
    const { url, username, password, apiKey, inboundId, inboundIds, subUrlBase, enabled, panelType } = req.body;
    const currentState = db.getState();
    const newPanel4 = { ...(currentState.panel4 || {}) };
    if (url !== undefined) newPanel4.url = url;
    if (username !== undefined) newPanel4.username = username;
    if (password && password !== '********') newPanel4.password = password;
    if (apiKey !== undefined) newPanel4.apiKey = apiKey;
    if (subUrlBase !== undefined) newPanel4.subUrlBase = subUrlBase;
    if (enabled !== undefined) newPanel4.enabled = Boolean(enabled);
    if (panelType !== undefined) newPanel4.panelType = panelType;
    if (inboundId !== undefined) newPanel4.inboundId = parseInboundId(inboundId);
    if (inboundIds !== undefined) newPanel4.inboundIds = parseInboundIds(inboundIds);

    db.updateState({ panel4: newPanel4 });
    res.json({ success: true });
  });

  api.post("/test-panel4-connection", async (req, res) => {
    try {
      const { url, username, password, apiKey } = req.body;
      const savedP4 = db.getState().panel4 || {};
      const resolvedPassword = (!password || password === '********') ? savedP4.password : password;
      const resolvedApiKey = (!apiKey || apiKey === '********') ? savedP4.apiKey : apiKey;
      let result;
      if (url && (username || resolvedApiKey)) {
        result = await panel4.testConnection({ url, username, password: resolvedPassword, apiKey: resolvedApiKey });
      } else {
        result = await panel4.testConnection();
      }
      res.json(result);
    } catch (e: any) {
      res.json({ success: false, message: e.message });
    }
  });

  api.get("/panel4-inbounds", async (req, res) => {
    try {
      const inbounds = await panel4.getInbounds();
      res.json({ success: true, inbounds: inbounds || [] });
    } catch (e: any) {
      res.json({ success: false, message: e.message, inbounds: [] });
    }
  });

  api.get("/panel4-online", async (req, res) => {
    try {
      const stats = await panel4.getOnlineUsers();
      res.json({ success: true, ...stats });
    } catch (e: any) {
      res.json({ success: false, message: e.message, onlineCount: 0, totalUsers: 0, users: [] });
    }
  });

  api.get("/panel4-actions/preview", async (req, res) => {
    try {
      const preview = await panel4.getActionsPreview();
      res.json({ success: true, preview });
    } catch (e: any) {
      res.status(400).json({ success: false, message: e.message });
    }
  });

  api.post("/panel4-actions/expire", async (req, res) => {
    try {
      const { days, action, includeExpired, includeOnHold } = req.body;
      const numDays = parseInt(days);
      if (isNaN(numDays) || numDays <= 0) {
        return res.status(400).json({ success: false, message: 'تعداد روز باید یک عدد صحیح بزرگتر از صفر باشد.' });
      }
      const mode = action === 'subtract' ? 'remove' : 'add';
      const result = await panel4.bulkModifyExpire(
        numDays, 
        mode, 
        Boolean(includeExpired),
        Boolean(includeOnHold)
      );
      res.json({ success: true, ...result });
    } catch (e: any) {
      res.status(400).json({ success: false, message: e.message });
    }
  });

  api.post("/panel4-actions/usage", async (req, res) => {
    try {
      const { gb, action, includeLimited } = req.body;
      const numGb = parseInt(gb);
      if (isNaN(numGb) || numGb <= 0) {
        return res.status(400).json({ success: false, message: 'مقدار حجم (گیگابایت) باید یک عدد صحیح بزرگتر از صفر باشد.' });
      }
      const mode = action === 'subtract' ? 'remove' : 'add';
      const result = await panel4.bulkModifyUsage(numGb, mode, Boolean(includeLimited));
      res.json({ success: true, ...result });
    } catch (e: any) {
      res.status(400).json({ success: false, message: e.message });
    }
  });

  api.post("/panel4-actions/service", async (req, res) => {
    try {
      const { serviceId, action, targetId } = req.body;
      const numServiceId = parseInt(serviceId);
      if (isNaN(numServiceId) || numServiceId <= 0) {
        return res.status(400).json({ success: false, message: 'شناسه سرویس معتبر نیست.' });
      }
      const mode = action === 'remove' ? 'remove' : (action === 'migrate' ? 'migrate' : 'add');
      const result = await panel4.bulkModifyService(numServiceId, mode, targetId ? parseInt(targetId) : undefined);
      res.json({ success: true, ...result });
    } catch (e: any) {
      res.status(400).json({ success: false, message: e.message });
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

      if ((!parsed.panel4 || !parsed.panel4.url) && currentDbState.panel4 && currentDbState.panel4.url) {
        parsed.panel4 = { ...currentDbState.panel4, ...parsed.panel4 };
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

      const currentDbState = db.getState();
      if ((!parsed.panel4 || !parsed.panel4.url) && currentDbState.panel4 && currentDbState.panel4.url) {
        parsed.panel4 = { ...currentDbState.panel4, ...parsed.panel4 };
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
      ensureSellerApiKey(user, false);
    } else {
      // Clear portal credentials when reseller access is revoked
      user.portalUsername = undefined;
      user.portalPassword = undefined;
      user.customDisplayPrices = undefined;
      user.apiEnabled = false;
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
    ensureSellerApiKey(user, false);
    db.saveUser(user);
    await syncAllUsersAndSellersFinancials();
    const updated = db.getUser(numChatId) || user;
    await checkPaygReactivation(updated).catch(console.error);
    res.json({ success: true, user: updated, users: db.getState().users });
  });

  api.post("/users/:chatId/regenerate-api-key", (req, res) => {
    const user = db.getUser(parseInt(req.params.chatId));
    if (!user || !user.isSeller) {
      return res.status(404).json({ success: false, message: 'همکار پیدا نشد.' });
    }
    user.apiKey = generateSellerApiKey(user.chatId);
    user.apiEnabled = true;
    db.saveUser(user);
    res.json({ success: true, apiKey: user.apiKey, apiEnabled: user.apiEnabled, user, users: db.getState().users });
  });

  api.post("/users/:chatId/toggle-api-access", (req, res) => {
    const user = db.getUser(parseInt(req.params.chatId));
    if (!user || !user.isSeller) {
      return res.status(404).json({ success: false, message: 'همکار پیدا نشد.' });
    }
    ensureSellerApiKey(user, false);
    user.apiEnabled = req.body.apiEnabled !== undefined ? Boolean(req.body.apiEnabled) : !(user.apiEnabled !== false);
    db.saveUser(user);
    res.json({ success: true, apiKey: user.apiKey, apiEnabled: user.apiEnabled, user, users: db.getState().users });
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
    try {
      const { username, password, chatId } = req.body;
      const state = db.getState();
      const allUsers = state.users || [];

      let targetSeller: any = null;
      const cleanUsername = username ? String(username).trim().toLowerCase() : '';
      const cleanChatId = chatId ? String(chatId).trim().toLowerCase() : '';

      if (cleanChatId && /^\d+$/.test(cleanChatId)) {
        targetSeller = allUsers.find((u: any) => String(u.chatId) === cleanChatId);
      }
      if (!targetSeller && (cleanUsername || cleanChatId)) {
        const queryTerm = cleanUsername || cleanChatId;
        targetSeller = allUsers.find((u: any) => 
          (u.portalUsername && String(u.portalUsername).toLowerCase() === queryTerm) ||
          (u.username && String(u.username).toLowerCase() === queryTerm) ||
          (String(u.chatId) === queryTerm)
        );
      }

      if (!targetSeller) {
        return res.status(404).json({ success: false, message: 'همکار فروشنده‌ای با این مشخصات یافت نشد.' });
      }

      if (!targetSeller.isSeller) {
        return res.status(403).json({ success: false, message: 'دسترسی همکار شما توسط مدیریت لغو گردیده است و امکان ورود به پورتال وجود ندارد.' });
      }

      if (targetSeller.portalPassword) {
        if (!password || String(password).trim() !== String(targetSeller.portalPassword).trim()) {
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
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message || 'خطا در ورود به پورتال.' });
    }
  });

  api.get("/seller-portal/info/:identifier", (req, res) => {
    try {
      const identifier = req.params.identifier;
      const state = db.getState();
      const allUsers = state.users || [];

      let user: any = null;
      if (/^\d+$/.test(identifier)) {
        user = db.getUser(parseInt(identifier));
      }
      if (!user) {
        const uLower = String(identifier).trim().toLowerCase();
        user = allUsers.find((u: any) => 
          (u.portalUsername && String(u.portalUsername).toLowerCase() === uLower) ||
          (u.username && String(u.username).toLowerCase() === uLower) ||
          (String(u.chatId) === uLower)
        );
      }

      if (!user || !user.isSeller) {
        return res.status(404).json({ success: false, message: 'پنل همکار یافت نشد یا دسترسی غیرمجاز است.' });
      }

      const categories = (state.categories || []).filter((c: any) => !c.disabled);
      const activeCategoryIds = new Set(categories.map((c: any) => String(c.id)));
      
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
            realWholesalePrice,
            sellerDiscount,
            customDisplayPrice: customPrice !== undefined ? customPrice : null
          };
        });

      const productCatIds = new Set(products.map((p: any) => String(p.categoryId)).filter(Boolean));
      const activeCategories = categories.filter((c: any) => productCatIds.has(String(c.id)));

      const reportToday = getUserAccountingReport(user, 'today');
      const reportMonthly = getUserAccountingReport(user, 'monthly');
      const reportAll = getUserAccountingReport(user, 'all');

      const sellerApiKey = ensureSellerApiKey(user, true);

      res.json({
        success: true,
        seller: {
          chatId: user.chatId,
          username: user.username,
          portalUsername: user.portalUsername || user.username || `seller_${user.chatId}`,
          name: user.name || user.username || `همکار ${user.chatId}`,
          apiKey: sellerApiKey,
          apiEnabled: user.apiEnabled !== false,
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
        customVolume: {
          enabled: state.customVolumeEnabled !== false,
          pricePerGb: user.customVolumePricePerGb || state.customVolumePricePerGb || 3000,
          sellerDiscount: user.sellerDiscount || 0,
          finalPricePerGb: Math.max(0, Math.round((user.customVolumePricePerGb || state.customVolumePricePerGb || 3000) * (1 - (user.sellerDiscount || 0) / 100))),
          minGb: state.customVolumeMinGb || 1,
          defaultDays: state.customVolumeDefaultDays || 30,
          defaultPanel: state.customVolumePanelType || 'mrocean',
          availablePanels: [
            ...(state.mroceanPanel?.url ? [{ id: 'mrocean', name: 'مستر اوشن (Mr Ocean) 🌊 - پیشنهادی' }] : [{ id: 'mrocean', name: 'مستر اوشن (Mr Ocean) 🌊' }]),
            ...(state.panel?.url ? [{ id: 'sanaei', name: 'سنایی (X-UI) 🔵' }] : []),
            ...(state.rebeccaPanel?.url ? [{ id: 'rebecca', name: 'ربکا (Rebecca) 🟣' }] : [])
          ]
        },
        categories: activeCategories,
        products
      });
    } catch (err: any) {
      console.error('[Seller Portal Info Error]', err);
      res.status(500).json({ success: false, message: 'خطا در بارگذاری اطلاعات پورتال همکار: ' + (err.message || String(err)) });
    }
  });

  api.get("/seller-portal/download-pdf/:chatId", async (req, res) => {
    try {
      const chatId = parseInt(req.params.chatId);
      const user = db.getUser(chatId);
      if (!user) {
        return res.status(404).send("User not found");
      }

      const { startMs, endMs, startDateStr, endDateStr, shamsiStart, shamsiEnd } = req.query;

      let options: PdfRangeOptions = {};

      if (startMs && endMs) {
        options.startMs = Number(startMs);
        options.endMs = Number(endMs);
        options.startDateStr = startDateStr ? String(startDateStr) : undefined;
        options.endDateStr = endDateStr ? String(endDateStr) : undefined;
      } else if (shamsiStart || shamsiEnd) {
        const sMs = shamsiStart ? parseShamsiDateToTimestamp(String(shamsiStart), false) : undefined;
        const eMs = shamsiEnd ? parseShamsiDateToTimestamp(String(shamsiEnd), true) : undefined;
        if (sMs || eMs) {
          options.startMs = sMs || 0;
          options.endMs = eMs || Date.now();
          options.startDateStr = String(shamsiStart || '');
          options.endDateStr = String(shamsiEnd || '');
        }
      }

      const pdfBuffer = await generateUserStatementPdf(user, options);

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename=Statement_${user.chatId}.pdf`);
      res.send(pdfBuffer);
    } catch (e: any) {
      console.error("[PDF Download Route Error]", e);
      res.status(500).send("Error generating PDF: " + e.message);
    }
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

      if (purchase.panel4SubUrl) {
        cleanMessage += `🔗 <b>لینک اتصال (پنل ۴):</b>\n<code>${purchase.panel4SubUrl}</code>\n\n`;
      }
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

  api.post("/seller-portal/buy-custom-volume/:chatId", async (req, res) => {
    try {
      const chatId = parseInt(req.params.chatId);
      const { volumeGb, durationDays, customName, panelType, categoryId } = req.body;
      const volNum = Number(volumeGb);
      if (isNaN(volNum) || volNum <= 0) {
        return res.status(400).json({ success: false, message: 'لطفاً میزان حجم معتبری به گیگابایت وارد فرمایید.' });
      }

      const purchase = await executeSellerCustomVolumePurchase({
        sellerChatId: chatId,
        volumeGb: volNum,
        durationDays: durationDays ? Number(durationDays) : 30,
        customName: customName ? String(customName).trim() : undefined,
        panelType: panelType || undefined,
        categoryId: categoryId ? String(categoryId) : undefined
      });

      let qrCodeDataUrl = '';
      const mainSub = purchase.mroceanSubUrl || purchase.subUrl || purchase.sanaeiSubUrl || purchase.rebeccaSubUrl || '';
      if (mainSub) {
        try {
          qrCodeDataUrl = await QRCode.toDataURL(mainSub, { width: 400, margin: 2 });
        } catch (e) {}
      }

      const volStr = `${purchase.volumeGb || volNum} گیگابایت`;
      const durStr = `${purchase.durationDays || 30} روز`;

      let cleanMessage = `🚀 <b>سرویس اختصاصی شما با حجم انتخابی آماده است</b>\n\n` +
        `👤 <b>عنوان سرویس:</b> <code>${customName || purchase.name}</code>\n` +
        `📊 <b>حجم کل:</b> ${volStr}\n` +
        `⏳ <b>مدت اعتبار:</b> ${durStr}\n\n`;

      if (purchase.panel4SubUrl) {
        cleanMessage += `🔗 <b>لینک اتصال (پنل ۴):</b>\n<code>${purchase.panel4SubUrl}</code>\n\n`;
      } else if (purchase.mroceanSubUrl) {
        cleanMessage += `🔗 <b>لینک اتصال:</b>\n<code>${purchase.mroceanSubUrl}</code>\n\n`;
      } else if (purchase.sanaeiSubUrl) {
        cleanMessage += `🔗 <b>لینک اتصال:</b>\n<code>${purchase.sanaeiSubUrl}</code>\n\n`;
      } else if (purchase.rebeccaSubUrl) {
        cleanMessage += `🔗 <b>لینک اتصال:</b>\n<code>${purchase.rebeccaSubUrl}</code>\n\n`;
      } else if (purchase.subUrl) {
        cleanMessage += `🔗 <b>لینک اتصال:</b>\n<code>${purchase.subUrl}</code>\n\n`;
      }

      cleanMessage += `⚡ <i>جهت اتصال کافیست لینک فوق را کپی و در نرم‌افزار V2Ray / Mahsa / Shadowrocket / Nekobox وارد نمایید.</i>`;

      res.json({
        success: true,
        purchase,
        qrCodeDataUrl,
        cleanMessage,
        message: 'کانفیگ با حجم دلخواه با موفقیت ساخته شد.'
      });
    } catch (e: any) {
      res.status(400).json({ success: false, message: e.message || 'خطا در ثبت سفارش با حجم دلخواه' });
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

  api.get("/seller-portal/purchases/:chatId/:purchaseId/cancel-preview", async (req, res) => {
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

      const usedBytes = await getPurchaseLiveUsedBytes(purchase);
      const ONE_GB_BYTES = 1024 * 1024 * 1024;
      const originalPrice = Number(purchase.price) || 0;
      const originalVolGb = Number(purchase.volumeGb) || 0;
      const state = db.getState();

      let ratePerGb = purchase.ratePerGb;
      if (!ratePerGb || ratePerGb <= 0) {
        if (originalVolGb > 0 && originalPrice > 0) {
          ratePerGb = Math.round(originalPrice / originalVolGb);
        } else {
          const baseRate = user.customVolumePricePerGb || state.customVolumePricePerGb || 3000;
          const discount = getSellerDiscountForProduct(user);
          ratePerGb = discount > 0 ? Math.max(1, Math.round(baseRate * (1 - discount / 100))) : baseRate;
        }
      }

      const rawUsedGb = usedBytes / ONE_GB_BYTES;
      const usedGb = Number(rawUsedGb.toFixed(2));
      const isUnderOneGb = usedBytes < ONE_GB_BYTES;

      const billedCost = isUnderOneGb ? 0 : Math.min(originalPrice > 0 ? originalPrice : Infinity, Math.round(rawUsedGb * ratePerGb));
      const refundAmount = isUnderOneGb ? originalPrice : Math.max(0, originalPrice - billedCost);

      res.json({
        success: true,
        usedBytes,
        usedGb,
        isUnderOneGb,
        originalPrice,
        ratePerGb,
        billedCost,
        refundAmount
      });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message || 'خطا در پیش‌نمایش ابطال' });
    }
  });

  api.delete("/seller-portal/purchases/:chatId/:purchaseId", async (req, res) => {
    try {
      const chatId = parseInt(req.params.chatId);
      const purchaseId = req.params.purchaseId;
      const result = await cancelSellerPurchase(chatId, purchaseId);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message || 'خطا در توقف و ابطال کانفیگ' });
    }
  });

  api.post("/seller-portal/purchases/:chatId/:purchaseId/cancel", async (req, res) => {
    try {
      const chatId = parseInt(req.params.chatId);
      const purchaseId = req.params.purchaseId;
      const result = await cancelSellerPurchase(chatId, purchaseId);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message || 'خطا در توقف و ابطال کانفیگ' });
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
      const cleanCustom = String(customName || `test_${Date.now().toString().slice(-4)}`).trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');

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
        panel4SubUrl: clientResult.panel4SubUrl,
        panel4Details: clientResult.panel4Details,
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

  api.post("/seller-portal/regenerate-api-key/:chatId", (req, res) => {
    const chatId = parseInt(req.params.chatId);
    const user = db.getUser(chatId);
    if (!user || !user.isSeller) {
      return res.status(404).json({ success: false, message: 'همکار پیدا نشد.' });
    }
    user.apiKey = generateSellerApiKey(user.chatId);
    user.apiEnabled = true;
    db.saveUser(user);
    res.json({ success: true, apiKey: user.apiKey, apiEnabled: user.apiEnabled });
  });

  // ============================================================================
  // WHITE-LABEL RESELLER TELEGRAM BOT ENDPOINTS (مدیریت ربات اختصاصی همکار)
  // ============================================================================

  api.get("/seller-portal/bot-config/:chatId", (req, res) => {
    try {
      const chatId = parseInt(req.params.chatId);
      const user = db.getUser(chatId);
      if (!user || !user.isSeller) {
        return res.status(404).json({ success: false, message: 'حساب همکار معتبر نیست.' });
      }

      const status = resellerBotManager.getBotStatus(chatId);
      const state = db.getState();
      const products = (state.products || []).filter(p => !p.disabled).map(p => {
        const wholesalePrice = Math.max(0, Math.round(p.price * (1 - getSellerDiscountForProduct(user, p) / 100)));
        const retailPrice = user.sellerBot?.customRetailPrices?.[p.id] !== undefined
          ? user.sellerBot.customRetailPrices[p.id]
          : (user.customDisplayPrices?.[p.id] !== undefined ? user.customDisplayPrices[p.id] : p.price);
        return {
          id: p.id,
          name: p.name,
          volumeGb: p.volumeGb,
          durationDays: p.durationDays,
          wholesalePrice,
          retailPrice,
          profit: Math.max(0, retailPrice - wholesalePrice)
        };
      });

      const wholesaleVolGbPrice = Math.max(0, Math.round((user.customVolumePricePerGb || state.customVolumePricePerGb || 3000) * (1 - (user.sellerDiscount || 0) / 100)));
      const retailVolGbPrice = user.sellerBot?.customVolumeRetailPricePerGb !== undefined
        ? user.sellerBot.customVolumeRetailPricePerGb
        : Math.round(wholesaleVolGbPrice * 1.3);

      res.json({
        success: true,
        sellerBot: user.sellerBot || {
          enabled: false,
          botToken: '',
          botName: user.name || user.username || `فروشگاه ${chatId}`,
          adminChatId: chatId,
          welcomeMessage: '',
          supportUsername: user.username || '',
          cardNumber: '',
          cardHolder: '',
          autoDeliverAfterPayment: false,
          freeTestEnabled: true
        },
        status,
        products,
        customVolume: {
          wholesalePricePerGb: wholesaleVolGbPrice,
          retailPricePerGb: retailVolGbPrice,
          profitPerGb: Math.max(0, retailVolGbPrice - wholesaleVolGbPrice)
        }
      });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  api.post("/seller-portal/bot-config/:chatId", async (req, res) => {
    try {
      const chatId = parseInt(req.params.chatId);
      const user = db.getUser(chatId);
      if (!user || !user.isSeller) {
        return res.status(404).json({ success: false, message: 'حساب همکار معتبر نیست.' });
      }

      const {
        enabled,
        botToken,
        botName,
        adminChatId,
        logoUrl,
        welcomeMessage,
        supportUsername,
        channelUsername,
        cardNumber,
        cardHolder,
        autoDeliverAfterPayment,
        customRetailPrices,
        customVolumeRetailPricePerGb,
        freeTestEnabled,
        freeTestVolumeGb,
        freeTestDurationDays
      } = req.body;

      const currentBot = user.sellerBot || ({} as any);

      user.sellerBot = {
        ...currentBot,
        enabled: enabled !== undefined ? !!enabled : !!currentBot.enabled,
        botToken: botToken !== undefined ? String(botToken).trim() : (currentBot.botToken || ''),
        botName: botName !== undefined ? String(botName).trim() : (currentBot.botName || 'فروشگاه اختصاصی'),
        adminChatId: adminChatId !== undefined ? (String(adminChatId).trim() ? (isNaN(Number(adminChatId)) ? String(adminChatId).trim() : Number(adminChatId)) : user.chatId) : (currentBot.adminChatId || user.chatId),
        logoUrl: logoUrl !== undefined ? String(logoUrl).trim() : currentBot.logoUrl,
        welcomeMessage: welcomeMessage !== undefined ? String(welcomeMessage) : currentBot.welcomeMessage,
        supportUsername: supportUsername !== undefined ? String(supportUsername).trim() : currentBot.supportUsername,
        channelUsername: channelUsername !== undefined ? String(channelUsername).trim() : currentBot.channelUsername,
        cardNumber: cardNumber !== undefined ? String(cardNumber).trim() : currentBot.cardNumber,
        cardHolder: cardHolder !== undefined ? String(cardHolder).trim() : currentBot.cardHolder,
        autoDeliverAfterPayment: autoDeliverAfterPayment !== undefined ? !!autoDeliverAfterPayment : !!currentBot.autoDeliverAfterPayment,
        customRetailPrices: customRetailPrices || currentBot.customRetailPrices || {},
        customVolumeRetailPricePerGb: customVolumeRetailPricePerGb !== undefined ? Number(customVolumeRetailPricePerGb) : currentBot.customVolumeRetailPricePerGb,
        freeTestEnabled: freeTestEnabled !== undefined ? !!freeTestEnabled : currentBot.freeTestEnabled !== false,
        freeTestVolumeGb: freeTestVolumeGb ? Number(freeTestVolumeGb) : currentBot.freeTestVolumeGb,
        freeTestDurationDays: freeTestDurationDays ? Number(freeTestDurationDays) : currentBot.freeTestDurationDays,
        orders: currentBot.orders || [],
        buyers: currentBot.buyers || [],
        totalRevenueToman: currentBot.totalRevenueToman || 0,
        totalWholesaleCostToman: currentBot.totalWholesaleCostToman || 0,
        totalProfitToman: currentBot.totalProfitToman || 0
      };

      db.saveUser(user);

      let botStartResult: any = { success: true, message: 'تنظیمات ذخیره شد.' };
      if (user.sellerBot.enabled && user.sellerBot.botToken) {
        botStartResult = await resellerBotManager.startResellerBot(chatId);
      } else {
        await resellerBotManager.stopResellerBot(chatId);
      }

      const status = resellerBotManager.getBotStatus(chatId);
      res.json({
        success: true,
        message: botStartResult.message || 'تنظیمات ربات اختصاصی با موفقیت ذخیره شد.',
        botUsername: user.sellerBot.botUsername,
        status,
        sellerBot: user.sellerBot
      });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message || 'خطا در ذخیره تنظیمات ربات' });
    }
  });

  api.post("/seller-portal/bot-order-action/:chatId", async (req, res) => {
    try {
      const chatId = parseInt(req.params.chatId);
      const { orderId, action, reason } = req.body;
      if (!orderId || !action) {
        return res.status(400).json({ success: false, message: 'شناسه سفارش و نوع عملیات الزامی است.' });
      }

      if (action === 'approve') {
        const result = await resellerBotManager.fulfillResellerOrder(chatId, orderId);
        return res.json(result);
      } else if (action === 'reject') {
        const result = await resellerBotManager.rejectResellerOrder(chatId, orderId, reason);
        return res.json(result);
      } else {
        return res.status(400).json({ success: false, message: 'عملیات نامعتبر است.' });
      }
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // ============================================================================
  // EXTERNAL RESELLER / PROVIDER BOT API (وب‌سرویس ارائه‌دهنده همکار برای اتصال ربات فروشگاهی)
  // Supports:
  //   - /api/v1/reseller/*  and  /api/provider/*
  //   - /api/v1/reseller/key/:apiKey/*  and  /api/provider/key/:apiKey/*
  //   - Single-endpoint action queries (?action=products, ?action=buy, ?action=balance, etc.)
  //   - Returns ALL products in a SINGLE request with full details:
  //     price (قیمت), description (توضیحات), name (نام محصول), category / category_name (نام دسته‌بندی)
  // ============================================================================

  const extractResellerApiKey = (req: express.Request): string => {
    // 1. Route params
    const paramKey = (req.params as any)?.apiKey || (req.params as any)?.key || (req.params as any)?.token;
    if (paramKey) return String(paramKey).trim().replace(/^['"]|['"]$/g, '');

    // 2. Custom & standard headers (case-insensitive in Express, but check common aliases)
    const headers = req.headers || {};
    const headerCandidates = [
      headers['x-api-key'],
      headers['apikey'],
      headers['api-key'],
      headers['token'],
      headers['Token' as any],
      headers['x-token'],
      headers['auth-token'],
      headers['api_token'],
      headers['api_key'],
      headers['key'],
      headers['secret'],
      headers['auth'],
      headers['reseller_token'],
      headers['reseller-token'],
      headers['reseller_key'],
      headers['reseller-key']
    ];
    for (const h of headerCandidates) {
      if (h && typeof h === 'string' && h.trim()) {
        return h.trim().replace(/^['"]|['"]$/g, '');
      }
    }

    // 3. Authorization header variations
    const authHeader = headers['authorization'];
    if (authHeader && typeof authHeader === 'string') {
      const trimmed = authHeader.trim();
      const lower = trimmed.toLowerCase();
      if (lower.startsWith('bearer ')) {
        return trimmed.slice(7).trim().replace(/^['"]|['"]$/g, '');
      }
      if (lower.startsWith('apikey ') || lower.startsWith('api-key ')) {
        return trimmed.slice(lower.indexOf(' ') + 1).trim().replace(/^['"]|['"]$/g, '');
      }
      if (lower.startsWith('token ')) {
        return trimmed.slice(6).trim().replace(/^['"]|['"]$/g, '');
      }
      if (!lower.startsWith('basic ')) {
        return trimmed.replace(/^['"]|['"]$/g, '');
      }
    }

    // 4. Query params
    const q = (req.query || {}) as any;
    const queryCandidate =
      q?.apiKey || q?.api_key || q?.key || q?.token || q?.apiToken || q?.api_token ||
      q?.code || q?.auth || q?.secret || q?.password;
    if (queryCandidate) return String(queryCandidate).trim().replace(/^['"]|['"]$/g, '');

    // 5. Body params (JSON or urlencoded)
    const b = (req.body || {}) as any;
    const bodyCandidate =
      b?.apiKey || b?.api_key || b?.key || b?.token || b?.apiToken || b?.api_token ||
      b?.code || b?.auth || b?.secret || b?.password || b?.api;
    if (bodyCandidate) return String(bodyCandidate).trim().replace(/^['"]|['"]$/g, '');

    return '';
  };

  const authenticateSellerApi = (req: express.Request, res: express.Response) => {
    const apiKey = extractResellerApiKey(req);
    if (!apiKey) {
      res.status(401).json({
        success: false,
        status: false,
        error: 'MISSING_API_KEY',
        message: 'کلید وب‌سرویس (API Key) ارسال نشده است. آن را در هدر x-api-key یا پارامتر ?key=YOUR_KEY ارسال نمایید.'
      });
      return null;
    }

    const state = db.getState();
    // Ensure all sellers have an apiKey initialized before lookup
    for (const u of state.users || []) {
      if (u.isSeller && !u.apiKey) {
        ensureSellerApiKey(u, true);
      }
    }

    let seller = (state.users || []).find(
      (u) => u.isSeller && u.apiKey && u.apiKey.trim() === apiKey.trim()
    );

    // Smart Fallback: If not matched directly by exact string, check if apiKey contains the seller's chatId
    if (!seller && apiKey.startsWith('sk_seller_')) {
      const parts = apiKey.split('_');
      const chatIdNum = parseInt(parts[2]);
      if (!isNaN(chatIdNum)) {
        const candidate = (state.users || []).find((u) => u.chatId === chatIdNum && u.isSeller);
        if (candidate) {
          console.log(`[Seller API] Matched seller ${chatIdNum} via chatId in key format, syncing apiKey...`);
          candidate.apiKey = apiKey.trim();
          candidate.apiEnabled = true;
          db.saveUser(candidate);
          seller = candidate;
        }
      }
    }

    if (!seller) {
      res.status(401).json({
        success: false,
        status: false,
        error: 'INVALID_API_KEY',
        message: 'کلید وب‌سرویس (API Key) نامعتبر است یا حساب همکار یافت نشد.'
      });
      return null;
    }

    if (seller.apiEnabled === false) {
      res.status(403).json({
        success: false,
        status: false,
        error: 'API_DISABLED',
        message: 'دسترسی وب‌سرویس (API) برای این حساب همکار توسط مدیریت غیرفعال شده است.'
      });
      return null;
    }

    return seller;
  };

  const buildProviderProductsPayload = (seller: any) => {
    const state = db.getState();
    const categories = (state.categories || []).filter((c: any) => !c.disabled && c.enabled !== false);
    const categoryMap = new Map<string, string>();
    categories.forEach((c: any) => {
      categoryMap.set(String(c.id), c.name || 'عمومی');
    });
    const activeCategoryIds = new Set(categories.map((c: any) => String(c.id)));

    const products = (state.products || [])
      .filter((p: any) => {
        if (!p || p.disabled === true || p.enabled === false) return false;
        if (p.categoryId && !activeCategoryIds.has(String(p.categoryId))) return false;
        const isReady = !!p.isPayAsYouGo || (Number(p.volumeGb || 0) > 0 && Number(p.durationDays || 0) > 0) || Number(p.price || 0) > 0;
        return isReady;
      })
      .map((p: any) => {
        const isPAYG = !!p.isPayAsYouGo;
        const sellerDiscount = getSellerDiscountForProduct(seller, p);
        let wholesalePrice = isPAYG ? 0 : Number(p.price || 0);
        if (sellerDiscount > 0 && !isPAYG) {
          wholesalePrice = Math.max(0, Math.round(wholesalePrice * (1 - sellerDiscount / 100)));
        }

        const categoryName = p.categoryId ? (categoryMap.get(String(p.categoryId)) || 'سرویس اختصاصی') : 'سرویس اختصاصی';
        const volumeGb = Number(p.volumeGb || 0);
        const durationDays = Number(p.durationDays || 0);
        const panelLabel =
          p.panelType === 'mrocean' ? 'سرور مستر اوشن (Mr Ocean)' :
          p.panelType === 'rebecca' ? 'سرور ربکا (Rebecca)' :
          p.panelType === 'panel4' ? 'سرور پنل ۴' :
          p.panelType === 'multi' ? 'مولتی سرور (ترکیبی)' :
          'سرور اختصاصی سنایی (X-UI)';

        const autoDescription = isPAYG
          ? `اشتراک پس‌پرداخت (PAYG) | دسته: ${categoryName} | محاسبه مصرفی | ${panelLabel}`
          : `حجم: ${volumeGb} گیگابایت | مدت اعتبار: ${durationDays} روز | دسته‌بندی: ${categoryName} | قیمت همکار: ${wholesalePrice.toLocaleString()} تومان | ${panelLabel}`;
        const finalDescription = p.description ? String(p.description) : autoDescription;

        return {
          // Standard & Multi-Bot Provider aliases so any Telegram shop bot recognizes all 4 mandatory fields:
          // 1. Product ID
          id: p.id,
          product_id: p.id,
          service: p.id,
          code: p.id,
          // 2. Product Name (نام محصول)
          name: p.name,
          title: p.name,
          product_name: p.name,
          productName: p.name,
          'نام محصول': p.name,
          'نام_محصول': p.name,
          'نام': p.name,
          // 3. Category Name (نام دسته‌بندی)
          category: categoryName,
          category_name: categoryName,
          categoryName: categoryName,
          category_title: categoryName,
          categoryId: p.categoryId || 'default',
          category_id: p.categoryId || 'default',
          'نام دسته بندی': categoryName,
          'نام دسته‌بندی': categoryName,
          'نام_دسته_بندی': categoryName,
          'دسته بندی': categoryName,
          'دسته‌بندی': categoryName,
          'دسته': categoryName,
          // 4. Price (قیمت)
          price: wholesalePrice,
          rate: wholesalePrice,
          amount: wholesalePrice,
          cost: wholesalePrice,
          fee: wholesalePrice,
          wholesale_price: wholesalePrice,
          original_price: Number(p.price || 0),
          discount_percent: sellerDiscount,
          'قیمت': wholesalePrice,
          'قیمت همکار': wholesalePrice,
          'قیمت_همکار': wholesalePrice,
          // 5. Description (توضیحات)
          description: finalDescription,
          desc: finalDescription,
          details: finalDescription,
          info: finalDescription,
          'توضیحات': finalDescription,
          'توضیح': finalDescription,
          // 6. Technical Specs
          volume: volumeGb,
          volume_gb: volumeGb,
          volumeGb: volumeGb,
          traffic: volumeGb,
          duration: durationDays,
          duration_days: durationDays,
          durationDays: durationDays,
          days: durationDays,
          isPayAsYouGo: isPAYG,
          panelType: p.panelType || 'sanaei',
          panel_type: p.panelType || 'sanaei',
          status: 'active',
          available: true
        };
      });

    const isUnlimited = isSellerUnlimitedLimit(seller);
    const currentDebt = seller.debt || 0;
    const debtLimit = seller.debtLimit || 0;
    const remainingCredit = isUnlimited ? 999999999 : Math.max(0, debtLimit - currentDebt);

    const customVolBasePrice = seller.customVolumePricePerGb || state.customVolumePricePerGb || 3000;
    const customVolDiscount = seller.sellerDiscount || 0;
    const customVolFinalPrice = Math.max(0, Math.round(customVolBasePrice * (1 - customVolDiscount / 100)));

    return {
      seller: {
        chatId: seller.chatId,
        name: seller.name || seller.username || `همکار ${seller.chatId}`,
        username: seller.username || '',
        debt: currentDebt,
        debtLimit: debtLimit,
        isUnlimitedLimit: isUnlimited,
        remainingCredit: remainingCredit,
        balance: remainingCredit, // Alias for bots that check provider "balance"
        currency: 'IRT'
      },
      categories: categories.map((c: any) => ({
        id: c.id,
        category_id: c.id,
        name: c.name,
        category_name: c.name,
        title: c.name
      })),
      products,
      customVolume: {
        enabled: state.customVolumeEnabled !== false,
        pricePerGb: customVolFinalPrice,
        basePricePerGb: customVolBasePrice,
        discountPercent: customVolDiscount,
        minGb: state.customVolumeMinGb || 1,
        defaultDays: state.customVolumeDefaultDays || 30,
        defaultPanel: state.customVolumePanelType || 'mrocean'
      }
    };
  };

  const handleProviderCategoriesRequest = (req: express.Request, res: express.Response) => {
    const seller = authenticateSellerApi(req, res);
    if (!seller) return;

    const payload = buildProviderProductsPayload(seller);
    const format = String(req.query.format || '').toLowerCase();
    if (format === 'array' || format === 'list') {
      return res.json(payload.categories);
    }

    return res.json({
      success: true,
      status: true,
      ok: true,
      code: 200,
      count: payload.categories.length,
      categories: payload.categories,
      data: payload.categories,
      result: payload.categories,
      list: payload.categories,
      items: payload.categories
    });
  };

  const handleProviderProductsRequest = (req: express.Request, res: express.Response) => {
    const params = { ...(req.query || {}), ...(req.body || {}) } as any;
    const action = String(params.action || params.method || params.type || '').toLowerCase().trim();
    if (
      action === 'buy' || action === 'purchase' || action === 'order' || action === 'create' || action === 'new' ||
      (req.method === 'POST' && (
        params.productId || params.product_id || params.product ||
        params.planId || params.plan_id || params.plan ||
        params.serviceId || params.service_id || params.service ||
        params.tariffId || params.tariff_id || params.tariff ||
        params.packageId || params.package_id || params.package ||
        params.itemId || params.item_id || params.item ||
        params.volumeGb || params.volume_gb || params.volume
      ))
    ) {
      return handleProviderPurchaseRequest(req, res);
    }

    const seller = authenticateSellerApi(req, res);
    if (!seller) return;

    const payload = buildProviderProductsPayload(seller);
    let filteredProducts = payload.products;
    const catFilter = String(
      req.query.category_id || req.query.categoryId || req.query.category || req.query.cat || (req.params as any)?.categoryId || ''
    ).trim();

    if (catFilter && catFilter !== 'all') {
      filteredProducts = payload.products.filter((p: any) => 
        String(p.categoryId) === catFilter ||
        String(p.category_id) === catFilter ||
        String(p.category).toLowerCase() === catFilter.toLowerCase() ||
        String(p.category_name).toLowerCase() === catFilter.toLowerCase()
      );
    }

    const format = String(req.query.format || '').toLowerCase();
    if (format === 'array' || format === 'list' || req.path.endsWith('/products-list')) {
      return res.json(filteredProducts);
    }

    return res.json({
      success: true,
      status: true,
      ok: true,
      code: 200,
      message: 'لیست کامل محصولات با جزئیات (قیمت، توضیحات، نام محصول، نام دسته‌بندی)',
      count: filteredProducts.length,
      seller: payload.seller,
      categories: payload.categories,
      products: filteredProducts,
      data: filteredProducts,
      result: filteredProducts,
      services: filteredProducts,
      plans: filteredProducts,
      items: filteredProducts,
      list: filteredProducts,
      customVolume: payload.customVolume
    });
  };

  const handleProviderMeRequest = (req: express.Request, res: express.Response) => {
    const seller = authenticateSellerApi(req, res);
    if (!seller) return;

    const payload = buildProviderProductsPayload(seller);
    return res.json({
      success: true,
      status: true,
      ok: true,
      code: 200,
      seller: payload.seller,
      balance: payload.seller.remainingCredit,
      debt: payload.seller.debt,
      debtLimit: payload.seller.debtLimit,
      remainingCredit: payload.seller.remainingCredit,
      isUnlimitedLimit: payload.seller.isUnlimitedLimit,
      currency: 'IRT'
    });
  };

  const handleProviderPurchaseRequest = async (req: express.Request, res: express.Response) => {
    try {
      const seller = authenticateSellerApi(req, res);
      if (!seller) return;

      const params = { ...(req.query || {}), ...(req.body || {}) } as any;
      const productId =
        params.productId || params.product_id || params.product ||
        params.planId || params.plan_id || params.plan ||
        params.serviceId || params.service_id || params.service ||
        params.tariffId || params.tariff_id || params.tariff ||
        params.packageId || params.package_id || params.package ||
        params.itemId || params.item_id || params.item ||
        params.id || params.code || params.name || params.title;

      const volumeGb = params.volumeGb || params.volume_gb || params.volume || params.traffic;
      const durationDays = params.durationDays || params.duration_days || params.duration || params.days || 30;
      const panelType = params.panelType || params.panel_type || params.panel;
      const customName =
        params.customName || params.custom_name || params.username || params.user ||
        params.name || params.remark || params.client_name || params.client ||
        params.customer || params.buyer || params.chat_id || params.chatId;

      let purchase: any;
      if (productId) {
        purchase = await executeSellerPortalPurchase(
          seller.chatId,
          String(productId),
          customName ? String(customName) : undefined,
          'api'
        );
      } else if (volumeGb !== undefined && Number(volumeGb) > 0) {
        purchase = await executeSellerCustomVolumePurchase({
          sellerChatId: seller.chatId,
          volumeGb: Number(volumeGb),
          durationDays: Number(durationDays) || 30,
          panelType: panelType ? (String(panelType) as any) : undefined,
          customName: customName ? String(customName) : undefined,
          source: 'api'
        });
      } else {
        return res.status(400).json({
          success: false,
          status: false,
          error: 'MISSING_PRODUCT_OR_VOLUME',
          message: 'ارسال شناسه محصول (productId / service / plan_id) یا حجم دلخواه (volumeGb) الزامی است.'
        });
      }

      const updatedSeller = db.getUser(seller.chatId) || seller;
      const isUnlimited = isSellerUnlimitedLimit(updatedSeller);
      const currentDebt = updatedSeller.debt || 0;
      const debtLimit = updatedSeller.debtLimit || 0;
      const remainingCredit = isUnlimited ? 999999999 : Math.max(0, debtLimit - currentDebt);
      const configLink = purchase.subUrl || purchase.panel4SubUrl || purchase.mroceanSubUrl || purchase.sanaeiSubUrl || purchase.rebeccaSubUrl || (Array.isArray(purchase.links) ? purchase.links[0] : '') || '';
      const clientUsername = purchase.email || purchase.username || purchase.id || purchase.clientEmail || purchase.customName || 'client';

      return res.json({
        success: true,
        status: true,
        ok: true,
        code: 200,
        msg: 'success',
        message: 'سرویس با موفقیت صادر شد و هزینه آن به حساب بدهی همکار منظور گردید.',
        // Top-level aliases for maximum compatibility with all Telegram shop bots
        order_id: purchase.id,
        orderId: purchase.id,
        id: purchase.id,
        client_name: clientUsername,
        username: clientUsername,
        user: clientUsername,
        client: clientUsername,
        config: configLink,
        link: configLink,
        url: configLink,
        sub_url: configLink,
        subUrl: configLink,
        subscription_url: configLink,
        subscriptionUrl: configLink,
        subscription: configLink,
        configs: configLink ? [configLink] : [],
        links: configLink ? [configLink] : [],
        token: purchase.subId || purchase.id,
        sub_id: purchase.subId || purchase.id,
        subId: purchase.subId || purchase.id,
        vless_link: purchase.vlessLink || configLink,
        price: purchase.price || 0,
        volume_gb: purchase.volumeGb || 0,
        duration_days: purchase.durationDays || 0,
        expires_at: purchase.expiresAt || null,
        data: {
          id: purchase.id,
          order_id: purchase.id,
          username: clientUsername,
          user: clientUsername,
          config: configLink,
          link: configLink,
          url: configLink,
          subUrl: configLink,
          sub_url: configLink,
          subscription_url: configLink,
          token: purchase.subId || purchase.id,
          price: purchase.price || 0,
          volumeGb: purchase.volumeGb,
          volume_gb: purchase.volumeGb,
          durationDays: purchase.durationDays,
          duration_days: purchase.durationDays,
          expiresAt: purchase.expiresAt
        },
        result: {
          id: purchase.id,
          order_id: purchase.id,
          username: clientUsername,
          config: configLink,
          link: configLink,
          url: configLink,
          sub_url: configLink,
          subUrl: configLink,
          subscription_url: configLink,
          token: purchase.subId || purchase.id,
          price: purchase.price || 0
        },
        purchase: {
          id: purchase.id,
          productId: purchase.productId,
          productName: purchase.productName,
          clientName: clientUsername,
          uuid: purchase.uuid,
          subUrl: configLink,
          vlessLink: purchase.vlessLink || configLink,
          links: purchase.links || (configLink ? [configLink] : []),
          volumeGb: purchase.volumeGb,
          durationDays: purchase.durationDays,
          priceChargedToSeller: purchase.price || 0,
          purchasedAt: purchase.purchasedAt,
          expiresAt: purchase.expiresAt,
          panelType: purchase.panelType
        },
        sellerFinancials: {
          chatId: updatedSeller.chatId,
          chargedAmount: purchase.price || 0,
          newDebt: currentDebt,
          debtLimit: debtLimit,
          isUnlimitedLimit: isUnlimited,
          remainingCredit: remainingCredit,
          totalSales: updatedSeller.totalSales || 0
        }
      });
    } catch (e: any) {
      return res.status(400).json({
        success: false,
        status: false,
        error: 'PURCHASE_FAILED',
        message: e.message || 'خطا در صدور سرویس از طریق وب‌سرویس همکار'
      });
    }
  };

  const handleProviderCancelRequest = async (req: express.Request, res: express.Response) => {
    try {
      const seller = authenticateSellerApi(req, res);
      if (!seller) return;

      const params = { ...(req.query || {}), ...(req.body || {}) } as any;
      const purchaseId = params.purchaseId || params.purchase_id || params.orderId || params.order_id || params.id || params.email || params.username;
      if (!purchaseId) {
        return res.status(400).json({
          success: false,
          status: false,
          message: 'ارسال شناسه خرید (purchaseId / order_id) یا نام کاربری کانفیگ (username) الزامی است.'
        });
      }

      // Support finding by either purchase.id or purchase.email (client username)
      let targetPurchaseId = String(purchaseId).trim();
      const matched = (seller.purchases || []).find(
        (p: any) => !p.isDeleted && (p.id === targetPurchaseId || p.email === targetPurchaseId)
      );
      if (matched) {
        targetPurchaseId = matched.id;
      }

      const result = await cancelSellerPurchase(seller.chatId, targetPurchaseId);
      const updatedSeller = db.getUser(seller.chatId) || seller;

      return res.json({
        success: true,
        status: true,
        ok: true,
        ...result,
        sellerFinancials: {
          chatId: updatedSeller.chatId,
          newDebt: updatedSeller.debt || 0,
          debtLimit: updatedSeller.debtLimit || 0,
          totalSales: updatedSeller.totalSales || 0
        }
      });
    } catch (e: any) {
      return res.status(400).json({
        success: false,
        status: false,
        message: e.message || 'خطا در ابطال و توقف کانفیگ'
      });
    }
  };

  const handleProviderStatusRequest = async (req: express.Request, res: express.Response) => {
    try {
      const seller = authenticateSellerApi(req, res);
      if (!seller) return;

      const params = { ...(req.query || {}), ...(req.body || {}), ...(req.params || {}) } as any;
      const targetId = params.purchaseId || params.purchase_id || params.orderId || params.order_id || params.id || params.username || params.email;
      if (!targetId) {
        return res.status(400).json({
          success: false,
          status: false,
          message: 'ارسال شناسه سفارش (purchaseId) یا نام کانفیگ (username) الزامی است.'
        });
      }

      const purchase = (seller.purchases || []).find(
        (p: any) => !p.isDeleted && (p.id === String(targetId).trim() || p.email === String(targetId).trim())
      );

      if (!purchase) {
        return res.status(404).json({
          success: false,
          status: false,
          message: 'کانفیگ مورد نظر در لیست خریدهای این همکار یافت نشد.'
        });
      }

      const liveBytes = await getPurchaseLiveUsedBytes(purchase);
      const usedBytes = liveBytes !== null ? liveBytes : Number(purchase.lastUsedBytes || 0);
      const usedGb = Number((usedBytes / (1024 * 1024 * 1024)).toFixed(3));

      const pAny = purchase as any;
      return res.json({
        success: true,
        status: true,
        ok: true,
        config: {
          id: pAny.id,
          username: pAny.email || pAny.customName || pAny.username || '',
          productName: pAny.productName || pAny.name || '',
          volumeGb: pAny.volumeGb,
          usedGb,
          usedBytes,
          remainingGb: Math.max(0, Number(((pAny.volumeGb || 0) - usedGb).toFixed(3))),
          durationDays: pAny.durationDays,
          purchasedAt: pAny.purchasedAt || pAny.date || '',
          expiresAt: pAny.expiresAt || pAny.expiredAt || '',
          isCanceledBySeller: !!pAny.isCanceledBySeller,
          disabled: !!pAny.disabled,
          subUrl: pAny.subUrl || '',
          price: pAny.price || 0
        }
      });
    } catch (e: any) {
      return res.status(500).json({
        success: false,
        status: false,
        message: e.message || 'خطا در استعلام وضعیت کانفیگ'
      });
    }
  };

  // Dispatcher for root /api/v1/reseller, /api/provider, /provider, /products, etc.
  const handleProviderRootDispatch = async (req: express.Request, res: express.Response) => {
    const params = { ...(req.query || {}), ...(req.body || {}) } as any;
    const action = String(params.action || params.method || params.type || '').toLowerCase().trim();

    console.log(`[Provider API Request] ${req.method} ${req.originalUrl} | action=${action || 'none'}`);

    if (
      action === 'buy' || action === 'purchase' || action === 'order' || action === 'create' || action === 'new' ||
      action === 'add' || action === 'add_user' || action === 'add_client' || action === 'get_config' ||
      (req.method === 'POST' && (
        params.productId || params.product_id || params.product ||
        params.planId || params.plan_id || params.plan ||
        params.serviceId || params.service_id || params.service ||
        params.tariffId || params.tariff_id || params.tariff ||
        params.packageId || params.package_id || params.package ||
        params.itemId || params.item_id || params.item ||
        params.volumeGb || params.volume_gb || params.volume
      ))
    ) {
      return handleProviderPurchaseRequest(req, res);
    }
    if (action === 'categories' || action === 'get_categories' || action === 'cats' || action === 'category') {
      return handleProviderCategoriesRequest(req, res);
    }
    if (action === 'me' || action === 'balance' || action === 'profile' || action === 'credit' || action === 'info') {
      return handleProviderMeRequest(req, res);
    }
    if (action === 'cancel' || action === 'stop' || action === 'revoke' || action === 'delete') {
      return handleProviderCancelRequest(req, res);
    }
    if (action === 'status' || action === 'check' || action === 'config') {
      return handleProviderStatusRequest(req, res);
    }
    // Default behavior (especially for provider validation in Telegram shop bots): return all products with full details in one request!
    return handleProviderProductsRequest(req, res);
  };

  // Register routes under all standard provider aliases: /provider, /reseller, /v1/reseller, /v1, and root
  const providerPrefixes = [
    '/v1/reseller', 
    '/provider', 
    '/reseller',
    '/v1',
    '',
    '/v1/reseller/key/:apiKey', 
    '/provider/key/:apiKey'
  ];
  for (const prefix of providerPrefixes) {
    api.all(`${prefix}`, handleProviderRootDispatch);
    api.all(`${prefix}/products`, handleProviderProductsRequest);
    api.all(`${prefix}/products/*`, handleProviderProductsRequest);
    api.all(`${prefix}/products-list`, handleProviderProductsRequest);
    api.all(`${prefix}/services`, handleProviderProductsRequest);
    api.all(`${prefix}/services/*`, handleProviderProductsRequest);
    api.all(`${prefix}/plans`, handleProviderProductsRequest);
    api.all(`${prefix}/packages`, handleProviderProductsRequest);
    api.all(`${prefix}/tariffs`, handleProviderProductsRequest);
    api.all(`${prefix}/categories`, handleProviderCategoriesRequest);
    api.all(`${prefix}/category`, handleProviderCategoriesRequest);
    api.all(`${prefix}/get_categories`, handleProviderCategoriesRequest);
    api.all(`${prefix}/category/:categoryId`, handleProviderProductsRequest);
    api.all(`${prefix}/categories/:categoryId`, handleProviderProductsRequest);
    api.all(`${prefix}/category/:categoryId/products`, handleProviderProductsRequest);
    api.all(`${prefix}/categories/:categoryId/products`, handleProviderProductsRequest);
    api.all(`${prefix}/me`, handleProviderMeRequest);
    api.all(`${prefix}/balance`, handleProviderMeRequest);
    api.all(`${prefix}/purchase`, handleProviderPurchaseRequest);
    api.all(`${prefix}/buy`, handleProviderPurchaseRequest);
    api.all(`${prefix}/order`, handleProviderPurchaseRequest);
    api.all(`${prefix}/create`, handleProviderPurchaseRequest);
    api.all(`${prefix}/new`, handleProviderPurchaseRequest);
    api.all(`${prefix}/add_user`, handleProviderPurchaseRequest);
    api.all(`${prefix}/add_client`, handleProviderPurchaseRequest);
    api.all(`${prefix}/create_user`, handleProviderPurchaseRequest);
    api.all(`${prefix}/create_client`, handleProviderPurchaseRequest);
    api.all(`${prefix}/get_config`, handleProviderPurchaseRequest);
    api.all(`${prefix}/cancel`, handleProviderCancelRequest);
    api.all(`${prefix}/status`, handleProviderStatusRequest);
    api.all(`${prefix}/config/:purchaseId`, handleProviderStatusRequest);
  }

  // Also mount directly on app for external bots that call without /api prefix (e.g. http://ip:port/provider or /v1/reseller)
  const rootProviderRouter = express.Router();
  const rootPrefixes = [
    '/provider', 
    '/v1/reseller', 
    '/reseller', 
    '/v1',
    '/v1/reseller/key/:apiKey',
    '/provider/key/:apiKey'
  ];
  for (const prefix of rootPrefixes) {
    rootProviderRouter.all(`${prefix}`, handleProviderRootDispatch);
    rootProviderRouter.all(`${prefix}/products`, handleProviderProductsRequest);
    rootProviderRouter.all(`${prefix}/products/*`, handleProviderProductsRequest);
    rootProviderRouter.all(`${prefix}/products-list`, handleProviderProductsRequest);
    rootProviderRouter.all(`${prefix}/services`, handleProviderProductsRequest);
    rootProviderRouter.all(`${prefix}/services/*`, handleProviderProductsRequest);
    rootProviderRouter.all(`${prefix}/plans`, handleProviderProductsRequest);
    rootProviderRouter.all(`${prefix}/packages`, handleProviderProductsRequest);
    rootProviderRouter.all(`${prefix}/tariffs`, handleProviderProductsRequest);
    rootProviderRouter.all(`${prefix}/categories`, handleProviderCategoriesRequest);
    rootProviderRouter.all(`${prefix}/category`, handleProviderCategoriesRequest);
    rootProviderRouter.all(`${prefix}/get_categories`, handleProviderCategoriesRequest);
    rootProviderRouter.all(`${prefix}/category/:categoryId`, handleProviderProductsRequest);
    rootProviderRouter.all(`${prefix}/categories/:categoryId`, handleProviderProductsRequest);
    rootProviderRouter.all(`${prefix}/category/:categoryId/products`, handleProviderProductsRequest);
    rootProviderRouter.all(`${prefix}/categories/:categoryId/products`, handleProviderProductsRequest);
    rootProviderRouter.all(`${prefix}/me`, handleProviderMeRequest);
    rootProviderRouter.all(`${prefix}/balance`, handleProviderMeRequest);
    rootProviderRouter.all(`${prefix}/purchase`, handleProviderPurchaseRequest);
    rootProviderRouter.all(`${prefix}/buy`, handleProviderPurchaseRequest);
    rootProviderRouter.all(`${prefix}/order`, handleProviderPurchaseRequest);
    rootProviderRouter.all(`${prefix}/create`, handleProviderPurchaseRequest);
    rootProviderRouter.all(`${prefix}/new`, handleProviderPurchaseRequest);
    rootProviderRouter.all(`${prefix}/add_user`, handleProviderPurchaseRequest);
    rootProviderRouter.all(`${prefix}/add_client`, handleProviderPurchaseRequest);
    rootProviderRouter.all(`${prefix}/create_user`, handleProviderPurchaseRequest);
    rootProviderRouter.all(`${prefix}/create_client`, handleProviderPurchaseRequest);
    rootProviderRouter.all(`${prefix}/get_config`, handleProviderPurchaseRequest);
    rootProviderRouter.all(`${prefix}/cancel`, handleProviderCancelRequest);
    rootProviderRouter.all(`${prefix}/status`, handleProviderStatusRequest);
    rootProviderRouter.all(`${prefix}/config/:purchaseId`, handleProviderStatusRequest);
  }
  // Standalone aliases directly at root
  rootProviderRouter.all('/products', handleProviderProductsRequest);
  rootProviderRouter.all('/products-list', handleProviderProductsRequest);
  rootProviderRouter.all('/services', handleProviderProductsRequest);
  rootProviderRouter.all('/plans', handleProviderProductsRequest);
  rootProviderRouter.all('/packages', handleProviderProductsRequest);
  rootProviderRouter.all('/categories', handleProviderCategoriesRequest);
  rootProviderRouter.all('/category', handleProviderCategoriesRequest);
  rootProviderRouter.all('/get_categories', handleProviderCategoriesRequest);
  rootProviderRouter.all('/purchase', handleProviderPurchaseRequest);
  rootProviderRouter.all('/buy', handleProviderPurchaseRequest);
  rootProviderRouter.all('/order', handleProviderPurchaseRequest);
  rootProviderRouter.all('/create', handleProviderPurchaseRequest);

  app.use('/', rootProviderRouter);
  app.use("/api", api);

  // Dynamically resolve static assets directory across all deployment environments (PM2, systemd, local, dev, etc.)
  const candidateDirs = [
    currentDir,
    path.join(currentDir, 'dist'),
    path.join(process.cwd(), 'dist'),
    path.join(currentDir, 'assets', 'prebuilt'),
    path.join(process.cwd(), 'assets', 'prebuilt'),
    process.cwd(),
    path.resolve(currentDir, '..', 'dist'),
    path.resolve(process.cwd(), '..', 'dist'),
    path.resolve(currentDir, '..', 'assets', 'prebuilt')
  ];

  let resolvedDistDir: string | null = null;
  for (const dir of candidateDirs) {
    if (fs.existsSync(path.join(dir, 'index.html')) && fs.existsSync(path.join(dir, 'assets'))) {
      resolvedDistDir = dir;
      break;
    }
  }

  if (!resolvedDistDir) {
    for (const dir of candidateDirs) {
      if (fs.existsSync(path.join(dir, 'index.html'))) {
        resolvedDistDir = dir;
        break;
      }
    }
  }

  const sendEmergencyHtml = (res: express.Response) => {
    if (res.headersSent) return;
    res.status(200).send(`<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="UTF-8">
  <title>پنل همکار | ارتباط با سرور</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: Tahoma, Arial, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 1rem; }
    .card { background: #1e293b; padding: 2rem; border-radius: 1rem; border: 1px solid #334155; max-width: 450px; width: 100%; text-align: center; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5); }
    .icon { font-size: 3rem; margin-bottom: 1rem; }
    h2 { font-size: 1.25rem; margin: 0 0 0.75rem 0; color: #60a5fa; }
    p { font-size: 0.9rem; color: #94a3b8; line-height: 1.6; margin-bottom: 1.5rem; }
    .btn { display: inline-block; background: #3b82f6; color: white; padding: 0.75rem 1.5rem; border-radius: 0.5rem; text-decoration: none; font-weight: bold; border: none; cursor: pointer; transition: background 0.2s; }
    .btn:hover { background: #2563eb; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">🔄</div>
    <h2>در حال آماده‌سازی پنل همکار...</h2>
    <p>فایل‌های برنامه در حال بارگذاری هستند. لطفاً روی دکمه زیر کلیک کرده یا صفحه را مجدداً بارگذاری فرمایید.</p>
    <button class="btn" onclick="location.reload()">بارگذاری مجدد صفحه</button>
  </div>
</body>
</html>`);
  };

  const sendSpaHtml = (req: express.Request, res: express.Response) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');

    if (resolvedDistDir) {
      const distIndex = path.join(resolvedDistDir, 'index.html');
      if (fs.existsSync(distIndex)) {
        return res.sendFile(distIndex, (err) => {
          if (err && !res.headersSent) {
            sendEmergencyHtml(res);
          }
        });
      }
    }

    const rootIndex = path.join(process.cwd(), 'index.html');
    if (fs.existsSync(rootIndex)) {
      return res.sendFile(rootIndex, (err) => {
        if (err && !res.headersSent) {
          sendEmergencyHtml(res);
        }
      });
    }

    sendEmergencyHtml(res);
  };

  // Explicit high-priority routes for Seller Portal
  app.get(['/seller', '/seller/*', '/portal', '/portal/*'], (req, res, next) => {
    if (!resolvedDistDir && process.env.NODE_ENV !== 'production') {
      return next();
    }
    return sendSpaHtml(req, res);
  });

  // Serve static files in production or when dist folder exists
  if (process.env.NODE_ENV === "production" || resolvedDistDir) {
    if (resolvedDistDir) {
      app.use(express.static(resolvedDistDir, {
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
          }
        }
      }));
    }

    app.get('*', (req, res, next) => {
      if (req.originalUrl.startsWith('/api')) {
        return next();
      }
      const hasKey = !!extractResellerApiKey(req);
      const isProviderPath = /^\/(v1|provider|reseller|products|services)/i.test(req.path);
      if (hasKey || isProviderPath) {
        return handleProviderRootDispatch(req, res);
      }
      return sendSpaHtml(req, res);
    });
  } else {
    const { createServer: createViteServer } = await import("vite");
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

    app.use('*', async (req, res, next) => {
      if (req.originalUrl.startsWith('/api')) {
        return next();
      }
      const hasKey = !!extractResellerApiKey(req);
      const isProviderPath = /^\/(v1|provider|reseller|products|services)/i.test(req.path);
      if (hasKey || isProviderPath) {
        return handleProviderRootDispatch(req, res);
      }
      try {
        const indexPath = path.resolve(process.cwd(), 'index.html');
        let template = fs.readFileSync(indexPath, 'utf-8');
        template = await vite.transformIndexHtml(req.originalUrl, template);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
      } catch (e: any) {
        vite.ssrFixStacktrace(e);
        next(e);
      }
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    resellerBotManager.initAllResellerBots().catch(console.error);
  });
}

startServer();

