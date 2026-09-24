import { xui } from './xui.js';
import { rebecca } from './rebecca.js';
import { db, Product, User, Purchase } from './db.js';

export interface UnifiedClientCreationResult {
  panelType: 'sanaei' | 'rebecca' | 'both';
  clientEmail: string;
  subId?: string;
  subUrl: string;
  sanaeiSubUrl?: string;
  rebeccaSubUrl?: string;
  sanaeiDetails?: any;
  rebeccaDetails?: any;
}

export interface UnifiedTrafficClient {
  id: string;
  email: string;
  username: string;
  subId?: string;
  token?: string;
  subUrl?: string;
  up: number;
  down: number;
  totalUsed: number;
  total: number;
  expiryTime: number;
  enable: boolean;
  panel: 'sanaei' | 'rebecca';
}

export class MultiPanelService {
  /**
   * Creates client config on Sanaei, Rebecca, or Both simultaneously
   */
  public async createClientConfig(params: {
    user: User;
    product: Product | {
      id?: string;
      name: string;
      volumeGb: number;
      durationDays: number;
      isPayAsYouGo?: boolean;
      panelType?: 'sanaei' | 'rebecca' | 'both';
      inboundId?: number | string;
      inboundIds?: (number | string)[];
      rebeccaInboundTags?: string[];
      limitIp?: number;
    };
    customName?: string;
  }): Promise<UnifiedClientCreationResult> {
    const { user, product, customName } = params;
    const state = db.getState();

    // Determine target panel
    let panelType: 'sanaei' | 'rebecca' | 'both' = product.panelType || 'sanaei';
    if (!product.panelType) {
      if (state.activePanelMode === 'rebecca') {
        panelType = 'rebecca';
      } else if (state.activePanelMode === 'both') {
        panelType = 'both';
      } else if (state.rebeccaPanel?.url && (!state.panel?.url || state.panel?.panelType === 'rebecca')) {
        panelType = 'rebecca';
      }
    }

    // Generate unique identifier / email
    let clientEmail = '';
    if (customName && customName.trim() !== '') {
      const cleanCustom = customName.trim().replace(/[^a-zA-Z0-9_]/g, '_');
      const uniqueSuffix = Date.now().toString().slice(-4);
      clientEmail = `${cleanCustom}_${uniqueSuffix}`;
    } else {
      const cleanUsername = user.username ? user.username.trim().replace(/[^a-zA-Z0-9_]/g, '') : '';
      const emailPrefix = cleanUsername || String(user.chatId);
      const uniqueSuffix = Date.now().toString().slice(-6);
      clientEmail = `${emailPrefix}_${uniqueSuffix}`;
    }

    const isPAYG = !!product.isPayAsYouGo;
    const volGb = isPAYG ? 0 : (product.volumeGb !== undefined ? Number(product.volumeGb) : 0);
    const durDays = isPAYG ? 0 : (product.durationDays !== undefined ? Number(product.durationDays) : 0);

    const selectedInboundIds = (product.inboundIds && product.inboundIds.length > 0)
      ? product.inboundIds
      : (product.inboundId ? [product.inboundId] : undefined);

    const targetServiceId = (product as any).rebeccaServiceId || state.rebeccaPanel?.serviceId;

    const rebeccaInbounds = product.rebeccaInboundTags && product.rebeccaInboundTags.length > 0
      ? product.rebeccaInboundTags
      : (state.rebeccaPanel?.inboundTags && state.rebeccaPanel.inboundTags.length > 0 ? state.rebeccaPanel.inboundTags : undefined);

    const sellerGroupName = user.isSeller
      ? (user.nickname ? user.nickname : (user.username ? `${user.username}` : `Seller_${user.chatId}`))
      : undefined;

    let sanaeiSubUrl = '';
    let rebeccaSubUrl = '';
    let sanaeiDetails: any = null;
    let rebeccaDetails: any = null;

    let sanaeiErr: string | null = null;
    let rebeccaErr: string | null = null;

    // 1. Sanaei Panel Creation
    if (panelType === 'sanaei' || panelType === 'both') {
      try {
        const sanaeiClient = await xui.addClient(
          clientEmail,
          volGb,
          durDays,
          selectedInboundIds,
          product.limitIp || 0,
          String(user.chatId),
          sellerGroupName
        );
        sanaeiSubUrl = sanaeiClient.subUrl || '';
        sanaeiDetails = sanaeiClient;
        console.log(`[MultiPanel] Created Sanaei client: ${clientEmail}`);
      } catch (err: any) {
        sanaeiErr = err.message || 'خطا در اتصال به پنل سنایی';
        console.error(`[MultiPanel Error] Sanaei creation failed for ${clientEmail}:`, sanaeiErr);
        if (panelType === 'sanaei') {
          throw new Error(`خطا در ایجاد سرویس در پنل سنایی: ${sanaeiErr}`);
        }
      }
    }

    // 2. Rebecca Panel Creation
    if (panelType === 'rebecca' || panelType === 'both') {
      try {
        const note = `User: ${user.chatId} | ${user.username || 'NoUser'} | Product: ${product.name || 'Custom'}`;
        const rebeccaClient = await rebecca.addClient(
          clientEmail,
          volGb,
          durDays,
          targetServiceId || rebeccaInbounds,
          product.limitIp || 0,
          String(user.chatId),
          undefined,
          note
        );
        rebeccaSubUrl = rebeccaClient.subUrl || '';
        rebeccaDetails = rebeccaClient;
        console.log(`[MultiPanel] Created Rebecca client: ${clientEmail}`);
      } catch (err: any) {
        rebeccaErr = err.message || 'خطا در اتصال به پنل ربکا';
        console.error(`[MultiPanel Error] Rebecca creation failed for ${clientEmail}:`, rebeccaErr);
        if (panelType === 'rebecca') {
          throw new Error(`خطا در ایجاد سرویس در پنل ربکا: ${rebeccaErr}`);
        }
      }
    }

    if (panelType === 'both') {
      if (!sanaeiSubUrl && !rebeccaSubUrl) {
        throw new Error(`خطا در ساخت اکانت روی هر دو پنل:\n• سنایی: ${sanaeiErr}\n• ربکا: ${rebeccaErr}`);
      }
      if (!rebeccaSubUrl && rebeccaErr) {
        throw new Error(`خطا در ایجاد اکانت تست/سرویس روی پنل ربکا: ${rebeccaErr}\nلطفاً از تنظیم کامل آدرس و مشخصات پنل ربکا اطمینان حاصل فرمایید.`);
      }
      if (!sanaeiSubUrl && sanaeiErr) {
        throw new Error(`خطا در ایجاد اکانت تست/سرویس روی پنل سنایی: ${sanaeiErr}\nلطفاً از تنظیم کامل آدرس و مشخصات پنل سنایی اطمینان حاصل فرمایید.`);
      }
    }

    // Determine primary subUrl
    let primarySubUrl = '';
    if (panelType === 'both') {
      primarySubUrl = sanaeiSubUrl || rebeccaSubUrl;
    } else if (panelType === 'rebecca') {
      primarySubUrl = rebeccaSubUrl;
    } else {
      primarySubUrl = sanaeiSubUrl;
    }

    if (!primarySubUrl) {
      throw new Error('هیچ لینک اتصالی از پنل‌های انتخاب شده تولید نشد. لطفاً از اتصال پنل به ربات اطمینان حاصل فرمایید.');
    }

    const sanaeiSubId = sanaeiDetails?.subId || '';
    const rebeccaSubId = rebeccaDetails?.subId || rebeccaDetails?.token || (rebeccaDetails?.subUrl ? rebecca.extractSubToken(rebeccaDetails.subUrl) : '');
    const primarySubId = sanaeiSubId || rebeccaSubId || '';

    return {
      panelType,
      clientEmail,
      subId: primarySubId,
      subUrl: primarySubUrl,
      sanaeiSubUrl: sanaeiSubUrl || undefined,
      rebeccaSubUrl: rebeccaSubUrl || undefined,
      sanaeiDetails,
      rebeccaDetails
    };
  }

  /**
   * Retrieves all clients and traffic data across all connected panels
   */
  public async getAllClientsWithTraffic(): Promise<UnifiedTrafficClient[]> {
    const results: UnifiedTrafficClient[] = [];

    // Sanaei clients
    try {
      const sanaeiClients = await xui.getAllClientsWithTraffic().catch(() => []);
      for (const cl of sanaeiClients) {
        results.push({
          id: cl.id || cl.email,
          email: cl.email,
          username: cl.email,
          subId: cl.subId,
          token: cl.subId,
          subUrl: cl.subUrl,
          up: cl.up || 0,
          down: cl.down || 0,
          totalUsed: (cl.up || 0) + (cl.down || 0),
          total: cl.total || 0,
          expiryTime: cl.expiryTime || 0,
          enable: cl.enable !== false,
          panel: 'sanaei'
        });
      }
    } catch (e: any) {
      console.error('[MultiPanel] Failed fetching Sanaei clients traffic:', e.message);
    }

    // Rebecca clients
    try {
      const rebeccaClients = await rebecca.getAllClientsWithTraffic().catch(() => []);
      for (const cl of rebeccaClients) {
        results.push({
          id: cl.id,
          email: cl.email,
          username: cl.username,
          subId: cl.subId,
          token: (cl as any).token || cl.subId,
          subUrl: (cl as any).subUrl,
          up: cl.up || 0,
          down: cl.down || 0,
          totalUsed: cl.totalUsed || 0,
          total: cl.total || 0,
          expiryTime: cl.expiryTime || 0,
          enable: cl.enable !== false,
          panel: 'rebecca'
        });
      }
    } catch (e: any) {
      console.error('[MultiPanel] Failed fetching Rebecca clients traffic:', e.message);
    }

    return results;
  }

  /**
   * Enables or disables a client on Sanaei and/or Rebecca
   */
  public async updateClientEnable(purchase: Purchase, enable: boolean): Promise<void> {
    const pType = purchase.panelType || 'sanaei';
    const email = purchase.id;

    if (pType === 'sanaei' || pType === 'both') {
      try {
        await xui.updateClientEnable(email, enable);
      } catch (e: any) {
        console.error(`[MultiPanel] updateClientEnable error Sanaei for ${email}:`, e.message);
      }
    }

    if (pType === 'rebecca' || pType === 'both') {
      try {
        await rebecca.updateClientEnable(email, enable);
      } catch (e: any) {
        console.error(`[MultiPanel] updateClientEnable error Rebecca for ${email}:`, e.message);
      }
    }
  }

  /**
   * Renews client traffic and expiration on connected panel(s)
   */
  public async renewClient(purchase: Purchase, volumeGb: number, durationDays: number): Promise<void> {
    const pType = purchase.panelType || 'sanaei';
    const email = purchase.id;
    let anySuccess = false;

    if (pType === 'sanaei' || pType === 'both') {
      try {
        await xui.renewClient(email, volumeGb, durationDays);
        anySuccess = true;
      } catch (e: any) {
        console.error(`[MultiPanel] renewClient error Sanaei for ${email}:`, e.message);
        if (pType === 'sanaei') throw e;
      }
    }

    if (pType === 'rebecca' || pType === 'both') {
      try {
        await rebecca.renewClient(email, volumeGb, durationDays);
        anySuccess = true;
      } catch (e: any) {
        console.error(`[MultiPanel] renewClient error Rebecca for ${email}:`, e.message);
        if (pType === 'rebecca') throw e;
      }
    }

    if (!anySuccess) {
      throw new Error('تمدید سرویس در سرورها با خطا مواجه شد. لطفاً اتصال پنل‌ها را بررسی فرمایید.');
    }
  }

  /**
   * Deletes client on expired retention removal
   */
  public async delClient(purchase: Purchase): Promise<void> {
    const pType = purchase.panelType || 'sanaei';
    const email = purchase.id;

    if (pType === 'sanaei' || pType === 'both') {
      try {
        const inboundsList = await xui.getInbounds().catch(() => []);
        for (const ib of inboundsList) {
          if (ib.settings) {
            const p = typeof ib.settings === 'string' ? JSON.parse(ib.settings) : ib.settings;
            if (p && p.clients) {
              const clientObj = p.clients.find((cl: any) =>
                (cl.email && cl.email.toLowerCase() === email.toLowerCase()) ||
                (cl.id && cl.id.toLowerCase() === email.toLowerCase())
              );
              if (clientObj) {
                await xui.delClient(ib.id, clientObj.id);
                break;
              }
            }
          }
        }
      } catch (e: any) {
        console.error(`[MultiPanel] delClient error Sanaei for ${email}:`, e.message);
      }
    }

    if (pType === 'rebecca' || pType === 'both') {
      try {
        await rebecca.delClient(email);
      } catch (e: any) {
        console.error(`[MultiPanel] delClient error Rebecca for ${email}:`, e.message);
      }
    }
  }
}

export const multiPanel = new MultiPanelService();
