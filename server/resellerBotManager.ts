import TelegramBot from 'node-telegram-bot-api';
import { db, User, SellerBotConfig, SellerBotOrder } from './db.js';
import { executeSellerPortalPurchase, executeSellerCustomVolumePurchase, getSellerDiscountForProduct } from './bot.js';
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
        console.error(`[ResellerBotManager] Failed to start bot for seller ${seller.chatId}:`, err.message);
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

    try {
      const bot = new TelegramBot(token, { polling: true });

      // Verify token with Telegram
      const me = await bot.getMe();
      const botUsername = me.username || '';

      user.sellerBot.botUsername = botUsername;
      db.saveUser(user);

      this.activeBots.set(sellerChatId, {
        bot,
        username: botUsername,
        sellerChatId,
        startedAt: Date.now()
      });

      this.attachBotHandlers(bot, sellerChatId);

      console.log(`[ResellerBotManager] Reseller bot @${botUsername} started successfully for seller ${sellerChatId}`);
      return {
        success: true,
        username: botUsername,
        message: `ربات اختصاصی شما (@${botUsername}) با موفقیت روشن شد و آنلاین است.`
      };
    } catch (err: any) {
      console.error(`[ResellerBotManager] Error launching bot for seller ${sellerChatId}:`, err);
      return {
        success: false,
        message: 'خطا در اتصال به تلگرام با توکن ارسالی: ' + (err.message || String(err))
      };
    }
  }

  /**
   * Stop an active reseller bot
   */
  public async stopResellerBot(sellerChatId: number): Promise<boolean> {
    const record = this.activeBots.get(sellerChatId);
    if (record) {
      try {
        await record.bot.stopPolling({ cancel: true });
      } catch (e) {}
      this.activeBots.delete(sellerChatId);
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

    const getMainKeyboard = (seller: User) => {
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

      return {
        keyboard: rows.map(r => r.map(text => ({ text }))),
        resize_keyboard: true
      };
    };

    // Error safety for polling
    bot.on('polling_error', (error: any) => {
      console.warn(`[ResellerBot @${sellerChatId}] Polling warning:`, error.message);
    });

    // Handle incoming messages
    bot.on('message', async (msg) => {
      if (!msg.from || !msg.chat) return;
      const buyerChatId = msg.chat.id;
      const text = (msg.text || '').trim();
      const sessionKey = getSessionKey(buyerChatId);

      const seller = db.getUser(sellerChatId);
      if (!seller || !seller.sellerBot || !seller.sellerBot.enabled) {
        return;
      }
      const botCfg = seller.sellerBot;

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

      // Handle /start or بازگشت به منوی اصلی
      if (text.startsWith('/start') || text === 'بازگشت به منوی اصلی' || text === 'منوی اصلی' || text === '/menu') {
        this.userSessionStates.delete(sessionKey);
        const welcome = botCfg.welcomeMessage ||
          `سلام ${msg.from.first_name || 'کاربر گرامی'} عزیز،\nبه ربات رسمی فروش سرویس‌های پرسرعت و ضد فیلتر <b>${botCfg.botName || 'اختصاصی'}</b> خوش آمدید! 🚀\n\nجهت خرید یا مدیریت سرویس‌های خود از منوی زیر استفاده نمایید:`;

        if (botCfg.logoUrl && /^https?:\/\//i.test(botCfg.logoUrl)) {
          try {
            await bot.sendPhoto(buyerChatId, botCfg.logoUrl, {
              caption: welcome,
              parse_mode: 'HTML',
              reply_markup: getMainKeyboard(seller)
            });
            return;
          } catch (e) {}
        }

        await bot.sendMessage(buyerChatId, welcome, {
          parse_mode: 'HTML',
          reply_markup: getMainKeyboard(seller)
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

        const cardNum = botCfg.cardNumber || seller.cardNumber || state.cardNumber || '۶۰۳۷۹۹۷۹۱۲۳۴۵۶۷۸';
        const cardHolder = botCfg.cardHolder || seller.cardHolder || state.cardHolder || 'مدیر فروشگاه';

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

          // Notify the Reseller in their Master Bot chat!
          try {
            const masterBotToken = db.getState().botToken;
            if (masterBotToken) {
              const masterBot = new TelegramBot(masterBotToken);
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
    });

    // Handle Callback Queries (inline button clicks)
    bot.on('callback_query', async (query) => {
      if (!query.message || !query.data) return;
      const buyerChatId = query.message.chat.id;
      const data = query.data;
      const sessionKey = getSessionKey(buyerChatId);

      const seller = db.getUser(sellerChatId);
      if (!seller || !seller.sellerBot) return;
      const botCfg = seller.sellerBot;

      if (data === 'back_main') {
        this.userSessionStates.delete(sessionKey);
        await bot.deleteMessage(buyerChatId, query.message.message_id).catch(() => {});
        await bot.sendMessage(
          buyerChatId,
          `به منوی اصلی ${botCfg.botName || ''} بازگشتید. لطفاً گزینه مورد نظر را انتخاب نمایید:`,
          { reply_markup: getMainKeyboard(seller) }
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

        const cardNum = botCfg.cardNumber || seller.cardNumber || state.cardNumber || '۶۰۳۷۹۹۷۹۱۲۳۴۵۶۷۸';
        const cardHolder = botCfg.cardHolder || seller.cardHolder || state.cardHolder || 'مدیر فروشگاه';

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
      if (childBot && configLink) {
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

          await childBot.sendPhoto(order.buyerChatId, qrBuffer, {
            caption: buyerDeliveryMsg,
            parse_mode: 'HTML'
          });
        } catch (deliveryErr) {
          console.error('[Reseller Bot Buyer Delivery Error]', deliveryErr);
          await childBot.sendMessage(order.buyerChatId, `🎉 سرویس شما صادر شد:\n<code>${configLink}</code>`, { parse_mode: 'HTML' });
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
