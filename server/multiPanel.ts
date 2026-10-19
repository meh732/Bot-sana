import { xui } from './xui.js';
import { rebecca } from './rebecca.js';
import { mrocean } from './mrocean.js';
import { panel4 } from './panel4.js';
import { db, User, Product, Purchase, PanelType } from './db.js';

export function isSanaeiPanel(panelType?: PanelType | string): boolean {
  return ['sanaei', 'both', 'sanaei_rebecca', 'sanaei_mrocean', 'sanaei_panel4', 'all'].includes(panelType || '');
}

export function isRebeccaPanel(panelType?: PanelType | string): boolean {
  return ['rebecca', 'both', 'sanaei_rebecca', 'rebecca_mrocean', 'rebecca_panel4', 'all'].includes(panelType || '');
}

export function isMrOceanPanel(panelType?: PanelType | string): boolean {
  return ['mrocean', 'sanaei_mrocean', 'rebecca_mrocean', 'mrocean_panel4', 'all'].includes(panelType || '');
}

export function isPanel4(panelType?: PanelType | string): boolean {
  return ['panel4', 'sanaei_panel4', 'rebecca_panel4', 'mrocean_panel4', 'all'].includes(panelType || '');
}

export interface UnifiedClientCreationResult {
  panelType: PanelType;
  clientEmail: string;
  subId: string;
  subUrl: string;
  sanaeiSubUrl?: string;
  rebeccaSubUrl?: string;
  mroceanSubUrl?: string;
  mroceanPortalUrl?: string;
  panel4SubUrl?: string;
  sanaeiDetails?: any;
  rebeccaDetails?: any;
  mroceanDetails?: any;
  panel4Details?: any;
}

export interface UnifiedTrafficClient {
  id: string;
  email: string;
  subId?: string;
  token?: string;
  subUrl?: string;
  portalUrl?: string;
  up: number;
  down: number;
  totalUsed: number;
  total: number;
  expiryTime: number;
  enable: boolean;
  panel: 'sanaei' | 'rebecca' | 'mrocean' | 'panel4';
}

export class MultiPanelService {
  /**
   * Creates client config on Sanaei, Rebecca, Mr Ocean, or any combination
   */
  public async createClientConfig(params: {
    user: User;
    product: Product | {
      id?: string;
      name: string;
      volumeGb: number;
      durationDays: number;
      isPayAsYouGo?: boolean;
      panelType?: PanelType;
      inboundId?: number | string;
      inboundIds?: (number | string)[];
      rebeccaInboundTags?: string[];
      panel4InboundId?: number | string;
      panel4InboundIds?: (number | string)[];
      limitIp?: number;
    };
    customName?: string;
  }): Promise<UnifiedClientCreationResult> {
    const { user, product, customName } = params;
    const state = db.getState();

    // Determine target panel
    let panelType: PanelType = product.panelType || 'sanaei';
    if (!product.panelType) {
      if (state.activePanelMode) {
        panelType = state.activePanelMode === 'xui' ? 'sanaei' : (state.activePanelMode as PanelType);
      } else if (state.mroceanPanel?.url && state.mroceanPanel?.username && (!state.panel?.url || state.panel?.panelType === 'mrocean')) {
        panelType = 'mrocean';
      } else if (state.rebeccaPanel?.url && (!state.panel?.url || state.panel?.panelType === 'rebecca')) {
        panelType = 'rebecca';
      }
    }

    const useSanaei = isSanaeiPanel(panelType);
    const useRebecca = isRebeccaPanel(panelType);
    const useMrOcean = isMrOceanPanel(panelType);
    const usePanel4 = isPanel4(panelType);

    // Generate unique identifier / email
    let clientEmail = '';
    if (customName && String(customName).trim() !== '') {
      clientEmail = String(customName)
        .trim()
        .replace(/[۰-۹]/g, d => String.fromCharCode(d.charCodeAt(0) - 1728))
        .replace(/[٠-٩]/g, d => String.fromCharCode(d.charCodeAt(0) - 1632))
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '');
    }
    if (!clientEmail) {
      const cleanUsername = user.username ? String(user.username).trim().toLowerCase().replace(/[^a-z0-9_]/g, '') : '';
      const emailPrefix = cleanUsername || String(user.chatId);
      const uniqueSuffix = Date.now().toString().slice(-6);
      clientEmail = `${emailPrefix}_${uniqueSuffix}`;
    }

    const isPAYG = !!product.isPayAsYouGo;
    let volGb = isPAYG ? 0 : (product.volumeGb !== undefined ? Number(product.volumeGb) : 0);
    let durDays = isPAYG ? 0 : (product.durationDays !== undefined ? Number(product.durationDays) : 0);
    if (!isPAYG && volGb <= 0 && product.name) {
      const norm = String(product.name)
        .replace(/[۰-۹]/g, d => String.fromCharCode(d.charCodeAt(0) - 1728))
        .replace(/[٠-٩]/g, d => String.fromCharCode(d.charCodeAt(0) - 1632));
      const mVol = norm.match(/(\d+(?:\.\d+)?)\s*(?:گیگ|گیگابایت|gb|gig)/i);
      if (mVol) volGb = parseFloat(mVol[1]);
    }
    if (!isPAYG && durDays <= 0 && product.name) {
      const norm = String(product.name)
        .replace(/[۰-۹]/g, d => String.fromCharCode(d.charCodeAt(0) - 1728))
        .replace(/[٠-٩]/g, d => String.fromCharCode(d.charCodeAt(0) - 1632));
      const mMonth = norm.match(/(\d+)\s*ماهه?/i);
      if (mMonth) durDays = parseInt(mMonth[1]) * 30;
      const mDay = norm.match(/(\d+)\s*روزه?/i);
      if (mDay) durDays = parseInt(mDay[1]);
    }

    const selectedInboundIds = (product.inboundIds && product.inboundIds.length > 0)
      ? product.inboundIds
      : (product.inboundId ? [product.inboundId] : undefined);

    const selectedPanel4Inbounds = (product.panel4InboundIds && product.panel4InboundIds.length > 0)
      ? product.panel4InboundIds
      : (product.panel4InboundId ? [product.panel4InboundId] : undefined);

    const targetServiceId = (product as any).rebeccaServiceId || state.rebeccaPanel?.serviceId;

    const rebeccaInbounds = product.rebeccaInboundTags && product.rebeccaInboundTags.length > 0
      ? product.rebeccaInboundTags
      : (state.rebeccaPanel?.inboundTags && state.rebeccaPanel.inboundTags.length > 0 ? state.rebeccaPanel.inboundTags : undefined);

    const sellerGroupName = user.isSeller
      ? (user.nickname ? user.nickname : (user.username ? `${user.username}` : `Seller_${user.chatId}`))
      : undefined;

    let sanaeiSubUrl = '';
    let rebeccaSubUrl = '';
    let mroceanSubUrl = '';
    let mroceanPortalUrl = '';
    let panel4SubUrl = '';
    let sanaeiDetails: any = null;
    let rebeccaDetails: any = null;
    let mroceanDetails: any = null;
    let panel4Details: any = null;

    let sanaeiErr: string | null = null;
    let rebeccaErr: string | null = null;
    let mroceanErr: string | null = null;
    let panel4Err: string | null = null;

    // 1. Sanaei Panel Creation
    if (useSanaei) {
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
    if (useRebecca) {
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

    // 3. Mr Ocean Reseller Panel Creation
    if (useMrOcean) {
      try {
        const note = `ChatID: ${user.chatId} | ${user.username ? '@' + user.username : 'NoUser'} | Product: ${product.name || 'Custom'}`;
        const mroceanClient = await mrocean.addClient({
          username: clientEmail,
          volumeGb: volGb,
          durationDays: durDays,
          note
        });
        mroceanSubUrl = mroceanClient.subUrl || '';
        mroceanPortalUrl = mroceanClient.portalUrl || '';
        mroceanDetails = mroceanClient;
        console.log(`[MultiPanel] Created Mr Ocean client: ${clientEmail}`);
      } catch (err: any) {
        mroceanErr = err.message || 'خطا در اتصال به پنل مستر اوشن';
        console.error(`[MultiPanel Error] Mr Ocean creation failed for ${clientEmail}:`, mroceanErr);
        if (panelType === 'mrocean') {
          throw new Error(`خطا در ایجاد سرویس در پنل نمایندگی مستر اوشن: ${mroceanErr}`);
        }
      }
    }

    // 4. Panel 4 Creation
    if (usePanel4) {
      try {
        const p4Client = await panel4.addClient(
          clientEmail,
          volGb > 0 ? volGb : 10,
          durDays > 0 ? durDays : 30,
          selectedPanel4Inbounds,
          product.limitIp || 0,
          String(user.chatId),
          sellerGroupName
        );
        panel4SubUrl = p4Client.subUrl || '';
        panel4Details = p4Client;
        if (!useSanaei && !useRebecca && !useMrOcean && p4Client.email) {
          clientEmail = p4Client.email;
        }
        console.log(`[MultiPanel] Created Panel 4 client: ${clientEmail}`);
      } catch (err: any) {
        panel4Err = err.message || 'خطا در اتصال به پنل ۴';
        console.error(`[MultiPanel Error] Panel 4 creation failed for ${clientEmail}:`, panel4Err);
        if (panelType === 'panel4') {
          throw new Error(`خطا در ایجاد سرویس در پنل ۴: ${panel4Err}`);
        }
      }
    }

    // Verify at least one link produced for multi-panel setups
    const isMultiPanel = [useSanaei, useRebecca, useMrOcean, usePanel4].filter(Boolean).length > 1;
    if (isMultiPanel) {
      const createdCount = [sanaeiSubUrl, rebeccaSubUrl, mroceanSubUrl, panel4SubUrl].filter(Boolean).length;
      if (createdCount === 0) {
        const errDetails = [
          useSanaei && `• سنایی: ${sanaeiErr || 'ناموفق'}`,
          useRebecca && `• ربکا: ${rebeccaErr || 'ناموفق'}`,
          useMrOcean && `• مستر اوشن: ${mroceanErr || 'ناموفق'}`,
          usePanel4 && `• پنل ۴: ${panel4Err || 'ناموفق'}`
        ].filter(Boolean).join('\n');
        throw new Error(`خطا در ایجاد اکانت روی پنل‌های انتخابی:\n${errDetails}`);
      }
    }

    // Determine primary subUrl
    const primarySubUrl = sanaeiSubUrl || rebeccaSubUrl || mroceanSubUrl || mroceanPortalUrl || panel4SubUrl;
    if (!primarySubUrl) {
      throw new Error('هیچ لینک اتصالی از پنل‌های انتخاب شده تولید نشد. لطفاً از اتصال پنل به ربات اطمینان حاصل فرمایید.');
    }

    const sanaeiSubId = sanaeiDetails?.subId || '';
    const rebeccaSubId = rebeccaDetails?.subId || rebeccaDetails?.token || (rebeccaDetails?.subUrl ? rebecca.extractSubToken(rebeccaDetails.subUrl) : '');
    const mroceanSubId = clientEmail;
    const panel4SubId = panel4Details?.subId || '';
    const primarySubId = sanaeiSubId || rebeccaSubId || mroceanSubId || panel4SubId || '';

    return {
      panelType,
      clientEmail,
      subId: primarySubId,
      subUrl: primarySubUrl,
      sanaeiSubUrl: sanaeiSubUrl || undefined,
      rebeccaSubUrl: rebeccaSubUrl || undefined,
      mroceanSubUrl: mroceanSubUrl || undefined,
      mroceanPortalUrl: mroceanPortalUrl || undefined,
      panel4SubUrl: panel4SubUrl || undefined,
      sanaeiDetails,
      rebeccaDetails,
      mroceanDetails,
      panel4Details
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
          subId: cl.subId || cl.id,
          up: cl.up || 0,
          down: cl.down || 0,
          totalUsed: (cl.up || 0) + (cl.down || 0),
          total: cl.total || 0,
          expiryTime: cl.expiryTime || 0,
          enable: cl.enable !== false,
          panel: 'sanaei'
        });
      }
    } catch (e) {}

    // Rebecca clients
    try {
      const rebeccaClients = await rebecca.getAllClientsWithTraffic().catch(() => []);
      for (const cl of rebeccaClients) {
        results.push({
          id: cl.id || cl.email,
          email: cl.email,
          subId: cl.subId,
          token: cl.token,
          subUrl: cl.subUrl,
          up: cl.up || 0,
          down: cl.down || 0,
          totalUsed: cl.totalUsed || ((cl.up || 0) + (cl.down || 0)),
          total: cl.total || 0,
          expiryTime: cl.expiryTime || 0,
          enable: cl.enable !== false,
          panel: 'rebecca'
        });
      }
    } catch (e) {}

    // Mr Ocean clients
    try {
      const mroceanClients = await mrocean.getAllClientsWithTraffic().catch(() => []);
      for (const cl of mroceanClients) {
        results.push({
          id: cl.id || cl.email,
          email: cl.email,
          subId: cl.subId,
          subUrl: cl.subUrl,
          portalUrl: cl.portalUrl,
          up: cl.up || 0,
          down: cl.down || 0,
          totalUsed: cl.totalUsed || ((cl.up || 0) + (cl.down || 0)),
          total: cl.total || 0,
          expiryTime: cl.expiryTime || 0,
          enable: cl.enable !== false,
          panel: 'mrocean'
        });
      }
    } catch (e) {}

    // Panel 4 clients
    try {
      const p4Clients = await panel4.getAllClientsWithTraffic().catch(() => []);
      for (const cl of p4Clients) {
        results.push({
          id: cl.id || cl.email,
          email: cl.email,
          subId: cl.subId || cl.id,
          up: cl.up || 0,
          down: cl.down || 0,
          totalUsed: cl.totalUsed || ((cl.up || 0) + (cl.down || 0)),
          total: cl.total || 0,
          expiryTime: cl.expiryTime || 0,
          enable: cl.enable !== false,
          panel: 'panel4'
        });
      }
    } catch (e) {}

    return results;
  }

  /**
   * Disables or enables client across all associated panels
   */
  public async updateClientEnable(purchase: Purchase, enable: boolean): Promise<void> {
    const pType = purchase.panelType || 'sanaei';
    const email = purchase.id;

    if (isSanaeiPanel(pType) || purchase.sanaeiSubUrl) {
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
                clientObj.enable = enable;
                await xui.updateClient(ib.id, clientObj.id, clientObj);
                break;
              }
            }
          }
        }
      } catch (e: any) {
        console.error(`[MultiPanel] updateClientEnable error Sanaei for ${email}:`, e.message);
      }
    }

    if (isRebeccaPanel(pType) || purchase.rebeccaSubUrl) {
      try {
        await rebecca.updateClientEnable(email, enable);
      } catch (e: any) {
        console.error(`[MultiPanel] updateClientEnable error Rebecca for ${email}:`, e.message);
      }
    }

    if (isMrOceanPanel(pType) || purchase.mroceanSubUrl || purchase.mroceanPortalUrl) {
      try {
        await mrocean.updateClientEnable(email, enable);
      } catch (e: any) {
        console.error(`[MultiPanel] updateClientEnable error Mr Ocean for ${email}:`, e.message);
      }
    }

    if (isPanel4(pType) || purchase.panel4SubUrl) {
      try {
        await panel4.updateClientEnable(email, enable);
      } catch (e: any) {
        console.error(`[MultiPanel] updateClientEnable error Panel 4 for ${email}:`, e.message);
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

    if (isSanaeiPanel(pType) || purchase.sanaeiSubUrl) {
      try {
        await xui.renewClient(email, volumeGb, durationDays);
        anySuccess = true;
      } catch (e: any) {
        console.error(`[MultiPanel] renewClient error Sanaei for ${email}:`, e.message);
        if (pType === 'sanaei') throw e;
      }
    }

    if (isRebeccaPanel(pType) || purchase.rebeccaSubUrl) {
      try {
        await rebecca.renewClient(email, volumeGb, durationDays);
        anySuccess = true;
      } catch (e: any) {
        console.error(`[MultiPanel] renewClient error Rebecca for ${email}:`, e.message);
        if (pType === 'rebecca') throw e;
      }
    }

    if (isMrOceanPanel(pType) || purchase.mroceanSubUrl || purchase.mroceanPortalUrl) {
      try {
        await mrocean.renewClient(email, volumeGb, durationDays);
        anySuccess = true;
      } catch (e: any) {
        console.error(`[MultiPanel] renewClient error Mr Ocean for ${email}:`, e.message);
        if (pType === 'mrocean') throw e;
      }
    }

    if (isPanel4(pType) || purchase.panel4SubUrl) {
      try {
        await panel4.renewClient(email, volumeGb, durationDays);
        anySuccess = true;
      } catch (e: any) {
        console.error(`[MultiPanel] renewClient error Panel 4 for ${email}:`, e.message);
        if (pType === 'panel4') throw e;
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

    if (isSanaeiPanel(pType) || purchase.sanaeiSubUrl) {
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

    if (isRebeccaPanel(pType) || purchase.rebeccaSubUrl) {
      try {
        await rebecca.delClient(email);
      } catch (e: any) {
        console.error(`[MultiPanel] delClient error Rebecca for ${email}:`, e.message);
      }
    }

    if (isMrOceanPanel(pType) || purchase.mroceanSubUrl || purchase.mroceanPortalUrl) {
      try {
        await mrocean.delClient(email);
      } catch (e: any) {
        console.error(`[MultiPanel] delClient error Mr Ocean for ${email}:`, e.message);
      }
    }

    if (isPanel4(pType) || purchase.panel4SubUrl) {
      try {
        await panel4.delClient(email);
      } catch (e: any) {
        console.error(`[MultiPanel] delClient error Panel 4 for ${email}:`, e.message);
      }
    }
  }

  /**
   * Fetches real-time online statistics across Sanaei, Rebecca, Mr Ocean, and Panel 4 separately
   */
  public async getOnlineStats(): Promise<{
    sanaei: { onlineCount: number; totalClients: number; clients: any[] };
    rebecca: { onlineCount: number; totalUsers: number; users: any[] };
    mrocean: { onlineCount: number; totalUsers: number; users: any[] };
    panel4: { onlineCount: number; totalUsers: number; users: any[] };
    totalOnline: number;
    totalAll: number;
  }> {
    const [sanaeiRes, rebeccaRes, mroceanRes, panel4Res] = await Promise.allSettled([
      xui.getOnlineClients(),
      rebecca.getOnlineUsers(),
      mrocean.getOnlineUsers(),
      panel4.getOnlineUsers()
    ]);

    const sanaei = sanaeiRes.status === 'fulfilled' ? sanaeiRes.value : { onlineCount: 0, totalClients: 0, clients: [] };
    const reb = rebeccaRes.status === 'fulfilled' ? rebeccaRes.value : { onlineCount: 0, totalUsers: 0, users: [] };
    const mro = mroceanRes.status === 'fulfilled' ? mroceanRes.value : { onlineCount: 0, totalUsers: 0, users: [] };
    const p4 = panel4Res.status === 'fulfilled' ? panel4Res.value : { onlineCount: 0, totalUsers: 0, users: [] };

    const totalOnline = (sanaei.onlineCount || 0) + (reb.onlineCount || 0) + (mro.onlineCount || 0) + (p4.onlineCount || 0);
    const totalAll = (sanaei.totalClients || 0) + (reb.totalUsers || 0) + (mro.totalUsers || 0) + (p4.totalUsers || 0);

    return {
      sanaei,
      rebecca: reb,
      mrocean: mro,
      panel4: p4,
      totalOnline,
      totalAll
    };
  }
}

export const multiPanel = new MultiPanelService();
