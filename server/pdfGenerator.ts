import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
// @ts-ignore
import apr from 'arabic-persian-reshaper';
import * as jalaali from 'jalaali-js';
import { User, Purchase } from './db.js';
import { getUserAccountingReport } from './accounting.js';

function fixRTL(str: string | number | null | undefined): string {
  if (str === null || str === undefined) return '';
  const s = String(str).trim();
  if (!s) return '';
  
  // Reshape Persian/Arabic characters to contextual joined glyphs
  try {
    const reshaped = apr.PersianShaper.convertArabic(s);
    // Reverse character order so LTR PDF renderer prints RTL right
    return reshaped.split('').reverse().join('');
  } catch (e) {
    return s.split('').reverse().join('');
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
      const doc = new PDFDocument({ margin: 30, size: 'A4' });
      const buffers: Buffer[] = [];

      doc.on('data', (data) => buffers.push(data));
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

      // Get full accounting data
      const fullReport = getUserAccountingReport(user, 'all');

      // Filter by custom date range if provided
      let filteredLedger = fullReport.ledgerRows;
      let rangeTitle = 'کل اسناد مالی و حسابداری (از ابتدا تاکنون)';

      if (options.startMs !== undefined && options.endMs !== undefined) {
        filteredLedger = fullReport.ledgerRows.filter(row => {
          const t = new Date(row.rawDate).getTime();
          return t >= options.startMs! && t <= options.endMs!;
        });
        if (options.startDateStr && options.endDateStr) {
          rangeTitle = `بازه زمانی شمسی: از ${options.startDateStr} تا ${options.endDateStr}`;
        } else {
          rangeTitle = 'بازه زمانی سفارشی انتخاب شده';
        }
      }

      // Sort chronological ascending (oldest first) for accounting table
      const rowsAsc = [...filteredLedger].sort((a, b) => new Date(a.rawDate).getTime() - new Date(b.rawDate).getTime());

      // Calculate totals for range
      let rangeDebit = 0;
      let rangeCredit = 0;
      rowsAsc.forEach(r => {
        rangeDebit += (r.debit || 0);
        rangeCredit += (r.credit || 0);
      });

      const todayFa = new Date().toLocaleDateString('fa-IR', { timeZone: 'Asia/Tehran' });
      const nowTime = new Date().toLocaleTimeString('fa-IR', { timeZone: 'Asia/Tehran', hour: '2-digit', minute: '2-digit' });
      const uName = user.nickname || (user.username ? `@${user.username}` : `کاربر ${user.chatId}`);
      const roleStr = user.isSeller ? 'همکار فروشنده' : 'کاربر عادی';

      // --- HEADER DRAWING ---
      doc.rect(30, 25, 535, 75).fillAndStroke('#0f172a', '#1e293b');
      doc.fillColor('#ffffff').font(fontBold).fontSize(16);
      doc.text(fixRTL('صورتحساب رسمی حسابداری و دفتر معین'), 30, 38, { align: 'center', width: 535 });
      
      doc.fillColor('#94a3b8').font(fontReg).fontSize(10);
      doc.text(fixRTL(`تاریخ صدور: ${todayFa} ساعت ${nowTime} | ${rangeTitle}`), 30, 62, { align: 'center', width: 535 });

      // --- USER INFO BOX ---
      doc.rect(30, 110, 535, 55).fillAndStroke('#f8fafc', '#e2e8f0');
      doc.fillColor('#1e293b').font(fontBold).fontSize(10);
      
      doc.text(fixRTL(`طرف حساب: ${uName}`), 330, 120, { align: 'right', width: 220 });
      doc.text(fixRTL(`شناسه کاربر: ${user.chatId}`), 50, 120, { align: 'left', width: 220 });
      
      doc.font(fontReg).fontSize(9).fillColor('#475569');
      doc.text(fixRTL(`نقش کاربری: ${roleStr}`), 330, 140, { align: 'right', width: 220 });
      const currentDebtStr = (user.debt || 0).toLocaleString() + ' تومان';
      doc.text(fixRTL(`مانده بدهی فعلی: ${currentDebtStr}`), 50, 140, { align: 'left', width: 220 });

      // --- SUMMARY CARDS ---
      const startY = 175;
      const cardW = 165;
      const cardH = 45;

      // Card 1: Total Debits
      doc.rect(30, startY, cardW, cardH).fillAndStroke('#fff1f2', '#fecdd3');
      doc.fillColor('#e11d48').font(fontBold).fontSize(9);
      doc.text(fixRTL('جمع گردش بدهکار (خریدها)'), 35, startY + 8, { align: 'center', width: cardW - 10 });
      doc.fontSize(11);
      doc.text(fixRTL(`${rangeDebit.toLocaleString()} تومان`), 35, startY + 24, { align: 'center', width: cardW - 10 });

      // Card 2: Total Credits
      doc.rect(215, startY, cardW, cardH).fillAndStroke('#f0fdf4', '#bbf7d0');
      doc.fillColor('#16a34a').font(fontBold).fontSize(9);
      doc.text(fixRTL('جمع گردش بستانکار (واریزی‌ها)'), 220, startY + 8, { align: 'center', width: cardW - 10 });
      doc.fontSize(11);
      doc.text(fixRTL(`${rangeCredit.toLocaleString()} تومان`), 220, startY + 24, { align: 'center', width: cardW - 10 });

      // Card 3: Range Balance
      const rangeBal = rangeDebit - rangeCredit;
      const balColor = rangeBal > 0 ? '#b91c1c' : '#15803d';
      doc.rect(400, startY, cardW, cardH).fillAndStroke('#f8fafc', '#cbd5e1');
      doc.fillColor('#334155').font(fontBold).fontSize(9);
      doc.text(fixRTL('تراز خالص در این بازه'), 405, startY + 8, { align: 'center', width: cardW - 10 });
      doc.fillColor(balColor).fontSize(11);
      doc.text(fixRTL(`${rangeBal.toLocaleString()} تومان`), 405, startY + 24, { align: 'center', width: cardW - 10 });

      // --- TABLE HEADER ---
      let y = 235;
      const colX = {
        num: 535,
        date: 450,
        desc: 260,
        debit: 180,
        credit: 100,
        bal: 30
      };

      doc.rect(30, y, 535, 22).fill('#1e293b');
      doc.fillColor('#ffffff').font(fontBold).fontSize(8.5);

      doc.text(fixRTL('ردیف'), colX.num - 30, y + 6, { width: 30, align: 'center' });
      doc.text(fixRTL('تاریخ و زمان'), colX.date - 80, y + 6, { width: 80, align: 'center' });
      doc.text(fixRTL('شرح سند / تراکنش مالی'), colX.desc - 180, y + 6, { width: 180, align: 'center' });
      doc.text(fixRTL('بدهکار (تومان)'), colX.debit - 75, y + 6, { width: 75, align: 'center' });
      doc.text(fixRTL('بستانکار (تومان)'), colX.credit - 75, y + 6, { width: 75, align: 'center' });
      doc.text(fixRTL('مانده تراز'), colX.bal, y + 6, { width: 70, align: 'center' });

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

            doc.text(fixRTL('ردیف'), colX.num - 30, y + 6, { width: 30, align: 'center' });
            doc.text(fixRTL('تاریخ و زمان'), colX.date - 80, y + 6, { width: 80, align: 'center' });
            doc.text(fixRTL('شرح سند / تراکنش مالی'), colX.desc - 180, y + 6, { width: 180, align: 'center' });
            doc.text(fixRTL('بدهکار (تومان)'), colX.debit - 75, y + 6, { width: 75, align: 'center' });
            doc.text(fixRTL('بستانکار (تومان)'), colX.credit - 75, y + 6, { width: 75, align: 'center' });
            doc.text(fixRTL('مانده تراز'), colX.bal, y + 6, { width: 70, align: 'center' });

            y += 22;
          }

          const rowBg = idx % 2 === 0 ? '#ffffff' : '#f8fafc';
          const rowH = 20;

          doc.rect(30, y, 535, rowH).fillAndStroke(rowBg, '#e2e8f0');
          doc.fillColor('#334155').font(fontReg).fontSize(8);

          const dtStr = `${row.dateStr} ${row.timeStr}`;
          const debStr = row.debit > 0 ? row.debit.toLocaleString() : '0';
          const credStr = row.credit > 0 ? row.credit.toLocaleString() : '0';
          const balVal = row.runningBalance || 0;
          const balStr = (balVal > 0 ? `${balVal.toLocaleString()} بدهکار` : (balVal < 0 ? `${Math.abs(balVal).toLocaleString()} بستانکار` : 'تراز صفر'));

          doc.text(fixRTL(idx + 1), colX.num - 30, y + 5, { width: 30, align: 'center' });
          doc.text(fixRTL(dtStr), colX.date - 80, y + 5, { width: 80, align: 'center' });
          doc.text(fixRTL(row.description), colX.desc - 180, y + 5, { width: 180, align: 'right' });
          
          doc.fillColor(row.debit > 0 ? '#e11d48' : '#94a3b8');
          doc.text(fixRTL(debStr), colX.debit - 75, y + 5, { width: 75, align: 'center' });
          
          doc.fillColor(row.credit > 0 ? '#16a34a' : '#94a3b8');
          doc.text(fixRTL(credStr), colX.credit - 75, y + 5, { width: 75, align: 'center' });

          doc.fillColor('#0f172a').font(fontBold);
          doc.text(fixRTL(balStr), colX.bal, y + 5, { width: 70, align: 'center' });

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
      doc.text(fixRTL('این صورتحساب به صورت مکانیزه از سیستم حسابداری استخراج شده و بدون نیاز به مهر دستی دارای اعتبار رسمی است.'), 30, y + 8, { align: 'center', width: 535 });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

export function parseShamsiDateToTimestamp(shamsiStr: string, isEndOfDay: boolean = false): number | null {
  if (!shamsiStr) return null;
  const norm = shamsiStr.replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d).toString()).trim();
  const match = norm.match(/(\d{4})[\/\.-](\d{1,2})[\/\.-](\d{1,2})/);
  if (!match) return null;

  const jy = parseInt(match[1], 10);
  const jm = parseInt(match[2], 10);
  const jd = parseInt(match[3], 10);

  if (jm < 1 || jm > 12 || jd < 1 || jd > 31) return null;

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
