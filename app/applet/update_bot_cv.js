const fs = require('fs');
let content = fs.readFileSync('server/bot.ts', 'utf8');

const startIdx = content.indexOf('export async function executeSellerCustomVolumePurchase');
const endIdx = content.indexOf('const clientEmail = clientResult.clientEmail;', startIdx);

if (startIdx === -1 || endIdx === -1) {
  console.error('Indices not found');
  process.exit(1);
}

const replacementChunk = `export async function executeSellerCustomVolumePurchase(params: {  sellerChatId: number;  volumeGb: number;  durationDays?: number;  customName?: string;  panelType?: PanelType;  categoryId?: string;}) {  const { sellerChatId, volumeGb, durationDays, customName, panelType, categoryId } = params;  const user = db.getUser(sellerChatId);
  if (!user || !user.isSeller) {
    throw new Error('حساب کاربری همکار معتبر نیست.');
  }
  const state = db.getState();
  if (state.customVolumeEnabled === false) {
    throw new Error('قابلیت سفارش حجم دلخواه در حال حاضر غیرفعال است.');
  }
  const vol = Math.max(1, Math.round(Number(volumeGb)));
  const dur = Math.max(1, Math.round(Number(durationDays || state.customVolumeDefaultDays || 30)));
  // Rate per GB
  const rawRatePerGb = user.customVolumePricePerGb || state.customVolumePricePerGb || 3000;
  const sellerDiscount = getSellerDiscountForProduct(user);
  let finalRatePerGb = rawRatePerGb;
  if (sellerDiscount > 0) {
    finalRatePerGb = Math.max(0, Math.round(rawRatePerGb * (1 - sellerDiscount / 100)));
  }
  const finalPrice = Math.round(vol * finalRatePerGb);
  // Check debt limit
  if (!isSellerUnlimitedLimit(user)) {
    const currentDebt = user.debt || 0;
    const limit = user.debtLimit !== undefined && user.debtLimit > 0 ? user.debtLimit : 1000000;
    if (currentDebt + finalPrice > limit) {
      throw new Error(\`سقف اعتبار مجاز خرید همکار پر شده است! (بدهی فعلی: \${currentDebt.toLocaleString()} تومان / سقف: \${limit.toLocaleString()} تومان)\`);
    }
  }
  let targetProduct: any = null;
  if (categoryId) {
    const catProduct = (state.products || []).find((p: any) => p && String(p.categoryId) === String(categoryId) && !p.disabled);
    if (catProduct) {
      targetProduct = { ...catProduct };
    }
  }
  if (targetProduct) {
    targetProduct.name = \`سفارش دلخواه \${vol} گیگ (\${dur} روز)\`;
    targetProduct.volumeGb = vol;
    targetProduct.durationDays = dur;
  } else {
    let targetPanel: PanelType = panelType || state.customVolumePanelType || 'mrocean';
    if (!panelType && !state.customVolumePanelType) {
      if (state.mroceanPanel?.url && state.mroceanPanel?.enabled !== false) {
        targetPanel = 'mrocean';
      } else if (state.activePanelMode) {
        targetPanel = state.activePanelMode === 'xui' ? 'sanaei' : (state.activePanelMode as PanelType);
      } else {
        targetPanel = 'sanaei';
      }
    }
    targetProduct = {
      name: \`سفارش دلخواه \${vol} گیگ (\${dur} روز)\`,
      volumeGb: vol,
      durationDays: dur,
      panelType: targetPanel
    };
  }
  const cleanCustomName = customName ? sanitizeCustomConfigName(customName) : undefined;
  const clientResult = await multiPanel.createClientConfig({
    user,
    product: targetProduct,
    customName: cleanCustomName
  });
  `;

content = content.slice(0, startIdx) + replacementChunk + content.slice(endIdx);
fs.writeFileSync('server/bot.ts', content, 'utf8');
console.log('Successfully updated executeSellerCustomVolumePurchase in server/bot.ts!');
