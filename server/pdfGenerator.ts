let PDFDocument: any = null;
try {
  // @ts-ignore
  PDFDocument = require('pdfkit');
} catch {
  PDFDocument = null;
}
import fs from 'fs';
import path from 'path';
// @ts-ignore
import apr from 'arabic-persian-reshaper';
import * as jalaali from 'jalaali-js';
import { User, Purchase } from './db.js';
import { getUserAccountingReport, formatShamsiDate } from './accounting.js';

export function normalizeDigitsToEnglish(str: string): string {
  return (str || '')
    .replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
}

export function fixRTL(str: string | number | null | undefined): string {
  if (str === null || str === undefined) return '';
  const s = normalizeDigitsToEnglish(String(str).trim());
  if (!s) return '';
  
  try {
    const reshaped = apr.PersianShaper.convertArabic(s);

    // Tokenize preserving:
    // 1. Whitespace
    // 2. Parentheses, brackets, braces, quotes
    // 3. Latin words, numbers, codes, usernames, URLs, dates (e.g. 1405/07/25, 1,072,056, @user, BG001)
    // 4. Persian/Arabic words (including ZWNJ \u200C) and any trailing punctuation attached (:, ., ،, ؟, !)
    // 5. Any other characters
    const tokenRegex = /(\s+|[\(\)\[\]\{\}«»]|[a-zA-Z0-9\+\-\/\@\%\#\_]+(?:[\:\,\.\/][a-zA-Z0-9\+\-\/\@\%\#\_]+)*|[\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFF\u200C]+(?:[\:\,\.\،\؟\!]*)?|[^\s\w\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFF\u200C\(\)\[\]\{\}«»]+)/g;

    const tokens = reshaped.match(tokenRegex) || [reshaped];
    return tokens.reverse().join('');
  } catch (e) {
    return String(str);
  }
}

export interface PdfRangeOptions {
  startMs?: number;
  endMs?: number;
  startDateStr?: string;
  endDateStr?: string;
}

export async function generateUserStatementPdf(user: User, options: PdfRangeOptions = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      if (!PDFDocument) {
        return reject(new Error('PDF generator module (pdfkit) is not loaded'));
      }
      const doc = new PDFDocument({ margin: 30, size: 'A4' });
      const buffers: Buffer[] = [];

      doc.on('data', (data: any) => buffers.push(data));
      doc.on('end', () => resolve(Buffer.concat(buffers)));

      const fontPathRegular = path.join(process.cwd(), 'Vazirmatn-Regular.ttf');
      const fontPathBold = path.join(process.cwd(), 'Vazirmatn-Bold.ttf');

      const hasRegularFont = fs.existsSync(fontPathRegular);
      const hasBoldFont = fs.existsSync(fontPathBold);

      if (hasRegularFont) {
        doc.registerFont('Vazir', fontPathRegular);
        doc.font('Vazir');
      }
      if (hasBoldFont) {
        doc.registerFont('Vazir-Bold', fontPathBold);
      }

      const fontReg = hasRegularFont ? 'Vazir' : 'Helvetica';
      const fontBold = hasBoldFont ? 'Vazir-Bold' : 'Helvetica-Bold';

      const hasCustomRange = options.startMs !== undefined || options.endMs !== undefined;
      const effStartMs = options.startMs !== undefined ? options.startMs : 0;
      const effEndMs = options.endMs !== undefined ? options.endMs : Date.now();

      // Get accounting data (already deduplicated and filtered if range is provided)
      const fullReport = hasCustomRange
        ? getUserAccountingReport(user, 'all', effStartMs, effEndMs)
        : getUserAccountingReport(user, 'all');

      let filteredLedger = fullReport.ledgerRows;
      let rangeTitle = 'کل اسناد مالی و حسابداری - از ابتدا تاکنون';

      if (hasCustomRange) {
        filteredLedger = fullReport.ledgerRows.filter(row => {
          const t = new Date(row.rawDate).getTime();
          return t >= effStartMs && t <= effEndMs;
        });
        const sStr = options.startDateStr
          ? normalizeDigitsToEnglish(options.startDateStr)
          : formatShamsiDate(new Date(effStartMs));
        const eStr = options.endDateStr
          ? normalizeDigitsToEnglish(options.endDateStr)
          : formatShamsiDate(new Date(effEndMs));
        rangeTitle = `بازه زمانی: از ${sStr} تا ${eStr}`;
      }

      // Sort chronological ascending (oldest first) for accounting table
      const rowsAsc = [...filteredLedger].sort((a, b) => new Date(a.rawDate).getTime() - new Date(b.rawDate).getTime());

      // Calculate totals & running balance strictly for the displayed rows
      let rangeDebit = 0;
      let rangeCredit = 0;
      let runningInTable = 0;
      rowsAsc.forEach(r => {
        rangeDebit += (r.debit || 0);
        rangeCredit += (r.credit || 0);
        runningInTable += (r.debit || 0) - (r.credit || 0);
        r.runningBalance = runningInTable;
      });

      // Format current Gregorian/Shamsi date reliably with Latin digits to prevent inverted numerals
      const now = new Date();
      const gy = now.getFullYear();
      const gm = now.getMonth() + 1;
      const gd = now.getDate();
      const jNow = jalaali.toJalaali(gy, gm, gd);
      const todayFa = `${jNow.jy}/${String(jNow.jm).padStart(2, '0')}/${String(jNow.jd).padStart(2, '0')}`;
      const nowTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

      const uName = user.nickname || (user.username ? `@${user.username}` : `کاربر ${user.chatId}`);
      const roleStr = user.isSeller ? 'همکار فروشنده' : 'کاربر عادی';

      // --- HEADER DRAWING ---
      doc.rect(30, 25, 535, 75).fillAndStroke('#0f172a', '#1e293b');
      doc.fillColor('#ffffff').font(fontBold).fontSize(15);
      doc.text(fixRTL('صورتحساب رسمی حسابداری و دفتر معین'), 30, 38, { align: 'center', width: 535 });
      
      doc.fillColor('#94a3b8').font(fontReg).fontSize(9.5);
      doc.text(fixRTL(`تاریخ صدور: ${todayFa}    ساعت: ${nowTime}    |    ${rangeTitle}`), 30, 66, { align: 'center', width: 535 });

      // --- USER INFO BOX ---
      doc.rect(30, 110, 535, 55).fillAndStroke('#f8fafc', '#e2e8f0');
      doc.fillColor('#1e293b').font(fontBold).fontSize(10);
      
      doc.text(fixRTL(`طرف حساب: ${uName}`), 300, 120, { align: 'right', width: 250 });
      doc.text(fixRTL(`شناسه کاربری: ${user.chatId}`), 40, 120, { align: 'left', width: 220 });
      
      doc.font(fontReg).fontSize(9).fillColor('#475569');
      doc.text(fixRTL(`نقش کاربری: ${roleStr}`), 320, 140, { align: 'right', width: 230 });
      doc.text(fixRTL(`مانده بدهی فعلی:  ${(user.debt || 0).toLocaleString()}  تومان`), 40, 140, { align: 'left', width: 220 });

      // --- SUMMARY CARDS ---
      const startY = 175;
      const cardW = 165;
      const cardH = 45;

      // Card 1: Total Debits
      doc.rect(30, startY, cardW, cardH).fillAndStroke('#fff1f2', '#fecdd3');
      doc.fillColor('#e11d48').font(fontBold).fontSize(9);
      doc.text(fixRTL('جمع گردش بدهکار (خریدها)'), 35, startY + 8, { align: 'center', width: cardW - 10 });
      doc.fontSize(10.5);
      doc.text(fixRTL(`${rangeDebit.toLocaleString()}  تومان`), 35, startY + 24, { align: 'center', width: cardW - 10 });

      // Card 2: Total Credits
      doc.rect(215, startY, cardW, cardH).fillAndStroke('#f0fdf4', '#bbf7d0');
      doc.fillColor('#16a34a').font(fontBold).fontSize(9);
      doc.text(fixRTL('جمع گردش بستانکار (واریزی‌ها)'), 220, startY + 8, { align: 'center', width: cardW - 10 });
      doc.fontSize(10.5);
      doc.text(fixRTL(`${rangeCredit.toLocaleString()}  تومان`), 220, startY + 24, { align: 'center', width: cardW - 10 });

      // Card 3: Range Balance
      const rangeBal = rangeDebit - rangeCredit;
      const balColor = rangeBal > 0 ? '#b91c1c' : (rangeBal < 0 ? '#15803d' : '#334155');
      const balStatus = rangeBal > 0 ? 'بدهکار' : (rangeBal < 0 ? 'بستانکار' : 'تسویه');
      doc.rect(400, startY, cardW, cardH).fillAndStroke('#f8fafc', '#cbd5e1');
      doc.fillColor('#334155').font(fontBold).fontSize(9);
      doc.text(fixRTL('تراز خالص در این بازه'), 405, startY + 8, { align: 'center', width: cardW - 10 });
      doc.fillColor(balColor).fontSize(10.5);
      doc.text(fixRTL(`${Math.abs(rangeBal).toLocaleString()}  تومان  -  ${balStatus}`), 405, startY + 24, { align: 'center', width: cardW - 10 });

      // --- TABLE HEADER ---
      let y = 235;
      const cols = {
        bal: { x: 30, w: 75 },
        credit: { x: 105, w: 65 },
        debit: { x: 170, w: 65 },
        desc: { x: 235, w: 220 },
        date: { x: 455, w: 80 },
        num: { x: 535, w: 30 }
      };

      doc.rect(30, y, 535, 22).fill('#1e293b');
      doc.fillColor('#ffffff').font(fontBold).fontSize(8.5);

      doc.text(fixRTL('مانده تراز'), cols.bal.x, y + 6, { width: cols.bal.w, align: 'center' });
      doc.text(fixRTL('بستانکار (تومان)'), cols.credit.x, y + 6, { width: cols.credit.w, align: 'center' });
      doc.text(fixRTL('بدهکار (تومان)'), cols.debit.x, y + 6, { width: cols.debit.w, align: 'center' });
      doc.text(fixRTL('شرح سند و تراکنش مالی'), cols.desc.x, y + 6, { width: cols.desc.w, align: 'center' });
      doc.text(fixRTL('تاریخ و زمان'), cols.date.x, y + 6, { width: cols.date.w, align: 'center' });
      doc.text(fixRTL('ردیف'), cols.num.x, y + 6, { width: cols.num.w, align: 'center' });

      y += 22;

      // --- TABLE ROWS ---
      if (rowsAsc.length === 0) {
        doc.rect(30, y, 535, 30).fillAndStroke('#ffffff', '#e2e8f0');
        doc.fillColor('#64748b').font(fontReg).fontSize(10);
        doc.text(fixRTL('هیچ تراکنش یا سندی در این بازه زمانی ثبت نشده است.'), 30, y + 10, { align: 'center', width: 535 });
        y += 30;
      } else {
        rowsAsc.forEach((row, idx) => {
          // Page overflow handling
          if (y > 760) {
            doc.addPage();
            y = 30;

            // Re-draw table header on new page
            doc.rect(30, y, 535, 22).fill('#1e293b');
            doc.fillColor('#ffffff').font(fontBold).fontSize(8.5);

            doc.text(fixRTL('مانده تراز'), cols.bal.x, y + 6, { width: cols.bal.w, align: 'center' });
            doc.text(fixRTL('بستانکار (تومان)'), cols.credit.x, y + 6, { width: cols.credit.w, align: 'center' });
            doc.text(fixRTL('بدهکار (تومان)'), cols.debit.x, y + 6, { width: cols.debit.w, align: 'center' });
            doc.text(fixRTL('شرح سند و تراکنش مالی'), cols.desc.x, y + 6, { width: cols.desc.w, align: 'center' });
            doc.text(fixRTL('تاریخ و زمان'), cols.date.x, y + 6, { width: cols.date.w, align: 'center' });
            doc.text(fixRTL('ردیف'), cols.num.x, y + 6, { width: cols.num.w, align: 'center' });

            y += 22;
          }

          const rowBg = idx % 2 === 0 ? '#ffffff' : '#f8fafc';
          const rowH = 22;

          doc.rect(30, y, 535, rowH).fillAndStroke(rowBg, '#e2e8f0');

          const dtStr = `${row.dateStr} ${row.timeStr}`;
          const debStr = row.debit > 0 ? row.debit.toLocaleString() : '-';
          const credStr = row.credit > 0 ? row.credit.toLocaleString() : '-';
          const balVal = row.runningBalance || 0;
          const balStatusStr = balVal > 0 ? 'بدهکار' : (balVal < 0 ? 'بستانکار' : 'تسویه');
          const balStr = `${Math.abs(balVal).toLocaleString()}  ${balStatusStr}`;
          const balRowColor = balVal > 0 ? '#b91c1c' : (balVal < 0 ? '#15803d' : '#475569');

          doc.fillColor(balRowColor).font(fontReg).fontSize(7.5);
          doc.text(fixRTL(balStr), cols.bal.x, y + 6, { width: cols.bal.w, align: 'center' });
          
          doc.fillColor(row.credit > 0 ? '#16a34a' : '#94a3b8').font(fontBold).fontSize(8);
          doc.text(credStr, cols.credit.x, y + 6, { width: cols.credit.w, align: 'center' });

          doc.fillColor(row.debit > 0 ? '#e11d48' : '#94a3b8').font(fontBold).fontSize(8);
          doc.text(debStr, cols.debit.x, y + 6, { width: cols.debit.w, align: 'center' });

          // Clean up description: strip redundant [0GB] and clean spacing
          let cleanDesc = row.description
            .replace(/\[0GB\]/g, '')
            .replace(/خرید کانفیگ:\s*کانفیگ/g, 'خرید: کانفیگ')
            .replace(/\s+/g, ' ')
            .trim();

          doc.fillColor('#1e293b').font(fontReg).fontSize(8);
          doc.text(fixRTL(cleanDesc), cols.desc.x, y + 6, { width: cols.desc.w, align: 'right', lineBreak: false });
          
          doc.fillColor('#475569').font(fontReg).fontSize(7.5);
          doc.text(dtStr, cols.date.x, y + 6, { width: cols.date.w, align: 'center' });
          
          doc.fillColor('#64748b').font(fontBold).fontSize(8);
          doc.text(String(idx + 1), cols.num.x, y + 6, { width: cols.num.w, align: 'center' });

          y += rowH;
        });
      }

      // Footer notice
      if (y > 750) {
        doc.addPage();
        y = 30;
      }

      y += 15;
      doc.rect(30, y, 535, 25).fillAndStroke('#f1f5f9', '#cbd5e1');
      doc.fillColor('#475569').font(fontReg).fontSize(8);
      doc.text(fixRTL('این صورتحساب به صورت مکانیزه از سیستم حسابداری استخراج شده و دارای اعتبار رسمی است.'), 30, y + 8, { align: 'center', width: 535 });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

export function parseShamsiDateToTimestamp(shamsiStr: string, isEndOfDay: boolean = false): number | null {
  if (!shamsiStr) return null;
  const norm = normalizeDigitsToEnglish(shamsiStr).trim();

  // Match full YYYY/MM/DD or YYYY-MM-DD or YYYY.MM.DD
  const fullMatch = norm.match(/(\d{4})[\/\.\-](\d{1,2})[\/\.\-](\d{1,2})/);
  let jy = 0;
  let jm = 0;
  let jd = 0;

  if (fullMatch) {
    jy = parseInt(fullMatch[1], 10);
    jm = parseInt(fullMatch[2], 10);
    jd = parseInt(fullMatch[3], 10);
  } else {
    // Also support YYYY/MM (entire month)
    const monthMatch = norm.match(/^(\d{4})[\/\.\-](\d{1,2})$/);
    if (monthMatch) {
      jy = parseInt(monthMatch[1], 10);
      jm = parseInt(monthMatch[2], 10);
      if (jm < 1 || jm > 12) return null;
      jd = isEndOfDay ? jalaali.jalaaliMonthLength(jy, jm) : 1;
    } else {
      return null;
    }
  }

  if (jm < 1 || jm > 12 || jd < 1 || jd > 31) return null;
  const maxDayInMonth = jalaali.jalaaliMonthLength(jy, jm);
  if (jd > maxDayInMonth) jd = maxDayInMonth;

  try {
    const g = jalaali.toGregorian(jy, jm, jd);
    const gyStr = String(g.gy);
    const gmStr = String(g.gm).padStart(2, '0');
    const gdStr = String(g.gd).padStart(2, '0');

    const timeStr = isEndOfDay ? '23:59:59.999' : '00:00:00.000';
    return new Date(`${gyStr}-${gmStr}-${gdStr}T${timeStr}+03:30`).getTime();
  } catch (e) {
    return null;
  }
}

export function extractShamsiDateRange(rawInput: string): {
  startMs: number;
  endMs: number;
  startDateStr: string;
  endDateStr: string;
} | null {
  if (!rawInput) return null;
  const norm = normalizeDigitsToEnglish(rawInput).trim();
  const dateTokens = norm.match(/\d{4}[\/\.\-]\d{1,2}(?:[\/\.\-]\d{1,2})?/g);
  if (!dateTokens || dateTokens.length === 0) return null;

  const firstToken = dateTokens[0];
  const lastToken = dateTokens[dateTokens.length - 1];

  let startMs = parseShamsiDateToTimestamp(firstToken, false);
  let endMs = parseShamsiDateToTimestamp(lastToken, true);

  if (!startMs || !endMs) return null;
  if (startMs > endMs) {
    const tmp = startMs;
    startMs = endMs;
    endMs = tmp;
    const s2 = parseShamsiDateToTimestamp(lastToken, false);
    const e2 = parseShamsiDateToTimestamp(firstToken, true);
    if (s2 && e2) {
      startMs = s2;
      endMs = e2;
    }
  }

  return {
    startMs,
    endMs,
    startDateStr: formatShamsiDate(new Date(startMs)),
    endDateStr: formatShamsiDate(new Date(endMs))
  };
}
