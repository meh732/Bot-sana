import { User, Purchase, UserTransaction, db } from './db.js';

export interface SalesItemDetail {
  index: number;
  id: string;
  name: string;
  volumeGb: number;
  durationDays: number;
  price: number;
  originalPrice: number;
  discountAmount: number;
  discountPercent: number;
  panelType: string;
  panelLabel: string;
  isPayAsYouGo: boolean;
  createdAt: string;
  dateStr: string;
  timeStr: string;
}

export interface AccountingLedgerRow {
  id: string;
  dateStr: string;
  timeStr: string;
  rawDate: string;
  type: string;
  description: string;
  debit: number; // بدهکار (خرید / هزینه)
  credit: number; // بستانکار (واریزی / تسویه)
  runningBalance: number; // مانده حساب
}

export interface UserAccountingReport {
  user: {
    chatId: number;
    username?: string;
    nickname?: string;
    isSeller: boolean;
    balance: number;
    debt: number;
    debtLimit: number;
    isUnlimitedLimit: boolean;
    totalSales: number;
    totalPayments: number;
  };
  period: 'today' | 'monthly' | 'all';
  periodLabel: string;
  startDate: string;
  endDate: string;
  summary: {
    totalCount: number;
    totalVolumeGb: number;
    totalSalesAmount: number;
    totalDiscounts: number;
    totalOriginalAmount: number;
    totalPaymentsInPeriod: number;
    totalDebits: number;
    totalCredits: number;
    currentDebt: number;
    currentBalance: number;
    remainingCredit: number | null;
    isUnlimited: boolean;
  };
  salesItems: SalesItemDetail[];
  ledgerRows: AccountingLedgerRow[];
}

export interface SystemAccountingReport {
  period: 'today' | 'monthly' | 'all';
  periodLabel: string;
  summary: {
    totalSalesCount: number;
    totalSalesAmount: number;
    totalVolumeGb: number;
    totalSellersActive: number;
    totalRegularSalesAmount: number;
    totalSellerSalesAmount: number;
    totalPaymentsRecorded: number;
  };
  sellerBreakdowns: {
    seller: {
      chatId: number;
      username?: string;
      nickname?: string;
      debt: number;
    };
    count: number;
    volumeGb: number;
    salesAmount: number;
    items: SalesItemDetail[];
  }[];
  recentSales: (SalesItemDetail & { userChatId: number; userDisplayName: string })[];
}

function getPanelBadgeAndLabel(panelType?: string): { badge: string; label: string } {
  switch (panelType) {
    case 'sanaei': return { badge: '🔵', label: 'سنایی (X-UI)' };
    case 'rebecca': return { badge: '🟣', label: 'ربکا (Rebecca)' };
    case 'mrocean': return { badge: '🌊', label: 'مستر اوشن (MR OCEAN)' };
    case 'sanaei_rebecca':
    case 'both': return { badge: '⚡️', label: 'سنایی + ربکا' };
    case 'sanaei_mrocean': return { badge: '⚡️', label: 'سنایی + مستر اوشن' };
    case 'rebecca_mrocean': return { badge: '⚡️', label: 'ربکا + مستر اوشن' };
    case 'all': return { badge: '🚀', label: 'همه ۳ پنل همزمان' };
    default: return { badge: '🔵', label: 'سنایی' };
  }
}

function getPeriodTimeRange(period: 'today' | 'monthly' | 'all'): { startMs: number; endMs: number; label: string } {
  const now = Date.now();
  if (period === 'today') {
    // 24 hours window
    const startMs = now - 24 * 60 * 60 * 1000;
    return { startMs, endMs: now, label: 'امروز (۲۴ ساعت گذشته)' };
  }
  if (period === 'monthly') {
    // 30 days window
    const startMs = now - 30 * 24 * 60 * 60 * 1000;
    return { startMs, endMs: now, label: 'ماهانه (۳۰ روز اخیر)' };
  }
  return { startMs: 0, endMs: now, label: 'کل دوره (از ابتدا تاکنون)' };
}

export function getUserAccountingReport(user: User, period: 'today' | 'monthly' | 'all' = 'today'): UserAccountingReport {
  const { startMs, endMs, label: periodLabel } = getPeriodTimeRange(period);
  const purchases = (user.purchases || []).filter(p => !p.isDeleted);

  // Filter purchases in period
  const periodPurchases = purchases.filter(p => {
    if (!p.createdAt) return period === 'all';
    const t = new Date(p.createdAt).getTime();
    return t >= startMs && t <= endMs;
  });

  // Sort descending (latest first)
  periodPurchases.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  let totalCount = periodPurchases.length;
  let totalVolumeGb = 0;
  let totalSalesAmount = 0;
  let totalDiscounts = 0;
  let totalOriginalAmount = 0;

  const salesItems: SalesItemDetail[] = periodPurchases.map((p, idx) => {
    const vol = p.isPayAsYouGo ? 0 : (Number(p.volumeGb) || 0);
    totalVolumeGb += vol;

    const price = Number(p.price) || 0;
    const origPrice = Number(p.originalPrice) || price;
    const discount = p.discountAmount !== undefined ? p.discountAmount : Math.max(0, origPrice - price);
    const discountPct = p.discountPercent || (origPrice > 0 ? Math.round((discount / origPrice) * 100) : 0);

    totalSalesAmount += price;
    totalOriginalAmount += origPrice;
    totalDiscounts += discount;

    const dt = new Date(p.createdAt || Date.now());
    const dateStr = dt.toLocaleDateString('fa-IR');
    const timeStr = dt.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });
    const { badge, label } = getPanelBadgeAndLabel(p.panelType);

    return {
      index: idx + 1,
      id: p.id || '',
      name: p.name || 'کانفیگ',
      volumeGb: vol,
      durationDays: p.durationDays || 0,
      price,
      originalPrice: origPrice,
      discountAmount: discount,
      discountPercent: discountPct,
      panelType: p.panelType || 'sanaei',
      panelLabel: `${badge} ${label}`,
      isPayAsYouGo: !!p.isPayAsYouGo,
      createdAt: p.createdAt || new Date().toISOString(),
      dateStr,
      timeStr
    };
  });

  // Build Comprehensive Accounting Ledger Rows (دفتر معین دریافت و پرداخت)
  const ledgerRows: AccountingLedgerRow[] = [];
  
  // 1. Add all purchases as DEBITS (بدهکار)
  purchases.forEach(p => {
    const dt = new Date(p.createdAt || Date.now());
    const volStr = p.isPayAsYouGo ? 'مصرف آزاد' : `${p.volumeGb || 0}GB`;
    const durStr = p.isPayAsYouGo ? '' : ` (${p.durationDays || 0} روز)`;
    ledgerRows.push({
      id: `p_${p.id}_${dt.getTime()}`,
      rawDate: p.createdAt || dt.toISOString(),
      dateStr: dt.toLocaleDateString('fa-IR'),
      timeStr: dt.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' }),
      type: 'purchase',
      description: `خرید کانفیگ: ${p.name || p.id} [${volStr}${durStr}]`,
      debit: p.price || 0,
      credit: 0,
      runningBalance: 0
    });
  });

  // 2. Add recorded transactions or payments as CREDITS (بستانکار)
  if (user.transactions && user.transactions.length > 0) {
    user.transactions.forEach(tx => {
      const dt = new Date(tx.createdAt || Date.now());
      ledgerRows.push({
        id: tx.id,
        rawDate: tx.createdAt,
        dateStr: dt.toLocaleDateString('fa-IR'),
        timeStr: dt.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' }),
        type: tx.type,
        description: tx.description || 'تراکنش مالی',
        debit: tx.direction === 'debit' ? tx.amount : 0,
        credit: tx.direction === 'credit' ? tx.amount : 0,
        runningBalance: 0
      });
    });
  } else if ((user.totalPayments || 0) > 0) {
    // If no granular tx log exists yet, record aggregate payments
    const dt = new Date(user.registeredAt || Date.now());
    ledgerRows.push({
      id: `agg_pay_${user.chatId}`,
      rawDate: dt.toISOString(),
      dateStr: dt.toLocaleDateString('fa-IR'),
      timeStr: dt.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' }),
      type: 'payment',
      description: 'مجموع واریزی‌ها و تسویه‌حساب‌های ثبت‌شده',
      debit: 0,
      credit: user.totalPayments || 0,
      runningBalance: 0
    });
  }

  // Sort chronological (oldest to newest) to calculate running balance
  ledgerRows.sort((a, b) => new Date(a.rawDate).getTime() - new Date(b.rawDate).getTime());

  let currentRunning = 0;
  let totalDebits = 0;
  let totalCredits = 0;

  ledgerRows.forEach(row => {
    totalDebits += row.debit;
    totalCredits += row.credit;
    // For a seller: Debit increases debt, Credit decreases debt
    currentRunning += (row.debit - row.credit);
    row.runningBalance = currentRunning;
  });

  // Reverse so newest appears at top for viewing
  ledgerRows.reverse();

  const isUnlimited = !!user.isUnlimitedLimit;
  const limit = user.debtLimit !== undefined && user.debtLimit > 0 ? user.debtLimit : 1000000;
  const currentDebt = user.debt || 0;
  const remainingCredit = isUnlimited ? null : Math.max(0, limit - currentDebt);

  return {
    user: {
      chatId: user.chatId,
      username: user.username,
      nickname: user.nickname,
      isSeller: !!user.isSeller,
      balance: user.balance || 0,
      debt: currentDebt,
      debtLimit: limit,
      isUnlimitedLimit: isUnlimited,
      totalSales: user.totalSales || 0,
      totalPayments: user.totalPayments || 0
    },
    period,
    periodLabel,
    startDate: new Date(startMs).toISOString(),
    endDate: new Date(endMs).toISOString(),
    summary: {
      totalCount,
      totalVolumeGb,
      totalSalesAmount,
      totalDiscounts,
      totalOriginalAmount,
      totalPaymentsInPeriod: totalCredits,
      totalDebits,
      totalCredits,
      currentDebt,
      currentBalance: user.balance || 0,
      remainingCredit,
      isUnlimited
    },
    salesItems,
    ledgerRows
  };
}

export function getSystemAccountingReport(period: 'today' | 'monthly' | 'all' = 'today'): SystemAccountingReport {
  const state = db.getState();
  const { startMs, endMs, label: periodLabel } = getPeriodTimeRange(period);

  let totalSalesCount = 0;
  let totalSalesAmount = 0;
  let totalVolumeGb = 0;
  let totalRegularSalesAmount = 0;
  let totalSellerSalesAmount = 0;
  let totalPaymentsRecorded = 0;

  const sellerMap = new Map<number, {
    seller: { chatId: number; username?: string; nickname?: string; debt: number };
    count: number;
    volumeGb: number;
    salesAmount: number;
    items: SalesItemDetail[];
  }>();

  const recentSales: (SalesItemDetail & { userChatId: number; userDisplayName: string })[] = [];

  state.users.forEach(u => {
    totalPaymentsRecorded += (u.totalPayments || 0);
    const uPurchases = (u.purchases || []).filter(p => !p.isDeleted);
    const uDisplayName = u.nickname || (u.username ? `@${u.username}` : `شناسه ${u.chatId}`);

    uPurchases.forEach(p => {
      if (!p.createdAt) return;
      const t = new Date(p.createdAt).getTime();
      if (t >= startMs && t <= endMs) {
        totalSalesCount++;
        const price = Number(p.price) || 0;
        const vol = p.isPayAsYouGo ? 0 : (Number(p.volumeGb) || 0);
        totalSalesAmount += price;
        totalVolumeGb += vol;

        if (u.isSeller) {
          totalSellerSalesAmount += price;
        } else {
          totalRegularSalesAmount += price;
        }

        const dt = new Date(p.createdAt);
        const { badge, label } = getPanelBadgeAndLabel(p.panelType);
        const itemDetail: SalesItemDetail = {
          index: 0,
          id: p.id,
          name: p.name || 'کانفیگ',
          volumeGb: vol,
          durationDays: p.durationDays || 0,
          price,
          originalPrice: p.originalPrice || price,
          discountAmount: p.discountAmount || 0,
          discountPercent: p.discountPercent || 0,
          panelType: p.panelType || 'sanaei',
          panelLabel: `${badge} ${label}`,
          isPayAsYouGo: !!p.isPayAsYouGo,
          createdAt: p.createdAt,
          dateStr: dt.toLocaleDateString('fa-IR'),
          timeStr: dt.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })
        };

        recentSales.push({ ...itemDetail, userChatId: u.chatId, userDisplayName: uDisplayName });

        if (u.isSeller) {
          let sEntry = sellerMap.get(u.chatId);
          if (!sEntry) {
            sEntry = {
              seller: {
                chatId: u.chatId,
                username: u.username,
                nickname: u.nickname,
                debt: u.debt || 0
              },
              count: 0,
              volumeGb: 0,
              salesAmount: 0,
              items: []
            };
            sellerMap.set(u.chatId, sEntry);
          }
          sEntry.count++;
          sEntry.volumeGb += vol;
          sEntry.salesAmount += price;
          sEntry.items.push(itemDetail);
        }
      }
    });
  });

  // Sort recent sales descending
  recentSales.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const sellerBreakdowns = Array.from(sellerMap.values()).sort((a, b) => b.salesAmount - a.salesAmount);

  return {
    period,
    periodLabel,
    summary: {
      totalSalesCount,
      totalSalesAmount,
      totalVolumeGb,
      totalSellersActive: sellerBreakdowns.length,
      totalRegularSalesAmount,
      totalSellerSalesAmount,
      totalPaymentsRecorded
    },
    sellerBreakdowns,
    recentSales
  };
}

export function formatUserSalesReportTelegram(user: User, period: 'today' | 'monthly' | 'all' = 'today', isAdmin: boolean = false): string {
  const report = getUserAccountingReport(user, period);
  const uName = user.nickname || (user.username ? `@${user.username}` : `کاربر ${user.chatId}`);
  const roleStr = user.isSeller ? '💎 همکار فروشنده' : '👤 کاربر عادی';

  let msg = `📊 <b>گزارش دقیق فروش و صورتحساب ${report.periodLabel}</b>\n\n` +
    `👤 <b>شخص:</b> <b>${escapeHtml(uName)}</b>\n` +
    `🆔 <b>شناسه عددی:</b> <code>${user.chatId}</code>\n` +
    `⚡ <b>نقش در سیستم:</b> <b>${roleStr}</b>\n` +
    `📅 <b>تاریخ تهیه گزارش:</b> <code>${new Date().toLocaleDateString('fa-IR')} ${new Date().toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })}</code>\n\n`;

  // 1. Detailed Sales List
  if (report.salesItems.length === 0) {
    msg += `ℹ️ <i>در بازه ${report.periodLabel} هیچ فروشی برای این حساب ثبت نشده است.</i>\n\n`;
  } else {
    msg += `🛒 <b>ریز کانفیگ‌های فروخته‌شده در این دوره (${report.salesItems.length} پکیج):</b>\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n`;

    report.salesItems.forEach((item, i) => {
      const volStr = item.isPayAsYouGo ? '⚡ مصرف آزاد (PAYG)' : `📦 ${item.volumeGb} GB (${item.durationDays} روز)`;
      const discountText = item.discountAmount > 0 
        ? ` (تخفیف: ${item.discountAmount.toLocaleString()} ت)` 
        : '';
      
      msg += `<b>${i + 1}.</b> 🏷 <b>${escapeHtml(item.name)}</b>\n` +
             `   ▫️ شناسه: <code>${escapeHtml(item.id)}</code>\n` +
             `   ▫️ حجم و مدت: <b>${volStr}</b>\n` +
             `   ▫️ مبلغ فاکتور: <b>${item.price.toLocaleString()} تومان</b>${discountText}\n` +
             `   ▫️ سرور: ${item.panelLabel}\n` +
             `   🕒 زمان: <code>${item.timeStr} - ${item.dateStr}</code>\n\n`;
    });
    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
  }

  // 2. Performance Summary Box
  msg += `📈 <b>سرجمع عملکرد فروش در این دوره:</b>\n` +
         `▫️ تعداد کل کانفیگ‌های فروخته‌شده: <b>${report.summary.totalCount} عدد</b>\n` +
         `▫️ مجموع حجم ترافیک واگذار شده: <b>${report.summary.totalVolumeGb.toFixed(2)} GB</b>\n` +
         `▫️ مجموع کل مبالغ فروش فاکتورها: <b>${report.summary.totalSalesAmount.toLocaleString()} تومان</b>\n` +
         (report.summary.totalDiscounts > 0 ? `▫️ مجموع تخفیفات اختصاصی دوره: <b>${report.summary.totalDiscounts.toLocaleString()} تومان</b>\n\n` : '\n');

  // 3. Accounting & Financial Statement Box
  const limitStr = report.summary.isUnlimited ? '⚡ سقف آزاد (نامحدود)' : `*${report.user.debtLimit.toLocaleString()}* تومان`;
  const remainsStr = report.summary.isUnlimited ? 'نامحدود' : `${(report.summary.remainingCredit || 0).toLocaleString()} تومان`;

  if (user.isSeller) {
    msg += `🧾 <b>صورتحساب مالی و تراز حسابداری همکار:</b>\n` +
           `▫️ مجموع کل بدهکاری (خریدها از ابتدا): <b>${(user.totalSales || report.summary.totalDebits).toLocaleString()} تومان</b>\n` +
           `▫️ مجموع کل بستانکاری (واریزی و تسویه‌ها): <b>${(user.totalPayments || 0).toLocaleString()} تومان</b>\n` +
           `▫️ بدهی قطعی باقیمانده فعلی: <b>${report.summary.currentDebt.toLocaleString()} تومان</b>\n` +
           `▫️ سقف اعتبار مجاز همکار: ${limitStr}\n` +
           `▫️ اعتبار خرید باقیمانده: <b>${remainsStr}</b>\n`;
  } else {
    msg += `🧾 <b>صورتحساب و موجودی کیف پول کاربر:</b>\n` +
           `▫️ کل خریدهای ثبت شده: <b>${report.summary.totalDebits.toLocaleString()} تومان</b>\n` +
           `▫️ موجودی کیف پول فعلی: <b>${report.user.balance.toLocaleString()} تومان</b>\n`;
  }

  return msg;
}

export function formatAccountingLedgerStatementTelegram(user: User): string {
  const report = getUserAccountingReport(user, 'all');
  const uName = user.nickname || (user.username ? `@${user.username}` : `کاربر ${user.chatId}`);

  let msg = `📑 <b>صورتحساب رسمی حسابداری و دفتر معین</b>\n\n` +
    `👤 <b>طرف حساب:</b> <b>${escapeHtml(uName)}</b> (<code>${user.chatId}</code>)\n` +
    `⚡ <b>وضعیت حساب:</b> <b>${user.isSeller ? 'همکار فروشنده' : 'کاربر عادی'}</b>\n` +
    `📅 <b>تاریخ صدور:</b> <code>${new Date().toLocaleDateString('fa-IR')} ${new Date().toLocaleTimeString('fa-IR')}</code>\n\n` +
    `📜 <b>گردش دریافت‌ها و پرداخت‌ها (به ترتیب زمان):</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n`;

  if (report.ledgerRows.length === 0) {
    msg += `ℹ️ <i>هیچ تراکنش یا گردش مالی برای این کاربر ثبت نشده است.</i>\n\n`;
  } else {
    report.ledgerRows.slice(0, 15).forEach((row, i) => {
      const isDebit = row.debit > 0;
      const typeIcon = isDebit ? '🔴 خرید/بدهکار' : '🟢 واریز/بستانکار';
      const amountVal = isDebit ? row.debit : row.credit;

      msg += `<b>${i + 1}.</b> ${typeIcon}: <b>${amountVal.toLocaleString()} ت</b>\n` +
             `   📝 شرح: ${escapeHtml(row.description)}\n` +
             `   🕒 تاریخ: <code>${row.dateStr} ${row.timeStr}</code>\n` +
             `   ⚖️ مانده تراز لحظه‌ای: <code>${row.runningBalance.toLocaleString()} ت</code>\n\n`;
    });

    if (report.ledgerRows.length > 15) {
      msg += `<i>... و ${report.ledgerRows.length - 15} ردیف قدیمی‌تر دیگر در تاریخچه حسابداری موجود است.</i>\n\n`;
    }
    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
  }

  msg += `📊 <b>تراز نهایی صورتحساب:</b>\n` +
         `▫️ جمع کل بدهکار (خریدها): <b>${report.summary.totalDebits.toLocaleString()} تومان</b>\n` +
         `▫️ جمع کل بستانکار (پرداخت‌ها): <b>${report.summary.totalCredits.toLocaleString()} تومان</b>\n` +
         `▫️ <b>مانده بدهی باقیمانده:</b> <b>${report.summary.currentDebt.toLocaleString()} تومان</b>\n`;

  return msg;
}

export function formatSystemSalesReportTelegram(period: 'today' | 'monthly' | 'all' = 'today'): string {
  const rep = getSystemAccountingReport(period);

  let msg = `📊 <b>گزارش جامع حسابداری و فروش سیستم (${rep.periodLabel})</b>\n\n` +
    `📅 تاریخ گزارش: <code>${new Date().toLocaleDateString('fa-IR')} ${new Date().toLocaleTimeString('fa-IR')}</code>\n\n` +
    `💰 <b>آمار کل فروش در این دوره:</b>\n` +
    `▫️ کل مبلغ فروش سیستم: <b>${rep.summary.totalSalesAmount.toLocaleString()} تومان</b>\n` +
    `▫️ تعداد کل کانفیگ‌های ساخته‌شده: <b>${rep.summary.totalSalesCount} عدد</b>\n` +
    `▫️ کل حجم ترافیک واگذار شده: <b>${rep.summary.totalVolumeGb.toFixed(2)} GB</b>\n` +
    `▫️ سهم فروش به همکاران: <b>${rep.summary.totalSellerSalesAmount.toLocaleString()} تومان</b>\n` +
    `▫️ سهم فروش به کاربران عادی: <b>${rep.summary.totalRegularSalesAmount.toLocaleString()} تومان</b>\n\n`;

  if (rep.sellerBreakdowns.length > 0) {
    msg += `👥 <b>تفکیک فروش به ازای هر همکار (${rep.sellerBreakdowns.length} همکار فعال):</b>\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n`;

    rep.sellerBreakdowns.forEach((sb, i) => {
      const sName = sb.seller.nickname || (sb.seller.username ? `@${sb.seller.username}` : `همکار ${sb.seller.chatId}`);
      msg += `<b>${i + 1}.</b> 👤 <b>${escapeHtml(sName)}</b> (<code>${sb.seller.chatId}</code>)\n` +
             `   ▫️ تعداد فروش: <b>${sb.count} عدد</b>\n` +
             `   ▫️ مجموع حجم: <b>${sb.volumeGb.toFixed(2)} GB</b>\n` +
             `   ▫️ مجموع مبلغ فروش: <b>${sb.salesAmount.toLocaleString()} تومان</b>\n` +
             `   ▫️ بدهی فعلی: <b>${sb.seller.debt.toLocaleString()} تومان</b>\n\n`;
    });
    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
  } else {
    msg += `ℹ️ <i>در این بازه زمانی هیچ فروش فعالی توسط همکاران ثبت نشده است.</i>\n`;
  }

  return msg;
}

function escapeHtml(text: string): string {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
