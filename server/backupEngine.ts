import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { db, AppState, User, Product, PanelConfig, Coupon, Category } from './db.js';
import { initBot } from './bot.js';

export interface RestoreResponse {
  success: boolean;
  message: string;
  isPasswordRequired?: boolean;
  stats?: {
    usersCount: number;
    productsCount: number;
    categoriesCount: number;
    hasBotToken: boolean;
    hasSanaei: boolean;
    hasRebecca: boolean;
  };
}

/**
 * Decrypts AES-256-CBC payload safely
 */
function tryDecrypt(payloadObj: any, password: string): { success: boolean; data?: string; error?: string } {
  try {
    if (!password || !password.trim()) {
      return { success: false, error: 'این فایل رمزگذاری شده است و نیازمند رمز عبور می‌باشد.' };
    }
    const iv = Buffer.from(payloadObj.iv, 'hex');
    const encrypted = Buffer.from(payloadObj.encryptedData, 'hex');
    const key = crypto.createHash('sha256').update(password.trim()).digest();

    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(encrypted);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return { success: true, data: decrypted.toString('utf8') };
  } catch (e: any) {
    return { success: false, error: 'رمز عبور وارد شده نادرست است یا محتوای فایل خراب شده است.' };
  }
}

/**
 * Universal Backup Restorer and Schema Migrator
 * Accepts ANY previous backup format:
 * - Plain JSON db.json dump
 * - Legacy backup without rebeccaPanel
 * - Encrypted backup with password
 * - Backup without password
 * - Array of users
 * - Wrapped { state: ... } or { data: ... }
 */
export function restoreAnyBackup(rawContent: string, providedPassword?: string): RestoreResponse {
  try {
    if (!rawContent || typeof rawContent !== 'string') {
      return { success: false, message: 'محتوای فایل پشتیبان خالی است.' };
    }

    // 1. Strip UTF-8 BOM if present and trim
    let content = rawContent.replace(/^\uFEFF/, '').trim();
    if (!content) {
      return { success: false, message: 'محتوای فایل پشتیبان نامعتبر است.' };
    }

    let parsedInitial: any;
    try {
      parsedInitial = JSON.parse(content);
    } catch (e: any) {
      return { success: false, message: 'فایل ارسالی یک فایل JSON معتبر نمی‌باشد یا دارای خطای ساختاری است.' };
    }

    let rawDataObj: any = parsedInitial;

    // 2. Check if encrypted
    if (parsedInitial && typeof parsedInitial === 'object' && parsedInitial.type === 'sanaei_bot_secured_backup' && parsedInitial.iv && parsedInitial.encryptedData) {
      const currentState = db.getState();
      let decryptedText: string | null = null;

      // Try provided password first
      if (providedPassword && providedPassword.trim()) {
        const decResult = tryDecrypt(parsedInitial, providedPassword.trim());
        if (decResult.success && decResult.data) {
          decryptedText = decResult.data;
        } else {
          return {
            success: false,
            message: 'رمز عبور وارد شده برای این فایل پشتیبان نادرست است.'
          };
        }
      } else {
        // Automatically try system keys and configured backup password
        const autoPasswordsToTry = [
          currentState.autoBackupPassword,
          'XUI_PANEL_SECURE_BACKUP_KEY_2024',
          'XUI_PANEL_BACKUP_SECURE_KEY_2024',
          'backup_master_key'
        ].filter(Boolean) as string[];

        for (const pass of autoPasswordsToTry) {
          const res = tryDecrypt(parsedInitial, pass);
          if (res.success && res.data) {
            try {
              JSON.parse(res.data);
              decryptedText = res.data;
              break;
            } catch {}
          }
        }

        if (!decryptedText) {
          return {
            success: false,
            isPasswordRequired: true,
            message: 'این فایل پشتیبان دارای رمز عبور است. لطفاً رمز عبور فایل را وارد نمایید.'
          };
        }
      }

      try {
        rawDataObj = JSON.parse(decryptedText);
      } catch (err: any) {
        return { success: false, message: 'محتوای رمزگشایی شده فایل پشتیبان قابل تبدیل به JSON نیست.' };
      }
    }

    // 3. Normalize wrapper { state: ... } or { data: ... } or array
    let sourceData = rawDataObj;
    if (sourceData && typeof sourceData === 'object' && !Array.isArray(sourceData)) {
      if (sourceData.state && typeof sourceData.state === 'object') {
        sourceData = sourceData.state;
      } else if (sourceData.data && typeof sourceData.data === 'object') {
        sourceData = sourceData.data;
      } else if (sourceData.database && typeof sourceData.database === 'object') {
        sourceData = sourceData.database;
      }
    }

    const currentState = db.getState();

    // 4. Safely Extract & Normalize Users
    let rawUsers: any[] = [];
    if (Array.isArray(sourceData)) {
      rawUsers = sourceData;
    } else if (Array.isArray(sourceData.users)) {
      rawUsers = sourceData.users;
    } else if (Array.isArray(sourceData.clients)) {
      rawUsers = sourceData.clients;
    } else if (Array.isArray(sourceData.members)) {
      rawUsers = sourceData.members;
    } else if (Array.isArray(sourceData.accounts)) {
      rawUsers = sourceData.accounts;
    }

    const normalizedUsers: User[] = rawUsers.map((u: any) => {
      const chatId = Number(u.chatId ?? u.id ?? u.telegramId ?? u.userId ?? 0);
      return {
        chatId: isNaN(chatId) ? 0 : chatId,
        username: u.username ? String(u.username).replace(/^@/, '') : '',
        nickname: u.nickname || u.first_name || u.name || '',
        balance: Number(u.balance || 0),
        testUsed: Boolean(u.testUsed),
        registeredAt: u.registeredAt || new Date().toISOString(),
        referredBy: u.referredBy ? Number(u.referredBy) : undefined,
        referralsMade: Number(u.referralsMade || 0),
        isSeller: Boolean(u.isSeller),
        sellerDiscount: u.sellerDiscount !== undefined ? Number(u.sellerDiscount) : undefined,
        sellerDiscounts: Array.isArray(u.sellerDiscounts) ? u.sellerDiscounts : [],
        debt: Number(u.debt || 0),
        debtVolume: Number(u.debtVolume || 0),
        debtLimit: u.debtLimit !== undefined ? Number(u.debtLimit) : undefined,
        isUnlimitedLimit: Boolean(u.isUnlimitedLimit),
        totalSales: Number(u.totalSales || 0),
        totalPayments: Number(u.totalPayments || 0),
        purchases: Array.isArray(u.purchases) ? u.purchases.map((p: any) => ({
          id: p.id || uuidv4(),
          name: p.name || 'سرویس',
          price: Number(p.price || 0),
          subUrl: p.subUrl || '',
          volumeGb: Number(p.volumeGb || 0),
          durationDays: Number(p.durationDays || 30),
          createdAt: p.createdAt || new Date().toISOString(),
          panelType: p.panelType === 'rebecca' ? 'rebecca' : 'xui',
          isPayAsYouGo: Boolean(p.isPayAsYouGo),
          pricePerGb: p.pricePerGb ? Number(p.pricePerGb) : undefined,
          lastUsedBytes: Number(p.lastUsedBytes || 0),
          baseSettledBytes: Number(p.baseSettledBytes || 0),
          paygDisabled: Boolean(p.paygDisabled),
          warnedPayg: Boolean(p.warnedPayg),
          warnedData: Boolean(p.warnedData),
          warnedTime: Boolean(p.warnedTime),
          expiredAt: p.expiredAt ? Number(p.expiredAt) : undefined,
          isDeleted: Boolean(p.isDeleted)
        })) : []
      };
    }).filter(u => u.chatId !== 0);

    // 5. Safely Extract & Normalize Products
    const rawProducts: any[] = Array.isArray(sourceData.products) 
      ? sourceData.products 
      : Array.isArray(sourceData.plans) 
      ? sourceData.plans 
      : Array.isArray(sourceData.services) 
      ? sourceData.services 
      : (currentState.products || []);

    const normalizedProducts: Product[] = rawProducts.map((p: any) => {
      let inboundIds: (number | string)[] = [];
      if (Array.isArray(p.inboundIds)) {
        inboundIds = p.inboundIds;
      } else if (p.inboundId !== undefined && p.inboundId !== null && p.inboundId !== '') {
        inboundIds = [p.inboundId];
      }
      return {
        id: p.id || uuidv4(),
        name: p.name || 'محصول بدون نام',
        price: Number(p.price || 0),
        volumeGb: Number(p.volumeGb || p.volume || 0),
        durationDays: Number(p.durationDays || p.days || 30),
        categoryId: p.categoryId || '',
        inboundIds: inboundIds.map(val => isNaN(Number(val)) ? String(val).trim() : Number(val)),
        limitIp: Number(p.limitIp || 1),
        disabled: Boolean(p.disabled),
        isPayAsYouGo: Boolean(p.isPayAsYouGo),
        panelType: (p.panelType === 'rebecca' || p.panelType === 'xui') ? p.panelType : 'default'
      };
    });

    // 6. Safely Extract & Normalize Categories
    const rawCategories = Array.isArray(sourceData.categories) ? sourceData.categories : (currentState.categories || []);
    const normalizedCategories: Category[] = rawCategories.map((c: any) => ({
      id: c.id || uuidv4(),
      name: c.name || 'دسته‌بندی',
      disabled: Boolean(c.disabled)
    }));

    // 7. Safely Extract & Normalize Sanaei (X-UI) Panel
    const rawSanaei = sourceData.panel || sourceData.xui || sourceData.sanaei || {};
    let sanaeiInbounds: (number | string)[] = [];
    if (Array.isArray(rawSanaei.inboundIds)) {
      sanaeiInbounds = rawSanaei.inboundIds;
    } else if (rawSanaei.inboundId !== undefined && rawSanaei.inboundId !== null && rawSanaei.inboundId !== '') {
      sanaeiInbounds = [rawSanaei.inboundId];
    } else if (currentState.panel?.inboundIds) {
      sanaeiInbounds = currentState.panel.inboundIds;
    }

    const normalizedSanaei: PanelConfig = {
      panelType: 'xui',
      url: (rawSanaei.url !== undefined && rawSanaei.url !== '') ? rawSanaei.url : (currentState.panel?.url || ''),
      username: (rawSanaei.username !== undefined && rawSanaei.username !== '') ? rawSanaei.username : (currentState.panel?.username || ''),
      password: (rawSanaei.password !== undefined && rawSanaei.password !== '' && rawSanaei.password !== '********') ? rawSanaei.password : (currentState.panel?.password || ''),
      apiKey: rawSanaei.apiKey !== undefined ? rawSanaei.apiKey : (currentState.panel?.apiKey || ''),
      subUrlBase: rawSanaei.subUrlBase !== undefined ? rawSanaei.subUrlBase : (currentState.panel?.subUrlBase || ''),
      inboundIds: sanaeiInbounds.map(val => isNaN(Number(val)) ? String(val).trim() : Number(val))
    };

    // 8. Safely Extract & Normalize Rebecca Panel
    const rawRebecca = sourceData.rebeccaPanel || sourceData.rebecca || sourceData.rebeccaConfig || {};
    let rebeccaInbounds: (number | string)[] = [];
    if (Array.isArray(rawRebecca.inboundIds)) {
      rebeccaInbounds = rawRebecca.inboundIds;
    } else if (rawRebecca.inboundId !== undefined && rawRebecca.inboundId !== null && rawRebecca.inboundId !== '') {
      rebeccaInbounds = [rawRebecca.inboundId];
    } else if (currentState.rebeccaPanel?.inboundIds) {
      rebeccaInbounds = currentState.rebeccaPanel.inboundIds;
    }

    const normalizedRebecca: PanelConfig = {
      panelType: 'rebecca',
      url: (rawRebecca.url !== undefined && rawRebecca.url !== '') ? rawRebecca.url : (currentState.rebeccaPanel?.url || ''),
      username: (rawRebecca.username !== undefined && rawRebecca.username !== '') ? rawRebecca.username : (currentState.rebeccaPanel?.username || ''),
      password: (rawRebecca.password !== undefined && rawRebecca.password !== '' && rawRebecca.password !== '********') ? rawRebecca.password : (currentState.rebeccaPanel?.password || ''),
      apiKey: rawRebecca.apiKey !== undefined ? rawRebecca.apiKey : (currentState.rebeccaPanel?.apiKey || ''),
      subUrlBase: rawRebecca.subUrlBase !== undefined ? rawRebecca.subUrlBase : (currentState.rebeccaPanel?.subUrlBase || ''),
      inboundIds: rebeccaInbounds.map(val => isNaN(Number(val)) ? String(val).trim() : Number(val))
    };

    // 9. Active Panel Mode
    let activePanelMode: 'xui' | 'rebecca' | 'both' = 'both';
    if (sourceData.activePanelMode === 'xui' || sourceData.activePanelMode === 'rebecca' || sourceData.activePanelMode === 'both') {
      activePanelMode = sourceData.activePanelMode;
    } else if (currentState.activePanelMode) {
      activePanelMode = currentState.activePanelMode;
    } else if (normalizedSanaei.url && !normalizedRebecca.url) {
      activePanelMode = 'xui';
    } else if (!normalizedSanaei.url && normalizedRebecca.url) {
      activePanelMode = 'rebecca';
    }

    // 10. Admin IDs
    let adminIds: number[] = [];
    if (Array.isArray(sourceData.adminIds)) {
      adminIds = sourceData.adminIds.map((id: any) => Number(id)).filter((id: number) => !isNaN(id) && id > 0);
    } else if (Array.isArray(sourceData.admins)) {
      adminIds = sourceData.admins.map((id: any) => Number(id)).filter((id: number) => !isNaN(id) && id > 0);
    } else {
      adminIds = currentState.adminIds || [];
    }

    // 11. Bot Token
    const botToken = (sourceData.botToken && String(sourceData.botToken).trim() !== '') 
      ? String(sourceData.botToken).trim() 
      : (currentState.botToken || '');

    // 12. Free Test & Coupons & Finances
    const freeTestVolumeGb = Number(sourceData.freeTestVolumeGb ?? currentState.freeTestVolumeGb ?? 1);
    const freeTestDurationDays = Number(sourceData.freeTestDurationDays ?? currentState.freeTestDurationDays ?? 3);
    const freeTestEnabled = sourceData.freeTestEnabled !== undefined ? Boolean(sourceData.freeTestEnabled) : (currentState.freeTestEnabled ?? true);
    
    let freeTestInboundIds: (number | string)[] = [];
    if (Array.isArray(sourceData.freeTestInboundIds)) {
      freeTestInboundIds = sourceData.freeTestInboundIds;
    } else if (sourceData.freeTestInboundId) {
      freeTestInboundIds = [sourceData.freeTestInboundId];
    } else {
      freeTestInboundIds = currentState.freeTestInboundIds || [];
    }

    const coupons: Coupon[] = Array.isArray(sourceData.coupons) ? sourceData.coupons : (currentState.coupons || []);
    const cardNumber = sourceData.cardNumber || currentState.cardNumber || '۶۰۳۷۹۹۷۹۱۲۳۴۵۶۷۸';
    const cardHolder = sourceData.cardHolder || currentState.cardHolder || 'نام مدیر حساب';
    const supportUsername = sourceData.supportUsername !== undefined ? sourceData.supportUsername : (currentState.supportUsername || '');
    const referralRewardToman = Number(sourceData.referralRewardToman ?? currentState.referralRewardToman ?? 0);

    // 13. Assemble complete new AppState
    const newAppState: AppState = {
      botToken,
      panel: normalizedSanaei,
      rebeccaPanel: normalizedRebecca,
      activePanelMode,
      products: normalizedProducts,
      categories: normalizedCategories,
      users: normalizedUsers,
      freeTestVolumeGb,
      freeTestDurationDays,
      freeTestEnabled,
      freeTestInboundIds: freeTestInboundIds.map(val => isNaN(Number(val)) ? String(val).trim() : Number(val)),
      adminIds,
      referralRewardToman,
      cardNumber,
      cardHolder,
      supportUsername,
      coupons,
      autoBackupIntervalHours: sourceData.autoBackupIntervalHours ?? currentState.autoBackupIntervalHours,
      autoBackupPassword: sourceData.autoBackupPassword ?? currentState.autoBackupPassword,
      lastAutoBackupSent: currentState.lastAutoBackupSent || 0
    };

    // 14. Safety Snapshot Before Overwriting
    try {
      const BACKUPS_DIR = path.join(process.cwd(), 'backups');
      if (!fs.existsSync(BACKUPS_DIR)) {
        fs.mkdirSync(BACKUPS_DIR, { recursive: true });
      }
      const safetyFile = path.join(BACKUPS_DIR, `backup_safety_before_restore_${Date.now()}.json`);
      fs.writeFileSync(safetyFile, JSON.stringify(currentState, null, 2), 'utf8');
      console.log(`[Backup Engine] Pre-restore safety snapshot created: ${safetyFile}`);
    } catch (e) {
      console.warn('[Backup Engine] Failed to create safety snapshot:', e);
    }

    // 15. Commit to db.json and memory
    const dbPath = path.join(process.cwd(), 'db.json');
    fs.writeFileSync(dbPath, JSON.stringify(newAppState, null, 2), 'utf8');
    db.updateState(newAppState);

    // 16. Restart / Refresh Bot
    try {
      initBot();
    } catch (botErr) {
      console.error('[Backup Engine] Failed to reload bot after restore:', botErr);
    }

    return {
      success: true,
      message: `بازیابی با موفقیت انجام شد! (${normalizedUsers.length} کاربر، ${normalizedProducts.length} محصول و تنظیمات سیستم بازنشانی شد)`,
      stats: {
        usersCount: normalizedUsers.length,
        productsCount: normalizedProducts.length,
        categoriesCount: normalizedCategories.length,
        hasBotToken: Boolean(botToken),
        hasSanaei: Boolean(normalizedSanaei.url),
        hasRebecca: Boolean(normalizedRebecca.url)
      }
    };
  } catch (err: any) {
    console.error('[Backup Engine Error]', err);
    return {
      success: false,
      message: 'خطا در پردازش و بازیابی فایل بکاپ: ' + (err.message || 'خطای ناشناخته')
    };
  }
}
