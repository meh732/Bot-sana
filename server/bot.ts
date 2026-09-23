import TelegramBot from 'node-telegram-bot-api';
import { db } from './db.js';
import { xui } from './xui.js';
import { rebecca } from './rebecca.js';
import { encryptData, decryptData } from './crypto.js';
import { restoreAnyBackup } from './backupEngine.js';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import QRCode from 'qrcode';

function escapeHtml(text: string): string {
  return (text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function normalizePersianText(str: string): string {
  if (!str) return '';
  return str.toLowerCase()
    .replace(/ی/g, 'ي')
    .replace(/ک/g, 'ك')
    .replace(/‌/g, ' ') // zero-width non-joiner
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseAmountInput(input: any): number | null {
  if (input === null || input === undefined) return null;
  let str = String(input).trim().toLowerCase();
  if (str === '') return null;
  
  if (['0', 'آزاد', 'نامحدود', 'سقف آزاد', 'unlimited', 'free', '-1', 'ندارد'].includes(str)) {
    return 0;
  }
  
  // Convert Persian & Arabic digits
  str = str.replace(/[۰-۹]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 1728));
  str = str.replace(/[٠-٩]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 1584));
  
  // Check for million / ملیون / میلیون / mil / million / m
  const millionMatch = str.match(/([\d\.]+)\s*(میلیون|ملیون|mil|million|m)/i);
  if (millionMatch) {
    const num = parseFloat(millionMatch[1]);
    if (!isNaN(num)) return Math.round(num * 1000000);
  }
  
  // Check for thousand / هزار / k / thousand / hezar
  const thousandMatch = str.match(/([\d\.]+)\s*(هزار|k|thousand|hezar)/i);
  if (thousandMatch) {
    const num = parseFloat(thousandMatch[1]);
    if (!isNaN(num)) return Math.round(num * 1000);
  }
  
  // Remove non-numeric characters except digits and decimal point
  str = str.replace(/[^\d\.]/g, '');
  const num = parseFloat(str);
  return isNaN(num) ? null : Math.round(num);
}

export function isSellerUnlimitedLimit(user?: { isSeller?: boolean; debtLimit?: number | null; isUnlimitedLimit?: boolean }): boolean {
  if (!user || !user.isSeller) return false;
  if (user.isUnlimitedLimit === true) return true;
  if (user.debtLimit !== undefined && user.debtLimit !== null) {
    const lim = Number(user.debtLimit);
    if (!isNaN(lim) && lim <= 0) return true;
  }
  return false;
}

export function getSellerDiscountForProduct(user: any, product?: any): number {
  if (!user || !user.isSeller) return 0;
  let sellerDiscount = 0;
  if (user.sellerDiscounts && user.sellerDiscounts.length > 0) {
    const bestSpecific = user.sellerDiscounts
      .filter((d: any) => 
        (product && d.type === 'product' && d.targetId === product.id) ||
        (product && d.type === 'category' && d.targetId === product.categoryId) ||
        (d.type === 'global')
      )
      .sort((a: any, b: any) => b.percent - a.percent)[0];
      
    if (bestSpecific) {
      sellerDiscount = bestSpecific.percent;
    }
  } else if (user.sellerDiscount) {
    sellerDiscount = user.sellerDiscount; // legacy global
  }
  return sellerDiscount;
}

export function applyPaygSettlementToUser(user: any, amount?: number, isFullSettlement: boolean = false) {
  if (!user || !user.purchases || user.purchases.length === 0) return;
  const paygPurchases = user.purchases.filter((p: any) => p.isPayAsYouGo && !p.isDeleted);
  if (paygPurchases.length === 0) return;

  if (isFullSettlement || (user.debt !== undefined && user.debt <= 0)) {
    for (const p of paygPurchases) {
      const currentBytes = p.lastUsedBytes || 0;
      p.baseSettledBytes = currentBytes;
      p.paygDisabled = false;
      p.warnedPayg = false;
    }
    return;
  }

  if (amount && amount > 0) {
    let remaining = amount;
    for (const p of paygPurchases) {
      if (remaining <= 0) break;
      const lastUsed = p.lastUsedBytes || 0;
      const baseSettled = p.baseSettledBytes || 0;
      if (lastUsed > baseSettled) {
        const unsettledBytes = lastUsed - baseSettled;
        const rawPricePerGb = p.originalPricePerGb || p.pricePerGb || 1000;
        const discountPct = p.discountPercent !== undefined ? p.discountPercent : getSellerDiscountForProduct(user, p);
        const discountedPricePerGb = Math.max(1, Math.round(rawPricePerGb * (1 - discountPct / 100)));
        const unsettledCost = Math.ceil((unsettledBytes / (1024 * 1024 * 1024)) * discountedPricePerGb);

        if (remaining >= unsettledCost) {
          p.baseSettledBytes = lastUsed;
          p.paygDisabled = false;
          p.warnedPayg = false;
          remaining -= unsettledCost;
        } else {
          const settledBytes = Math.round((remaining / discountedPricePerGb) * (1024 * 1024 * 1024));
          p.baseSettledBytes = Math.min(lastUsed, baseSettled + settledBytes);
          remaining = 0;
        }
      }
    }
  }
}

export function settleSinglePaygPurchase(user: any, purchaseId: string, customBaseBytes?: number): { success: boolean; settledGb: number; message: string } {
  if (!user || !user.purchases) return { success: false, settledGb: 0, message: 'کاربر یا خریدی یافت نشد' };
  const p = user.purchases.find((item: any) => item.id === purchaseId && item.isPayAsYouGo);
  if (!p) return { success: false, settledGb: 0, message: 'کانفیگ مصرف آزاد یافت نشد' };

  const targetBytes = customBaseBytes !== undefined ? Math.max(0, customBaseBytes) : (p.lastUsedBytes || 0);
  const oldBase = p.baseSettledBytes || 0;

  if (targetBytes > oldBase) {
    const newlySettledBytes = targetBytes - oldBase;
    const rawPricePerGb = p.originalPricePerGb || p.pricePerGb || 1000;
    const discountPct = p.discountPercent !== undefined ? p.discountPercent : getSellerDiscountForProduct(user, p);
    const discountedPricePerGb = Math.max(1, Math.round(rawPricePerGb * (1 - discountPct / 100)));
    const newlySettledCost = Math.ceil((newlySettledBytes / (1024 * 1024 * 1024)) * discountedPricePerGb);

    user.debt = Math.max(0, (user.debt || 0) - newlySettledCost);
    user.totalPayments = (user.totalPayments || 0) + newlySettledCost;
  }

  p.baseSettledBytes = targetBytes;
  if ((p.lastUsedBytes || 0) < targetBytes) {
    p.lastUsedBytes = targetBytes;
  }
  p.paygDisabled = false;
  p.warnedPayg = false;

  const settledGb = Number((targetBytes / (1024 * 1024 * 1024)).toFixed(2));
  db.saveUser(user);
  checkPaygReactivation(user).catch(console.error);
  return { success: true, settledGb, message: `مصرف تا حجم ${settledGb} گیگابایت تسویه شد و از این حجم به بعد محاسبه خواهد شد.` };
}

export function isUncategorizedProduct(product: any, activeCategories: any[] = []): boolean {
  if (!product) return false;
  const cat = (product.categoryId || '').toString().trim();
  if (!cat || cat === 'uncategorized' || cat === 'none' || cat === 'null' || cat === 'undefined') {
    return true;
  }
  const catExists = (activeCategories || []).some(c => String(c.id) === cat && !c.disabled);
  return !catExists;
}

function getProductButtonText(user: any, p: any): string {
  if (!p) return 'سرویس نامشخص';
  const name = p.name || 'سرویس اشتراکی';
  const price = Number(p.price || 0);
  const isPayG = !!p.isPayAsYouGo;
  const unit = isPayG ? 'تومان/گیگ' : 'تومان';
  
  if (user && user.isSeller) {
    const sellerDiscount = getSellerDiscountForProduct(user, p);
    if (sellerDiscount > 0) {
      const finalPrice = Math.max(0, Math.round(price * (1 - sellerDiscount / 100)));
      return `🎁 ${name} - ${finalPrice.toLocaleString()} (با %${sellerDiscount} تخفیف همکار) ${unit}`;
    }
  }

  return `${name} - ${price.toLocaleString()} ${unit}`;
}

let bot: TelegramBot | null = null;
let isPolling = false;
const adminSession = new Map<number, string>();
const giftCodeDrafts = new Map<number, {
  code?: string;
  giftAmount?: number;
  maxUsage?: number;
  maxUsagePerUser?: number;
  expirationDays?: number;
}>();
const userSession = new Map<number, { 
  action: string; 
  amount?: number; 
  productId?: string; 
  couponCode?: string;
  pendingPurchase?: {
    productId: string;
    couponCode?: string;
    customName?: string;
  };
}>();
const purchaseLocks = new Set<number>();
// pendingPayments moved to db.getState().pendingPayments

async function sendServiceInfo(chatId: number, purchase: any) {
  if (!bot) return;
  bot.sendMessage(chatId, '⏳ در حال دریافت اطلاعات دقیق، حجم، زمان و لینک ساب از سرور...').catch(() => {});
  try {
    const cleanPId = purchase.id ? String(purchase.id).trim() : '';
    const cleanPSubId = purchase.subId ? String(purchase.subId).trim() : '';
    const pPanel = purchase.panelType;

    let clientObj: any = null;

    // 1. Try Rebecca directly if panelType is rebecca or starts with reb_
    if (pPanel === 'rebecca' || (!pPanel && cleanPId.startsWith('reb_'))) {
      try {
        if (cleanPId) clientObj = await rebecca.getClient(cleanPId);
        if (!clientObj && cleanPSubId) clientObj = await rebecca.getClient(cleanPSubId);
      } catch {}
    }

    // 2. Fetch from unified clients list (both panels queried with forceBoth = true)
    if (!clientObj) {
      try {
        const allClients = await xui.getAllClientsWithTraffic(true);
        const pIdLower = cleanPId.toLowerCase();
        const pSubLower = cleanPSubId.toLowerCase();
        const pNameLower = (purchase.name || '').trim().toLowerCase();
        const urlSubId = purchase.subUrl ? purchase.subUrl.split('/sub/')[1]?.split('?')[0]?.split('/')[0]?.toLowerCase() : null;

        clientObj = allClients.find((cl: any) => {
          const clEmail = (cl.email || '').trim().toLowerCase();
          const clId = (cl.id || '').trim().toLowerCase();
          const clSubId = (cl.subId || '').trim().toLowerCase();

          if (pIdLower && (clEmail === pIdLower || clId === pIdLower)) return true;
          if (pSubLower && (clSubId === pSubLower || clEmail === pSubLower || clId === pSubLower)) return true;
          if (pNameLower && (clEmail === pNameLower || clId === pNameLower)) return true;
          if (urlSubId && (clSubId === urlSubId || clId === urlSubId || clEmail === urlSubId)) return true;
          if (clSubId && purchase.subUrl && purchase.subUrl.toLowerCase().includes(clSubId)) return true;
          if (clEmail && purchase.subUrl && purchase.subUrl.toLowerCase().includes(clEmail)) return true;
          return false;
        });
      } catch (e: any) {
        console.error('[Bot] sendServiceInfo error fetching clients:', e.message);
      }
    }

    // 3. Fallback: try Rebecca directly if still not found and wasn't tried
    if (!clientObj && pPanel !== 'rebecca') {
      try {
        if (cleanPId) clientObj = await rebecca.getClient(cleanPId);
        if (!clientObj && cleanPSubId) clientObj = await rebecca.getClient(cleanPSubId);
      } catch {}
    }

    // Determine effective panel
    const effectivePanel: 'xui' | 'rebecca' = clientObj?.panelType || purchase.panelType || (cleanPId.startsWith('reb_') ? 'rebecca' : 'xui');

    // Subscription URL healing and construction
    let subUrl = (purchase.subUrl || '').trim();
    const effectiveSubId = clientObj?.subId || purchase.subId || purchase.id;

    if (!subUrl || !subUrl.startsWith('http')) {
      if (effectivePanel === 'rebecca') {
        subUrl = rebecca.buildFullSubUrl(effectiveSubId ? `/sub/${effectiveSubId}` : '');
      } else {
        subUrl = xui.buildXuiSubUrl(effectiveSubId);
      }
    } else {
      if (effectivePanel === 'rebecca') {
        subUrl = rebecca.buildFullSubUrl(subUrl);
      } else {
        const subIdMatch = subUrl.match(/\/sub\/([^/?#]+)/);
        if (subIdMatch && subIdMatch[1]) {
          subUrl = xui.buildXuiSubUrl(subIdMatch[1]);
        }
      }
    }

    // Persist updated subUrl and panelType if changed
    if (subUrl && (subUrl !== purchase.subUrl || purchase.panelType !== effectivePanel)) {
      purchase.subUrl = subUrl;
      purchase.panelType = effectivePanel;
      const currentUser = db.getUser(chatId);
      if (currentUser && currentUser.purchases) {
        const pItem = currentUser.purchases.find((p: any) => p.id === purchase.id);
        if (pItem) {
          pItem.subUrl = subUrl;
          pItem.panelType = effectivePanel;
          db.saveUser(currentUser);
        }
      }
    }

    // Save latest used bytes if available
    if (clientObj) {
      const currentUsed = clientObj.totalUsed || ((clientObj.up || 0) + (clientObj.down || 0));
      if (currentUsed > (purchase.lastUsedBytes || 0)) {
        purchase.lastUsedBytes = currentUsed;
        const currentUser = db.getUser(chatId);
        if (currentUser && currentUser.purchases) {
          const pItem = currentUser.purchases.find((p: any) => p.id === purchase.id);
          if (pItem) {
            pItem.lastUsedBytes = currentUsed;
            db.saveUser(currentUser);
          }
        }
      }
    }

    // 1. VOLUME CALCULATION
    let totalVolStr = '';
    let usedVolStr = '';
    let remainingVolStr = '';
    let progressBar = '';
    let isExpired = false;

    if (purchase.isPayAsYouGo) {
      totalVolStr = 'نامحدود (سرویس مصرف آزاد - PAYG)';
      const usedBytes = clientObj ? (clientObj.totalUsed || ((clientObj.up || 0) + (clientObj.down || 0))) : (purchase.lastUsedBytes || 0);
      const usedGb = (usedBytes / (1024 * 1024 * 1024)).toFixed(2);
      usedVolStr = `${usedGb} گیگابایت`;
      remainingVolStr = 'نامحدود (محاسبه بر اساس مصرف)';
    } else {
      let totalBytes = 0;
      if (clientObj && clientObj.total > 0) {
        totalBytes = clientObj.total;
      } else if (purchase.volumeGb > 0) {
        totalBytes = purchase.volumeGb * 1024 * 1024 * 1024;
      }

      if (totalBytes > 0) {
        const totalGb = (totalBytes / (1024 * 1024 * 1024)).toFixed(2);
        totalVolStr = `${totalGb} گیگابایت`;

        const usedBytes = clientObj ? (clientObj.totalUsed || ((clientObj.up || 0) + (clientObj.down || 0))) : (purchase.lastUsedBytes || 0);
        let usedDisplay = '';
        if (usedBytes >= 1024 * 1024 * 1024) {
          usedDisplay = `${(usedBytes / (1024 * 1024 * 1024)).toFixed(2)} گیگابایت`;
        } else {
          usedDisplay = `${(usedBytes / (1024 * 1024)).toFixed(1)} مگابایت`;
        }

        let upDownStr = '';
        if (clientObj && (clientObj.up > 0 || clientObj.down > 0)) {
          const upMb = (clientObj.up / (1024 * 1024)).toFixed(1);
          const downMb = (clientObj.down / (1024 * 1024)).toFixed(1);
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
        totalVolStr = purchase.volumeGb ? `${purchase.volumeGb} گیگابایت` : 'نامحدود';
        usedVolStr = purchase.lastUsedBytes ? `${(purchase.lastUsedBytes / (1024 * 1024)).toFixed(1)} مگابایت` : '۰ مگابایت';
        remainingVolStr = purchase.volumeGb ? `${purchase.volumeGb} گیگابایت` : 'نامحدود';
      }
    }

    // 2. TIME / EXPIRY CALCULATION
    let remainingTimeStr = '';
    let expiryDateStr = '';

    const expTime = clientObj && clientObj.expiryTime !== undefined ? clientObj.expiryTime : 0;
    if (expTime > 0) {
      const remainingMs = expTime - Date.now();
      if (remainingMs <= 0) {
        remainingTimeStr = '❌ منقضی شده';
        isExpired = true;
      } else {
        const days = Math.floor(remainingMs / 86400000);
        const hours = Math.floor((remainingMs % 86400000) / 3600000);
        const mins = Math.floor((remainingMs % 3600000) / 60000);
        if (days > 0) {
          remainingTimeStr = `${days} روز و ${hours} ساعت باقیمانده`;
        } else if (hours > 0) {
          remainingTimeStr = `${hours} ساعت و ${mins} دقیقه باقیمانده`;
        } else {
          remainingTimeStr = `${mins} دقیقه باقیمانده (در حال اتمام)`;
        }
      }
      const expDate = new Date(expTime);
      expiryDateStr = `${expDate.toLocaleDateString('fa-IR')} (ساعت ${expDate.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })})`;
    } else if (expTime < 0) {
      const days = Math.round(Math.abs(expTime) / 86400000);
      remainingTimeStr = `${days} روز (شروع شمارش پس از اولین اتصال)`;
      expiryDateStr = 'پس از اولین اتصال فعال می‌شود';
    } else {
      if (purchase.durationDays && purchase.durationDays > 0) {
        if (purchase.createdAt) {
          const calcExp = new Date(purchase.createdAt).getTime() + (purchase.durationDays * 86400000);
          const remMs = calcExp - Date.now();
          if (remMs > 0) {
            const days = Math.floor(remMs / 86400000);
            const hours = Math.floor((remMs % 86400000) / 3600000);
            remainingTimeStr = `${days} روز و ${hours} ساعت باقیمانده`;
            const expDate = new Date(calcExp);
            expiryDateStr = `${expDate.toLocaleDateString('fa-IR')}`;
          } else {
            remainingTimeStr = `${purchase.durationDays} روز (شروع از زمان فعال‌سازی)`;
            expiryDateStr = 'محاسبه از اولین اتصال';
          }
        } else {
          remainingTimeStr = `${purchase.durationDays} روز`;
          expiryDateStr = 'شروع از اولین اتصال';
        }
      } else {
        remainingTimeStr = 'نامحدود (بدون انقضا)';
        expiryDateStr = 'همیشگی';
      }
    }

    // 3. CONNECTION & STATUS
    let statusText = '🟢 فعال و متصل';
    if (clientObj && clientObj.enable === false) {
      statusText = '🔴 غیرفعال (مسدود شده در سرور)';
    } else if (isExpired) {
      statusText = '⚠️ نیاز به تمدید (حجم پایان یافته یا منقضی)';
    }

    const panelNameBadge = effectivePanel === 'rebecca' ? '⚡ ربکا (Rebecca)' : '🌐 سنایی (3X-UI)';

    const caption = `🔑 <b>اطلاعات کامل سرویس (${escapeHtml(purchase.name || 'سرویس اشتراکی')})</b>\n\n` +
      `📋 <b>شناسه سفارش:</b> <code>${escapeHtml(String(purchase.id || ''))}</code>\n` +
      `🖥 <b>پنل میزبان:</b> <b>${panelNameBadge}</b>\n` +
      `🔰 <b>وضعیت اکانت:</b> ${statusText}\n\n` +
      `📊 <b>اطلاعات حجم سرویس:</b>\n` +
      `▫️ <b>کل حجم:</b> ${totalVolStr}\n` +
      `▫️ <b>حجم مصرف شده:</b> ${usedVolStr}\n` +
      `▫️ <b>حجم باقیمانده:</b> <b>${remainingVolStr}</b>\n` +
      (progressBar ? `${progressBar}\n\n` : '\n') +
      `⏳ <b>اطلاعات زمان و انقضا:</b>\n` +
      `▫️ <b>زمان باقیمانده:</b> <b>${remainingTimeStr}</b>\n` +
      `▫️ <b>تاریخ انقضا:</b> ${expiryDateStr}\n\n` +
      (purchase.isPayAsYouGo ? (
        `💸 <b>هزینه هر گیگ:</b> ${purchase.pricePerGb?.toLocaleString()} تومان\n` +
        `📈 <b>مصرف دوره جاری:</b> ${(Math.max(0, (purchase.lastUsedBytes || 0) - (purchase.baseSettledBytes || 0)) / (1024*1024*1024)).toFixed(2)} گیگابایت\n\n`
      ) : '') +
      (subUrl ? (
        `🔗 <b>لینک اختصاصی سابسکریپشن:</b>\n` +
        `<code>${escapeHtml(subUrl)}</code>\n\n` +
        `💡 <i>با لمس لینک بالا، به صورت خودکار در حافظه کپی می‌شود.</i>\n\n`
      ) : '⚠️ <i>لینک سابسکریپشن در حال حاضر در دسترس نیست.</i>\n\n') +
      `📱 <b>راهنمای اتصال:</b>\n` +
      `۱. بارکد QR بالا را اسکن کرده یا لینک سابسکریپشن را کپی و اضافه نمایید.\n` +
      `۲. در نرم‌افزار گزینه <b>Update Subscription</b> را بزنید.`;

    const inlineButtons: any[] = [
      [
        { text: '🔄 بروزرسانی وضعیت لحظه‌ای', callback_data: `refresh_service_${purchase.id}` },
        { text: '⚙️ دریافت کانفیگ مستقیم', callback_data: `direct_configs_${purchase.id}` }
      ]
    ];

    if (purchase.price > 0 && purchase.volumeGb > 0 && purchase.durationDays > 0) {
      inlineButtons.push([
        { text: '♻️ تمدید سرویس', callback_data: `renew_service_${purchase.id}` }
      ]);
    }

    inlineButtons.push([
      { text: '📋 بازگشت به لیست خریدها', callback_data: 'user_purchases_list' }
    ]);

    let photoSent = false;
    if (subUrl) {
      try {
        const buffer = await QRCode.toBuffer(subUrl, { width: 450, margin: 2 });
        if (caption.length <= 1024) {
          await bot.sendPhoto(chatId, buffer, {
            caption,
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: inlineButtons }
          });
          photoSent = true;
        } else {
          const shortCaption = `📱 <b>بارکد اختصاصی اتصال (QR Code)</b>\n` +
            `🔹 <b>سرویس:</b> ${escapeHtml(purchase.name || 'سرویس اشتراکی')}\n` +
            `🔰 <b>وضعیت:</b> ${statusText}\n` +
            `📊 <b>باقیمانده:</b> ${remainingVolStr} | ⏳ <b>زمان:</b> ${remainingTimeStr}`;
          await bot.sendPhoto(chatId, buffer, {
            caption: shortCaption,
            parse_mode: 'HTML'
          });
          await bot.sendMessage(chatId, caption, {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: inlineButtons }
          });
          photoSent = true;
        }
      } catch (err: any) {
        console.error('[Bot] sendPhoto failed:', err.message);
      }
    }

    if (!photoSent) {
      await bot.sendMessage(chatId, caption, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: inlineButtons }
      });
    }

  } catch (err: any) {
    console.error('[Bot] sendServiceInfo error:', err);
    bot.sendMessage(chatId, `❌ خطا در استعلام سرویس: ${err.message}\n\n` + (purchase.subUrl ? `🔗 لینک ساب:\n<code>${escapeHtml(purchase.subUrl)}</code>` : ''), { parse_mode: 'HTML' });
  }
}

function getUserReplyKeyboard(user: any, state: any, isAdmin = false) {
  const keyboard = [];
  const firstRow = [];
  if (state.freeTestEnabled !== false) {
    firstRow.push({ text: '🎁 تست رایگان', style: 'primary' });
  }
  firstRow.push({ text: '🛒 خرید سرویس', style: 'success' });
  keyboard.push(firstRow);

  keyboard.push([{ text: '👤 پروفایل و موجودی', style: 'primary' }, { text: '📋 لیست خریدهای من', style: 'primary' }]);
  keyboard.push([{ text: '🔗 زیرمجموعه‌گیری', style: 'success' }, { text: '📞 پشتیبانی', style: 'success' }]);
  if (user && user.isSeller) {
    keyboard.push([{ text: '📊 پنل همکار (فروشنده)', style: 'danger' }]);
  }
  if (isAdmin) {
    keyboard.push([{ text: '🎛 پنل مدیریت', style: 'danger' }]);
  }
  return {
    keyboard,
    resize_keyboard: true
  };
}

function getSellerReplyKeyboard(): any {
  return {
    keyboard: [
      [{ text: '🛒 خرید سرویس همکار', style: 'success' }, { text: '📉 وضعیت بدهی و اعتبار همکار', style: 'primary' }],
      [{ text: '📋 لیست فروش‌های من', style: 'primary' }, { text: '📊 گزارش دقیق فروش و مصرف', style: 'primary' }],
      [{ text: '🔙 بازگشت به منوی اصلی', style: 'danger' }]
    ],
    resize_keyboard: true
  };
}

export async function initBot() {
  const state = db.getState();
  const token = (state.botToken || '').trim();
  if (!token || token === 'BOM_TEST_TOKEN' || !token.includes(':') || token.length < 20) {
    console.log('[Bot] No valid Bot Token configured. Bot is waiting for configuration.');
    if (bot) {
      try {
        const activeBot = bot;
        bot = null;
        if (typeof activeBot.stopPolling === 'function') {
          await activeBot.stopPolling();
        }
        activeBot.removeAllListeners();
      } catch {}
      isPolling = false;
    }
    return;
  }

  if (bot) {
    console.log('[Bot] Actively stopping current bot polling and cleaning up resources...');
    try {
      const activeBot = bot;
      bot = null; // Unlink reference immediately to prevent race conditions
      if (typeof activeBot.stopPolling === 'function') {
        await activeBot.stopPolling();
      }
      activeBot.removeAllListeners();
    } catch (e: any) {
      console.error('[Bot Error] Error stopping polling of previous bot:', e.message);
    }
    isPolling = false;
  }

  // Grace delay to let Telegram servers process the connection teardown
  await new Promise(resolve => setTimeout(resolve, 1500));

  try {
    console.log(`[Bot] Initializing Telegram Bot with token ending in ...${token.substring(token.length - 8 || 0)}`);
    bot = new TelegramBot(token, { polling: true });
    isPolling = true;

    // Attach crucial error listeners to avoid crashing or unhandled rejections
    bot.on('polling_error', async (error: any) => {
      const errMsg = error?.message || String(error);
      if (errMsg.includes('404') || errMsg.includes('401') || errMsg.includes('ETELEGRAM: 404') || errMsg.includes('ETELEGRAM: 401')) {
        console.warn(`[Bot Warning] Telegram Bot Token is invalid (${errMsg}). Polling halted.`);
        if (bot && typeof bot.stopPolling === 'function') {
          try {
            await bot.stopPolling();
          } catch {}
          isPolling = false;
        }
        return;
      }
      console.error('[Bot Error] Polling error:', errMsg);
    });

    bot.on('error', (error: any) => {
      console.error('[Bot Error] General error:', error?.message || error);
    });

    bot.setMyCommands([
      { command: '/start', description: 'منوی اصلی' },
      { command: '/admin', description: 'مدیریت پنل' }
    ]).then(() => {
      console.log('[Bot] Commands menu registered successfully on Telegram.');
    }).catch(err => {
      console.error("[Bot Error] Failed to set Bot commands menu (Check token):", err.message || err);
    });
  } catch (err: any) {
    console.error('[Bot Error] Exception thrown during Bot creation:', err.message || err);
  }

  async function executePurchase(chatId: number, product: any, couponCode?: string, customName?: string) {
    if (purchaseLocks.has(chatId)) {
      bot!.sendMessage(chatId, '⏳ در حال پردازش درخواست خرید قبلی شما، لطفا صبر کنید...');
      return;
    }
    purchaseLocks.add(chatId);
    try {
      await _executePurchaseInternal(chatId, product, couponCode, customName);
    } finally {
      purchaseLocks.delete(chatId);
    }
  }

  async function _executePurchaseInternal(chatId: number, product: any, couponCode?: string, customName?: string) {
    const user = db.getUser(chatId);
    if (!user) return;
    const state = db.getState();

    let finalPrice = product.price;
    let baseDiscount = 0;
    
    // Process Coupon if provided
    let appliedCoupon: any = null;
    if (couponCode) {
      const couponsList = state.coupons || [];
      const matchCoupon = couponsList.find((c: any) => c.code === couponCode && !c.giftAmount);
      if (matchCoupon) {
        // Validate coupon again
        let isValid = true;
        if (matchCoupon.expirationDate && new Date(matchCoupon.expirationDate) < new Date()) {
          isValid = false; // Expired
        }
        if (matchCoupon.maxUsage && matchCoupon.usedCount !== undefined && matchCoupon.usedCount >= matchCoupon.maxUsage) {
          isValid = false; // Max total usage reached
        }
        if (matchCoupon.maxUsagePerUser && matchCoupon.usedBy) {
          const userUsage = matchCoupon.usedBy[String(chatId)] || 0;
          if (userUsage >= matchCoupon.maxUsagePerUser) {
            isValid = false; // Max per-user usage reached
          }
        }
        if (isValid) {
          baseDiscount = matchCoupon.discountPercent;
          appliedCoupon = matchCoupon;
        } else {
          bot!.sendMessage(chatId, `❌ متاسفانه کد تخفیف *${couponCode}* منقضی شده یا ظرفیت آن تکمیل شده است و در این خرید اعمال نشد.`, { parse_mode: 'Markdown' });
        }
      }
    }
    
    let sellerDiscount = 0;
    if (user.isSeller) {
      if (user.sellerDiscounts && user.sellerDiscounts.length > 0) {
        // Find best specific discount
        const bestSpecific = user.sellerDiscounts
          .filter(d => 
            (d.type === 'product' && d.targetId === product.id) ||
            (d.type === 'category' && d.targetId === product.categoryId) ||
            (d.type === 'global')
          )
          .sort((a, b) => b.percent - a.percent)[0];
          
        if (bestSpecific) {
          sellerDiscount = bestSpecific.percent;
        }
      } else if (user.sellerDiscount) {
        sellerDiscount = user.sellerDiscount; // legacy global
      }
    }
    
    // Choose the maximum between coupon discount and seller discount
    const effectiveDiscount = Math.max(baseDiscount, sellerDiscount);

    if (effectiveDiscount > 0) {
      finalPrice = Math.max(0, Math.round(product.price * (1 - effectiveDiscount / 100)));
    }

    if (user.isSeller) {
      if (!isSellerUnlimitedLimit(user)) {
        const currentDebt = user.debt || 0;
        const limit = user.debtLimit !== undefined && user.debtLimit > 0 ? user.debtLimit : 1000000;
        if (currentDebt + finalPrice > limit) {
          bot!.sendMessage(chatId, `❌ خطا در خرید: سقف اعتبار شما کافی نیست!\n\nبدهی فعلی شما: ${currentDebt.toLocaleString()} تومان\nهزینه این خرید: ${finalPrice.toLocaleString()} تومان\nسقف اعتبار مجاز: ${limit.toLocaleString()} تومان\n\nجهت آزاد کردن سقف خرید لطفا با ادمین تسویه کنید.`);
          return;
        }
      }
    } else {
      if (user.balance < finalPrice) {
        const diff = finalPrice - user.balance;
        userSession.set(chatId, {
          action: 'payment_awaiting_deposit_choice',
          pendingPurchase: {
            productId: product.id,
            couponCode,
            customName
          }
        });
        bot!.sendMessage(chatId, `❌ موجودی کافی نیست!\n\nقیمت سرویس: ${finalPrice.toLocaleString()} تومان\nموجودی شما: ${user.balance.toLocaleString()} تومان\nمبلغ کسری: ${diff.toLocaleString()} تومان\n\nجهت جبران کسری و ادامه خرید می‌توانید از دکمه زیر استفاده کنید:`, {
          reply_markup: {
            inline_keyboard: [
              [{ text: '💳 شارژ سریع مبلغ کسری', callback_data: `deposit_exact_${diff}` }],
              [{ text: '💳 شارژ مبلغ دلخواه (سایر روش‌ها)', callback_data: 'user_deposit_flow' }]
            ]
          }
        });
        return;
      }
    }

    bot!.sendMessage(chatId, `⏳ در حال خرید ${product.name} و ساخت کانفیگ...`);
    
    try {
      const selectedInboundIds = (product.inboundIds && product.inboundIds.length > 0)
        ? product.inboundIds
        : (product.inboundId ? [product.inboundId] : undefined);

      const sellerGroupName = user.isSeller ? (user.nickname ? user.nickname : (user.username ? `${user.username}` : `Seller_${chatId}`)) : undefined;
      
      const isPAYG = !!product.isPayAsYouGo;
      const volGb = isPAYG ? 0 : (product.volumeGb !== undefined ? Number(product.volumeGb) : 0);
      const durDays = isPAYG ? 0 : (product.durationDays !== undefined ? Number(product.durationDays) : 0);

      let clientEmail = '';
      if (customName) {
        clientEmail = customName;
      } else {
        const cleanUsername = user.username ? user.username.trim().replace(/[^a-zA-Z0-9_]/g, '') : '';
        const emailPrefix = cleanUsername || String(chatId);
        const uniqueSuffix = Date.now().toString().slice(-6);
        clientEmail = `${emailPrefix}_${uniqueSuffix}`;
      }

      let effectiveProductPanelType: 'xui' | 'rebecca' | undefined = product.panelType;
      if (!effectiveProductPanelType) {
        const category = (state.categories || []).find((c: any) => String(c.id) === String(product.categoryId));
        if (
          category?.panelType === 'rebecca' ||
          category?.name?.includes('ربکا') ||
          category?.name?.toLowerCase().includes('rebecca') ||
          product.name?.includes('ربکا') ||
          product.name?.toLowerCase().includes('rebecca')
        ) {
          effectiveProductPanelType = 'rebecca';
        } else if (
          category?.panelType === 'xui' ||
          category?.name?.includes('سنایی') ||
          category?.name?.toLowerCase().includes('sanaei') ||
          product.name?.includes('سنایی') ||
          product.name?.toLowerCase().includes('sanaei')
        ) {
          effectiveProductPanelType = 'xui';
        }
      }

      const client = await xui.addClient(clientEmail, volGb, durDays, selectedInboundIds, product.limitIp || 0, String(chatId), sellerGroupName, effectiveProductPanelType);
      
      if (user.isSeller) {
        if (!isPAYG) {
          user.debt = (user.debt || 0) + finalPrice;
          user.debtVolume = (user.debtVolume || 0) + Number(product.volumeGb || 0);
          user.totalSales = (user.totalSales || 0) + finalPrice;
        }
      } else {
        if (!isPAYG) {
          user.balance -= finalPrice;
        }
      }
      
      // Save purchase record
      const newPurchase: any = {
        id: clientEmail, // use the email as id to trace back to xui client accurately
        name: product.name,
        price: isPAYG ? 0 : finalPrice,
        subUrl: client.subUrl,
        volumeGb: volGb,
        durationDays: durDays,
        panelType: client.panelType || effectiveProductPanelType || 'xui',
        createdAt: new Date().toISOString(),
        originalPrice: isPAYG ? 0 : product.price,
        discountPercent: effectiveDiscount,
        discountAmount: isPAYG ? 0 : (product.price - finalPrice)
      };

      if (isPAYG) {
        newPurchase.isPayAsYouGo = true;
        newPurchase.originalPricePerGb = product.price;
        newPurchase.pricePerGb = effectiveDiscount > 0 ? Math.max(0, Math.round(product.price * (1 - effectiveDiscount / 100))) : product.price;
        newPurchase.lastUsedBytes = 0;
        newPurchase.baseSettledBytes = 0;
      }

      user.purchases = user.purchases || [];
      user.purchases.push(newPurchase);

      db.saveUser(user);

      // Increment coupon usages if one was applied
      if (appliedCoupon) {
        appliedCoupon.usedCount = (appliedCoupon.usedCount || 0) + 1;
        appliedCoupon.usedBy = appliedCoupon.usedBy || {};
        appliedCoupon.usedBy[String(chatId)] = (appliedCoupon.usedBy[String(chatId)] || 0) + 1;
        
        // update coupons list
        const couponsList = state.coupons || [];
        const index = couponsList.findIndex((c: any) => c.code === appliedCoupon.code);
        if (index > -1) {
          couponsList[index] = appliedCoupon;
          db.updateState({ coupons: couponsList });
        }
      }

      let finalMsg = `✅ <b>خرید با موفقیت انجام شد!</b>\n\n📦 <b>سرویس:</b> ${product.name}\n`;
      if (isPAYG) {
        finalMsg += `⚡ <b>نوع سرویس:</b> مصرف آزاد (PAYG - پرداخت بر اساس مصرف)\n` +
                    `💰 <b>نرخ هر گیگابایت:</b> ${newPurchase.pricePerGb.toLocaleString()} تومان` +
                    (effectiveDiscount > 0 ? ` (با ${effectiveDiscount}٪ تخفیف اختصاصی همکار)\n\n` : `\n\n`);
      } else if (effectiveDiscount > 0) {
        finalMsg += `💵 <b>قیمت اصلی:</b> ${product.price.toLocaleString()} تومان\n` +
                    `🏷️ <b>تخفیف اعمال شده:</b> ${effectiveDiscount}٪ (${(product.price - finalPrice).toLocaleString()} تومان)\n` +
                    `💰 <b>قیمت نهایی پرداخت شده:</b> ${finalPrice.toLocaleString()} تومان\n\n`;
      } else {
        finalMsg += `💰 <b>قیمت پرداختی:</b> ${finalPrice.toLocaleString()} تومان\n\n`;
      }

      if (user.isSeller) {
         finalMsg += `📉 <b>بدهی جدید شما:</b> ${(user.debt || 0).toLocaleString()} تومان\n\n`;
      } else {
         finalMsg += `💰 <b>موجودی جدید:</b> ${user.balance.toLocaleString()} تومان\n\n`;
      }
      bot!.sendMessage(chatId, finalMsg, { parse_mode: 'HTML' });
      await sendServiceInfo(chatId, newPurchase);
    } catch (err: any) {
      bot!.sendMessage(chatId, `❌ ساخت کانفیگ شکست خورد: ${err.message}`);
    }
  }

  const getDailyReportText = (): string => {
    const state = db.getState();
    const now = Date.now();
    const MS_PER_DAY = 24 * 60 * 60 * 1000;
    
    const totalUsers = state.users.length;
    const newUsersToday = state.users.filter(u => {
      if (!u.registeredAt) return false;
      const regTime = new Date(u.registeredAt).getTime();
      return (now - regTime) < MS_PER_DAY;
    }).length;

    let totalSalesTodayCount = 0;
    let totalSalesTodayAmount = 0;
    let sellerSalesTodayCount = 0;
    let sellerSalesTodayAmount = 0;
    let regularSalesTodayCount = 0;
    let regularSalesTodayAmount = 0;

    state.users.forEach(u => {
      if (!u.purchases) return;
      u.purchases.forEach(p => {
        if (!p.createdAt) return;
        const purchaseTime = new Date(p.createdAt).getTime();
        if ((now - purchaseTime) < MS_PER_DAY) {
          totalSalesTodayCount++;
          totalSalesTodayAmount += (p.price || 0);
          if (u.isSeller) {
            sellerSalesTodayCount++;
            sellerSalesTodayAmount += (p.price || 0);
          } else {
            regularSalesTodayCount++;
            regularSalesTodayAmount += (p.price || 0);
          }
        }
      });
    });

    return `📊 <b>گزارش فروش و کاربران (۲۴ ساعت گذشته)</b>\n\n` +
           `👥 <b>آمار کاربران:</b>\n` +
           `• کل کاربران ربات: <b>${totalUsers.toLocaleString()}</b> کاربر\n` +
           `• کاربران جدید امروز: <b>${newUsersToday.toLocaleString()}</b> کاربر جدید\n\n` +
           `💰 <b>آمار فروش امروز (۲۴ ساعت گذشته):</b>\n` +
           `• کل فروش امروز: <b>${totalSalesTodayAmount.toLocaleString()}</b> تومان (تعداد: ${totalSalesTodayCount})\n` +
           `• فروش به کاربران عادی: <b>${regularSalesTodayAmount.toLocaleString()}</b> تومان (تعداد: ${regularSalesTodayCount})\n` +
           `• فروش به همکاران (سرویس‌دهندگان): <b>${sellerSalesTodayAmount.toLocaleString()}</b> تومان (تعداد: ${sellerSalesTodayCount})\n\n` +
           `📅 گزارش در تاریخ: <code>${new Date().toLocaleDateString('fa-IR')}</code> ساعت <code>${new Date().toLocaleTimeString('fa-IR')}</code> تهیه شده است.`;
  };

  async function sendDetailedSellerReport(chatId: number, sellerChatId: number, isAdminContext: boolean = false) {
    const seller = db.getUser(sellerChatId);
    if (!seller || !seller.isSeller) {
      bot!.sendMessage(chatId, '❌ همکار مورد نظر یافت نشد یا نقش همکار ندارد.');
      return;
    }

    const loadingMsg = await bot!.sendMessage(chatId, '⏳ در حال محاسبات مالی و دریافت آخرین اطلاعات مصرف از سرور، لطفاً شکیبا باشید...');

    try {
      const allClientsArray = await xui.getAllClientsWithTraffic().catch(() => [] as any[]);

      const purchases = seller.purchases || [];
      let sellerChanged = false;
      
      // Auto-credit any pending balance of the seller towards their debt/payments!
      if ((seller.balance || 0) > 0) {
        seller.totalPayments = (seller.totalPayments || 0) + seller.balance;
        seller.debt = Math.max(0, (seller.debt || 0) - seller.balance);
        seller.balance = 0;
        sellerChanged = true;
      }

      // Calculate volumes and financials
      let totalAllocatedGb = 0;
      let totalUsedBytes = 0;
      let totalOriginalPrice = 0;
      let totalFinalPrice = 0;
      let totalDiscounts = 0;
      let totalPaygActiveDebt = 0;
      let totalPaygSettledFin = 0;
      let totalFixedFin = 0;
      let hasPayg = false;
      let paygDetailsList: string[] = [];

      purchases.forEach((p: any) => {
        totalAllocatedGb += p.volumeGb || 0;
        
        // Find in XUI clients
        const clientObj = allClientsArray.find(cl => 
          (cl.email && p.id && cl.email.toLowerCase() === String(p.id).toLowerCase()) ||
          (cl.id && p.id && cl.id.toLowerCase() === String(p.id).toLowerCase()) ||
          (p.subUrl && cl.subId && p.subUrl.includes(cl.subId))
        );
        let currentUsed = 0;
        if (clientObj) {
          currentUsed = (clientObj.up || 0) + (clientObj.down || 0);
          totalUsedBytes += currentUsed;
          if (currentUsed > (p.lastUsedBytes || 0)) {
            p.lastUsedBytes = currentUsed;
            sellerChanged = true;
          }
        } else {
          currentUsed = (p.lastUsedBytes || 0);
          totalUsedBytes += currentUsed;
        }

        let orig = 0;
        let fin = 0;

        if (p.isPayAsYouGo) {
          hasPayg = true;
          const baseSettled = p.baseSettledBytes || 0;
          const effectiveBase = (currentUsed < baseSettled) ? 0 : baseSettled;
          const billableBytes = Math.max(0, currentUsed - effectiveBase);
          const billableGb = billableBytes / (1024 * 1024 * 1024);
          const settledGb = effectiveBase / (1024 * 1024 * 1024);

          const rawPricePerGb = p.originalPricePerGb || p.pricePerGb || 0;
          const discountPct = p.discountPercent !== undefined ? p.discountPercent : getSellerDiscountForProduct(seller, p);
          const discountedPricePerGb = Math.round(rawPricePerGb * (1 - discountPct / 100));

          const settledOrig = Math.ceil(settledGb * rawPricePerGb);
          const settledFin = Math.ceil(settledGb * discountedPricePerGb);

          const currentOrig = Math.ceil(billableGb * rawPricePerGb);
          const currentFin = Math.ceil(billableGb * discountedPricePerGb);

          orig = settledOrig + currentOrig;
          fin = settledFin + currentFin;

          totalPaygActiveDebt += currentFin;
          totalPaygSettledFin += settledFin;

          const configName = p.name || p.id || 'سرویس مصرف آزاد';
          paygDetailsList.push(`▫️ *${configName}*:\n   کل مصرف: ${((currentUsed)/(1024*1024*1024)).toFixed(2)} GB | تسویه شده: ${(settledGb).toFixed(2)} GB | محاسبه جدید: *${(billableGb).toFixed(2)} GB* (*${currentFin.toLocaleString()}* ت)`);
        } else {
          orig = p.originalPrice !== undefined ? p.originalPrice : (p.price || 0);
          fin = p.price !== undefined ? p.price : 0;
          if (orig <= fin && p.discountPercent && p.discountPercent > 0) {
            orig = Math.round(fin / (1 - p.discountPercent / 100));
          }
          totalFixedFin += fin;
        }

        if (orig < fin) orig = fin;

        totalOriginalPrice += orig;
        totalFinalPrice += fin;
        totalDiscounts += Math.max(0, orig - fin);
      });

      // Total net purchases with discount applied is the seller's true total sales obligation
      if (seller.totalSales !== totalFinalPrice) {
        seller.totalSales = totalFinalPrice;
        sellerChanged = true;
      }

      // Reconcile current debt:
      // 1. Unsettled active PAYG traffic is ALWAYS active debt of the current billing cycle.
      // 2. Fixed packages: totalFixedFin is the sum of fixed package prices.
      // 3. Recorded payments: seller.totalPayments is total money paid/settled by the seller.
      // 4. Settled PAYG accounts for totalPaygSettledFin of the recorded payments.
      // 5. Any payments beyond settled PAYG cover fixed packages.
      const recordedPayments = seller.totalPayments || 0;
      const paymentsForFixed = Math.max(0, recordedPayments - totalPaygSettledFin);
      const activeFixedDebt = Math.max(0, totalFixedFin - paymentsForFixed);
      const trueActiveDebt = activeFixedDebt + totalPaygActiveDebt;

      let debtVal = trueActiveDebt;
      if (purchases.length === 0) {
        debtVal = seller.debt || 0;
      }

      if (seller.debt !== debtVal) {
        seller.debt = debtVal;
        sellerChanged = true;
      }

      // Total payments is at least recordedPayments or totalFinalPrice - debtVal
      const totalPayments = Math.max(recordedPayments, totalFinalPrice - debtVal);
      if (seller.totalPayments !== totalPayments) {
        seller.totalPayments = totalPayments;
        sellerChanged = true;
      }

      if (sellerChanged) {
        db.saveUser(seller);
      }

      const totalUsedGb = totalUsedBytes / (1024 * 1024 * 1024);
      const isUnlimited = isSellerUnlimitedLimit(seller);
      const limit = seller.debtLimit !== undefined && seller.debtLimit > 0 ? seller.debtLimit : 1000000;
      const remains = isUnlimited ? null : Math.max(0, limit - debtVal);
      const limitStr = isUnlimited ? '*سقف آزاد (نامحدود)*' : `*${limit.toLocaleString()}* تومان`;
      const remainsStr = isUnlimited ? '*نامحدود (سقف آزاد)*' : `*${(remains || 0).toLocaleString()}* تومان`;

      const usernameStr = seller.username ? `@${seller.username}` : 'بدون یوزرنیم';
      const nicknameStr = seller.nickname || 'نامشخص';

      const reportText = `📊 *گزارش دقیق عملکرد و حساب همکار* \n\n` +
        `👤 *مشخصات همکار:*\n` +
        `▫️ نام/نیک‌نیم: *${nicknameStr}*\n` +
        `▫️ یوزرنیم تلگرام: *${usernameStr}*\n` +
        `▫️ شناسه تلگرام: \`${seller.chatId}\`\n\n` +
        `📈 *آمار فروش و ترافیک:*\n` +
        `▫️ تعداد کل کانفیگ‌های ثبت شده: *${purchases.length}* عدد\n` +
        `▫️ مجموع حجم فروخته شده (Allocated): *${totalAllocatedGb.toFixed(2)}* گیگابایت\n` +
        `▫️ مجموع مصرف واقعی کل (Real Usage): *${totalUsedGb.toFixed(2)}* گیگابایت\n\n` +
        `💰 *آمار مالی و تراز حساب همکار (تومان):*\n` +
        `▫️ ارزش اصلی سرویس‌ها (بدون تخفیف): *${totalOriginalPrice.toLocaleString()}* تومان\n` +
        `▫️ جمع کل تخفیفات همکار: *${totalDiscounts.toLocaleString()}* تومان\n` +
        `▫️ فاکتور کل خرید همکار (با کسر تخفیف): *${totalFinalPrice.toLocaleString()}* تومان\n` +
        `▫️ مجموع کل واریزی‌ها و تسویه‌ها: *${totalPayments.toLocaleString()}* تومان\n` +
        `▫️ بدهی قطعی و باقیمانده فعلی: *${debtVal.toLocaleString()}* تومان\n\n` +
        `💳 *وضعیت سقف اعتبار خرید:*\n` +
        `▫️ سقف بدهی مجاز: ${limitStr}\n` +
        `▫️ اعتبار خرید باقیمانده: ${remainsStr}\n\n` +
        (paygDetailsList.length > 0 ? `⚡ *وضعیت کانفیگ‌های مصرف آزاد (PAYG):*\n${paygDetailsList.join('\n\n')}\n\n` : '');

      const inline_keyboard: any[] = [];
      if (isAdminContext) {
        inline_keyboard.push([
          { text: '💵 تسویه حساب این همکار', callback_data: `admin_settle_specific_${seller.chatId}` },
          { text: '🔄 اصلاح و همگام‌سازی تراز', callback_data: `admin_recalc_seller_${seller.chatId}` }
        ]);
        if (paygDetailsList.length > 0) {
          inline_keyboard.push([
            { text: '⚡ تسویه مصرف لحظه‌ای تا حجم فعلی', callback_data: `admin_settle_payg_${seller.chatId}` }
          ]);
        }
        inline_keyboard.push([
          { text: isUnlimited ? '🔒 تبدیل به سقف محدود عددی' : '⚡ تبدیل به سقف آزاد (نامحدود)', callback_data: `toggle_unlimited_seller_${seller.chatId}` },
          { text: '⚙️ تنظیم سقف اعتبار عددی', callback_data: `set_seller_limit_${seller.chatId}` }
        ]);
        inline_keyboard.push([
          { text: '➕ ثبت واریزی / پرداخت همکار', callback_data: `add_bal_${seller.chatId}` },
          { text: '➖ کسر پرداختی', callback_data: `sub_bal_${seller.chatId}` }
        ]);
        inline_keyboard.push([
          { text: '🔙 بازگشت به لیست همکاران', callback_data: 'list_sellers_only' }
        ]);
      } else {
        inline_keyboard.push([{ text: '🔙 بازگشت به پنل همکار', callback_data: 'seller_panel_inline' }]);
      }

      await bot!.editMessageText(reportText, {
        chat_id: chatId,
        message_id: loadingMsg.message_id,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard }
      });
    } catch (err: any) {
      console.error('Error calculating seller report:', err);
      await bot!.editMessageText(`❌ خطایی در محاسبات گزارش رخ داد: ${err.message}`, {
        chat_id: chatId,
        message_id: loadingMsg.message_id
      });
    }
  }

  const sendAdminMainMenu = (chatId: number) => {
    bot!.sendMessage(chatId, '🔧 *پنل مدیریت ربات سنایی (X-UI)*:\nلطفاً یکی از بخش‌های مدیریتی زیر را انتخاب کنید:', {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔵 تنظیمات اتصال سنایی (X-UI)', callback_data: 'admin_panel_menu' }],
          [{ text: '🎁 هدیه/تست رایگان', callback_data: 'admin_test_menu' }, { text: '💳 شماره کارت پرداخت', callback_data: 'admin_card_menu' }],
          [{ text: '📦 مدیریت محصولات', callback_data: 'admin_products_menu' }, { text: '🎟 کدهای تخفیف', callback_data: 'admin_coupons_menu' }],
          [{ text: '👥 مدیریت جامع کاربران و همکاران', callback_data: 'admin_users_menu' }],
          [{ text: '📊 گزارش فروش و کاربران (امروز)', callback_data: 'admin_daily_report' }],
          [{ text: '📢 ارسال پیام همگانی', callback_data: 'admin_broadcast' }, { text: '📞 پشتیبانی', callback_data: 'admin_set_support_id' }],
          [{ text: '⚙️ تنظیمات بکاپ خودکار', callback_data: 'admin_auto_backup_menu' }],
          [{ text: '📥 تهیه فایل بکاپ', callback_data: 'admin_backup' }, { text: '📤 بازیابی بکاپ', callback_data: 'admin_restore_prompt' }]
        ]
      } as any
    });
  };

  const sendCardSettingsMenu = (chatId: number) => {
    const s = db.getState();
    const msg = `💳 *تنظیمات کارت پرداخت بانکی (کارت به کارت)*:\n\n` +
      `💳 شماره کارت فعلی: \`${s.cardNumber || '❌ تنظیم نشده'}\`\n` +
      `👤 نام دارنده حساب: *${s.cardHolder || '❌ تنظیم نشده'}*\n\n` +
      `شما می‌توانید هر کدام از مشخصات کارت زیر را از طریق دکمه‌های زیر تغییر دهید:`;

    bot!.sendMessage(chatId, msg, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '💳 تغییر شماره کارت', callback_data: 'set_card_num' }, { text: '👤 تغییر نام دارنده حساب', callback_data: 'set_card_name' }],
          [{ text: '🔙 بازگشت به منوی ادمین', callback_data: 'admin_main' }]
        ]
      }
    });
  };

  const sendSanaeiConnectionMenu = (chatId: number) => {
    const state = db.getState();
    const msg = `🖥 اطلاعات اتصال به پنل سنایی (X-UI):

🔗 آدرس: ${state.panel.url || '❌ تنظیم نشده'}
👤 نام کاربری: ${state.panel.username || '❌ تنظیم نشده'}
🔑 رمز عبور: ${state.panel.password ? '******' : '❌ تنظیم نشده'}
🔑 کلید API Key: ${state.panel.apiKey ? '✅ تنظیم شده (مخفی)' : '❌ تنظیم نشده'}
🆔 اینباند (Inbound ID): ${state.panel.inboundId || '❌ تنظیم نشده'}

برای تغییر هر مورد، دکمه مربوطه در زیر را فشرده و پیام جدید را ارسال کنید.`;

    bot!.sendMessage(chatId, msg, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔗 تغییر آدرس پنل', callback_data: 'set_p_url' }, { text: '👤 تغییر نام کاربری', callback_data: 'set_p_user' }],
          [{ text: '🔑 تغییر رمز عبور', callback_data: 'set_p_pass' }, { text: '🔑 تغییر کلید API Key', callback_data: 'set_p_apikey' }],
          [{ text: '🆔 تغییر ID اینباند', callback_data: 'set_p_inbound' }],
          [{ text: '🔄 دریافت لیست اینباندهای پنل', callback_data: 'admin_fetch_inbounds' }],
          [{ text: '🔙 بازگشت به منوی ادمین', callback_data: 'admin_main' }]
        ]
      }
    });
  };

  const sendTestSettingsMenu = (chatId: number) => {
    const state = db.getState();
    const statusText = state.freeTestEnabled !== false ? '✅ فعال' : '❌ غیرفعال';
    const msg = `🎁 *تنظیمات اکانت تست رایگان و پاداش دعوت*:\n\n` +
      `🔘 وضعیت تست رایگان: *${statusText}*\n` +
      `📦 حجم تست رایگان: \`${state.freeTestVolumeGb} گیگابایت\`\n` +
      `⏰ زمان تست رایگان: \`${state.freeTestDurationDays} روز\`\n` +
      `🆔 اینباند اختصاصی تست: \`${state.freeTestInboundId || 'عمومی'}\`\n` +
      `💰 هدیه زیرمجموعه‌گیری: \`${state.referralRewardToman || 0} تومان\``;

    bot!.sendMessage(chatId, msg, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔘 فعال/غیرفعال کردن تست', callback_data: 'toggle_test_enabled' }],
          [{ text: '📦 حجم تست رایگان', callback_data: 'set_t_volume' }, { text: '⏰ زمان تست رایگان', callback_data: 'set_t_days' }],
          [{ text: '🆔 اینباند اختصاصی تست', callback_data: 'set_t_inbound' }],
          [{ text: '💰 تغییر هدیه معرفی', callback_data: 'set_reward_toman' }],
          [{ text: '🔙 بازگشت به منوی ادمین', callback_data: 'admin_main' }]
        ]
      }
    });
  };

  const sendProductsMenu = (chatId: number) => {
    const state = db.getState();
    let msg = '📦 پکیج‌ها و محصولات فعال در ربات:\n\n';
    if (state.products.length === 0) {
      msg += '❌ هیچ محصولی تعریف نشده است.';
    } else {
      state.products.forEach((p, idx) => {
        const inboundText = p.inboundId ? `🆔 اینباند اختصاصی: ${p.inboundId}` : '🆔 اینباند: عمومی (تعریف شده در تنظیمات)';
        msg += `${idx + 1}- *${p.name}*\n💰 قیمت: ${p.price.toLocaleString()} تومان\n📦 حجم: ${p.volumeGb} GB\n⏳ زمان: ${p.durationDays} روز\n${inboundText}\n🗑 آیدی محصول: \`${p.id}\`\n----------------\n`;
      });
    }

    const inline_keyboard: any[] = [];
    state.products.forEach(p => {
      inline_keyboard.push([{ text: `🔴 حذف "${p.name}"`, callback_data: `del_prod_${p.id}` }]);
    });
    inline_keyboard.push([{ text: '🟢 افزودن محصول جدید', callback_data: 'add_prod' }]);
    inline_keyboard.push([{ text: '🔙 بازگشت به منوی ادمین', callback_data: 'admin_main' }]);

    bot!.sendMessage(chatId, msg, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard
      }
    });
  };

  const sendUsersMenu = (chatId: number) => {
    const state = db.getState();
    const sellers = state.users.filter(u => u.isSeller);
    const msg = `👥 مدیریت جامع کاربران و فروشنده‌ها:

کل اعضای ربات: ${state.users.length} نفر
تعداد همکاران فروشنده: ${sellers.length} نفر

یکی از دستورات زیر را برای اعمال انتخاب کنید:`;

    bot!.sendMessage(chatId, msg, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔍 جستجوی کاربر در سیستم', callback_data: 'admin_search_user' }, { text: '🔍 جستجوی کانفیگ', callback_data: 'admin_search_config' }],
          [{ text: '📋 لیست کل کاربران ربات', callback_data: 'list_all_users' }, { text: '👥 لیست همکاران', callback_data: 'list_sellers_only' }],
          [{ text: '🟢 شارژ دستی کاربر', callback_data: 'charge_user_bot' }, { text: '🔄 تغییر نقش کاربری', callback_data: 'change_role_bot' }],
          [{ text: '💵 تسویه حساب همکار', callback_data: 'settle_user_bot' }],
          [{ text: '🔙 بازگشت به منوی ادمین', callback_data: 'admin_main' }]
        ]
      }
    });
  };

  const sendCouponsMenu = (chatId: number) => {
    const state = db.getState();
    let msg = `🎟 *مدیریت کدهای تخفیف و هدیه فعال*:\n\n`;
    const coupons = state.coupons || [];
    if (coupons.length === 0) {
      msg += `❌ هیچ کد تخفیف یا هدیه‌ای در حال حاضر تعریف نشده است.`;
    } else {
      coupons.forEach((c: any, idx: number) => {
        if (c.giftAmount !== undefined) {
          msg += `*${idx + 1}-* 🎁 کد هدیه: \`${c.code}\` — ${c.giftAmount.toLocaleString()} تومان شارژ مستقیم کیف پول\n`;
        } else {
          msg += `*${idx + 1}-* 🏷 کد تخفیف: \`${c.code}\` — %${c.discountPercent} تخفیف\n`;
        }
        if (c.maxUsage) msg += `   📊 محدودیت مصرف کل: ${c.usedCount || 0} / ${c.maxUsage}\n`;
        if (c.maxUsagePerUser) msg += `   👤 محدودیت هر کاربر: ${c.maxUsagePerUser} بار\n`;
        if (c.expirationDate) {
          const daysLeft = Math.ceil((new Date(c.expirationDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
          const expStr = daysLeft > 0 ? `${daysLeft} روز باقیمانده` : `منقضی شده`;
          msg += `   ⏳ اعتبار: ${expStr}\n`;
        }
        msg += `\n`;
      });
    }

    const inline_keyboard: any[] = [];
    coupons.forEach((c: any) => {
      inline_keyboard.push([{ text: `🗑 حذف "${c.code}"`, callback_data: `del_coupon_${c.code}` }]);
    });
    inline_keyboard.push([
      { text: '➕ تعریف کد تخفیف جدید', callback_data: 'add_coupon' },
      { text: '🎁 تعریف کد هدیه جدید', callback_data: 'add_gift_code' }
    ]);
    inline_keyboard.push([{ text: '🔙 بازگشت به منوی ادمین', callback_data: 'admin_main' }]);

    bot!.sendMessage(chatId, msg, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard
      }
    });
  };

  const sendGiftCodeDraftMenu = (chatId: number) => {
    const draft = giftCodeDrafts.get(chatId) || {};
    const codeStr = draft.code ? `\`${draft.code}\`` : '🔴 تعیین نشده';
    const amountStr = draft.giftAmount !== undefined ? `*${draft.giftAmount.toLocaleString()}* تومان` : '🔴 تعیین نشده';
    const maxUsageStr = draft.maxUsage ? `*${draft.maxUsage}* بار` : 'بدون محدودیت';
    const maxUsagePerUserStr = draft.maxUsagePerUser ? `*${draft.maxUsagePerUser}* بار` : '۱ بار برای هر کاربر';
    const expirationStr = draft.expirationDays ? `*${draft.expirationDays}* روز` : 'بدون انقضا';

    const msg = `🎁 *تعریف کد هدیه جدید (پنل شیشه‌ای)*\n\n` +
      `🏷 کد هدیه: ${codeStr}\n` +
      `💰 مبلغ شارژ: ${amountStr}\n` +
      `📊 سقف مصرف کل: ${maxUsageStr}\n` +
      `👥 سقف مصرف هر کاربر: ${maxUsagePerUserStr}\n` +
      `📅 مهلت اعتبار: ${expirationStr}\n\n` +
      `لطفاً با استفاده از دکمه‌های زیر، مشخصات کد هدیه را تکمیل کرده و سپس روی دکمه ثبت نهایی کلیک کنید:`;

    const inline_keyboard = [
      [
        { text: '✏️ تنظیم کد هدیه', callback_data: 'edit_gift_draft_code' },
        { text: '💰 تنظیم مبلغ هدیه', callback_data: 'edit_gift_draft_amount' }
      ],
      [
        { text: '📊 سقف مصرف کل', callback_data: 'edit_gift_draft_max' },
        { text: '👥 سقف مصرف هر کاربر', callback_data: 'edit_gift_draft_per_user' }
      ],
      [
        { text: '📅 تعداد روز اعتبار', callback_data: 'edit_gift_draft_exp' }
      ],
      [
        { text: '✅ ثبت و ذخیره نهایی', callback_data: 'save_gift_draft' }
      ],
      [
        { text: '❌ انصراف و بازگشت', callback_data: 'cancel_gift_draft' }
      ]
    ];

    bot!.sendMessage(chatId, msg, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard }
    });
  };

  bot.onText(/\/start(?:\s+(.+))?/, (msg, match) => {
    const chatId = msg.chat.id;
    const refCode = match ? match[1] : undefined;
    
    let user = db.getUser(chatId);
    let isNewUser = false;

    if (!user) {
      isNewUser = true;
      user = {
        chatId: chatId,
        username: msg.from?.username,
        balance: 0,
        testUsed: false,
        registeredAt: new Date().toISOString(),
        referralsMade: 0
      };

      if (refCode && refCode.startsWith('ref_')) {
        const referrerId = parseInt(refCode.replace('ref_', ''));
        if (!isNaN(referrerId) && referrerId !== chatId) {
          const referrer = db.getUser(referrerId);
          if (referrer) {
            user.referredBy = referrerId;
            const currentState = db.getState();
            referrer.balance += currentState.referralRewardToman || 0;
            referrer.referralsMade = (referrer.referralsMade || 0) + 1;
            db.saveUser(referrer);
            if (currentState.referralRewardToman > 0) {
              bot!.sendMessage(referrerId, `🎉 تبریک!\nیک کاربر با لینک شما عضو شد و ${currentState.referralRewardToman} تومان به موجودی شما اضافه شد.`);
            }
          }
        }
      }

      db.saveUser(user);
      
      const adminIds = db.getState().adminIds;
      if (adminIds.length === 0) {
        db.updateState({ adminIds: [chatId] });
        bot!.sendMessage(chatId, 'شما به عنوان اولین ادمین ربات تنظیم شدید. برای مدیریت از /admin استفاده کنید.');
      }
    } else {
      // Keep username up to date if they changed it
      if (msg.from?.username && user.username !== msg.from.username) {
        user.username = msg.from.username;
        db.saveUser(user);
      }
    }

    const startMsg = `👋 سلام به ربات خدمات VPN فوق سریع ما خوش آمدید!\n\n` +
      `🆔 شناسه عددی شما (Chat ID):\n\`${chatId}\`\n\n` +
      `💡 جهت ثبت مدیریت، می‌توانید شناسه فوق را در داشبورد تحت وب کپی و ذخیره نمایید.\n\n` +
      `لطفاً یکی از گزینه‌های زیر را انتخاب کنید:`;

    bot!.sendMessage(chatId, startMsg, {
      parse_mode: 'Markdown',
      reply_markup: getUserReplyKeyboard(user, state, state.adminIds.includes(chatId))
    });
  });

  bot.onText(/\/admin/, (msg) => {
    const chatId = msg.chat.id;
    const state = db.getState();
    if (!state.adminIds.includes(chatId)) {
      bot!.sendMessage(chatId, '❌ شما به این بخش دسترسی ندارید.');
      return;
    }
    sendAdminMainMenu(chatId);
  });

  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text || '';

    const state = db.getState();
    const isAdmin = state.adminIds.includes(chatId);

    // Filter for force join
    if (!isAdmin && state.forceJoinEnabled && state.forceJoinChannels && state.forceJoinChannels.length > 0) {
       let unjoinedChannels: any[] = [];
       for (const channel of state.forceJoinChannels) {
           if (!channel.id) continue;
           try {
              const member = await bot!.getChatMember(channel.id, chatId);
              if (member.status === 'left' || member.status === 'kicked') {
                 unjoinedChannels.push(channel);
              }
           } catch (e) {
              // If bot is not admin in the channel or invalid id, we assume error and maybe skip or force.
              // To prevent locking users if bot is removed, we'll assume they need to join if we can't check?
              // Actually, if bot throws error, it's safer to just skip checking that channel.
           }
       }

       if (unjoinedChannels.length > 0) {
           if (text === '✅ عضو شدم') {
               bot!.sendMessage(chatId, '❌ شما هنوز عضو کانال‌های زیر نشده‌اید. لطفاً ابتدا عضو شوید:', {
                   reply_markup: {
                       inline_keyboard: unjoinedChannels.map(c => [{ text: `عضویت در ${c.name}`, url: c.url }]),
                   }
               });
               return;
           }
           
           if (!text.startsWith('/start') && !text.startsWith('✅ عضو شدم')) {
              const inlineKeyboard = unjoinedChannels.map(c => [{ text: `🔗 عضویت در کانال: ${c.name}`, url: c.url }]);
              bot!.sendMessage(chatId, '⚠️ برای استفاده از ربات، لطفاً ابتدا در کانال(های) زیر عضو شوید:', {
                 reply_markup: {
                    inline_keyboard: inlineKeyboard,
                    keyboard: [[{ text: '✅ عضو شدم' }]],
                    resize_keyboard: true
                 }
              });
              return;
           }

           if (text.startsWith('/start')) {
              // Same prompt for /start
              const inlineKeyboard = unjoinedChannels.map(c => [{ text: `🔗 عضویت در کانال: ${c.name}`, url: c.url }]);
              bot!.sendMessage(chatId, '👋 خوش آمدید!\n⚠️ برای استفاده از ربات، لطفاً ابتدا در کانال(های) زیر عضو شوید:', {
                 reply_markup: {
                    inline_keyboard: inlineKeyboard,
                    keyboard: [[{ text: '✅ عضو شدم' }]],
                    resize_keyboard: true
                 }
              });
              return;
           }
       } else if (text === '✅ عضو شدم') {
           bot!.sendMessage(chatId, '✅ از عضویت شما سپاسگزاریم.\nاکنون می‌توانید از امکانات ربات استفاده کنید.', {
              reply_markup: { remove_keyboard: true } // Then they will /start typically
           });
           bot!.sendMessage(chatId, 'لطفا /start را مجددا ارسال نمایید تا منو باز شود.');
           return;
       }
    }

    // Process photo uploads for pending payment receipts FIRST
    if (msg.photo) {
      const session = userSession.get(chatId);
      if (session && session.action === 'payment_awaiting_photo') {
        const amount = session.amount || 0;
        const pendingPurchase = session.pendingPurchase;
        userSession.delete(chatId); // Complete session

        // Get largest photo size
        const photo = msg.photo[msg.photo.length - 1];
        const fileId = photo.file_id;
        
        const payId = Math.random().toString(36).substring(2, 10);
        let currentPending = db.getState().pendingPayments || [];
        currentPending.push({ id: payId, chatId, amount, fileId, timestamp: Date.now(), pendingPurchase });
        db.updateState({ pendingPayments: currentPending });

        bot!.sendMessage(chatId, '⏳ رسید پرداخت شما با موفقیت ارسال شد و در صف تایید مدیریت قرار گرفت. لطفاً صبور باشید...');

        // Notify admins
        const escapedName = escapeHtml(msg.from?.first_name || 'ناشناس');
        const escapedUsername = msg.from?.username ? `@${escapeHtml(msg.from.username)}` : 'ندارد';

        let purchaseInfoText = '';
        if (pendingPurchase) {
          const product = db.getState().products.find(p => p.id === pendingPurchase.productId);
          if (product) {
            purchaseInfoText = `🛒 <b>خرید خودکار پس از تایید:</b> ${product.name}\n`;
            if (pendingPurchase.couponCode) {
              purchaseInfoText += `🎫 کد تخفیف اعمال شده: <code>${pendingPurchase.couponCode}</code>\n`;
            }
            if (pendingPurchase.customName) {
              purchaseInfoText += `📝 نام دلخواه کانفیگ: <code>${pendingPurchase.customName}</code>\n`;
            }
            purchaseInfoText += `\n`;
          }
        }

        state.adminIds.forEach(adminId => {
          bot!.sendPhoto(Number(adminId), fileId, {
            caption: `🔔 <b>درخواست جدید شارژ حساب (کارت به کارت)</b>\n\n` +
              `👤 کاربر: ${escapedName} (${escapedUsername})\n` +
              `🆔 شناسه کاربری (Chat ID): <code>${chatId}</code>\n` +
              `💰 مبلغ ارسالی فیش: <b>${amount.toLocaleString()}</b> تومان\n\n` +
              purchaseInfoText +
              `آیا این رسید را تایید می‌کنید؟`,
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '✅ تایید و شارژ', callback_data: `approve_pay_${payId}` },
                  { text: '❌ رد فیش', callback_data: `reject_pay_${payId}` }
                ]
              ]
            }
          }).catch(err => {
            console.error(`Failed to broadcast payment to admin ${adminId}:`, err.message);
            // Fallback delivery if sendPhoto fails
            bot!.sendMessage(Number(adminId), `🔔 <b>درخواست جدید شارژ حساب (کارت به کارت - فاقد تصویر)</b>\n\n` +
              `👤 کاربر: ${escapedName} (${escapedUsername})\n` +
              `🆔 شناسه کاربری (Chat ID): <code>${chatId}</code>\n` +
              `💰 مبلغ ارسالی فیش: <b>${amount.toLocaleString()}</b> تومان\n\n` +
              purchaseInfoText +
              `⚠️ تصویر فیش به علت محدودیت‌های تلگرام یا حجم بالا ارسال نشد اما درخواست ثبت گردیده است.`, {
              parse_mode: 'HTML',
              reply_markup: {
                inline_keyboard: [
                  [
                    { text: '✅ تایید و شارژ', callback_data: `approve_pay_${payId}` },
                    { text: '❌ رد فیش', callback_data: `reject_pay_${payId}` }
                  ]
                ]
              }
            }).catch(e => console.error(`Fallback failed:`, e.message));
          });
        });
        return;
      }
    }

    // Process awaiting payment amount input FIRST
    const userSg = userSession.get(chatId);
    if (userSg && userSg.action === 'payment_awaiting_amount' && text && !text.startsWith('/')) {
      const englishDigits = text.trim()
        .replace(/[۰-۹]/g, d => String.fromCharCode(d.charCodeAt(0) - 1728))
        .replace(/[٠-٩]/g, d => String.fromCharCode(d.charCodeAt(0) - 1632));
      const amount = parseInt(englishDigits.replace(/[^0-9]/g, ''));
      if (isNaN(amount) || amount <= 0) {
        bot!.sendMessage(chatId, '❌ مبلغ وارد شده نامعتبر است. لطفاً فقط عدد انگلیسی یا فارسی (مثلاً ۵۰۰۰۰) وارد کنید:');
        return;
      }

      userSession.set(chatId, { action: 'payment_awaiting_photo', amount, pendingPurchase: userSg.pendingPurchase });
      const cardNumber = state.cardNumber || '۶۰۳۷۹۹۷۹۱۲۳۴۵۶۷۸';
      const cardHolder = state.cardHolder || 'مدیریت حساب';

      const paymentInstructions = `💳 *دستورالعمل واریز کارت به کارت*:\n\n` +
        `لطفاً مبلغ *${amount.toLocaleString()}* تومان را به مشخصات بانکی زیر واریز نمایید:\n\n` +
        `  💳 شماره کارت:\n  \`${cardNumber}\`\n\n` +
        `  👤 به نام:\n  *${cardHolder}*\n\n` +
        `⚠️ *توجه کُنید*:\n` +
        `پس از انجام واریز کارت به کارت، لطفا *عکس رسید پرداخت (فیش واریزی)* خود را به صورت عکس به همین گفتگو بفرستید تا سریعاً توسط مدیریت تایید و حسابتان شارژ شود.`;

      bot!.sendMessage(chatId, paymentInstructions, { parse_mode: 'Markdown' });
      return;
    }

    if (userSg && userSg.action === 'awaiting_gift_code' && text && !text.startsWith('/')) {
      const inputCode = text.trim().toUpperCase();
      const couponsList = state.coupons || [];
      const matchCoupon = couponsList.find((c: any) => c.code === inputCode && c.giftAmount !== undefined && c.giftAmount > 0);

      if (!matchCoupon) {
        bot!.sendMessage(chatId, '❌ کد هدیه وارد شده نامعتبر، منقضی شده یا اشتباه است. لطفاً مجدداً بررسی کنید.');
        return;
      }

      // Check Expiration
      if (matchCoupon.expirationDate && new Date(matchCoupon.expirationDate) < new Date()) {
        bot!.sendMessage(chatId, '❌ متاسفانه مهلت استفاده از این کد هدیه به پایان رسیده است.');
        return;
      }

      // Check Max Usage (total)
      if (matchCoupon.maxUsage && matchCoupon.usedCount !== undefined && matchCoupon.usedCount >= matchCoupon.maxUsage) {
        bot!.sendMessage(chatId, '❌ متاسفانه ظرفیت این کد هدیه تکمیل شده است.');
        return;
      }

      // Check Max Usage per user
      const usedBy = matchCoupon.usedBy || {};
      const userUsage = usedBy[String(chatId)] || 0;
      const maxUsagePerUser = matchCoupon.maxUsagePerUser !== undefined ? matchCoupon.maxUsagePerUser : 1;

      if (userUsage >= maxUsagePerUser) {
        bot!.sendMessage(chatId, '❌ شما قبلاً از این کد هدیه استفاده کرده‌اید.');
        return;
      }

      // Add balance to user
      const user = db.getUser(chatId);
      if (user) {
        const giftAmount = matchCoupon.giftAmount;
        user.balance = (user.balance || 0) + giftAmount;
        db.saveUser(user);

        // Update coupon usage statistics
        matchCoupon.usedCount = (matchCoupon.usedCount || 0) + 1;
        if (!matchCoupon.usedBy) {
          matchCoupon.usedBy = {};
        }
        matchCoupon.usedBy[String(chatId)] = (matchCoupon.usedBy[String(chatId)] || 0) + 1;
        
        // Update coupons state and save
        const updatedCoupons = couponsList.map((c: any) => c.code === inputCode ? matchCoupon : c);
        db.updateState({ coupons: updatedCoupons });

        // Clean up session
        userSession.delete(chatId);

        bot!.sendMessage(chatId, `🎉 <b>تبریک! کد هدیه با موفقیت فعال شد.</b>\n\n` +
          `💰 مبلغ <b>${giftAmount.toLocaleString()}</b> تومان به موجودی حساب شما افزوده شد.\n` +
          `💳 موجودی جدید حساب شما: <b>${user.balance.toLocaleString()}</b> تومان`, { parse_mode: 'HTML' });
      } else {
        bot!.sendMessage(chatId, '❌ کاربر پیدا نشد.');
      }
      return;
    }

    if (userSg && userSg.action === 'awaiting_custom_config_name' && text && !text.startsWith('/')) {
      const { productId, couponCode } = userSg;
      
      const customName = text.trim();
      if (!/^[a-zA-Z0-9_-]+$/.test(customName)) {
        bot!.sendMessage(chatId, '❌ نام وارد شده معتبر نیست. لطفاً فقط از حروف انگلیسی، اعداد، خط تیره (-) و زیرخط (_) استفاده کنید و فاصله نگذارید:');
        return; 
      }

      let isDuplicate = false;
      const allUsers = state.users;
      for (const u of allUsers) {
        if (u.purchases && u.purchases.some((p: any) => p.id.toLowerCase() === customName.toLowerCase())) {
          isDuplicate = true;
          break;
        }
      }
      
      if (isDuplicate) {
        bot!.sendMessage(chatId, '❌ هشدار: این نام تکراری است و قبلاً ثبت شده است! لطفاً یک نام دیگر انتخاب کنید:');
        return; 
      }

      userSession.delete(chatId);
      const product = state.products.find(p => p.id === productId);
      if (!product) {
        bot!.sendMessage(chatId, '❌ محصول پیدا نشد.');
        return;
      }

      executePurchase(chatId, product, couponCode, customName).catch(e => {
        console.error('[Purchase Error]', e);
      });
      return;
    }

    if (userSg && userSg.action && userSg.action.startsWith('awaiting_coupon_for_') && text && !text.startsWith('/')) {
      const productId = userSg.action.replace('awaiting_coupon_for_', '');
      userSession.delete(chatId);
      
      const product = state.products.find(p => p.id === productId);
      if (!product) {
        bot!.sendMessage(chatId, '❌ محصول پیدا نشد.');
        return;
      }

      const inputCoupon = text.trim().toUpperCase();
      const couponsList = state.coupons || [];
      const matchCoupon = couponsList.find((c: any) => c.code === inputCoupon && !c.giftAmount);
      
      let isValid = true;
      if (matchCoupon) {
        if (matchCoupon.expirationDate && new Date(matchCoupon.expirationDate) < new Date()) {
          isValid = false; // Expired
        }
        if (matchCoupon.maxUsage && matchCoupon.usedCount !== undefined && matchCoupon.usedCount >= matchCoupon.maxUsage) {
          isValid = false; // Max total usage reached
        }
        if (matchCoupon.maxUsagePerUser && matchCoupon.usedBy) {
          const userUsage = matchCoupon.usedBy[String(chatId)] || 0;
          if (userUsage >= matchCoupon.maxUsagePerUser) {
            isValid = false; // Max per-user usage reached
          }
        }
      } else {
        isValid = false;
      }

      if (!isValid) {
        bot!.sendMessage(chatId, `❌ کد تخفیف *${inputCoupon}* نامعتبر، منقضی شده یا ظرفیت آن تکمیل شده است.`, {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '🎫 تلاش مجدد', callback_data: `enter_coupon_${productId}` },
                { text: '🛒 خرید بدون تخفیف', callback_data: `buy_now_${productId}` }
              ],
              [{ text: '❌ انصراف از خرید', callback_data: 'cancel_purchase' }]
            ]
          }
        });
      } else {
        const discountPercent = matchCoupon.discountPercent;
        const finalPrice = Math.max(0, Math.round(product.price * (1 - discountPercent / 100)));
        
        bot!.sendMessage(chatId, `🎉 کد تخفیف *${inputCoupon}* با موفقیت اعمال شد!\n\n🎁 تخفیف: *%${discountPercent}*\n💰 قیمت اصلی: ~${product.price.toLocaleString()}~ تومان\n💵 قیمت نهایی خرید: *${finalPrice.toLocaleString()}* تومان`, {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: `🛒 تایید خرید و پرداخت (${finalPrice.toLocaleString()} تومان)`, callback_data: `buy_now_with_coupon_${productId}_${inputCoupon}` }],
              [{ text: '❌ انصراف از خرید', callback_data: 'cancel_purchase' }]
            ]
          }
        });
      }
      return;
    }

    // Check if user is admin and bot waiting for plain text inputs
    const sessionType = adminSession.get(chatId);

    if (isAdmin && sessionType && text && !text.startsWith('/')) {
      adminSession.delete(chatId);
      
      if (sessionType.startsWith('reject_reason_')) {
        const payload = sessionType.replace('reject_reason_', '');
        const parts = payload.split('_');
        const targetChatId = parseInt(parts[0]);
        const fileId = parts[1] || '';

        const reasonText = text.trim();

        // 1. Send failure notice with the reason
        const userMsg = `❌ *رسید پرداخت کارت به کارت شما رد شد.*\n\n⚠️ *دلیل رد:* ${reasonText}\n\nلطفاً اطلاعات تراکنش را بررسی نموده یا با پشتیبانی در ارتباط باشید.`;
        
        if (fileId) {
          // Send photo with message as caption
          bot!.sendPhoto(targetChatId, fileId, {
            caption: userMsg,
            parse_mode: 'Markdown'
          }).catch(err => {
            console.error(`Failed to send reject photo to customer ${targetChatId}:`, err.message);
            // Fallback to text message if photo send failed
            bot!.sendMessage(targetChatId, userMsg, { parse_mode: 'Markdown' }).catch(() => {});
          });
        } else {
          bot!.sendMessage(targetChatId, userMsg, { parse_mode: 'Markdown' }).catch(() => {});
        }

        bot!.sendMessage(chatId, `✅ فیش کاربر \`${targetChatId}\` رد شد و دلیل برای ایشان به همراه عکس فیش ارسال گردید:\n\n*${reasonText}*`, { parse_mode: 'Markdown' });
        return;
      }

      if (sessionType === 'set_card_num') {
        state.cardNumber = text.trim();
        db.updateState({ cardNumber: state.cardNumber });
        bot!.sendMessage(chatId, `✅ شماره کارت با موفقیت به \`${text}\` تغییر یافت.`, { parse_mode: 'Markdown' });
        sendCardSettingsMenu(chatId);
        return;
      }
      if (sessionType === 'set_card_name') {
        state.cardHolder = text.trim();
        db.updateState({ cardHolder: state.cardHolder });
        bot!.sendMessage(chatId, `✅ نام دارنده حساب با موفقیت به *${text}* تغییر یافت.`, { parse_mode: 'Markdown' });
        sendCardSettingsMenu(chatId);
        return;
      }

      if (sessionType === 'set_p_url') {
        state.panel.url = text.trim();
        db.updateState({ panel: state.panel });
        bot!.sendMessage(chatId, `✅ آدرس پنل به \`${text}\` تغییر یافت.`, { parse_mode: 'Markdown' });
        sendSanaeiConnectionMenu(chatId);
        return;
      }
      if (sessionType === 'set_p_user') {
        state.panel.username = text.trim();
        db.updateState({ panel: state.panel });
        bot!.sendMessage(chatId, '✅ نام کاربری ورود به پنل با موفقیت ویرایش شد.');
        sendSanaeiConnectionMenu(chatId);
        return;
      }
      if (sessionType === 'set_p_pass') {
        state.panel.password = text.trim();
        db.updateState({ panel: state.panel });
        bot!.sendMessage(chatId, '✅ رمز عبور ورود به پنل با موفقیت بروزرسانی شد.');
        sendSanaeiConnectionMenu(chatId);
        return;
      }
      if (sessionType === 'set_p_apikey') {
        state.panel.apiKey = text.trim();
        db.updateState({ panel: state.panel });
        bot!.sendMessage(chatId, '✅ کلید API-Key پنل با موفقیت ذخیره و فعال شد.');
        sendSanaeiConnectionMenu(chatId);
        return;
      }
      if (sessionType === 'set_p_inbound') {
        const val = parseInt(text.trim());
        if (isNaN(val)) {
          bot!.sendMessage(chatId, '❌ مقدار وارد شده باید یک عدد صحیح باشد.');
          sendSanaeiConnectionMenu(chatId);
          return;
        }
        state.panel.inboundId = val;
        db.updateState({ panel: state.panel });
        bot!.sendMessage(chatId, `✅ شناسه اینباند با موفقیت به \`${val}\` تغییر یافت.`, { parse_mode: 'Markdown' });
        sendSanaeiConnectionMenu(chatId);
        return;
      }
      if (sessionType === 'set_t_inbound') {
        const val = text.trim();
        if (val === '0' || val.toLowerCase() === 'none' || val.toLowerCase() === 'عمومی') {
          db.updateState({ freeTestInboundId: undefined });
          bot!.sendMessage(chatId, '✅ اینباند تست رایگان به عمومی (اینباند پیش‌فرض متصل به پنل) بازگردانی شد.');
        } else {
          const parsedId = parseInt(val);
          if (isNaN(parsedId)) {
            bot!.sendMessage(chatId, '❌ شناسه اینباند باید یک عدد صحیح باشد یا برای بازگردانی به آیدی عمومی عبارت 0 را ارسال کنید.');
            sendTestSettingsMenu(chatId);
            return;
          }
          db.updateState({ freeTestInboundId: parsedId });
          bot!.sendMessage(chatId, `✅ اینباند اختصاصی تست با موفقیت به شناسه \`${parsedId}\` تغییر یافت.`, { parse_mode: 'Markdown' });
        }
        sendTestSettingsMenu(chatId);
        return;
      }
      if (sessionType === 'set_support_id') {
        const username = text.trim().replace(/^@/, '');
        db.updateState({ supportUsername: username });
        bot!.sendMessage(chatId, `✅ آیدی پشتیبانی با موفقیت به *@${username}* ذخیره شد.`, { parse_mode: 'Markdown' });
        sendAdminMainMenu(chatId);
        return;
      }
      if (sessionType === 'add_coupon') {
        const parts = text.split(',');
        if (parts.length < 2) {
          bot!.sendMessage(chatId, '❌ فرمت اشتباه است. الگو: `کد,درصد,...`');
          sendCouponsMenu(chatId);
          return;
        }
        const code = parts[0].trim().toUpperCase();
        const percent = parseInt(parts[1].trim());
        if (isNaN(percent) || percent <= 0 || percent > 100) {
          bot!.sendMessage(chatId, '❌ درصد تخفیف باید عددی بین ۱ تا ۱۰۰ باشد.');
          sendCouponsMenu(chatId);
          return;
        }

        const maxUsage = parts[2] && parts[2].trim() ? parseInt(parts[2].trim()) : undefined;
        const maxUsagePerUser = parts[3] && parts[3].trim() ? parseInt(parts[3].trim()) : undefined;
        let expirationDate = undefined;
        if (parts[4] && parts[4].trim()) {
           const days = parseInt(parts[4].trim());
           if (!isNaN(days) && days > 0) {
              const d = new Date();
              d.setDate(d.getDate() + days);
              expirationDate = d.toISOString();
           }
        }

        const couponsList = state.coupons || [];
        const existing = couponsList.find((c: any) => c.code === code);
        
        let newCoupon = {
           code, 
           discountPercent: percent,
           maxUsage: !isNaN(maxUsage as any) ? maxUsage : undefined,
           maxUsagePerUser: !isNaN(maxUsagePerUser as any) ? maxUsagePerUser : undefined,
           expirationDate,
           usedCount: existing ? existing.usedCount : 0,
           usedBy: existing ? existing.usedBy : {}
        };

        if (existing) {
          Object.assign(existing, newCoupon);
        } else {
          couponsList.push(newCoupon);
        }
        db.updateState({ coupons: couponsList });
        bot!.sendMessage(chatId, `✅ کد تخفیف *${code}* با تخفیف %${percent} با موفقیت ثبت/بروزرسانی شد.`, { parse_mode: 'Markdown' });
        sendCouponsMenu(chatId);
        return;
      }
      if (sessionType === 'gift_draft_code') {
        const draft = giftCodeDrafts.get(chatId) || {};
        draft.code = text.trim().toUpperCase();
        giftCodeDrafts.set(chatId, draft);
        adminSession.delete(chatId);
        sendGiftCodeDraftMenu(chatId);
        return;
      }
      if (sessionType === 'gift_draft_amount') {
        const amt = parseInt(text.trim());
        if (isNaN(amt) || amt <= 0) {
          bot!.sendMessage(chatId, '❌ مبلغ وارد شده نامعتبر است. لطفاً یک عدد بزرگتر از ۰ وارد کنید.');
          return;
        }
        const draft = giftCodeDrafts.get(chatId) || {};
        draft.giftAmount = amt;
        giftCodeDrafts.set(chatId, draft);
        adminSession.delete(chatId);
        sendGiftCodeDraftMenu(chatId);
        return;
      }
      if (sessionType === 'gift_draft_max') {
        const max = parseInt(text.trim());
        if (isNaN(max) || max < 0) {
          bot!.sendMessage(chatId, '❌ مقدار وارد شده نامعتبر است. عدد مثبت یا ۰ برای نامحدود وارد کنید.');
          return;
        }
        const draft = giftCodeDrafts.get(chatId) || {};
        draft.maxUsage = max > 0 ? max : undefined;
        giftCodeDrafts.set(chatId, draft);
        adminSession.delete(chatId);
        sendGiftCodeDraftMenu(chatId);
        return;
      }
      if (sessionType === 'gift_draft_per_user') {
        const perUser = parseInt(text.trim());
        if (isNaN(perUser) || perUser <= 0) {
          bot!.sendMessage(chatId, '❌ مقدار وارد شده نامعتبر است. عدد بزرگتر از ۰ وارد کنید.');
          return;
        }
        const draft = giftCodeDrafts.get(chatId) || {};
        draft.maxUsagePerUser = perUser;
        giftCodeDrafts.set(chatId, draft);
        adminSession.delete(chatId);
        sendGiftCodeDraftMenu(chatId);
        return;
      }
      if (sessionType === 'gift_draft_exp') {
        const days = parseInt(text.trim());
        if (isNaN(days) || days < 0) {
          bot!.sendMessage(chatId, '❌ مقدار وارد شده نامعتبر است. عدد مثبت یا ۰ برای نامحدود وارد کنید.');
          return;
        }
        const draft = giftCodeDrafts.get(chatId) || {};
        draft.expirationDays = days > 0 ? days : undefined;
        giftCodeDrafts.set(chatId, draft);
        adminSession.delete(chatId);
        sendGiftCodeDraftMenu(chatId);
        return;
      }
      if (sessionType === 'admin_broadcast') {
        bot!.sendMessage(chatId, '⏳ در حال ارسال پیام همگانی به تمام اعضا...');
        try {
          const stats = await sendBroadcast(text);
          bot!.sendMessage(chatId, `✅ پیام همگانی با موفقیت برای تمامی کاربران ارسال شد.\n\nتعداد موفق: *${stats.successCount}*\nتعداد خطا: *${stats.failCount}*`, { parse_mode: 'Markdown' });
        } catch (err: any) {
          bot!.sendMessage(chatId, `❌ خطا در ارسال پیام همگانی: ${err.message}`);
        }
        sendAdminMainMenu(chatId);
        return;
      }
      if (sessionType === 'search_user') {
        const queryCleaned = text.trim()
          .replace(/[۰-۹]/g, d => String.fromCharCode(d.charCodeAt(0) - 1728))
          .replace(/[٠-٩]/g, d => String.fromCharCode(d.charCodeAt(0) - 1632));
        const queryStr = normalizePersianText(queryCleaned.replace(/^@/, ''));
        const matched = state.users.filter(u => {
          const uId = String(u.chatId);
          const uUsername = normalizePersianText(u.username || '');
          const uNickname = normalizePersianText(u.nickname || '');
          return uId.includes(queryStr) || uUsername.includes(queryStr) || uNickname.includes(queryStr);
        });

        if (matched.length === 0) {
          bot!.sendMessage(chatId, '❌ هیچ کاربری منطبق با جستجوی شما یافت نشد.');
        } else {
          bot!.sendMessage(chatId, `🔍 <b>نتایج جستجوی کاربر</b> (${matched.length} مورد یافت شد):`, { parse_mode: 'HTML' });
          matched.forEach((u, i) => {
            const role = u.isSeller ? 'همکار فروشنده' : 'کاربر عادی';
            const msgText = `👤 <b>کاربر ${i+1}:</b>\n` +
              `🆔 شناسه: <code>${u.chatId}</code>\n` +
              `💬 یوزرنیم: ${u.username ? '@' + u.username : 'ندارد'}\n` +
              `📝 نیک‌نیم: ${u.nickname || 'ثبت نشده'}\n` +
              `💰 موجودی: ${Math.floor(u.balance || 0).toLocaleString()} تومان\n` +
              `👥 زیرمجموعه‌ها: ${u.referralsMade || 0} نفر\n` +
              `⚡ نقش: <b>${role}</b>\n` +
              `📅 تاریخ عضویت: ${u.registeredAt ? new Date(u.registeredAt).toLocaleDateString('fa-IR') : 'نامشخص'}`;

            const inlineKeyboard = [
              [
                { text: '🟢 افزایش موجودی', callback_data: `add_bal_${u.chatId}` },
                { text: '🔴 کاهش موجودی', callback_data: `sub_bal_${u.chatId}` }
              ],
              [
                { text: '🔄 تغییر نقش', callback_data: `toggle_role_${u.chatId}` },
                { text: '🗑 حذف اکانت', callback_data: `del_user_${u.chatId}` }
              ],
              [
                { text: '💬 ارسال پیام مستقیم', callback_data: `send_msg_user_${u.chatId}` }
              ]
            ];
            bot!.sendMessage(chatId, msgText, { 
              parse_mode: 'HTML', 
              reply_markup: { inline_keyboard: inlineKeyboard }
            }).catch(e => console.error("Search failed: ", e.message));
          });
        }
        return;
      }
      if (sessionType === 'search_config') {
        const queryStr = text.trim().toLowerCase();
        let foundPurchases: any[] = [];
        state.users.forEach(u => {
          const purchases = u.purchases || [];
          purchases.forEach(p => {
            if (p.name.toLowerCase().includes(queryStr) || 
                p.subUrl.toLowerCase().includes(queryStr) || 
                p.id.toLowerCase().includes(queryStr)) {
              foundPurchases.push({ ...p, userChatId: u.chatId, userUsername: u.username });
            }
          });
        });

        if (foundPurchases.length === 0) {
          bot!.sendMessage(chatId, '❌ هیچ کانفیگ خریداری شده‌ای با این نام یا لینک در بانک اطلاعاتی منطبق نبود. در حال واکشی زنده پنل...');
          try {
            const inbounds = await xui.getInbounds();
            const liveMatches: string[] = [];
            for (const inbound of inbounds) {
              let settingsObj: any = {};
              try {
                settingsObj = JSON.parse(inbound.settings);
              } catch (e) {}
              const clients = settingsObj.clients || [];
              clients.forEach((c: any) => {
                if ((c.email && c.email.toLowerCase().includes(queryStr)) || 
                    (c.id && c.id.toLowerCase().includes(queryStr))) {
                  liveMatches.push(`📦 اینباند: \`${inbound.remark}\` (${inbound.port})\n📧 کلاینت: \`${c.email}\`\n🆔 شناسه کلاینت: \`${c.id}\``);
                }
              });
            }
            if (liveMatches.length > 0) {
              bot!.sendMessage(chatId, `🔍 *نتایج زنده از پنل X-UI*:\n\n${liveMatches.join('\n\n')}`, { parse_mode: 'Markdown' });
            } else {
              bot!.sendMessage(chatId, '❌ هیچ نتیجه زنده یا ثبتی یافت نشد.');
            }
          } catch (e: any) {
            bot!.sendMessage(chatId, `❌ خطا در واکشی زنده پنل: ${e.message}`);
          }
        } else {
          let reply = `🔍 *نتایج جستجوی کانفیگ* (${foundPurchases.length} یافت شد):\n\n`;
          foundPurchases.forEach((p, i) => {
            reply += `💎 کانفیگ ${i+1}:\n` +
              `📦 پکیج: *${p.name}*\n` +
              `👤 خریدار: \`${p.userChatId}\` ${p.userUsername ? '(@' + p.userUsername + ')' : ''}\n` +
              `📅 تاریخ خرید: ${new Date(p.createdAt).toLocaleDateString('fa-IR')}\n` +
              `📦 حجم: ${p.volumeGb} GB\n` +
              `⏳ اعتبار: ${p.durationDays} روز\n` +
              `🔗 لینک اشتراک:\n\`${p.subUrl}\`\n` +
              `----------------------------------\n`;
          });
          bot!.sendMessage(chatId, reply, { parse_mode: 'Markdown' });
        }
        sendUsersMenu(chatId);
        return;
      }
      if (sessionType === 'set_t_volume') {
        const val = parseFloat(text.trim());
        if (isNaN(val)) {
          bot!.sendMessage(chatId, '❌ مقدار حجم وارد شده معتبر نمی‌باشد.');
          sendTestSettingsMenu(chatId);
          return;
        }
        db.updateState({ freeTestVolumeGb: val });
        bot!.sendMessage(chatId, `✅ حجم اکانت تست رایگان به \`${val} گیگابایت\` تغییر یافت.`, { parse_mode: 'Markdown' });
        sendTestSettingsMenu(chatId);
        return;
      }
      if (sessionType === 'set_t_days') {
        const val = parseInt(text.trim());
        if (isNaN(val)) {
          bot!.sendMessage(chatId, '❌ مقدار زمان وارد شده معتبر نمی‌باشد.');
          sendTestSettingsMenu(chatId);
          return;
        }
        db.updateState({ freeTestDurationDays: val });
        bot!.sendMessage(chatId, `✅ زمان اکانت تست رایگان به \`${val} روز\` تغییر یافت.`, { parse_mode: 'Markdown' });
        sendTestSettingsMenu(chatId);
        return;
      }
      if (sessionType === 'set_reward_toman') {
        const val = parseInt(text.trim());
        if (isNaN(val)) {
          bot!.sendMessage(chatId, '❌ پاداش وارد شده معتبر نمی‌باشد.');
          sendTestSettingsMenu(chatId);
          return;
        }
        db.updateState({ referralRewardToman: val });
        bot!.sendMessage(chatId, `✅ پاداش معرفی با موفقیت به \`${val} تومان\` تغییر یافت.`, { parse_mode: 'Markdown' });
        sendTestSettingsMenu(chatId);
        return;
      }
      if (sessionType === 'add_prod') {
        const parts = text.split(',');
        if (parts.length < 4) {
          bot!.sendMessage(chatId, '❌ فرمت وارد شده اشتباه است. دوباره دکمه افزودن را بزنید و طبق الگو بفرستید.');
          sendProductsMenu(chatId);
          return;
        }
        const name = parts[0].trim();
        const price = parseInt(parts[1].trim());
        const volumeGb = parseFloat(parts[2].trim());
        const durationDays = parseInt(parts[3].trim());
        const inboundId = parts.length >= 5 ? (parseInt(parts[4].trim()) || undefined) : undefined;

        if (isNaN(price) || isNaN(volumeGb) || isNaN(durationDays)) {
          bot!.sendMessage(chatId, '❌ مقادیر عددی پکیج نامعتبر است.');
          sendProductsMenu(chatId);
          return;
        }

        const newId = `p_${Date.now()}`;
        state.products.push({ id: newId, name, price, volumeGb, durationDays, inboundId });
        db.updateState({ products: state.products });
        
        bot!.sendMessage(chatId, `✅ محصول جدید *${name}* با موفقیت تعریف شد.`, { parse_mode: 'Markdown' });
        sendProductsMenu(chatId);
        return;
      }
      if (sessionType.startsWith('send_direct_message_to_')) {
        const targetIdStr = sessionType.replace('send_direct_message_to_', '');
        const targetId = parseInt(targetIdStr);
        adminSession.delete(chatId);

        if (isNaN(targetId)) {
          bot!.sendMessage(chatId, '❌ شناسه کاربر نامعتبر است.');
          return;
        }

        const targetUser = db.getUser(targetId);
        if (!targetUser) {
          bot!.sendMessage(chatId, '❌ کاربر مورد نظر یافت نشد.');
          return;
        }

        const adminMessage = `🔔 <b>پیام جدید از مدیریت:</b>\n\n${text}`;
        bot!.sendMessage(targetId, adminMessage, { parse_mode: 'HTML' })
          .then(() => {
            bot!.sendMessage(chatId, `✅ پیام شما با موفقیت برای کاربر <code>${targetId}</code> ارسال شد.`, { parse_mode: 'HTML' });
          })
          .catch((e: any) => {
            bot!.sendMessage(chatId, `❌ خطا در ارسال پیام به کاربر: ${e.message}`);
          });
        return;
      }
      if (sessionType.startsWith('charge_direct_')) {
        const targetUid = parseInt(sessionType.replace('charge_direct_', ''));
        const amount = parseInt(text.trim());
        if (isNaN(amount) || amount <= 0) {
           bot!.sendMessage(chatId, '❌ مبلغ نامعتبر است. عملیات لغو شد.');
        } else {
           const targetUser = db.getUser(targetUid);
           if (targetUser) {
              if (targetUser.isSeller) {
                targetUser.totalPayments = (targetUser.totalPayments || 0) + amount;
                targetUser.debt = Math.max(0, (targetUser.debt || 0) - amount);
                applyPaygSettlementToUser(targetUser, amount, targetUser.debt === 0);
                db.saveUser(targetUser);
                checkPaygReactivation(targetUser).catch(console.error);
                bot!.sendMessage(chatId, `✅ مبلغ *${amount.toLocaleString()}* تومان به عنوان واریزی/پرداخت بدهی همکار با موفقیت ثبت شد.\n\n📉 بدهی باقیمانده فعلی: *${(targetUser.debt || 0).toLocaleString()}* تومان\n💳 مجموع کل پرداخت‌ها: *${(targetUser.totalPayments || 0).toLocaleString()}* تومان`, { parse_mode: 'Markdown' });

                const sellerChargeMsg = `🎉 <b>مبلغ ${amount.toLocaleString()} تومان توسط مدیریت به حساب پرداخت‌های شما منظور شد.</b>\n\n` +
                  `▫️ کل واریزی‌ها و تسویه‌ها: <b>${(targetUser.totalPayments || 0).toLocaleString()}</b> تومان\n` +
                  `▫️ بدهی باقیمانده شما به مدیریت: <b>${(targetUser.debt || 0).toLocaleString()}</b> تومان`;
                bot!.sendMessage(targetUid, sellerChargeMsg, { parse_mode: 'HTML' }).catch(() => {});
              } else {
                targetUser.balance = (targetUser.balance || 0) + amount;
                db.saveUser(targetUser);
                checkPaygReactivation(targetUser).catch(console.error);
                bot!.sendMessage(chatId, `✅ موجودی کاربر با موفقیت مبلغ ${amount.toLocaleString()} تومان افزایش یافت.`);

                const manualChargeMsg = `🎉 <b>حساب کاربری شما توسط مدیریت مبلغ ${amount.toLocaleString()} تومان شارژ شد!</b>\n\n` +
                  `💰 موجودی جدید حساب شما: <b>${targetUser.balance.toLocaleString()}</b> تومان\n\n` +
                  `🛒 <b>هم‌اکنون با زدن دکمه زیر می‌توانید محصول یا سرویس مورد نظر خود را خریداری کنید:</b>`;
                bot!.sendMessage(targetUid, manualChargeMsg, { 
                  parse_mode: 'HTML',
                  reply_markup: {
                    inline_keyboard: [
                      [{ text: '🛍 خرید و ثبت سفارش', callback_data: 'buy_service_now' }]
                    ]
                  }
                }).catch(() => {});
              }
           }
        }
        adminSession.delete(chatId);
        return;
      }

      if (sessionType.startsWith('sub_direct_')) {
        const targetUid = parseInt(sessionType.replace('sub_direct_', ''));
        const amount = parseInt(text.trim());
        if (isNaN(amount) || amount <= 0) {
           bot!.sendMessage(chatId, '❌ مبلغ نامعتبر است. عملیات لغو شد.');
        } else {
           const targetUser = db.getUser(targetUid);
           if (targetUser) {
              if (targetUser.isSeller) {
                targetUser.totalPayments = Math.max(0, (targetUser.totalPayments || 0) - amount);
                targetUser.debt = (targetUser.debt || 0) + amount;
                db.saveUser(targetUser);
                bot!.sendMessage(chatId, `✅ مبلغ ${amount.toLocaleString()} تومان از پرداختی‌های همکار کسر شد.\nبدهی جدید: ${(targetUser.debt || 0).toLocaleString()} تومان\nمجموع پرداختی‌ها: ${(targetUser.totalPayments || 0).toLocaleString()} تومان`);
              } else {
                targetUser.balance = (targetUser.balance || 0) - amount;
                db.saveUser(targetUser);
                bot!.sendMessage(chatId, `✅ موجودی کاربر با موفقیت مبلغ ${amount.toLocaleString()} تومان کاهش یافت.`);
              }
           }
        }
        adminSession.delete(chatId);
        return;
      }

      if (sessionType.startsWith('set_seller_limit_')) {
        const targetUid = parseInt(sessionType.replace('set_seller_limit_', ''));
        const inputStr = text.trim();
        const targetUser = db.getUser(targetUid);
        if (!targetUser) {
          bot!.sendMessage(chatId, '❌ همکار یافت نشد.');
        } else {
          const parsed = parseAmountInput(inputStr);
          if (parsed === null || parsed < 0) {
            bot!.sendMessage(
              chatId,
              '❌ مبلغ یا عبارت وارد شده نامعتبر است.\n\nشما می‌توانید مبلغ را به تومان ارسال کنید (مثلاً `4000000` یا `۴ میلیون` یا `4 ملیون`) یا برای سقف نامحدود عدد `0` یا کلمه «آزاد» را ارسال نمایید.',
              { parse_mode: 'Markdown' }
            );
          } else if (parsed === 0) {
            targetUser.isUnlimitedLimit = true;
            targetUser.debtLimit = 0;
            db.saveUser(targetUser);
            await syncAllUsersAndSellersFinancials();
            const updated = db.getUser(targetUid) || targetUser;
            await checkPaygReactivation(updated);
            bot!.sendMessage(chatId, `✅ سقف اعتبار همکار 👤 ${updated.username ? '@' + updated.username : updated.chatId} به صورت «سقف آزاد (نامحدود)» تنظیم گردید.`);
            bot!.sendMessage(updated.chatId, `📢 سقف اعتبار حساب کاربری شما توسط مدیریت به صورت آزاد (نامحدود) تنظیم گردید.`).catch(() => {});
            await sendDetailedSellerReport(chatId, targetUid, true);
          } else {
            targetUser.isUnlimitedLimit = false;
            targetUser.debtLimit = parsed;
            db.saveUser(targetUser);
            await syncAllUsersAndSellersFinancials();
            const updated = db.getUser(targetUid) || targetUser;
            await checkPaygReactivation(updated);

            const curDebt = updated.debt || 0;
            const remaining = Math.max(0, parsed - curDebt);
            let extraNote = '';
            if (remaining === 0 && curDebt >= parsed) {
              extraNote = `\n\n⚠️ *توجه*: بدهی فعلی همکار (*${curDebt.toLocaleString()}* تومان) به اندازه سقف تعیین شده یا بیشتر از آن است؛ لذا اعتبار باقیمانده فعلاً ۰ تومان است. در صورت تمایل می‌توانید سقف را بالاتر ببرید یا از گزینه «تسویه حساب» برای صفر کردن بدهی قبلی استفاده فرمایید.`;
            } else {
              extraNote = `\n▫️ اعتبار قابل خرید باقیمانده: *${remaining.toLocaleString()}* تومان`;
            }

            bot!.sendMessage(chatId, `✅ سقف اعتبار همکار 👤 ${updated.username ? '@' + updated.username : updated.chatId} با موفقیت به *${parsed.toLocaleString()}* تومان تغییر یافت.${extraNote}`, { parse_mode: 'Markdown' });
            bot!.sendMessage(updated.chatId, `📢 سقف اعتبار مجاز شما توسط مدیریت به *${parsed.toLocaleString()}* تومان بروزرسانی شد.`, { parse_mode: 'Markdown' }).catch(() => {});
            await sendDetailedSellerReport(chatId, targetUid, true);
          }
        }
        adminSession.delete(chatId);
        return;
      }

      if (sessionType === 'charge_user_bot') {
        const parts = text.trim().split(/\s+/);
        if (parts.length < 2) {
          bot!.sendMessage(chatId, '❌ فرمت وارد شده اشتباه است. لطفا شناسه کاربری/یوزرنیم و مبلغ را با فاصله بفرستید.');
          sendUsersMenu(chatId);
          return;
        }
        
        const queryTarget = parts[0];
        const amount = parseInt(parts[1]);
        
        if (isNaN(amount)) {
          bot!.sendMessage(chatId, '❌ مبلغ وارد شده معتبر نمی‌باشد.');
          sendUsersMenu(chatId);
          return;
        }

        let targetUser;
        if (/^\d+$/.test(queryTarget)) {
            targetUser = db.getUser(parseInt(queryTarget));
        } else {
            targetUser = db.getUserByUsername(queryTarget);
        }

        if (!targetUser) {
          bot!.sendMessage(chatId, '❌ کاربر مورد نظر یافت نشد.');
          sendUsersMenu(chatId);
          return;
        }

        if (targetUser.isSeller) {
          targetUser.totalPayments = (targetUser.totalPayments || 0) + amount;
          targetUser.debt = Math.max(0, (targetUser.debt || 0) - amount);
          applyPaygSettlementToUser(targetUser, amount, targetUser.debt === 0);
          db.saveUser(targetUser);
          checkPaygReactivation(targetUser).catch(console.error);
          bot!.sendMessage(chatId, `✅ مبلغ *${amount.toLocaleString()}* تومان به حساب پرداختی همکار 👤 ${targetUser.username ? '@' + targetUser.username : targetUser.chatId} منظور شد.\nبدهی باقیمانده: *${(targetUser.debt || 0).toLocaleString()}* تومان\nمجموع کل پرداخت‌ها: *${(targetUser.totalPayments || 0).toLocaleString()}* تومان`, { parse_mode: 'Markdown' });
          
          const sellerChargeMsg = `🎉 <b>مبلغ ${amount.toLocaleString()} تومان توسط مدیریت به حساب پرداختی شما منظور شد.</b>\n\nبدهی باقیمانده: <b>${(targetUser.debt || 0).toLocaleString()}</b> تومان`;
          bot!.sendMessage(targetUser.chatId, sellerChargeMsg, { parse_mode: 'HTML' }).catch(() => {});
        } else {
          targetUser.balance = (targetUser.balance || 0) + amount;
          db.saveUser(targetUser);
          checkPaygReactivation(targetUser).catch(console.error);
          bot!.sendMessage(chatId, `✅ حساب کاربر 👤 ${targetUser.username ? '@' + targetUser.username : targetUser.chatId} به مقدار *${amount.toLocaleString()}* تومان شارژ دسترسی یافت.`, { parse_mode: 'Markdown' });
          
          const chargeNotifyMsg = `🎉 <b>حساب کاربری شما توسط مدیریت مبلغ ${amount.toLocaleString()} تومان شارژ شد!</b>\n\n` +
            `💰 موجودی جدید حساب شما: <b>${targetUser.balance.toLocaleString()}</b> تومان\n\n` +
            `🛒 <b>هم‌اکنون با زدن دکمه زیر می‌توانید محصول یا سرویس مورد نظر خود را خریداری کنید:</b>`;
          bot!.sendMessage(targetUser.chatId, chargeNotifyMsg, { 
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [{ text: '🛍 خرید و ثبت سفارش', callback_data: 'buy_service_now' }]
              ]
            }
          }).catch(() => {});
        }

        sendUsersMenu(chatId);
        return;
      }
      if (sessionType === 'change_role_bot') {
        const parts = text.trim().split(/\s+/);
        const queryTarget = parts[0];
        const newNickname = parts.slice(1).join(' ').trim();
        
        let targetUser;
        if (/^\d+$/.test(queryTarget)) {
            targetUser = db.getUser(parseInt(queryTarget));
        } else {
            targetUser = db.getUserByUsername(queryTarget);
        }

        if (!targetUser) {
          bot!.sendMessage(chatId, '❌ کاربر مورد نظر یافت نشد. دقت کنید اگر از یوزرنیم استفاده می‌کنید، باید کاربر قبلاً حداقل یک‌بار ربات را Start کرده باشد تا شناسایی شود.');
          sendUsersMenu(chatId);
          return;
        }

        targetUser.isSeller = !targetUser.isSeller;
        if (targetUser.isSeller) {
          targetUser.debt = targetUser.debt || 0;
          targetUser.totalSales = targetUser.totalSales || 0;
          if (newNickname) {
            targetUser.nickname = newNickname;
          }
        }
        db.saveUser(targetUser);
        
        if (targetUser.isSeller && !newNickname) {
           adminSession.set(chatId, `set_nickname_${targetUser.chatId}`);
           bot!.sendMessage(chatId, `✅ کاربر 👤 ${targetUser.username ? '@' + targetUser.username : targetUser.chatId} به عنوان *همکار فروشنده* تعیین شد.\n\n📝 **حالا لطفاً فرمت نام گروه/نیک‌نیم این فروشنده را ارسال کنید:**\n\n_(این نام هنگام ساخت کانفیگ به ابتدای اسم‌ها اضافه می‌شود)_\nبرای رد کردن و استفاده از پیش‌فرض، کلمه \`رد\` را بفرستید.`, { parse_mode: 'Markdown' });
        } else {
           bot!.sendMessage(chatId, `✅ وضعیت فروشندگی کاربر 👤 ${targetUser.username ? '@' + targetUser.username : targetUser.chatId} به *${targetUser.isSeller ? 'همکار فروشنده' : 'کاربر عادی'}* تغییر یافت.${targetUser.isSeller && targetUser.nickname ? `\n🏷 نیک‌نیم (نام گروه در سرور): ${targetUser.nickname}` : ''}`, { parse_mode: 'Markdown' });
           sendUsersMenu(chatId);
        }
        bot!.sendMessage(targetUser.chatId, `✨ وضعیت کاربری شما تغییر کرد: نقش شما به *${targetUser.isSeller ? 'همکار فروشنده' : 'کاربر عادی'}* تغییر یافته است.`, { parse_mode: 'Markdown' }).catch(() => {});
        return;
      }
      
      if (sessionType.startsWith('set_nickname_')) {
         const targetId = parseInt(sessionType.replace('set_nickname_', ''));
         const targetUser = db.getUser(targetId);
         if (targetUser && targetUser.isSeller) {
            if (text.trim().toLowerCase() !== 'skip' && text.trim() !== 'رد') {
               targetUser.nickname = text.trim();
               db.saveUser(targetUser);
               bot!.sendMessage(chatId, `✅ نیک‌نیم اعمال شد: ${targetUser.nickname}`);
            } else {
               bot!.sendMessage(chatId, `✅ نیک‌نیم تنظیم نشد (از پیش‌فرض استفاده می‌شود).`);
            }
         }
         sendUsersMenu(chatId);
         return;
      }
      if (sessionType === 'settle_user_bot') {
        const queryTarget = text.trim();
        let targetUser;

        if (/^\d+$/.test(queryTarget)) {
            targetUser = db.getUser(parseInt(queryTarget));
        } else {
            targetUser = db.getUserByUsername(queryTarget);
        }

        if (!targetUser) {
          bot!.sendMessage(chatId, '❌ همکار فروشنده یافت نشد.');
          sendUsersMenu(chatId);
          return;
        }
        const settledAmount = targetUser.debt || 0;
        targetUser.totalPayments = (targetUser.totalPayments || 0) + settledAmount;
        targetUser.debt = 0;
        applyPaygSettlementToUser(targetUser, settledAmount, true);
        db.saveUser(targetUser);
        bot!.sendMessage(chatId, `✅ بدهی همکار 👤 ${targetUser.username ? '@' + targetUser.username : targetUser.chatId} با موفقیت صفر شد (تسویه حساب کامل).`);
        bot!.sendMessage(targetUser.chatId, '💵 حساب بدهی شما توسط مدیریت تسویه شد و به صفر بازگشت.').catch(() => {});
        sendUsersMenu(chatId);
        return;
      }

      if (sessionType === 'set_auto_backup_interval') {
        const interval = parseInt(text.trim());
        if (isNaN(interval) || interval < 0 || interval > 24) {
          bot!.sendMessage(chatId, '❌ مقدار وارد شده نامعتبر است. لطفاً یک عدد بین 0 تا 24 وارد کنید.');
          sendAdminMainMenu(chatId);
        } else {
          db.updateState({ autoBackupIntervalHours: interval, lastAutoBackupSent: 0 }); // reset counter so it evaluates fresh
          if (interval > 0) {
            adminSession.set(chatId, 'set_auto_backup_password');
            bot!.sendMessage(chatId, `✅ زمان‌بندی پشتیبان‌گیری خودکار موفقیت‌آمیز بود (فاصله هر ${interval} ساعت).\n\n🔑 لطفاً یک رمز عبور جهت رمزگذاری فایل‌های بکاپ خودکار ارسال کنید:\n\n*(چنانچه مایلید بکاپ بدون رمز باشد عدد 0 را بفرستید)*`, { parse_mode: 'Markdown' });
          } else {
            bot!.sendMessage(chatId, `✅ پشتیبان‌گیری خودکار غیرفعال گردید.`);
            sendAdminMainMenu(chatId);
          }
        }
        return;
      }

      if (sessionType === 'set_auto_backup_password') {
        const pass = text.trim();
        if (pass === '0') {
           db.updateState({ autoBackupPassword: '' });
           bot!.sendMessage(chatId, `✅ بکاپ خودکار بدون رمز ذخیره خواهد شد.`);
        } else {
           db.updateState({ autoBackupPassword: pass });
           bot!.sendMessage(chatId, `✅ رمز بکاپ خودکار با موفقیت تنظیم شد.`);
        }
        sendAdminMainMenu(chatId);
        return;
      }

      if (sessionType === 'get_backup_password') {
        const backupPassword = text.trim();
        bot!.sendMessage(chatId, '⏳ در حال ساخت فایل پشتیبان رمزگذاری شده...');
        try {
          const rawData = fs.readFileSync(path.join(process.cwd(), 'db.json'), 'utf8');
          const encryptedPayload = encryptData(rawData, backupPassword);
          const backupFileName = `sanaei_backup_${Date.now()}.json`;
          const backupPath = path.join(process.cwd(), backupFileName);
          
          fs.writeFileSync(backupPath, encryptedPayload, 'utf8');
          
          await bot!.sendDocument(chatId, backupPath, {
            caption: `📥 فایل بکاپ رمزگذاری شده با موفقیت تولید شد.\n\n🔑 رمز فایل بکاپ شما: *${backupPassword}*\n\n⚠️ حتما این فایل و رمز را در جایی مطمئن یادداشت و نگهداری کنید. جهت بازیابی اطلاعات، کافیست همین فایل .json را به ربات ارسال فرمایید.`,
            parse_mode: 'Markdown'
          });
          
          try {
            fs.unlinkSync(backupPath);
          } catch (e) {}
        } catch (err: any) {
          bot!.sendMessage(chatId, `❌ خطا در ایجاد فایل پشتیبان: ${err.message}`);
        }
        return;
      }

      if (sessionType && sessionType.startsWith('restore_pass_')) {
        const fileId = sessionType.replace('restore_pass_', '');
        const backupPassword = text.trim();
        bot!.sendMessage(chatId, '⏳ در حال دریافت و بازیابی فایل پشتیبان...');
        try {
          const file = await bot!.getFile(fileId);
          const dUrl = `https://api.telegram.org/file/bot${state.botToken}/${file.file_path}`;
          const res = await axios.get(dUrl);
          
          let fileData = res.data;
          if (typeof fileData === 'object') {
            fileData = JSON.stringify(fileData);
          }
          
          const result = restoreAnyBackup(fileData, backupPassword);
          if (!result.success) {
            bot!.sendMessage(chatId, `❌ خطا در بازیابی فایل: ${result.message}\n\nلطفاً مجدداً رمز صحیح را وارد کنید یا فایل سالم دیگری ارسال فرمایید.`);
            return;
          }

          adminSession.delete(chatId);
          bot!.sendMessage(chatId, `✅ بازیابی کامل اطلاعات با موفقیت انجام شد! 🎉\n\n${result.message}\n\n📊 آمار اطلاعات بازیابی‌شده:\n👥 کاربران: ${result.stats?.usersCount || 0}\n📦 محصولات: ${result.stats?.productsCount || 0}\n📂 دسته‌بندی‌ها: ${result.stats?.categoriesCount || 0}`);
        } catch (err: any) {
          bot!.sendMessage(chatId, `❌ خطا در پردازش فایل پشتیبان: ${err.message}`);
        }
        return;
      }
    }

    if (!text || text.startsWith('/start') || text === '/admin') return;

    // Helper to strip any emojis from the message for robust Persian matching
    const cleanText = text.replace(/[\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD00-\uDFFF]/g, '').trim();

    if (cleanText === 'تست رایگان' || cleanText === 'اکانت تست' || text.includes('تست رایگان')) {
      const user = db.getUser(chatId);
      if (!user) return;
      if (user.testUsed) {
        bot!.sendMessage(chatId, '❌ شما قبلا از تست رایگان خود استفاده کرده‌اید.');
        return;
      }

      bot!.sendMessage(chatId, '⏳ در حال ساخت اکانت تست شما...');
      try {
        const state = db.getState();
        const testInboundIds = (state.freeTestInboundIds && state.freeTestInboundIds.length > 0)
          ? state.freeTestInboundIds
          : (state.freeTestInboundId ? [state.freeTestInboundId] : undefined);

        const volGb = state.freeTestVolumeGb !== undefined ? Number(state.freeTestVolumeGb) : 0;
        const durDays = state.freeTestDurationDays !== undefined ? Number(state.freeTestDurationDays) : 0;

        const cleanUsername = user.username ? user.username.trim().replace(/[^a-zA-Z0-9_]/g, '') : '';
        const emailPrefix = cleanUsername || String(chatId);
        const uniqueSuffix = Date.now().toString().slice(-4);
        const clientEmail = `${emailPrefix}_test_${uniqueSuffix}`;

        const client = await xui.addClient(clientEmail, volGb, durDays, testInboundIds, 1, String(chatId));
        
        user.testUsed = true;

        // Save purchase record for free test
        const testPurchase = {
          id: `test_${Date.now()}`,
          name: `تست رایگان (${volGb}GB - ${durDays} روز)`,
          price: 0,
          subUrl: client.subUrl,
          volumeGb: volGb,
          durationDays: durDays,
          panelType: client.panelType || 'xui',
          createdAt: new Date().toISOString()
        };
        user.purchases = user.purchases || [];
        user.purchases.push(testPurchase);

        db.saveUser(user);

        bot!.sendMessage(chatId, `✅ اکانت تست با موفقیت ساخته شد!\n\nحجم: ${volGb}GB\nزمان: ${durDays} روز`, { parse_mode: 'Markdown' });
        await sendServiceInfo(chatId, testPurchase);
      } catch (err: any) {
        bot!.sendMessage(chatId, `❌ خطا در ساخت اکانت: ${err.message}`);
      }
      return;
    }

    if (cleanText === 'پروفایل و موجودی' || cleanText === 'پروفایل' || text.includes('پروفایل') || text.includes('موجودی')) {
      const user = db.getUser(chatId);
      if (!user) return;
      bot!.sendMessage(chatId, `👤 کاربر: ${msg.from?.first_name || 'ناشناس'}\n🆔 آیدی: \`${chatId}\`\n💰 موجودی: ${(user.balance || 0).toLocaleString()} تومان\n👥 تعداد زیرمجموعه‌ها: ${user.referralsMade || 0}`, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '💳 شارژ حساب (کارت به کارت)', callback_data: 'user_deposit_flow' }],
            [{ text: '🎁 ثبت کد هدیه', callback_data: 'enter_gift_code' }]
          ] as any
        }
      });
      return;
    }

    if (cleanText === 'شارژ حساب' || cleanText === 'افزایش موجودی' || cleanText === 'شارژ' || text.includes('شارژ') || text.includes('واریز')) {
      userSession.set(chatId, { action: 'payment_awaiting_amount' });
      bot!.sendMessage(chatId, '💰 *شارژ حساب (کارت به کارت)*\n\nلطفاً مبلغ مد نظر جهت شارژ حساب خود را به *تومان* و به صورت عددی ارسال کنید:\n\nمثال: `50000` یا `120000`', { parse_mode: 'Markdown' });
      return;
    }

    if (cleanText === 'پنل همکار (فروشنده)' || cleanText === 'پنل همکار') {
      const user = db.getUser(chatId);
      if (!user || !user.isSeller) return;
      
      const textResponse = `📊 *به پنل اختصاصی همکار خوش آمدید*\n\n` +
        `جهت ثبت فروش و مشاهده وضعیت اعتبار و بدهی‌های خود، از منوی زیر استفاده کنید:\n\n` +
        `💰 مجموع کل فروش شما: *${(user.totalSales || 0).toLocaleString()}* تومان\n` +
        `📉 میزان بدهی فعلی: *${(user.debt || 0).toLocaleString()}* تومان`;
        
      bot!.sendMessage(chatId, textResponse, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '📊 گزارش دقیق فروش و مصرف', callback_data: 'seller_detailed_report' }]
          ]
        } as any
      });
      bot!.sendMessage(chatId, '📱 منوی دکمه‌های همکار برای شما فعال شد:', {
        reply_markup: getSellerReplyKeyboard() as any
      }).catch(() => {});
      return;
    }

    if (cleanText === '📉 بدهی و سقف اعتبار همکار' || cleanText === '📉 وضعیت بدهی و اعتبار همکار' || text.includes('وضعیت بدهی و اعتبار') || text.includes('بدهی و سقف')) {
      const user = db.getUser(chatId);
      if (!user || !user.isSeller) return;
      
      const isUnlimited = isSellerUnlimitedLimit(user);
      const limit = user.debtLimit !== undefined && user.debtLimit > 0 ? user.debtLimit : 1000000;
      const debtVal = user.debt || 0;
      const remains = isUnlimited ? null : Math.max(0, limit - debtVal);
      const volumeDebt = user.debtVolume || 0;
      const limitStr = isUnlimited ? '*سقف آزاد (نامحدود)*' : `*${limit.toLocaleString()}* تومان`;
      const remainsStr = isUnlimited ? '*نامحدود (سقف آزاد)*' : `*${(remains || 0).toLocaleString()}* تومان`;
      
      const msgText = `📉 *وضعیت بدهی و اعتبار همکار*:\n\n` +
        `👤 همکار: ${user.username ? `@${user.username}` : `شناسه ${chatId}`}\n` +
        `💰 مجموع کل فروش شما: *${(user.totalSales || 0).toLocaleString()}* تومان\n` +
        `📉 بدهی مالی فعلی شما: *${debtVal.toLocaleString()}* تومان\n` +
        `📦 حجم بدهی فعال شما: *${volumeDebt.toLocaleString()}* GB\n` +
        `💳 سقف بدهی مجاز شما: ${limitStr}\n` +
        `✅ اعتبار خرید باقیمانده: ${remainsStr}\n\n` +
        (isUnlimited ? `✨ شما دارای سقف اعتبار آزاد هستید و هیچ محدودیتی در ثبت سفارش ندارید.` : `🚨 خرید شما در صورتی که بدهی از سقف مجاز بیشتر شود به صورت هوشمند مسدود خواهد شد.`);
        
      bot!.sendMessage(chatId, msgText, { parse_mode: 'Markdown' });
      return;
    }

    if (cleanText === '🛒 خرید سرویس همکار' || text.includes('خرید سرویس همکار')) {
      const user = db.getUser(chatId);
      if (!user || !user.isSeller) return;
      
      const stateObj = db.getState();
      const activeProducts = stateObj.products.filter(p => !p.disabled);
      if (activeProducts.length === 0) {
        bot!.sendMessage(chatId, '❌ هیچ محصولی موجود نیست.');
        return;
      }

      // Check if they exceed debt limit
      if (!isSellerUnlimitedLimit(user)) {
        const currentDebt = user.debt || 0;
        const limit = user.debtLimit !== undefined && user.debtLimit > 0 ? user.debtLimit : 1000000;
        if (currentDebt >= limit) {
          bot!.sendMessage(chatId, `❌ خطا: سقف بدهی مجاز شما به پایان رسیده است و خرید مسدود است!\n\nبدهی شما: ${currentDebt.toLocaleString()} تومان\nسقف مجاز: ${limit.toLocaleString()} تومان\n\nلطفا جهت تسویه با مدیریت در ارتباط باشید.`);
          return;
        }
      }

      const activeCategories = (stateObj.categories || []).filter(c => !c.disabled);

      if (activeCategories.length > 0) {
        const inlineKeyboard = activeCategories.map(c => ([
          { text: `📁 ${c.name}`, callback_data: `show_category_seller_${c.id}`, style: 'primary' }
        ]));
        if (activeProducts.some(p => isUncategorizedProduct(p, activeCategories))) {
          inlineKeyboard.push([{ text: `📁 سایر محصولات`, callback_data: `show_category_seller_uncategorized`, style: 'primary' }]);
        }
        bot!.sendMessage(chatId, '🛒 <b>خرید سرویس ویژه همکاران</b>\nلطفاً دسته‌بندی محصول را انتخاب کنید:', {
           parse_mode: 'HTML',
           reply_markup: {
             inline_keyboard: inlineKeyboard
           } as any
        });
        return;
      }

      const inlineKeyboard = activeProducts.map(p => ([
        { text: getProductButtonText(user, p), callback_data: `buy_${p.id}`, style: 'primary' }
      ]));

      bot!.sendMessage(chatId, '🛒 <b>خرید سرویس ویژه همکاران</b>\nلطفاً یکی از پکیج‌های زیر را جهت ساخت اتوماتیک انتخاب کنید:', {
         parse_mode: 'HTML',
         reply_markup: {
           inline_keyboard: inlineKeyboard
         } as any
      });
      return;
    }

    if (cleanText === '📋 لیست فروش‌های من' || text.includes('لیست فروش')) {
      const userObj = db.getUser(chatId);
      if (!userObj || !userObj.isSeller) return;
      const userPurchases = (userObj.purchases || []).filter((p: any) => !p.isDeleted);
      if (userPurchases.length === 0) {
        bot!.sendMessage(chatId, '❌ شما هنوز هیچ فروش/خریدی ثبت نکرده‌اید.');
      } else {
        let msgReply = `📋 <b>لیست کل فروش‌ها و کانفیگ‌های ساخته شده توسط شما:</b>\n\n`;
        const inlineKeyboard: any[] = [];
        userPurchases.forEach((p: any, idx: number) => {
          const volStr = p.isPayAsYouGo ? 'نامحدود (PAYG)' : (p.volumeGb ? `${p.volumeGb} گیگابایت` : 'نامحدود');
          const durStr = p.isPayAsYouGo ? 'نامحدود' : (p.durationDays ? `${p.durationDays} روز` : 'نامحدود');
          msgReply += `💎 <b>${idx + 1}- سرویس: ${escapeHtml(p.name || 'کانفیگ')}</b>\n` +
            `▫️ شناسه: <code>${escapeHtml(String(p.id))}</code>\n` +
            `▫️ حجم: ${volStr} | مدت: ${durStr}\n` +
            `📅 تاریخ: ${new Date(p.createdAt).toLocaleDateString('fa-IR')}\n`;
          if (p.subUrl) {
            msgReply += `🔗 لینک ساب: <code>${escapeHtml(p.subUrl)}</code>\n`;
          }
          msgReply += `----------------------------------\n`;
          const btnData = String(p.id).length > 28 ? idx : p.id;
          inlineKeyboard.push([{ text: `🔍 استعلام حجم، زمان و QR Code (${idx + 1})`, callback_data: `resend_link_${btnData}` }]);
        });

        bot!.sendMessage(chatId, msgReply, {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: inlineKeyboard
          }
        });
      }
      return;
    }

    if (cleanText === '📊 گزارش دقیق فروش و مصرف' || text.includes('گزارش دقیق فروش و مصرف') || text.includes('گزارش دقیق عملکرد')) {
      const userObj = db.getUser(chatId);
      if (!userObj || !userObj.isSeller) return;
      await sendDetailedSellerReport(chatId, chatId, false);
      return;
    }

    if (cleanText === '🔙 بازگشت به منوی اصلی' || text.includes('بازگشت به منوی اصلی') || text === 'بازگشت') {
      const stateObj = db.getState();
      bot!.sendMessage(chatId, '🔙 به منوی اصلی بازگشتید.', {
        reply_markup: getUserReplyKeyboard(db.getUser(chatId), stateObj, stateObj.adminIds.includes(chatId))
      });
      return;
    }

    if (cleanText === 'زیرمجموعه‌گیری' || cleanText === 'زیرمجموعه' || text.includes('زیرمجموعه') || text.includes('دعوت')) {
      const me = await bot!.getMe();
      const refLink = `https://t.me/${me.username}?start=ref_${chatId}`;
      const state = db.getState();
      bot!.sendMessage(chatId, `🔗 لینک اختصاصی شما برای دعوت دوستان:\n\n${refLink}\n\n🎁 با دعوت هر دوست ${state.referralRewardToman || 0} تومان پاداش بگیرید!`);
      return;
    }

    if (cleanText === 'خرید سرویس' || cleanText === 'خرید اکانت' || text.includes('خرید سرویس')) {
      const stateObj = db.getState();
      const activeProducts = stateObj.products.filter(p => !p.disabled);
      if (activeProducts.length === 0) {
        bot!.sendMessage(chatId, '❌ هیچ محصولی موجود نیست.');
        return;
      }

      const activeCategories = (stateObj.categories || []).filter(c => !c.disabled);

      if (activeCategories.length > 0) {
        const inlineKeyboard = activeCategories.map(c => ([
          { text: `📁 ${c.name}`, callback_data: `show_category_${c.id}`, style: 'primary' }
        ]));
        if (activeProducts.some(p => isUncategorizedProduct(p, activeCategories))) {
          inlineKeyboard.push([{ text: `📁 سایر محصولات`, callback_data: `show_category_uncategorized`, style: 'primary' }]);
        }
        bot!.sendMessage(chatId, '🛍 <b>انتخاب دسته‌بندی</b>\nلطفاً دسته‌بندی محصول را انتخاب کنید:', {
           parse_mode: 'HTML',
           reply_markup: {
             inline_keyboard: inlineKeyboard
           } as any
        });
        return;
      }

      const userObj = db.getUser(chatId);
      const inlineKeyboard = activeProducts.map(p => ([
        { text: getProductButtonText(userObj, p), callback_data: `buy_${p.id}`, style: 'primary' }
      ]));

      bot!.sendMessage(chatId, '🛍 <b>انتخاب محصول</b>\nلطفاً یک محصول انتخاب کنید:', {
         parse_mode: 'HTML',
         reply_markup: {
           inline_keyboard: inlineKeyboard
         } as any
      });
      return;
    }

    if (cleanText === 'لیست خریدهای من' || cleanText === 'لیست خریدهای' || text.includes('لیست خرید')) {
      const userObj = db.getUser(chatId);
      if (!userObj) return;
      const userPurchases = (userObj.purchases || []).filter((p: any) => !p.isDeleted);
      if (userPurchases.length === 0) {
        bot!.sendMessage(chatId, '❌ شما هنوز هیچ خریدی در ربات ثبت نکرده‌اید.');
      } else {
        let msgReply = `📋 <b>لیست سرویس‌ها و خریدهای شما:</b>\n\n`;
        const inlineKeyboard: any[] = [];
        userPurchases.forEach((p: any, idx: number) => {
          const volStr = p.isPayAsYouGo ? 'نامحدود (PAYG)' : (p.volumeGb ? `${p.volumeGb} گیگابایت` : 'نامحدود');
          const durStr = p.isPayAsYouGo ? 'نامحدود' : (p.durationDays ? `${p.durationDays} روز` : 'نامحدود');
          msgReply += `💎 <b>${idx + 1}- سرویس: ${escapeHtml(p.name || 'کانفیگ')}</b>\n` +
            `▫️ شناسه: <code>${escapeHtml(String(p.id))}</code>\n` +
            `▫️ حجم: ${volStr} | مدت: ${durStr}\n` +
            `📅 تاریخ: ${new Date(p.createdAt).toLocaleDateString('fa-IR')}\n`;
          if (p.subUrl) {
            msgReply += `🔗 لینک ساب: <code>${escapeHtml(p.subUrl)}</code>\n`;
          }
          msgReply += `----------------------------------\n`;
          const btnData = String(p.id).length > 28 ? idx : p.id;
          inlineKeyboard.push([{ text: `🔍 استعلام حجم، زمان و QR Code (${idx + 1})`, callback_data: `resend_link_${btnData}` }]);
        });

        bot!.sendMessage(chatId, msgReply, {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: inlineKeyboard
          }
        });
      }
      return;
    }

    if ((cleanText === '🎛 پنل مدیریت' || text.includes('پنل مدیریت')) && isAdmin) {
      sendAdminMainMenu(chatId);
      return;
    }

    if (cleanText === 'پشتیبانی' || text.includes('پشتیبانی') || text.includes('ارتباط با ما')) {
      const stateObj = db.getState();
      const username = stateObj.supportUsername || (stateObj.users.filter(u => stateObj.adminIds.includes(u.chatId))[0]?.username);
      if (username) {
        bot!.sendMessage(chatId, `💬 جهت برقراری ارتباط با بخش پشتیبانی و ارسال پیام به ادمین، می‌توانید با آیدی زیر در ارتباط باشید:\n\n💬 آیدی پشتیبانی: *@${username}*`, {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '📞 ارتباط مستقیم تلگرام', url: `https://t.me/${username}` }]
            ]
          }
        });
      } else {
        bot!.sendMessage(chatId, '❌ متاسفانه آیدی پشتیبانی توسط مدیریت تنظیم نگردیده است. لطفاً متعاقباً تلاش بفرمایید.');
      }
      return;
    }

    // Restore Backup System if admin uploads the json document
    if (msg.document) {
      const state = db.getState();
      if (state.adminIds.includes(chatId) && (msg.document.file_name?.endsWith('.json') || msg.document.mime_type?.includes('json'))) {
        try {
          bot!.sendMessage(chatId, '⏳ در حال دریافت و بررسی فایل پشتیبان...');
          const file = await bot!.getFile(msg.document.file_id);
          const dUrl = `https://api.telegram.org/file/bot${state.botToken}/${file.file_path}`;
          const res = await axios.get(dUrl);
          let fileData = res.data;
          if (typeof fileData === 'object') {
            fileData = JSON.stringify(fileData);
          }

          // Check if it is encrypted
          let isEncrypted = false;
          try {
            const parsed = typeof fileData === 'string' ? JSON.parse(fileData.replace(/^\uFEFF/, '').trim()) : fileData;
            if (parsed && parsed.type === 'sanaei_bot_secured_backup' && parsed.iv && parsed.encryptedData) {
              isEncrypted = true;
            }
          } catch (e) {}

          if (isEncrypted) {
            adminSession.set(chatId, `restore_pass_${msg.document.file_id}`);
            bot!.sendMessage(chatId, '🔒 این فایل پشتیبان دارای رمز عبور است.\n\n🔑 لطفاً رمز عبور فایل بکاپ را ارسال نمایید تا اطلاعات بازیابی گردد:');
            return;
          }

          // Plain JSON or legacy backup -> restore directly!
          const result = restoreAnyBackup(fileData);
          if (result.success) {
            bot!.sendMessage(chatId, `✅ بازیابی با موفقیت انجام شد! 🎉\n\n${result.message}\n\n📊 آمار اطلاعات بازیابی‌شده:\n👥 کاربران: ${result.stats?.usersCount || 0}\n📦 محصولات: ${result.stats?.productsCount || 0}\n📂 دسته‌بندی‌ها: ${result.stats?.categoriesCount || 0}`);
          } else if (result.isPasswordRequired) {
            adminSession.set(chatId, `restore_pass_${msg.document.file_id}`);
            bot!.sendMessage(chatId, '🔒 این فایل پشتیبان رمزگذاری شده است.\n\n🔑 لطفاً رمز عبور فایل را بفرستید:');
          } else {
            bot!.sendMessage(chatId, `❌ بازیابی فایل پشتیبان انجام نشد: ${result.message}`);
          }
        } catch (err: any) {
          bot!.sendMessage(chatId, `❌ خطا در بارگیری یا پردازش فایل: ${err.message}`);
        }
        return;
      }
    }

    // Fallback response for unhandled messages to avoid echoing the start message or freezing
    bot!.sendMessage(chatId, '❓ پیام ارسالی شما شناسایی نشد.\n\nلطفاً از میان گزینه‌های منوی زیر انتخاب نمایید یا روی دکمه مربوطه در پایین صفحه ضربه بزنید:', {
      reply_markup: getUserReplyKeyboard(db.getUser(chatId), state, state.adminIds.includes(chatId))
    });
  });

  bot.on('callback_query', async (query) => {
    try {
      const chatId = query.message?.chat?.id || query.from?.id;
      if (!chatId) {
        bot?.answerCallbackQuery(query.id).catch(() => {});
        return;
      }
      
      let user = db.getUser(chatId);
      if (!user) {
        user = {
          chatId: Number(chatId),
          username: query.from?.username || '',
          nickname: query.from?.first_name || '',
          balance: 0,
          testUsed: false,
          registeredAt: new Date().toISOString(),
          purchases: []
        };
        db.saveUser(user);
      }

      const data = query.data;
      const state = db.getState();
      const isAdmin = (state.adminIds || []).some((id: any) => String(id) === String(chatId));

    // Filter for force join
    if (!isAdmin && state.forceJoinEnabled && state.forceJoinChannels && state.forceJoinChannels.length > 0) {
       let unjoinedChannels: any[] = [];
       for (const channel of state.forceJoinChannels) {
           if (!channel.id) continue;
           try {
              const member = await bot!.getChatMember(channel.id, chatId);
              if (member.status === 'left' || member.status === 'kicked') {
                 unjoinedChannels.push(channel);
              }
           } catch (e) { }
       }
       if (unjoinedChannels.length > 0) {
           bot!.answerCallbackQuery(query.id, { text: '⚠️ ابتدا در کانال‌های تعیین شده عضو شوید.', show_alert: true });
           return;
       }
    }

    if (data && data.startsWith('approve_pay_')) {
      if (isAdmin) {
        const payId = data.replace('approve_pay_', '');
        const currentPending = db.getState().pendingPayments || [];
        const payment = currentPending.find(p => p.id === payId);

        if (payment) {
          const targetChatId = payment.chatId;
          const amount = payment.amount;
          
          const targetUser = db.getUser(targetChatId);
          if (targetUser) {
            if (targetUser.isSeller) {
              targetUser.totalPayments = (targetUser.totalPayments || 0) + amount;
              targetUser.debt = Math.max(0, (targetUser.debt || 0) - amount);
              applyPaygSettlementToUser(targetUser, amount, targetUser.debt === 0);
            } else {
              targetUser.balance = (targetUser.balance || 0) + amount;
            }
            db.saveUser(targetUser);
            checkPaygReactivation(targetUser).catch(console.error);
            
            // Clean up
            db.updateState({ pendingPayments: currentPending.filter(p => p.id !== payId) });
            
            if (targetUser.isSeller) {
              bot!.sendMessage(chatId, `✅ فیش واریزی همکار \`${targetChatId}\` تایید شد.\n\n💰 مبلغ: *${amount.toLocaleString()}* تومان به عنوان پرداخت/تسویه بدهی ثبت گردید.\n📉 بدهی باقیمانده فعلی: *${(targetUser.debt || 0).toLocaleString()}* تومان\n💳 مجموع پرداخت‌ها: *${(targetUser.totalPayments || 0).toLocaleString()}* تومان`, { parse_mode: 'Markdown' });
              
              const notifyMsg = `🎉 <b>رسید واریزی شما به مبلغ ${amount.toLocaleString()} تومان تایید شد!</b>\n\n` +
                `▫️ کل واریزی‌ها و تسویه‌های ثبت شده: <b>${(targetUser.totalPayments || 0).toLocaleString()}</b> تومان\n` +
                `▫️ بدهی باقیمانده شما به مدیریت: <b>${(targetUser.debt || 0).toLocaleString()}</b> تومان\n\n` +
                `سقف اعتبار خرید شما با موفقیت به‌روزرسانی گردید.`;
              bot!.sendMessage(targetChatId, notifyMsg, { parse_mode: 'HTML' }).catch(e => console.error("Failed to notify seller on payment approval:", e.message));
            } else {
              bot!.sendMessage(chatId, `✅ فیش واریزی کاربر \`${targetChatId}\` تایید شد. مبلغ *${amount.toLocaleString()}* تومان به حساب ایشان اضافه شد.`, { parse_mode: 'Markdown' });
              
              if (payment.pendingPurchase) {
                const pending = payment.pendingPurchase;
                const product = db.getState().products.find(p => p.id === pending.productId);
                if (product) {
                  // Inform admin
                  bot!.sendMessage(chatId, `⏳ در حال اجرای خودکار خرید ${product.name} برای کاربر...`);
                  
                  // Trigger purchase
                  executePurchase(targetChatId, product, pending.couponCode, pending.customName)
                    .then(() => {
                      bot!.sendMessage(chatId, `✅ خرید خودکار سرویس ${product.name} با موفقیت انجام و برای کاربر ارسال شد.`);
                    })
                    .catch(err => {
                      console.error(`[Auto Purchase Error] Failed auto purchase on deposit approval for user ${targetChatId}:`, err);
                      bot!.sendMessage(chatId, `❌ خطای سیستمی در اجرای خودکار خرید: ${err.message}`);
                      bot!.sendMessage(targetChatId, `⚠️ خرید خودکار سرویس شما با خطا مواجه شد. لطفاً به صورت دستی اقدام به خرید کنید یا با پشتیبانی تماس بگیرید. خطا: ${err.message}`);
                    });
                } else {
                  bot!.sendMessage(chatId, `⚠️ محصول مربوط به خرید خودکار پیدا نشد. کاربر باید به صورت دستی اقدام کند.`);
                  
                  // Notify the user normally (without auto purchase)
                  const notifyMsg = `🎉 <b>رسید پرداخت شما به مبلغ ${amount.toLocaleString()} تومان تایید شد!</b>\n\n` +
                    `💰 موجودی جدید حساب شما: <b>${targetUser.balance.toLocaleString()}</b> تومان\n\n` +
                    `🛒 <b>هم‌اکنون با زدن دکمه زیر می‌توانید محصول یا سرویس مورد نظر خود را خریداری کنید:</b>`;
                  bot!.sendMessage(targetChatId, notifyMsg, { 
                    parse_mode: 'HTML',
                    reply_markup: {
                      inline_keyboard: [
                        [{ text: '🛍 خرید و ثبت سفارش', callback_data: 'buy_service_now' }]
                      ]
                    }
                  }).catch(e => console.error("Failed to notify user on payment approval:", e.message));
                }
              } else {
                // Notify the user normally (without auto purchase)
                const notifyMsg = `🎉 <b>رسید پرداخت شما به مبلغ ${amount.toLocaleString()} تومان تایید شد!</b>\n\n` +
                  `💰 موجودی جدید حساب شما: <b>${targetUser.balance.toLocaleString()}</b> تومان\n\n` +
                  `🛒 <b>هم‌اکنون با زدن دکمه زیر می‌توانید محصول یا سرویس مورد نظر خود را خریداری کنید:</b>`;
                bot!.sendMessage(targetChatId, notifyMsg, { 
                  parse_mode: 'HTML',
                  reply_markup: {
                    inline_keyboard: [
                      [{ text: '🛍 خرید و ثبت سفارش', callback_data: 'buy_service_now' }]
                    ]
                  }
                }).catch(e => console.error("Failed to notify user on payment approval:", e.message));
              }
            }
          } else {
            bot!.sendMessage(chatId, '❌ کاربر مورد نظر یافت نشد.');
          }
        } else {
           bot!.sendMessage(chatId, '❌ این فیش نامعتبر است یا قبلاً پردازش شده است.');
        }
      }
      bot!.answerCallbackQuery(query.id);
      return;
    }

    if (data && data.startsWith('reject_pay_')) {
      if (isAdmin) {
        const payId = data.replace('reject_pay_', '');
        const currentPending = db.getState().pendingPayments || [];
        const payment = currentPending.find(p => p.id === payId);

        if (payment) {
          const targetChatId = payment.chatId;
          const fileId = payment.fileId || '';
          
          // Clean up
          db.updateState({ pendingPayments: currentPending.filter(p => p.id !== payId) });

          adminSession.set(chatId, `reject_reason_${targetChatId}_${fileId}`);
          bot!.sendMessage(chatId, `✍️ لطفاً دلیل رد فیش کاربر \`${targetChatId}\` را بنویسید و پیام دهید تا با تصویر فیش برای او ارسال شود:\n\n*(مثلا: اطلاعات فیش خوانا نیست)*`, { parse_mode: 'Markdown' });
        } else {
           bot!.sendMessage(chatId, '❌ این فیش نامعتبر است یا قبلاً پردازش شده است.');
        }
      }
      bot!.answerCallbackQuery(query.id);
      return;
    }

    if (data === 'enter_gift_code') {
      userSession.set(chatId, { action: 'awaiting_gift_code' });
      bot!.sendMessage(chatId, '🎁 *ثبت کد هدیه*\n\nلطفاً کد هدیه خود را ارسال نمایید:', { parse_mode: 'Markdown' });
      bot!.answerCallbackQuery(query.id);
      return;
    }

    if (data === 'user_deposit_flow') {
      const prevSession = userSession.get(chatId);
      const pendingPurchase = prevSession && prevSession.action === 'payment_awaiting_deposit_choice' ? prevSession.pendingPurchase : undefined;
      userSession.set(chatId, { action: 'payment_awaiting_amount', pendingPurchase });
      bot!.sendMessage(chatId, '💰 *شارژ حساب (کارت به کارت)*\n\nلطفاً مبلغ مد نظر جهت شارژ حساب خود را به *تومان* و به صورت عددی ارسال کنید:\n\nمثال: `50000` یا `120000`', { parse_mode: 'Markdown' });
      bot!.answerCallbackQuery(query.id);
      return;
    }

    if (data && data.startsWith('deposit_exact_')) {
      const amountStr = data.replace('deposit_exact_', '');
      const amount = parseInt(amountStr);
      if (!isNaN(amount) && amount > 0) {
        const prevSession = userSession.get(chatId);
        const pendingPurchase = prevSession && prevSession.action === 'payment_awaiting_deposit_choice' ? prevSession.pendingPurchase : undefined;
        userSession.set(chatId, { action: 'payment_awaiting_photo', amount, pendingPurchase });
        const cardNumber = state.cardNumber || '۶۰۳۷۹۹۷۹۱۲۳۴۵۶۷۸';
        const cardHolder = state.cardHolder || 'مدیریت حساب';

        const paymentInstructions = `💳 *دستورالعمل جبران کسری موجودی*:\n\n` +
          `لطفاً مبلغ *${amount.toLocaleString()}* تومان را به مشخصات بانکی زیر واریز نمایید:\n\n` +
          `  💳 شماره کارت:\n  \`${cardNumber}\`\n\n` +
          `  👤 به نام:\n  *${cardHolder}*\n\n` +
          `⚠️ *توجه کُنید*:\n` +
          `پس از انجام واریز، لطفا *عکس رسید پرداخت (فیش واریزی)* خود را به همین گفتگو بفرستید تا سریعاً توسط مدیریت تایید، حسابتان شارژ شده و خرید امکان پذیر شود.`;

        bot!.sendMessage(chatId, paymentInstructions, { parse_mode: 'Markdown' });
      }
      bot!.answerCallbackQuery(query.id);
      return;
    }

    if (data === 'admin_card_menu') {
      if (isAdmin) {
        sendCardSettingsMenu(chatId);
      }
      bot!.answerCallbackQuery(query.id);
      return;
    }

    if (data === 'set_card_num') {
      if (isAdmin) {
        adminSession.set(chatId, 'set_card_num');
        bot!.sendMessage(chatId, '💳 لطفا شماره کارت ۱۶ رقمی جدید را بدون فاصله ارسال کنید:');
      }
      bot!.answerCallbackQuery(query.id);
      return;
    }

    if (data === 'set_card_name') {
      if (isAdmin) {
        adminSession.set(chatId, 'set_card_name');
        bot!.sendMessage(chatId, '👤 لطفا نام دارنده کارت جدید را ارسال کنید:');
      }
      bot!.answerCallbackQuery(query.id);
      return;
    }

    if (data === 'admin_daily_report') {
      if (isAdmin) {
        bot!.sendMessage(chatId, getDailyReportText(), { parse_mode: 'HTML' });
      }
      bot!.answerCallbackQuery(query.id);
      return;
    }

    if (data === 'admin_main') {
      if (isAdmin) {
        sendAdminMainMenu(chatId);
      }
      bot!.answerCallbackQuery(query.id);
      return;
    }

    if (data === 'admin_auto_backup_menu') {
      if (isAdmin) {
        adminSession.set(chatId, 'set_auto_backup_interval');
        const interval = state.autoBackupIntervalHours || 0;
        let txt = `⏳ *تنظیمات زمان‌بندی بکاپ خودکار*\n\nوضعیت فعلی: ${interval > 0 ? `فعال (هر ${interval} ساعت)` : 'غیرفعال'}\n\n`;
        txt += `لطفاً برای تنظیم زمان‌بندی جدید، یک عدد بین 1 تا 24 را بفرستید که نشان‌دهنده تعداد ساعت فاصله‌ی بین هر بکاپ است.\n\nبرای غیرفعال کردن بکاپ خودکار عدد 0 را ارسال کنید.`;
        bot!.sendMessage(chatId, txt, { parse_mode: 'Markdown' });
      }
      bot!.answerCallbackQuery(query.id);
      return;
    }

    if (data === 'admin_backup') {
      if (isAdmin) {
        adminSession.set(chatId, 'get_backup_password');
        bot!.sendMessage(chatId, '🔑 لطفا یک رمز عبور دلخواه برای رمزگذاری و محافظت از فایل بکاپ خود وارد کنید:\n\n*(هنگام بازیابی این فایل، وارد کردن این رمز عبور الزامی است)*', { parse_mode: 'Markdown' });
      }
      bot!.answerCallbackQuery(query.id);
      return;
    }

    if (data === 'admin_restore_prompt') {
      if (isAdmin) {
        bot!.sendMessage(chatId, '📤 *راهنمای بازیابی فایل پشتیبان (ری‌استور)*:\n\nلطفاً فایل پشتیبان با پسوند `.json` را که قبلاً از این ربات یا از پنل وب ادمین دریافت کرده‌اید به همین چت فوروارد یا ارسال کُنید.\n\nپس از دریافت فایل، سیستم رمز عبور بکاپ را جهت رمزگشایی و اعمال نهایی از شما خواهد پرسید.', { parse_mode: 'Markdown' });
      }
      bot!.answerCallbackQuery(query.id);
      return;
    }

    if (data === 'admin_panel_menu') {
      if (isAdmin) {
        sendSanaeiConnectionMenu(chatId);
      }
      bot!.answerCallbackQuery(query.id);
      return;
    }

    if (data === 'admin_fetch_inbounds') {
      if (isAdmin) {
        bot!.sendMessage(chatId, '⏳ در حال دریافت لیست اینباندهای پنل...');
        try {
          const list = await xui.getInbounds();
          if (!list || list.length === 0) {
            bot!.sendMessage(chatId, '❌ هیچ اینباندی یافت نشد یا اتصال با پنل برقرار نشد. لطفا مشخصات اتصال (آدرس کامل، توکن API یا اطلاعات کاربری ورود) را مجدداً بررسی فرمایید.');
          } else {
            let text = '⚡️ لیست اینباندهای یافت شده:\n\n';
            list.forEach((inb: any) => {
              text += `🆔 شناسه ID: \`${inb.id}\`\n💬 عنوان (Remark): ${inb.remark}\n🔌 پورت: ${inb.port}\n🌐 پروتکل: ${inb.protocol}\n------------------------\n`;
            });
            bot!.sendMessage(chatId, text, { parse_mode: 'Markdown' });
          }
        } catch(err: any) {
           bot!.sendMessage(chatId, `❌ خطا در برقراری ارتباط با پنل سنایی: ${err.message}`);
        }
      }
      bot!.answerCallbackQuery(query.id);
      return;
    }

    if (data === 'admin_test_menu') {
      if (isAdmin) {
        sendTestSettingsMenu(chatId);
      }
      bot!.answerCallbackQuery(query.id);
      return;
    }

    if (data === 'admin_products_menu') {
      if (isAdmin) {
        sendProductsMenu(chatId);
      }
      bot!.answerCallbackQuery(query.id);
      return;
    }

    if (data === 'admin_users_menu') {
      if (isAdmin) {
        sendUsersMenu(chatId);
      }
      bot!.answerCallbackQuery(query.id);
      return;
    }

    if (data === 'list_all_users') {
      if (isAdmin) {
        if (state.users.length === 0) {
          bot!.sendMessage(chatId, '❌ هیچ کاربری ثبت نشده است.');
        } else {
          let text = '📋 لیست کل کاربران ربات:\n\n';
          state.users.forEach((u, idx) => {
            text += `${idx + 1}- 👤 ${u.username ? '@' + u.username : 'بدون یوزرنیم'}\n🆔 آیدی عددی: \`${u.chatId}\`\n💰 موجودی: ${(u.balance || 0).toLocaleString()} تومان\n👤 نقش: ${u.isSeller ? 'همکار' : 'عادی'}\n------------------\n`;
            if (text.length > 3500) {
              bot!.sendMessage(chatId, text, { parse_mode: 'Markdown' });
              text = '';
            }
          });
          if (text) {
             bot!.sendMessage(chatId, text, { parse_mode: 'Markdown' });
          }
        }
      }
      bot!.answerCallbackQuery(query.id);
      return;
    }

    if (data === 'list_sellers_only') {
      if (isAdmin) {
        const sellers = state.users.filter(u => u.isSeller);
        if (sellers.length === 0) {
          bot!.sendMessage(chatId, '❌ هیچ همکار فروشنده‌ای ثبت نشده است.');
        } else {
          let text = '👥 *لیست کل فروشندگان همکار*:\n\n' +
            'جهت مشاهده آمار دقیق‌تر و گزارش فروش، حجم کلی، رئال کلی، تخفیفات و وضعیت مالی هر همکار، روی دکمه شیشه‌ای زیر ضربه بزنید:\n\n';
          
          const inline_keyboard: any[] = [];
          sellers.forEach((s, idx) => {
            const displayName = s.nickname || s.username || `همکار ${s.chatId}`;
            text += `*${idx + 1}-* 👤 *${displayName}*\n🆔 شناسه: \`${s.chatId}\`\n📉 بدهی: ${(s.debt || 0).toLocaleString()} تومان\n💰 فروش: ${(s.totalSales || 0).toLocaleString()} تومان\n\n`;
            
            inline_keyboard.push([{ text: `📊 گزارش دقیق ${displayName}`, callback_data: `admin_seller_rep_${s.chatId}` }]);
          });
          
          inline_keyboard.push([{ text: '🔙 بازگشت به منوی کاربران', callback_data: 'admin_users_menu' }]);
          
          bot!.sendMessage(chatId, text, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard }
          });
        }
      }
      bot!.answerCallbackQuery(query.id);
      return;
    }

    if (data === 'seller_detailed_report') {
      const userObj = db.getUser(chatId);
      if (userObj && userObj.isSeller) {
        await sendDetailedSellerReport(chatId, chatId, false);
      }
      bot!.answerCallbackQuery(query.id);
      return;
    }

    if (data === 'seller_panel_inline') {
      const userObj = db.getUser(chatId);
      if (userObj && userObj.isSeller) {
        const textResponse = `📊 *به پنل اختصاصی همکار خوش آمدید*\n\n` +
          `جهت ثبت فروش و مشاهده وضعیت اعتبار و بدهی‌های خود، از منوی زیر استفاده کنید:\n\n` +
          `💰 مجموع کل فروش شما: *${(userObj.totalSales || 0).toLocaleString()}* تومان\n` +
          `📉 میزان بدهی فعلی: *${(userObj.debt || 0).toLocaleString()}* تومان`;
        
        bot!.sendMessage(chatId, textResponse, {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '📊 گزارش دقیق فروش و مصرف', callback_data: 'seller_detailed_report' }]
            ]
          } as any
        });
      }
      bot!.answerCallbackQuery(query.id);
      return;
    }

    if (data && data.startsWith('admin_seller_rep_')) {
      if (isAdmin) {
        const targetChatId = parseInt(data.replace('admin_seller_rep_', ''));
        await sendDetailedSellerReport(chatId, targetChatId, true);
      }
      bot!.answerCallbackQuery(query.id);
      return;
    }

    if (data && data.startsWith('admin_settle_specific_')) {
      if (isAdmin) {
        const targetChatId = parseInt(data.replace('admin_settle_specific_', ''));
        const targetUser = db.getUser(targetChatId);
        if (targetUser) {
          const settledAmount = targetUser.debt || 0;
          targetUser.totalPayments = (targetUser.totalPayments || 0) + settledAmount;
          targetUser.debt = 0;
          targetUser.debtVolume = 0;
          applyPaygSettlementToUser(targetUser, settledAmount, true);
          if (targetUser.totalSales) {
            targetUser.totalPayments = targetUser.totalSales;
          }
          db.saveUser(targetUser);
          await checkPaygReactivation(targetUser);
          
          bot!.sendMessage(chatId, `✅ بدهی همکار 👤 ${targetUser.username ? '@' + targetUser.username : targetUser.chatId} با موفقیت صفر شد (تسویه حساب کامل). تمام کانفیگ‌های مصرف لحظه‌ای نیز تا این حجم تسویه شدند.`);
          bot!.sendMessage(targetUser.chatId, '💵 حساب بدهی شما توسط مدیریت تسویه شد و به صفر بازگشت.').catch(() => {});
          
          // Re-send report to reflect changes
          await sendDetailedSellerReport(chatId, targetChatId, true);
        } else {
          bot!.sendMessage(chatId, '❌ همکار یافت نشد.');
        }
      }
      bot!.answerCallbackQuery(query.id);
      return;
    }

    if (data && data.startsWith('admin_settle_payg_')) {
      if (isAdmin) {
        const targetChatId = parseInt(data.replace('admin_settle_payg_', ''));
        const targetUser = db.getUser(targetChatId);
        if (targetUser) {
          applyPaygSettlementToUser(targetUser, undefined, true);
          const hasOnlyPayg = targetUser.purchases && targetUser.purchases.length > 0 && targetUser.purchases.every((p: any) => p.isPayAsYouGo);
          if (hasOnlyPayg) {
            const oldDebt = targetUser.debt || 0;
            targetUser.debt = 0;
            targetUser.totalPayments = (targetUser.totalPayments || 0) + oldDebt;
          }
          db.saveUser(targetUser);
          await checkPaygReactivation(targetUser);
          bot!.sendMessage(chatId, `⚡ تمام کانفیگ‌های مصرف لحظه‌ای (PAYG) همکار 👤 ${targetUser.username ? '@' + targetUser.username : targetUser.chatId} تا حجم مصرفی فعلی تسویه شدند و از این حجم به بعد محاسبه خواهند شد.`);
          await sendDetailedSellerReport(chatId, targetChatId, true);
        } else {
          bot!.sendMessage(chatId, '❌ همکار یافت نشد.');
        }
      }
      bot!.answerCallbackQuery(query.id);
      return;
    }

    if (data && data.startsWith('admin_recalc_seller_')) {
      if (isAdmin) {
        const targetChatId = parseInt(data.replace('admin_recalc_seller_', ''));
        const targetUser = db.getUser(targetChatId);
        if (targetUser) {
          bot!.sendMessage(chatId, '⏳ در حال محاسبه مجدد و همگام‌سازی تراز مالی با آخرین آمار مصرف سرور...');
          await syncAllUsersAndSellersFinancials();
          await sendDetailedSellerReport(chatId, targetChatId, true);
          bot!.sendMessage(chatId, '✅ تراز مالی، کل فروش و بدهی این همکار با موفقیت همگام‌سازی و اصلاح گردید.');
        } else {
          bot!.sendMessage(chatId, '❌ همکار یافت نشد.');
        }
      }
      bot!.answerCallbackQuery(query.id);
      return;
    }

    if (data && data.startsWith('toggle_unlimited_seller_')) {
      if (isAdmin) {
        const targetChatId = parseInt(data.replace('toggle_unlimited_seller_', ''));
        const targetUser = db.getUser(targetChatId);
        if (targetUser) {
          const wasUnlimited = isSellerUnlimitedLimit(targetUser);
          targetUser.isUnlimitedLimit = !wasUnlimited;
          if (targetUser.isUnlimitedLimit) {
            targetUser.debtLimit = 0;
          } else {
            targetUser.debtLimit = 1000000;
          }
          db.saveUser(targetUser);
          await checkPaygReactivation(targetUser);
          
          const statusText = targetUser.isUnlimitedLimit ? '⚡ سقف آزاد (نامحدود)' : '🔒 سقف محدود عددی (۱,۰۰۰,۰۰۰ تومان)';
          bot!.sendMessage(chatId, `✅ وضعیت سقف اعتبار همکار 👤 ${targetUser.username ? '@' + targetUser.username : targetUser.chatId} به «${statusText}» تغییر یافت.`);
          bot!.sendMessage(targetUser.chatId, `📢 وضعیت اعتبار حساب شما توسط مدیریت به «${statusText}» بروزرسانی شد.`).catch(() => {});
          
          await sendDetailedSellerReport(chatId, targetChatId, true);
        } else {
          bot!.sendMessage(chatId, '❌ همکار یافت نشد.');
        }
      }
      bot!.answerCallbackQuery(query.id);
      return;
    }

    if (data && data.startsWith('set_seller_limit_')) {
      if (isAdmin) {
        const targetChatId = parseInt(data.replace('set_seller_limit_', ''));
        const targetUser = db.getUser(targetChatId);
        if (targetUser) {
          adminSession.set(chatId, `set_seller_limit_${targetChatId}`);
          bot!.sendMessage(chatId, `🔢 لطفاً سقف اعتبار جدید همکار 👤 ${targetUser.username ? '@' + targetUser.username : targetUser.chatId} را به تومان ارسال کنید (یا عدد 0 یا کلمه «آزاد» را برای سقف نامحدود ارسال فرمایید):`);
        } else {
          bot!.sendMessage(chatId, '❌ همکار یافت نشد.');
        }
      }
      bot!.answerCallbackQuery(query.id);
      return;
    }

    if (data === 'toggle_test_enabled') {
      if (isAdmin) {
        const currentVal = state.freeTestEnabled !== false;
        const newVal = !currentVal;
        db.updateState({ freeTestEnabled: newVal });
        bot!.sendMessage(chatId, `🔘 وضعیت تست رایگان با موفقیت به *${newVal ? 'فعال ✅' : 'غیرفعال ❌'}* تغییر یافت.`, { parse_mode: 'Markdown' });
        sendTestSettingsMenu(chatId);
      }
      bot!.answerCallbackQuery(query.id);
      return;
    }

    if (data === 'admin_set_support_id') {
      if (isAdmin) {
        adminSession.set(chatId, 'set_support_id');
        bot!.sendMessage(chatId, '📞 لطفا آیدی پشتیبانی جدید را بدون @ ارسال کُنید:\nمثال: `MyVpnSupport`');
      }
      bot!.answerCallbackQuery(query.id);
      return;
    }

    if (data === 'admin_coupons_menu') {
      if (isAdmin) {
        sendCouponsMenu(chatId);
      }
      bot!.answerCallbackQuery(query.id);
      return;
    }

    if (data === 'add_coupon') {
      if (isAdmin) {
        adminSession.set(chatId, 'add_coupon');
        const msg = '🎫 لطفا مشخصات کد تخفیف را با کاما جدا کرده و ارسال کنید (مقادیر ستاره‌دار اختیاری است و میتوانید خالی بگذارید):\n\n' +
          '`کد,درصدتخفیف,تعدادکل‌مصرف*,تعدادمصرف‌هرکاربر*,تعدادروز‌اعتبار*`\n\n' +
          'مثال ساده:\n`YALDA,20` (۲۰ درصد تخفیف، بدون محدودیت)\n\n' +
          'مثال کامل:\n`NOROUZ,50,100,1,10` (۵۰ درصد تخفیف، ۱۰۰ بار قابل استفاده، ۱ بار برای هر نفر، تا ۱۰ روز معتبر)';
        bot!.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
      }
      bot!.answerCallbackQuery(query.id);
      return;
    }

    if (data === 'add_gift_code') {
      if (isAdmin) {
        giftCodeDrafts.set(chatId, {});
        adminSession.delete(chatId);
        sendGiftCodeDraftMenu(chatId);
      }
      bot!.answerCallbackQuery(query.id);
      return;
    }

    if (data === 'edit_gift_draft_code') {
      if (isAdmin) {
        adminSession.set(chatId, 'gift_draft_code');
        bot!.sendMessage(chatId, '✏️ لطفاً کد هدیه جدید را ارسال کنید (مثال: `GIFT100`):', { parse_mode: 'Markdown' });
      }
      bot!.answerCallbackQuery(query.id);
      return;
    }

    if (data === 'edit_gift_draft_amount') {
      if (isAdmin) {
        adminSession.set(chatId, 'gift_draft_amount');
        bot!.sendMessage(chatId, '💰 لطفاً مبلغ شارژ هدیه به *تومان* را به صورت عددی ارسال کنید (مثال: `50000`):', { parse_mode: 'Markdown' });
      }
      bot!.answerCallbackQuery(query.id);
      return;
    }

    if (data === 'edit_gift_draft_max') {
      if (isAdmin) {
        adminSession.set(chatId, 'gift_draft_max');
        bot!.sendMessage(chatId, '📊 لطفاً حداکثر تعداد کل استفاده مجاز را ارسال کنید (برای نامحدود عدد `0` بفرستید):', { parse_mode: 'Markdown' });
      }
      bot!.answerCallbackQuery(query.id);
      return;
    }

    if (data === 'edit_gift_draft_per_user') {
      if (isAdmin) {
        adminSession.set(chatId, 'gift_draft_per_user');
        bot!.sendMessage(chatId, '👥 لطفاً حداکثر تعداد دفعات مجاز استفاده برای هر کاربر را ارسال کنید (پیش‌فرض `1`):', { parse_mode: 'Markdown' });
      }
      bot!.answerCallbackQuery(query.id);
      return;
    }

    if (data === 'edit_gift_draft_exp') {
      if (isAdmin) {
        adminSession.set(chatId, 'gift_draft_exp');
        bot!.sendMessage(chatId, '📅 لطفاً تعداد روزهای اعتبار کد هدیه را از امروز وارد کنید (برای نامحدود عدد `0` بفرستید):', { parse_mode: 'Markdown' });
      }
      bot!.answerCallbackQuery(query.id);
      return;
    }

    if (data === 'cancel_gift_draft') {
      if (isAdmin) {
        giftCodeDrafts.delete(chatId);
        adminSession.delete(chatId);
        sendCouponsMenu(chatId);
      }
      bot!.answerCallbackQuery(query.id);
      return;
    }

    if (data === 'save_gift_draft') {
      if (isAdmin) {
        const draft = giftCodeDrafts.get(chatId);
        if (!draft || !draft.code || !draft.giftAmount) {
          bot!.sendMessage(chatId, '⚠️ لطفاً ابتدا *کد هدیه* و *مبلغ شارژ* را تعیین کنید.', { parse_mode: 'Markdown' });
          bot!.answerCallbackQuery(query.id);
          return;
        }

        const code = draft.code.toUpperCase();
        const giftAmount = draft.giftAmount;
        let expirationDate = undefined;
        if (draft.expirationDays) {
          const d = new Date();
          d.setDate(d.getDate() + draft.expirationDays);
          expirationDate = d.toISOString();
        }

        const couponsList = state.coupons || [];
        const existing = couponsList.find((c: any) => c.code === code);
        
        const newCoupon = {
          code, 
          discountPercent: 0,
          giftAmount,
          maxUsage: draft.maxUsage,
          maxUsagePerUser: draft.maxUsagePerUser,
          expirationDate,
          usedCount: existing ? existing.usedCount : 0,
          usedBy: existing ? existing.usedBy : {}
        };

        if (existing) {
          Object.assign(existing, newCoupon);
        } else {
          couponsList.push(newCoupon);
        }

        db.updateState({ coupons: couponsList });
        giftCodeDrafts.delete(chatId);
        adminSession.delete(chatId);

        bot!.sendMessage(chatId, `🎉 کد هدیه *${code}* با مبلغ شارژ *${giftAmount.toLocaleString()}* تومان با موفقیت ثبت شد.`, { parse_mode: 'Markdown' });
        sendCouponsMenu(chatId);
      }
      bot!.answerCallbackQuery(query.id);
      return;
    }

    if (data && data.startsWith('del_coupon_')) {
      if (isAdmin) {
        const code = data.replace('del_coupon_', '');
        const couponsList = state.coupons || [];
        const newCoupons = couponsList.filter((c: any) => c.code !== code);
        db.updateState({ coupons: newCoupons });
        bot!.sendMessage(chatId, `🗑 کد تخفیف *${code}* با موفقیت حذف شد.`, { parse_mode: 'Markdown' });
        sendCouponsMenu(chatId);
      }
      bot!.answerCallbackQuery(query.id);
      return;
    }

    if (data === 'admin_broadcast') {
      if (isAdmin) {
        adminSession.set(chatId, 'admin_broadcast');
        bot!.sendMessage(chatId, '📢 لطفاً متن پیام همگانی که می‌خواهید به کلیه کاربران ربات ارسال گردد را بنویسید و وارد کنید:');
      }
      bot!.answerCallbackQuery(query.id);
      return;
    }

    if (data === 'admin_search_user') {
      if (isAdmin) {
        adminSession.set(chatId, 'search_user');
        bot!.sendMessage(chatId, '🔍 لطفاً یوذرنیم (بدون @)، شناسه عددی (ChatID) یا بخشی از نام کاربر مدنظر را ارسال کنید:');
      }
      bot!.answerCallbackQuery(query.id);
      return;
    }

    if (data === 'admin_search_config') {
      if (isAdmin) {
        adminSession.set(chatId, 'search_config');
        bot!.sendMessage(chatId, '🔍 لطفاً نام کلاینت، آیدی کلاینت (سرویس) یا لینک اشتراک را جهت جستجو بفرستید:');
      }
      bot!.answerCallbackQuery(query.id);
      return;
    }

    if (data === 'user_purchases_list') {
      const currentUser = db.getUser(chatId) || user;
      const userPurchases = (currentUser.purchases || []).filter((p: any) => !p.isDeleted);
      if (userPurchases.length === 0) {
        bot!.sendMessage(chatId, '❌ شما هنوز هیچ خریدی در ربات ثبت نکرده‌اید.');
      } else {
        let msg = `📋 <b>لیست سرویس‌ها و خریدهای شما:</b>\n\n`;
        const inlineKeyboard: any[] = [];
        userPurchases.forEach((p: any, idx: number) => {
          const volStr = p.isPayAsYouGo ? 'نامحدود (PAYG)' : (p.volumeGb ? `${p.volumeGb} گیگابایت` : 'نامحدود');
          const durStr = p.isPayAsYouGo ? 'نامحدود' : (p.durationDays ? `${p.durationDays} روز` : 'نامحدود');
          msg += `💎 <b>${idx + 1}- سرویس: ${escapeHtml(p.name || 'کانفیگ')}</b>\n` +
            `▫️ شناسه: <code>${escapeHtml(String(p.id))}</code>\n` +
            `▫️ حجم: ${volStr} | مدت: ${durStr}\n` +
            `📅 تاریخ: ${new Date(p.createdAt).toLocaleDateString('fa-IR')}\n`;
          if (p.subUrl) {
            msg += `🔗 لینک ساب: <code>${escapeHtml(p.subUrl)}</code>\n`;
          }
          msg += `----------------------------------\n`;
          const btnData = String(p.id).length > 28 ? idx : p.id;
          inlineKeyboard.push([{ text: `🔍 استعلام حجم، زمان و QR Code (${idx + 1})`, callback_data: `resend_link_${btnData}` }]);
        });

        bot!.sendMessage(chatId, msg, {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: inlineKeyboard
          }
        });
      }
      bot!.answerCallbackQuery(query.id);
      return;
    }

    if (data && data.startsWith('resend_link_')) {
      bot!.answerCallbackQuery(query.id, { text: '🔍 در حال دریافت اطلاعات سرویس...' });
      const purchaseId = data.replace('resend_link_', '');
      const currentUser = db.getUser(chatId) || user;
      const userPurchases = currentUser?.purchases || [];
      
      let purchase = userPurchases.find((p: any) => 
        String(p.id).trim().toLowerCase() === String(purchaseId).trim().toLowerCase() ||
        (p.subId && String(p.subId).trim().toLowerCase() === String(purchaseId).trim().toLowerCase()) ||
        (p.subUrl && p.subUrl.includes(purchaseId)) ||
        (p.name && String(p.name).trim().toLowerCase() === String(purchaseId).trim().toLowerCase())
      );

      if (!purchase && !isNaN(Number(purchaseId))) {
        const idx = parseInt(purchaseId, 10);
        if (idx >= 0 && idx < userPurchases.length) {
          purchase = userPurchases[idx];
        }
      }
      
      if (purchase) {
        await sendServiceInfo(chatId, purchase);
      } else {
        bot!.sendMessage(chatId, '❌ سرویس مورد نظر در لیست شما یافت نشد.');
      }
      return;
    }

    if (data && data.startsWith('refresh_service_')) {
      bot!.answerCallbackQuery(query.id, { text: '🔄 در حال استعلام وضعیت لحظه‌ای...' });
      const purchaseId = data.replace('refresh_service_', '');
      const currentUser = db.getUser(chatId) || user;
      const userPurchases = currentUser?.purchases || [];
      let purchase = userPurchases.find((p: any) => 
        String(p.id).trim().toLowerCase() === String(purchaseId).trim().toLowerCase() ||
        (p.subId && String(p.subId).trim().toLowerCase() === String(purchaseId).trim().toLowerCase()) ||
        (p.subUrl && p.subUrl.includes(purchaseId)) ||
        (p.name && String(p.name).trim().toLowerCase() === String(purchaseId).trim().toLowerCase())
      );
      if (!purchase && !isNaN(Number(purchaseId))) {
        const idx = parseInt(purchaseId, 10);
        if (idx >= 0 && idx < userPurchases.length) {
          purchase = userPurchases[idx];
        }
      }
      if (purchase) {
        await sendServiceInfo(chatId, purchase);
      } else {
        bot!.sendMessage(chatId, '❌ سرویس مورد نظر یافت نشد.');
      }
      return;
    }

    if (data && data.startsWith('direct_configs_')) {
      bot!.answerCallbackQuery(query.id, { text: '⏳ در حال دریافت کانفیگ‌ها...' });
      const purchaseId = data.replace('direct_configs_', '');
      const currentUser = db.getUser(chatId) || user;
      const userPurchases = currentUser?.purchases || [];
      let purchase = userPurchases.find((p: any) => 
        String(p.id).trim().toLowerCase() === String(purchaseId).trim().toLowerCase() ||
        (p.subId && String(p.subId).trim().toLowerCase() === String(purchaseId).trim().toLowerCase()) ||
        (p.subUrl && p.subUrl.includes(purchaseId)) ||
        (p.name && String(p.name).trim().toLowerCase() === String(purchaseId).trim().toLowerCase())
      );
      if (!purchase && !isNaN(Number(purchaseId))) {
        const idx = parseInt(purchaseId, 10);
        if (idx >= 0 && idx < userPurchases.length) {
          purchase = userPurchases[idx];
        }
      }
      if (!purchase) {
        bot!.sendMessage(chatId, '❌ سرویس یافت نشد.');
        return;
      }

      try {
        let configs = '';
        if (purchase.subUrl) {
          try {
            const resp = await axios.get(purchase.subUrl, { timeout: 6000 });
            let text = resp.data;
            if (typeof text === 'string') {
              try {
                const decoded = Buffer.from(text, 'base64').toString('utf-8');
                if (decoded.includes('://')) {
                  text = decoded;
                }
              } catch {}
            }
            if (typeof text === 'string' && text.includes('://')) {
              configs = text.trim();
            }
          } catch {}
        }

        // Rebecca direct fallback
        if (!configs) {
          try {
            const rebClient = await rebecca.getClient(purchase.id || (purchase as any).subId);
            if (rebClient && rebClient.links && rebClient.links.length > 0) {
              configs = rebClient.links.join('\n');
            }
          } catch {}
        }

        if (configs) {
          if (configs.length > 3500) {
            await bot!.sendMessage(chatId, `⚙️ <b>کانفیگ‌های مستقیم سرویس:</b>\n\n<code>${escapeHtml(configs.slice(0, 3500))}</code>`, { parse_mode: 'HTML' });
          } else {
            await bot!.sendMessage(chatId, `⚙️ <b>کانفیگ‌های مستقیم سرویس:</b>\n\n<code>${escapeHtml(configs)}</code>`, { parse_mode: 'HTML' });
          }
        } else if (purchase.subUrl) {
          bot!.sendMessage(chatId, `🔗 <b>لینک اشتراک سابسکریپشن:</b>\n<code>${escapeHtml(purchase.subUrl)}</code>\n\nجهت دریافت کانفیگ‌ها، لینک فوق را در نرم‌افزار V2ray وارد کرده و دکمه Update Subscription را بزنید.`, { parse_mode: 'HTML' });
        } else {
          bot!.sendMessage(chatId, `⚠️ لینک سابسکریپشن موجود نیست.`);
        }
      } catch (e: any) {
        bot!.sendMessage(chatId, `🔗 <b>لینک اشتراک سابسکریپشن:</b>\n<code>${escapeHtml(purchase.subUrl || '')}</code>\n\n⚠️ کانکشن مستقیم در دسترس نبود؛ لطفاً لینک ساب فوق را در نرم‌افزار وارد و بروزرسانی نمایید.`, { parse_mode: 'HTML' });
      }
      return;
    }

    if (data && data.startsWith('renew_service_')) {
      bot!.answerCallbackQuery(query.id);
      if (!user) return;
      const purchaseId = data.replace('renew_service_', '');
      const currentUser = db.getUser(chatId) || user;
      const userPurchases = currentUser?.purchases || [];
      let purchase = userPurchases.find((p: any) => 
        String(p.id).trim().toLowerCase() === String(purchaseId).trim().toLowerCase() ||
        (p.subId && String(p.subId).trim().toLowerCase() === String(purchaseId).trim().toLowerCase()) ||
        (p.subUrl && p.subUrl.includes(purchaseId)) ||
        (p.name && String(p.name).trim().toLowerCase() === String(purchaseId).trim().toLowerCase())
      );
      if (!purchase && !isNaN(Number(purchaseId))) {
        const idx = parseInt(purchaseId, 10);
        if (idx >= 0 && idx < userPurchases.length) {
          purchase = userPurchases[idx];
        }
      }

      if (!purchase) {
        bot!.sendMessage(chatId, '❌ سرویس مورد نظر یافت نشد.');
        return;
      }

      const finalPrice = purchase.price;

      if (!user.isSeller) {
        if ((user.balance || 0) < finalPrice) {
          bot!.sendMessage(chatId, `❌ موجودی شما برای تمدید این سرویس کافی نیست.\n\nقیمت: ${finalPrice.toLocaleString()} تومان\nموجودی شما: ${(user.balance || 0).toLocaleString()} تومان`, {
            reply_markup: {
              inline_keyboard: [[{ text: '💳 شارژ حساب (کارت به کارت)', callback_data: 'user_deposit_flow' }]]
            }
          });
          return;
        }
      } else {
        if (!isSellerUnlimitedLimit(user)) {
          const debtLimit = user.debtLimit !== undefined && user.debtLimit > 0 ? user.debtLimit : 1000000;
          if ((user.debt || 0) + finalPrice > debtLimit) {
             bot!.sendMessage(chatId, `❌ سقف اعتبار شما برای ثبت فروش جدید کافی نیست.\n\nبدهی فعلی: ${(user.debt || 0).toLocaleString()} تومان\nسقف اعتبار: ${debtLimit.toLocaleString()} تومان`);
             return;
          }
        }
      }

      bot!.sendMessage(chatId, '⏳ در حال تمدید سرویس در سرور... لطفا شکیبا باشید.');

      try {
        let targetEmail = "";
        if (purchase.id && !purchase.id.startsWith('test_')) {
          targetEmail = purchase.id;
        }

        const expectedSubIdMatch = purchase.subUrl ? purchase.subUrl.substring(purchase.subUrl.lastIndexOf('/') + 1) : null;
        const allClients = await xui.getAllClientsWithTraffic();
        const foundClient = allClients.find((c: any) => 
          (c.email && targetEmail && c.email.toLowerCase() === targetEmail.toLowerCase()) ||
          (c.id && targetEmail && c.id.toLowerCase() === targetEmail.toLowerCase()) ||
          (expectedSubIdMatch && c.subId && c.subId === expectedSubIdMatch) ||
          (purchase.subUrl && c.subId && purchase.subUrl.includes(c.subId))
        );

        if (foundClient) {
          targetEmail = foundClient.email || foundClient.id || targetEmail;
        }

        if (!targetEmail) {
          throw new Error('مشخصات کاربر در پنل اصلی یافت نشد. ممکن است اشتراک حذف شده باشد.');
        }

        await xui.renewClient(targetEmail, purchase.volumeGb, purchase.durationDays, purchase.panelType);

        if (!user.isSeller) {
          user.balance = (user.balance || 0) - finalPrice;
        } else {
          user.debt = (user.debt || 0) + finalPrice;
          user.debtVolume = (user.debtVolume || 0) + Number(purchase.volumeGb);
          user.totalSales = (user.totalSales || 0) + finalPrice;
        }
        
        // Save the purchase update explicitly: update createdAt to now so logs show it as recent update
        purchase.createdAt = new Date().toISOString();

        db.saveUser(user);

        let finalMsg = `✅ تمدید سرویس با موفقیت انجام شد!\n\n📦 ${purchase.name}\nحجم ریست شد و زمان تمدید گردید.\n\n`;
        if (user.isSeller) {
           finalMsg += `📉 بدهی جدید شما: ${(user.debt || 0).toLocaleString()} تومان\n`;
        } else {
           finalMsg += `💰 موجودی جدید: ${user.balance.toLocaleString()} تومان\n`;
        }
        bot!.sendMessage(chatId, finalMsg);

      } catch (err: any) {
        bot!.sendMessage(chatId, `❌ خطای تمدید: ${err.message}`);
      }
      return;
    }

    // Capture text input requests
    const inputs = [
      'set_p_url', 'set_p_user', 'set_p_pass', 'set_p_apikey', 
      'set_p_inbound', 'set_t_inbound', 'set_t_volume', 'set_t_days', 
      'set_reward_toman', 'add_prod', 'charge_user_bot', 'change_role_bot', 
      'settle_user_bot'
    ];
    if (inputs.includes(data)) {
      if (isAdmin) {
        adminSession.set(chatId, data);
        let promptText = '';
        if (data === 'set_p_url') promptText = '🔗 لطفا آدرس کانکشن پنل سنایی (X-UI) را ارسال کنید.\nمثال:\n`http://1.2.3.4:2053/`';
        if (data === 'set_p_user') promptText = '👤 لطفا نام کاربری مدیریت ورود به پنل سنایی را ارسال کنید:';
        if (data === 'set_p_pass') promptText = '🔑 لطفا رمز عبور مدیریت ورود به پنل سنایی را ارسال کنید:';
        if (data === 'set_p_apikey') promptText = '🔑 لطفا کلید API Key خام پنل جدید سنایی (X-UI) را بفرستید:';
        if (data === 'set_p_inbound') promptText = '🆔 لطفا آیدی عددی Inbound مدنظر خود در پنل سنایی را بفرستید:';
        if (data === 'set_t_inbound') promptText = '🆔 لطفا آیدی عددی Inbound اختصاصی پکیج‌های تست رایگان را بفرستید (در صورت تمایل به استفاده از اینباند پیش‌فرض اصلی عدد 0 را وارد بفرستید):';
        if (data === 'set_t_volume') promptText = '📦 حجم مورد نظر برای اکانت تست رایگان کاربر جدید را وارد کنید (به گیگابایت):';
        if (data === 'set_t_days') promptText = '⏰ مدت زمان اعتبار اکانت تست رایگان را وارد کنید (به روز):';
        if (data === 'set_reward_toman') promptText = '💰 هدیه دریافت پاداش برای زیرمجموعه‌گیری به تومان را بفرستید:';
        if (data === 'add_prod') promptText = '➕ لطفا فرمت پکیج محصول جدید را به صورت دقیق بنویسید و بفرستید:\n\n`نام محصول,قیمت(به تومان),حجم(به گیگ),زمان(به روز),آیدی اینباند(عددی اختیاری)`\n\nمثال بدون اینباند:\n`طرح برنزی,50000,15,30`\n\nمثال با اینباند اختصاصی شماره ۲:\n`طرح طلایی,120000,50,30,2`';
        if (data === 'charge_user_bot') promptText = '➕ لطفا شناسه کاربری (Chat ID) یا یوزرنیم تلگرام و میزان شارژ مطلوب به تومان را با یک فاصله بنویسید:\n\nمثال:\n`51239401 50000`\nیا\n`@user 50000`';
        if (data === 'change_role_bot') promptText = '🔄 لطفا شناسه کاربری (Chat ID) یا یوزرنیم تلگرام کاربر را جهت جابجایی بین همکار/عادی بفرستید.\n\nبعد از ارسال، ربات از شما در یک مرحله مجزا نیک‌نیم شخص را دریافت می‌کند.\n\nمثال:\n`14023924`\nیا\n`@ali_reza`';
        if (data === 'settle_user_bot') promptText = '💵 لطفا شناسه کاربری (Chat ID) همکار مدنظر را جهت تسویه کامل بدهی به مدیریت ارسال کنید:';

        bot!.sendMessage(chatId, `${promptText}\n\n⚠️ برای لغو فرآیند می‌توانید دستور دیگری بفرستید.`, { parse_mode: 'Markdown' });
      }
      bot!.answerCallbackQuery(query.id);
      return;
    }

    if (data && data.startsWith('del_prod_')) {
      if (isAdmin) {
        const prodId = data.replace('del_prod_', '');
        state.products = state.products.filter(p => p.id !== prodId);
        db.updateState({ products: state.products });
        bot!.sendMessage(chatId, '🗑 محصول با موفقیت حذف شد.');
        sendProductsMenu(chatId);
      }
      bot!.answerCallbackQuery(query.id);
      return;
    }

    if (data && data.startsWith('add_bal_')) {
      if (isAdmin) {
        const uid = Number(data.replace('add_bal_', ''));
        adminSession.set(chatId, `charge_direct_${uid}`);
        bot!.sendMessage(chatId, '🟢 لطفاً فقط مبلغ افزایش موجودی را (به تومان) ارسال کنید:');
      }
      bot!.answerCallbackQuery(query.id);
      return;
    }

    if (data && data.startsWith('sub_bal_')) {
      if (isAdmin) {
        const uid = Number(data.replace('sub_bal_', ''));
        adminSession.set(chatId, `sub_direct_${uid}`);
        bot!.sendMessage(chatId, '🔴 لطفاً فقط مبلغ کاهش موجودی را (به تومان) ارسال کنید:');
      }
      bot!.answerCallbackQuery(query.id);
      return;
    }

    if (data && data.startsWith('toggle_role_')) {
      if (isAdmin) {
        const uid = Number(data.replace('toggle_role_', ''));
        const u = db.getUser(uid);
        if (u) {
          u.isSeller = !u.isSeller;
          db.saveUser(u);
          bot!.sendMessage(chatId, `🔄 وضعیت نقش کاربر تغییر یافت.\nنقش جدید: ${u.isSeller ? 'همکار' : 'عادی'}`);
          if (u.isSeller) {
             adminSession.set(chatId, `set_nickname_${uid}`);
             bot!.sendMessage(chatId, `📝 لطفاً یک نام نمایشی (نیک‌نیم) برای این همکار در پنل گزارشات خود بنویسید (در غیر اینصورت "رد" را ارسال کنید):`);
          }
        }
      }
      bot!.answerCallbackQuery(query.id);
      return;
    }

    if (data && data.startsWith('del_user_')) {
      if (isAdmin) {
        const uid = Number(data.replace('del_user_', ''));
        state.users = state.users.filter(user => user.chatId !== uid);
        db.updateState({ users: state.users });
        bot!.sendMessage(chatId, `🗑 کاربر با آیدی ${uid} با موفقیت از دیتابیس ربات حذف شد.`);
      }
      bot!.answerCallbackQuery(query.id);
      return;
    }

    if (data && data.startsWith('send_msg_user_')) {
      if (isAdmin) {
        const targetId = data.replace('send_msg_user_', '');
        adminSession.set(chatId, `send_direct_message_to_${targetId}`);
        bot!.sendMessage(chatId, `✍️ لطفاً پیام خود را برای ارسال مستقیم به کاربر \`${targetId}\` بنویسید و ارسال کنید:`);
      }
      bot!.answerCallbackQuery(query.id);
      return;
    }

    if (data === 'buy_service_now') {
      await bot!.answerCallbackQuery(query.id).catch(() => {});
      const activeProducts = state.products.filter(p => !p.disabled);
      if (activeProducts.length === 0) {
        bot!.sendMessage(chatId, '❌ هیچ محصولی موجود نیست.');
        return;
      }

      const activeCategories = (state.categories || []).filter(c => !c.disabled);

      if (activeCategories.length > 0) {
        const inlineKeyboard = activeCategories.map(c => ([
          { text: `📁 ${c.name}`, callback_data: `show_category_${c.id}`, style: 'primary' }
        ]));
        if (activeProducts.some(p => isUncategorizedProduct(p, activeCategories))) {
          inlineKeyboard.push([{ text: `📁 سایر محصولات`, callback_data: `show_category_uncategorized`, style: 'primary' }]);
        }
        bot!.sendMessage(chatId, '🛍 <b>انتخاب دسته‌بندی</b>\nلطفاً دسته‌بندی محصول را انتخاب کنید:', {
           parse_mode: 'HTML',
           reply_markup: {
             inline_keyboard: inlineKeyboard
           } as any
        });
      } else {
        const inlineKeyboard = activeProducts.map(p => ([
          { text: getProductButtonText(user, p), callback_data: `buy_${p.id}`, style: 'primary' }
        ]));

        bot!.sendMessage(chatId, '🛍 <b>انتخاب محصول</b>\nلطفاً یک محصول انتخاب کنید:', {
           parse_mode: 'HTML',
           reply_markup: {
             inline_keyboard: inlineKeyboard
           } as any
        });
      }
      return;
    }

    if (data === 'seller_buy_menu') {
      await bot!.answerCallbackQuery(query.id).catch(() => {});
      const activeProducts = (state.products || []).filter(p => !p.disabled);
      if (activeProducts.length === 0) {
        bot!.sendMessage(chatId, '❌ هیچ محصولی موجود نیست.');
        return;
      }

      const activeCategories = (state.categories || []).filter(c => !c.disabled);

      if (activeCategories.length > 0) {
        const inlineKeyboard = activeCategories.map(c => ([
          { text: `📁 ${c.name}`, callback_data: `show_category_seller_${c.id}`, style: 'primary' }
        ]));
        if (activeProducts.some(p => isUncategorizedProduct(p, activeCategories))) {
          inlineKeyboard.push([{ text: `📁 سایر محصولات`, callback_data: `show_category_seller_uncategorized`, style: 'primary' }]);
        }
        bot!.sendMessage(chatId, '🛒 <b>خرید سرویس ویژه همکاران</b>\nلطفاً دسته‌بندی محصول را انتخاب کنید:', {
           parse_mode: 'HTML',
           reply_markup: {
             inline_keyboard: inlineKeyboard
           } as any
        });
      } else {
        const inlineKeyboard = activeProducts.map(p => ([
          { text: getProductButtonText(user, p), callback_data: `buy_${p.id}`, style: 'primary' }
        ]));

        bot!.sendMessage(chatId, '🛒 <b>خرید سرویس ویژه همکاران</b>\nلطفاً یک محصول انتخاب کنید:', {
           parse_mode: 'HTML',
           reply_markup: {
             inline_keyboard: inlineKeyboard
           } as any
        });
      }
      return;
    }

    if (data && data.startsWith('show_category_')) {
      await bot!.answerCallbackQuery(query.id).catch(() => {});
      const isSeller = data.startsWith('show_category_seller_');
      const categoryId = data.replace(isSeller ? 'show_category_seller_' : 'show_category_', '');
      
      const activeCategories = (state.categories || []).filter((c: any) => !c.disabled);
      const isUncat = categoryId === 'uncategorized';

      const filteredProducts = (state.products || []).filter(p => {
        if (p.disabled) return false;
        if (isUncat) {
          return isUncategorizedProduct(p, activeCategories);
        }
        return String(p.categoryId) === String(categoryId);
      });

      if (filteredProducts.length === 0) {
        await bot!.sendMessage(chatId, '❌ هیچ محصولی در این دسته موجود نیست.');
        return;
      }

      const inlineKeyboard = filteredProducts.map(p => ([
        { text: getProductButtonText(user, p), callback_data: `buy_${p.id}`, style: 'primary' }
      ]));

      // Back to categories button
      inlineKeyboard.push([
        { text: '🔙 بازگشت به دسته‌بندی‌ها', callback_data: isSeller ? 'seller_buy_menu' : 'buy_service_now', style: 'danger' }
      ]);

      const title = isSeller 
        ? '🛒 <b>خرید سرویس ویژه همکاران</b>:\nلطفاً یکی از پکیج‌های زیر را جهت ساخت اتوماتیک انتخاب کنید:' 
        : '🛍 <b>انتخاب پکیج و سرویس</b>:\nلطفاً یکی از محصولات زیر را انتخاب فرمایید:';

      await bot!.sendMessage(chatId, title, {
         parse_mode: 'HTML',
         reply_markup: {
           inline_keyboard: inlineKeyboard
         } as any
      });
      return;
    }

    if (data && data.startsWith('buy_') && !data.startsWith('buy_now_')) {
      await bot!.answerCallbackQuery(query.id).catch(() => {});
      const productId = data.replace('buy_', '');
      const product = state.products.find(p => String(p.id) === String(productId));

      if (!product) {
        bot!.sendMessage(chatId, '❌ محصول یافت نشد.');
        return;
      }

      let confirmMsg = `🛍 <b>تایید خرید: ${product.name}</b>\n\n`;
      const sellerDiscount = getSellerDiscountForProduct(user, product);
      if (sellerDiscount > 0) {
        const finalPrice = Math.max(0, Math.round(product.price * (1 - sellerDiscount / 100)));
        confirmMsg += `💵 قیمت اصلی: <s>${product.price.toLocaleString()}</s> تومان\n` +
                      `🎁 تخفیف اختصاصی همکار: <b>${sellerDiscount}٪</b> (${(product.price - finalPrice).toLocaleString()} تومان)\n` +
                      `💰 قیمت نهایی شما: <b>${finalPrice.toLocaleString()}</b> تومان\n\n`;
      } else {
        confirmMsg += `💰 قیمت سرویس: <b>${product.price.toLocaleString()}</b> تومان\n\n`;
      }

      const couponsList = (state.coupons || []).filter((c: any) => !c.giftAmount);
      if (couponsList.length > 0 && !user.isSeller) {
        confirmMsg += `🎫 آیا مایل هستید جهت پرداخت از <b>کد تخفیف</b> استفاده کنید؟`;
        bot!.sendMessage(chatId, confirmMsg, {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '🎫 ورود کد تخفیف', callback_data: `enter_coupon_${productId}`, style: 'primary' },
                { text: '🛒 خرید بدون تخفیف', callback_data: `buy_now_${productId}`, style: 'success' }
              ],
              [{ text: '❌ انصراف از خرید', callback_data: 'cancel_purchase', style: 'danger' }]
            ]
          }
        });
      } else {
        bot!.sendMessage(chatId, confirmMsg + `⚠️ آیا از خرید و فعالسازی این سرویس اطمینان دارید؟`, {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '✅ بله، خرید انجام شود', callback_data: `buy_now_${productId}`, style: 'success' },
                { text: '❌ خیر، انصراف', callback_data: 'cancel_purchase', style: 'danger' }
              ]
            ]
          }
        });
      }
      return;
    }

    if (data && data.startsWith('enter_coupon_')) {
      await bot!.answerCallbackQuery(query.id).catch(() => {});
      const productId = data.replace('enter_coupon_', '');
      userSession.set(chatId, { action: `awaiting_coupon_for_${productId}` });
      bot!.sendMessage(chatId, '🎫 لطفاً کد تخفیف خود را ارسال کنید:');
      return;
    }

    if (data && data.startsWith('buy_now_')) {
      await bot!.answerCallbackQuery(query.id).catch(() => {});
      let productId = '';
      let couponCode: string | undefined = undefined;

      if (data.startsWith('buy_now_with_coupon_')) {
        const couponParts = data.replace('buy_now_with_coupon_', '').split('_');
        productId = couponParts[0];
        couponCode = couponParts[1];
      } else {
        productId = data.replace('buy_now_', '');
      }

      const product = state.products.find(p => String(p.id) === String(productId));
      if (!product) {
        bot!.sendMessage(chatId, '❌ محصول یافت نشد.');
        return;
      }

      userSession.set(chatId, { action: 'awaiting_config_name', productId, couponCode });
      bot!.sendMessage(chatId, '📝 <b>انتخاب نام کانفیگ</b>\n\nآیا مایلید نام کانفیگ (Client Email) به صورت تصادفی تولید شود یا نام دلخواه خود را وارد می‌کنید؟\n<i>توجه: در صورت انتخاب نام دلخواه، باید نامی منحصر به فرد وارد کنید.</i>', {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🎲 تولید نام تصادفی', callback_data: 'config_name_random', style: 'primary' }],
            [{ text: '✏️ وارد کردن نام دلخواه', callback_data: 'config_name_custom', style: 'primary' }],
            [{ text: '❌ انصراف', callback_data: 'cancel_purchase', style: 'danger' }]
          ]
        }
      });
      return;
    }

    if (data === 'config_name_random') {
      await bot!.answerCallbackQuery(query.id).catch(() => {});
      const session = userSession.get(chatId);
      if (!session || session.action !== 'awaiting_config_name' || !session.productId) {
        bot!.sendMessage(chatId, '❌ نشست منقضی شده است. لطفا دوباره تلاش کنید.');
        return;
      }
      const product = state.products.find(p => String(p.id) === String(session.productId));
      if (!product) return;
      userSession.delete(chatId);
      await executePurchase(chatId, product, session.couponCode);
      return;
    }

    if (data === 'config_name_custom') {
      await bot!.answerCallbackQuery(query.id).catch(() => {});
      const session = userSession.get(chatId);
      if (!session || session.action !== 'awaiting_config_name' || !session.productId) {
        bot!.sendMessage(chatId, '❌ نشست منقضی شده است. لطفا دوباره تلاش کنید.');
        return;
      }
      userSession.set(chatId, { ...session, action: 'awaiting_custom_config_name' });
      bot!.sendMessage(chatId, '✏️ لطفا نام دلخواه خود را (فقط حروف انگلیسی، اعداد و خط تیره/زیرخط) بدون فاصله ارسال کنید:', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '❌ انصراف', callback_data: 'cancel_purchase', style: 'danger' }]
          ]
        }
      });
      return;
    }

    if (data === 'cancel_purchase') {
      await bot!.answerCallbackQuery(query.id).catch(() => {});
      bot!.sendMessage(chatId, '❌ فرآیند خرید لغو شد.');
      return;
    }
  } catch (err: any) {
    console.error('[Bot Callback Error]', err);
    try {
      if (query.id) {
        bot?.answerCallbackQuery(query.id, { text: 'خطایی در پردازش درخواست رخ داد.' }).catch(() => {});
      }
    } catch {}
  }
  });

  // Start daily sales and user report worker
  setInterval(async () => {
    try {
      const state = db.getState();
      if (state.adminIds.length > 0) {
        const lastSent = state.lastDailyReportSent || 0;
        const now = Date.now();
        const intervalMs = 24 * 60 * 60 * 1000; // 24 hours
        
        if (now - lastSent >= intervalMs) {
          const reportText = getDailyReportText();
          for (const adminId of state.adminIds) {
            try {
              await bot!.sendMessage(adminId, `🔔 <b>گزارش روزانه خودکار سیستم</b>\n\n` + reportText, { parse_mode: 'HTML' });
            } catch (err: any) {
              console.error(`[Daily Report Worker] Failed to send report to admin ${adminId}:`, err.message);
            }
          }
          db.updateState({ lastDailyReportSent: now });
        }
      }
    } catch (e: any) {
      console.error('[Daily Report Worker Error]', e.message);
    }
  }, 30 * 60 * 1000); // Check every 30 minutes

  // Start auto-backup worker
  setInterval(async () => {
    try {
      const state = db.getState();
      const intervalHours = state.autoBackupIntervalHours || 0;
      if (intervalHours > 0 && state.adminIds.length > 0) {
        const lastSent = state.lastAutoBackupSent || 0;
        const now = Date.now();
        const intervalMs = intervalHours * 60 * 60 * 1000;
        
        if (now - lastSent >= intervalMs) {
           // Time to send backup
           const mainAdmin = state.adminIds[0]; // first admin
           const rawData = fs.readFileSync(path.join(process.cwd(), 'db.json'), 'utf8');
           
           let payload = rawData;
           let isEncrypted = false;
           if (state.autoBackupPassword && state.autoBackupPassword.trim() !== '') {
             payload = encryptData(rawData, state.autoBackupPassword.trim());
             isEncrypted = true;
           }

           const backupFileName = `auto_backup_${Date.now()}.json`;
           const backupPath = path.join(process.cwd(), backupFileName);
           fs.writeFileSync(backupPath, payload, 'utf8');
           
           if (bot) {
             await bot.sendDocument(mainAdmin, backupPath, {
               caption: `🔄 <b>بکاپ خودکار ربات</b>\n\n` +
                        `این بکاپ طبق زمان‌بندی ${intervalHours} ساعته توسط سیستم ساخته و ارسال شده است.\n` +
                        (isEncrypted ? '🔒 این فایل با رمز عبور تعیین شده توسط شما رمزگذاری شده است. جهت استفاده در ری‌استور به آن نیاز خواهید داشت.\n' : '⚠️ این فایل رمزگذاری نشده است. برای امنیت بیشتر رمز بکاپ خودکار را تنظیم کنید.\n') +
                        `برای تغییر زمان‌بندی از طریق منوی مدیریت بخش "تنظیمات بکاپ خودکار" اقدام نمایید.`,
               parse_mode: 'HTML'
             });
             db.updateState({ lastAutoBackupSent: now });
           }
           
           try {
             fs.unlinkSync(backupPath); // clean up temp file
           } catch (e) {}
        }
      }
    } catch (e: any) {
      console.error('[Backup Check Worker Error]', e.message);
    }
  }, 10 * 60 * 1000); // Check every 10 minutes

  // Real-time limit check & PAYG billing worker (checks every 30 seconds)
  setInterval(async () => {
    try {
      const state = db.getState();
      const allClientsArray = await xui.getAllClientsWithTraffic();
      if (!allClientsArray || allClientsArray.length === 0) return;

      let inboundsList: any[] = [];
      const now = Date.now();

      for (const user of state.users) {
          if (!user.purchases || user.purchases.length === 0) continue;
          let userChanged = false;
          
          for (const purchase of user.purchases) {
              if (purchase.isDeleted) continue;
              const c = allClientsArray.find(cl => 
                (cl.email && purchase.id && cl.email.toLowerCase() === String(purchase.id).toLowerCase()) ||
                (cl.id && purchase.id && cl.id.toLowerCase() === String(purchase.id).toLowerCase()) ||
                (purchase.subUrl && cl.subId && purchase.subUrl.includes(cl.subId))
              );
              if (!c) continue;

              const total = c.total || 0;
              const used = (c.up || 0) + (c.down || 0);
              const expiry = c.expiryTime || 0;
              const enable = c.enable !== false;

              // PAY AS YOU GO (مصرف آزاد / بدون محدودیت) Real-time billing
              if (purchase.isPayAsYouGo && enable) {
                  const baseSettled = purchase.baseSettledBytes || 0;
                  // Handle case if traffic in X-UI was reset to less than baseSettled
                  if (used < (purchase.lastUsedBytes || 0) && used < baseSettled) {
                      purchase.baseSettledBytes = 0;
                      purchase.lastUsedBytes = used;
                  }

                  const effectiveLastUsed = Math.max(purchase.baseSettledBytes || 0, purchase.lastUsedBytes || 0);
                  if (used > effectiveLastUsed) {
                      const diffBytes = used - effectiveLastUsed;
                      const diffGb = diffBytes / (1024 * 1024 * 1024);
                      const rawPricePerGb = purchase.originalPricePerGb || purchase.pricePerGb || 0;
                      
                      if (user.isSeller) {
                          const discountPct = purchase.discountPercent !== undefined ? purchase.discountPercent : getSellerDiscountForProduct(user);
                          const discountedPricePerGb = Math.round(rawPricePerGb * (1 - discountPct / 100));
                          const cost = Math.ceil(diffGb * discountedPricePerGb);
                          
                          if (cost > 0) {
                              purchase.lastUsedBytes = used;
                              user.debt = (user.debt || 0) + cost;
                              user.totalSales = (user.totalSales || 0) + cost;
                              userChanged = true;

                              if (!isSellerUnlimitedLimit(user)) {
                                  const limit = user.debtLimit !== undefined && user.debtLimit > 0 ? user.debtLimit : 1000000;
                                  if ((user.debt || 0) >= limit) {
                                      if (!purchase.paygDisabled) {
                                          await xui.updateClientEnable(purchase.id, false);
                                          purchase.paygDisabled = true;
                                          bot!.sendMessage(user.chatId, `❌ <b>سقف بدهی همکار پر شد</b>\n\nسرویس مصرف آزاد (PAYG) «${purchase.name}» به دلیل رسیدن بدهی شما به سقف مجاز (${limit.toLocaleString()} تومان) غیرفعال شد. لطفاً جهت فعالسازی مجدد نسبت به تسویه حساب اقدام فرمایید.`, { parse_mode: 'HTML' });
                                      }
                                  }
                              }
                          }
                      } else {
                          const cost = Math.ceil(diffGb * (purchase.pricePerGb || 0));
                          if (cost > 0) {
                              purchase.lastUsedBytes = used;
                              user.balance = (user.balance || 0) - cost;
                              userChanged = true;

                              const pricePerGb = purchase.pricePerGb || 1;
                              const balanceEquivalentGb = pricePerGb > 0 ? (user.balance / pricePerGb) : 0;

                              if (user.balance <= 0) {
                                  user.balance = 0;
                                  if (!purchase.paygDisabled) {
                                      await xui.updateClientEnable(purchase.id, false);
                                      purchase.paygDisabled = true;
                                      bot!.sendMessage(user.chatId, `❌ <b>اتمام موجودی کیف پول و قطع سرویس مصرف آزاد</b>\n\n` +
                                        `📦 <b>سرویس:</b> ${purchase.name}\n` +
                                        `🆔 <b>شناسه سفارش:</b> <code>${purchase.id}</code>\n\n` +
                                        `💸 موجودی کیف پول شما به اتمام رسید (۰ تومان) و سرویس شما به طور موقت غیرفعال شد.\n\n` +
                                        `🔋 <b>جهت اتصال مجدد:</b> کافیست کیف پول خود را شارژ فرمایید. سرویس بلافاصله پس از شارژ خودکار فعال خواهد شد.`, { parse_mode: 'HTML' });
                                  }
                              } else if (balanceEquivalentGb < 1) { // less than 1GB equivalent remaining
                                  if (!purchase.warnedPayg) {
                                      bot!.sendMessage(user.chatId, `⚠️ <b>هشدار کمبود موجودی سرویس مصرف آزاد (PAYG)</b>\n\n` +
                                        `📦 <b>سرویس:</b> ${purchase.name}\n` +
                                        `💰 <b>موجودی باقیمانده:</b> ${user.balance.toLocaleString()} تومان\n` +
                                        `📊 <b>اعتبار تقریبی باقیمانده:</b> کمتر از ۱ گیگابایت (${balanceEquivalentGb.toFixed(2)} GB)\n\n` +
                                        `💡 جهت جلوگیری از قطع ناگهانی سرویس، لطفاً نسبت به شارژ کیف پول خود اقدام فرمایید.`, { parse_mode: 'HTML' });
                                      purchase.warnedPayg = true;
                                  }
                              } else {
                                  if (purchase.warnedPayg) {
                                      purchase.warnedPayg = false;
                                  }
                              }
                          }
                      }
                  } else if (used > (purchase.lastUsedBytes || 0)) {
                      purchase.lastUsedBytes = used;
                      userChanged = true;
                  }
              }

              // Auto-reactivate disabled PAYG if seller debt dropped below limit or client wallet was recharged
              if (purchase.isPayAsYouGo && purchase.paygDisabled) {
                  if (user.isSeller) {
                      const isUnlimited = isSellerUnlimitedLimit(user);
                      const limit = user.debtLimit !== undefined && user.debtLimit > 0 ? user.debtLimit : 1000000;
                      if (isUnlimited || (user.debt || 0) < limit) {
                          try {
                              await xui.updateClientEnable(purchase.id, true);
                              purchase.paygDisabled = false;
                              purchase.warnedPayg = false;
                              userChanged = true;
                              bot!.sendMessage(user.chatId, `✅ <b>فعالسازی مجدد سرویس مصرف آزاد (PAYG)</b>\n\nسرویس «${purchase.name}» با موفقیت مجدداً فعال گردید.`, { parse_mode: 'HTML' }).catch(() => {});
                          } catch (e) {}
                      }
                  } else if ((user.balance || 0) >= 1000) {
                      try {
                          await xui.updateClientEnable(purchase.id, true);
                          purchase.paygDisabled = false;
                          purchase.warnedPayg = false;
                          userChanged = true;
                          bot!.sendMessage(user.chatId, `✅ <b>فعالسازی مجدد سرویس مصرف آزاد (PAYG)</b>\n\nسرویس <b>${purchase.name}</b> به دلیل افزایش موجودی کیف پول، مجدداً فعال گردید.`, { parse_mode: 'HTML' }).catch(() => {});
                      } catch (e) {}
                  }
              }

              if (!purchase.isPayAsYouGo && used > (purchase.lastUsedBytes || 0)) {
                  purchase.lastUsedBytes = used;
                  userChanged = true;
              }

              const isVolumeExpired = total > 0 && used >= total;
              const isTimeExpired = expiry > 0 && now >= expiry;

              if (isVolumeExpired || isTimeExpired) {
                  if (!purchase.expiredAt) {
                      purchase.expiredAt = now;
                      userChanged = true;
                  } else {
                      const daysExpired = (now - purchase.expiredAt) / (1000 * 60 * 60 * 24);
                      if (daysExpired >= 7) {
                          try {
                              if (inboundsList.length === 0) {
                                inboundsList = await xui.getInbounds();
                              }
                              let ibId: number | undefined;
                              let cUuid: string | undefined;
                              for (const ib of inboundsList) {
                                  if (ib.settings) {
                                      const p = typeof ib.settings === 'string' ? JSON.parse(ib.settings) : ib.settings;
                                      if (p && p.clients) {
                                          const clientObj = p.clients.find((cl: any) => 
                                            (cl.email && purchase.id && cl.email.toLowerCase() === String(purchase.id).toLowerCase()) ||
                                            (cl.id && purchase.id && cl.id.toLowerCase() === String(purchase.id).toLowerCase()) ||
                                            (purchase.subUrl && cl.subId && purchase.subUrl.includes(cl.subId))
                                          );
                                          if (clientObj) {
                                              ibId = ib.id;
                                              cUuid = clientObj.id;
                                              break;
                                          }
                                      }
                                  }
                              }
                              if (ibId && cUuid) {
                                  await xui.delClient(ibId, cUuid);
                                  bot!.sendMessage(user.chatId, `🗑 <b>حذف سرویس منقضی شده</b>\n\nسرویس <b>${purchase.name}</b> (نام کانفیگ: <code>${purchase.id}</code>) به دلیل گذشت یک هفته از زمان انقضای آن، برای همیشه از سرور حذف گردید.`, { parse_mode: 'HTML' });
                                  
                                  // mark as deleted instead of removing so it persists in financial reports
                                  purchase.isDeleted = true;
                                  userChanged = true;
                                  continue; // Skip further warnings for this deleted config
                              }
                          } catch (e: any) {
                              console.error('[Bot] Failed to delete expired config:', e.message);
                          }
                      }
                  }
              } else {
                  if (purchase.expiredAt) {
                      purchase.expiredAt = undefined;
                      userChanged = true;
                  }
              }

              if (total > 0 && enable) {
                  const mbLeft = ((total - used) / (1024 * 1024));
                  if (mbLeft > 0 && mbLeft < 1000) { // < 1GB limit
                      if (!purchase.warnedData) {
                          bot!.sendMessage(user.chatId, `⚠️ <b>هشدار اتمام حجم سرویس</b>\n\n` +
                            `📦 <b>نام سرویس:</b> ${purchase.name}\n` +
                            `🆔 <b>شناسه کانفیگ:</b> <code>${purchase.id}</code>\n\n` +
                            `🔗 <b>لینک اشتراک شما:</b>\n<code>${purchase.subUrl}</code>\n\n` +
                            `💡 حجم باقی‌مانده این سرویس کمتر از ۱ گیگابایت می‌باشد. لطفا جهت تمدید اعتبار آن اقدام کنید.`, { parse_mode: 'HTML' });
                          purchase.warnedData = true;
                          userChanged = true;
                      }
                  } else if (mbLeft >= 1024) {
                      if (purchase.warnedData) {
                         purchase.warnedData = false;
                         userChanged = true;
                      }
                  }
              }

              if (expiry > 0 && enable) {
                  const hoursLeft = (expiry - now) / (1000 * 60 * 60);
                  if (hoursLeft > 0 && hoursLeft < 24) {
                      if (!purchase.warnedTime) {
                          bot!.sendMessage(user.chatId, `⚠️ <b>هشدار اتمام زمان سرویس</b>\n\n` +
                            `📦 <b>نام سرویس:</b> ${purchase.name}\n` +
                            `🆔 <b>شناسه کانفیگ:</b> <code>${purchase.id}</code>\n\n` +
                            `🔗 <b>لینک اشتراک شما:</b>\n<code>${purchase.subUrl}</code>\n\n` +
                            `💡 کمتر از ۲۴ ساعت به پایان اعتبار زمانی این سرویس باقی مانده است. لطفا جهت تمدید اعتبار آن اقدام کنید.`, { parse_mode: 'HTML' });
                          purchase.warnedTime = true;
                          userChanged = true;
                      }
                  } else if (hoursLeft >= 24) {
                      if (purchase.warnedTime) {
                          purchase.warnedTime = false;
                          userChanged = true;
                      }
                  }
              }
          }
          if (userChanged) {
             db.saveUser(user);
          }
      }
    } catch (e: any) {
        console.error('[Limit Check Worker Error]', e.message);
    }
  }, 30 * 1000); // Check every 30 seconds for near real-time PAYG billing & limits
}

export async function checkPaygReactivation(user: any) {
  if (!user || !user.purchases || user.purchases.length === 0) return;
  let userChanged = false;
  for (const purchase of user.purchases) {
    if (purchase.isPayAsYouGo && purchase.paygDisabled) {
      if (user.isSeller) {
        const isUnlimited = isSellerUnlimitedLimit(user);
        const limit = user.debtLimit !== undefined && user.debtLimit > 0 ? user.debtLimit : 1000000;
        if (isUnlimited || (user.debt || 0) < limit) {
          await xui.updateClientEnable(purchase.id, true);
          purchase.paygDisabled = false;
          purchase.warnedPayg = false;
          userChanged = true;
          bot!.sendMessage(user.chatId, `✅ <b>فعالسازی مجدد سرویس مصرف آزاد (PAYG)</b>\n\nسرویس «${purchase.name}» با موفقیت مجدداً فعال گردید.`, { parse_mode: 'HTML' });
        }
      } else if (user.balance > 0) {
        const pricePerGb = purchase.pricePerGb || 1;
        const balanceEquivalentGb = user.balance / pricePerGb;
        if (user.balance >= 1000 || balanceEquivalentGb >= 0.1) {
           await xui.updateClientEnable(purchase.id, true);
           purchase.paygDisabled = false;
           purchase.warnedPayg = false;
           userChanged = true;
           bot!.sendMessage(user.chatId, `✅ <b>فعالسازی مجدد سرویس مصرف آزاد (PAYG)</b>\n\nسرویس <b>${purchase.name}</b> به دلیل افزایش موجودی کیف پول، مجدداً فعال گردید.`, { parse_mode: 'HTML' });
        }
      }
    }
  }
  if (userChanged) {
    db.saveUser(user);
  }
}

export async function sendBroadcast(message: string) {
  const currentState = db.getState();
  let successCount = 0;
  let failCount = 0;

  if (!bot) {
    throw new Error('ربات تلگرام هنوز فعال نگردیده است و آماده ارسال نیست.');
  }

  const users = currentState.users || [];
  for (const u of users) {
    try {
      await bot.sendMessage(u.chatId, message);
      successCount++;
      // Sleep slightly to avoid spamming / rate-limiting
      await new Promise(resolve => setTimeout(resolve, 50));
    } catch (e) {
      failCount++;
    }
  }

  return { successCount, failCount };
}

export async function sendDirectMessage(chatId: number, text: string, replyMarkup?: any) {
  if (!bot) {
    console.error('[Bot Error] Cannot send direct message, bot is not initialized.');
    return;
  }
  try {
    await bot.sendMessage(chatId, text, {
      parse_mode: 'HTML',
      reply_markup: replyMarkup
    });
  } catch (err: any) {
    console.error(`[Bot Error] Failed to send direct message to ${chatId}:`, err.message);
  }
}

export async function syncAllUsersAndSellersFinancials(): Promise<{ updatedCount: number }> {
  let updatedCount = 0;
  try {
    const state = db.getState();
    const allClientsArray = await xui.getAllClientsWithTraffic().catch(() => [] as any[]);
    const users = state.users || [];

    for (const user of users) {
      let userChanged = false;

      if (user.isSeller) {
        // 1. If seller has any positive balance (e.g. from previously approved deposits), convert to totalPayments & reduce debt
        if ((user.balance || 0) > 0) {
          user.totalPayments = (user.totalPayments || 0) + user.balance;
          user.debt = Math.max(0, (user.debt || 0) - user.balance);
          user.balance = 0;
          userChanged = true;
        }

        // 2. Reconcile all purchases with discounts
        const purchases = user.purchases || [];
        let totalOriginalPrice = 0;
        let totalFinalPrice = 0;
        let totalDiscounts = 0;
        let totalPaygActiveDebt = 0;
        let totalPaygSettledFin = 0;
        let totalFixedFin = 0;
        let hasPayg = false;

        for (const p of purchases) {
          const clientObj = allClientsArray.find(cl => 
            (cl.email && p.id && cl.email.toLowerCase() === String(p.id).toLowerCase()) ||
            (cl.id && p.id && cl.id.toLowerCase() === String(p.id).toLowerCase()) ||
            (p.subUrl && cl.subId && p.subUrl.includes(cl.subId))
          );
          let currentUsed = 0;
          if (clientObj) {
            currentUsed = (clientObj.up || 0) + (clientObj.down || 0);
            if (currentUsed > (p.lastUsedBytes || 0)) {
              p.lastUsedBytes = currentUsed;
              userChanged = true;
            }
          } else {
            currentUsed = (p.lastUsedBytes || 0);
          }

          let orig = p.originalPrice !== undefined ? p.originalPrice : (p.price || 0);
          let fin = p.price !== undefined ? p.price : 0;

          if (p.isPayAsYouGo) {
            hasPayg = true;
            const baseSettled = p.baseSettledBytes || 0;
            const effectiveBase = (currentUsed < baseSettled) ? 0 : baseSettled;
            const billableBytes = Math.max(0, currentUsed - effectiveBase);
            const billableGb = billableBytes / (1024 * 1024 * 1024);
            const settledGb = effectiveBase / (1024 * 1024 * 1024);

            const rawPricePerGb = p.originalPricePerGb || p.pricePerGb || 0;
            const discountPct = p.discountPercent !== undefined ? p.discountPercent : getSellerDiscountForProduct(user, p);
            const discountedPricePerGb = Math.round(rawPricePerGb * (1 - discountPct / 100));

            const settledOrig = Math.ceil(settledGb * rawPricePerGb);
            const settledFin = Math.ceil(settledGb * discountedPricePerGb);

            const currentOrig = Math.ceil(billableGb * rawPricePerGb);
            const currentFin = Math.ceil(billableGb * discountedPricePerGb);

            orig = settledOrig + currentOrig;
            fin = settledFin + currentFin;

            totalPaygActiveDebt += currentFin;
            totalPaygSettledFin += settledFin;
          } else {
            if (orig <= fin && p.discountPercent && p.discountPercent > 0) {
              orig = Math.round(fin / (1 - p.discountPercent / 100));
            }
            totalFixedFin += fin;
          }

          if (orig < fin) orig = fin;

          totalOriginalPrice += orig;
          totalFinalPrice += fin;
          totalDiscounts += Math.max(0, orig - fin);
        }

        // Reconcile totalSales to equal total final net invoice
        if (user.totalSales !== totalFinalPrice) {
          user.totalSales = totalFinalPrice;
          userChanged = true;
        }

        // Reconcile debt:
        // 1. Unsettled active PAYG traffic is ALWAYS active debt of the current billing cycle.
        // 2. Fixed packages: totalFixedFin is the sum of fixed package prices.
        // 3. Recorded payments: user.totalPayments is total money paid/settled by the seller.
        // 4. Settled PAYG accounts for totalPaygSettledFin of the recorded payments.
        // 5. Any payments beyond settled PAYG cover fixed packages.
        const recordedPayments = user.totalPayments || 0;
        const paymentsForFixed = Math.max(0, recordedPayments - totalPaygSettledFin);
        const activeFixedDebt = Math.max(0, totalFixedFin - paymentsForFixed);
        const trueActiveDebt = activeFixedDebt + totalPaygActiveDebt;

        let correctDebt = trueActiveDebt;
        if (purchases.length === 0) {
          correctDebt = user.debt || 0;
        }

        if (user.debt !== correctDebt) {
          user.debt = correctDebt;
          userChanged = true;
        }

        // Reconcile totalPayments so that totalSales - totalPayments = debt
        const correctPayments = Math.max(recordedPayments, totalFinalPrice - correctDebt);
        if (user.totalPayments !== correctPayments) {
          user.totalPayments = correctPayments;
          userChanged = true;
        }

        // Auto-reactivate disabled PAYG if seller's debt is within limit
        const isUnlimited = isSellerUnlimitedLimit(user);
        const limit = user.debtLimit !== undefined && user.debtLimit > 0 ? user.debtLimit : 1000000;
        if (isUnlimited || (user.debt || 0) < limit) {
          for (const p of purchases) {
            if (p.isPayAsYouGo && p.paygDisabled) {
              try {
                await xui.updateClientEnable(p.id, true);
                p.paygDisabled = false;
                p.warnedPayg = false;
                userChanged = true;
                if (bot) {
                  bot.sendMessage(user.chatId, `✅ <b>فعالسازی مجدد سرویس مصرف آزاد (PAYG)</b>\n\nسرویس «${p.name || p.id}» با موفقیت مجدداً فعال گردید.`, { parse_mode: 'HTML' }).catch(() => {});
                }
              } catch (e) {}
            }
          }
        }
      }

      if (userChanged) {
        db.saveUser(user);
        updatedCount++;
      }
    }

    if (updatedCount > 0) {
      console.log(`[Financials Sync] Successfully reconciled accounts for ${updatedCount} user(s)/seller(s).`);
    }
  } catch (err: any) {
    console.error('[Financials Sync Error]', err.message);
  }
  return { updatedCount };
}
