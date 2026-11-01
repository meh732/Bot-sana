import TelegramBot from 'node-telegram-bot-api';
import { db, User, SellerBotConfig, SellerBotOrder } from './db.js';
import { executeSellerPortalPurchase, executeSellerCustomVolumePurchase, getSellerDiscountForProduct, getBot } from './bot.js';
import { multiPanel } from './multiPanel.js';
import QRCode from 'qrcode';

interface ActiveBotRecord {
  bot: TelegramBot;
  username: string;
  sellerChatId: number;
  startedAt: number;
}

class ResellerBotManager {
  private activeBots: Map<number, ActiveBotRecord> = new Map();
  private userSessionStates: Map<string, { action: string; data?: any }> = new Map();

  /**
   * Initialize all active reseller bots from database
   */
  public async initAllResellerBots(): Promise<void> {
    console.log('[ResellerBotManager] Initializing all active reseller bots...');
    const state = db.getState();
    const sellers = (state.users || []).filter(u => u.isSeller && u.sellerBot?.enabled && u.sellerBot?.botToken);

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
    // Stop existing if running
    await this.stopResellerBot(sellerChatId);

    const user = db.getUser(sellerChatId);
    if (!user || !user.isSeller || !user.sellerBot || !user.sellerBot.enabled) {
      return { success: false, message: 'ربات اختصاصی برای این همکار فعال نشده است.' };
    }

    const token = (user.sellerBot.botToken || '').trim();
    if (!token || !/^\d+:[A-Za-z0-9_-]{20,}$/.test(token)) {
      return { success: false, message: 'فرمت توکن ربات تلگرام نامعتبر است. توکن را از @BotFather دریافت نمایید.' };
    }

    // Prevent using the main system bot token as a reseller bot token (causes 409 Conflict and stops both bots)
    const state = db.getState();
    const mainToken = (state.botToken || process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '').trim();
    if (mainToken && token === mainToken) {
      return {
        success: false,
        message: 'این توکن متعلق به ربات مادر (اصلی) است! لطفاً در @BotFather یک ربات جدید بسازید و توکن ربات دوم را وارد نمایید.'
      };
    }

    // Prevent duplicate token across multiple sellers
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
      // Configure polling options in constructor with autoStart: false so error listeners are attached first
      bot = new TelegramBot(token, {
        polling: {
          interval: 400,
          autoStart: false,
          params: {
            timeout: 10,
            allowed_updates: ['message', 'callback_query']
          }
        }
      });

      this.attachBotHandlers(bot, sellerChatId);

      // Verify token with Telegram using a 7-second timeout so slow networks never hang the HTTP response
      const me = await Promise.race([
        bot.getMe(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('مهلت اتصال به تلگرام به پایان رسید (Timeout). لطفاً اتصال سرور به تلگرام یا صحت توکن را بررسی نمایید.')), 7000)
        )
      ]);
      const botUsername = me?.username || '';

      user.sellerBot.botUsername = botUsername;
      db.saveUser(user);
      db.saveImmediate();

      // Delete any stale webhook in background and start polling without blocking HTTP response
      (bot as any).deleteWebHook({ drop_pending_updates: false }).catch(() => {});
      bot.startPolling().catch((pollErr: any) => {
        console.warn(`[ResellerBot @${sellerChatId}] Initial startPolling warning:`, pollErr?.message || pollErr);
      });

      bot.setMyCommands([
        { command: '/start', description: 'منوی اصلی فروشگاه' },
        { command: '/admin', description: 'پنل مدیریت ربات (ویژه ادمین)' }
      ]).catch(() => {});

      this.activeBots.set(sellerChatId, {
        bot,
        username: botUsername,
        sellerChatId,
        startedAt: Date.now()
      });

      console.log(`[ResellerBotManager] Reseller bot @${botUsername} started successfully for seller ${sellerChatId}`);
      return {
        success: true,
        username: botUsername,
        message: `ربات اختصاصی شما (@${botUsername}) با موفقیت روشن شد و هم‌اکنون آنلاین است.`
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
      console.error(`[ResellerBotManager] Error launching bot for seller ${sellerChatId}:`, err?.message || err);
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
      console.log(`[ResellerBotManager] Stopped bot for seller ${sellerChatId}`);
      return true;
    }
    return false;
  }

  /**
   * Check if a reseller bot is running
   */
  public isBotRunning(sellerChatId: number): boolean {
    return this.activeBots.has(sellerChatId);
  }

  /**
   * Get reseller bot live status
   */
  public getBotStatus(sellerChatId: number) {
    const isOnline = this.activeBots.has(sellerChatId);
    const user = db.getUser(sellerChatId);
    const config = user?.sellerBot;

    return {
      isOnline,
      botUsername: config?.botUsername || '',
      botName: config?.botName || 'فروشگاه اختصاصی',
      buyersCount: (config?.buyers || []).length,
      ordersCount: (config?.orders || []).length,
      pendingOrdersCount: (config?.orders || []).filter(o => o.status === 'pending').length,
      totalRevenue: config?.totalRevenueToman || 0,
      totalProfit: config?.totalProfitToman || 0
    };
  }

  /**
   * Helper to attach standard handlers to a child bot instance
   */
  private attachBotHandlers(bot: TelegramBot, sellerChatId: number) {
    const getSessionKey = (buyerChatId: number) => `${sellerChatId}_${buyerChatId}`;

    const getMainKeyboard = (seller: User, isUserAdmin: boolean = false) => {
      const cfg = seller.sellerBot || ({} as SellerBotConfig);
      const rows: string[][] = [
        ['🛍 خرید اشتراک وی‌پی‌ان', '⚡ خرید حجم دلخواه'],
      ];
      if (cfg.freeTestEnabled !== false) {
        rows.push(['🎁 دریافت اکانت تست رایگان', '👤 سرویس‌های من']);
      } else {
        rows.push(['👤 سرویس‌های من']);
      }
      rows.push(['💳 راهنمای پرداخت', '📞 پشتیبانی و راهنما']);
      if (isUserAdmin) {
        rows.push(['👑 پنل مدیریت ربات']);
      }

      return {
        keyboard: rows.map(r => r.map(text => ({ text }))),
        resize_keyboard: true
      };
    };

    // Error safety for polling
    bot.on('polling_error', (error: any) => {
      const errMsg = error?.message || String(error);
      if (errMsg.includes('401') || errMsg.includes('404') || errMsg.includes('Unauthorized') || errMsg.includes('Not Found')) {
        console.error(`[ResellerBot @${sellerChatId}] Invalid or revoked token. Stopping child bot polling.`);
        this.stopResellerBot(sellerChatId).catch(() => {});
        return;
      }
      console.warn(`[ResellerBot @${sellerChatId}] Polling warning:`, errMsg);
    });

    bot.on('error', (error: any) => {
      console.warn(`[ResellerBot @${sellerChatId}] General warning:`, error?.message || error);
    });

    // Handle incoming messages
    bot.on('message', async (msg) => {
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
      const isUserAdmin = (buyerChatId === targetAdminChatId || buyerChatId === sellerChatId);

      // Track buyer in reseller's buyers list
      if (!botCfg.buyers) botCfg.buyers = [];
      let buyerRecord = botCfg.buyers.find(b => b.chatId === buyerChatId);
      if (!buyerRecord) {
        buyerRecord = {
          chatId: buyerChatId,
          username: msg.from.username || '',
          name: [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' ') || 'کاربر',
          joinedAt: new Date().toISOString()
        };
        botCfg.buyers.push(buyerRecord);
        db.saveUser(seller);
      }

      // Handle Admin Panel command
      if ((text === '👑 پنل مدیریت ربات' || text === '/admin' || text === '/panel' || text === 'مدیریت') && isUserAdmin) {
        this.userSessionStates.delete(sessionKey);
        const pendingOrders = (botCfg.orders || []).filter(o => o.status === 'pending');
        const adminMsg = `👑 <b>پنل مدیریت ربات اختصاصی (${botCfg.botName || 'فروشگاه'})</b>\n\n` +
          `👤 <b>مدیر ربات:</b> <code>${buyerChatId}</code>\n` +
          `👥 <b>کل خریداران:</b> <b>${(botCfg.buyers || []).length} نفر</b>\n` +
          `📦 <b>کل سفارشات:</b> <b>${(botCfg.orders || []).length} سفارش</b>\n` +
          `⏳ <b>سفارشات معلق فیش:</b> <b>${pendingOrders.length} مورد</b>\n` +
          `💵 <b>فروش ناخالص:</b> <b>${(botCfg.totalRevenueToman || 0).toLocaleString()} تومان</b>\n` +
          `💎 <b>سود خالص شما:</b> <b>${(botCfg.totalProfitToman || 0).toLocaleString()} تومان</b>\n\n` +
          `💡 <i>جهت اعمال تغییرات در قیمت‌ها، اطلاعات کارت و متون، می‌توانید از پورتال وب نیز استفاده فرمایید.</i>`;

        const inlineButtons: any[][] = [];
        if (pendingOrders.length > 0) {
          inlineButtons.push([{ text: `📋 بررسی ${pendingOrders.length} سفارش در انتظار`, callback_data: 'admin_view_pending' }]);
        }
        inlineButtons.push([{ text: '🔄 به‌روزرسانی اطلاعات', callback_data: 'admin_refresh_stats' }]);

        await bot.sendMessage(buyerChatId, adminMsg, {
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: inlineButtons }
        });
        return;
      }

      // Handle /start or بازگشت به منوی اصلی
      if (text.startsWith('/start') || text === 'بازگشت به منوی اصلی' || text === 'منوی اصلی' || text === '/menu') {
        this.userSessionStates.delete(sessionKey);
        let welcome = botCfg.welcomeMessage ||
          `سلام ${msg.from.first_name || 'کاربر گرامی'} عزیز،\nبه ربات رسمی فروش سرویس‌های پرسرعت و ضد فیلتر <b>${botCfg.botName || 'اختصاصی'}</b> خوش آمدید! 🚀\n\nجهت خرید یا مدیریت سرویس‌های خود از منوی زیر استفاده نمایید:`;

        if (isUserAdmin) {
          welcome += `\n\n👑 <i>(شما به عنوان مدیر این ربات شناسایی شدید. گزینه «👑 پنل مدیریت ربات» برای شما فعال است.)</i>`;
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

      // Handle "🛍 خرید اشتراک وی‌پی‌ان"
      if (text === '🛍 خرید اشتراک وی‌پی‌ان' || text === '/buy' || text === 'خرید اشتراک') {
        this.userSessionStates.delete(sessionKey);
        const state = db.getState();
        const categories = (state.categories || []).filter(c => !c.disabled);
        const products = (state.products || []).filter(p => !p.disabled);

        if (products.length === 0) {
          await bot.sendMessage(buyerChatId, '⚠️ در حال حاضر محصول فعالی در فروشگاه تعریف نشده است. لطفاً بعداً مراجعه نمایید.');
          return;
        }

        // Generate Inline Keyboard for products
        const inlineKeyboard: any[][] = [];
        for (const p of products) {
          // Reseller retail price
          const wholesalePrice = Math.max(0, Math.round(p.price * (1 - getSellerDiscountForProduct(seller, p) / 100)));
          const retailPrice = botCfg.customRetailPrices?.[p.id] !== undefined
            ? botCfg.customRetailPrices[p.id]
            : (seller.customDisplayPrices?.[p.id] !== undefined ? seller.customDisplayPrices[p.id] : p.price);

          const volStr = `${p.volumeGb} گیگ`;
          const durStr = p.durationDays ? `${p.durationDays} روز` : 'نامحدود';
          const label = `📦 ${p.name} (${volStr} - ${durStr}) - ${retailPrice.toLocaleString()} تومان`;

          inlineKeyboard.push([{
            text: label,
            callback_data: `buy_prod_${p.id}`
          }]);
        }

        inlineKeyboard.push([{ text: '🔙 بازگشت به منوی اصلی', callback_data: 'back_main' }]);

        await bot.sendMessage(
          buyerChatId,
          `📦 <b>لیست تعرفه‌ها و اشتراک‌های اختصاصی ${botCfg.botName || ''}:</b>\n\nلطفاً پلن مورد نظر خود را جهت خرید انتخاب نمایید:`,
          {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: inlineKeyboard }
          }
        );
        return;
      }

      // Handle "⚡ خرید حجم دلخواه"
      if (text === '⚡ خرید حجم دلخواه') {
        const state = db.getState();
        if (state.customVolumeEnabled === false) {
          await bot.sendMessage(buyerChatId, '⚠️ خرید حجم دلخواه در حال حاضر غیرفعال است.');
          return;
        }

        const wholesalePricePerGb = Math.max(0, Math.round((seller.customVolumePricePerGb || state.customVolumePricePerGb || 3000) * (1 - (seller.sellerDiscount || 0) / 100)));
        const retailPricePerGb = botCfg.customVolumeRetailPricePerGb !== undefined
          ? botCfg.customVolumeRetailPricePerGb
          : Math.round(wholesalePricePerGb * 1.3);

        this.userSessionStates.set(sessionKey, { action: 'awaiting_custom_volume_gb' });

        await bot.sendMessage(
          buyerChatId,
          `⚡ <b>خرید سرویس با حجم انتخابی شما:</b>\n\n` +
          `💰 نرخ هر گیگابایت: <b>${retailPricePerGb.toLocaleString()} تومان</b> (مدت اعتبار: ۳۰ روز)\n\n` +
          `لطفاً میزان حجم درخواستی خود را به <b>عدد گیگابایت</b> (مثلاً: 15 یا 25 یا 50) ارسال نمایید:`,
          {
            parse_mode: 'HTML',
            reply_markup: {
              keyboard: [[{ text: 'بازگشت به منوی اصلی' }]],
              resize_keyboard: true
            }
          }
        );
        return;
      }

      // Handle "🎁 دریافت اکانت تست رایگان"
      if (text === '🎁 دریافت اکانت تست رایگان') {
        if (botCfg.freeTestEnabled === false) {
          await bot.sendMessage(buyerChatId, '⚠️ اکانت تست در حال حاضر غیرفعال می‌باشد.');
          return;
        }

        if (buyerRecord.testUsed) {
          await bot.sendMessage(buyerChatId, '⚠️ شما قبلاً یک‌بار اکانت تست رایگان دریافت نموده‌اید. جهت ادامه استفاده، لطفاً از منوی خرید اشتراک استفاده نمایید.');
          return;
        }

        try {
          const state = db.getState();
          const volGb = botCfg.freeTestVolumeGb || state.freeTestVolumeGb || 1;
          const durDays = botCfg.freeTestDurationDays || state.freeTestDurationDays || 3;
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
          db.saveUser(seller);

          const mainSub = clientResult.subUrl || clientResult.sanaeiSubUrl || clientResult.rebeccaSubUrl || clientResult.mroceanSubUrl || clientResult.panel4SubUrl || '';

          let qrBuffer: Buffer | null = null;
          if (mainSub) {
            try {
              qrBuffer = await QRCode.toBuffer(mainSub, { width: 400, margin: 2 });
            } catch (e) {}
          }

          const msgText = `🎁 <b>اکانت تست رایگان شما آماده است:</b>\n\n` +
            `📊 <b>حجم تست:</b> ${volGb} گیگابایت\n` +
            `⏳ <b>مدت زمان:</b> ${durDays} روز\n\n` +
            `🔗 <b>لینک اتصال سابسکریپشن:</b>\n<code>${mainSub}</code>\n\n` +
            `⚡ <i>جهت اتصال کافیست لینک بالا را کپی کرده و در برنامه v2rayNG / Mahsa / Streisand / Nekobox وارد نمایید.</i>`;

          if (qrBuffer) {
            await bot.sendPhoto(buyerChatId, qrBuffer, {
              caption: msgText,
              parse_mode: 'HTML'
            });
          } else {
            await bot.sendMessage(buyerChatId, msgText, { parse_mode: 'HTML' });
          }
        } catch (testErr: any) {
          console.error('[Reseller Bot Free Test Error]', testErr);
          await bot.sendMessage(buyerChatId, 'خطا در صدور اکانت تست. لطفاً به پشتیبانی پیام دهید.');
        }
        return;
      }

      // Handle "👤 سرویس‌های من"
      if (text === '👤 سرویس‌های من') {
        const myOrders = (botCfg.orders || []).filter(o => o.buyerChatId === buyerChatId && o.status === 'approved' && o.deliveredSubUrl);
        if (myOrders.length === 0) {
          await bot.sendMessage(buyerChatId, 'ℹ️ شما هنوز هیچ سرویس فعالی خریداری نکرده‌اید.');
          return;
        }

        let resp = `👤 <b>سرویس‌های خریداری‌شده شما:</b>\n\n`;
        myOrders.forEach((ord, idx) => {
          resp += `🔹 <b>سرویس ${idx + 1}: ${ord.productName || 'وی‌پی‌ان اختصاصی'}</b>\n` +
            `📅 تاریخ: ${new Date(ord.createdAt).toLocaleDateString('fa-IR')}\n` +
            `🔗 <b>لینک اتصال:</b>\n<code>${ord.deliveredSubUrl}</code>\n\n`;
        });
        resp += `⚡ <i>برای به‌روزرسانی حجم و استفاده، لینک بالا را در نرم‌افزار خود آپدیت کنید.</i>`;

        await bot.sendMessage(buyerChatId, resp, { parse_mode: 'HTML' });
        return;
      }

      // Handle "💳 راهنمای پرداخت"
      if (text === '💳 راهنمای پرداخت') {
        const cardNum = botCfg.cardNumber || 'هنوز شماره کارتی ثبت نشده است';
        const cardHolder = botCfg.cardHolder || '';
        await bot.sendMessage(
          buyerChatId,
          `💳 <b>اطلاعات پرداخت و شماره کارت فروشگاه:</b>\n\n` +
          `💳 شماره کارت:\n<code>${cardNum}</code>\n` +
          `👤 به نام: <b>${cardHolder}</b>\n\n` +
          `پس از انتخاب پلن از منوی «خرید اشتراک»، مبلغ را به کارت فوق واریز نموده و تصویر فیش را ارسال فرمایید تا کانفیگ بلافاصله صادر شود.`,
          { parse_mode: 'HTML' }
        );
        return;
      }

      // Handle "📞 پشتیبانی و راهنما"
      if (text === '📞 پشتیبانی و راهنما') {
        const sup = botCfg.supportUsername ? `@${botCfg.supportUsername.replace(/^@/, '')}` : 'پشتیبانی در دسترس است';
        const ch = botCfg.channelUsername ? `@${botCfg.channelUsername.replace(/^@/, '')}` : '';
        await bot.sendMessage(
          buyerChatId,
          `📞 <b>ارتباط با پشتیبانی فروشگاه:</b>\n\n` +
          `👤 آیدی پشتیبانی تلگرام: ${sup}\n` +
          (ch ? `📢 کانال اطلاع‌رسانی: ${ch}\n` : '') +
          `\nدر صورت بروز هرگونه سوال یا مشکل با ما در ارتباط باشید.`,
          { parse_mode: 'HTML' }
        );
        return;
      }

      // State: awaiting custom volume input
      const session = this.userSessionStates.get(sessionKey);
      if (session && session.action === 'awaiting_custom_volume_gb') {
        const gb = parseInt(text.replace(/[۰-۹]/g, d => String.fromCharCode(d.charCodeAt(0) - 1728)));
        if (isNaN(gb) || gb <= 0 || gb > 500) {
          await bot.sendMessage(buyerChatId, '❌ لطفاً یک عدد معتبر بین ۱ تا ۵۰۰ گیگابایت وارد فرمایید:');
          return;
        }

        const state = db.getState();
        const wholesalePricePerGb = Math.max(0, Math.round((seller.customVolumePricePerGb || state.customVolumePricePerGb || 3000) * (1 - (seller.sellerDiscount || 0) / 100)));
        const retailPricePerGb = botCfg.customVolumeRetailPricePerGb !== undefined
          ? botCfg.customVolumeRetailPricePerGb
          : Math.round(wholesalePricePerGb * 1.3);

        const totalRetailPrice = gb * retailPricePerGb;
        const totalWholesalePrice = gb * wholesalePricePerGb;

        this.userSessionStates.set(sessionKey, {
          action: 'awaiting_receipt',
          data: {
            type: 'custom_volume',
            volumeGb: gb,
            durationDays: 30,
            retailPrice: totalRetailPrice,
            wholesalePrice: totalWholesalePrice,
            productName: `سرویس سفارشی ${gb} گیگابایت`
          }
        });

        const cardNum = botCfg.cardNumber || (seller as any).cardNumber || state.cardNumber || '۶۰۳۷۹۹۷۹۱۲۳۴۵۶۷۸';
        const cardHolder = botCfg.cardHolder || (seller as any).cardHolder || state.cardHolder || 'مدیر فروشگاه';

        await bot.sendMessage(
          buyerChatId,
          `✅ <b>سفارش حجم دلخواه ${gb} گیگابایت آماده پرداخت است:</b>\n\n` +
          `💰 مبلغ قابل پرداخت: <b>${totalRetailPrice.toLocaleString()} تومان</b>\n\n` +
          `💳 <b>اطلاعات کارت جهت واریز:</b>\n` +
          `شماره کارت:\n<code>${cardNum}</code>\n` +
          `به نام: <b>${cardHolder}</b>\n\n` +
          `📸 لطفاً پس از واریز، <b>عکس فیش واریزی</b> را همینجا ارسال نمایید:`,
          {
            parse_mode: 'HTML',
            reply_markup: {
              keyboard: [[{ text: 'بازگشت به منوی اصلی' }]],
              resize_keyboard: true
            }
          }
        );
        return;
      }

      // Handle photo uploads (Receipt for pending order)
      if (msg.photo && msg.photo.length > 0) {
        if (!session || session.action !== 'awaiting_receipt' || !session.data) {
          await bot.sendMessage(buyerChatId, 'ℹ️ فیش ارسالی شناسایی شد، اما ابتدا باید از منوی «خرید اشتراک»، پلن مورد نظر خود را انتخاب نمایید.');
          return;
        }

        const orderData = session.data;
        const largestPhoto = msg.photo[msg.photo.length - 1];
        const orderId = `ord_${Date.now()}_${Math.floor(100 + Math.random() * 899)}`;

        const profit = Math.max(0, orderData.retailPrice - orderData.wholesalePrice);

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
          wholesalePrice: orderData.wholesalePrice,
          profit,
          receiptFileId: largestPhoto.file_id,
          status: botCfg.autoDeliverAfterPayment ? 'approved' : 'pending',
          createdAt: new Date().toISOString()
        };

        if (!botCfg.orders) botCfg.orders = [];
        botCfg.orders.push(newOrder);
        db.saveUser(seller);

        this.userSessionStates.delete(sessionKey);

        // Check if Auto-Delivery is enabled
        if (botCfg.autoDeliverAfterPayment) {
          await this.fulfillResellerOrder(sellerChatId, orderId);
        } else {
          await bot.sendMessage(
            buyerChatId,
            `✅ <b>رسید پرداخت شما با موفقیت ثبت شد!</b>\n\n` +
            `سفارش شما در صف بررسی قرار گرفت و پس از تایید مدیریت فروشگاه، کانفیگ شما به صورت خودکار همینجا ارسال خواهد شد. 🙏`,
            {
              parse_mode: 'HTML',
              reply_markup: getMainKeyboard(seller)
            }
          );

          // 1. Notify the Partner Admin directly inside the Child Bot!
          try {
            const childAdminMsg = `🔔 <b>سفارش و رسید پرداخت جدید در ربات اختصاصی شما!</b>\n\n` +
              `👤 مشتری: <b>${newOrder.buyerName}</b> (@${newOrder.buyerUsername || 'بدون آیدی'})\n` +
              `🆔 شناسه مشتری: <code>${newOrder.buyerChatId}</code>\n` +
              `📦 پکیج انتخابی: <b>${newOrder.productName}</b>\n` +
              `💵 واریزی مشتری به کارت شما: <b>${newOrder.retailPrice.toLocaleString()} تومان</b>\n` +
              `📉 هزینه عمده (کسر از بدهی): <b>${newOrder.wholesalePrice.toLocaleString()} تومان</b>\n` +
              `💎 <b>سود خالص شما: ${newOrder.profit.toLocaleString()} تومان</b>\n\n` +
              `جهت تایید و تحویل آنی کانفیگ به خریدار، روی دکمه زیر کلیک نمایید:`;

            const adminInlineKeyboard = {
              inline_keyboard: [
                [
                  { text: '✅ تایید و صدور آنی کانفیگ', callback_data: `child_approve_${orderId}` },
                  { text: '❌ رد فیش', callback_data: `child_reject_${orderId}` }
                ]
              ]
            };

            if (largestPhoto && largestPhoto.file_id) {
              await bot.sendPhoto(targetAdminChatId, largestPhoto.file_id, {
                caption: childAdminMsg,
                parse_mode: 'HTML',
                reply_markup: adminInlineKeyboard
              });
            } else {
              await bot.sendMessage(targetAdminChatId, childAdminMsg, {
                parse_mode: 'HTML',
                reply_markup: adminInlineKeyboard
              });
            }
          } catch (childAdminErr) {
            console.warn('[Reseller Bot Direct Admin Notify Error]', childAdminErr);
          }

          // 2. Also notify in Master Bot as additional safety
          try {
            const masterBot = getBot();
            if (masterBot) {
              const notifyMsg = `🔔 <b>سفارش و فیش پرداخت جدید در ربات اختصاصی شما (@${botCfg.botUsername || botCfg.botName})!</b>\n\n` +
                `👤 مشتری: ${newOrder.buyerName} (@${newOrder.buyerUsername || 'بدون آیدی'})\n` +
                `📦 محصول: <b>${newOrder.productName}</b>\n` +
                `💵 واریزی مشتری به شما: <b>${newOrder.retailPrice.toLocaleString()}</b> تومان\n` +
                `📉 هزینه عمده کسر شونده از شما: <b>${newOrder.wholesalePrice.toLocaleString()}</b> تومان\n` +
                `💎 <b>سود خالص شما: ${newOrder.profit.toLocaleString()} تومان</b>\n\n` +
                `جهت تایید و صدور آنی کانفیگ برای مشتری، روی دکمه زیر کلیک نمایید:`;

              await masterBot.sendMessage(sellerChatId, notifyMsg, {
                parse_mode: 'HTML',
                reply_markup: {
                  inline_keyboard: [
                    [
                      { text: '✅ تایید و صدور آنی کانفیگ', callback_data: `reseller_approve_${orderId}` },
                      { text: '❌ رد سفارش', callback_data: `reseller_reject_${orderId}` }
                    ]
                  ]
                }
              });
            }
          } catch (notifErr) {
            console.warn('[Reseller Bot Notify Seller Error]', notifErr);
          }
        }
        return;
      }
      } catch (msgErr: any) {
        console.error(`[ResellerBot @${sellerChatId} Message Handler Error]:`, msgErr?.message || msgErr);
      }
    });

    // Handle Callback Queries (inline button clicks)
    bot.on('callback_query', async (query) => {
      try {
      if (!query.message || !query.data) return;
      const buyerChatId = query.message.chat.id;
      const data = query.data;
      const sessionKey = getSessionKey(buyerChatId);

      const seller = db.getUser(sellerChatId);
      if (!seller || !seller.sellerBot) return;
      const botCfg = seller.sellerBot;
      const targetAdminChatId = botCfg.adminChatId ? Number(botCfg.adminChatId) : sellerChatId;
      const isFromAdmin = (buyerChatId === targetAdminChatId || buyerChatId === sellerChatId || Number(query.from.id) === targetAdminChatId || Number(query.from.id) === sellerChatId);

      if (data.startsWith('child_approve_')) {
        if (!isFromAdmin) {
          await bot.answerCallbackQuery(query.id, { text: '⛔ شما دسترسی مدیریت این ربات را ندارید.' });
          return;
        }
        const orderId = data.replace('child_approve_', '');
        await bot.answerCallbackQuery(query.id, { text: 'در حال ساخت کانفیگ و تحویل به مشتری...' });
        const fulfillRes = await this.fulfillResellerOrder(sellerChatId, orderId);
        if (fulfillRes.success) {
          await bot.sendMessage(
            buyerChatId,
            `✅ <b>سفارش ${orderId} با موفقیت تایید شد!</b>\n\nکانفیگ، لینک سابسکریپشن و QR Code بلافاصله در همین ربات برای مشتری ارسال گردید. 🎉`,
            { parse_mode: 'HTML' }
          );
        } else {
          await bot.sendMessage(
            buyerChatId,
            `⚠️ <b>خطا در تایید سفارش:</b> ${fulfillRes.message}`,
            { parse_mode: 'HTML' }
          );
        }
        return;
      }

      if (data.startsWith('child_reject_')) {
        if (!isFromAdmin) {
          await bot.answerCallbackQuery(query.id, { text: '⛔ شما دسترسی مدیریت این ربات را ندارید.' });
          return;
        }
        const orderId = data.replace('child_reject_', '');
        await bot.answerCallbackQuery(query.id, { text: 'سفارش رد شد.' });
        await this.rejectResellerOrder(sellerChatId, orderId, 'فیش واریزی توسط مدیریت فروشگاه تایید نشد.');
        await bot.sendMessage(
          buyerChatId,
          `❌ سفارش ${orderId} رد شد و به مشتری اطلاع‌رسانی گردید.`,
          { parse_mode: 'HTML' }
        );
        return;
      }

      if (data === 'admin_view_pending') {
        if (!isFromAdmin) {
          await bot.answerCallbackQuery(query.id, { text: '⛔ عدم دسترسی.' });
          return;
        }
        const pendings = (botCfg.orders || []).filter(o => o.status === 'pending');
        if (pendings.length === 0) {
          await bot.answerCallbackQuery(query.id, { text: 'هیچ سفارش معلقی وجود ندارد.' });
          return;
        }
        await bot.answerCallbackQuery(query.id);
        for (const p of pendings.slice(0, 5)) {
          const pMsg = `⏳ <b>سفارش معلق:</b>\n` +
            `🆔 شناسه: <code>${p.id}</code>\n` +
            `👤 مشتری: ${p.buyerName} (@${p.buyerUsername || 'بدون آیدی'})\n` +
            `📦 پکیج: <b>${p.productName}</b>\n` +
            `💵 مبلغ: <b>${p.retailPrice.toLocaleString()} تومان</b>\n` +
            `💎 سود شما: <b>${p.profit.toLocaleString()} تومان</b>`;
          const kbd = {
            inline_keyboard: [[
              { text: '✅ تایید و صدور آنی', callback_data: `child_approve_${p.id}` },
              { text: '❌ رد سفارش', callback_data: `child_reject_${p.id}` }
            ]]
          };
          if (p.receiptFileId) {
            await bot.sendPhoto(buyerChatId, p.receiptFileId, { caption: pMsg, parse_mode: 'HTML', reply_markup: kbd }).catch(() => {});
          } else {
            await bot.sendMessage(buyerChatId, pMsg, { parse_mode: 'HTML', reply_markup: kbd }).catch(() => {});
          }
        }
        return;
      }

      if (data === 'admin_refresh_stats') {
        if (!isFromAdmin) {
          await bot.answerCallbackQuery(query.id, { text: '⛔ عدم دسترسی.' });
          return;
        }
        await bot.answerCallbackQuery(query.id, { text: 'آمار به‌روزرسانی شد.' });
        const pendingOrders = (botCfg.orders || []).filter(o => o.status === 'pending');
        const adminMsg = `👑 <b>پنل مدیریت ربات اختصاصی (${botCfg.botName || 'فروشگاه'})</b>\n\n` +
          `👤 <b>مدیر ربات:</b> <code>${buyerChatId}</code>\n` +
          `👥 <b>کل خریداران:</b> <b>${(botCfg.buyers || []).length} نفر</b>\n` +
          `📦 <b>کل سفارشات:</b> <b>${(botCfg.orders || []).length} سفارش</b>\n` +
          `⏳ <b>سفارشات معلق فیش:</b> <b>${pendingOrders.length} مورد</b>\n` +
          `💵 <b>فروش ناخالص:</b> <b>${(botCfg.totalRevenueToman || 0).toLocaleString()} تومان</b>\n` +
          `💎 <b>سود خالص شما:</b> <b>${(botCfg.totalProfitToman || 0).toLocaleString()} تومان</b>`;
        await bot.sendMessage(buyerChatId, adminMsg, { parse_mode: 'HTML' });
        return;
      }

      if (data === 'back_main') {
        this.userSessionStates.delete(sessionKey);
        await bot.deleteMessage(buyerChatId, query.message.message_id).catch(() => {});
        await bot.sendMessage(
          buyerChatId,
          `به منوی اصلی ${botCfg.botName || ''} بازگشتید. لطفاً گزینه مورد نظر را انتخاب نمایید:`,
          { reply_markup: getMainKeyboard(seller, isFromAdmin) }
        );
        return;
      }

      if (data.startsWith('buy_prod_')) {
        const prodId = data.replace('buy_prod_', '');
        const state = db.getState();
        const product = (state.products || []).find(p => p.id === prodId);
        if (!product) {
          await bot.answerCallbackQuery(query.id, { text: 'محصول یافت نشد.' });
          return;
        }

        const wholesalePrice = Math.max(0, Math.round(product.price * (1 - getSellerDiscountForProduct(seller, product) / 100)));
        const retailPrice = botCfg.customRetailPrices?.[product.id] !== undefined
          ? botCfg.customRetailPrices[product.id]
          : (seller.customDisplayPrices?.[product.id] !== undefined ? seller.customDisplayPrices[product.id] : product.price);

        this.userSessionStates.set(sessionKey, {
          action: 'awaiting_receipt',
          data: {
            type: 'product',
            productId: product.id,
            productName: product.name,
            volumeGb: product.volumeGb,
            durationDays: product.durationDays,
            retailPrice,
            wholesalePrice
          }
        });

        const cardNum = botCfg.cardNumber || (seller as any).cardNumber || state.cardNumber || '۶۰۳۷۹۹۷۹۱۲۳۴۵۶۷۸';
        const cardHolder = botCfg.cardHolder || (seller as any).cardHolder || state.cardHolder || 'مدیر فروشگاه';

        const paymentMsg = `💳 <b>فاکتور خرید ${product.name}:</b>\n\n` +
          `📊 حجم: <b>${product.volumeGb} گیگابایت</b>\n` +
          `⏳ مدت اعتبار: <b>${product.durationDays || 'نامحدود'} روز</b>\n` +
          `💰 مبلغ قابل پرداخت: <b>${retailPrice.toLocaleString()} تومان</b>\n\n` +
          `🏦 <b>شماره کارت جهت واریز:</b>\n` +
          `<code>${cardNum}</code>\n` +
          `به نام: <b>${cardHolder}</b>\n\n` +
          `📸 لطفاً پس از واریز مبلغ، <b>عکس رسید تراکنش</b> را همینجا در ربات ارسال فرمایید تا کانفیگ شما بلافاصله صادر شود.`;

        await bot.answerCallbackQuery(query.id);
        await bot.sendMessage(buyerChatId, paymentMsg, {
          parse_mode: 'HTML',
          reply_markup: {
            keyboard: [[{ text: 'بازگشت به منوی اصلی' }]],
            resize_keyboard: true
          }
        });
      }
      } catch (cbErr: any) {
        console.error(`[ResellerBot @${sellerChatId} Callback Handler Error]:`, cbErr?.message || cbErr);
      }
    });
  }

  /**
   * Fulfill and deliver a pending order in a reseller bot
   */
  public async fulfillResellerOrder(sellerChatId: number, orderId: string): Promise<{ success: boolean; message: string; subUrl?: string }> {
    const seller = db.getUser(sellerChatId);
    if (!seller || !seller.sellerBot) {
      return { success: false, message: 'همکار یا ربات یافت نشد.' };
    }

    const order = (seller.sellerBot.orders || []).find(o => o.id === orderId);
    if (!order) {
      return { success: false, message: 'سفارش یافت نشد.' };
    }

    if (order.status === 'approved' && order.deliveredSubUrl) {
      return { success: true, message: 'این سفارش قبلاً تحویل داده شده است.', subUrl: order.deliveredSubUrl };
    }

    const record = this.activeBots.get(sellerChatId);
    const childBot = record?.bot;

    try {
      let purchase: any;
      const cleanCustomName = `${order.buyerUsername || 'client'}_${order.buyerChatId.toString().slice(-4)}`;

      if (order.type === 'custom_volume' && order.volumeGb) {
        purchase = await executeSellerCustomVolumePurchase({
          sellerChatId,
          volumeGb: order.volumeGb,
          durationDays: order.durationDays || 30,
          customName: cleanCustomName,
          source: 'api'
        });
      } else if (order.productId) {
        purchase = await executeSellerPortalPurchase(
          sellerChatId,
          order.productId,
          cleanCustomName,
          'api'
        );
      } else {
        throw new Error('نوع سفارش نامشخص است.');
      }

      const configLink = purchase.subUrl || purchase.panel4SubUrl || purchase.mroceanSubUrl || purchase.sanaeiSubUrl || purchase.rebeccaSubUrl || '';

      order.status = 'approved';
      order.approvedAt = new Date().toISOString();
      order.deliveredPurchaseId = purchase.id;
      order.deliveredSubUrl = configLink;

      // Update financial stats
      seller.sellerBot.totalRevenueToman = (seller.sellerBot.totalRevenueToman || 0) + (order.retailPrice || 0);
      seller.sellerBot.totalWholesaleCostToman = (seller.sellerBot.totalWholesaleCostToman || 0) + (order.wholesalePrice || 0);
      seller.sellerBot.totalProfitToman = (seller.sellerBot.totalProfitToman || 0) + (order.profit || 0);

      db.saveUser(seller);

      // Send config and QR code to the buyer in the child bot
      const targetBot = childBot || (seller.sellerBot?.botToken ? new TelegramBot(seller.sellerBot.botToken, { polling: false }) : null);
      if (targetBot && configLink) {
        try {
          const qrBuffer = await QRCode.toBuffer(configLink, { width: 400, margin: 2 });
          const buyerDeliveryMsg = `🎉 <b>سرویس اختصاصی شما با موفقیت فعال و صادر شد!</b>\n\n` +
            `📦 سرویس: <b>${order.productName || 'وی‌پی‌ان اختصاصی'}</b>\n` +
            `📊 حجم: <b>${order.volumeGb || purchase.volumeGb} گیگابایت</b>\n` +
            `⏳ اعتبار: <b>${order.durationDays || purchase.durationDays} روز</b>\n\n` +
            `🔗 <b>لینک سابسکریپشن اتصال شما:</b>\n<code>${configLink}</code>\n\n` +
            `⚡ <b>راهنمای اتصال:</b>\n` +
            `۱. لینک فوق را لمس کنید تا کپی شود.\n` +
            `۲. در برنامه (v2rayNG / Mahsa / Streisand / V2Box / Nekobox) دکمه <b>+</b> را زده و <b>Import from Clipboard</b> را انتخاب کنید.\n` +
            `۳. سرورها ظاهر می‌شوند و می‌توانید متصل شوید!`;

          await targetBot.sendPhoto(order.buyerChatId, qrBuffer, {
            caption: buyerDeliveryMsg,
            parse_mode: 'HTML'
          });
        } catch (deliveryErr) {
          console.error('[Reseller Bot Buyer Delivery Error]', deliveryErr);
          await targetBot.sendMessage(order.buyerChatId, `🎉 سرویس شما صادر شد:\n<code>${configLink}</code>`, { parse_mode: 'HTML' }).catch(() => {});
        }
      }

      return {
        success: true,
        message: 'سفارش با موفقیت تایید، کانفیگ روی سرور ساخته و تحویل خریدار شد.',
        subUrl: configLink
      };
    } catch (e: any) {
      console.error('[Fulfill Reseller Order Error]', e);
      return { success: false, message: 'خطا در صدور کانفیگ: ' + (e.message || String(e)) };
    }
  }

  /**
   * Reject a pending order
   */
  public async rejectResellerOrder(sellerChatId: number, orderId: string, reason?: string): Promise<{ success: boolean; message: string }> {
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
          `📦 سرویس: ${order.productName}\n` +
          `دلیل: ${order.rejectReason}\n\n` +
          `لطفاً در صورت بروز اشتباه با پشتیبانی در ارتباط باشید.`,
          { parse_mode: 'HTML' }
        );
      } catch (e) {}
    }

    return { success: true, message: 'سفارش با موفقیت رد شد و به خریدار اطلاع داده شد.' };
  }
}

export const resellerBotManager = new ResellerBotManager();
