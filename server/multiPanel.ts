import { xui } from './xui.js';
import { rebecca } from './rebecca.js';
import { mrocean } from './mrocean.js';
import { db, User, Product, Purchase, PanelType } from './db.js';

export function isSanaeiPanel(panelType?: PanelType | string): boolean {
  return ['sanaei', 'both', 'sanaei_rebecca', 'sanaei_mrocean', 'all'].includes(panelType || '');
}

export function isRebeccaPanel(panelType?: PanelType | string): boolean {
  return ['rebecca', 'both', 'sanaei_rebecca', 'rebecca_mrocean', 'all'].includes(panelType || '');
}

export function isMrOceanPanel(panelType?: PanelType | string): boolean {
  return ['mrocean', 'sanaei_mrocean', 'rebecca_mrocean', 'all'].includes(panelType || '');
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
  sanaeiDetails?: any;
  rebeccaDetails?: any;
  mroceanDetails?: any;
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
  panel: 'sanaei' | 'rebecca' | 'mrocean';
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
    let mroceanSubUrl = '';
    let mroceanPortalUrl = '';
    let sanaeiDetails: any = null;
    let rebeccaDetails: any = null;
    let mroceanDetails: any = null;

    let sanaeiErr: string | null = null;
    let rebeccaErr: string | null = null;
    let mroceanErr: string | null = null;

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

    // Verify at least one link produced for multi-panel setups
    const isMultiPanel = [useSanaei, useRebecca, useMrOcean].filter(Boolean).length > 1;
    if (isMultiPanel) {
      const createdCount = [sanaeiSubUrl, rebeccaSubUrl, mroceanSubUrl].filter(Boolean).length;
      if (createdCount === 0) {
        const errDetails = [
          useSanaei && `• سنایی: ${sanaeiErr || 'ناموفق'}`,
          useRebecca && `• ربکا: ${rebeccaErr || 'ناموفق'}`,
          useMrOcean && `• مستر اوشن: ${mroceanErr || 'ناموفق'}`
        ].filter(Boolean).join('\n');
        throw new Error(`خطا در ایجاد اکانت روی پنل‌های انتخابی:\n${errDetails}`);
      }
    }

    // Determine primary subUrl
    const primarySubUrl = sanaeiSubUrl || rebeccaSubUrl || mroceanSubUrl || mroceanPortalUrl;
    if (!primarySubUrl) {
      throw new Error('هیچ لینک اتصالی از پنل‌های انتخاب شده تولید نشد. لطفاً از اتصال پنل به ربات اطمینان حاصل فرمایید.');
    }

    const sanaeiSubId = sanaeiDetails?.subId || '';
    const rebeccaSubId = rebeccaDetails?.subId || rebeccaDetails?.token || (rebeccaDetails?.subUrl ? rebecca.extractSubToken(rebeccaDetails.subUrl) : '');
    const mroceanSubId = clientEmail;
    const primarySubId = sanaeiSubId || rebeccaSubId || mroceanSubId || '';

    return {
      panelType,
      clientEmail,
      subId: primarySubId,
      subUrl: primarySubUrl,
      sanaeiSubUrl: sanaeiSubUrl || undefined,
      rebeccaSubUrl: rebeccaSubUrl || undefined,
      mroceanSubUrl: mroceanSubUrl || undefined,
      mroceanPortalUrl: mroceanPortalUrl || undefined,
      sanaeiDetails,
      rebeccaDetails,
      mroceanDetails
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
  }
}

export const multiPanel = new MultiPanelService();
