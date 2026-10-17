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
      const authHeader = apiKey.startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`;
      return { 
        baseURL, 
        headers: { 
          'Api-Key': apiKey, 
          'X-Api-Key': apiKey, 
          'X-API-Key': apiKey,
          'Authorization': authHeader, 
          'Accept': 'application/json' 
        } 
      };
    }

    // 2. Bearer Token Auth via Login (/api/admins/token) or Cookie Session
    if (!this.cookie) {
      const loginPaths = ['/api/admins/token', '/login', '/panel/login'];
      let loginSuccess = false;
      let lastLoginError = '';

      for (const path of loginPaths) {
        try {
          // Form-encoded (FastAPI / Panel 4 standard)
          const params = new URLSearchParams();
          params.append('grant_type', 'password');
          params.append('username', panel.username.trim());
          params.append('password', panel.password.trim());

          let res = await this.client.post(`${baseURL}${path}`, params, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            validateStatus: () => true,
            timeout: 10000
          });

          if (res.data?.token || res.data?.access_token) {
            this.cookie = res.data.token || res.data.access_token;
            loginSuccess = true;
            break;
          }

          // JSON mode
          res = await this.client.post(`${baseURL}${path}`, {
            username: panel.username.trim(),
            password: panel.password.trim()
          }, {
            headers: { 'Content-Type': 'application/json' },
            validateStatus: () => true,
            timeout: 10000
          });

          if (res.data?.token || res.data?.access_token) {
            this.cookie = res.data.token || res.data.access_token;
            loginSuccess = true;
            break;
          } else if (res.data?.success || res.status === 200) {
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

    const authHeader = this.cookie.startsWith('Bearer ') ? this.cookie : (this.cookie.includes('.') ? `Bearer ${this.cookie}` : this.cookie);
    return {
      baseURL,
      headers: {
        'Authorization': authHeader,
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
      const inboundsList: any[] = [];

      // 1. Check Panel 4 native Services API (/api/services or /api/admins/current)
      const servicePaths = ['/api/services', '/api/v2/services', '/api/v1/services', '/api/admins/current', '/api/admins/current/links'];
      for (const sp of servicePaths) {
        try {
          const res = await this.client.get(`${auth.baseURL}${sp}`, {
            headers: auth.headers,
            timeout: 8000,
            validateStatus: () => true
          });

          if (res.status === 200 && res.data) {
            const data = res.data;
            const items = Array.isArray(data) 
              ? data 
              : (data.items || data.services || data.data || data.obj || data.result);
            
            if (Array.isArray(items) && items.length > 0) {
              for (const s of items) {
                const id = s.id !== undefined ? s.id : (s.service_id || s.tag || s.name);
                const remark = s.name || s.title || s.remark || s.tag || `Service #${id}`;
                if (id !== undefined && !inboundsList.some(i => String(i.id) === String(id))) {
                  inboundsList.push({
                    id,
                    remark,
                    protocol: s.protocol || 'Service',
                    enable: s.enable !== false,
                    ...s
                  });
                }
              }
            }
          }
        } catch (e) {}
      }

      // 2. Check X-UI / 3x-ui style inbounds prefixes
      const prefixes = this.workingApiPrefix 
        ? [this.workingApiPrefix] 
        : [
            '/panel/api/inbounds',
            '/xui/api/inbounds',
            '/api/inbounds',
            '/inbounds',
            '/api/v1/inbounds',
            '/api/v2/inbounds',
            '/api/inbound',
            '/panel/inbounds'
          ];

      for (const prefix of prefixes) {
        try {
          let res = await this.client.get(`${auth.baseURL}${prefix}/list`, {
            headers: auth.headers,
            timeout: 8000,
            validateStatus: () => true
          });

          if (res.status !== 200 || !res.data) {
            res = await this.client.get(`${auth.baseURL}${prefix}`, {
              headers: auth.headers,
              timeout: 8000,
              validateStatus: () => true
            });
          }

          if (res.status === 200 && res.data) {
            const data = res.data;
            const items = Array.isArray(data) 
              ? data 
              : (data.obj || data.data || data.items || data.inbounds || data.hosts || data.nodes || data.services || data.result);
            
            if (Array.isArray(items) && items.length > 0) {
              this.workingApiPrefix = prefix;
              for (const ib of items) {
                const id = ib.id !== undefined ? ib.id : ib.tag;
                if (id !== undefined && !inboundsList.some(i => String(i.id) === String(id))) {
                  inboundsList.push({
                    id,
                    remark: ib.remark || ib.tag || ib.name || `Inbound ${id}`,
                    protocol: ib.protocol || 'vless',
                    ...ib
                  });
                }
              }
            }
          }
        } catch (err: any) {
          // continue
        }
      }

      return inboundsList;
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
      throw new Error('هیچ اینباند یا سرویسی روی پنل ۴ یافت نشد. ابتدا یک اینباند یا سرویس ایجاد کنید.');
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
    const expireSeconds = durationDays > 0 ? Math.floor(expiryTime / 1000) : 0;

    let cleanEmail = clientEmail.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
    if (cleanEmail.length < 3) cleanEmail = `user_${cleanEmail}_${Date.now().toString().slice(-4)}`;

    let createdSubUrl = '';
    let addedToAny = false;

    // 1. Try Panel 4 Native Subscriptions API (POST /api/subscriptions)
    for (const ibId of inboundIds) {
      const targetIb = inbounds.find((ib: any) => String(ib.id) === String(ibId));
      if (!targetIb) continue;

      const subPayload: any = {
        username: cleanEmail,
        services: [Number(ibId) || ibId],
        usage_limit: totalBytes,
        expire_days: durationDays > 0 ? durationDays : undefined,
        note: sellerGroupName || ''
      };

      try {
        const subEndpoints = [
          `${auth.baseURL}/api/subscriptions`,
          `${auth.baseURL}/api/v2/users`,
          `${auth.baseURL}/api/user`
        ];

        for (const ep of subEndpoints) {
          const res = await this.client.post(ep, subPayload, {
            headers: auth.headers,
            timeout: 10000,
            validateStatus: () => true
          });

          if (res.status >= 200 && res.status < 300 && res.data) {
            addedToAny = true;
            const dataObj = Array.isArray(res.data) ? res.data[0] : res.data;
            if (dataObj) {
              createdSubUrl = dataObj.subscription_link || dataObj.subscription_url || dataObj.url || dataObj.link || '';
            }
            break;
          }
        }
      } catch (e) {}

      if (addedToAny) break;
    }

    // 2. Try fetching subscription link directly if created
    if (addedToAny && !createdSubUrl) {
      try {
        const linkRes = await this.client.get(`${auth.baseURL}/api/subscriptions/${cleanEmail}/links`, {
          headers: auth.headers,
          timeout: 6000,
          validateStatus: () => true
        });

        if (linkRes.status === 200 && linkRes.data) {
          if (typeof linkRes.data === 'string') {
            createdSubUrl = linkRes.data;
          } else if (Array.isArray(linkRes.data) && linkRes.data.length > 0) {
            createdSubUrl = typeof linkRes.data[0] === 'string' ? linkRes.data[0] : (linkRes.data[0].url || linkRes.data[0].link || '');
          } else if (linkRes.data.links && Array.isArray(linkRes.data.links) && linkRes.data.links.length > 0) {
            createdSubUrl = typeof linkRes.data.links[0] === 'string' ? linkRes.data.links[0] : (linkRes.data.links[0].url || linkRes.data.links[0].link || '');
          }
        }
      } catch (e) {}
    }

    // 3. Fallback to 3x-ui / X-UI style addClient if native subscriptions failed
    if (!addedToAny) {
      const prefix = this.workingApiPrefix || '/panel/api/inbounds';

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
    }

    if (!addedToAny) {
      throw new Error('ایجاد کلاینت روی اینباندهای مشخص شده پنل ۴ با خطا مواجه شد.');
    }

    let subUrl = createdSubUrl;
    if (!subUrl) {
      if (panel.subUrlBase && panel.subUrlBase.trim() !== '') {
        let base = panel.subUrlBase.trim();
        if (!base.endsWith('/')) base += '/';
        subUrl = `${base}${subId}`;
      } else {
        subUrl = `${auth.baseURL}/sub/${subId}`;
      }
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

    // Try Panel 4 actions API
    try {
      if (volumeGb > 0) {
        await this.client.post(`${auth.baseURL}/api/actions/usage/${volumeGb}`, {
          usernames: [email]
        }, { headers: auth.headers, validateStatus: () => true });
      }
      if (durationDays > 0) {
        await this.client.post(`${auth.baseURL}/api/actions/expire/${durationDays}`, {
          usernames: [email]
        }, { headers: auth.headers, validateStatus: () => true });
      }
    } catch (e) {}

    // Also try 3x-ui style renewal
    const inbounds = await this.getInbounds().catch(() => []);
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

        clientObj.up = 0;
        clientObj.down = 0;
        clientObj.totalGB = addBytes;
        clientObj.expiryTime = addMs > 0 ? (Math.max(Date.now(), clientObj.expiryTime || 0) + addMs) : 0;
        clientObj.enable = true;

        await this.client.post(`${auth.baseURL}${prefix}/updateClient/${clientObj.id}`, {
          id: ib.id,
          settings: JSON.stringify({ clients: [clientObj] })
        }, { headers: auth.headers }).catch(() => null);
      }
    }
  }

  public async updateClientEnable(email: string, enable: boolean): Promise<void> {
    const auth = await this.getAuthOptions();

    // Try Panel 4 bulk enable/disable
    try {
      const actionEp = enable ? '/api/subscriptions/enable' : '/api/subscriptions/disable';
      await this.client.post(`${auth.baseURL}${actionEp}`, {
        usernames: [email]
      }, { headers: auth.headers, validateStatus: () => true });
    } catch (e) {}

    // Fallback to 3x-ui
    const inbounds = await this.getInbounds().catch(() => []);
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
        }, { headers: auth.headers }).catch(() => null);
      }
    }
  }

  public async delClient(email: string): Promise<void> {
    const auth = await this.getAuthOptions();

    // Try Panel 4 subscriptions DELETE
    try {
      await this.client.delete(`${auth.baseURL}/api/subscriptions`, {
        data: { usernames: [email] },
        headers: auth.headers,
        validateStatus: () => true
      });
      await this.client.delete(`${auth.baseURL}/api/subscriptions/${email}`, {
        headers: auth.headers,
        validateStatus: () => true
      });
    } catch (e) {}

    // Fallback to 3x-ui
    const inbounds = await this.getInbounds().catch(() => []);
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
        }, { headers: auth.headers }).catch(() => null);
      }
    }
  }

  public async getAllClientsWithTraffic(): Promise<any[]> {
    try {
      const state = db.getState();
      const panel = state.panel4 || {};
      if (!panel.url || panel.enabled === false) return [];
      if (panel.url.includes('test-') || panel.url.includes('example.com')) return [];

      const auth = await this.getAuthOptions();
      const results: any[] = [];

      // 1. Try Panel 4 native Subscriptions API (/api/subscriptions or /api/stats/subscriptions)
      const subEndpoints = ['/api/subscriptions', '/api/stats/subscriptions', '/api/subscriptions/stats'];
      for (const ep of subEndpoints) {
        try {
          const res = await this.client.get(`${auth.baseURL}${ep}`, {
            headers: auth.headers,
            timeout: 8000,
            validateStatus: () => true
          });

          if (res.status === 200 && res.data) {
            const data = res.data;
            const items = Array.isArray(data) 
              ? data 
              : (data.items || data.subscriptions || data.data || data.obj || data.result);

            if (Array.isArray(items) && items.length > 0) {
              for (const sub of items) {
                const username = sub.username || sub.email || sub.id;
                if (!username) continue;

                results.push({
                  id: username,
                  email: username,
                  subId: sub.sub_id || sub.subId || username,
                  up: sub.up || sub.upload || 0,
                  down: sub.down || sub.download || 0,
                  totalUsed: sub.used_traffic !== undefined ? sub.used_traffic : ((sub.up || 0) + (sub.down || 0)),
                  total: sub.data_limit || sub.total || 0,
                  expiryTime: sub.expire ? sub.expire * 1000 : (sub.expiryTime || 0),
                  enable: sub.status === 'active' || sub.enable !== false,
                  panel: 'panel4'
                });
              }
              if (results.length > 0) return results;
            }
          }
        } catch (e) {}
      }

      // 2. Fallback to 3x-ui inbounds clientStats
      const inbounds = await this.getInbounds().catch(() => []);
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
