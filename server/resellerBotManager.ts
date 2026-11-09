import TelegramBot from 'node-telegram-bot-api';
import axios from 'axios';
import QRCode from 'qrcode';
import { db, User, SellerBotConfig, SellerBotOrder, recordUserTransaction } from './db.js';
import {
  executeSellerPortalPurchase,
  executeSellerCustomVolumePurchase,
  cancelSellerPurchase,
  getSellerDiscountForProduct,
  isSellerUnlimitedLimit,
  sanitizeCustomConfigName,
  parseAmountInput,
  getBot,
  enhanceBotForSpeedAndColoredButtons,
  isValidTelegramBotToken
} from './bot.js';
import { getTehranShamsiDayRange } from './accounting.js';
import { multiPanel } from './multiPanel.js';
import { rebecca } from './rebecca.js';
import { xui } from './xui.js';

interface ActiveBotRecord {
  bot: TelegramBot;
  username: string;
  botFirstName?: string;
  sellerChatId: number;
  startedAt: number;
}

function escapeHtml(text: string): string {
  return (text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function fetchSubscriptionLiveInfo(subUrl: string): Promise<{
  upload: number;
  download: number;
  totalUsed: number;
  total: number;
  expiryTime: number;
} | null> {
  if (!subUrl || (!subUrl.startsWith('http://') && !subUrl.startsWith('https://'))) {
    return null;
  }
  try {
    const res = await axios.get(subUrl, {
      headers: { 'User-Agent': 'v2rayNG/1.8.5' },
      timeout: 2500,
      validateStatus: () => true
    });
    const userInfoHeader = res.headers['subscription-userinfo'] || res.headers['Subscription-Userinfo'];
    if (userInfoHeader && typeof userInfoHeader === 'string') {
      const parts = userInfoHeader.split(';').map(p => p.trim());
      let upload = 0;
      let download = 0;
      let total = 0;
      let expire = 0;
      for (const part of parts) {
        const [k, v] = part.split('=').map(s => (s ? s.trim().toLowerCase() : ''));
        if (k === 'upload') upload = Number(v) || 0;
        else if (k === 'download') download = Number(v) || 0;
        else if (k === 'total') total = Number(v) || 0;
        else if (k === 'expire') expire = Number(v) || 0;
      }
      const totalUsed = upload + download;
      const expiryMs = expire > 10000000000 ? expire : expire > 0 ? expire * 1000 : 0;
      return { upload, download, totalUsed, total, expiryTime: expiryMs };
    }
  } catch (err) {
    // Ignore and fallback to panel API
  }
  return null;
}

async function extractDirectConfigsFromSubUrl(subUrl: string): Promise<string[]> {
  if (!subUrl || (!subUrl.startsWith('http://') && !subUrl.startsWith('https://'))) {
    return [];
  }
  try {
    const res = await axios.get(subUrl, {
      headers: { 'User-Agent': 'v2rayNG/1.8.5' },
      timeout: 6000,
      responseType: 'text',
      validateStatus: () => true
    });
    if (!res.data || typeof res.data !== 'string') return [];
    let raw = res.data.trim();
    if (!raw.includes('://')) {
      try {
        const decoded = Buffer.from(raw, 'base64').toString('utf-8');
        if (decoded.includes('://')) raw = decoded;
      } catch (e) {}
    }
    const lines = raw
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(l => /^(vless|vmess|trojan|ss|ssr|hysteria|hysteria2|hy2|tuic|wireguard):\/\//i.test(l));
    return lines;
  } catch (e) {
    return [];
  }
}

class ResellerBotManager {
  private activeBots: Map<number, ActiveBotRecord> = new Map();
  private userSessionStates: Map<string, { action: string; data?: any }> = new Map();
  private forceJoinCache: Map<string, number> = new Map();

  public getEffectiveBotName(seller: User): string {
    const botCfg = seller.sellerBot || ({} as SellerBotConfig);
    const rec = this.activeBots.get(seller.chatId);
    const rawName = (botCfg.botName || '').trim();
    const isSellerIdentity =
      !rawName ||
      rawName === seller.username ||
      rawName === `@${seller.username}` ||
      rawName === seller.name ||
      rawName === seller.portalUsername ||
      rawName === String(seller.chatId) ||
      rawName === `Seller_${seller.chatId}` ||
      rawName === `فروشگاه ${seller.chatId}` ||
      rawName === 'فروشگاه اختصاصی';

    if (!isSellerIdentity) {
      return rawName;
    }
    if (botCfg.botFirstName && botCfg.botFirstName.trim()) {
      return botCfg.botFirstName.trim();
    }
    if (rec?.botFirstName && rec.botFirstName.trim()) {
      return rec.botFirstName.trim();
    }
    if (botCfg.botUsername && botCfg.botUsername.trim()) {
      return `@${botCfg.botUsername.replace(/^@/, '').trim()}`;
    }
    return 'ربات فروشگاهی';
  }

  /**
   * Initialize all active reseller bots from database
   */
  public async initAllResellerBots(): Promise<void> {
    console.log('[ResellerBotManager] Initializing all active reseller bots...');
    const state = db.getState();
    const sellers = (state.users || []).filter(u => {
      if (!u || !u.isSeller || !u.sellerBot || !u.sellerBot.botToken) return false;
      if (!isValidTelegramBotToken(u.sellerBot.botToken)) return false;
      // Auto-enable reseller bot if token is valid and enabled wasn't explicitly set to false
      if (u.sellerBot.enabled === undefined) {
        u.sellerBot.enabled = true;
        db.saveUser(u);
      }
      return !!u.sellerBot.enabled;
    });

    for (const seller of sellers) {
      try {
        await this.startResellerBot(seller.chatId);
      } catch (err: any) {
        console.error(`[ResellerBotManager] Failed to start bot for seller ${seller.chatId}:`, err?.message || err);
      }
    }
    console.log(`[ResellerBotManager] ${this.activeBots.size} reseller bot(s) currently online.`);
  }

  /**
   * Start or restart a specific reseller bot
   */
  public async startResellerBot(sellerChatId: number): Promise<{ success: boolean; username?: string; message: string }> {
    await this.stopResellerBot(sellerChatId);

    const user = db.getUser(sellerChatId);
    if (!user || !user.isSeller || !user.sellerBot || !user.sellerBot.enabled) {
      return { success: false, message: 'ربات اختصاصی برای این همکار فعال نشده است.' };
    }

    const token = (user.sellerBot.botToken || '').trim();
    if (!isValidTelegramBotToken(token)) {
      return { success: false, message: 'فرمت یا مقدار توکن ربات تلگرام نامعتبر است. لطفاً توکن صحیح را از @BotFather دریافت نمایید.' };
    }

    const state = db.getState();
    const mainToken = (state.botToken || process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '').trim();
    if (mainToken && token === mainToken) {
      return {
        success: false,
        message: 'این توکن متعلق به ربات مادر (اصلی) است! لطفاً در @BotFather یک ربات جدید بسازید و توکن ربات دوم را وارد نمایید.'
      };
    }

    const duplicateSeller = (state.users || []).find(
      u => u.chatId !== sellerChatId && u.isSeller && u.sellerBot?.enabled && (u.sellerBot?.botToken || '').trim() === token
    );
    if (duplicateSeller) {
      return {
        success: false,
        message: 'این توکن قبلاً برای همکار دیگری ثبت شده است. لطفاً توکن اختصاصی ربات خودتان را وارد نمایید.'
      };
    }

    let bot: TelegramBot | null = null;
    try {
      bot = new TelegramBot(token, {
        polling: {
          interval: 80,
          autoStart: false,
          params: {
            timeout: 25,
            allowed_updates: ['message', 'callback_query']
          }
        },
        request: {
          forever: true,
          pool: { maxSockets: 100 },
          timeout: 30000
        } as any
      });

      enhanceBotForSpeedAndColoredButtons(bot);
      this.attachBotHandlers(bot, sellerChatId);

      (bot as any).deleteWebHook({ drop_pending_updates: false }).catch(() => {});

      bot.startPolling().catch((pollErr: any) => {
        console.warn(`[ResellerBot @${sellerChatId}] Initial startPolling warning:`, pollErr?.message || pollErr);
      });

      bot.setMyCommands([
        { command: '/start', description: 'منوی اصلی فروشگاه' },
        { command: '/admin', description: 'پنل مدیریت ربات (ویژه مدیر فروشگاه)' }
      ]).catch(() => {});

      let botUsername = (user.sellerBot?.botUsername || '').trim();
      let botFirstName = (user.sellerBot?.botFirstName || '').trim();

      const applyBotIdentityFromMe = (u: User, me: TelegramBot.User) => {
        if (!u.sellerBot) return;
        if (me.username) {
          u.sellerBot.botUsername = me.username;
        }
        if (me.first_name) {
          u.sellerBot.botFirstName = me.first_name;
          const curName = (u.sellerBot.botName || '').trim();
          const isSellerIdentity =
            !curName ||
            curName === u.username ||
            curName === `@${u.username}` ||
            curName === u.name ||
            curName === u.portalUsername ||
            curName === String(u.chatId) ||
            curName === `Seller_${u.chatId}` ||
            curName === `فروشگاه ${u.chatId}` ||
            curName === 'فروشگاه اختصاصی';
          if (isSellerIdentity) {
            u.sellerBot.botName = me.first_name;
          }
        }
      };

      try {
        const me = await Promise.race([
          bot.getMe(),
          new Promise<null>(resolve => setTimeout(() => resolve(null), 3000))
        ]);
        if (me) {
          if (me.username) botUsername = me.username;
          if (me.first_name) botFirstName = me.first_name;
          applyBotIdentityFromMe(user, me);
          db.saveUser(user);
          db.saveImmediate();
        }
      } catch (quickErr: any) {
        console.warn(`[ResellerBot @${sellerChatId}] Quick getMe warning:`, quickErr?.message || quickErr);
      }

      if (!botUsername || !botFirstName) {
        bot.getMe().then(me => {
          if (me) {
            const u = db.getUser(sellerChatId);
            if (u && u.sellerBot) {
              applyBotIdentityFromMe(u, me);
              db.saveUser(u);
              db.saveImmediate();
              const rec = this.activeBots.get(sellerChatId);
              if (rec) {
                if (me.username) rec.username = me.username;
                if (me.first_name) rec.botFirstName = me.first_name;
              }
            }
          }
        }).catch(() => {});
      }

      this.activeBots.set(sellerChatId, {
        bot,
        username: botUsername,
        botFirstName,
        sellerChatId,
        startedAt: Date.now()
      });

      return {
        success: true,
        username: botUsername,
        message: botUsername
          ? `ربات اختصاصی شما (@${botUsername}) با موفقیت روشن شد و هم‌اکنون آنلاین است.`
          : 'تنظیمات ربات اختصاصی شما با موفقیت ذخیره شد و ربات در وضعیت آنلاین قرار گرفت.'
      };
    } catch (err: any) {
      if (bot) {
        try {
          bot.removeAllListeners('message');
          bot.removeAllListeners('callback_query');
          bot.on('error', () => {});
          bot.on('polling_error', () => {});
          await bot.stopPolling();
        } catch (e) {}
      }
      return {
        success: false,
        message: 'خطا در اتصال به تلگرام با توکن ارسالی: ' + (err?.message || String(err))
      };
    }
  }

  /**
   * Stop an active reseller bot
   */
  public async stopResellerBot(sellerChatId: number): Promise<boolean> {
    const record = this.activeBots.get(sellerChatId);
    if (record) {
      this.activeBots.delete(sellerChatId);
      try {
        record.bot.removeAllListeners('message');
        record.bot.removeAllListeners('callback_query');
        record.bot.on('error', () => {});
        record.bot.on('polling_error', () => {});
        await record.bot.stopPolling();
      } catch (e) {}
      return true;
    }
    return false;
  }

  public isBotRunning(sellerChatId: number): boolean {
    return this.activeBots.has(sellerChatId);
  }

  public getBotStatus(sellerChatId: number) {
    const isOnline = this.activeBots.has(sellerChatId);
    const user = db.getUser(sellerChatId);
    const config = user?.sellerBot;

    return {
      isOnline,
      botUsername: config?.botUsername || '',
      botName: user ? this.getEffectiveBotName(user) : 'ربات فروشگاهی',
      buyersCount: (config?.buyers || []).length,
      ordersCount: (config?.orders || []).length,
      pendingOrdersCount: (config?.orders || []).filter(o => o.status === 'pending').length,
      totalRevenue: config?.totalRevenueToman || 0,
      totalProfit: config?.totalProfitToman || 0
    };
  }

  /**
   * Helper: Calculate wholesale price (charged to Seller's debt in Bot 1)
   * and retail price (charged to Buyer in Bot 2, exclusively configured by Seller)
   */
  private getProductPricesForSeller(seller: User, product: any): { wholesalePrice: number; retailPrice: number } {
    const isPAYG = !!product.isPayAsYouGo;
    const basePrice = Number(product.price) || 0;
    const discount = getSellerDiscountForProduct(seller, product);
    const wholesalePrice = isPAYG ? 0 : Math.max(0, Math.round(basePrice * (1 - discount / 100)));

    const botCfg = seller.sellerBot || ({} as SellerBotConfig);
    let retailPrice = basePrice;
    if (botCfg.customRetailPrices && botCfg.customRetailPrices[product.id] !== undefined) {
      retailPrice = Number(botCfg.customRetailPrices[product.id]);
    } else if (seller.customDisplayPrices && seller.customDisplayPrices[product.id] !== undefined) {
      retailPrice = Number(seller.customDisplayPrices[product.id]);
    }
    return { wholesalePrice, retailPrice: Math.max(0, retailPrice) };
  }

  private getCustomVolumePricesForSeller(seller: User): { wholesalePricePerGb: number; retailPricePerGb: number } {
    const state = db.getState();
    const rawRate = seller.customVolumePricePerGb || state.customVolumePricePerGb || 3000;
    const discount = getSellerDiscountForProduct(seller);
    const wholesalePricePerGb = Math.max(0, Math.round(rawRate * (1 - discount / 100)));

    const botCfg = seller.sellerBot || ({} as SellerBotConfig);
    const retailPricePerGb =
      botCfg.customVolumeRetailPricePerGb !== undefined && botCfg.customVolumeRetailPricePerGb > 0
        ? Number(botCfg.customVolumeRetailPricePerGb)
        : Math.max(rawRate, Math.round(wholesalePricePerGb * 1.25));

    return { wholesalePricePerGb, retailPricePerGb };
  }

  private getProductBadge(p: any): string {
    if (!p) return '';
    if (p.panelType === 'all') return '🚀 ';
    if (
      p.panelType === 'both' ||
      p.panelType === 'sanaei_rebecca' ||
      p.panelType === 'sanaei_mrocean' ||
      p.panelType === 'rebecca_mrocean' ||
      p.panelType === 'sanaei_panel4' ||
      p.panelType === 'rebecca_panel4' ||
      p.panelType === 'mrocean_panel4'
    ) {
      return '⚡️ ';
    }
    if (p.panelType === 'panel4') return '🔸 ';
    if (p.panelType === 'mrocean') return '🌊 ';
    if (p.panelType === 'rebecca') return '🟣 ';
    if (p.panelType === 'sanaei') return '🔵 ';
    return '💎 ';
  }

  private getResellerProductButtonLabel(seller: User, p: any): string {
    const badge = this.getProductBadge(p);
    const { retailPrice } = this.getProductPricesForSeller(seller, p);
    const unit = p.isPayAsYouGo ? 'تومان/گیگ' : 'تومان';
    return `${badge}${p.name} - ${retailPrice.toLocaleString()} ${unit}`;
  }

  /**
   * Send live service status, traffic, expiry, subscription link, QR code and action buttons to buyer or admin in Bot 2
   */
  public async sendBuyerServiceInfo(
    bot: TelegramBot,
    seller: User,
    targetChatId: number,
    orderOrPurchase: { order?: SellerBotOrder; purchase?: any }
  ) {
    await bot.sendMessage(targetChatId, '⏳ در حال دریافت اطلاعات دقیق، حجم، زمان و لینک ساب از سرور...').catch(() => {});

    try {
      const order = orderOrPurchase.order;
      let purchase = orderOrPurchase.purchase;

      if (!purchase && order) {
        const allSellerPurchases = seller.purchases || [];
        purchase = allSellerPurchases.find(
          (p: any) =>
            (order.deliveredPurchaseId && (p.id === order.deliveredPurchaseId || p.subId === order.deliveredPurchaseId)) ||
            (order.deliveredSubUrl &&
              (p.subUrl === order.deliveredSubUrl ||
                p.sanaeiSubUrl === order.deliveredSubUrl ||
                p.rebeccaSubUrl === order.deliveredSubUrl ||
                p.mroceanSubUrl === order.deliveredSubUrl ||
                p.panel4SubUrl === order.deliveredSubUrl))
        );
      }

      if (!purchase && order) {
        purchase = {
          id: order.deliveredPurchaseId || order.id,
          name: order.customName || order.productName || 'سرویس اختصاصی',
          price: order.wholesalePrice || 0,
          subUrl: order.deliveredSubUrl || '',
          volumeGb: order.volumeGb || 0,
          durationDays: order.durationDays || 30,
          createdAt: order.approvedAt || order.createdAt
        };
      }

      if (!purchase) {
        await bot.sendMessage(targetChatId, '❌ اطلاعات این سرویس در سرور یافت نشد.');
        return;
      }

      let clientObj: any = null;

      const cleanPId = purchase.id ? String(purchase.id).trim().toLowerCase() : '';
      const targetSubId =
        (purchase.subId ? String(purchase.subId).trim().toLowerCase() : null) ||
        rebecca.extractSubToken(purchase.subUrl) ||
        rebecca.extractSubToken(purchase.sanaeiSubUrl) ||
        rebecca.extractSubToken(purchase.rebeccaSubUrl);

      let effectiveSubUrl = (
        purchase.subUrl ||
        purchase.sanaeiSubUrl ||
        purchase.rebeccaSubUrl ||
        purchase.mroceanSubUrl ||
        purchase.panel4SubUrl ||
        order?.deliveredSubUrl ||
        ''
      ).trim();

      if (effectiveSubUrl.includes('/sub/sub/')) {
        effectiveSubUrl = effectiveSubUrl.replace(/\/sub\/sub\//g, '/sub/');
      }

      // 1. Live subscription header inquiry FIRST (fast ~100ms)
      if (effectiveSubUrl) {
        try {
          const liveSub = await fetchSubscriptionLiveInfo(effectiveSubUrl);
          if (liveSub) {
            clientObj = {
              id: purchase.id || targetSubId,
              subId: targetSubId || purchase.id,
              up: liveSub.upload,
              down: liveSub.download,
              totalUsed: liveSub.totalUsed,
              total: liveSub.total,
              expiryTime: liveSub.expiryTime,
              enable: true,
              fromLiveSub: true
            };
          }
        } catch (e) {}
      }

      // 2. ONLY query multiPanel if live subscription header did not return client info
      let allClients: any[] = [];
      if (!clientObj) {
        try {
          allClients = await multiPanel.getAllClientsWithTraffic();
        } catch (e) {}
      }

      if (!clientObj && allClients && allClients.length > 0) {
        if (targetSubId) {
          clientObj = allClients.find((cl: any) => {
            const clSubId = cl.subId ? String(cl.subId).trim().toLowerCase() : '';
            const clToken = cl.token ? String(cl.token).trim().toLowerCase() : '';
            const clId = cl.id ? String(cl.id).trim().toLowerCase() : '';
            return (clSubId && clSubId === targetSubId) || (clToken && clToken === targetSubId) || (clId && clId === targetSubId);
          });
        }
        if (!clientObj && cleanPId && cleanPId.length >= 4) {
          clientObj = allClients.find((cl: any) => {
            const clEmail = cl.email ? String(cl.email).trim().toLowerCase() : '';
            const clUsername = cl.username ? String(cl.username).trim().toLowerCase() : '';
            return clEmail === cleanPId || clUsername === cleanPId;
          });
        }
      }

      // Update stored usage on seller's purchase if available
      if (clientObj && seller.purchases) {
        const currentUsed = clientObj.totalUsed || (clientObj.up || 0) + (clientObj.down || 0);
        const foundP = seller.purchases.find((p: any) => p.id === purchase.id);
        if (foundP) {
          foundP.lastUsedBytes = currentUsed;
          db.saveUser(seller);
        }
      }

      // Volume calculation
      let totalVolStr = '';
      let usedVolStr = '';
      let remainingVolStr = '';
      let progressBar = '';
      let isExpired = false;

      let totalBytes = 0;
      const volGbNum = Number(order?.volumeGb || purchase.volumeGb || 0);
      if (volGbNum > 0) {
        totalBytes = volGbNum * 1024 * 1024 * 1024;
      } else if (clientObj && clientObj.total > 0) {
        totalBytes = clientObj.total;
      }

      if (totalBytes > 0) {
        const totalGb = (totalBytes / (1024 * 1024 * 1024)).toFixed(2);
        totalVolStr = `${totalGb} گیگابایت`;

        const usedBytes = clientObj
          ? clientObj.totalUsed || (clientObj.up || 0) + (clientObj.down || 0)
          : purchase.lastUsedBytes || 0;

        let usedDisplay = '';
        if (usedBytes >= 1024 * 1024 * 1024) {
          usedDisplay = `${(usedBytes / (1024 * 1024 * 1024)).toFixed(2)} گیگابایت`;
        } else {
          usedDisplay = `${(usedBytes / (1024 * 1024)).toFixed(1)} مگابایت`;
        }

        let upDownStr = '';
        if (clientObj) {
          const upMb = ((clientObj.up || 0) / (1024 * 1024)).toFixed(1);
          const downMb = ((clientObj.down || 0) / (1024 * 1024)).toFixed(1);
          upDownStr = `(⬇️ ${downMb} MB | ⬆️ ${upMb} MB)`;
        }
        usedVolStr = `${usedDisplay} ${upDownStr}`.trim();

        const remBytes = Math.max(0, totalBytes - usedBytes);
        const remGb = (remBytes / (1024 * 1024 * 1024)).toFixed(2);
        const pctUsed = Math.min(100, Math.max(0, Math.round((usedBytes / totalBytes) * 100)));
        const pctRem = 100 - pctUsed;

        if (remBytes <= 0) {
          remainingVolStr = '❌ ۰ گیگابایت (حجم پایان یافته)';
          isExpired = true;
        } else {
          remainingVolStr = `${remGb} گیگابایت (${pctRem}٪ باقیمانده)`;
        }

        const filledBlocks = Math.min(10, Math.max(0, Math.round(pctUsed / 10)));
        const emptyBlocks = 10 - filledBlocks;
        progressBar = `▫️ <b>وضعیت مصرف:</b> [${'🔴'.repeat(filledBlocks)}${'🟢'.repeat(emptyBlocks)}] (${pctUsed}٪ مصرف شده)`;
      } else {
        totalVolStr = volGbNum ? `${volGbNum} گیگابایت` : 'نامحدود';
        usedVolStr = '۰ مگابایت';
        remainingVolStr = totalVolStr;
      }

      // Time / Expiry calculation
      let remainingTimeStr = '';
      let expiryDateStr = '';
      let expTime = Number(clientObj && clientObj.expiryTime !== undefined ? clientObj.expiryTime : 0);
      if (expTime > 0 && expTime < 10000000000) {
        expTime = expTime * 1000;
      }

      if (expTime > 0) {
        const remainingMs = expTime - Date.now();
        if (remainingMs <= 0) {
          remainingTimeStr = '❌ منقضی شده';
          isExpired = true;
        } else {
          const days = Math.floor(remainingMs / 86400000);
          const hours = Math.floor((remainingMs % 86400000) / 3600000);
          const mins = Math.floor((remainingMs % 3600000) / 60000);
          if (days > 0) remainingTimeStr = `${days} روز و ${hours} ساعت باقیمانده`;
          else if (hours > 0) remainingTimeStr = `${hours} ساعت و ${mins} دقیقه باقیمانده`;
          else remainingTimeStr = `${mins} دقیقه باقیمانده`;
        }
        const expDate = new Date(expTime);
        expiryDateStr = `${expDate.toLocaleDateString('fa-IR')} (ساعت ${expDate.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })})`;
      } else if (expTime < 0) {
        let days = Math.abs(expTime) > 86400000 ? Math.round(Math.abs(expTime) / 86400000) : Math.round(Math.abs(expTime) / 86400);
        if (days <= 0) days = order?.durationDays || purchase.durationDays || 30;
        remainingTimeStr = `${days} روز (شروع شمارش پس از اولین اتصال)`;
        expiryDateStr = 'پس از اولین اتصال فعال می‌شود';
      } else {
        const durDays = Number(order?.durationDays || purchase.durationDays || 0);
        const baseDateStr = purchase.expiryDate || order?.approvedAt || purchase.createdAt || order?.createdAt;
        if (purchase.expiryDate) {
          const pExp = new Date(purchase.expiryDate).getTime();
          const remMs = pExp - Date.now();
          if (remMs <= 0) {
            remainingTimeStr = '❌ منقضی شده';
            isExpired = true;
          } else {
            const days = Math.floor(remMs / 86400000);
            const hours = Math.floor((remMs % 86400000) / 3600000);
            remainingTimeStr = `${days} روز و ${hours} ساعت باقیمانده`;
          }
          const expDate = new Date(pExp);
          expiryDateStr = `${expDate.toLocaleDateString('fa-IR')}`;
        } else if (durDays > 0 && baseDateStr) {
          const createTime = new Date(baseDateStr).getTime();
          const calcExp = createTime + durDays * 86400000;
          const remMs = calcExp - Date.now();
          if (remMs <= 0) {
            remainingTimeStr = '❌ منقضی شده';
            isExpired = true;
          } else {
            const days = Math.floor(remMs / 86400000);
            const hours = Math.floor((remMs % 86400000) / 3600000);
            remainingTimeStr = `${days} روز و ${hours} ساعت باقیمانده`;
          }
          const expDate = new Date(calcExp);
          expiryDateStr = `${expDate.toLocaleDateString('fa-IR')}`;
        } else {
          remainingTimeStr = 'نامحدود';
          expiryDateStr = 'همیشگی';
        }
      }

      let statusText = '🟢 فعال و متصل';
      if (clientObj && clientObj.enable === false) {
        statusText = '🔴 غیرفعال';
      } else if (isExpired) {
        statusText = '⚠️ نیاز به تمدید (حجم یا زمان پایان یافته)';
      }

      let linksText = '';
      if (purchase.sanaeiSubUrl) {
        linksText += `🔵 <b>لینک سابسکریپشن سرور ۱:</b>\n<code>${escapeHtml(purchase.sanaeiSubUrl)}</code>\n\n`;
      }
      if (purchase.rebeccaSubUrl) {
        linksText += `🟣 <b>لینک سابسکریپشن سرور ۲:</b>\n<code>${escapeHtml(purchase.rebeccaSubUrl)}</code>\n\n`;
      }
      if (purchase.mroceanSubUrl) {
        linksText += `🌊 <b>لینک سابسکریپشن سرور ۳:</b>\n<code>${escapeHtml(purchase.mroceanSubUrl)}</code>\n\n`;
      }
      if (purchase.panel4SubUrl) {
        linksText += `🔸 <b>لینک سابسکریپشن سرور ۴:</b>\n<code>${escapeHtml(purchase.panel4SubUrl)}</code>\n\n`;
      }
      if (!linksText && effectiveSubUrl) {
        linksText = `🔗 <b>لینک اختصاصی سابسکریپشن:</b>\n<code>${escapeHtml(effectiveSubUrl)}</code>\n\n`;
      }

      const displayTitle = order?.customName || purchase.customName || order?.productName || purchase.name || 'سرویس اختصاصی';
      const refKey = order ? order.id : purchase.id;

      const caption =
        `🔑 <b>اطلاعات کامل سرویس (${escapeHtml(displayTitle)})</b>\n\n` +
        `📋 <b>شناسه سرویس:</b> <code>${escapeHtml(String(purchase.id || refKey))}</code>\n` +
        `🔰 <b>وضعیت اکانت:</b> ${statusText}\n\n` +
        `📊 <b>اطلاعات حجم سرویس:</b>\n` +
        `▫️ <b>کل حجم:</b> ${totalVolStr}\n` +
        `▫️ <b>حجم مصرف شده:</b> ${usedVolStr}\n` +
        `▫️ <b>حجم باقیمانده:</b> <b>${remainingVolStr}</b>\n` +
        (progressBar ? `${progressBar}\n\n` : '\n') +
        `⏳ <b>اطلاعات زمان و انقضا:</b>\n` +
        `▫️ <b>زمان باقیمانده:</b> <b>${remainingTimeStr}</b>\n` +
        `▫️ <b>تاریخ انقضا:</b> ${expiryDateStr}\n\n` +
        linksText +
        `💡 <i>با لمس لینک بالا، به صورت خودکار در حافظه کپی می‌شود.</i>\n\n` +
        `📱 <b>راهنمای اتصال:</b>\n` +
        `۱. بارکد QR بالا را اسکن کرده یا لینک سابسکریپشن را کپی و اضافه نمایید.\n` +
        `۲. در نرم‌افزار (V2rayNG / Streisand / V2rayN / Sing-box / Shadowrocket) گزینه <b>Update Subscription</b> را بزنید.`;

      const isViewerSellerAdmin =
        targetChatId === seller.chatId ||
        (seller.sellerBot?.adminChatId && targetChatId === Number(seller.sellerBot.adminChatId));

      const inlineButtons: any[][] = [
        [
          { text: '🔄 بروزرسانی وضعیت لحظه‌ای', callback_data: `refresh_srv_${refKey}`, style: 'primary' },
          { text: '⚙️ دریافت کانفیگ مستقیم', callback_data: `direct_srv_${refKey}`, style: 'primary' }
        ],
        [
          { text: '♻️ تمدید همین سرویس (شارژ مجدد حجم و زمان)', callback_data: `renew_srv_${refKey}`, style: 'success' }
        ]
      ];

      if (isViewerSellerAdmin) {
        inlineButtons.push([
          { text: '👑 تمدید مستقیم همکار (با نرخ عمده)', callback_data: `admin_direct_renew_${refKey}`, style: 'primary' },
          { text: '🚫 ابطال و توقف سرویس (<1GB رایگان)', callback_data: `admin_cancel_srv_${refKey}`, style: 'danger' }
        ]);
      }

      inlineButtons.push([
        { text: '📋 بازگشت به لیست سرویس‌های من', callback_data: 'my_services_list', style: 'danger' }
      ]);

      let photoSent = false;
      if (effectiveSubUrl) {
        try {
          const buffer = await QRCode.toBuffer(effectiveSubUrl, { width: 450, margin: 2 });
          await bot.sendPhoto(targetChatId, buffer, {
            caption: caption.length <= 1024 ? caption : caption.slice(0, 1020) + '...',
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: inlineButtons }
          });
          photoSent = true;
        } catch (err) {}
      }

      if (!photoSent) {
        await bot.sendMessage(targetChatId, caption, {
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: inlineButtons }
        });
      }
    } catch (err: any) {
      await bot.sendMessage(targetChatId, `❌ خطا در استعلام وضعیت سرویس: ${err?.message || err}`).catch(() => {});
    }
  }

  /**
   * Attach handlers to a Reseller Child Bot instance
   */
  private attachBotHandlers(bot: TelegramBot, sellerChatId: number) {
    const getSessionKey = (buyerChatId: number) => `${sellerChatId}_${buyerChatId}`;

    const getMainKeyboard = (seller: User, isUserAdmin: boolean = false) => {
      const cfg = seller.sellerBot || ({} as SellerBotConfig);
      const keyboard: any[][] = [];

      const firstRow: any[] = [];
      if (cfg.freeTestEnabled !== false) {
        firstRow.push({ text: '🎁 تست رایگان', style: 'primary' });
      }
      firstRow.push({ text: '🛒 خرید سرویس', style: 'success' });
      keyboard.push(firstRow);

      keyboard.push([
        { text: '⚡ خرید حجم دلخواه', style: 'success' },
        { text: '📋 لیست خریدهای من', style: 'primary' }
      ]);

      keyboard.push([
        { text: '👤 پروفایل و موجودی', style: 'primary' },
        { text: '💳 افزایش موجودی', style: 'success' }
      ]);

      keyboard.push([
        { text: '🔗 زیرمجموعه‌گیری', style: 'success' },
        { text: '📞 پشتیبانی و راهنما', style: 'success' }
      ]);

      if (isUserAdmin) {
        keyboard.push([{ text: '👑 پنل مدیریت ربات و پنل همکار (ویژه شما)', style: 'danger' }]);
      }

      return {
        keyboard,
        resize_keyboard: true
      };
    };

    const getAvailableProductsForReseller = (seller: User) => {
      const state = db.getState();
      const allCategories = state.categories || [];
      const activeCategories = allCategories.filter(c => c && !c.disabled);
      const hasCategories = allCategories.length > 0;

      const activeProducts = (state.products || []).filter(p => {
        if (!p || p.disabled) return false;
        if (p.categoryId) {
          const cat = activeCategories.find(
            c =>
              String(c.id).trim().toLowerCase() === String(p.categoryId).trim().toLowerCase() ||
              String(c.name).trim().toLowerCase() === String(p.categoryId).trim().toLowerCase()
          );
          return !!cat;
        }
        // If categories exist in the main bot, uncategorized ("سایر محصولات") products are hidden
        if (hasCategories) return false;
        return true;
      });
      if (seller.showCustomPricesOnly) {
        return activeProducts.filter(
          p =>
            (seller.sellerBot?.customRetailPrices && seller.sellerBot.customRetailPrices[p.id] !== undefined) ||
            (seller.customDisplayPrices && seller.customDisplayPrices[p.id] !== undefined)
        );
      }
      return activeProducts;
    };

    const sendCategoriesOrProductsMenu = async (buyerChatId: number, seller: User, editMsgId?: number) => {
      const state = db.getState();
      const botCfg = seller.sellerBot || ({} as SellerBotConfig);
      const activeProducts = getAvailableProductsForReseller(seller);

      if (activeProducts.length === 0) {
        const emptyText = '⚠️ در حال حاضر محصول فعالی در فروشگاه تعریف نشده است.';
        if (editMsgId) {
          await bot.editMessageText(emptyText, { chat_id: buyerChatId, message_id: editMsgId }).catch(() => {});
        } else {
          await bot.sendMessage(buyerChatId, emptyText);
        }
        return;
      }

      const categories = (state.categories || []).filter(c => c && !c.disabled);
      const activeCatList = categories.filter(c =>
        activeProducts.some(
          p =>
            String(p.categoryId || '').trim().toLowerCase() === String(c.id).trim().toLowerCase() ||
            String(p.categoryId || '').trim().toLowerCase() === String(c.name).trim().toLowerCase()
        )
      );

      if (activeCatList.length > 0) {
        const inline_keyboard: any[][] = activeCatList.map(c => [
          {
            text: `📁 ${c.name}`,
            callback_data: `cat_${c.id}`,
            style: 'primary'
          }
        ]);

        if (state.customVolumeEnabled !== false) {
          inline_keyboard.push([
            {
              text: '⚡ خرید با حجم دلخواه (انتخاب گیگابایت دلخواه)',
              callback_data: 'open_cvol',
              style: 'success'
            }
          ]);
        }

        const menuText = `🛍 <b>منوی خرید اشتراک ${escapeHtml(this.getEffectiveBotName(seller))}</b>\n\nلطفاً دسته‌بندی سرور یا سرویس مورد نظر خود را انتخاب کنید:`;
        if (editMsgId) {
          await bot
            .editMessageText(menuText, {
              chat_id: buyerChatId,
              message_id: editMsgId,
              parse_mode: 'HTML',
              reply_markup: { inline_keyboard }
            })
            .catch(async () => {
              await bot.sendMessage(buyerChatId, menuText, { parse_mode: 'HTML', reply_markup: { inline_keyboard } });
            });
        } else {
          await bot.sendMessage(buyerChatId, menuText, {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard }
          });
        }
      } else {
        const inline_keyboard: any[][] = activeProducts.map(p => [
          {
            text: this.getResellerProductButtonLabel(seller, p),
            callback_data: `select_prod_${p.id}`,
            style: 'success'
          }
        ]);

        if (state.customVolumeEnabled !== false) {
          inline_keyboard.push([
            {
              text: '⚡ خرید با حجم دلخواه (انتخاب گیگابایت دلخواه)',
              callback_data: 'open_cvol',
              style: 'success'
            }
          ]);
        }

        const menuText = `🛍 <b>لیست سرویس‌های فعال ${escapeHtml(this.getEffectiveBotName(seller))}:</b>\n\nلطفاً سرویس مورد نظر خود را جهت خرید انتخاب کنید:`;
        if (editMsgId) {
          await bot
            .editMessageText(menuText, {
              chat_id: buyerChatId,
              message_id: editMsgId,
              parse_mode: 'HTML',
              reply_markup: { inline_keyboard }
            })
            .catch(async () => {
              await bot.sendMessage(buyerChatId, menuText, { parse_mode: 'HTML', reply_markup: { inline_keyboard } });
            });
        } else {
          await bot.sendMessage(buyerChatId, menuText, {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard }
          });
        }
      }
    };

    const getEffectiveForceJoinChannels = (seller: User): { id: string; name: string; url: string }[] => {
      const botCfg = seller.sellerBot || ({} as SellerBotConfig);
      const list = [...(botCfg.forceJoinChannels || [])];
      if (list.length === 0 && botCfg.channelUsername) {
        const cleanCh = botCfg.channelUsername
          .replace(/^https?:\/\/t\.me\//i, '')
          .replace(/^@/, '')
          .trim();
        if (cleanCh) {
          list.push({
            id: `@${cleanCh}`,
            name: `📢 عضویت در کانال ${this.getEffectiveBotName(seller)}`,
            url: `https://t.me/${cleanCh}`
          });
        }
      }
      return list;
    };

    const checkBuyerForceJoin = async (buyerChatId: number, seller: User): Promise<boolean> => {
      const botCfg = seller.sellerBot || ({} as SellerBotConfig);
      if (!botCfg.forceJoinEnabled) return true;
      const channels = getEffectiveForceJoinChannels(seller);
      if (channels.length === 0) return true;

      const cacheKey = `${sellerChatId}_${buyerChatId}`;
      const cachedAt = this.forceJoinCache.get(cacheKey);
      if (cachedAt && Date.now() - cachedAt < 2 * 60 * 1000) {
        return true;
      }

      const notJoined: { id: string; name: string; url: string }[] = [];
      for (const ch of channels) {
        let chId = (ch.id || '').trim();
        if (!chId) continue;
        if (!chId.startsWith('@') && !chId.startsWith('-100') && isNaN(Number(chId))) {
          chId = '@' + chId;
        }
        try {
          const member = await bot.getChatMember(chId, buyerChatId);
          if (['left', 'kicked'].includes(member.status)) {
            notJoined.push(ch);
          }
        } catch (err: any) {
          console.warn(`[ResellerBot @${sellerChatId}] ForceJoin check error on channel ${chId}:`, err?.message || err);
        }
      }

      if (notJoined.length > 0) {
        const inline_keyboard: any[][] = notJoined.map(c => [
          {
            text: `📢 ${c.name || 'عضویت در کانال'}`,
            url: c.url,
            style: 'primary'
          }
        ]);
        inline_keyboard.push([
          {
            text: '✅ عضو شدم (بررسی عضویت)',
            callback_data: 'check_reseller_fj',
            style: 'success'
          }
        ]);

        await bot
          .sendMessage(
            buyerChatId,
            `⚠️ <b>کاربر گرامی، برای استفاده از خدمات ربات «${escapeHtml(this.getEffectiveBotName(seller))}»، ابتدا در کانال زیر عضو شوید:</b>\n\n` +
              `پس از عضویت در کانال، روی دکمه شیشه‌ای <b>«✅ عضو شدم (بررسی عضویت)»</b> کلیک نمایید:`,
            {
              parse_mode: 'HTML',
              reply_markup: { inline_keyboard }
            }
          )
          .catch(() => {});
        return false;
      }

      this.forceJoinCache.set(cacheKey, Date.now());
      return true;
    };

    const sendForceJoinMenu = async (adminChatId: number, seller: User, editMsgId?: number) => {
      const botCfg = seller.sellerBot || ({} as SellerBotConfig);
      const channels = getEffectiveForceJoinChannels(seller);
      const isEnabled = !!botCfg.forceJoinEnabled;
      const botUserDisplay = botCfg.botUsername ? `@${botCfg.botUsername}` : 'ربات خودتان';

      let msg =
        `🔐 <b>تنظیمات عضویت اجباری کانال (ادد اجباری) در ربات شما</b>\n` +
        `━━━━━━━━━━━━━━━━━━\n` +
        `📌 <b>وضعیت فعلی قفل کانال:</b> ${isEnabled ? '🟢 <b>فعال</b>' : '🔴 <b>غیرفعال</b>'}\n` +
        `📢 <b>تعداد کانال‌های ثبت‌شده:</b> <b>${channels.length} کانال</b>\n\n`;

      if (channels.length > 0) {
        msg += `📋 <b>لیست کانال‌های عضویت اجباری شما:</b>\n`;
        channels.forEach((ch, idx) => {
          msg += `${idx + 1}. <b>${escapeHtml(ch.name)}</b> (<code>${escapeHtml(ch.id)}</code>)\n🔗 ${escapeHtml(ch.url)}\n`;
        });
        msg += `\n`;
      } else {
        msg += `ℹ️ <i>هنوز کانالی برای عضویت اجباری ثبت نکرده‌اید.</i>\n\n`;
      }

      msg +=
        `⚠️ <b>نکته بسیار مهم:</b>\n` +
        `برای اینکه ربات بتواند عضو بودن مشتریان در کانال شما را بررسی کند، حتماً باید <b>${escapeHtml(botUserDisplay)}</b> را در کانال تلگرام خودتان <b>Admin (مدیر)</b> کنید.`;

      const inline_keyboard: any[][] = [
        [
          {
            text: isEnabled ? '🔴 غیرفعال کردن عضویت اجباری' : '🟢 فعال کردن عضویت اجباری',
            callback_data: 'admin_toggle_fj',
            style: isEnabled ? 'danger' : 'success'
          }
        ],
        [
          {
            text: '➕ افزودن کانال جدید به عضویت اجباری',
            callback_data: 'admin_add_fj_start',
            style: 'primary'
          }
        ]
      ];

      channels.forEach((ch, idx) => {
        inline_keyboard.push([
          {
            text: `🗑 حذف کانال: ${ch.name} (${ch.id})`,
            callback_data: `admin_del_fj_${idx}`,
            style: 'danger'
          }
        ]);
      });

      inline_keyboard.push([
        { text: '🔙 بازگشت به پنل مدیریت', callback_data: 'admin_main', style: 'primary' }
      ]);

      if (editMsgId) {
        await bot
          .editMessageText(msg, {
            chat_id: adminChatId,
            message_id: editMsgId,
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard }
          })
          .catch(async () => {
            await bot.sendMessage(adminChatId, msg, { parse_mode: 'HTML', reply_markup: { inline_keyboard } });
          });
      } else {
        await bot.sendMessage(adminChatId, msg, {
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard }
        });
      }
    };

    const sendMyServicesList = async (buyerChatId: number, seller: User) => {
      const botCfg = seller.sellerBot || ({} as SellerBotConfig);
      // Combine unique services by deliveredPurchaseId or deliveredSubUrl so renewed services don't duplicate
      const approvedOrders = (botCfg.orders || []).filter(
        o => o.buyerChatId === buyerChatId && o.status === 'approved' && o.type !== 'deposit' && (o.deliveredSubUrl || o.deliveredPurchaseId)
      );

      if (approvedOrders.length === 0) {
        await bot.sendMessage(buyerChatId, '❌ شما تاکنون هیچ سرویس فعالی خریداری نکرده‌اید.');
        return;
      }

      // Deduplicate by deliveredPurchaseId or deliveredSubUrl (keep latest order metadata)
      const uniqueMap = new Map<string, SellerBotOrder>();
      for (const ord of approvedOrders) {
        const key = ord.deliveredPurchaseId || ord.deliveredSubUrl || ord.id;
        uniqueMap.set(key, ord);
      }
      const myOrders = Array.from(uniqueMap.values());

      let msgText = '📋 <b>لیست سرویس‌های فعال شما:</b>\n\nبرای مشاهده جزئیات لحظه‌ای حجم، زمان باقیمانده، بارکد QR، لینک سابسکریپشن و تمدید هر سرویس، روی دکمه شیشه‌ای آن کلیک کنید:\n\n';
      const inline_keyboard: any[][] = [];

      myOrders.forEach((ord, idx) => {
        const title = ord.customName || ord.productName || `سرویس ${idx + 1}`;
        const dateStr = new Date(ord.createdAt).toLocaleDateString('fa-IR');
        msgText += `🔹 <b>${idx + 1}- ${escapeHtml(title)}</b>\n💰 مبلغ: ${(ord.retailPrice || 0).toLocaleString()} تومان | 📅 تاریخ: ${dateStr}\n──────────────\n`;
        inline_keyboard.push([
          {
            text: `🔍 استعلام حجم، زمان و لینک ساب (${title})`,
            callback_data: `view_srv_${ord.id}`,
            style: 'primary'
          }
        ]);
      });

      await bot.sendMessage(buyerChatId, msgText, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard }
      });
    };

    const sendAdminPanelMenu = async (adminChatId: number, seller: User, editMsgId?: number) => {
      const botCfg = seller.sellerBot || ({} as SellerBotConfig);
      const pendingOrders = (botCfg.orders || []).filter(o => o.status === 'pending');
      const totalBuyers = (botCfg.buyers || []).length;
      const totalOrders = (botCfg.orders || []).filter(o => o.type !== 'deposit' && o.status === 'approved').length;

      const isUnlimited = isSellerUnlimitedLimit(seller);
      const debtVal = seller.debt || 0;
      const limitVal = seller.debtLimit !== undefined && seller.debtLimit > 0 ? seller.debtLimit : 1000000;
      const remainingCredit = isUnlimited ? null : Math.max(0, limitVal - debtVal);
      const creditDisplay = isUnlimited
        ? 'سقف آزاد (نامحدود)'
        : `${(remainingCredit || 0).toLocaleString()} تومان (از سقف ${limitVal.toLocaleString()})`;

      const cardInfo = botCfg.cardNumber
        ? `<code>${escapeHtml(botCfg.cardNumber)}</code> (${escapeHtml(botCfg.cardHolder || 'بدون نام')})`
        : '❌ ثبت نشده (الزامی)';

      const effectiveBotName = this.getEffectiveBotName(seller);
      const fjChannelsCount = getEffectiveForceJoinChannels(seller).length;
      const adminMsg =
        `👑 <b>پنل مدیریت ربات دوم شما و پنل همکار (${escapeHtml(effectiveBotName)})</b>\n\n` +
        `🤖 <b>نام نمایشی ربات:</b> <b>${escapeHtml(effectiveBotName)}</b> ${botCfg.botUsername ? `(@${escapeHtml(botCfg.botUsername)})` : ''}\n` +
        `👤 <b>شناسه همکار (شما):</b> <code>${adminChatId}</code>\n` +
        `👥 <b>کل مشتریان ربات شما:</b> <b>${totalBuyers.toLocaleString()} نفر</b>\n` +
        `📦 <b>سرویس‌های تحویل‌شده در این ربات:</b> <b>${totalOrders.toLocaleString()} عدد</b>\n` +
        `⏳ <b>فیش‌های منتظر تایید شما:</b> <b>${pendingOrders.length} مورد</b>\n` +
        `💳 <b>کارت بانکی شما در ربات دوم:</b> ${cardInfo}\n` +
        `🔐 <b>عضویت اجباری کانال شما:</b> <b>${botCfg.forceJoinEnabled ? `🟢 فعال (${fjChannelsCount} کانال)` : '🔴 غیرفعال'}</b>\n` +
        `⚡ <b>تحویل آنی خودکار:</b> <b>${botCfg.autoDeliverAfterPayment ? '✅ فعال' : '❌ غیرفعال (تایید دستی فیش)'}</b>\n\n` +
        `💰 <b>تراز مالی شما با مشتریان ربات دوم:</b>\n` +
        `• کل دریافتی از مشتریان: <b>${(botCfg.totalRevenueToman || 0).toLocaleString()} تومان</b>\n` +
        `• هزینه عمده ثبت‌شده: <b>${(botCfg.totalWholesaleCostToman || 0).toLocaleString()} تومان</b>\n` +
        `• 💎 <b>سود خالص شما: ${(botCfg.totalProfitToman || 0).toLocaleString()} تومان</b>\n\n` +
        `🏦 <b>وضعیت حساب همکار شما:</b>\n` +
        `• 📉 <b>بدهی فعلی همکار: ${debtVal.toLocaleString()} تومان</b>\n` +
        `• 🔋 <b>اعتبار خرید باقیمانده: ${creditDisplay}</b>\n\n` +
        `از دکمه‌های شیشه‌ای زیر جهت مدیریت مشتریان ربات دوم، ارسال پیام همگانی، قفل کانال، قیمت‌گذاری و امکانات کامل پنل همکار خود استفاده کنید:`;

      const inline_keyboard: any[][] = [];
      if (pendingOrders.length > 0) {
        inline_keyboard.push([
          {
            text: `🔔 بررسی ${pendingOrders.length} فیش و سفارش منتظر تایید مشتریان`,
            callback_data: 'admin_view_pending',
            style: 'success'
          }
        ]);
      }

      // Section 1: Bot 2 Storefront, Customers, Broadcast & Force Join Management
      inline_keyboard.push([
        { text: '👥 مدیریت مشتریان و شارژ دستی', callback_data: 'admin_buyers_menu', style: 'primary' },
        { text: '📋 استعلام، تمدید و ابطال کانفیگ‌ها', callback_data: 'admin_all_configs', style: 'primary' }
      ]);

      inline_keyboard.push([
        { text: '📢 ارسال پیام همگانی به کاربران ربات', callback_data: 'admin_broadcast_start', style: 'primary' },
        { text: '🔐 عضویت اجباری کانال (ادد اجباری)', callback_data: 'admin_force_join_menu', style: 'primary' }
      ]);

      inline_keyboard.push([
        { text: '🎫 مدیریت کدهای تخفیف و هدیه', callback_data: 'admin_coupons_menu', style: 'success' },
        { text: '🔗 پاداش زیرمجموعه‌گیری', callback_data: 'admin_referral_settings', style: 'primary' }
      ]);

      inline_keyboard.push([
        { text: '💰 تعیین قیمت فروش محصولات', callback_data: 'admin_price_settings', style: 'success' },
        { text: '💳 تنظیم شماره کارت بانکی من', callback_data: 'admin_card_settings', style: 'success' }
      ]);

      // Section 2: Reseller's Own Seller Panel Capabilities (پنل همکار)
      inline_keyboard.push([
        { text: '🛒 صدور مستقیم کانفیگ همکار (قیمت همکاری)', callback_data: 'seller_direct_issue_menu', style: 'success' }
      ]);

      inline_keyboard.push([
        { text: '📉 وضعیت بدهی و اعتبار همکار', callback_data: 'seller_credit_status', style: 'primary' },
        { text: '💳 پرداخت بدهی همکار (ثبت فیش)', callback_data: 'seller_pay_debt_start', style: 'success' }
      ]);

      inline_keyboard.push([
        { text: '📊 گزارش فروش امروز، ماهانه و صورتحساب من', callback_data: 'seller_sales_report', style: 'primary' }
      ]);

      inline_keyboard.push([
        { text: '⚙️ تنظیمات نام بات، خوش‌آمدگویی و تست', callback_data: 'admin_brand_settings', style: 'primary' },
        { text: '🔄 بروزرسانی آمار پنل', callback_data: 'admin_refresh_stats', style: 'primary' }
      ]);

      if (editMsgId) {
        await bot
          .editMessageText(adminMsg, {
            chat_id: adminChatId,
            message_id: editMsgId,
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard }
          })
          .catch(async () => {
            await bot.sendMessage(adminChatId, adminMsg, { parse_mode: 'HTML', reply_markup: { inline_keyboard } });
          });
      } else {
        await bot.sendMessage(adminChatId, adminMsg, {
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard }
        });
      }
    };

    const sendBuyerReferralMenu = async (buyerChatId: number, seller: User) => {
      const botCfg = seller.sellerBot || ({} as SellerBotConfig);
      const effectiveBotName = this.getEffectiveBotName(seller);
      const rec = this.activeBots.get(seller.chatId);
      const botUsername = (botCfg.botUsername || rec?.username || '').replace(/^@/, '').trim();
      const buyerRec = (botCfg.buyers || []).find(b => b.chatId === buyerChatId);
      const refCount = buyerRec?.referralCount || 0;
      const refEarnings = buyerRec?.referralEarnings || 0;
      const rewardPerUser = Number(botCfg.referralRewardToman) || 0;
      const refLink = botUsername
        ? `https://t.me/${botUsername}?start=${buyerChatId}`
        : `شناسه معرف شما: ${buyerChatId}`;

      const msgText =
        `🔗 <b>سیستم زیرمجموعه‌گیری و کسب درآمد (${escapeHtml(effectiveBotName)})</b>\n` +
        `━━━━━━━━━━━━━━━━━━\n` +
        `با دعوت از دوستان خود از طریق لینک اختصاصی زیر، با استارت ربات توسط هر دوست جدید، کیف پول شما به صورت آنی شارژ می‌شود و می‌توانید از آن برای خرید یا تمدید رایگان سرویس استفاده کنید!\n\n` +
        `🎁 <b>پاداش معرفی هر نفر:</b> <b>${rewardPerUser > 0 ? `${rewardPerUser.toLocaleString()} تومان` : 'توسط مدیر تعیین نشده'}</b>\n` +
        `👥 <b>تعداد زیرمجموعه‌های شما:</b> <b>${refCount.toLocaleString()} نفر</b>\n` +
        `💰 <b>کل پاداش دریافتی شما:</b> <b>${refEarnings.toLocaleString()} تومان</b>\n\n` +
        `🔗 <b>لینک اختصاصی دعوت شما (لمس کنید تا کپی شود):</b>\n` +
        `<code>${escapeHtml(refLink)}</code>`;

      const shareText = encodeURIComponent(
        `🚀 فیلترشکن پرسرعت و بدون قطعی ${effectiveBotName} با تست رایگان!\nهمین الان از طریق لینک زیر استارت کن:\n${refLink}`
      );
      const inline_keyboard: any[][] = [];
      if (botUsername) {
        inline_keyboard.push([
          {
            text: '📤 اشتراک‌گذاری و ارسال لینک دعوت به دوستان',
            url: `https://t.me/share/url?url=${encodeURIComponent(refLink)}&text=${shareText}`,
            style: 'success'
          }
        ]);
      }

      await bot.sendMessage(buyerChatId, msgText, {
        parse_mode: 'HTML',
        reply_markup: inline_keyboard.length > 0 ? { inline_keyboard } : undefined
      });
    };

    const sendAdminReferralSettingsMenu = async (adminChatId: number, seller: User, editMsgId?: number) => {
      const botCfg = seller.sellerBot || ({} as SellerBotConfig);
      const currentReward = Number(botCfg.referralRewardToman) || 0;
      const totalReferrals = (botCfg.buyers || []).reduce((sum, b) => sum + (b.referralCount || 0), 0);
      const totalPaidRewards = (botCfg.buyers || []).reduce((sum, b) => sum + (b.referralEarnings || 0), 0);

      const msg =
        `🔗 <b>تنظیمات پاداش زیرمجموعه‌گیری ربات شما</b>\n` +
        `━━━━━━━━━━━━━━━━━━\n` +
        `🎁 <b>پاداش فعلی به ازای هر دعوت موفق:</b> <b>${currentReward > 0 ? `${currentReward.toLocaleString()} تومان` : 'غیرفعال (۰ تومان)'}</b>\n` +
        `👥 <b>کل زیرمجموعه‌های جذب‌شده توسط کاربران:</b> <b>${totalReferrals.toLocaleString()} نفر</b>\n` +
        `💰 <b>مجموع پاداش واریزشده به کیف پول کاربران:</b> <b>${totalPaidRewards.toLocaleString()} تومان</b>\n\n` +
        `💡 <i>زمانی که کاربری لینک اختصاصی خود را برای دوستانش بفرستد و کاربر جدید برای اولین بار وارد ربات شود (و در صورت فعال بودن قفل کانال، در کانال عضو شود)، مبلغ پاداش به صورت خودکار به کیف پول معرف در ربات شما اضافه می‌گردد.</i>\n\n` +
        `لطفاً مبلغ پاداش هر زیرمجموعه را انتخاب یا وارد نمایید:`;

      const inline_keyboard: any[][] = [
        [
          { text: '🔴 غیرفعال (۰ تومان)', callback_data: 'admin_ref_preset_0', style: 'danger' },
          { text: '🎁 ۲,۰۰۰ تومان', callback_data: 'admin_ref_preset_2000', style: 'success' }
        ],
        [
          { text: '🎁 ۵,۰۰۰ تومان', callback_data: 'admin_ref_preset_5000', style: 'success' },
          { text: '🎁 ۱۰,۰۰۰ تومان', callback_data: 'admin_ref_preset_10000', style: 'success' }
        ],
        [
          { text: '✍️ وارد کردن مبلغ دلخواه پاداش (تومان)', callback_data: 'admin_ref_custom_input', style: 'primary' }
        ],
        [
          { text: '🔙 بازگشت به پنل مدیریت', callback_data: 'admin_main', style: 'primary' }
        ]
      ];

      if (editMsgId) {
        await bot
          .editMessageText(msg, { chat_id: adminChatId, message_id: editMsgId, parse_mode: 'HTML', reply_markup: { inline_keyboard } })
          .catch(async () => {
            await bot.sendMessage(adminChatId, msg, { parse_mode: 'HTML', reply_markup: { inline_keyboard } });
          });
      } else {
        await bot.sendMessage(adminChatId, msg, { parse_mode: 'HTML', reply_markup: { inline_keyboard } });
      }
    };

    const sendAdminCouponsMenu = async (adminChatId: number, seller: User, editMsgId?: number) => {
      const botCfg = seller.sellerBot || ({} as SellerBotConfig);
      const coupons = botCfg.coupons || [];

      let msg =
        `🎫 <b>مدیریت کدهای تخفیف و کدهای هدیه در ربات شما</b>\n` +
        `━━━━━━━━━━━━━━━━━━\n` +
        `شما می‌توانید برای جذب مشتری در ربات خودتان دو نوع کد تعریف کنید:\n` +
        `1️⃣ <b>کد تخفیف درصدی خرید:</b> مثلاً <code>OFF20</code> با ۲۰٪ تخفیف روی قیمت فروش شما به مشتری.\n` +
        `2️⃣ <b>کد هدیه شارژ کیف پول:</b> مثلاً <code>GIFT10</code> که کیف پول مشتری را در ربات شما شارژ می‌کند.\n\n`;

      if (coupons.length > 0) {
        msg += `📋 <b>لیست کدهای فعال فعلی (${coupons.length} مورد):</b>\n`;
        coupons.forEach((c, i) => {
          const typeStr = c.giftAmount && c.giftAmount > 0
            ? `🎁 هدیه ${c.giftAmount.toLocaleString()} تومان`
            : `🏷 تخفیف ${c.discountPercent || 0}%`;
          const usageStr = `${c.usedCount || 0}/${c.maxUsage || 100} بار`;
          msg += `${i + 1}. <code>${escapeHtml(c.code)}</code> ⬅️ ${typeStr} (استفاده: ${usageStr})\n`;
        });
      } else {
        msg += `ℹ️ <i>هنوز هیچ کد تخفیف یا کد هدیه‌ای تعریف نکرده‌اید.</i>\n`;
      }

      const inline_keyboard: any[][] = [
        [
          { text: '➕ ساخت کد تخفیف درصدی (روی خرید)', callback_data: 'admin_add_discount_coupon', style: 'success' }
        ],
        [
          { text: '🎁 ساخت کد هدیه (شارژ کیف پول)', callback_data: 'admin_add_gift_coupon', style: 'primary' }
        ]
      ];

      coupons.forEach((c, idx) => {
        inline_keyboard.push([
          {
            text: `🗑 حذف کد ${c.code} (${c.giftAmount ? `${c.giftAmount.toLocaleString()} ت` : `${c.discountPercent}%`})`,
            callback_data: `admin_del_coupon_${idx}`,
            style: 'danger'
          }
        ]);
      });

      inline_keyboard.push([
        { text: '🔙 بازگشت به پنل مدیریت', callback_data: 'admin_main', style: 'primary' }
      ]);

      if (editMsgId) {
        await bot
          .editMessageText(msg, { chat_id: adminChatId, message_id: editMsgId, parse_mode: 'HTML', reply_markup: { inline_keyboard } })
          .catch(async () => {
            await bot.sendMessage(adminChatId, msg, { parse_mode: 'HTML', reply_markup: { inline_keyboard } });
          });
      } else {
        await bot.sendMessage(adminChatId, msg, { parse_mode: 'HTML', reply_markup: { inline_keyboard } });
      }
    };

    const processPendingReferralReward = async (buyerChatId: number, seller: User) => {
      const botCfg = seller.sellerBot;
      if (!botCfg || !botCfg.buyers) return;
      const buyerRec = botCfg.buyers.find(b => b.chatId === buyerChatId);
      if (!buyerRec || buyerRec.referralRewarded || !buyerRec.referredBy || buyerRec.referredBy === buyerChatId) return;

      const referrer = botCfg.buyers.find(b => b.chatId === buyerRec.referredBy);
      buyerRec.referralRewarded = true;
      if (!referrer) {
        db.saveUser(seller);
        return;
      }

      referrer.referralCount = (referrer.referralCount || 0) + 1;
      const reward = Math.max(0, Number(botCfg.referralRewardToman) || 0);
      if (reward > 0) {
        referrer.balance = (referrer.balance || 0) + reward;
        referrer.referralEarnings = (referrer.referralEarnings || 0) + reward;
      }
      db.saveUser(seller);

      const notifyText =
        `🎉 <b>تبریک! یک کاربر جدید (${escapeHtml(buyerRec.name || 'کاربر')}) با لینک دعوت اختصاصی شما وارد ربات شد!</b>\n\n` +
        `👥 <b>تعداد کل زیرمجموعه‌های شما:</b> <b>${referrer.referralCount} نفر</b>\n` +
        (reward > 0
          ? `🎁 <b>پاداش واریزشده به کیف پول شما:</b> <b>${reward.toLocaleString()} تومان</b>\n💰 <b>موجودی فعلی کیف پول:</b> <b>${(referrer.balance || 0).toLocaleString()} تومان</b>`
          : '');
      await bot.sendMessage(referrer.chatId, notifyText, { parse_mode: 'HTML' }).catch(() => {});
    };

    const startProductInvoiceOrWalletFlow = async (
      buyerChatId: number,
      seller: User,
      product: any,
      customName?: string
    ) => {
      const botCfg = seller.sellerBot || ({} as SellerBotConfig);
      const { wholesalePrice, retailPrice: baseRetailPrice } = this.getProductPricesForSeller(seller, product);
      const buyerRecord = (botCfg.buyers || []).find(b => b.chatId === buyerChatId);
      const buyerBalance = buyerRecord?.balance || 0;
      const sessionKey = getSessionKey(buyerChatId);
      const existingSession = this.userSessionStates.get(sessionKey);
      const appliedCouponCode = existingSession?.data?.appliedCouponCode as string | undefined;

      let retailPrice = baseRetailPrice;
      let appliedDiscountPct = 0;

      if (appliedCouponCode && Array.isArray(botCfg.coupons)) {
        const matchedCoupon = botCfg.coupons.find(
          c => c.code.toUpperCase() === appliedCouponCode.toUpperCase() && (c.discountPercent || 0) > 0
        );
        if (
          matchedCoupon &&
          (matchedCoupon.usedCount || 0) < (matchedCoupon.maxUsage || 100000) &&
          !(matchedCoupon.usedBy && matchedCoupon.usedBy[String(buyerChatId)])
        ) {
          appliedDiscountPct = Math.min(100, Math.max(0, Number(matchedCoupon.discountPercent) || 0));
          retailPrice = Math.max(0, Math.round(baseRetailPrice * (1 - appliedDiscountPct / 100)));
          matchedCoupon.usedCount = (matchedCoupon.usedCount || 0) + 1;
          if (!matchedCoupon.usedBy) matchedCoupon.usedBy = {};
          matchedCoupon.usedBy[String(buyerChatId)] = 1;
          db.saveUser(seller);
        }
      }

      // If buyer has enough balance in Bot 2 wallet (or 100% coupon makes retailPrice === 0), fulfill immediately!
      if ((buyerBalance >= retailPrice && retailPrice > 0) || (retailPrice === 0 && appliedDiscountPct === 100)) {
        if (buyerRecord && retailPrice > 0) {
          buyerRecord.balance = Math.max(0, buyerBalance - retailPrice);
        }
        const orderId = `ord_${Date.now()}_${Math.floor(100 + Math.random() * 899)}`;
        const newOrder: SellerBotOrder = {
          id: orderId,
          buyerChatId,
          buyerUsername: buyerRecord?.username || '',
          buyerName: buyerRecord?.name || 'مشتری',
          type: 'product',
          productId: product.id,
          productName: product.name,
          volumeGb: product.volumeGb,
          durationDays: product.durationDays,
          retailPrice,
          wholesalePrice,
          profit: Math.max(0, retailPrice - wholesalePrice),
          customName,
          status: 'pending',
          createdAt: new Date().toISOString()
        };
        if (!botCfg.orders) botCfg.orders = [];
        botCfg.orders.push(newOrder);
        db.saveUser(seller);

        await bot.sendMessage(
          buyerChatId,
          `⏳ مبلغ <b>${retailPrice.toLocaleString()} تومان</b> از کیف پول شما کسر شد. در حال ساخت و تحویل آنی کانفیگ...`,
          { parse_mode: 'HTML', reply_markup: getMainKeyboard(seller, buyerChatId === sellerChatId) }
        );

        const res = await this.fulfillResellerOrder(sellerChatId, orderId);
        if (!res.success) {
          // Refund buyer wallet on error
          const freshSeller = db.getUser(sellerChatId);
          const freshBuyer = freshSeller?.sellerBot?.buyers?.find(b => b.chatId === buyerChatId);
          if (freshBuyer && freshSeller) {
            freshBuyer.balance = (freshBuyer.balance || 0) + retailPrice;
            db.saveUser(freshSeller);
          }
          await bot.sendMessage(buyerChatId, `❌ خطا در صدور سرویس: ${res.message}\nمبلغ به کیف پول شما بازگردانده شد.`);
        }
        return;
      }

      const payableAmount = Math.max(0, retailPrice - buyerBalance);

      this.userSessionStates.set(sessionKey, {
        action: 'awaiting_receipt',
        data: {
          type: 'product',
          productId: product.id,
          productName: product.name,
          volumeGb: product.volumeGb,
          durationDays: product.durationDays,
          retailPrice,
          payableAmount,
          usedWalletAmount: buyerBalance > 0 ? buyerBalance : 0,
          wholesalePrice,
          customName
        }
      });

      const cardNum = (botCfg.cardNumber || '').trim() || 'شماره کارت توسط مدیر فروشگاه ثبت نشده است';
      const cardHolder = (botCfg.cardHolder || '').trim() || 'مدیر فروشگاه';

      const paymentMsg =
        `💳 <b>فاکتور خرید ${escapeHtml(product.name)}:</b>\n\n` +
        (customName ? `🏷 <b>نام انتخابی کانفیگ:</b> <code>${escapeHtml(customName)}</code>\n` : '') +
        `📊 <b>حجم:</b> ${product.volumeGb} گیگابایت\n` +
        `⏳ <b>مدت اعتبار:</b> ${product.durationDays || 'نامحدود'} روز\n` +
        `💰 <b>قیمت سرویس:</b> ${retailPrice.toLocaleString()} تومان\n` +
        (buyerBalance > 0
          ? `👛 <b>کسر از موجودی کیف پول شما:</b> ${buyerBalance.toLocaleString()} تومان\n💵 <b>مبلغ باقیمانده جهت واریز:</b> <b>${payableAmount.toLocaleString()} تومان</b>\n\n`
          : `💵 <b>مبلغ قابل پرداخت:</b> <b>${payableAmount.toLocaleString()} تومان</b>\n\n`) +
        `🏦 <b>شماره کارت جهت واریز:</b>\n` +
        `<code>${escapeHtml(cardNum)}</code>\n` +
        `👤 <b>به نام:</b> <b>${escapeHtml(cardHolder)}</b>\n\n` +
        `📸 لطفاً پس از واریز مبلغ، <b>عکس فیش واریزی</b> را همینجا در ربات ارسال فرمایید تا کانفیگ شما صادر شود.`;

      await bot.sendMessage(buyerChatId, paymentMsg, {
        parse_mode: 'HTML',
        reply_markup: {
          keyboard: [[{ text: 'بازگشت به منوی اصلی', style: 'danger' } as any]],
          resize_keyboard: true
        }
      });
    };

    // Error safety for polling
    bot.on('polling_error', (error: any) => {
      const errMsg = error?.message || String(error);
      if (errMsg.includes('401') || errMsg.includes('404') || errMsg.includes('Unauthorized') || errMsg.includes('Not Found')) {
        this.stopResellerBot(sellerChatId).catch(() => {});
        return;
      }
      if (errMsg.includes('409') || errMsg.includes('Conflict')) {
        return;
      }
    });

    bot.on('error', () => {});

    // Handle incoming messages
    bot.on('message', async msg => {
      try {
        if (!msg.from || !msg.chat) return;
        const buyerChatId = msg.chat.id;
        const text = (msg.text || '').trim();
        const sessionKey = getSessionKey(buyerChatId);

        const seller = db.getUser(sellerChatId);
        if (!seller || !seller.sellerBot || !seller.sellerBot.enabled) {
          return;
        }
        const botCfg = seller.sellerBot;
        const targetAdminChatId = botCfg.adminChatId ? Number(botCfg.adminChatId) : sellerChatId;
        const isUserAdmin = buyerChatId === targetAdminChatId || buyerChatId === sellerChatId;

        // Track buyer in reseller's buyers list & parse /start referral payload
        if (!botCfg.buyers) botCfg.buyers = [];
        let buyerRecord = botCfg.buyers.find(b => b.chatId === buyerChatId);
        let parsedRefId: number | undefined;
        if (text.startsWith('/start')) {
          const rawParam = text.replace(/^\/start\s*/i, '').replace(/^ref_/i, '').trim();
          const numRef = parseInt(rawParam, 10);
          if (!isNaN(numRef) && numRef > 0 && numRef !== buyerChatId) {
            parsedRefId = numRef;
          }
        }

        if (!buyerRecord) {
          buyerRecord = {
            chatId: buyerChatId,
            username: msg.from.username || '',
            name: [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' ') || 'کاربر',
            joinedAt: new Date().toISOString(),
            balance: 0,
            referredBy: parsedRefId,
            referralRewarded: false,
            referralCount: 0,
            referralEarnings: 0
          };
          botCfg.buyers.push(buyerRecord);
          db.saveUser(seller);
        } else {
          if (msg.from.username && buyerRecord.username !== msg.from.username) {
            buyerRecord.username = msg.from.username;
            db.saveUser(seller);
          }
        }

        // Enforce Force Join for non-admin buyers
        if (!isUserAdmin) {
          if (text === '✅ عضو شدم' || text === 'بررسی عضویت') {
            this.forceJoinCache.delete(`${sellerChatId}_${buyerChatId}`);
          }
          const isJoined = await checkBuyerForceJoin(buyerChatId, seller);
          if (!isJoined) return;
        }

        // Process referral reward once buyer has passed Force Join
        if (buyerRecord.referredBy && !buyerRecord.referralRewarded) {
          await processPendingReferralReward(buyerChatId, seller);
        }

        const effectiveBotName = this.getEffectiveBotName(seller);

        // Handle /start or Main Menu return
        if (
          text.startsWith('/start') ||
          text === '✅ عضو شدم' ||
          text === 'بازگشت به منوی اصلی' ||
          text === '🔙 بازگشت به منوی اصلی' ||
          text === 'منوی اصلی' ||
          text === '/menu' ||
          text === '/cancel'
        ) {
          this.userSessionStates.delete(sessionKey);
          const customWelcome = (botCfg.welcomeMessage || '').trim();
          let welcome = customWelcome
            ? `${customWelcome}\n\n🆔 شناسه کاربری شما: <code>${buyerChatId}</code>\n💰 موجودی کیف پول: <b>${(buyerRecord.balance || 0).toLocaleString()} تومان</b>`
            : `👋 سلام <b>${escapeHtml(msg.from.first_name || 'کاربر گرامی')}</b> عزیز،\nبه ربات رسمی فروش اشتراک‌های پرسرعت <b>${escapeHtml(effectiveBotName)}</b> خوش آمدید! 🚀\n\n🆔 شناسه کاربری شما: <code>${buyerChatId}</code>\n💰 موجودی کیف پول: <b>${(buyerRecord.balance || 0).toLocaleString()} تومان</b>\n\nلطفاً یکی از گزینه‌های منوی زیر را انتخاب نمایید:`;

          if (isUserAdmin) {
            welcome += `\n\n👑 <i>(شما مدیر این ربات هستید. دکمه «👑 پنل مدیریت ربات» برای مدیریت کامل مشتریان، پیام همگانی، عضویت اجباری، قیمت‌ها و پنل همکار فعال است.)</i>`;
          }

          if (botCfg.logoUrl && /^https?:\/\//i.test(botCfg.logoUrl)) {
            try {
              await bot.sendPhoto(buyerChatId, botCfg.logoUrl, {
                caption: welcome,
                parse_mode: 'HTML',
                reply_markup: getMainKeyboard(seller, isUserAdmin)
              });
              return;
            } catch (e) {}
          }

          await bot.sendMessage(buyerChatId, welcome, {
            parse_mode: 'HTML',
            reply_markup: getMainKeyboard(seller, isUserAdmin)
          });
          return;
        }

        // Handle Admin Panel
        if (
          (text === '👑 پنل مدیریت ربات و پنل همکار (ویژه شما)' ||
            text === '👑 پنل مدیریت ربات (ویژه شما)' ||
            text === '👑 پنل مدیریت ربات' ||
            text === '👑 پنل همکار' ||
            text === '/admin' ||
            text === '/panel' ||
            text === 'مدیریت') &&
          isUserAdmin
        ) {
          this.userSessionStates.delete(sessionKey);
          await sendAdminPanelMenu(buyerChatId, seller);
          return;
        }

        // Handle Buy Service Menu (Grouped by Category just like Bot 1)
        if (
          text === '🛒 خرید سرویس' ||
          text === '🛍 خرید اشتراک وی‌پی‌ان' ||
          text === '/buy' ||
          text === 'خرید اشتراک'
        ) {
          this.userSessionStates.delete(sessionKey);
          await sendCategoriesOrProductsMenu(buyerChatId, seller);
          return;
        }

        // Handle Custom Volume Purchase
        if (text === '⚡ خرید حجم دلخواه') {
          this.userSessionStates.delete(sessionKey);
          const state = db.getState();
          if (state.customVolumeEnabled === false) {
            await bot.sendMessage(buyerChatId, '⚠️ خرید حجم دلخواه در حال حاضر غیرفعال است.');
            return;
          }

          const { retailPricePerGb } = this.getCustomVolumePricesForSeller(seller);
          this.userSessionStates.set(sessionKey, { action: 'awaiting_custom_volume_gb' });

          await bot.sendMessage(
            buyerChatId,
            `⚡ <b>خرید سرویس با حجم انتخابی شما:</b>\n\n` +
              `💰 نرخ هر گیگابایت: <b>${retailPricePerGb.toLocaleString()} تومان</b> (مدت اعتبار: ۳۰ روز)\n\n` +
              `لطفاً میزان حجم درخواستی خود را به <b>عدد گیگابایت</b> (مثلاً: 15 یا 30 یا 50) ارسال نمایید:`,
            {
              parse_mode: 'HTML',
              reply_markup: {
                keyboard: [[{ text: 'بازگشت به منوی اصلی', style: 'danger' } as any]],
                resize_keyboard: true
              }
            }
          );
          return;
        }

        // Handle Free Test Account
        if (text === '🎁 تست رایگان' || text === '🎁 دریافت اکانت تست رایگان') {
          this.userSessionStates.delete(sessionKey);
          if (botCfg.freeTestEnabled === false) {
            await bot.sendMessage(buyerChatId, '⚠️ اکانت تست در حال حاضر غیرفعال می‌باشد.');
            return;
          }

          if (buyerRecord.testUsed && !isUserAdmin) {
            await bot.sendMessage(
              buyerChatId,
              '⚠️ شما قبلاً یک‌بار اکانت تست رایگان دریافت نموده‌اید. جهت ادامه استفاده، لطفاً از منوی «🛒 خرید سرویس» اقدام نمایید.'
            );
            return;
          }

          await bot.sendMessage(buyerChatId, '⏳ در حال ساخت اکانت تست رایگان شما در سرور...');

          try {
            const state = db.getState();
            const volGb = botCfg.freeTestVolumeGb || state.freeTestVolumeGb || 1;
            const durDays = botCfg.freeTestDurationDays || state.freeTestDurationDays || 1;
            const cleanCustom = `test_${buyerChatId}_${Date.now().toString().slice(-4)}`;

            const clientResult = await multiPanel.createClientConfig({
              user: seller,
              product: {
                name: `تست رایگان (${volGb}GB - ${durDays} روز)`,
                volumeGb: volGb,
                durationDays: durDays,
                panelType: (state.freeTestPanel as any) || 'sanaei',
                inboundIds: state.freeTestInboundIds,
                limitIp: 1
              },
              customName: cleanCustom
            });

            buyerRecord.testUsed = true;
            const mainSub =
              clientResult.subUrl ||
              clientResult.sanaeiSubUrl ||
              clientResult.rebeccaSubUrl ||
              clientResult.mroceanSubUrl ||
              clientResult.panel4SubUrl ||
              '';

            const testPurchase: any = {
              id: clientResult.clientEmail,
              name: `تست رایگان (${volGb}GB - ${durDays} روز)`,
              price: 0,
              subId: clientResult.subId,
              subUrl: mainSub,
              sanaeiSubUrl: clientResult.sanaeiSubUrl,
              rebeccaSubUrl: clientResult.rebeccaSubUrl,
              mroceanSubUrl: clientResult.mroceanSubUrl,
              panel4SubUrl: clientResult.panel4SubUrl,
              panelType: clientResult.panelType,
              volumeGb: volGb,
              durationDays: durDays,
              createdAt: new Date().toISOString()
            };

            seller.purchases = seller.purchases || [];
            seller.purchases.push(testPurchase);

            const testOrder: SellerBotOrder = {
              id: `ord_test_${Date.now()}`,
              buyerChatId,
              buyerUsername: buyerRecord.username,
              buyerName: buyerRecord.name,
              type: 'free_test',
              productName: testPurchase.name,
              volumeGb: volGb,
              durationDays: durDays,
              retailPrice: 0,
              wholesalePrice: 0,
              profit: 0,
              status: 'approved',
              createdAt: testPurchase.createdAt,
              approvedAt: testPurchase.createdAt,
              deliveredPurchaseId: testPurchase.id,
              deliveredSubUrl: mainSub
            };
            if (!botCfg.orders) botCfg.orders = [];
            botCfg.orders.push(testOrder);
            db.saveUser(seller);

            await this.sendBuyerServiceInfo(bot, seller, buyerChatId, { order: testOrder, purchase: testPurchase });
          } catch (testErr: any) {
            await bot.sendMessage(buyerChatId, '❌ خطا در صدور اکانت تست. لطفاً با پشتیبانی در ارتباط باشید.');
          }
          return;
        }

        // Handle My Services / Purchases List
        if (text === '📋 لیست خریدهای من' || text === '👤 سرویس‌های من') {
          this.userSessionStates.delete(sessionKey);
          await sendMyServicesList(buyerChatId, seller);
          return;
        }

        // Handle Referral Menu
        if (text === '🔗 زیرمجموعه‌گیری' || text === '🎁 زیرمجموعه‌گیری') {
          this.userSessionStates.delete(sessionKey);
          await sendBuyerReferralMenu(buyerChatId, seller);
          return;
        }

        // Handle Profile & Balance
        if (text === '👤 پروفایل و موجودی') {
          this.userSessionStates.delete(sessionKey);
          const myApprovedOrders = (botCfg.orders || []).filter(
            o => o.buyerChatId === buyerChatId && o.status === 'approved' && o.type !== 'deposit'
          );
          const profileMsg =
            `👤 <b>پروفایل کاربری شما در ${escapeHtml(effectiveBotName)}:</b>\n\n` +
            `🆔 <b>شناسه عددی شما:</b> <code>${buyerChatId}</code>\n` +
            `👤 <b>نام:</b> ${escapeHtml(buyerRecord.name || 'کاربر')}\n` +
            `💰 <b>موجودی کیف پول:</b> <b>${(buyerRecord.balance || 0).toLocaleString()} تومان</b>\n` +
            `📦 <b>تعداد سرویس‌های خریداری‌شده:</b> <b>${myApprovedOrders.length} عدد</b>\n` +
            `👥 <b>زیرمجموعه‌های دعوت‌شده:</b> <b>${(buyerRecord.referralCount || 0).toLocaleString()} نفر</b>\n\n` +
            `شما می‌توانید از طریق دکمه‌های زیر موجودی کیف پول خود را شارژ نمایید، کد هدیه ثبت کنید یا لینک دعوت دریافت نمایید:`;

          await bot.sendMessage(buyerChatId, profileMsg, {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [{ text: '💳 افزایش موجودی کیف پول (کارت به کارت)', callback_data: 'buyer_deposit_start', style: 'success' }],
                [
                  { text: '🎁 ثبت کد هدیه / تخفیف', callback_data: 'buyer_redeem_gift_code', style: 'success' },
                  { text: '🔗 زیرمجموعه‌گیری', callback_data: 'buyer_referral_menu', style: 'primary' }
                ],
                [{ text: '📋 مشاهده سرویس‌های من', callback_data: 'my_services_list', style: 'primary' }]
              ]
            }
          });
          return;
        }

        // Handle Deposit / Charge Balance
        if (text === '💳 افزایش موجودی' || text === '💳 راهنمای پرداخت') {
          this.userSessionStates.delete(sessionKey);
          this.userSessionStates.set(sessionKey, { action: 'awaiting_deposit_amount' });
          await bot.sendMessage(
            buyerChatId,
            `💳 <b>افزایش موجودی کیف پول</b>\n\n` +
              `💰 موجودی فعلی شما: <b>${(buyerRecord.balance || 0).toLocaleString()} تومان</b>\n\n` +
              `لطفاً مبلغی که می‌خواهید کیف پول خود را شارژ کنید به <b>تومان</b> (مثلاً: <code>100000</code> یا <code>۱۰۰ هزار</code>) وارد نمایید:`,
            {
              parse_mode: 'HTML',
              reply_markup: {
                keyboard: [[{ text: 'بازگشت به منوی اصلی', style: 'danger' } as any]],
                resize_keyboard: true
              }
            }
          );
          return;
        }

        // Handle Support
        if (text === '📞 پشتیبانی و راهنما' || text === '📞 پشتیبانی') {
          this.userSessionStates.delete(sessionKey);
          const supRaw = (botCfg.supportUsername || seller.username || '').replace(/^@/, '').trim();
          const supDisplay = supRaw ? `@${supRaw}` : 'از طریق ارسال پیام در همین ربات';
          const chRaw = (botCfg.channelUsername || '').replace(/^@/, '').trim();

          await bot.sendMessage(
            buyerChatId,
            `📞 <b>ارتباط با پشتیبانی ${escapeHtml(effectiveBotName)}:</b>\n\n` +
              `👤 <b>پشتیبانی تلگرام:</b> ${supDisplay}\n` +
              (chRaw ? `📢 <b>کانال اطلاع‌رسانی:</b> @${chRaw}\n` : '') +
              `\nدر صورت داشتن هرگونه سوال در خصوص خرید، تمدید یا اتصال سرویس‌ها با پشتیبانی در ارتباط باشید.`,
            { parse_mode: 'HTML' }
          );
          return;
        }

        // ====================================================================
        // SESSION STATE HANDLERS (Buyer & Reseller Admin)
        // ====================================================================
        const session = this.userSessionStates.get(sessionKey);

        // 1. Admin Session States (Reseller configuring their bot or charging buyers)
        if (session && isUserAdmin) {
          if (session.action === 'admin_set_card_number') {
            botCfg.cardNumber = text.trim();
            db.saveUser(seller);
            this.userSessionStates.set(sessionKey, { action: 'admin_set_card_holder' });
            await bot.sendMessage(
              buyerChatId,
              `✅ شماره کارت <code>${escapeHtml(botCfg.cardNumber)}</code> ثبت شد.\n\n👤 اکنون <b>نام و نام خانوادگی صاحب کارت</b> را ارسال نمایید:`,
              { parse_mode: 'HTML' }
            );
            return;
          }

          if (session.action === 'admin_set_card_holder') {
            botCfg.cardHolder = text.trim();
            db.saveUser(seller);
            this.userSessionStates.delete(sessionKey);
            await bot.sendMessage(
              buyerChatId,
              `✅ اطلاعات کارت بانکی اختصاصی شما با موفقیت ذخیره شد:\n💳 <code>${escapeHtml(botCfg.cardNumber || '')}</code>\n👤 به نام: <b>${escapeHtml(botCfg.cardHolder)}</b>`,
              { parse_mode: 'HTML', reply_markup: getMainKeyboard(seller, true) }
            );
            await sendAdminPanelMenu(buyerChatId, seller);
            return;
          }

          if (session.action === 'admin_set_prod_price' && session.data?.productId) {
            const parsed = parseAmountInput(text);
            if (parsed === null || parsed < 0) {
              await bot.sendMessage(buyerChatId, '❌ لطفاً یک مبلغ معتبر به تومان وارد کنید (مثلاً 85000):');
              return;
            }
            const prodId = session.data.productId;
            if (!botCfg.customRetailPrices) botCfg.customRetailPrices = {};
            botCfg.customRetailPrices[prodId] = parsed;
            if (!seller.customDisplayPrices) seller.customDisplayPrices = {};
            seller.customDisplayPrices[prodId] = parsed;
            db.saveUser(seller);
            this.userSessionStates.delete(sessionKey);

            await bot.sendMessage(
              buyerChatId,
              `✅ قیمت فروش محصول در ربات شما به <b>${parsed.toLocaleString()} تومان</b> تغییر یافت.`,
              { parse_mode: 'HTML', reply_markup: getMainKeyboard(seller, true) }
            );
            return;
          }

          if (session.action === 'admin_set_cvol_price') {
            const parsed = parseAmountInput(text);
            if (parsed === null || parsed <= 0) {
              await bot.sendMessage(buyerChatId, '❌ لطفاً نرخ هر گیگابایت را به تومان وارد کنید (مثلاً 4500):');
              return;
            }
            botCfg.customVolumeRetailPricePerGb = parsed;
            db.saveUser(seller);
            this.userSessionStates.delete(sessionKey);
            await bot.sendMessage(
              buyerChatId,
              `✅ نرخ فروش هر گیگابایت حجم دلخواه در ربات شما به <b>${parsed.toLocaleString()} تومان</b> تغییر یافت.`,
              { parse_mode: 'HTML', reply_markup: getMainKeyboard(seller, true) }
            );
            return;
          }

          if (session.action === 'admin_set_support_id') {
            botCfg.supportUsername = text.replace(/^@/, '').trim();
            db.saveUser(seller);
            this.userSessionStates.delete(sessionKey);
            await bot.sendMessage(
              buyerChatId,
              `✅ آیدی پشتیبانی ربات شما به @${escapeHtml(botCfg.supportUsername)} تغییر یافت.`,
              { parse_mode: 'HTML', reply_markup: getMainKeyboard(seller, true) }
            );
            return;
          }

          if (session.action === 'admin_set_bot_name') {
            botCfg.botName = text.trim();
            db.saveUser(seller);
            this.userSessionStates.delete(sessionKey);
            await bot.sendMessage(
              buyerChatId,
              `✅ نام نمایشی ربات و فروشگاه شما به <b>${escapeHtml(this.getEffectiveBotName(seller))}</b> تغییر یافت.`,
              { parse_mode: 'HTML', reply_markup: getMainKeyboard(seller, true) }
            );
            return;
          }

          if (session.action === 'admin_set_welcome_msg') {
            botCfg.welcomeMessage = text === '/clear' || text === 'حذف' || text === 'پیشفرض' ? '' : text.trim();
            db.saveUser(seller);
            this.userSessionStates.delete(sessionKey);
            await bot.sendMessage(
              buyerChatId,
              botCfg.welcomeMessage
                ? `✅ متن خوش‌آمدگویی سفارشی استارت ربات شما با موفقیت ذخیره شد.`
                : `✅ متن خوش‌آمدگویی به حالت پیش‌فرض (با نام ربات <b>${escapeHtml(this.getEffectiveBotName(seller))}</b>) بازگردانده شد.`,
              { parse_mode: 'HTML', reply_markup: getMainKeyboard(seller, true) }
            );
            await sendAdminPanelMenu(buyerChatId, seller);
            return;
          }

          if (session.action === 'admin_add_fj_channel') {
            const rawInput = text.trim();
            if (!rawInput) {
              await bot.sendMessage(buyerChatId, '❌ لطفاً آیدی کانال (مثلاً <code>@MyChannel</code>) را ارسال کنید:', { parse_mode: 'HTML' });
              return;
            }
            const parts = rawInput.split(/[,\n|]/).map(s => s.trim()).filter(Boolean);
            let chId = parts[0];
            let chName = parts[1] || `کانال رسمی ${this.getEffectiveBotName(seller)}`;
            let chUrl = parts[2] || '';

            if (chId.startsWith('https://t.me/') || chId.startsWith('http://t.me/')) {
              const slug = chId.replace(/^https?:\/\/t\.me\//i, '').replace(/\/.*$/, '').trim();
              if (!slug.startsWith('+')) {
                chId = `@${slug}`;
                if (!chUrl) chUrl = `https://t.me/${slug}`;
              } else {
                if (!chUrl) chUrl = parts[0];
              }
            } else if (!chId.startsWith('@') && !chId.startsWith('-100') && isNaN(Number(chId))) {
              chId = `@${chId}`;
            }

            if (!chUrl) {
              const cleanUsername = chId.replace(/^@/, '');
              chUrl = `https://t.me/${cleanUsername}`;
            }

            if (!botCfg.forceJoinChannels) botCfg.forceJoinChannels = [];
            botCfg.forceJoinChannels.push({ id: chId, name: chName, url: chUrl });
            botCfg.forceJoinEnabled = true;
            this.forceJoinCache.clear();
            db.saveUser(seller);
            this.userSessionStates.delete(sessionKey);

            await bot.sendMessage(
              buyerChatId,
              `✅ <b>کانال <code>${escapeHtml(chId)}</code> با موفقیت به عضویت اجباری ربات شما اضافه و فعال شد!</b>\n\n` +
                `⚠️ <b>یادآوری مهم:</b> حتماً ربات خودتان (${botCfg.botUsername ? `@${escapeHtml(botCfg.botUsername)}` : 'ربات'}) را در کانال <code>${escapeHtml(chId)}</code> <b>Admin (مدیر)</b> کنید تا ربات بتواند عضویت کاربران را تشخیص دهد.`,
              { parse_mode: 'HTML', reply_markup: getMainKeyboard(seller, true) }
            );
            await sendForceJoinMenu(buyerChatId, seller);
            return;
          }

          if (session.action === 'admin_broadcast_msg') {
            this.userSessionStates.delete(sessionKey);
            const buyerIds = new Set<number>();
            for (const b of botCfg.buyers || []) {
              if (b.chatId) buyerIds.add(Number(b.chatId));
            }
            for (const o of botCfg.orders || []) {
              if (o.buyerChatId) buyerIds.add(Number(o.buyerChatId));
            }
            const targets = Array.from(buyerIds);
            if (targets.length === 0) {
              await bot.sendMessage(buyerChatId, 'ℹ️ هنوز هیچ کاربری در ربات شما ثبت نشده است.', {
                reply_markup: getMainKeyboard(seller, true)
              });
              return;
            }

            await bot.sendMessage(
              buyerChatId,
              `⏳ در حال ارسال پیام همگانی به <b>${targets.length} کاربر</b> ربات شما... لطفاً چند لحظه صبر کنید.`,
              { parse_mode: 'HTML', reply_markup: getMainKeyboard(seller, true) }
            );

            let successCount = 0;
            let failCount = 0;
            const hasPhoto = !!(msg.photo && msg.photo.length > 0);
            const largestPhoto = hasPhoto ? msg.photo![msg.photo!.length - 1] : null;
            const broadcastHeader = `📢 <b>اطلاعیه ${escapeHtml(this.getEffectiveBotName(seller))}:</b>\n\n`;

            for (const targetId of targets) {
              try {
                if (hasPhoto && largestPhoto) {
                  const captionText = msg.caption ? `${broadcastHeader}${escapeHtml(msg.caption)}` : `📢 <b>${escapeHtml(this.getEffectiveBotName(seller))}</b>`;
                  await bot.sendPhoto(targetId, largestPhoto.file_id, {
                    caption: captionText.slice(0, 1024),
                    parse_mode: 'HTML'
                  });
                } else {
                  await bot.sendMessage(targetId, `${broadcastHeader}${escapeHtml(text)}`, {
                    parse_mode: 'HTML'
                  });
                }
                successCount++;
              } catch (e) {
                failCount++;
              }
              await new Promise(r => setTimeout(r, 35));
            }

            await bot.sendMessage(
              buyerChatId,
              `✅ <b>ارسال پیام همگانی به پایان رسید!</b>\n\n` +
                `🟢 ارسال موفق: <b>${successCount} نفر</b>\n` +
                `🔴 ناموفق (بلاک یا حذف ربات): <b>${failCount} نفر</b>`,
              { parse_mode: 'HTML' }
            );
            await sendAdminPanelMenu(buyerChatId, seller);
            return;
          }

          if (session.action === 'admin_charge_buyer_amount' && session.data?.targetBuyerChatId) {
            const targetId = Number(session.data.targetBuyerChatId);
            const mode: 'add' | 'sub' = session.data.mode || 'add';
            const amount = parseAmountInput(text);
            if (amount === null || amount <= 0) {
              await bot.sendMessage(buyerChatId, '❌ لطفاً مبلغ معتبر به تومان وارد نمایید:');
              return;
            }
            const targetBuyer = (botCfg.buyers || []).find(b => b.chatId === targetId);
            if (!targetBuyer) {
              this.userSessionStates.delete(sessionKey);
              await bot.sendMessage(buyerChatId, '❌ مشتری یافت نشد.');
              return;
            }
            if (mode === 'add') {
              targetBuyer.balance = (targetBuyer.balance || 0) + amount;
            } else {
              targetBuyer.balance = Math.max(0, (targetBuyer.balance || 0) - amount);
            }
            db.saveUser(seller);
            this.userSessionStates.delete(sessionKey);

            await bot.sendMessage(
              buyerChatId,
              `✅ موجودی کیف پول مشتری <code>${targetId}</code> (${escapeHtml(targetBuyer.name || '')}) با موفقیت به <b>${(targetBuyer.balance || 0).toLocaleString()} تومان</b> بروزرسانی شد.`,
              { parse_mode: 'HTML', reply_markup: getMainKeyboard(seller, true) }
            );

            await bot
              .sendMessage(
                targetId,
                mode === 'add'
                  ? `🎉 <b>حساب کیف پول شما توسط مدیریت فروشگاه به مبلغ ${amount.toLocaleString()} تومان شارژ شد!</b>\n💰 موجودی جدید شما: <b>${(targetBuyer.balance || 0).toLocaleString()} تومان</b>`
                  : `ℹ️ مبلغ ${amount.toLocaleString()} تومان از موجودی کیف پول شما کسر گردید.\n💰 موجودی فعلی: <b>${(targetBuyer.balance || 0).toLocaleString()} تومان</b>`,
                { parse_mode: 'HTML' }
              )
              .catch(() => {});
            return;
          }

          if (session.action === 'seller_pay_debt_amount') {
            const amount = parseAmountInput(text);
            if (amount === null || amount < 10000) {
              await bot.sendMessage(buyerChatId, '❌ لطفاً مبلغ تسویه بدهی را به تومان (حداقل ۱۰,۰۰۰ تومان) وارد فرمایید:');
              return;
            }
            const state = db.getState();
            const masterCard = (state.cardNumber || '').trim() || 'شماره کارت مدیریت ثبت نشده است';
            const masterHolder = (state.cardHolder || '').trim() || 'مدیریت اصلی';

            this.userSessionStates.set(sessionKey, {
              action: 'seller_pay_debt_receipt',
              data: { amount }
            });

            await bot.sendMessage(
              buyerChatId,
              `💳 <b>تسویه بدهی حساب همکاری شما:</b>\n\n` +
                `💰 <b>مبلغ تسویه:</b> <b>${amount.toLocaleString()} تومان</b>\n` +
                `📉 <b>بدهی فعلی شما:</b> <b>${(seller.debt || 0).toLocaleString()} تومان</b>\n\n` +
                `🏦 <b>شماره کارت جهت واریز وجه تسویه:</b>\n` +
                `<code>${escapeHtml(masterCard)}</code>\n` +
                `👤 <b>به نام:</b> <b>${escapeHtml(masterHolder)}</b>\n\n` +
                `📸 لطفاً پس از واریز، <b>تصویر فیش واریزی</b> را همینجا ارسال نمایید تا پس از تایید، از بدهی همکاری شما کسر و سقف اعتبارتان آزاد شود:`,
              {
                parse_mode: 'HTML',
                reply_markup: {
                  keyboard: [[{ text: 'بازگشت به منوی اصلی', style: 'danger' } as any]],
                  resize_keyboard: true
                }
              }
            );
            return;
          }

          if (session.action === 'seller_direct_cvol_gb') {
            const gb = parseInt(text.replace(/[۰-۹]/g, d => String.fromCharCode(d.charCodeAt(0) - 1728)));
            if (isNaN(gb) || gb <= 0 || gb > 1000) {
              await bot.sendMessage(buyerChatId, '❌ لطفاً یک عدد معتبر بین ۱ تا ۱۰۰۰ گیگابایت وارد فرمایید:');
              return;
            }
            this.userSessionStates.delete(sessionKey);
            await bot.sendMessage(buyerChatId, `⏳ در حال صدور مستقیم کانفیگ حجم دلخواه ${gb} گیگابایت با نرخ همکاری شما...`, {
              reply_markup: getMainKeyboard(seller, true)
            });

            try {
              const purchase = await executeSellerCustomVolumePurchase({
                sellerChatId,
                volumeGb: gb,
                source: 'portal'
              });
              const updatedSeller = db.getUser(sellerChatId) || seller;
              await this.sendBuyerServiceInfo(bot, updatedSeller, buyerChatId, { purchase });
              await bot.sendMessage(
                buyerChatId,
                `✅ <b>کانفیگ مستقیم همکار (${gb} گیگابایت) صادر شد!</b>\n` +
                  `📉 مبلغ همکاری به لیست بدهی شما اضافه گردید.\n` +
                  `💰 بدهی فعلی شما: <b>${(updatedSeller.debt || 0).toLocaleString()} تومان</b>`,
                { parse_mode: 'HTML' }
              );
            } catch (err: any) {
              await bot.sendMessage(buyerChatId, `❌ خطا در صدور مستقیم کانفیگ: ${err?.message || String(err)}`);
            }
            return;
          }
          if (session.action === 'admin_set_referral_reward') {
            const parsed = parseAmountInput(text);
            if (parsed === null || parsed < 0) {
              await bot.sendMessage(buyerChatId, '❌ لطفاً مبلغ پاداش هر زیرمجموعه را به تومان وارد کنید (مثلاً 5000 یا 0 برای غیرفعال‌سازی):');
              return;
            }
            botCfg.referralRewardToman = parsed;
            db.saveUser(seller);
            this.userSessionStates.delete(sessionKey);
            await bot.sendMessage(
              buyerChatId,
              `✅ پاداش زیرمجموعه‌گیری ربات شما روی <b>${parsed > 0 ? `${parsed.toLocaleString()} تومان` : 'غیرفعال (۰ تومان)'}</b> تنظیم گردید.`,
              { parse_mode: 'HTML', reply_markup: getMainKeyboard(seller, true) }
            );
            await sendAdminReferralSettingsMenu(buyerChatId, seller);
            return;
          }

          if (session.action === 'admin_create_discount_coupon' || session.action === 'admin_create_gift_coupon') {
            const isGift = session.action === 'admin_create_gift_coupon';
            const parts = text.split(/[,\s|]+/).map(s => s.trim()).filter(Boolean);
            if (parts.length < 2) {
              await bot.sendMessage(
                buyerChatId,
                isGift
                  ? '❌ فرمت وارد شده صحیح نیست. لطفاً کد، مبلغ هدیه و تعداد مجاز را با فاصله بفرستید.\nمثال: <code>GIFT10 10000 50</code>'
                  : '❌ فرمت وارد شده صحیح نیست. لطفاً کد، درصد تخفیف و تعداد مجاز را با فاصله بفرستید.\nمثال: <code>OFF20 20 100</code>',
                { parse_mode: 'HTML' }
              );
              return;
            }
            const code = parts[0].toUpperCase();
            const val = parseAmountInput(parts[1]) ?? parseInt(parts[1], 10);
            const maxUsage = parts[2] ? (parseInt(parts[2], 10) || 100) : 100;

            if (!code || isNaN(val) || val <= 0 || (!isGift && val > 100)) {
              await bot.sendMessage(
                buyerChatId,
                isGift
                  ? '❌ مبلغ هدیه باید عددی بزرگتر از صفر باشد.'
                  : '❌ درصد تخفیف باید عددی بین 1 تا 100 باشد.'
              );
              return;
            }

            if (!botCfg.coupons) botCfg.coupons = [];
            botCfg.coupons = botCfg.coupons.filter(c => c.code.toUpperCase() !== code);
            botCfg.coupons.push({
              code,
              discountPercent: isGift ? 0 : val,
              giftAmount: isGift ? val : 0,
              maxUsage,
              usedCount: 0,
              usedBy: {}
            });
            db.saveUser(seller);
            this.userSessionStates.delete(sessionKey);

            await bot.sendMessage(
              buyerChatId,
              isGift
                ? `✅ <b>کد هدیه <code>${escapeHtml(code)}</code> به مبلغ ${val.toLocaleString()} تومان (ظرفیت: ${maxUsage} بار) با موفقیت ساخته شد!</b>`
                : `✅ <b>کد تخفیف <code>${escapeHtml(code)}</code> با ${val}% تخفیف خرید (ظرفیت: ${maxUsage} بار) با موفقیت ساخته شد!</b>`,
              { parse_mode: 'HTML', reply_markup: getMainKeyboard(seller, true) }
            );
            await sendAdminCouponsMenu(buyerChatId, seller);
            return;
          }
        }

        // 1.5 Buyer Session: Entering Gift Code or Product Discount Coupon
        if (session && session.action === 'buyer_enter_gift_code') {
          const codeInput = text.trim().toUpperCase();
          this.userSessionStates.delete(sessionKey);
          const coupons = botCfg.coupons || [];
          const found = coupons.find(c => c.code.toUpperCase() === codeInput);
          if (!found) {
            await bot.sendMessage(buyerChatId, '❌ کد وارد شده معتبر نیست یا منقضی شده است.', {
              reply_markup: getMainKeyboard(seller, isUserAdmin)
            });
            return;
          }
          if ((found.usedCount || 0) >= (found.maxUsage || 100000)) {
            await bot.sendMessage(buyerChatId, '❌ ظرفیت استفاده از این کد به پایان رسیده است.', {
              reply_markup: getMainKeyboard(seller, isUserAdmin)
            });
            return;
          }
          if (found.usedBy && found.usedBy[String(buyerChatId)]) {
            await bot.sendMessage(buyerChatId, '⚠️ شما قبلاً از این کد استفاده کرده‌اید.', {
              reply_markup: getMainKeyboard(seller, isUserAdmin)
            });
            return;
          }

          if (found.giftAmount && found.giftAmount > 0) {
            buyerRecord.balance = (buyerRecord.balance || 0) + found.giftAmount;
            found.usedCount = (found.usedCount || 0) + 1;
            if (!found.usedBy) found.usedBy = {};
            found.usedBy[String(buyerChatId)] = 1;
            db.saveUser(seller);
            await bot.sendMessage(
              buyerChatId,
              `🎉 <b>تبریک! کد هدیه <code>${escapeHtml(found.code)}</code> با موفقیت اعمال شد!</b>\n\n` +
                `🎁 مبلغ هدیه: <b>${found.giftAmount.toLocaleString()} تومان</b>\n` +
                `💰 موجودی جدید کیف پول شما: <b>${(buyerRecord.balance || 0).toLocaleString()} تومان</b>`,
              { parse_mode: 'HTML', reply_markup: getMainKeyboard(seller, isUserAdmin) }
            );
            return;
          } else if (found.discountPercent && found.discountPercent > 0) {
            await bot.sendMessage(
              buyerChatId,
              `✅ کد <code>${escapeHtml(found.code)}</code> شامل <b>${found.discountPercent}% تخفیف خرید سرویس</b> است!\n` +
                `لطفاً از منوی «🛒 خرید سرویس» محصول مورد نظر خود را انتخاب کرده و روی دکمه <b>«🎫 ثبت کد تخفیف روی این خرید»</b> کلیک نمایید.`,
              { parse_mode: 'HTML', reply_markup: getMainKeyboard(seller, isUserAdmin) }
            );
            return;
          }
        }

        if (session && session.action === 'buyer_enter_prod_coupon' && session.data?.productId) {
          const prodId = session.data.productId;
          const codeInput = text.trim().toUpperCase();
          const product = getAvailableProductsForReseller(seller).find(p => p.id === prodId);
          if (!product) {
            this.userSessionStates.delete(sessionKey);
            await bot.sendMessage(buyerChatId, '❌ محصول یافت نشد.', {
              reply_markup: getMainKeyboard(seller, isUserAdmin)
            });
            return;
          }

          const coupons = botCfg.coupons || [];
          const found = coupons.find(c => c.code.toUpperCase() === codeInput && (c.discountPercent || 0) > 0);
          if (!found) {
            await bot.sendMessage(buyerChatId, '❌ کد تخفیف وارد شده معتبر نیست. لطفاً مجدداً بررسی کنید یا از دکمه بازگشت استفاده نمایید:');
            return;
          }
          if ((found.usedCount || 0) >= (found.maxUsage || 100000)) {
            await bot.sendMessage(buyerChatId, '❌ ظرفیت استفاده از این کد تخفیف تمام شده است.');
            return;
          }
          if (found.usedBy && found.usedBy[String(buyerChatId)]) {
            await bot.sendMessage(buyerChatId, '⚠️ شما قبلاً از این کد تخفیف استفاده کرده‌اید.');
            return;
          }

          const { retailPrice: origRetail } = this.getProductPricesForSeller(seller, product);
          const discPct = Math.min(100, Math.max(0, Number(found.discountPercent) || 0));
          const discountedPrice = Math.max(0, Math.round(origRetail * (1 - discPct / 100)));
          const buyerBal = buyerRecord.balance || 0;

          this.userSessionStates.set(sessionKey, {
            action: 'coupon_ready',
            data: { productId: product.id, appliedCouponCode: found.code }
          });

          const detailMsg =
            `🎉 <b>کد تخفیف <code>${escapeHtml(found.code)}</code> (${discPct}%) اعمال شد!</b>\n\n` +
            `📦 <b>نام سرویس:</b> ${escapeHtml(product.name)}\n` +
            `📊 <b>حجم ترافیک:</b> ${product.volumeGb} گیگابایت\n` +
            `💰 <b>قیمت اصلی:</b> <s>${origRetail.toLocaleString()} تومان</s>\n` +
            `🟢 <b>قیمت با تخفیف ویژه:</b> <b>${discountedPrice.toLocaleString()} تومان</b>\n` +
            `👛 <b>موجودی کیف پول شما:</b> ${buyerBal.toLocaleString()} تومان\n\n` +
            `اکنون جهت تکمیل خرید با قیمت تخفیف‌خورده، یکی از دکمه‌های زیر را انتخاب نمایید:`;

          await bot.sendMessage(buyerChatId, detailMsg, {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text:
                      buyerBal >= discountedPrice || discountedPrice === 0
                        ? '⚡ خرید آنی با تخفیف (نام خودکار)'
                        : '🛒 تایید خرید با تخفیف و دریافت کارت (نام خودکار)',
                    callback_data: `confirm_buy_${product.id}`,
                    style: 'success'
                  }
                ],
                [
                  {
                    text: '✏️ انتخاب نام دلخواه برای کانفیگ (با تخفیف)',
                    callback_data: `custom_name_prod_${product.id}`,
                    style: 'primary'
                  }
                ]
              ]
            }
          });
          return;
        }

        // 2. Buyer Session: Entering custom config name
        if (session && session.action === 'awaiting_custom_name' && session.data?.productId) {
          const cleanName = sanitizeCustomConfigName(text);
          if (!cleanName || cleanName.length < 3) {
            await bot.sendMessage(
              buyerChatId,
              '❌ نام وارد شده معتبر نیست. لطفاً یک نام با حروف انگلیسی و اعداد (مثلاً <code>ali_vpn</code>) ارسال کنید:',
              { parse_mode: 'HTML' }
            );
            return;
          }
          const state = db.getState();
          const product = (state.products || []).find(p => p.id === session.data.productId);
          if (!product) {
            this.userSessionStates.delete(sessionKey);
            await bot.sendMessage(buyerChatId, '❌ محصول یافت نشد.');
            return;
          }
          await startProductInvoiceOrWalletFlow(buyerChatId, seller, product, cleanName);
          return;
        }

        // 3. Buyer Session: Entering deposit amount
        if (session && session.action === 'awaiting_deposit_amount') {
          const amount = parseAmountInput(text);
          if (amount === null || amount < 5000) {
            await bot.sendMessage(buyerChatId, '❌ لطفاً یک مبلغ معتبر (حداقل ۵,۰۰۰ تومان) وارد فرمایید:');
            return;
          }

          this.userSessionStates.set(sessionKey, {
            action: 'awaiting_receipt',
            data: {
              type: 'deposit',
              productName: `شارژ کیف پول (${amount.toLocaleString()} تومان)`,
              retailPrice: amount,
              payableAmount: amount,
              wholesalePrice: 0
            }
          });

          const cardNum = (botCfg.cardNumber || '').trim() || 'شماره کارت توسط مدیر فروشگاه ثبت نشده است';
          const cardHolder = (botCfg.cardHolder || '').trim() || 'مدیر فروشگاه';

          await bot.sendMessage(
            buyerChatId,
            `💳 <b>فاکتور افزایش موجودی کیف پول:</b>\n\n` +
              `💰 <b>مبلغ شارژ:</b> <b>${amount.toLocaleString()} تومان</b>\n\n` +
              `🏦 <b>شماره کارت جهت واریز:</b>\n` +
              `<code>${escapeHtml(cardNum)}</code>\n` +
              `👤 <b>به نام:</b> <b>${escapeHtml(cardHolder)}</b>\n\n` +
              `📸 لطفاً پس از واریز، <b>عکس فیش واریزی</b> را همینجا ارسال نمایید تا پس از تایید، موجودی شما شارژ شود:`,
            {
              parse_mode: 'HTML',
              reply_markup: {
                keyboard: [[{ text: 'بازگشت به منوی اصلی', style: 'danger' } as any]],
                resize_keyboard: true
              }
            }
          );
          return;
        }

        // 4. Buyer Session: Custom Volume GB Input
        if (session && session.action === 'awaiting_custom_volume_gb') {
          const gb = parseInt(text.replace(/[۰-۹]/g, d => String.fromCharCode(d.charCodeAt(0) - 1728)));
          if (isNaN(gb) || gb <= 0 || gb > 1000) {
            await bot.sendMessage(buyerChatId, '❌ لطفاً یک عدد معتبر بین ۱ تا ۱۰۰۰ گیگابایت وارد فرمایید:');
            return;
          }

          const { wholesalePricePerGb, retailPricePerGb } = this.getCustomVolumePricesForSeller(seller);
          const totalRetailPrice = gb * retailPricePerGb;
          const totalWholesalePrice = gb * wholesalePricePerGb;
          const buyerBalance = buyerRecord.balance || 0;

          if (buyerBalance >= totalRetailPrice && totalRetailPrice > 0) {
            buyerRecord.balance = Math.max(0, buyerBalance - totalRetailPrice);
            const orderId = `ord_${Date.now()}_${Math.floor(100 + Math.random() * 899)}`;
            const newOrder: SellerBotOrder = {
              id: orderId,
              buyerChatId,
              buyerUsername: buyerRecord.username || '',
              buyerName: buyerRecord.name || 'مشتری',
              type: 'custom_volume',
              volumeGb: gb,
              durationDays: 30,
              retailPrice: totalRetailPrice,
              wholesalePrice: totalWholesalePrice,
              profit: Math.max(0, totalRetailPrice - totalWholesalePrice),
              productName: `سرویس حجم دلخواه ${gb} گیگابایت`,
              status: 'pending',
              createdAt: new Date().toISOString()
            };
            if (!botCfg.orders) botCfg.orders = [];
            botCfg.orders.push(newOrder);
            db.saveUser(seller);
            this.userSessionStates.delete(sessionKey);

            await bot.sendMessage(
              buyerChatId,
              `⏳ مبلغ <b>${totalRetailPrice.toLocaleString()} تومان</b> از کیف پول شما کسر شد. در حال ساخت سرویس ${gb} گیگابایت...`,
              { parse_mode: 'HTML', reply_markup: getMainKeyboard(seller, isUserAdmin) }
            );
            await this.fulfillResellerOrder(sellerChatId, orderId);
            return;
          }

          const payableAmount = Math.max(0, totalRetailPrice - buyerBalance);
          this.userSessionStates.set(sessionKey, {
            action: 'awaiting_receipt',
            data: {
              type: 'custom_volume',
              volumeGb: gb,
              durationDays: 30,
              retailPrice: totalRetailPrice,
              payableAmount,
              usedWalletAmount: buyerBalance > 0 ? buyerBalance : 0,
              wholesalePrice: totalWholesalePrice,
              productName: `سرویس سفارشی ${gb} گیگابایت`
            }
          });

          const cardNum = (botCfg.cardNumber || '').trim() || 'شماره کارت توسط مدیر فروشگاه ثبت نشده است';
          const cardHolder = (botCfg.cardHolder || '').trim() || 'مدیر فروشگاه';

          await bot.sendMessage(
            buyerChatId,
            `✅ <b>سفارش حجم دلخواه ${gb} گیگابایت (۳۰ روزه) آماده پرداخت است:</b>\n\n` +
              `💰 قیمت کل: <b>${totalRetailPrice.toLocaleString()} تومان</b>\n` +
              (buyerBalance > 0
                ? `👛 کسر از کیف پول: <b>${buyerBalance.toLocaleString()} تومان</b>\n💵 مبلغ قابل واریز: <b>${payableAmount.toLocaleString()} تومان</b>\n\n`
                : `💵 مبلغ قابل واریز: <b>${payableAmount.toLocaleString()} تومان</b>\n\n`) +
              `💳 <b>شماره کارت جهت واریز:</b>\n` +
              `<code>${escapeHtml(cardNum)}</code>\n` +
              `👤 به نام: <b>${escapeHtml(cardHolder)}</b>\n\n` +
              `📸 لطفاً پس از واریز، <b>عکس فیش واریزی</b> را همینجا ارسال نمایید:`,
            {
              parse_mode: 'HTML',
              reply_markup: {
                keyboard: [[{ text: 'بازگشت به منوی اصلی', style: 'danger' } as any]],
                resize_keyboard: true
              }
            }
          );
          return;
        }

        // 5. Handle Photo Uploads (Receipt for Pending Order / Renewal / Wallet Deposit / Seller Debt Settlement)
        if (msg.photo && msg.photo.length > 0) {
          if (isUserAdmin && session?.action === 'seller_pay_debt_receipt' && session.data?.amount) {
            const amount = Number(session.data.amount) || 0;
            const largestPhoto = msg.photo[msg.photo.length - 1];
            const payId = `pay_${Date.now()}_${Math.floor(100 + Math.random() * 899)}`;
            const state = db.getState();
            state.pendingPayments = state.pendingPayments || [];
            state.pendingPayments.push({
              id: payId,
              chatId: sellerChatId,
              amount,
              fileId: largestPhoto.file_id,
              timestamp: Date.now(),
              pendingPurchase: {
                isSellerDebtPayment: true
              }
            });
            db.updateState({ pendingPayments: state.pendingPayments });
            this.userSessionStates.delete(sessionKey);

            // Forward receipt photo to main bot admins for 1-click debt settlement approval
            try {
              const masterBot = getBot();
              if (masterBot) {
                const fileUrl = await bot.getFileLink(largestPhoto.file_id);
                const imgRes = await axios.get(fileUrl, { responseType: 'arraybuffer', timeout: 15000 });
                const photoBuffer = Buffer.from(imgRes.data);
                const caption =
                  `💳 <b>فیش تسویه بدهی همکار (ارسال شده از ربات اختصاصی همکار)</b>\n\n` +
                  `👤 همکار: <b>${escapeHtml(seller.name || '')}</b> (<code>${sellerChatId}</code>)\n` +
                  `💰 مبلغ اعلامی واریزشده: <b>${amount.toLocaleString()} تومان</b>\n` +
                  `📉 بدهی فعلی همکار: <b>${(seller.debt || 0).toLocaleString()} تومان</b>`;

                for (const adminId of state.adminIds || []) {
                  await masterBot
                    .sendPhoto(adminId, photoBuffer, {
                      caption,
                      parse_mode: 'HTML',
                      reply_markup: {
                        inline_keyboard: [
                          [
                            { text: '✅ تایید و کسر از بدهی همکار', callback_data: `approve_pay_${payId}`, style: 'success' } as any,
                            { text: '❌ رد فیش', callback_data: `reject_pay_${payId}`, style: 'danger' } as any
                          ]
                        ]
                      }
                    })
                    .catch(() => {});
                }
              }
            } catch (err) {}

            await bot.sendMessage(
              buyerChatId,
              `✅ <b>تصویر فیش تسویه بدهی شما به مبلغ ${amount.toLocaleString()} تومان با موفقیت ثبت و برای تایید ارسال شد.</b>\n` +
                `⏳ به محض تایید فیش، مبلغ از بدهی همکاری شما کسر خواهد شد.`,
              { parse_mode: 'HTML', reply_markup: getMainKeyboard(seller, true) }
            );
            return;
          }

          if (!session || session.action !== 'awaiting_receipt' || !session.data) {
            await bot.sendMessage(
              buyerChatId,
              'ℹ️ تصویر فیش دریافت شد، اما سفارش فعالی در جریان نیست. لطفاً ابتدا از منوی «🛒 خرید سرویس» یا «💳 افزایش موجودی» اقدام نمایید.'
            );
            return;
          }

          const orderData = session.data;
          const largestPhoto = msg.photo[msg.photo.length - 1];
          const orderId = `ord_${Date.now()}_${Math.floor(100 + Math.random() * 899)}`;
          const profit =
            orderData.type === 'deposit'
              ? 0
              : Math.max(0, (orderData.retailPrice || 0) - (orderData.wholesalePrice || 0));

          const newOrder: SellerBotOrder = {
            id: orderId,
            buyerChatId,
            buyerUsername: msg.from.username || '',
            buyerName: [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' ') || 'مشتری',
            type: orderData.type || 'product',
            productId: orderData.productId,
            productName: orderData.productName,
            volumeGb: orderData.volumeGb,
            durationDays: orderData.durationDays,
            retailPrice: orderData.retailPrice,
            wholesalePrice: orderData.wholesalePrice || 0,
            profit,
            customName: orderData.customName,
            targetOrderId: orderData.targetOrderId,
            deliveredPurchaseId: orderData.deliveredPurchaseId,
            deliveredSubUrl: orderData.deliveredSubUrl,
            receiptFileId: largestPhoto.file_id,
            status: 'pending',
            createdAt: new Date().toISOString()
          };

          if (!botCfg.orders) botCfg.orders = [];
          botCfg.orders.push(newOrder);
          db.saveUser(seller);
          this.userSessionStates.delete(sessionKey);

          // If autoDeliverAfterPayment is enabled (for product/custom_volume/renew)
          if (botCfg.autoDeliverAfterPayment && newOrder.type !== 'deposit') {
            const fulfillRes = await this.fulfillResellerOrder(sellerChatId, orderId);
            if (!fulfillRes.success) {
              await bot.sendMessage(
                buyerChatId,
                `⚠️ فیش شما ثبت شد و در صف بررسی مدیر قرار گرفت: ${fulfillRes.message}`,
                { reply_markup: getMainKeyboard(seller, isUserAdmin) }
              );
            }
            return;
          }

          await bot.sendMessage(
            buyerChatId,
            `✅ <b>رسید پرداخت شما با موفقیت ثبت شد!</b>\n\n` +
              `📋 شناسه سفارش: <code>${orderId}</code>\n` +
              `📦 عنوان: <b>${escapeHtml(newOrder.productName || 'سفارش')}</b>\n` +
              `⏳ فیش شما برای مدیریت فروشگاه ارسال گردید و بلافاصله پس از تایید، نتیجه به صورت خودکار در همین ربات برای شما ارسال خواهد شد. 🙏`,
            {
              parse_mode: 'HTML',
              reply_markup: getMainKeyboard(seller, isUserAdmin)
            }
          );

          // Send Receipt Notification to the Reseller Admin in Bot 2
          try {
            const typeBadge =
              newOrder.type === 'renew'
                ? '♻️ تمدید سرویس'
                : newOrder.type === 'deposit'
                ? '💳 شارژ کیف پول مشتری'
                : '🛍 خرید سرویس جدید';

            const childAdminMsg =
              `🔔 <b>فیش واریزی جدید در ربات شما (${typeBadge})!</b>\n\n` +
              `🆔 شناسه سفارش: <code>${newOrder.id}</code>\n` +
              `👤 مشتری: <b>${escapeHtml(newOrder.buyerName || '')}</b> (@${escapeHtml(newOrder.buyerUsername || 'بدون_آیدی')})\n` +
              `🔢 آیدی عددی مشتری: <code>${newOrder.buyerChatId}</code>\n` +
              `📦 عنوان: <b>${escapeHtml(newOrder.productName || '')}</b>\n` +
              `💵 مبلغ واریزی مشتری به کارت شما: <b>${newOrder.retailPrice.toLocaleString()} تومان</b>\n` +
              (newOrder.type !== 'deposit'
                ? `📉 هزینه عمده (ثبت در بدهی شما): <b>${newOrder.wholesalePrice.toLocaleString()} تومان</b>\n💎 <b>سود خالص شما: ${newOrder.profit.toLocaleString()} تومان</b>\n\n`
                : `\n`) +
              `جهت تایید فیش و انجام خودکار عملیات برای مشتری، روی دکمه شیشه‌ای زیر کلیک نمایید:`;

            const adminInlineKeyboard: any = {
              inline_keyboard: [
                [
                  {
                    text:
                      newOrder.type === 'deposit'
                        ? '✅ تایید فیش و شارژ کیف پول مشتری'
                        : newOrder.type === 'renew'
                        ? '✅ تایید فیش و تمدید آنی سرویس'
                        : '✅ تایید فیش و صدور آنی کانفیگ',
                    callback_data: `child_approve_${orderId}`,
                    style: 'success'
                  }
                ],
                [
                  {
                    text: '❌ رد فیش واریزی',
                    callback_data: `child_reject_${orderId}`,
                    style: 'danger'
                  }
                ]
              ]
            };

            await bot.sendPhoto(targetAdminChatId, largestPhoto.file_id, {
              caption: childAdminMsg,
              parse_mode: 'HTML',
              reply_markup: adminInlineKeyboard
            });
          } catch (childAdminErr) {
            console.warn('[Reseller Bot Direct Admin Notify Error]', childAdminErr);
          }
          return;
        }
      } catch (msgErr: any) {
        console.error(`[ResellerBot @${sellerChatId} Message Handler Error]:`, msgErr?.message || msgErr);
      }
    });

    // ========================================================================
    // CALLBACK QUERY HANDLERS (Inline Buttons in Reseller Bot)
    // ========================================================================
    bot.on('callback_query', async query => {
      try {
        if (!query.message || !query.data) return;
        const buyerChatId = query.message.chat.id;
        const msgId = query.message.message_id;
        const data = query.data;
        const sessionKey = getSessionKey(buyerChatId);

        const seller = db.getUser(sellerChatId);
        if (!seller || !seller.sellerBot) return;
        const botCfg = seller.sellerBot;
        const targetAdminChatId = botCfg.adminChatId ? Number(botCfg.adminChatId) : sellerChatId;
        const isFromAdmin =
          buyerChatId === targetAdminChatId ||
          buyerChatId === sellerChatId ||
          Number(query.from.id) === targetAdminChatId ||
          Number(query.from.id) === sellerChatId;

        if (data === 'check_reseller_fj') {
          this.forceJoinCache.delete(`${sellerChatId}_${buyerChatId}`);
          const joined = await checkBuyerForceJoin(buyerChatId, seller);
          if (joined) {
            await bot.answerCallbackQuery(query.id, { text: '✅ عضویت شما در کانال تایید شد! خوش آمدید.', show_alert: true }).catch(() => {});
            await bot.deleteMessage(buyerChatId, msgId).catch(() => {});
            const effectiveBotName = this.getEffectiveBotName(seller);
            const buyerRec = (botCfg.buyers || []).find(b => b.chatId === buyerChatId);
            if (buyerRec?.referredBy && !buyerRec.referralRewarded) {
              await processPendingReferralReward(buyerChatId, seller);
            }
            const customWelcome = (botCfg.welcomeMessage || '').trim();
            const welcome = customWelcome
              ? `${customWelcome}\n\n🆔 شناسه کاربری شما: <code>${buyerChatId}</code>\n💰 موجودی کیف پول: <b>${(buyerRec?.balance || 0).toLocaleString()} تومان</b>`
              : `👋 سلام <b>${escapeHtml(query.from.first_name || 'کاربر گرامی')}</b> عزیز،\nبه ربات رسمی فروش اشتراک‌های پرسرعت <b>${escapeHtml(effectiveBotName)}</b> خوش آمدید! 🚀\n\n🆔 شناسه کاربری شما: <code>${buyerChatId}</code>\n💰 موجودی کیف پول: <b>${(buyerRec?.balance || 0).toLocaleString()} تومان</b>\n\nلطفاً یکی از گزینه‌های منوی زیر را انتخاب نمایید:`;

            await bot.sendMessage(buyerChatId, welcome, {
              parse_mode: 'HTML',
              reply_markup: getMainKeyboard(seller, isFromAdmin)
            });
          } else {
            await bot.answerCallbackQuery(query.id, { text: '❌ شما هنوز در کانال عضو نشده‌اید! ابتدا عضو شوید و سپس این دکمه را بزنید.', show_alert: true }).catch(() => {});
          }
          return;
        }

        // Enforce Force Join on all buyer callback actions
        if (!isFromAdmin) {
          const isJoined = await checkBuyerForceJoin(buyerChatId, seller);
          if (!isJoined) {
            await bot.answerCallbackQuery(query.id, { text: '⚠️ لطفاً ابتدا در کانال فروشگاه عضو شوید.', show_alert: true }).catch(() => {});
            return;
          }
        }

        // --------------------------------------------------------------------
        // 1. BUYER CATEGORY & PRODUCT NAVIGATION (Identical to Main Bot)
        // --------------------------------------------------------------------
        if (data === 'back_to_categories') {
          await bot.answerCallbackQuery(query.id).catch(() => {});
          await sendCategoriesOrProductsMenu(buyerChatId, seller, msgId);
          return;
        }

        if (data.startsWith('cat_')) {
          const catId = data.replace('cat_', '');
          const state = db.getState();
          const categories = (state.categories || []).filter(c => c && !c.disabled);
          const activeProducts = getAvailableProductsForReseller(seller);

          const cat = categories.find(
            c =>
              String(c.id).trim().toLowerCase() === String(catId).trim().toLowerCase() ||
              String(c.name).trim().toLowerCase() === String(catId).trim().toLowerCase()
          );
          if (!cat) {
            await bot.answerCallbackQuery(query.id, { text: '❌ این دسته‌بندی غیرفعال یا حذف شده است.' });
            return;
          }
          const catName = cat.name;
          const prods = activeProducts.filter(
            p =>
              String(p.categoryId || '').trim().toLowerCase() === String(cat.id).trim().toLowerCase() ||
              String(p.categoryId || '').trim().toLowerCase() === String(cat.name).trim().toLowerCase()
          );

          if (prods.length === 0) {
            await bot.answerCallbackQuery(query.id, { text: '❌ محصول فعالی در این دسته وجود ندارد.' });
            return;
          }

          const inline_keyboard: any[][] = prods.map(p => [
            {
              text: this.getResellerProductButtonLabel(seller, p),
              callback_data: `select_prod_${p.id}`,
              style: 'success'
            }
          ]);

          inline_keyboard.push([
            {
              text: '🔙 بازگشت به لیست دسته‌ها',
              callback_data: 'back_to_categories',
              style: 'danger'
            }
          ]);

          await bot.answerCallbackQuery(query.id).catch(() => {});
          const textMsg = `📁 <b>دسته‌بندی: ${escapeHtml(catName)}</b>\n\nلطفاً سرویس مورد نظر خود را جهت مشاهده جزئیات و خرید انتخاب کنید:`;
          await bot
            .editMessageText(textMsg, {
              chat_id: buyerChatId,
              message_id: msgId,
              parse_mode: 'HTML',
              reply_markup: { inline_keyboard }
            })
            .catch(async () => {
              await bot.sendMessage(buyerChatId, textMsg, { parse_mode: 'HTML', reply_markup: { inline_keyboard } });
            });
          return;
        }

        if (data === 'open_cvol') {
          await bot.answerCallbackQuery(query.id).catch(() => {});
          const { retailPricePerGb } = this.getCustomVolumePricesForSeller(seller);
          this.userSessionStates.set(sessionKey, { action: 'awaiting_custom_volume_gb' });
          await bot.sendMessage(
            buyerChatId,
            `⚡ <b>خرید سرویس با حجم انتخابی شما:</b>\n\n` +
              `💰 نرخ هر گیگابایت: <b>${retailPricePerGb.toLocaleString()} تومان</b> (مدت اعتبار: ۳۰ روز)\n\n` +
              `لطفاً میزان حجم درخواستی خود را به <b>عدد گیگابایت</b> (مثلاً: 15 یا 30 یا 50) ارسال نمایید:`,
            {
              parse_mode: 'HTML',
              reply_markup: {
                keyboard: [[{ text: 'بازگشت به منوی اصلی', style: 'danger' } as any]],
                resize_keyboard: true
              }
            }
          );
          return;
        }

        if (data.startsWith('select_prod_') || data.startsWith('buy_prod_')) {
          const prodId = data.replace(/^select_prod_|^buy_prod_/, '');
          const product = getAvailableProductsForReseller(seller).find(p => p.id === prodId);
          if (!product) {
            await bot.answerCallbackQuery(query.id, { text: '❌ این محصول یا دسته‌بندی آن غیرفعال است.' });
            return;
          }

          const { retailPrice } = this.getProductPricesForSeller(seller, product);
          const buyerRec = (botCfg.buyers || []).find(b => b.chatId === buyerChatId);
          const buyerBal = buyerRec?.balance || 0;

          const detailMsg =
            `🛍 <b>مشخصات سرویس انتخابی:</b>\n\n` +
            `📦 <b>نام سرویس:</b> ${escapeHtml(product.name)}\n` +
            `📊 <b>حجم ترافیک:</b> ${product.volumeGb} گیگابایت\n` +
            `⏳ <b>مدت اعتبار:</b> ${product.durationDays || 'نامحدود'} روز\n` +
            `💰 <b>قیمت سرویس:</b> <b>${retailPrice.toLocaleString()} تومان</b>\n` +
            `👛 <b>موجودی کیف پول شما:</b> ${buyerBal.toLocaleString()} تومان\n\n` +
            `لطفاً نحوه ثبت سفارش و نام‌گذاری کانفیگ خود را انتخاب کنید:`;

          const backCallback = product.categoryId ? `cat_${product.categoryId}` : 'back_to_categories';

          const inline_keyboard: any[][] = [
            [
              {
                text:
                  buyerBal >= retailPrice
                    ? '⚡ خرید آنی با کسر از کیف پول (نام خودکار)'
                    : '🛒 تایید خرید و دریافت شماره کارت (نام خودکار)',
                callback_data: `confirm_buy_${product.id}`,
                style: 'success'
              }
            ],
            [
              {
                text: '✏️ انتخاب نام دلخواه برای کانفیگ',
                callback_data: `custom_name_prod_${product.id}`,
                style: 'primary'
              }
            ],
            [
              {
                text: '🎫 ثبت کد تخفیف روی این خرید',
                callback_data: `apply_coupon_prod_${product.id}`,
                style: 'primary'
              }
            ],
            [
              {
                text: '🔙 بازگشت به لیست محصولات',
                callback_data: backCallback,
                style: 'danger'
              }
            ]
          ];

          await bot.answerCallbackQuery(query.id).catch(() => {});
          await bot
            .editMessageText(detailMsg, {
              chat_id: buyerChatId,
              message_id: msgId,
              parse_mode: 'HTML',
              reply_markup: { inline_keyboard }
            })
            .catch(async () => {
              await bot.sendMessage(buyerChatId, detailMsg, { parse_mode: 'HTML', reply_markup: { inline_keyboard } });
            });
          return;
        }

        if (data.startsWith('apply_coupon_prod_')) {
          const prodId = data.replace('apply_coupon_prod_', '');
          await bot.answerCallbackQuery(query.id).catch(() => {});
          this.userSessionStates.set(sessionKey, {
            action: 'buyer_enter_prod_coupon',
            data: { productId: prodId }
          });
          await bot.sendMessage(
            buyerChatId,
            `🎫 لطفاً <b>کد تخفیف</b> خود را ارسال نمایید:`,
            {
              parse_mode: 'HTML',
              reply_markup: {
                keyboard: [[{ text: 'بازگشت به منوی اصلی', style: 'danger' } as any]],
                resize_keyboard: true
              }
            }
          );
          return;
        }

        if (data.startsWith('custom_name_prod_')) {
          const prodId = data.replace('custom_name_prod_', '');
          await bot.answerCallbackQuery(query.id).catch(() => {});
          const prevCoupon = this.userSessionStates.get(sessionKey)?.data?.appliedCouponCode;
          this.userSessionStates.set(sessionKey, {
            action: 'awaiting_custom_name',
            data: { productId: prodId, appliedCouponCode: prevCoupon }
          });
          await bot.sendMessage(
            buyerChatId,
            `✏️ لطفاً <b>نام دلخواه</b> خود را برای این کانفیگ با حروف انگلیسی ارسال نمایید (مثلاً: <code>reza_vip</code>):`,
            {
              parse_mode: 'HTML',
              reply_markup: {
                keyboard: [[{ text: 'بازگشت به منوی اصلی', style: 'danger' } as any]],
                resize_keyboard: true
              }
            }
          );
          return;
        }

        if (data.startsWith('confirm_buy_')) {
          const prodId = data.replace('confirm_buy_', '');
          const product = getAvailableProductsForReseller(seller).find(p => p.id === prodId);
          if (!product) {
            await bot.answerCallbackQuery(query.id, { text: '❌ این محصول یا دسته‌بندی آن غیرفعال است.' });
            return;
          }
          await bot.answerCallbackQuery(query.id).catch(() => {});
          await startProductInvoiceOrWalletFlow(buyerChatId, seller, product);
          return;
        }

        // --------------------------------------------------------------------
        // 2. BUYER SERVICES, LIVE STATUS, DIRECT CONFIGS & RENEWAL
        // --------------------------------------------------------------------
        if (data === 'my_services_list' || data === 'user_purchases_list') {
          await bot.answerCallbackQuery(query.id).catch(() => {});
          await sendMyServicesList(buyerChatId, seller);
          return;
        }

        if (data === 'buyer_referral_menu') {
          await bot.answerCallbackQuery(query.id).catch(() => {});
          await sendBuyerReferralMenu(buyerChatId, seller);
          return;
        }

        if (data === 'buyer_redeem_gift_code') {
          await bot.answerCallbackQuery(query.id).catch(() => {});
          this.userSessionStates.set(sessionKey, { action: 'buyer_enter_gift_code' });
          await bot.sendMessage(
            buyerChatId,
            `🎁 لطفاً <b>کد هدیه</b> یا <b>کد تخفیف</b> خود را ارسال نمایید:`,
            {
              parse_mode: 'HTML',
              reply_markup: {
                keyboard: [[{ text: 'بازگشت به منوی اصلی', style: 'danger' } as any]],
                resize_keyboard: true
              }
            }
          );
          return;
        }

        if (data === 'buyer_deposit_start') {
          await bot.answerCallbackQuery(query.id).catch(() => {});
          this.userSessionStates.set(sessionKey, { action: 'awaiting_deposit_amount' });
          await bot.sendMessage(
            buyerChatId,
            `💳 لطفاً مبلغ مورد نظر جهت شارژ کیف پول را به <b>تومان</b> (مثلاً <code>100000</code>) ارسال نمایید:`,
            {
              parse_mode: 'HTML',
              reply_markup: {
                keyboard: [[{ text: 'بازگشت به منوی اصلی', style: 'danger' } as any]],
                resize_keyboard: true
              }
            }
          );
          return;
        }

        if (data.startsWith('view_srv_') || data.startsWith('refresh_srv_')) {
          const refKey = data.replace(/^view_srv_|^refresh_srv_/, '');
          await bot.answerCallbackQuery(query.id, { text: '⏳ در حال استعلام لحظه‌ای از سرور...' }).catch(() => {});
          const ord = (botCfg.orders || []).find(o => o.id === refKey || o.deliveredPurchaseId === refKey);
          const purchase = (seller.purchases || []).find((p: any) => p.id === refKey || (ord && p.id === ord.deliveredPurchaseId));
          await this.sendBuyerServiceInfo(bot, seller, buyerChatId, { order: ord, purchase });
          return;
        }

        if (data.startsWith('direct_srv_')) {
          const refKey = data.replace('direct_srv_', '');
          await bot.answerCallbackQuery(query.id, { text: '⏳ در حال استخراج کانفیگ‌های مستقیم...' }).catch(() => {});
          const ord = (botCfg.orders || []).find(o => o.id === refKey || o.deliveredPurchaseId === refKey);
          const purchase = (seller.purchases || []).find((p: any) => p.id === refKey || (ord && p.id === ord.deliveredPurchaseId));
          const subUrl =
            purchase?.subUrl ||
            purchase?.sanaeiSubUrl ||
            purchase?.rebeccaSubUrl ||
            purchase?.mroceanSubUrl ||
            purchase?.panel4SubUrl ||
            ord?.deliveredSubUrl ||
            '';

          if (!subUrl) {
            await bot.sendMessage(buyerChatId, '❌ لینک سابسکریپشن برای این سرویس یافت نشد.');
            return;
          }

          const configs = await extractDirectConfigsFromSubUrl(subUrl);
          if (configs.length === 0) {
            await bot.sendMessage(
              buyerChatId,
              `ℹ️ کانفیگ تکی از لینک ساب استخراج نشد. لطفاً مستقیماً از لینک سابسکریپشن استفاده نمایید:\n\n<code>${escapeHtml(subUrl)}</code>`,
              { parse_mode: 'HTML' }
            );
            return;
          }

          let out = `⚙️ <b>کانفیگ‌های مستقیم سرویس شما (${configs.length} سرور):</b>\n\n`;
          for (const cfgLine of configs.slice(0, 12)) {
            out += `<code>${escapeHtml(cfgLine)}</code>\n\n`;
          }
          out += `💡 <i>با لمس هر خط، کانفیگ مربوطه کپی می‌شود.</i>`;
          await bot.sendMessage(buyerChatId, out, { parse_mode: 'HTML' });
          return;
        }

        if (data.startsWith('renew_srv_')) {
          const refKey = data.replace('renew_srv_', '');
          await bot.answerCallbackQuery(query.id).catch(() => {});

          const ord = (botCfg.orders || []).find(o => o.id === refKey || o.deliveredPurchaseId === refKey);
          const purchase = (seller.purchases || []).find((p: any) => p.id === refKey || (ord && p.id === ord.deliveredPurchaseId));

          if (!ord && !purchase) {
            await bot.sendMessage(buyerChatId, '❌ سرویس مورد نظر جهت تمدید یافت نشد.');
            return;
          }

          const state = db.getState();
          const prodId = ord?.productId || purchase?.productId;
          const product = prodId ? (state.products || []).find(p => p.id === prodId) : null;

          const volGb = Number(product?.volumeGb || ord?.volumeGb || purchase?.volumeGb || 10);
          const durDays = Number(product?.durationDays || ord?.durationDays || purchase?.durationDays || 30);

          let wholesalePrice = 0;
          let retailPrice = 0;

          if (product) {
            const prices = this.getProductPricesForSeller(seller, product);
            wholesalePrice = prices.wholesalePrice;
            retailPrice = prices.retailPrice;
          } else {
            const cvol = this.getCustomVolumePricesForSeller(seller);
            wholesalePrice = Math.round(volGb * cvol.wholesalePricePerGb);
            retailPrice = ord?.retailPrice && ord.retailPrice > 0 ? ord.retailPrice : Math.round(volGb * cvol.retailPricePerGb);
          }

          const buyerRec = (botCfg.buyers || []).find(b => b.chatId === buyerChatId);
          const buyerBal = buyerRec?.balance || 0;
          const srvName = ord?.customName || purchase?.customName || ord?.productName || purchase?.name || 'سرویس اختصاصی';

          const renewMsg =
            `♻️ <b>تایید تمدید سرویس (${escapeHtml(srvName)})</b>\n\n` +
            `🆔 <b>شناسه کانفیگ:</b> <code>${escapeHtml(String(purchase?.id || ord?.deliveredPurchaseId || refKey))}</code>\n` +
            `📊 <b>حجم شارژ مجدد:</b> ${volGb} گیگابایت (مصرف قبلی صفر می‌شود)\n` +
            `⏳ <b>مدت اعتبار جدید:</b> ${durDays} روز\n` +
            `💰 <b>هزینه تمدید:</b> <b>${retailPrice.toLocaleString()} تومان</b>\n` +
            `👛 <b>موجودی کیف پول شما:</b> ${buyerBal.toLocaleString()} تومان\n\n` +
            `⚠️ <i>با تمدید سرویس، لینک سابسکریپشن و کانفیگ شما بدون تغییر باقی می‌ماند و نیازی به تعویض لینک در گوشی نیست.</i>`;

          const inline_keyboard: any[][] = [
            [
              {
                text:
                  buyerBal >= retailPrice
                    ? '⚡ تایید و تمدید آنی با کسر از کیف پول'
                    : '💳 تایید تمدید و دریافت شماره کارت',
                callback_data: `confirm_renew_${refKey}`,
                style: 'success'
              }
            ]
          ];

          if (isFromAdmin) {
            inline_keyboard.push([
              {
                text: '👑 تمدید مستقیم توسط شما (ادمین همکار)',
                callback_data: `admin_direct_renew_${refKey}`,
                style: 'primary'
              }
            ]);
          }

          inline_keyboard.push([
            {
              text: '🔙 انصراف و بازگشت',
              callback_data: `view_srv_${refKey}`,
              style: 'danger'
            }
          ]);

          await bot.sendMessage(buyerChatId, renewMsg, {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard }
          });
          return;
        }

        if (data.startsWith('confirm_renew_')) {
          const refKey = data.replace('confirm_renew_', '');
          await bot.answerCallbackQuery(query.id).catch(() => {});

          const ord = (botCfg.orders || []).find(o => o.id === refKey || o.deliveredPurchaseId === refKey);
          const purchase = (seller.purchases || []).find((p: any) => p.id === refKey || (ord && p.id === ord.deliveredPurchaseId));
          if (!ord && !purchase) {
            await bot.sendMessage(buyerChatId, '❌ سرویس مورد نظر یافت نشد.');
            return;
          }

          const state = db.getState();
          const prodId = ord?.productId || purchase?.productId;
          const product = prodId ? (state.products || []).find(p => p.id === prodId) : null;

          const volGb = Number(product?.volumeGb || ord?.volumeGb || purchase?.volumeGb || 10);
          const durDays = Number(product?.durationDays || ord?.durationDays || purchase?.durationDays || 30);

          let wholesalePrice = 0;
          let retailPrice = 0;

          if (product) {
            const prices = this.getProductPricesForSeller(seller, product);
            wholesalePrice = prices.wholesalePrice;
            retailPrice = prices.retailPrice;
          } else {
            const cvol = this.getCustomVolumePricesForSeller(seller);
            wholesalePrice = Math.round(volGb * cvol.wholesalePricePerGb);
            retailPrice = ord?.retailPrice && ord.retailPrice > 0 ? ord.retailPrice : Math.round(volGb * cvol.retailPricePerGb);
          }

          const buyerRec = (botCfg.buyers || []).find(b => b.chatId === buyerChatId);
          const buyerBal = buyerRec?.balance || 0;
          const srvName = ord?.customName || purchase?.customName || ord?.productName || purchase?.name || 'سرویس اختصاصی';
          const targetPurchaseId = purchase?.id || ord?.deliveredPurchaseId;
          const targetSubUrl = purchase?.subUrl || ord?.deliveredSubUrl;

          // If buyer has enough balance in Bot 2 wallet -> Instant renewal!
          if (buyerBal >= retailPrice && retailPrice > 0 && buyerRec) {
            buyerRec.balance = Math.max(0, buyerBal - retailPrice);
            const renewOrderId = `ord_ren_${Date.now()}_${Math.floor(100 + Math.random() * 899)}`;
            const renewOrder: SellerBotOrder = {
              id: renewOrderId,
              buyerChatId,
              buyerUsername: buyerRec.username || '',
              buyerName: buyerRec.name || 'مشتری',
              type: 'renew',
              productId: prodId,
              productName: `تمدید ${srvName}`,
              volumeGb: volGb,
              durationDays: durDays,
              retailPrice,
              wholesalePrice,
              profit: Math.max(0, retailPrice - wholesalePrice),
              targetOrderId: ord?.id,
              deliveredPurchaseId: targetPurchaseId,
              deliveredSubUrl: targetSubUrl,
              status: 'pending',
              createdAt: new Date().toISOString()
            };
            if (!botCfg.orders) botCfg.orders = [];
            botCfg.orders.push(renewOrder);
            db.saveUser(seller);

            await bot.sendMessage(
              buyerChatId,
              `⏳ مبلغ <b>${retailPrice.toLocaleString()} تومان</b> از کیف پول شما کسر شد. در حال تمدید آنی سرویس در سرور...`,
              { parse_mode: 'HTML' }
            );

            const res = await this.fulfillResellerOrder(sellerChatId, renewOrderId);
            if (!res.success) {
              const freshSeller = db.getUser(sellerChatId);
              const freshBuyer = freshSeller?.sellerBot?.buyers?.find(b => b.chatId === buyerChatId);
              if (freshBuyer && freshSeller) {
                freshBuyer.balance = (freshBuyer.balance || 0) + retailPrice;
                db.saveUser(freshSeller);
              }
              await bot.sendMessage(buyerChatId, `❌ خطا در تمدید سرویس: ${res.message}\nمبلغ به کیف پول شما بازگردانده شد.`);
            }
            return;
          }

          const payableAmount = Math.max(0, retailPrice - buyerBal);
          this.userSessionStates.set(sessionKey, {
            action: 'awaiting_receipt',
            data: {
              type: 'renew',
              productId: prodId,
              productName: `تمدید ${srvName}`,
              volumeGb: volGb,
              durationDays: durDays,
              retailPrice,
              payableAmount,
              usedWalletAmount: buyerBal > 0 ? buyerBal : 0,
              wholesalePrice,
              targetOrderId: ord?.id,
              deliveredPurchaseId: targetPurchaseId,
              deliveredSubUrl: targetSubUrl
            }
          });

          const cardNum = (botCfg.cardNumber || '').trim() || 'شماره کارت توسط مدیر فروشگاه ثبت نشده است';
          const cardHolder = (botCfg.cardHolder || '').trim() || 'مدیر فروشگاه';

          await bot.sendMessage(
            buyerChatId,
            `💳 <b>فاکتور تمدید سرویس (${escapeHtml(srvName)}):</b>\n\n` +
              `📊 <b>حجم مجدد:</b> ${volGb} گیگابایت\n` +
              `⏳ <b>مدت اعتبار:</b> ${durDays} روز\n` +
              `💰 <b>هزینه تمدید:</b> ${retailPrice.toLocaleString()} تومان\n` +
              (buyerBal > 0
                ? `👛 <b>کسر از کیف پول:</b> ${buyerBal.toLocaleString()} تومان\n💵 <b>مبلغ قابل واریز:</b> <b>${payableAmount.toLocaleString()} تومان</b>\n\n`
                : `💵 <b>مبلغ قابل واریز:</b> <b>${payableAmount.toLocaleString()} تومان</b>\n\n`) +
              `🏦 <b>شماره کارت جهت واریز:</b>\n` +
              `<code>${escapeHtml(cardNum)}</code>\n` +
              `👤 <b>به نام:</b> <b>${escapeHtml(cardHolder)}</b>\n\n` +
              `📸 لطفاً پس از واریز، <b>عکس فیش واریزی</b> را همینجا ارسال فرمایید تا سرویس شما بلافاصله تمدید شود:`,
            {
              parse_mode: 'HTML',
              reply_markup: {
                keyboard: [[{ text: 'بازگشت به منوی اصلی', style: 'danger' } as any]],
                resize_keyboard: true
              }
            }
          );
          return;
        }

        // --------------------------------------------------------------------
        // 3. RESELLER ADMIN CALLBACKS (Order Approval, Buyers, Prices, Card)
        // --------------------------------------------------------------------
        if (data === 'admin_refresh_stats' || data === 'admin_main' || data === 'admin_panel_main') {
          if (!isFromAdmin) {
            await bot.answerCallbackQuery(query.id, { text: '⛔ عدم دسترسی.' });
            return;
          }
          await bot.answerCallbackQuery(query.id, { text: '✅ بروزرسانی شد.' }).catch(() => {});
          await sendAdminPanelMenu(buyerChatId, seller, msgId);
          return;
        }

        if (data === 'admin_broadcast_start') {
          if (!isFromAdmin) return;
          await bot.answerCallbackQuery(query.id).catch(() => {});
          const totalBuyers = (botCfg.buyers || []).length;
          this.userSessionStates.set(sessionKey, { action: 'admin_broadcast_msg' });
          await bot.sendMessage(
            buyerChatId,
            `📢 <b>ارسال پیام همگانی به تمامی کاربران ربات شما (${totalBuyers} نفر):</b>\n\n` +
              `لطفاً <b>متن پیام</b> یا <b>عکس (به همراه کپشن)</b> مورد نظر خود را همینجا ارسال نمایید تا بلافاصله برای تمام کاربران ربات شما ارسال شود:\n\n` +
              `💡 <i>برای انصراف، روی دکمه «بازگشت به منوی اصلی» بزنید.</i>`,
            {
              parse_mode: 'HTML',
              reply_markup: {
                keyboard: [[{ text: 'بازگشت به منوی اصلی', style: 'danger' } as any]],
                resize_keyboard: true
              }
            }
          );
          return;
        }

        if (data === 'admin_force_join_menu') {
          if (!isFromAdmin) return;
          await bot.answerCallbackQuery(query.id).catch(() => {});
          await sendForceJoinMenu(buyerChatId, seller, msgId);
          return;
        }

        if (data === 'admin_toggle_fj') {
          if (!isFromAdmin) return;
          const channels = getEffectiveForceJoinChannels(seller);
          if (!botCfg.forceJoinEnabled && channels.length === 0) {
            await bot.answerCallbackQuery(query.id, {
              text: '⚠️ ابتدا حداقل یک کانال اضافه کنید تا قفل عضویت اجباری فعال شود.',
              show_alert: true
            }).catch(() => {});
            return;
          }
          botCfg.forceJoinEnabled = !botCfg.forceJoinEnabled;
          this.forceJoinCache.clear();
          db.saveUser(seller);
          await bot.answerCallbackQuery(query.id, {
            text: botCfg.forceJoinEnabled ? '🟢 عضویت اجباری کانال فعال شد.' : '🔴 عضویت اجباری کانال غیرفعال شد.'
          }).catch(() => {});
          await sendForceJoinMenu(buyerChatId, seller, msgId);
          return;
        }

        if (data === 'admin_add_fj_start') {
          if (!isFromAdmin) return;
          await bot.answerCallbackQuery(query.id).catch(() => {});
          this.userSessionStates.set(sessionKey, { action: 'admin_add_fj_channel' });
          await bot.sendMessage(
            buyerChatId,
            `➕ <b>افزودن کانال به عضویت اجباری (ادد اجباری) ربات شما:</b>\n\n` +
              `لطفاً آیدی کانال عمومی خود را با <code>@</code> ارسال نمایید:\n` +
              `مثال ساده: <code>@MyVpnChannel</code>\n\n` +
              `یا اگر می‌خواهید نام دکمه شیشه‌ای را هم خودتان تعیین کنید با ویرگول جدا کنید:\n` +
              `مثال: <code>@MyVpnChannel, کانال اطلاع‌رسانی ما</code>\n\n` +
              `⚠️ <b>فراموش نکنید:</b> حتماً ربات خودتان (${botCfg.botUsername ? `@${escapeHtml(botCfg.botUsername)}` : 'ربات'}) را در آن کانال <b>Admin (مدیر)</b> کنید.`,
            {
              parse_mode: 'HTML',
              reply_markup: {
                keyboard: [[{ text: 'بازگشت به منوی اصلی', style: 'danger' } as any]],
                resize_keyboard: true
              }
            }
          );
          return;
        }

        if (data.startsWith('admin_del_fj_')) {
          if (!isFromAdmin) return;
          const idx = parseInt(data.replace('admin_del_fj_', ''), 10);
          const list = getEffectiveForceJoinChannels(seller);
          if (!isNaN(idx) && idx >= 0 && idx < list.length) {
            list.splice(idx, 1);
            botCfg.forceJoinChannels = list;
            if (list.length === 0) {
              botCfg.channelUsername = '';
              botCfg.forceJoinEnabled = false;
            }
            this.forceJoinCache.clear();
            db.saveUser(seller);
            await bot.answerCallbackQuery(query.id, { text: '🗑 کانال حذف شد.' }).catch(() => {});
          }
          await sendForceJoinMenu(buyerChatId, seller, msgId);
          return;
        }

        if (data === 'admin_referral_settings') {
          if (!isFromAdmin) return;
          await bot.answerCallbackQuery(query.id).catch(() => {});
          await sendAdminReferralSettingsMenu(buyerChatId, seller, msgId);
          return;
        }

        if (data.startsWith('admin_ref_preset_')) {
          if (!isFromAdmin) return;
          const amount = parseInt(data.replace('admin_ref_preset_', ''), 10);
          if (!isNaN(amount) && amount >= 0) {
            botCfg.referralRewardToman = amount;
            db.saveUser(seller);
            await bot.answerCallbackQuery(query.id, {
              text: amount > 0 ? `✅ پاداش زیرمجموعه‌گیری روی ${amount.toLocaleString()} تومان تنظیم شد.` : '🔴 پاداش زیرمجموعه‌گیری غیرفعال شد.'
            }).catch(() => {});
          }
          await sendAdminReferralSettingsMenu(buyerChatId, seller, msgId);
          return;
        }

        if (data === 'admin_ref_custom_input') {
          if (!isFromAdmin) return;
          await bot.answerCallbackQuery(query.id).catch(() => {});
          this.userSessionStates.set(sessionKey, { action: 'admin_set_referral_reward' });
          await bot.sendMessage(
            buyerChatId,
            `🎁 لطفاً مبلغ پاداش معرفی هر زیرمجموعه را به <b>تومان</b> وارد نمایید (مثلاً <code>5000</code> یا برای غیرفعال‌سازی <code>0</code>):`,
            {
              parse_mode: 'HTML',
              reply_markup: {
                keyboard: [[{ text: 'بازگشت به منوی اصلی', style: 'danger' } as any]],
                resize_keyboard: true
              }
            }
          );
          return;
        }

        if (data === 'admin_coupons_menu') {
          if (!isFromAdmin) return;
          await bot.answerCallbackQuery(query.id).catch(() => {});
          await sendAdminCouponsMenu(buyerChatId, seller, msgId);
          return;
        }

        if (data === 'admin_add_discount_coupon') {
          if (!isFromAdmin) return;
          await bot.answerCallbackQuery(query.id).catch(() => {});
          this.userSessionStates.set(sessionKey, { action: 'admin_create_discount_coupon' });
          await bot.sendMessage(
            buyerChatId,
            `🏷 <b>ساخت کد تخفیف درصدی خرید برای مشتریان ربات شما:</b>\n\n` +
              `لطفاً <b>نام کد</b>، <b>درصد تخفیف (۱ تا ۱۰۰)</b> و <b>تعداد دفعات مجاز</b> را با فاصله ارسال نمایید:\n\n` +
              `📌 مثال (کد OFF20 با ۲۰٪ تخفیف برای ۱۰۰ نفر):\n` +
              `<code>OFF20 20 100</code>`,
            {
              parse_mode: 'HTML',
              reply_markup: {
                keyboard: [[{ text: 'بازگشت به منوی اصلی', style: 'danger' } as any]],
                resize_keyboard: true
              }
            }
          );
          return;
        }

        if (data === 'admin_add_gift_coupon') {
          if (!isFromAdmin) return;
          await bot.answerCallbackQuery(query.id).catch(() => {});
          this.userSessionStates.set(sessionKey, { action: 'admin_create_gift_coupon' });
          await bot.sendMessage(
            buyerChatId,
            `🎁 <b>ساخت کد هدیه شارژ کیف پول برای مشتریان ربات شما:</b>\n\n` +
              `لطفاً <b>نام کد</b>، <b>مبلغ هدیه (تومان)</b> و <b>تعداد دفعات مجاز</b> را با فاصله ارسال نمایید:\n\n` +
              `📌 مثال (کد GIFT10 به مبلغ ۱۰,۰۰۰ تومان برای ۵۰ نفر):\n` +
              `<code>GIFT10 10000 50</code>`,
            {
              parse_mode: 'HTML',
              reply_markup: {
                keyboard: [[{ text: 'بازگشت به منوی اصلی', style: 'danger' } as any]],
                resize_keyboard: true
              }
            }
          );
          return;
        }

        if (data.startsWith('admin_del_coupon_')) {
          if (!isFromAdmin) return;
          const idx = parseInt(data.replace('admin_del_coupon_', ''), 10);
          if (Array.isArray(botCfg.coupons) && !isNaN(idx) && idx >= 0 && idx < botCfg.coupons.length) {
            botCfg.coupons.splice(idx, 1);
            db.saveUser(seller);
            await bot.answerCallbackQuery(query.id, { text: '🗑 کد حذف شد.' }).catch(() => {});
          }
          await sendAdminCouponsMenu(buyerChatId, seller, msgId);
          return;
        }

        if (data.startsWith('admin_direct_renew_')) {
          if (!isFromAdmin) {
            await bot.answerCallbackQuery(query.id, { text: '⛔ عدم دسترسی.' });
            return;
          }
          const refKey = data.replace('admin_direct_renew_', '');
          await bot.answerCallbackQuery(query.id, { text: '⏳ در حال تمدید مستقیم سرویس...' }).catch(() => {});

          const ord = (botCfg.orders || []).find(o => o.id === refKey || o.deliveredPurchaseId === refKey);
          const purchase = (seller.purchases || []).find((p: any) => p.id === refKey || (ord && p.id === ord.deliveredPurchaseId));
          if (!purchase) {
            await bot.sendMessage(buyerChatId, '❌ کانفیگ مورد نظر در لیست خریدهای شما یافت نشد.');
            return;
          }

          const state = db.getState();
          const prodId = ord?.productId || purchase?.productId;
          const product = prodId ? (state.products || []).find(p => p.id === prodId) : null;
          const volGb = Number(product?.volumeGb || ord?.volumeGb || purchase?.volumeGb || 10);
          const durDays = Number(product?.durationDays || ord?.durationDays || purchase?.durationDays || 30);

          let wholesalePrice = 0;
          let retailPrice = 0;
          if (product) {
            const prices = this.getProductPricesForSeller(seller, product);
            wholesalePrice = prices.wholesalePrice;
            retailPrice = prices.retailPrice;
          } else {
            const cvol = this.getCustomVolumePricesForSeller(seller);
            wholesalePrice = Math.round(volGb * cvol.wholesalePricePerGb);
            retailPrice = ord?.retailPrice || Math.round(volGb * cvol.retailPricePerGb);
          }

          const renewOrderId = `ord_admren_${Date.now()}`;
          const renewOrder: SellerBotOrder = {
            id: renewOrderId,
            buyerChatId: ord?.buyerChatId || buyerChatId,
            buyerUsername: ord?.buyerUsername || '',
            buyerName: ord?.buyerName || 'تمدید مستقیم ادمین',
            type: 'renew',
            productId: prodId,
            productName: `تمدید ${purchase.name || 'سرویس'}`,
            volumeGb: volGb,
            durationDays: durDays,
            retailPrice,
            wholesalePrice,
            profit: Math.max(0, retailPrice - wholesalePrice),
            targetOrderId: ord?.id,
            deliveredPurchaseId: purchase.id,
            deliveredSubUrl: purchase.subUrl,
            status: 'pending',
            createdAt: new Date().toISOString()
          };
          if (!botCfg.orders) botCfg.orders = [];
          botCfg.orders.push(renewOrder);
          db.saveUser(seller);

          const res = await this.fulfillResellerOrder(sellerChatId, renewOrderId);
          if (res.success) {
            await bot.sendMessage(
              buyerChatId,
              `✅ سرویس <code>${escapeHtml(purchase.id)}</code> با موفقیت تمدید شد و مبلغ عمده (<b>${wholesalePrice.toLocaleString()} تومان</b>) در لیست بدهی شما منظور گردید.`,
              { parse_mode: 'HTML' }
            );
          } else {
            await bot.sendMessage(buyerChatId, `❌ خطا در تمدید: ${res.message}`);
          }
          return;
        }

        // Reseller Admin: Cancel / Revoke Service (<1GB refund rule)
        if (data.startsWith('admin_cancel_srv_')) {
          if (!isFromAdmin) return;
          const refKey = data.replace('admin_cancel_srv_', '');
          const order = (botCfg.orders || []).find(o => o.id === refKey);
          const purchaseId = order?.deliveredPurchaseId || refKey;
          await bot.answerCallbackQuery(query.id, { text: '⏳ در حال بررسی مصرف و ابطال کانفیگ در سرور...' }).catch(() => {});

          const cancelRes = await cancelSellerPurchase(sellerChatId, purchaseId);
          if (cancelRes.success) {
            if (order) {
              const updatedSeller = db.getUser(sellerChatId) || seller;
              const matchingOrder = (updatedSeller.sellerBot?.orders || []).find(o => o.id === order.id);
              if (matchingOrder) {
                matchingOrder.status = 'rejected';
                matchingOrder.rejectReason = 'ابطال شده توسط مدیر فروشگاه';
                db.saveUser(updatedSeller);
              }
            }
            await bot.sendMessage(buyerChatId, cancelRes.message, { parse_mode: 'HTML' });
          } else {
            await bot.sendMessage(buyerChatId, cancelRes.message, { parse_mode: 'HTML' });
          }
          return;
        }

        // Seller Panel in Bot 2: Credit & Debt Status
        if (data === 'seller_credit_status') {
          if (!isFromAdmin) return;
          await bot.answerCallbackQuery(query.id).catch(() => {});
          const currentSeller = db.getUser(sellerChatId) || seller;
          const debt = currentSeller.debt || 0;
          const limit = currentSeller.debtLimit || 0;
          const remainingCredit = currentSeller.isUnlimitedLimit ? -1 : Math.max(0, limit - debt);
          const discount = currentSeller.sellerDiscount || 0;

          const msgText =
            `📉 <b>وضعیت بدهی و اعتبار پنل همکاری شما:</b>\n` +
            `━━━━━━━━━━━━━━━━━━\n` +
            `👤 <b>نام همکار:</b> <b>${escapeHtml(currentSeller.name || '')}</b>\n` +
            `💳 <b>بدهی فعلی شما:</b> <b>${debt.toLocaleString()} تومان</b>\n` +
            `🏦 <b>سقف مجاز بدهی (اعتبار):</b> <b>${currentSeller.isUnlimitedLimit ? 'نامحدود' : `${limit.toLocaleString()} تومان`}</b>\n` +
            `🟢 <b>اعتبار باقی‌مانده جهت صدور آنی:</b> <b>${remainingCredit === -1 ? 'نامحدود' : `${remainingCredit.toLocaleString()} تومان`}</b>\n` +
            (discount > 0 ? `🎁 <b>تخفیف همکاری شما:</b> <b>${discount}%</b>\n` : '') +
            `📦 <b>تعداد کل کانفیگ‌های صادر شده:</b> <b>${(currentSeller.purchases || []).length} عدد</b>\n` +
            `💰 <b>مجموع خرید همکاری:</b> <b>${(currentSeller.totalSales || 0).toLocaleString()} تومان</b>\n` +
            `💵 <b>مجموع تسویه شده تا امروز:</b> <b>${(currentSeller.totalPayments || 0).toLocaleString()} تومان</b>\n` +
            `━━━━━━━━━━━━━━━━━━\n` +
            `💡 <i>در هر زمان می‌توانید از طریق دکمه زیر فیش واریزی تسویه بدهی خود را ثبت نمایید:</i>`;

          await bot.sendMessage(buyerChatId, msgText, {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [{ text: '💳 پرداخت بدهی همکار (ثبت فیش تسویه)', callback_data: 'seller_pay_debt_start', style: 'success' }],
                [{ text: '🔙 بازگشت به پنل مدیریت', callback_data: 'admin_panel_main', style: 'primary' }]
              ]
            }
          });
          return;
        }

        // Seller Panel in Bot 2: Pay Debt Start
        if (data === 'seller_pay_debt_start') {
          if (!isFromAdmin) return;
          await bot.answerCallbackQuery(query.id).catch(() => {});
          const currentSeller = db.getUser(sellerChatId) || seller;
          this.userSessionStates.set(sessionKey, { action: 'seller_pay_debt_amount' });

          await bot.sendMessage(
            buyerChatId,
            `💳 <b>تسویه حساب و پرداخت بدهی همکاری</b>\n\n` +
              `📉 بدهی فعلی شما: <b>${(currentSeller.debt || 0).toLocaleString()} تومان</b>\n` +
              `🏦 سقف اعتبار شما: <b>${currentSeller.isUnlimitedLimit ? 'نامحدود' : `${(currentSeller.debtLimit || 0).toLocaleString()} تومان`}</b>\n\n` +
              `لطفاً <b>مبلغی که می‌خواهید تسویه کنید</b> را به <b>تومان</b> (مثلاً: <code>500000</code>) ارسال نمایید:`,
            {
              parse_mode: 'HTML',
              reply_markup: {
                keyboard: [[{ text: 'بازگشت به منوی اصلی', style: 'danger' } as any]],
                resize_keyboard: true
              }
            }
          );
          return;
        }

        // Seller Panel in Bot 2: Today & Monthly Sales Report
        if (data === 'seller_sales_report') {
          if (!isFromAdmin) return;
          await bot.answerCallbackQuery(query.id).catch(() => {});
          const currentSeller = db.getUser(sellerChatId) || seller;
          const orders = (currentSeller.sellerBot?.orders || []).filter(
            o => o.status === 'approved' && o.type !== 'deposit' && o.type !== 'free_test'
          );

          const { startMs: todayStartMs, todayFa: todayLabel } = getTehranShamsiDayRange();
          const monthStartMs = Date.now() - 30 * 24 * 60 * 60 * 1000;

          let todayCount = 0;
          let todayRetail = 0;
          let todayWholesale = 0;
          let todayProfit = 0;

          let monthCount = 0;
          let monthRetail = 0;
          let monthWholesale = 0;
          let monthProfit = 0;

          for (const ord of orders) {
            const ts = Date.parse(ord.approvedAt || ord.createdAt || '');
            if (isNaN(ts)) continue;
            const rPrice = ord.retailPrice || 0;
            const wPrice = ord.wholesalePrice || 0;
            const prof = ord.profit ?? Math.max(0, rPrice - wPrice);

            if (ts >= todayStartMs) {
              todayCount++;
              todayRetail += rPrice;
              todayWholesale += wPrice;
              todayProfit += prof;
            }
            if (ts >= monthStartMs) {
              monthCount++;
              monthRetail += rPrice;
              monthWholesale += wPrice;
              monthProfit += prof;
            }
          }

          const reportMsg =
            `📊 <b>گزارش فروش و صورتحساب ربات و پنل همکاری شما</b>\n` +
            `📅 تاریخ امروز: <b>${todayLabel}</b>\n` +
            `━━━━━━━━━━━━━━━━━━\n` +
            `☀️ <b>آمار فروش امروز ربات شما:</b>\n` +
            `• تعداد فروش امروز: <b>${todayCount} سرویس</b>\n` +
            `• کل دریافتی از مشتریان: <b>${todayRetail.toLocaleString()} تومان</b>\n` +
            `• هزینه همکاری (منظور در بدهی): <b>${todayWholesale.toLocaleString()} تومان</b>\n` +
            `• سود خالص امروز شما: <b>${todayProfit.toLocaleString()} تومان</b>\n` +
            `━━━━━━━━━━━━━━━━━━\n` +
            `📆 <b>آمار فروش ۳۰ روز اخیر ربات شما:</b>\n` +
            `• تعداد فروش ماهانه: <b>${monthCount} سرویس</b>\n` +
            `• کل فروش به مشتریان: <b>${monthRetail.toLocaleString()} تومان</b>\n` +
            `• کل هزینه همکاری: <b>${monthWholesale.toLocaleString()} تومان</b>\n` +
            `• سود خالص ۳۰ روز اخیر: <b>${monthProfit.toLocaleString()} تومان</b>\n` +
            `━━━━━━━━━━━━━━━━━━\n` +
            `📉 <b>وضعیت حساب همکاری شما:</b>\n` +
            `• بدهی فعلی شما: <b>${(currentSeller.debt || 0).toLocaleString()} تومان</b>\n` +
            `• سقف اعتبار شما: <b>${currentSeller.isUnlimitedLimit ? 'نامحدود' : `${(currentSeller.debtLimit || 0).toLocaleString()} تومان`}</b>`;

          await bot.sendMessage(buyerChatId, reportMsg, {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [{ text: '💳 پرداخت بدهی همکار (ثبت فیش)', callback_data: 'seller_pay_debt_start', style: 'success' }],
                [{ text: '🔙 بازگشت به پنل مدیریت', callback_data: 'admin_panel_main', style: 'primary' }]
              ]
            }
          });
          return;
        }

        // Seller Panel in Bot 2: Direct Wholesale Config Issuance Menu
        if (data === 'seller_direct_issue_menu') {
          if (!isFromAdmin) return;
          await bot.answerCallbackQuery(query.id).catch(() => {});
          const state = db.getState();
          const products = getAvailableProductsForReseller(seller);
          const inline_keyboard: any[][] = [];

          for (const prod of products) {
            const { wholesalePrice } = this.getProductPricesForSeller(seller, prod);
            inline_keyboard.push([
              {
                text: `⚡ ${prod.name} (${prod.volumeGb}GB) | نرخ شما: ${wholesalePrice.toLocaleString()} ت`,
                callback_data: `seller_direct_prod_${prod.id}`,
                style: 'primary'
              }
            ]);
          }

          if (state.customVolumeEnabled !== false) {
            const { wholesalePricePerGb } = this.getCustomVolumePricesForSeller(seller);
            inline_keyboard.push([
              {
                text: `⚡ صدور حجم دلخواه (هر گیگ ${wholesalePricePerGb.toLocaleString()} تومان)`,
                callback_data: 'seller_direct_cvol',
                style: 'success'
              }
            ]);
          }

          inline_keyboard.push([
            { text: '🔙 بازگشت به پنل مدیریت', callback_data: 'admin_panel_main', style: 'danger' }
          ]);

          await bot.sendMessage(
            buyerChatId,
            `🛒 <b>صدور مستقیم کانفیگ همکار (با نرخ عمده همکاری شما):</b>\n\n` +
              `با انتخاب هر یک از محصولات زیر، کانفیگ بلافاصله صادر شده و لینک اشتراک و QR Code آن به شما تحویل داده می‌شود و فقط <b>نرخ همکاری شما</b> در لیست بدهی منظوره می‌گردد:`,
            {
              parse_mode: 'HTML',
              reply_markup: { inline_keyboard }
            }
          );
          return;
        }

        if (data.startsWith('seller_direct_prod_')) {
          if (!isFromAdmin) return;
          const prodId = data.replace('seller_direct_prod_', '');
          await bot.answerCallbackQuery(query.id, { text: '⏳ در حال صدور مستقیم کانفیگ همکار...' }).catch(() => {});
          try {
            const purchase = await executeSellerPortalPurchase(sellerChatId, prodId, undefined, 'portal');
            const updatedSeller = db.getUser(sellerChatId) || seller;
            await this.sendBuyerServiceInfo(bot, updatedSeller, buyerChatId, { purchase });
            await bot.sendMessage(
              buyerChatId,
              `✅ <b>کانفیگ مستقیم همکار با موفقیت صادر شد!</b>\n` +
                `📉 مبلغ همکاری: <b>${(purchase.price || 0).toLocaleString()} تومان</b> در بدهی شما ثبت گردید.\n` +
                `💰 بدهی فعلی شما: <b>${(updatedSeller.debt || 0).toLocaleString()} تومان</b>`,
              { parse_mode: 'HTML' }
            );
          } catch (err: any) {
            await bot.sendMessage(buyerChatId, `❌ خطا در صدور مستقیم کانفیگ: ${err?.message || String(err)}`);
          }
          return;
        }

        if (data === 'seller_direct_cvol') {
          if (!isFromAdmin) return;
          await bot.answerCallbackQuery(query.id).catch(() => {});
          const { wholesalePricePerGb } = this.getCustomVolumePricesForSeller(seller);
          this.userSessionStates.set(sessionKey, { action: 'seller_direct_cvol_gb' });
          await bot.sendMessage(
            buyerChatId,
            `⚡ <b>صدور مستقیم کانفیگ با حجم دلخواه (نرخ همکاری):</b>\n\n` +
              `💰 نرخ همکاری هر گیگابایت برای شما: <b>${wholesalePricePerGb.toLocaleString()} تومان</b>\n\n` +
              `لطفاً حجم مورد نظر خود را به <b>گیگابایت</b> (مثلاً: <code>30</code> یا <code>100</code>) ارسال نمایید:`,
            {
              parse_mode: 'HTML',
              reply_markup: {
                keyboard: [[{ text: 'بازگشت به منوی اصلی', style: 'danger' } as any]],
                resize_keyboard: true
              }
            }
          );
          return;
        }

        if (data.startsWith('child_approve_')) {
          if (!isFromAdmin) {
            await bot.answerCallbackQuery(query.id, { text: '⛔ شما دسترسی مدیریت این ربات را ندارید.' });
            return;
          }
          const orderId = data.replace('child_approve_', '');
          await bot.answerCallbackQuery(query.id, { text: '⏳ در حال انجام عملیات و تحویل به مشتری...' }).catch(() => {});
          const fulfillRes = await this.fulfillResellerOrder(sellerChatId, orderId);
          if (fulfillRes.success) {
            await bot.sendMessage(
              buyerChatId,
              `✅ <b>سفارش <code>${orderId}</code> با موفقیت تایید و انجام شد!</b>\n${fulfillRes.message}`,
              { parse_mode: 'HTML' }
            );
          } else {
            await bot.sendMessage(buyerChatId, `⚠️ <b>خطا در تایید سفارش:</b> ${fulfillRes.message}`, { parse_mode: 'HTML' });
          }
          return;
        }

        if (data.startsWith('child_reject_')) {
          if (!isFromAdmin) {
            await bot.answerCallbackQuery(query.id, { text: '⛔ شما دسترسی مدیریت این ربات را ندارید.' });
            return;
          }
          const orderId = data.replace('child_reject_', '');
          await bot.answerCallbackQuery(query.id, { text: '❌ سفارش رد شد.' }).catch(() => {});
          await this.rejectResellerOrder(sellerChatId, orderId, 'فیش واریزی توسط مدیریت فروشگاه تایید نشد.');
          await bot.sendMessage(buyerChatId, `❌ سفارش <code>${orderId}</code> رد شد و به مشتری اطلاع‌رسانی گردید.`, {
            parse_mode: 'HTML'
          });
          return;
        }

        if (data === 'admin_view_pending') {
          if (!isFromAdmin) return;
          const pendings = (botCfg.orders || []).filter(o => o.status === 'pending');
          if (pendings.length === 0) {
            await bot.answerCallbackQuery(query.id, { text: '✅ هیچ سفارش معلقی وجود ندارد.' });
            return;
          }
          await bot.answerCallbackQuery(query.id).catch(() => {});
          for (const p of pendings.slice(0, 8)) {
            const pMsg =
              `⏳ <b>سفارش منتظر تایید:</b>\n` +
              `🆔 شناسه: <code>${p.id}</code>\n` +
              `👤 مشتری: ${escapeHtml(p.buyerName || '')} (<code>${p.buyerChatId}</code>)\n` +
              `📦 عنوان: <b>${escapeHtml(p.productName || '')}</b>\n` +
              `💵 مبلغ فیش: <b>${(p.retailPrice || 0).toLocaleString()} تومان</b>\n` +
              (p.type !== 'deposit' ? `💎 سود شما: <b>${(p.profit || 0).toLocaleString()} تومان</b>` : '');
            const kbd: any = {
              inline_keyboard: [
                [
                  { text: '✅ تایید و انجام آنی', callback_data: `child_approve_${p.id}`, style: 'success' },
                  { text: '❌ رد سفارش', callback_data: `child_reject_${p.id}`, style: 'danger' }
                ]
              ]
            };
            if (p.receiptFileId) {
              await bot.sendPhoto(buyerChatId, p.receiptFileId, { caption: pMsg, parse_mode: 'HTML', reply_markup: kbd }).catch(() => {});
            } else {
              await bot.sendMessage(buyerChatId, pMsg, { parse_mode: 'HTML', reply_markup: kbd }).catch(() => {});
            }
          }
          return;
        }

        // Admin: Manage Buyers & Manual Balance Charge
        if (data === 'admin_buyers_menu') {
          if (!isFromAdmin) return;
          await bot.answerCallbackQuery(query.id).catch(() => {});
          const buyers = botCfg.buyers || [];
          if (buyers.length === 0) {
            await bot.sendMessage(buyerChatId, 'ℹ️ هنوز هیچ کاربری وارد ربات شما نشده است.');
            return;
          }

          let textOut = `👥 <b>لیست مشتریان ربات شما (${buyers.length} نفر):</b>\n\nجهت شارژ دستی کیف پول یا مشاهده سرویس‌های هر مشتری، روی دکمه مربوط به او کلیک کنید:\n\n`;
          const inline_keyboard: any[][] = [];

          buyers.slice(-20).reverse().forEach(b => {
            const label = `👤 ${b.name || b.chatId} (${(b.balance || 0).toLocaleString()} ت)`;
            inline_keyboard.push([
              { text: label, callback_data: `admin_buyer_${b.chatId}`, style: 'primary' }
            ]);
          });

          inline_keyboard.push([{ text: '🔙 بازگشت به پنل مدیریت', callback_data: 'admin_main', style: 'danger' }]);
          await bot.sendMessage(buyerChatId, textOut, { parse_mode: 'HTML', reply_markup: { inline_keyboard } });
          return;
        }

        if (data.startsWith('admin_buyer_')) {
          if (!isFromAdmin) return;
          const targetId = Number(data.replace('admin_buyer_', ''));
          const b = (botCfg.buyers || []).find(item => item.chatId === targetId);
          if (!b) {
            await bot.answerCallbackQuery(query.id, { text: 'مشتری یافت نشد.' });
            return;
          }
          await bot.answerCallbackQuery(query.id).catch(() => {});
          const buyerOrders = (botCfg.orders || []).filter(o => o.buyerChatId === targetId && o.status === 'approved' && o.type !== 'deposit');

          const info =
            `👤 <b>مدیریت مشتری در ربات اختصاصی شما:</b>\n\n` +
            `🆔 شناسه عددی: <code>${b.chatId}</code>\n` +
            `👤 نام: <b>${escapeHtml(b.name || 'کاربر')}</b> (@${escapeHtml(b.username || 'بدون_آیدی')})\n` +
            `💰 موجودی کیف پول در ربات شما: <b>${(b.balance || 0).toLocaleString()} تومان</b>\n` +
            `📦 تعداد سرویس‌های فعال: <b>${buyerOrders.length} عدد</b>\n`;

          const inline_keyboard: any[][] = [
            [
              { text: '➕ شارژ دستی کیف پول مشتری', callback_data: `admin_charge_add_${b.chatId}`, style: 'success' },
              { text: '➖ کسر از کیف پول مشتری', callback_data: `admin_charge_sub_${b.chatId}`, style: 'danger' }
            ]
          ];

          buyerOrders.slice(-5).forEach(ord => {
            inline_keyboard.push([
              {
                text: `🔍 سرویس: ${ord.customName || ord.productName || ord.id}`,
                callback_data: `view_srv_${ord.id}`,
                style: 'primary'
              }
            ]);
          });

          inline_keyboard.push([{ text: '🔙 بازگشت به لیست مشتریان', callback_data: 'admin_buyers_menu', style: 'danger' }]);

          await bot.sendMessage(buyerChatId, info, { parse_mode: 'HTML', reply_markup: { inline_keyboard } });
          return;
        }

        if (data.startsWith('admin_charge_add_') || data.startsWith('admin_charge_sub_')) {
          if (!isFromAdmin) return;
          const isAdd = data.startsWith('admin_charge_add_');
          const targetId = Number(data.replace(/^admin_charge_add_|^admin_charge_sub_/, ''));
          await bot.answerCallbackQuery(query.id).catch(() => {});
          this.userSessionStates.set(sessionKey, {
            action: 'admin_charge_buyer_amount',
            data: { targetBuyerChatId: targetId, mode: isAdd ? 'add' : 'sub' }
          });
          await bot.sendMessage(
            buyerChatId,
            isAdd
              ? `➕ لطفاً مبلغی که می‌خواهید به کیف پول مشتری <code>${targetId}</code> <b>اضافه</b> شود را به تومان وارد نمایید:`
              : `➖ لطفاً مبلغی که می‌خواهید از کیف پول مشتری <code>${targetId}</code> <b>کسر</b> شود را به تومان وارد نمایید:`,
            { parse_mode: 'HTML' }
          );
          return;
        }

        // Admin: View & Manage All Sold Configs
        if (data === 'admin_all_configs') {
          if (!isFromAdmin) return;
          await bot.answerCallbackQuery(query.id).catch(() => {});
          const purchases = (seller.purchases || []).filter((p: any) => !p.isDeleted);
          if (purchases.length === 0) {
            await bot.sendMessage(buyerChatId, 'ℹ️ هنوز هیچ کانفیگی ثبت نشده است.');
            return;
          }

          let msg = `📋 <b>لیست آخرین کانفیگ‌های شما (${purchases.length} مورد):</b>\n\nجهت مشاهده لینک، بارکد، حجم مصرفی و تمدید هر کانفیگ روی آن کلیک کنید:`;
          const inline_keyboard: any[][] = [];
          purchases.slice(-15).reverse().forEach((p: any) => {
            inline_keyboard.push([
              {
                text: `🔑 ${p.customName || p.name || p.id} (${p.volumeGb || 0}GB)`,
                callback_data: `view_srv_${p.id}`,
                style: 'primary'
              }
            ]);
          });
          inline_keyboard.push([{ text: '🔙 بازگشت به پنل مدیریت', callback_data: 'admin_main', style: 'danger' }]);
          await bot.sendMessage(buyerChatId, msg, { parse_mode: 'HTML', reply_markup: { inline_keyboard } });
          return;
        }

        // Admin: Card Settings inside Telegram
        if (data === 'admin_card_settings') {
          if (!isFromAdmin) return;
          await bot.answerCallbackQuery(query.id).catch(() => {});
          this.userSessionStates.set(sessionKey, { action: 'admin_set_card_number' });
          await bot.sendMessage(
            buyerChatId,
            `💳 <b>تنظیم شماره کارت بانکی اختصاصی شما:</b>\n\n` +
              `شماره کارت فعلی: <code>${escapeHtml(botCfg.cardNumber || 'ثبت نشده')}</code>\n` +
              `صاحب حساب فعلی: <b>${escapeHtml(botCfg.cardHolder || 'ثبت نشده')}</b>\n\n` +
              `لطفاً <b>شماره کارت ۱۶ رقمی</b> خودتان را ارسال نمایید:`,
            { parse_mode: 'HTML' }
          );
          return;
        }

        // Admin: Retail Price Settings inside Telegram
        if (data === 'admin_price_settings') {
          if (!isFromAdmin) return;
          await bot.answerCallbackQuery(query.id).catch(() => {});
          const products = getAvailableProductsForReseller(seller);
          const { wholesalePricePerGb, retailPricePerGb } = this.getCustomVolumePricesForSeller(seller);

          let msg =
            `💰 <b>تعیین قیمت فروش محصولات در ربات اختصاصی شما:</b>\n\n` +
            `ℹ️ <i>توجه: هنگام خرید مشتری در این ربات، «قیمت فروش شما» از مشتری دریافت می‌شود و «قیمت خرید عمده شما» در لیست بدهکاری شما در ربات مادر ثبت می‌گردد.</i>\n\n` +
            `برای تغییر قیمت هر محصول، روی دکمه آن کلیک کنید:`;

          const inline_keyboard: any[][] = [];
          for (const p of products.slice(0, 25)) {
            const { wholesalePrice, retailPrice } = this.getProductPricesForSeller(seller, p);
            inline_keyboard.push([
              {
                text: `✏️ ${p.name} | خرید شما: ${wholesalePrice.toLocaleString()} | فروش: ${retailPrice.toLocaleString()} ت`,
                callback_data: `admin_edit_price_${p.id}`,
                style: 'primary'
              }
            ]);
          }

          inline_keyboard.push([
            {
              text: `⚡ نرخ هر گیگ حجم دلخواه | خرید: ${wholesalePricePerGb.toLocaleString()} | فروش: ${retailPricePerGb.toLocaleString()} ت`,
              callback_data: 'admin_edit_cvol_price',
              style: 'success'
            }
          ]);

          inline_keyboard.push([{ text: '🔙 بازگشت به پنل مدیریت', callback_data: 'admin_main', style: 'danger' }]);

          await bot.sendMessage(buyerChatId, msg, { parse_mode: 'HTML', reply_markup: { inline_keyboard } });
          return;
        }

        if (data.startsWith('admin_edit_price_')) {
          if (!isFromAdmin) return;
          const prodId = data.replace('admin_edit_price_', '');
          const state = db.getState();
          const product = (state.products || []).find(p => p.id === prodId);
          if (!product) return;
          const { wholesalePrice, retailPrice } = this.getProductPricesForSeller(seller, product);
          await bot.answerCallbackQuery(query.id).catch(() => {});
          this.userSessionStates.set(sessionKey, { action: 'admin_set_prod_price', data: { productId: prodId } });
          await bot.sendMessage(
            buyerChatId,
            `✏️ <b>تغییر قیمت فروش «${escapeHtml(product.name)}»</b>\n\n` +
              `📉 قیمت خرید عمده شما (کسر از بدهی): <b>${wholesalePrice.toLocaleString()} تومان</b>\n` +
              `💵 قیمت فروش فعلی به مشتری: <b>${retailPrice.toLocaleString()} تومان</b>\n\n` +
              `لطفاً قیمت فروش جدید به مشتری را به <b>تومان</b> ارسال نمایید:`,
            { parse_mode: 'HTML' }
          );
          return;
        }

        if (data === 'admin_edit_cvol_price') {
          if (!isFromAdmin) return;
          const { wholesalePricePerGb, retailPricePerGb } = this.getCustomVolumePricesForSeller(seller);
          await bot.answerCallbackQuery(query.id).catch(() => {});
          this.userSessionStates.set(sessionKey, { action: 'admin_set_cvol_price' });
          await bot.sendMessage(
            buyerChatId,
            `⚡ <b>تغییر نرخ فروش هر گیگابایت حجم دلخواه:</b>\n\n` +
              `📉 نرخ خرید عمده شما: <b>${wholesalePricePerGb.toLocaleString()} تومان</b>\n` +
              `💵 نرخ فروش فعلی به مشتری: <b>${retailPricePerGb.toLocaleString()} تومان</b>\n\n` +
              `لطفاً نرخ فروش جدید هر گیگابایت به مشتری را به <b>تومان</b> ارسال نمایید:`,
            { parse_mode: 'HTML' }
          );
          return;
        }

        // Admin: Brand, Support, Auto-Deliver & Free Test Settings
        if (data === 'admin_brand_settings') {
          if (!isFromAdmin) return;
          await bot.answerCallbackQuery(query.id).catch(() => {});
          const effectiveBotName = this.getEffectiveBotName(seller);
          const msg =
            `⚙️ <b>تنظیمات نام ربات، متن خوش‌آمدگویی، پشتیبانی و تست:</b>\n\n` +
            `🤖 <b>نام نمایشی در پیام خوش‌آمدگویی:</b> <b>${escapeHtml(effectiveBotName)}</b>\n` +
            `📝 <b>متن خوش‌آمدگویی استارت:</b> ${botCfg.welcomeMessage ? `سفارشی (${escapeHtml(botCfg.welcomeMessage.slice(0, 60))}...)` : `پیش‌فرض (خوش‌آمدگویی با نام بات «${escapeHtml(effectiveBotName)}»)`}\n` +
            `📞 <b>آیدی پشتیبانی:</b> @${escapeHtml((botCfg.supportUsername || seller.username || '').replace(/^@/, ''))}\n` +
            `⚡ <b>تحویل آنی پس از ارسال فیش:</b> ${botCfg.autoDeliverAfterPayment ? '✅ فعال' : '❌ غیرفعال'}\n` +
            `🎁 <b>تست رایگان برای مشتریان:</b> ${botCfg.freeTestEnabled !== false ? '✅ فعال' : '❌ غیرفعال'}`;

          const inline_keyboard: any[][] = [
            [
              { text: '🏷 تغییر نام نمایشی ربات', callback_data: 'admin_set_name_btn', style: 'primary' },
              { text: '🔄 استفاده از نام اصلی بات تلگرام', callback_data: 'admin_reset_bot_name', style: 'primary' }
            ],
            [
              { text: '📝 ویرایش متن خوش‌آمدگویی استارت', callback_data: 'admin_set_welcome_btn', style: 'primary' },
              { text: '📞 تغییر آیدی پشتیبانی', callback_data: 'admin_set_sup_btn', style: 'primary' }
            ],
            [
              {
                text: botCfg.autoDeliverAfterPayment ? '🔴 غیرفعال کردن تحویل خودکار' : '🟢 فعال کردن تحویل خودکار',
                callback_data: 'admin_toggle_autodeliver',
                style: botCfg.autoDeliverAfterPayment ? 'danger' : 'success'
              }
            ],
            [
              {
                text: botCfg.freeTestEnabled !== false ? '🔴 غیرفعال کردن تست رایگان' : '🟢 فعال کردن تست رایگان',
                callback_data: 'admin_toggle_freetest',
                style: botCfg.freeTestEnabled !== false ? 'danger' : 'success'
              }
            ],
            [{ text: '🔙 بازگشت به پنل مدیریت', callback_data: 'admin_main', style: 'danger' }]
          ];

          await bot.sendMessage(buyerChatId, msg, { parse_mode: 'HTML', reply_markup: { inline_keyboard } });
          return;
        }

        if (data === 'admin_reset_bot_name') {
          if (!isFromAdmin) return;
          botCfg.botName = botCfg.botFirstName || '';
          db.saveUser(seller);
          await bot.answerCallbackQuery(query.id, {
            text: `✅ نام ربات روی «${this.getEffectiveBotName(seller)}» تنظیم شد.`,
            show_alert: true
          }).catch(() => {});
          await sendAdminPanelMenu(buyerChatId, seller, msgId);
          return;
        }

        if (data === 'admin_set_welcome_btn') {
          if (!isFromAdmin) return;
          await bot.answerCallbackQuery(query.id).catch(() => {});
          this.userSessionStates.set(sessionKey, { action: 'admin_set_welcome_msg' });
          await bot.sendMessage(
            buyerChatId,
            `📝 <b>تنظیم متن خوش‌آمدگویی استارت ربات:</b>\n\n` +
              `لطفاً متن خوش‌آمدگویی دلخواه خود را ارسال کنید.\n` +
              `💡 <i>اگر می‌خواهید از متن استاندارد پیش‌فرض با نام ربات (<b>${escapeHtml(this.getEffectiveBotName(seller))}</b>) استفاده شود، کلمه <code>پیشفرض</code> را ارسال نمایید:</i>`,
            {
              parse_mode: 'HTML',
              reply_markup: {
                keyboard: [[{ text: 'بازگشت به منوی اصلی', style: 'danger' } as any]],
                resize_keyboard: true
              }
            }
          );
          return;
        }

        if (data === 'admin_toggle_autodeliver') {
          if (!isFromAdmin) return;
          botCfg.autoDeliverAfterPayment = !botCfg.autoDeliverAfterPayment;
          db.saveUser(seller);
          await bot.answerCallbackQuery(query.id, { text: '✅ وضعیت تحویل خودکار تغییر کرد.' });
          await sendAdminPanelMenu(buyerChatId, seller, msgId);
          return;
        }

        if (data === 'admin_toggle_freetest') {
          if (!isFromAdmin) return;
          botCfg.freeTestEnabled = !(botCfg.freeTestEnabled !== false);
          db.saveUser(seller);
          await bot.answerCallbackQuery(query.id, { text: '✅ وضعیت تست رایگان تغییر کرد.' });
          await sendAdminPanelMenu(buyerChatId, seller, msgId);
          return;
        }

        if (data === 'admin_set_sup_btn') {
          if (!isFromAdmin) return;
          await bot.answerCallbackQuery(query.id).catch(() => {});
          this.userSessionStates.set(sessionKey, { action: 'admin_set_support_id' });
          await bot.sendMessage(buyerChatId, '📞 لطفاً آیدی تلگرام پشتیبانی خود را ارسال نمایید (مثلاً <code>@MySupport</code>):', {
            parse_mode: 'HTML'
          });
          return;
        }

        if (data === 'admin_set_name_btn') {
          if (!isFromAdmin) return;
          await bot.answerCallbackQuery(query.id).catch(() => {});
          this.userSessionStates.set(sessionKey, { action: 'admin_set_bot_name' });
          await bot.sendMessage(buyerChatId, '🏷 لطفاً نام جدید ربات / فروشگاه خود را ارسال نمایید:');
          return;
        }

        if (data === 'back_main') {
          this.userSessionStates.delete(sessionKey);
          await bot.deleteMessage(buyerChatId, msgId).catch(() => {});
          await bot.sendMessage(
            buyerChatId,
            `به منوی اصلی ${escapeHtml(this.getEffectiveBotName(seller))} بازگشتید. لطفاً گزینه مورد نظر را انتخاب نمایید:`,
            { parse_mode: 'HTML', reply_markup: getMainKeyboard(seller, isFromAdmin) }
          );
          return;
        }
      } catch (cbErr: any) {
        console.error(`[ResellerBot @${sellerChatId} Callback Handler Error]:`, cbErr?.message || cbErr);
      }
    });
  }

  /**
   * Fulfill and deliver a pending order (Product Purchase, Custom Volume, Service Renewal, or Wallet Deposit)
   */
  public async fulfillResellerOrder(
    sellerChatId: number,
    orderId: string
  ): Promise<{ success: boolean; message: string; subUrl?: string }> {
    const seller = db.getUser(sellerChatId);
    if (!seller || !seller.sellerBot) {
      return { success: false, message: 'همکار یا ربات یافت نشد.' };
    }

    const order = (seller.sellerBot.orders || []).find(o => o.id === orderId);
    if (!order) {
      return { success: false, message: 'سفارش یافت نشد.' };
    }

    if (order.status === 'approved') {
      return { success: true, message: 'این سفارش قبلاً تایید و انجام شده است.', subUrl: order.deliveredSubUrl };
    }

    const record = this.activeBots.get(sellerChatId);
    const childBot =
      record?.bot || (seller.sellerBot?.botToken ? new TelegramBot(seller.sellerBot.botToken, { polling: false }) : null);

    try {
      // CASE 1: WALLET DEPOSIT IN BOT 2
      if (order.type === 'deposit') {
        const buyerRec = (seller.sellerBot.buyers || []).find(b => b.chatId === order.buyerChatId);
        if (buyerRec) {
          buyerRec.balance = (buyerRec.balance || 0) + (order.retailPrice || 0);
        }
        order.status = 'approved';
        order.approvedAt = new Date().toISOString();
        db.saveUser(seller);

        if (childBot) {
          await childBot
            .sendMessage(
              order.buyerChatId,
              `🎉 <b>فیش واریزی شما تایید شد و کیف پول شما به مبلغ ${(order.retailPrice || 0).toLocaleString()} تومان شارژ گردید!</b>\n\n` +
                `💰 <b>موجودی فعلی کیف پول شما:</b> <b>${(buyerRec?.balance || 0).toLocaleString()} تومان</b>\n` +
                `هم‌اکنون می‌توانید از منوی «🛒 خرید سرویس» یا «📋 لیست خریدهای من» به صورت آنی خرید یا تمدید نمایید.`,
              { parse_mode: 'HTML' }
            )
            .catch(() => {});
        }

        return {
          success: true,
          message: `کیف پول مشتری به مبلغ ${(order.retailPrice || 0).toLocaleString()} تومان شارژ شد.`
        };
      }

      // CASE 2: SERVICE RENEWAL IN BOT 2 (Charges Wholesale Cost to Seller's Debt in Bot 1)
      if (order.type === 'renew') {
        const allPurchases = seller.purchases || [];
        const purchase = allPurchases.find(
          (p: any) =>
            (order.deliveredPurchaseId && (p.id === order.deliveredPurchaseId || p.subId === order.deliveredPurchaseId)) ||
            (order.deliveredSubUrl &&
              (p.subUrl === order.deliveredSubUrl ||
                p.sanaeiSubUrl === order.deliveredSubUrl ||
                p.rebeccaSubUrl === order.deliveredSubUrl ||
                p.mroceanSubUrl === order.deliveredSubUrl ||
                p.panel4SubUrl === order.deliveredSubUrl))
        );

        if (!purchase) {
          throw new Error('کانفیگ اولیه جهت تمدید در لیست خریدهای همکار یافت نشد.');
        }

        const wholesaleCost = Number(order.wholesalePrice || 0);
        const volGb = Number(order.volumeGb || purchase.volumeGb || 10);
        const durDays = Number(order.durationDays || purchase.durationDays || 30);

        if (!isSellerUnlimitedLimit(seller)) {
          const currentDebt = seller.debt || 0;
          const limit = seller.debtLimit !== undefined && seller.debtLimit > 0 ? seller.debtLimit : 1000000;
          if (currentDebt + wholesaleCost > limit) {
            throw new Error(
              `سقف اعتبار مجاز شما در ربات مادر پر شده است! (بدهی فعلی: ${currentDebt.toLocaleString()} / سقف: ${limit.toLocaleString()} تومان)`
            );
          }
        }

        await multiPanel.renewClient(purchase, volGb, durDays);

        // Charge wholesale price to Seller's debt in Bot 1
        seller.debt = (seller.debt || 0) + wholesaleCost;
        seller.debtVolume = (seller.debtVolume || 0) + volGb;
        seller.totalSales = (seller.debt || 0) + (seller.totalPayments || 0);

        purchase.lastUsedBytes = 0;
        purchase.warnedData = false;
        purchase.warnedTime = false;
        purchase.disabled = false;
        purchase.volumeGb = volGb;
        purchase.durationDays = durDays;
        purchase.expiryDate = new Date(Date.now() + durDays * 86400000).toISOString();

        recordUserTransaction(seller, {
          type: 'purchase',
          amount: wholesaleCost,
          direction: 'debit',
          description: `تمدید سرویس مشتری در ربات اختصاصی (${purchase.name} - ${volGb}GB / ${durDays} روز)`,
          configName: purchase.name,
          volumeGb: volGb,
          balanceAfter: seller.balance,
          debtAfter: seller.debt,
          createdAt: new Date().toISOString()
        });

        order.status = 'approved';
        order.approvedAt = new Date().toISOString();
        order.deliveredPurchaseId = purchase.id;
        order.deliveredSubUrl =
          purchase.subUrl ||
          purchase.sanaeiSubUrl ||
          purchase.rebeccaSubUrl ||
          purchase.mroceanSubUrl ||
          purchase.panel4SubUrl ||
          '';

        seller.sellerBot.totalRevenueToman = (seller.sellerBot.totalRevenueToman || 0) + (order.retailPrice || 0);
        seller.sellerBot.totalWholesaleCostToman = (seller.sellerBot.totalWholesaleCostToman || 0) + wholesaleCost;
        seller.sellerBot.totalProfitToman = (seller.sellerBot.totalProfitToman || 0) + (order.profit || 0);

        db.saveUser(seller);

        // Notify Seller in Master Bot about debt addition
        const masterBot = getBot();
        if (masterBot) {
          masterBot
            .sendMessage(
              sellerChatId,
              `♻️ <b>تمدید سرویس در ربات اختصاصی شما انجام شد</b>\n\n` +
                `📦 سرویس: <b>${escapeHtml(purchase.name)}</b>\n` +
                `💵 دریافتی شما از مشتری: <b>${(order.retailPrice || 0).toLocaleString()} تومان</b>\n` +
                `📉 هزینه عمده ثبت‌شده در بدهی شما: <b>${wholesaleCost.toLocaleString()} تومان</b>\n` +
                `💎 سود خالص شما: <b>${(order.profit || 0).toLocaleString()} تومان</b>\n` +
                `📊 بدهی کل فعلی شما: <b>${(seller.debt || 0).toLocaleString()} تومان</b>`,
              { parse_mode: 'HTML' }
            )
            .catch(() => {});
        }

        if (childBot) {
          await childBot
            .sendMessage(
              order.buyerChatId,
              `✅ <b>تمدید سرویس شما با موفقیت انجام شد!</b>\n\n` +
                `حجم مصرفی شما صفر شد و <b>${volGb} گیگابایت</b> حجم جدید به همراه <b>${durDays} روز</b> اعتبار به همان لینک قبلی شما اضافه گردید. نیازی به تغییر لینک در برنامه ندارید و کافیست یک‌بار Update Subscription بزنید.`,
              { parse_mode: 'HTML' }
            )
            .catch(() => {});
          await this.sendBuyerServiceInfo(childBot, seller, order.buyerChatId, { order, purchase });
        }

        return {
          success: true,
          message: 'سرویس مشتری با موفقیت تمدید شد و هزینه عمده در لیست بدهی شما ثبت گردید.',
          subUrl: order.deliveredSubUrl
        };
      }

      // CASE 3: NEW PRODUCT OR CUSTOM VOLUME PURCHASE
      let purchase: any;
      const cleanCustomName =
        order.customName || `${order.buyerUsername || 'vip'}_${order.buyerChatId.toString().slice(-4)}`;

      if (order.type === 'custom_volume' && order.volumeGb) {
        purchase = await executeSellerCustomVolumePurchase({
          sellerChatId,
          volumeGb: order.volumeGb,
          durationDays: order.durationDays || 30,
          customName: cleanCustomName,
          source: 'api'
        });
      } else if (order.productId) {
        purchase = await executeSellerPortalPurchase(sellerChatId, order.productId, cleanCustomName, 'api');
      } else {
        throw new Error('نوع سفارش نامشخص است.');
      }

      // Re-fetch seller because executeSellerPortalPurchase updated seller.debt & seller.purchases in db!
      const updatedSeller = db.getUser(sellerChatId) || seller;
      const updatedOrder = (updatedSeller.sellerBot?.orders || []).find(o => o.id === orderId) || order;

      const configLink =
        purchase.subUrl ||
        purchase.panel4SubUrl ||
        purchase.mroceanSubUrl ||
        purchase.sanaeiSubUrl ||
        purchase.rebeccaSubUrl ||
        '';

      updatedOrder.status = 'approved';
      updatedOrder.approvedAt = new Date().toISOString();
      updatedOrder.deliveredPurchaseId = purchase.id;
      updatedOrder.deliveredSubUrl = configLink;

      if (updatedSeller.sellerBot) {
        updatedSeller.sellerBot.totalRevenueToman =
          (updatedSeller.sellerBot.totalRevenueToman || 0) + (updatedOrder.retailPrice || 0);
        updatedSeller.sellerBot.totalWholesaleCostToman =
          (updatedSeller.sellerBot.totalWholesaleCostToman || 0) + (updatedOrder.wholesalePrice || 0);
        updatedSeller.sellerBot.totalProfitToman =
          (updatedSeller.sellerBot.totalProfitToman || 0) + (updatedOrder.profit || 0);
      }

      db.saveUser(updatedSeller);

      if (childBot) {
        await childBot
          .sendMessage(
            updatedOrder.buyerChatId,
            `🎉 <b>خرید شما با موفقیت انجام و سرویس شما فعال شد!</b>`,
            { parse_mode: 'HTML' }
          )
          .catch(() => {});
        await this.sendBuyerServiceInfo(childBot, updatedSeller, updatedOrder.buyerChatId, {
          order: updatedOrder,
          purchase
        });
      }

      return {
        success: true,
        message: 'کانفیگ روی سرور ساخته شد، به خریدار تحویل گردید و مبلغ عمده در لیست بدهی همکار منظور شد.',
        subUrl: configLink
      };
    } catch (e: any) {
      console.error('[Fulfill Reseller Order Error]', e);
      return { success: false, message: 'خطا در صدور یا تمدید کانفیگ: ' + (e.message || String(e)) };
    }
  }

  /**
   * Reject a pending order
   */
  public async rejectResellerOrder(
    sellerChatId: number,
    orderId: string,
    reason?: string
  ): Promise<{ success: boolean; message: string }> {
    const seller = db.getUser(sellerChatId);
    if (!seller || !seller.sellerBot) {
      return { success: false, message: 'همکار یا ربات یافت نشد.' };
    }

    const order = (seller.sellerBot.orders || []).find(o => o.id === orderId);
    if (!order) {
      return { success: false, message: 'سفارش یافت نشد.' };
    }

    order.status = 'rejected';
    order.rejectReason = reason || 'فیش واریزی معتبر نیست یا پرداخت تایید نشد.';
    db.saveUser(seller);

    const record = this.activeBots.get(sellerChatId);
    if (record?.bot) {
      try {
        await record.bot.sendMessage(
          order.buyerChatId,
          `❌ <b>سفارش شما تایید نشد:</b>\n\n` +
            `📦 عنوان: ${escapeHtml(order.productName || 'سفارش')}\n` +
            `📝 علت: ${escapeHtml(order.rejectReason)}\n\n` +
            `لطفاً در صورت نیاز با پشتیبانی فروشگاه در ارتباط باشید.`,
          { parse_mode: 'HTML' }
        );
      } catch (e) {}
    }

    return { success: true, message: 'سفارش با موفقیت رد شد و به خریدار اطلاع داده شد.' };
  }
}

export const resellerBotManager = new ResellerBotManager();
