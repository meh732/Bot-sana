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

    // 1. Username/Password Login Auth (FastAPI / Panel 4 / Marzban / 3x-ui standard)
    if (hasUserPass) {
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

        if (!loginSuccess && !this.cookie && hasApiKey) {
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

    // 2. Pure API Key Auth
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

    throw new Error('مشخصات احراز هویت پنل ۴ تعریف نشده است.');
  }

  public async testConnection(panelOverride?: any): Promise<{ success: boolean; message: string; inboundsCount?: number; inbounds?: any[] }> {
    try {
      const inbounds = await this.getInbounds(panelOverride);
      return {
        success: true,
        message: `اتصال به پنل ۴ با موفقیت برقرار شد. (${inbounds.length} سرویس/اینباند فعال)`,
        inboundsCount: inbounds.length,
        inbounds
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
      const servicePaths = ['/api/services', '/api/admins/current'];
      for (const sp of servicePaths) {
        try {
          const res = await this.client.get(`${auth.baseURL}${sp}`, {
            headers: auth.headers,
            timeout: 5000,
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
              if (inboundsList.length > 0) {
                return inboundsList;
              }
            }
          }
        } catch (e) {}
      }

      // 2. Check X-UI / 3x-ui style inbounds prefixes if native services API returned nothing
      const prefixes = this.workingApiPrefix 
        ? [this.workingApiPrefix] 
        : [
            '/panel/api/inbounds',
            '/api/inbounds',
            '/inbounds'
          ];

      for (const prefix of prefixes) {
        try {
          let res = await this.client.get(`${auth.baseURL}${prefix}/list`, {
            headers: auth.headers,
            timeout: 5000,
            validateStatus: () => true
          });
          if (res.status !== 200 || !res.data) {
            res = await this.client.get(`${auth.baseURL}${prefix}`, {
              headers: auth.headers,
              timeout: 5000,
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
              if (inboundsList.length > 0) return inboundsList;
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

  /**
   * Fundamental client creation method supporting both positional and object options.
   * Fully validated against Panel 4 API specification and seller permission limits.
   */
  public async addClient(
    emailOrOptions: string | {
      clientEmail?: string;
      email?: string;
      volumeGb?: number;
      totalGB?: number;
      durationDays?: number;
      expiryDays?: number;
      targetInboundIds?: (number | string)[];
      inboundIds?: (number | string)[];
      inboundId?: number | string;
      limitIp?: number;
      chatId?: string;
      sellerGroupName?: string;
    },
    posVolumeGb?: number,
    posDurationDays?: number,
    posTargetInboundIds?: (number | string)[],
    posLimitIp: number = 0,
    posChatId?: string,
    posSellerGroupName?: string
  ): Promise<Panel4ClientDetails> {
    const state = db.getState();
    const panel = state.panel4 || {};
    const auth = await this.getAuthOptions();

    // 1. Extract arguments cleanly from either object or positional format
    let rawEmail = typeof emailOrOptions === 'object' ? (emailOrOptions.clientEmail || emailOrOptions.email || '') : emailOrOptions;
    let volumeGb = typeof emailOrOptions === 'object' ? (emailOrOptions.volumeGb ?? emailOrOptions.totalGB ?? 0) : (posVolumeGb ?? 0);
    let durationDays = typeof emailOrOptions === 'object' ? (emailOrOptions.durationDays ?? emailOrOptions.expiryDays ?? 0) : (posDurationDays ?? 0);
    let targetInboundIds = typeof emailOrOptions === 'object' 
      ? (emailOrOptions.targetInboundIds || emailOrOptions.inboundIds || (emailOrOptions.inboundId ? [emailOrOptions.inboundId] : [])) 
      : posTargetInboundIds;
    let limitIp = typeof emailOrOptions === 'object' ? (emailOrOptions.limitIp ?? 0) : (posLimitIp ?? 0);
    let chatId = typeof emailOrOptions === 'object' ? emailOrOptions.chatId : posChatId;
    let sellerGroupName = typeof emailOrOptions === 'object' ? emailOrOptions.sellerGroupName : posSellerGroupName;

    // 2. Fetch available services/inbounds on Panel 4
    const inbounds = await this.getInbounds();
    if (!inbounds || inbounds.length === 0) {
      throw new Error('هیچ اینباند یا سرویسی روی پنل ۴ یافت نشد. لطفاً در تنظیمات پنل ۴ اتصال و سرویس‌ها را بررسی فرمایید.');
    }

    // Match requested inbounds against available services on Panel 4
    const availableServiceIds = inbounds.map((ib: any) => Number(ib.id) || ib.id);
    let matchedServices: number[] = [];
    if (targetInboundIds && targetInboundIds.length > 0) {
      matchedServices = targetInboundIds
        .map(Number)
        .filter(id => !isNaN(id) && availableServiceIds.some((aid: any) => Number(aid) === id));
    }
    if (matchedServices.length === 0 && panel.inboundIds && panel.inboundIds.length > 0) {
      matchedServices = panel.inboundIds
        .map(Number)
        .filter((id: number) => !isNaN(id) && availableServiceIds.some((aid: any) => Number(aid) === id));
    }
    if (matchedServices.length === 0) {
      matchedServices = [Number(inbounds[0].id) || 4];
    }

    const uuid = uuidv4();
    const subId = Math.random().toString(36).substring(2, 18);

    // 3. Ensure volume and duration adhere to Panel 4 permissions (seller cannot create unlimited usage/expiry)
    // If volumeGb <= 0, default to 10 GB
    if (!volumeGb || volumeGb <= 0) {
      volumeGb = 10;
    }
    // If durationDays <= 0, default to 30 days
    if (!durationDays || durationDays <= 0) {
      durationDays = 30;
    }

    const totalBytes = Math.round(volumeGb * 1024 * 1024 * 1024);
    // In GoGuard / Panel 4: Negative duration = relative "After first use: X days" (on-hold until connect)
    const limitExpireOnHold = -Math.round(durationDays * 86400);
    const expiryTime = Date.now() + Math.round(durationDays * 86400000);

    // 4. Sanitize username: Panel 4 strictly requires lowercase letters, numbers, and underscore (3-30 chars)
    let cleanEmail = String(rawEmail || '')
      .trim()
      .replace(/[۰-۹]/g, d => String.fromCharCode(d.charCodeAt(0) - 1728))
      .replace(/[٠-٩]/g, d => String.fromCharCode(d.charCodeAt(0) - 1632))
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '');

    if (cleanEmail.length > 0 && !/[0-9]/.test(cleanEmail)) {
      cleanEmail = `${cleanEmail}_${Math.floor(10 + Math.random() * 89)}`;
    }
    if (cleanEmail.length < 3) {
      const suffix = Math.floor(100 + Math.random() * 899);
      cleanEmail = cleanEmail ? `${cleanEmail}_${suffix}` : `u_${Date.now().toString().slice(-6)}`;
    }
    if (cleanEmail.length > 30) {
      cleanEmail = cleanEmail.slice(0, 30).replace(/_+$/g, '');
    }

    let createdSubUrl = '';
    let addedToAny = false;
    let lastErrorMsg = '';

    // 5. Native Panel 4 Subscriptions API (POST /api/subscriptions)
    const note = sellerGroupName ? String(sellerGroupName).slice(0, 60) : '';

    const attemptCreate = async (uname: string) => {
      const subPayload = {
        username: uname,
        services: matchedServices,
        limit_usage: totalBytes,
        limit_expire: limitExpireOnHold,
        note: note || undefined
      };

      const res = await this.client.post(`${auth.baseURL}/api/subscriptions`, subPayload, {
        headers: auth.headers,
        timeout: 10000,
        validateStatus: () => true
      });

      return { res, payload: subPayload };
    };

    try {
      let { res, payload } = await attemptCreate(cleanEmail);

      // If username already exists (409 Conflict), generate a unique suffix and retry automatically
      if (res.status === 409 || (res.data && JSON.stringify(res.data).includes('already exists'))) {
        const uniqueSuffix = `_${Math.floor(100 + Math.random() * 899)}`;
        cleanEmail = `${cleanEmail.slice(0, 30 - uniqueSuffix.length)}${uniqueSuffix}`;
        const secondAttempt = await attemptCreate(cleanEmail);
        res = secondAttempt.res;
      }

      // If single object rejected with array requirement, retry with array
      if (res.status >= 400 && res.status !== 409) {
        const arrayRes = await this.client.post(`${auth.baseURL}/api/subscriptions`, [payload], {
          headers: auth.headers,
          timeout: 10000,
          validateStatus: () => true
        });
        if (arrayRes.status >= 200 && arrayRes.status < 300) {
          res = arrayRes;
        }
      }

      if (res.status >= 200 && res.status < 300 && res.data) {
        addedToAny = true;
        const dataObj = Array.isArray(res.data) ? res.data[0] : res.data;
        if (dataObj && typeof dataObj === 'object') {
          const link = dataObj.subscription_link || dataObj.subscription_url || dataObj.url || dataObj.link || '';
          if (typeof link === 'string' && link.startsWith('http')) {
            createdSubUrl = link.trim();
          }
        }
      } else {
        const errorData = res.data;
        const msg = errorData?.message || errorData?.errors?.[0]?.message || (Array.isArray(errorData?.errors) ? errorData.errors[0] : null) || JSON.stringify(errorData);
        lastErrorMsg = msg ? String(msg) : `کد وضعیت HTTP ${res.status}`;
      }
    } catch (e: any) {
      lastErrorMsg = e.message;
    }

    // 6. Try fetching subscription link directly if created but link was missing in response
    if (addedToAny && !createdSubUrl) {
      const linkEndpoints = [
        `${auth.baseURL}/api/subscriptions/${cleanEmail}/links`,
        `${auth.baseURL}/api/admins/current/links`
      ];

      for (const lep of linkEndpoints) {
        try {
          const linkRes = await this.client.get(lep, {
            headers: auth.headers,
            timeout: 6000,
            validateStatus: () => true
          });

          if (linkRes.status === 200 && linkRes.data) {
            if (typeof linkRes.data === 'string' && linkRes.data.startsWith('http')) {
              createdSubUrl = linkRes.data.trim();
              break;
            } else if (Array.isArray(linkRes.data) && linkRes.data.length > 0) {
              const firstItem = linkRes.data[0];
              const candidate = typeof firstItem === 'string' ? firstItem : (firstItem.url || firstItem.link || firstItem.subscription_url || firstItem.subscription_link || '');
              if (typeof candidate === 'string' && candidate.startsWith('http')) {
                createdSubUrl = candidate.trim();
                break;
              }
            } else if (linkRes.data.links && Array.isArray(linkRes.data.links) && linkRes.data.links.length > 0) {
              const firstItem = linkRes.data.links[0];
              const candidate = typeof firstItem === 'string' ? firstItem : (firstItem.url || firstItem.link || firstItem.subscription_url || firstItem.subscription_link || '');
              if (typeof candidate === 'string' && candidate.startsWith('http')) {
                createdSubUrl = candidate.trim();
                break;
              }
            }
          }
        } catch (e) {}
      }
    }

    // 7. Fallback to 3x-ui / X-UI style addClient if native subscriptions endpoint was not supported
    if (!addedToAny) {
      const prefix = this.workingApiPrefix || '/panel/api/inbounds';
      for (const ibId of matchedServices) {
        const targetIb = inbounds.find((ib: any) => String(ib.id) === String(ibId));
        if (!targetIb) continue;

        const clientPayload = {
          id: uuid,
          email: cleanEmail,
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
            headers: auth.headers,
            timeout: 8000,
            validateStatus: () => true
          });

          if (res.data?.success) {
            addedToAny = true;
            break;
          }
        } catch (err: any) {
          console.error(`[Panel 4] Error adding client to inbound ${ibId}:`, err.message);
        }
      }
    }

    if (!addedToAny) {
      throw new Error(`خطا در ایجاد سرویس در پنل ۴: ${lastErrorMsg || 'عدم پاسخ معتبر از سرور'}`);
    }

    let subUrl = createdSubUrl;
    if (!subUrl) {
      if (panel.subUrlBase && panel.subUrlBase.trim() !== '') {
        let base = panel.subUrlBase.trim();
        if (!base.endsWith('/')) base += '/';
        subUrl = `${base}${cleanEmail}`;
      } else {
        subUrl = `${auth.baseURL}/sub/${cleanEmail}`;
      }
    }

    return {
      id: cleanEmail,
      email: cleanEmail,
      uuid,
      subId: cleanEmail,
      subUrl,
      inboundIds: matchedServices,
      totalBytes,
      expiryTime,
      limitIp,
      enable: true
    };
  }

  public async renewClient(email: string, volumeGb: number, durationDays: number): Promise<void> {
    const auth = await this.getAuthOptions();
    const safeVolume = volumeGb > 0 ? volumeGb : 10;
    const safeDays = durationDays > 0 ? durationDays : 30;
    const totalBytes = Math.round(safeVolume * 1024 * 1024 * 1024);
    const limitExpireOnHold = -Math.round(safeDays * 86400);

    // Reset & update subscription in Panel 4 / GoGuard
    try {
      await this.client.post(`${auth.baseURL}/api/subscriptions/reset`, {
        usernames: [email]
      }, { headers: auth.headers, validateStatus: () => true });

      await this.client.put(`${auth.baseURL}/api/subscriptions`, {
        usernames: [email],
        limit_usage: totalBytes,
        limit_expire: limitExpireOnHold,
        enabled: true
      }, { headers: auth.headers, validateStatus: () => true });
    } catch (e) {}

    // Also try 3x-ui style renewal fallback
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
        const addBytes = Math.round(safeVolume * 1024 * 1024 * 1024);
        const addMs = Math.round(safeDays * 86400000);
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

      await this.client.put(`${auth.baseURL}/api/subscriptions`, {
        usernames: [email],
        enabled: enable
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

      // 1. Try Panel 4 native Subscriptions API (/api/subscriptions)
      try {
        const res = await this.client.get(`${auth.baseURL}/api/subscriptions?page=1&size=500`, {
          headers: auth.headers,
          timeout: 8000,
          validateStatus: () => true
        });

        if (res.status === 200 && res.data && typeof res.data === 'object') {
          const data = res.data;
          const items = Array.isArray(data) 
            ? data 
            : (data.items || data.subscriptions || data.data || data.obj || data.result);

          if (Array.isArray(items) && items.length > 0) {
            for (const sub of items) {
              const username = sub.username || sub.email || sub.id;
              if (!username) continue;

              const usedBytes = sub.total_usage !== undefined ? Number(sub.total_usage) : (sub.used_traffic !== undefined ? Number(sub.used_traffic) : ((Number(sub.up) || 0) + (Number(sub.down) || 0)));
              const limitBytes = sub.limit_usage !== undefined && sub.limit_usage !== null ? Number(sub.limit_usage) : (Number(sub.data_limit) || Number(sub.total) || 0);
              const rawExp = sub.limit_expire !== undefined && sub.limit_expire !== null ? Number(sub.limit_expire) : 0;
              
              let expiryTime = 0;
              if (rawExp > 0) {
                expiryTime = rawExp < 10000000000 ? rawExp * 1000 : rawExp;
              } else if (rawExp < 0) {
                // On-hold relative days
                if (sub.first_online_at) {
                  expiryTime = new Date(sub.first_online_at).getTime() + Math.abs(rawExp) * 1000;
                } else {
                  expiryTime = Date.now() + Math.abs(rawExp) * 1000;
                }
              }

              results.push({
                id: String(username),
                email: String(username),
                username: String(username),
                subId: sub.access_key || String(username),
                subUrl: sub.subscription_link || sub.subscription_url || '',
                up: Number(sub.up || 0),
                down: Number(sub.down || usedBytes || 0),
                totalUsed: usedBytes,
                total: limitBytes,
                expiryTime,
                enable: sub.enabled !== undefined ? Boolean(sub.enabled) : true,
                lastOnlineAt: sub.last_online_at || null,
                firstOnlineAt: sub.first_online_at || null,
                panel: 'panel4'
              });
            }
            if (results.length > 0) return results;
          }
        }
      } catch (e) {}

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
      const allClients = await this.getAllClientsWithTraffic();
      
      // A client is online if lastOnlineAt was within the last 120 seconds (2 minutes, matching Panel 4 UI logic)
      const now = Date.now();
      const onlineList: Panel4OnlineUser[] = [];

      for (const cl of allClients) {
        if (cl.lastOnlineAt) {
          const t = new Date(cl.lastOnlineAt).getTime();
          if (!isNaN(t) && now - t < 120000) {
            onlineList.push({
              email: cl.email,
              lastOnline: new Date(t).toLocaleTimeString('fa-IR', { timeZone: 'Asia/Tehran' })
            });
          }
        }
      }

      return {
        onlineCount: onlineList.length,
        totalUsers: allClients.length,
        users: onlineList
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
