import axios, { AxiosInstance } from 'axios';
import https from 'https';
import { v4 as uuidv4 } from 'uuid';
import { db } from './db.js';

export interface Panel4ClientDetails {
  id: string;
  email: string;
  uuid: string;
  subId: string;
  subUrl: string;
  inboundId?: number | string;
  inboundIds?: (number | string)[];
  totalBytes: number;
  expiryTime: number;
  limitIp: number;
  enable: boolean;
}

export interface Panel4OnlineUser {
  email: string;
  inboundId?: number | string;
  ip?: string;
  lastOnline?: string;
}

export class Panel4Client {
  private client: AxiosInstance;
  private cookie: string = '';
  private workingApiPrefix: string = '';
  private lastPanelUrl: string = '';
  private lastPanelUser: string = '';
  private lastPanelPass: string = '';
  private lastPanelApiKey: string = '';

  constructor() {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    this.client = axios.create({
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*'
      },
      httpsAgent: new https.Agent({ 
        rejectUnauthorized: false,
        keepAlive: true
      }),
    });
  }

  private async getAuthOptions(panelOverride?: any) {
    const state = db.getState();
    const panel = panelOverride || state.panel4 || {};
    
    const hasApiKey = panel.apiKey && panel.apiKey.trim() !== '';
    const hasUserPass = (panel.username && panel.username.trim() !== '') && (panel.password && panel.password.trim() !== '');

    if (!panel.url || (!hasApiKey && !hasUserPass)) {
      throw new Error('مشخصات پنل ۴ کامل نیست. لطفاً آدرس پنل به همراه نام کاربری و رمز ورود یا کلید API را وارد کنید.');
    }
    
    if (
      panel.url !== this.lastPanelUrl ||
      panel.username !== this.lastPanelUser ||
      panel.password !== this.lastPanelPass ||
      panel.apiKey !== this.lastPanelApiKey
    ) {
      this.cookie = '';
      this.workingApiPrefix = '';
      this.lastPanelUrl = panel.url || '';
      this.lastPanelUser = panel.username || '';
      this.lastPanelPass = panel.password || '';
      this.lastPanelApiKey = panel.apiKey || '';
    }

    let formattedUrl = panel.url.trim().replace(/\s/g, '');
    if (!formattedUrl.startsWith('http://') && !formattedUrl.startsWith('https://')) {
      formattedUrl = 'http://' + formattedUrl;
    }
    
    let baseURL = formattedUrl.endsWith('/') ? formattedUrl.slice(0, -1) : formattedUrl;
    
    const commonSuffixes = ['/panel', '/api', '/panel/api'];
    for (const suffix of commonSuffixes) {
      if (baseURL.toLowerCase().endsWith(suffix)) {
        baseURL = baseURL.slice(0, -suffix.length);
      }
    }

    // 1. API Key Auth
    if (hasApiKey) {
      const apiKey = panel.apiKey.trim();
      return { 
        baseURL, 
        headers: { 
          'Api-Key': apiKey, 
          'X-Api-Key': apiKey, 
          'Authorization': `Bearer ${apiKey}`, 
          'Accept': 'application/json' 
        } 
      };
    }

    // 2. Cookie Session Auth
    if (!this.cookie) {
      const loginPaths = ['/login', '/panel/login'];
      let loginSuccess = false;
      let lastLoginError = '';

      for (const path of loginPaths) {
        try {
          const res = await this.client.post(`${baseURL}${path}`, {
            username: panel.username.trim(),
            password: panel.password.trim()
          }, {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
              'Accept': 'application/json, text/plain, */*'
            }
          });

          if (res.data?.success || res.status === 200) {
            const rawCookies = res.headers['set-cookie'];
            if (rawCookies && rawCookies.length > 0) {
              this.cookie = rawCookies.map((c: string) => c.split(';')[0]).join('; ');
              loginSuccess = true;
              break;
            }
          }
        } catch (e: any) {
          lastLoginError = e.message;
        }
      }

      if (!loginSuccess && !this.cookie) {
        throw new Error(`عدم موفقیت در ورود به پنل ۴. لطفاً آدرس، نام کاربری و رمز عبور را بررسی فرمایید: ${lastLoginError}`);
      }
    }

    return {
      baseURL,
      headers: {
        'Cookie': this.cookie,
        'Accept': 'application/json'
      }
    };
  }

  public async testConnection(panelOverride?: any): Promise<{ success: boolean; message: string; inboundsCount?: number }> {
    try {
      const inbounds = await this.getInbounds(panelOverride);
      return {
        success: true,
        message: `اتصال به پنل ۴ با موفقیت برقرار شد. (${inbounds.length} اینباند فعال)`,
        inboundsCount: inbounds.length
      };
    } catch (err: any) {
      return {
        success: false,
        message: err.message || 'خطا در برقراری ارتباط با پنل ۴'
      };
    }
  }

  public async getInbounds(panelOverride?: any): Promise<any[]> {
    try {
      const state = db.getState();
      const panel = panelOverride || state.panel4 || {};
      if (!panel.url || panel.enabled === false) return [];
      if (panel.url.includes('test-') || panel.url.includes('example.com')) return [];

      const auth = await this.getAuthOptions(panelOverride);
      const prefixes = this.workingApiPrefix 
        ? [this.workingApiPrefix] 
        : ['/panel/api/inbounds', '/xui/api/inbounds', '/api/inbounds', '/inbounds'];

      for (const prefix of prefixes) {
        try {
          const res = await this.client.get(`${auth.baseURL}${prefix}/list`, {
            headers: auth.headers,
            timeout: 8000
          });

          if (res.data?.success && Array.isArray(res.data.obj)) {
            this.workingApiPrefix = prefix;
            return res.data.obj;
          } else if (Array.isArray(res.data)) {
            this.workingApiPrefix = prefix;
            return res.data;
          }
        } catch (err: any) {
          // continue to next prefix
        }
      }

      return [];
    } catch (e: any) {
      console.warn('[Panel4] getInbounds note:', e.message);
      return [];
    }
  }

  public async addClient(
    clientEmail: string,
    volumeGb: number,
    durationDays: number,
    targetInboundIds?: (number | string)[],
    limitIp: number = 0,
    chatId?: string,
    sellerGroupName?: string
  ): Promise<Panel4ClientDetails> {
    const state = db.getState();
    const panel = state.panel4 || {};
    const auth = await this.getAuthOptions();

    const inbounds = await this.getInbounds();
    if (!inbounds || inbounds.length === 0) {
      throw new Error('هیچ اینباندی روی پنل ۴ یافت نشد. ابتدا یک اینباند ایجاد کنید.');
    }

    let inboundIds = targetInboundIds && targetInboundIds.length > 0 
      ? targetInboundIds 
      : (panel.inboundIds && panel.inboundIds.length > 0 ? panel.inboundIds : (panel.inboundId ? [panel.inboundId] : []));

    if (inboundIds.length === 0) {
      inboundIds = [inbounds[0].id];
    }

    const uuid = uuidv4();
    const subId = Math.random().toString(36).substring(2, 18);
    const totalBytes = volumeGb > 0 ? Math.round(volumeGb * 1024 * 1024 * 1024) : 0;
    const expiryTime = durationDays > 0 ? Date.now() + Math.round(durationDays * 86400000) : 0;

    const prefix = this.workingApiPrefix || '/panel/api/inbounds';
    let addedToAny = false;

    for (const ibId of inboundIds) {
      const targetIb = inbounds.find((ib: any) => String(ib.id) === String(ibId));
      if (!targetIb) continue;

      const clientPayload = {
        id: uuid,
        email: clientEmail,
        limitIp: limitIp || 0,
        totalGB: totalBytes,
        expiryTime: expiryTime,
        enable: true,
        tgId: chatId ? String(chatId) : '',
        subId: subId,
        flow: targetIb.protocol === 'vless' ? '' : undefined,
        comment: sellerGroupName || ''
      };

      try {
        const res = await this.client.post(`${auth.baseURL}${prefix}/addClient`, {
          id: targetIb.id,
          settings: JSON.stringify({ clients: [clientPayload] })
        }, {
          headers: auth.headers
        });

        if (res.data?.success) {
          addedToAny = true;
        }
      } catch (err: any) {
        console.error(`[Panel 4] Error adding client to inbound ${ibId}:`, err.message);
      }
    }

    if (!addedToAny) {
      throw new Error('ایجاد کلاینت روی اینباندهای مشخص شده پنل ۴ با خطا مواجه شد.');
    }

    let subUrl = '';
    if (panel.subUrlBase && panel.subUrlBase.trim() !== '') {
      let base = panel.subUrlBase.trim();
      if (!base.endsWith('/')) base += '/';
      subUrl = `${base}${subId}`;
    } else {
      subUrl = `${auth.baseURL}/sub/${subId}`;
    }

    return {
      id: clientEmail,
      email: clientEmail,
      uuid,
      subId,
      subUrl,
      inboundIds,
      totalBytes,
      expiryTime,
      limitIp,
      enable: true
    };
  }

  public async renewClient(email: string, volumeGb: number, durationDays: number): Promise<void> {
    const auth = await this.getAuthOptions();
    const inbounds = await this.getInbounds();
    const prefix = this.workingApiPrefix || '/panel/api/inbounds';

    let found = false;

    for (const ib of inbounds) {
      if (!ib.settings) continue;
      const settings = typeof ib.settings === 'string' ? JSON.parse(ib.settings) : ib.settings;
      if (!settings || !Array.isArray(settings.clients)) continue;

      const clientObj = settings.clients.find((cl: any) => 
        (cl.email && cl.email.toLowerCase() === email.toLowerCase()) ||
        (cl.id && cl.id.toLowerCase() === email.toLowerCase())
      );

      if (clientObj) {
        found = true;
        const addBytes = volumeGb > 0 ? Math.round(volumeGb * 1024 * 1024 * 1024) : 0;
        const addMs = durationDays > 0 ? Math.round(durationDays * 86400000) : 0;

        // Reset traffic counters
        clientObj.up = 0;
        clientObj.down = 0;
        clientObj.totalGB = addBytes;
        clientObj.expiryTime = addMs > 0 ? (Math.max(Date.now(), clientObj.expiryTime || 0) + addMs) : 0;
        clientObj.enable = true;

        await this.client.post(`${auth.baseURL}${prefix}/updateClient/${clientObj.id}`, {
          id: ib.id,
          settings: JSON.stringify({ clients: [clientObj] })
        }, {
          headers: auth.headers
        });
      }
    }

    if (!found) {
      throw new Error(`کاربر با ایمیل ${email} روی هیچ‌یک از اینباندهای پنل ۴ یافت نشد.`);
    }
  }

  public async updateClientEnable(email: string, enable: boolean): Promise<void> {
    const auth = await this.getAuthOptions();
    const inbounds = await this.getInbounds();
    const prefix = this.workingApiPrefix || '/panel/api/inbounds';

    for (const ib of inbounds) {
      if (!ib.settings) continue;
      const settings = typeof ib.settings === 'string' ? JSON.parse(ib.settings) : ib.settings;
      if (!settings || !Array.isArray(settings.clients)) continue;

      const clientObj = settings.clients.find((cl: any) => 
        (cl.email && cl.email.toLowerCase() === email.toLowerCase()) ||
        (cl.id && cl.id.toLowerCase() === email.toLowerCase())
      );

      if (clientObj) {
        clientObj.enable = enable;
        await this.client.post(`${auth.baseURL}${prefix}/updateClient/${clientObj.id}`, {
          id: ib.id,
          settings: JSON.stringify({ clients: [clientObj] })
        }, {
          headers: auth.headers
        });
      }
    }
  }

  public async delClient(email: string): Promise<void> {
    const auth = await this.getAuthOptions();
    const inbounds = await this.getInbounds();
    const prefix = this.workingApiPrefix || '/panel/api/inbounds';

    for (const ib of inbounds) {
      if (!ib.settings) continue;
      const settings = typeof ib.settings === 'string' ? JSON.parse(ib.settings) : ib.settings;
      if (!settings || !Array.isArray(settings.clients)) continue;

      const clientObj = settings.clients.find((cl: any) => 
        (cl.email && cl.email.toLowerCase() === email.toLowerCase()) ||
        (cl.id && cl.id.toLowerCase() === email.toLowerCase())
      );

      if (clientObj) {
        await this.client.post(`${auth.baseURL}${prefix}/delClient/${clientObj.id}`, {
          id: ib.id
        }, {
          headers: auth.headers
        }).catch(() => null);
      }
    }
  }

  public async getAllClientsWithTraffic(): Promise<any[]> {
    try {
      const state = db.getState();
      const panel = state.panel4 || {};
      if (!panel.url || panel.enabled === false) return [];
      if (panel.url.includes('test-') || panel.url.includes('example.com')) return [];

      const inbounds = await this.getInbounds().catch(() => []);
      const results: any[] = [];

      for (const ib of inbounds) {
        if (!ib.clientStats && !ib.settings) continue;
        
        const statsMap = new Map<string, any>();
        if (Array.isArray(ib.clientStats)) {
          ib.clientStats.forEach((st: any) => {
            statsMap.set(st.email || st.id, st);
          });
        }

        const settings = typeof ib.settings === 'string' ? JSON.parse(ib.settings) : ib.settings;
        if (settings && Array.isArray(settings.clients)) {
          for (const cl of settings.clients) {
            const key = cl.email || cl.id;
            const stat = statsMap.get(key) || {};
            results.push({
              id: cl.id,
              email: cl.email,
              subId: cl.subId,
              up: stat.up || cl.up || 0,
              down: stat.down || cl.down || 0,
              totalUsed: (stat.up || cl.up || 0) + (stat.down || cl.down || 0),
              total: cl.totalGB || stat.total || 0,
              expiryTime: cl.expiryTime || stat.expiryTime || 0,
              enable: cl.enable !== false,
              panel: 'panel4'
            });
          }
        }
      }

      return results;
    } catch (e: any) {
      console.warn('[Panel4] getAllClientsWithTraffic note:', e.message);
      return [];
    }
  }

  public async getOnlineUsers(): Promise<{ onlineCount: number; totalUsers: number; users: Panel4OnlineUser[] }> {
    try {
      const auth = await this.getAuthOptions();
      const prefix = this.workingApiPrefix || '/panel/api/inbounds';

      let onlineEmails: string[] = [];
      try {
        const res = await this.client.post(`${auth.baseURL}${prefix}/onlines`, {}, {
          headers: auth.headers
        });
        if (res.data?.success && Array.isArray(res.data.obj)) {
          onlineEmails = res.data.obj;
        }
      } catch (e) {}

      const allClients = await this.getAllClientsWithTraffic();
      const onlineUsers: Panel4OnlineUser[] = onlineEmails.map(email => ({
        email,
        lastOnline: new Date().toLocaleTimeString('fa-IR', { timeZone: 'Asia/Tehran' })
      }));

      return {
        onlineCount: onlineEmails.length,
        totalUsers: allClients.length,
        users: onlineUsers
      };
    } catch (err) {
      return {
        onlineCount: 0,
        totalUsers: 0,
        users: []
      };
    }
  }
}

export const panel4 = new Panel4Client();
