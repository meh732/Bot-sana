import axios, { AxiosInstance } from 'axios';
import https from 'https';
import { db } from './db.js';

export interface RebeccaInboundItem {
  tag: string;
  protocol: string;
  network?: string;
  tls?: string;
  port?: number;
}

export class RebeccaClient {
  private client: AxiosInstance;
  private token: string = '';
  private tokenExpiryTime: number = 0;
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
      })
    });
  }

  private formatBaseUrl(rawUrl?: string): string {
    if (!rawUrl) return '';
    let formatted = rawUrl.trim().replace(/\s/g, '');
    if (!formatted.startsWith('http://') && !formatted.startsWith('https://')) {
      formatted = 'http://' + formatted;
    }
    let baseURL = formatted.endsWith('/') ? formatted.slice(0, -1) : formatted;
    
    // Remove common suffixes like /api, /dashboard, etc. repeatedly
    const suffixes = ['/api/admin', '/api/user', '/api/users', '/api', '/dashboard', '/panel', '/admin', '/user', '/users'];
    let changed = true;
    while (changed) {
      changed = false;
      for (const suffix of suffixes) {
        if (baseURL.toLowerCase().endsWith(suffix)) {
          baseURL = baseURL.slice(0, -suffix.length);
          changed = true;
          if (baseURL.endsWith('/')) baseURL = baseURL.slice(0, -1);
        }
      }
    }
    return baseURL;
  }

  private async getAuthHeaders(overrideConfig?: any): Promise<{ baseURL: string; headers: Record<string, string> }> {
    const state = db.getState();
    const panel = overrideConfig || state.rebeccaPanel || {};

    const hasApiKey = !!(panel.apiKey && panel.apiKey.trim() !== '');
    const hasUserPass = !!(panel.username && panel.username.trim() !== '' && panel.password && panel.password.trim() !== '');

    if (!panel.url || (!hasApiKey && !hasUserPass)) {
      throw new Error('مشخصات پنل ربکا کامل نیست. لطفاً آدرس پنل و مشخصات ورود (نام کاربری و رمز عبور یا API Token) را تنظیم کنید.');
    }

    const baseURL = this.formatBaseUrl(panel.url);

    // If panel credentials changed, reset cached token
    if (
      panel.url !== this.lastPanelUrl ||
      panel.username !== this.lastPanelUser ||
      panel.password !== this.lastPanelPass ||
      panel.apiKey !== this.lastPanelApiKey
    ) {
      console.log('[Rebecca] Panel credentials changed. Cleared token cache.');
      this.token = '';
      this.tokenExpiryTime = 0;
      this.lastPanelUrl = panel.url || '';
      this.lastPanelUser = panel.username || '';
      this.lastPanelPass = panel.password || '';
      this.lastPanelApiKey = panel.apiKey || '';
    }

    // 1. If API Key / Token is specified directly:
    if (hasApiKey) {
      const apiKey = panel.apiKey.trim();
      const tokenHeader = apiKey.startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`;
      return {
        baseURL,
        headers: {
          'Authorization': tokenHeader,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        }
      };
    }

    // 2. Token authentication via /api/admin/token (OAuth2 password flow standard in Marzban/Rebecca)
    const now = Date.now();
    if (!this.token || now >= this.tokenExpiryTime) {
      console.log(`[Rebecca] Authenticating with username/password at: ${baseURL}/api/admin/token`);
      let loginSuccess = false;
      let lastError = '';

      // Try form-urlencoded first (FastAPI OAuth2 standard)
      try {
        const params = new URLSearchParams();
        params.append('grant_type', 'password');
        params.append('username', panel.username || '');
        params.append('password', panel.password || '');

        const res = await this.client.post(`${baseURL}/api/admin/token`, params, {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          validateStatus: () => true,
          timeout: 10000
        });

        if (res.data && res.data.access_token) {
          this.token = res.data.access_token;
          // Token valid for 24h default or 1 hour
          this.tokenExpiryTime = now + 23 * 60 * 60 * 1000;
          loginSuccess = true;
          console.log('[Rebecca Success] Logged in via /api/admin/token (Form mode)');
        } else {
          lastError = res.data?.detail || res.data?.msg || res.data?.message || `Status: ${res.status}`;
        }
      } catch (e: any) {
        lastError = e.message;
      }

      // Try JSON payload if Form failed
      if (!loginSuccess) {
        try {
          const res = await this.client.post(`${baseURL}/api/admin/token`, {
            username: panel.username,
            password: panel.password
          }, {
            headers: { 'Content-Type': 'application/json' },
            validateStatus: () => true,
            timeout: 10000
          });

          if (res.data && res.data.access_token) {
            this.token = res.data.access_token;
            this.tokenExpiryTime = now + 23 * 60 * 60 * 1000;
            loginSuccess = true;
            console.log('[Rebecca Success] Logged in via /api/admin/token (JSON mode)');
          } else {
            lastError = res.data?.detail || res.data?.msg || res.data?.message || lastError;
          }
        } catch (e: any) {
          lastError = e.message;
        }
      }

      // Try /api/token fallback
      if (!loginSuccess) {
        try {
          const params = new URLSearchParams();
          params.append('grant_type', 'password');
          params.append('username', panel.username || '');
          params.append('password', panel.password || '');

          const res = await this.client.post(`${baseURL}/api/token`, params, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            validateStatus: () => true,
            timeout: 10000
          });

          if (res.data && res.data.access_token) {
            this.token = res.data.access_token;
            this.tokenExpiryTime = now + 23 * 60 * 60 * 1000;
            loginSuccess = true;
            console.log('[Rebecca Success] Logged in via /api/token');
          }
        } catch (e: any) {
          // ignore
        }
      }

      if (!loginSuccess) {
        throw new Error(`خطا در ورود به پنل ربکا: ${lastError || 'نام کاربری یا رمز عبور اشتباه است.'}`);
      }
    }

    return {
      baseURL,
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    };
  }

  public async testConnection(overrideConfig?: any): Promise<{ success: boolean; message: string; details?: any }> {
    try {
      const { baseURL, headers } = await this.getAuthHeaders(overrideConfig);
      
      // Test admin/system endpoints
      const testEndpoints = ['/api/admin', '/api/inbounds', '/api/system', '/api/users?limit=1'];
      let lastError = '';

      for (const endpoint of testEndpoints) {
        try {
          const res = await this.client.get(`${baseURL}${endpoint}`, {
            headers,
            validateStatus: () => true,
            timeout: 6000
          });

          if (res.status === 200 || (res.status >= 200 && res.status < 300)) {
            return {
              success: true,
              message: `✅ اتصال به پنل ربکا با موفقیت برقرار گردید (مسیر: ${endpoint})`,
              details: res.data
            };
          } else if (res.status === 401 || res.status === 403) {
            this.token = ''; // clear token
            lastError = `خطای دسترسی (کد ${res.status}): نام کاربری یا رمز عبور نامعتبر است.`;
          } else {
            lastError = res.data?.detail || res.data?.msg || `کد پاسخ: ${res.status}`;
          }
        } catch (err: any) {
          lastError = err.message;
        }
      }

      return {
        success: false,
        message: `عدم پاسخگویی پنل ربکا: ${lastError}`
      };
    } catch (e: any) {
      return {
        success: false,
        message: e.message
      };
    }
  }

  public async getInbounds(): Promise<RebeccaInboundItem[]> {
    try {
      const state = db.getState();
      if (!state.rebeccaPanel?.url) return [];

      const { baseURL, headers } = await this.getAuthHeaders();
      const res = await this.client.get(`${baseURL}/api/inbounds`, {
        headers,
        validateStatus: () => true,
        timeout: 8000
      });

      if (res.status === 200 && res.data) {
        const inboundsList: RebeccaInboundItem[] = [];
        const data = res.data;

        // If data is an object with protocol keys e.g. { "VMess TCP": [...], "VLESS TCP": [...] }
        if (typeof data === 'object' && !Array.isArray(data)) {
          for (const [key, val] of Object.entries(data)) {
            if (Array.isArray(val)) {
              for (const item of val) {
                inboundsList.push({
                  tag: item.tag || key,
                  protocol: item.protocol || key,
                  network: item.network,
                  tls: item.tls,
                  port: item.port
                });
              }
            } else if (typeof val === 'object' && val !== null) {
              const item = val as any;
              inboundsList.push({
                tag: item.tag || key,
                protocol: item.protocol || key,
                network: item.network,
                tls: item.tls,
                port: item.port
              });
            }
          }
        } else if (Array.isArray(data)) {
          for (const item of data) {
            inboundsList.push({
              tag: item.tag || item.name || item.remark || item.id,
              protocol: item.protocol || item.type || 'vless',
              network: item.network,
              tls: item.tls,
              port: item.port
            });
          }
        }
        return inboundsList;
      }
      return [];
    } catch (e: any) {
      console.error('[Rebecca] getInbounds error:', e.message);
      return [];
    }
  }

  public async addClient(
    username: string,
    volumeGb: number,
    durationDays: number,
    inboundTags?: string[],
    note?: string
  ): Promise<{ username: string; subUrl: string; links: string[]; raw?: any }> {
    const { baseURL, headers } = await this.getAuthHeaders();
    const state = db.getState();

    // Clean username for Rebecca (must be alphanumeric, underscores, min 3 chars)
    let cleanUser = username.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
    if (cleanUser.length < 3) {
      cleanUser = `user_${cleanUser}_${Date.now().toString().slice(-4)}`;
    }

    const dataLimitBytes = volumeGb > 0 ? Math.floor(volumeGb * 1024 * 1024 * 1024) : 0;
    const expireTimestamp = durationDays > 0 ? Math.floor((Date.now() + durationDays * 24 * 60 * 60 * 1000) / 1000) : 0;

    // Check if client already exists and delete or renew
    try {
      const checkRes = await this.client.get(`${baseURL}/api/user/${cleanUser}`, {
        headers,
        validateStatus: () => true,
        timeout: 5000
      });
      if (checkRes.status === 200) {
        console.log(`[Rebecca] User ${cleanUser} already exists, deleting first to recreate fresh...`);
        await this.delClient(cleanUser);
      }
    } catch (e) {
      // Ignore
    }

    // Construct proxies and inbounds payload
    const proxies: Record<string, any> = {
      vless: {},
      vmess: {},
      trojan: {},
      shadowsocks: {}
    };

    let inboundsPayload: any = undefined;
    if (inboundTags && inboundTags.length > 0) {
      inboundsPayload = {};
      for (const tag of inboundTags) {
        const lower = tag.toLowerCase();
        let proto = 'vless';
        if (lower.includes('vmess')) proto = 'vmess';
        else if (lower.includes('trojan')) proto = 'trojan';
        else if (lower.includes('shadowsocks') || lower.includes('ss')) proto = 'shadowsocks';
        
        if (!inboundsPayload[proto]) inboundsPayload[proto] = [];
        inboundsPayload[proto].push(tag);
      }
    }

    const payload: any = {
      username: cleanUser,
      proxies,
      data_limit: dataLimitBytes,
      expire: expireTimestamp || null,
      data_limit_reset_strategy: 'no_reset',
      status: 'active',
      note: note || ''
    };

    if (inboundsPayload && Object.keys(inboundsPayload).length > 0) {
      payload.inbounds = inboundsPayload;
    }

    console.log(`[Rebecca Attempt] Creating user: ${cleanUser} with payload:`, JSON.stringify(payload));

    const endpointsToTry = [
      `${baseURL}/api/user`,
      `${baseURL}/api/user/`,
      `${baseURL}/api/users`,
      `${baseURL}/api/users/`,
      `${baseURL}/api/admin/user`,
      `${baseURL}/api/admin/user/`
    ];

    if (baseURL.startsWith('http://')) {
      const httpsBase = 'https://' + baseURL.slice(7);
      endpointsToTry.push(
        `${httpsBase}/api/user`,
        `${httpsBase}/api/user/`,
        `${httpsBase}/api/users`,
        `${httpsBase}/api/users/`
      );
    }

    let lastError = '';
    let res: any = null;

    for (const ep of endpointsToTry) {
      try {
        let attemptRes = await this.client.post(ep, payload, {
          headers,
          maxRedirects: 0,
          validateStatus: () => true,
          timeout: 10000
        });

        // Handle 301/302/307/308 redirect manually to preserve POST
        if ([301, 302, 307, 308].includes(attemptRes.status) && attemptRes.headers?.location) {
          let redirUrl = attemptRes.headers.location;
          if (!redirUrl.startsWith('http://') && !redirUrl.startsWith('https://')) {
            redirUrl = `${baseURL}${redirUrl.startsWith('/') ? '' : '/'}${redirUrl}`;
          }
          console.log(`[Rebecca Redirect] ${ep} -> ${redirUrl}`);
          attemptRes = await this.client.post(redirUrl, payload, {
            headers,
            maxRedirects: 0,
            validateStatus: () => true,
            timeout: 10000
          });
        }

        // Fallback without inbounds if inbound tags failed
        if ((attemptRes.status === 400 || attemptRes.status === 422) && payload.inbounds) {
          const payloadNoInbounds = { ...payload };
          delete payloadNoInbounds.inbounds;
          attemptRes = await this.client.post(ep, payloadNoInbounds, {
            headers,
            maxRedirects: 0,
            validateStatus: () => true,
            timeout: 10000
          });
        }

        if (attemptRes.status >= 200 && attemptRes.status < 300 && attemptRes.data) {
          res = attemptRes;
          console.log(`[Rebecca Success Endpoint] ${ep}`);
          break;
        } else {
          lastError = attemptRes.data?.detail || attemptRes.data?.msg || attemptRes.data?.message || `کد خطا: ${attemptRes.status}`;
        }
      } catch (err: any) {
        lastError = err.message;
      }
    }

    if (!res || !res.data) {
      throw new Error(`خطا در ایجاد اکانت در پنل ربکا: ${lastError || 'پاسخی از پنل دریافت نشد.'}`);
    }

    const userData = res.data;
    let subUrl = userData.subscription_url || '';

    // If subUrl is relative or missing base URL
    if (subUrl && !subUrl.startsWith('http://') && !subUrl.startsWith('https://')) {
      const customSubBase = state.rebeccaPanel?.subUrlBase?.trim();
      if (customSubBase) {
        let base = customSubBase.endsWith('/') ? customSubBase.slice(0, -1) : customSubBase;
        subUrl = `${base}${subUrl.startsWith('/') ? '' : '/'}${subUrl}`;
      } else {
        subUrl = `${baseURL}${subUrl.startsWith('/') ? '' : '/'}${subUrl}`;
      }
    } else if (!subUrl) {
      const customSubBase = state.rebeccaPanel?.subUrlBase?.trim();
      const baseToUse = customSubBase ? (customSubBase.endsWith('/') ? customSubBase.slice(0, -1) : customSubBase) : baseURL;
      subUrl = `${baseToUse}/sub/${cleanUser}`;
    }

    const links: string[] = Array.isArray(userData.links) ? userData.links : [];

    console.log(`[Rebecca Success] User "${cleanUser}" created successfully. Sub URL: ${subUrl}`);

    return {
      username: cleanUser,
      subUrl,
      links,
      raw: userData
    };
  }

  public async getClient(username: string): Promise<any | null> {
    try {
      const { baseURL, headers } = await this.getAuthHeaders();
      const res = await this.client.get(`${baseURL}/api/user/${username}`, {
        headers,
        validateStatus: () => true,
        timeout: 6000
      });

      if (res.status === 200 && res.data) {
        return res.data;
      }
      return null;
    } catch (e: any) {
      console.error(`[Rebecca] getClient error for ${username}:`, e.message);
      return null;
    }
  }

  public async updateClientEnable(username: string, enable: boolean): Promise<boolean> {
    try {
      const { baseURL, headers } = await this.getAuthHeaders();
      const status = enable ? 'active' : 'disabled';
      const res = await this.client.put(`${baseURL}/api/user/${username}`, { status }, {
        headers,
        validateStatus: () => true,
        timeout: 6000
      });

      return res.status === 200;
    } catch (e: any) {
      console.error(`[Rebecca] updateClientEnable error for ${username}:`, e.message);
      return false;
    }
  }

  public async renewClient(username: string, volumeGb: number, durationDays: number): Promise<boolean> {
    try {
      const { baseURL, headers } = await this.getAuthHeaders();
      const dataLimitBytes = volumeGb > 0 ? Math.floor(volumeGb * 1024 * 1024 * 1024) : 0;
      const expireTimestamp = durationDays > 0 ? Math.floor((Date.now() + durationDays * 24 * 60 * 60 * 1000) / 1000) : 0;

      // 1. Reset traffic
      try {
        await this.client.post(`${baseURL}/api/user/${username}/reset`, {}, {
          headers,
          validateStatus: () => true,
          timeout: 6000
        });
      } catch (e) {}

      // 2. Update limit & expiry
      const payload: any = {
        status: 'active',
        data_limit: dataLimitBytes,
        expire: expireTimestamp || null
      };

      const res = await this.client.put(`${baseURL}/api/user/${username}`, payload, {
        headers,
        validateStatus: () => true,
        timeout: 6000
      });

      return res.status === 200;
    } catch (e: any) {
      console.error(`[Rebecca] renewClient error for ${username}:`, e.message);
      return false;
    }
  }

  public async delClient(username: string): Promise<boolean> {
    try {
      const { baseURL, headers } = await this.getAuthHeaders();
      const res = await this.client.delete(`${baseURL}/api/user/${username}`, {
        headers,
        validateStatus: () => true,
        timeout: 6000
      });

      return res.status === 200 || res.status === 204;
    } catch (e: any) {
      console.error(`[Rebecca] delClient error for ${username}:`, e.message);
      return false;
    }
  }

  public async getAllClientsWithTraffic(): Promise<Array<{
    id: string;
    email: string;
    username: string;
    subId?: string;
    up: number;
    down: number;
    totalUsed: number;
    total: number;
    expiryTime: number;
    enable: boolean;
    panel: 'rebecca';
  }>> {
    try {
      const state = db.getState();
      if (!state.rebeccaPanel?.url) return [];

      const { baseURL, headers } = await this.getAuthHeaders();
      const res = await this.client.get(`${baseURL}/api/users?limit=1000`, {
        headers,
        validateStatus: () => true,
        timeout: 10000
      });

      if (res.status === 200 && res.data) {
        const rawUsers: any[] = Array.isArray(res.data.users) ? res.data.users : (Array.isArray(res.data) ? res.data : []);
        
        return rawUsers.map((u: any) => {
          const usedTraffic = Number(u.used_traffic || 0);
          const dataLimit = Number(u.data_limit || 0);
          const expireSec = Number(u.expire || 0);
          const expiryMs = expireSec > 0 ? expireSec * 1000 : 0;
          const isEnabled = u.status === 'active';

          return {
            id: u.username,
            email: u.username,
            username: u.username,
            subId: u.subscription_url ? u.subscription_url.split('/sub/')[1]?.split('?')[0] : '',
            up: 0,
            down: usedTraffic,
            totalUsed: usedTraffic,
            total: dataLimit,
            expiryTime: expiryMs,
            enable: isEnabled,
            panel: 'rebecca' as const
          };
        });
      }
      return [];
    } catch (e: any) {
      console.error('[Rebecca] getAllClientsWithTraffic error:', e.message);
      return [];
    }
  }
}

export const rebecca = new RebeccaClient();
