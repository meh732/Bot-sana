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

  public async testConnection(overrideConfig?: any): Promise<{ success: boolean; message: string; details?: any; services?: any[] }> {
    try {
      const { baseURL, headers } = await this.getAuthHeaders(overrideConfig);
      
      // 1. Try Rebecca 0.3.0 services endpoint
      let services: any[] = [];
      try {
        const sRes = await this.client.get(`${baseURL}/api/v2/services`, {
          headers,
          validateStatus: () => true,
          timeout: 7000
        });
        if (sRes.status >= 200 && sRes.status < 300 && sRes.data) {
          services = Array.isArray(sRes.data) 
            ? sRes.data 
            : (Array.isArray(sRes.data.services) ? sRes.data.services : (Array.isArray(sRes.data.items) ? sRes.data.items : []));
          
          const serviceNames = services.map((s: any) => `• [ID ${s.id}] ${s.name || 'Service'}`).join('\n');
          return {
            success: true,
            message: `✅ اتصال به پنل ربکا (Rebecca 0.3.0) با موفقیت برقرار شد!\n\n🏢 <b>سرویس‌های فعال شناسایی شده (${services.length} عدد):</b>\n${serviceNames || 'هیچ سرویسی در پنل تعریف نشده است.'}`,
            details: sRes.data,
            services
          };
        }
      } catch (e) {
        // Continue to fallback test
      }

      // 2. Test standard endpoints
      const testEndpoints = ['/api/admin', '/api/users?limit=1', '/api/inbounds', '/api/system'];
      let lastError = '';

      for (const endpoint of testEndpoints) {
        try {
          const res = await this.client.get(`${baseURL}${endpoint}`, {
            headers,
            validateStatus: () => true,
            timeout: 6000
          });

          if (res.status >= 200 && res.status < 300) {
            return {
              success: true,
              message: `✅ اتصال به پنل ربکا با موفقیت برقرار گردید (مسیر: ${endpoint})`,
              details: res.data
            };
          } else if (res.status === 401 || res.status === 403) {
            this.token = ''; // clear token
            lastError = `خطای دسترسی (کد ${res.status}): نام کاربری، رمز عبور یا API Key نامعتبر است.`;
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

  public async getServices(): Promise<Array<{ id: number | string; name: string; description?: string; host_count?: number; user_count?: number; [key: string]: any }>> {
    try {
      const state = db.getState();
      if (!state.rebeccaPanel?.url) return [];

      const { baseURL, headers } = await this.getAuthHeaders();
      const res = await this.client.get(`${baseURL}/api/v2/services`, {
        headers,
        validateStatus: () => true,
        timeout: 8000
      });

      if (res.status >= 200 && res.status < 300 && res.data) {
        if (Array.isArray(res.data)) {
          return res.data;
        } else if (res.data.services && Array.isArray(res.data.services)) {
          return res.data.services;
        } else if (res.data.items && Array.isArray(res.data.items)) {
          return res.data.items;
        }
      }
      return [];
    } catch (e: any) {
      console.error('[Rebecca] getServices error:', e.message);
      return [];
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
    inboundTagsOrServiceId?: string | number | (string | number)[],
    limitIp?: number,
    telegramId?: string,
    group?: string,
    note?: string
  ): Promise<{ username: string; subUrl: string; subId?: string; token?: string; links: string[]; raw?: any }> {
    const { baseURL, headers } = await this.getAuthHeaders();
    const state = db.getState();

    // Clean username for Rebecca (must be alphanumeric, underscores, min 3 chars)
    let cleanUser = username.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
    if (cleanUser.length < 3) {
      cleanUser = `user_${cleanUser}_${Date.now().toString().slice(-4)}`;
    }

    const dataLimitBytes = volumeGb > 0 ? Math.floor(volumeGb * 1024 * 1024 * 1024) : 0;
    const expireTimestamp = durationDays > 0 ? Math.floor((Date.now() + durationDays * 24 * 60 * 60 * 1000) / 1000) : 0;

    // Check if client already exists and delete first to recreate fresh
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
    } catch (e) {}

    // Resolve service_id for Rebecca 0.3.0
    let targetServiceId: number | string | undefined = undefined;
    if (typeof inboundTagsOrServiceId === 'number' || (typeof inboundTagsOrServiceId === 'string' && /^\d+$/.test(inboundTagsOrServiceId.trim()))) {
      targetServiceId = Number(inboundTagsOrServiceId);
    } else if (state.rebeccaPanel?.serviceId !== undefined && state.rebeccaPanel.serviceId !== '') {
      targetServiceId = state.rebeccaPanel.serviceId;
    }

    // Auto-discover service ID if not explicitly specified
    if (targetServiceId === undefined) {
      try {
        const services = await this.getServices();
        if (services && services.length > 0) {
          targetServiceId = services[0].id;
          console.log(`[Rebecca Auto-Service] Discovered default service ID: ${targetServiceId} (${services[0].name})`);
        }
      } catch (e) {
        console.error('[Rebecca Service Discovery Error]', e);
      }
    }

    const effectiveNote = note || (telegramId ? `Telegram: ${telegramId}` : '');

    // 1. Try Rebecca 0.3.0 native payload with service_id
    let res: any = null;
    let lastError = '';

    if (targetServiceId !== undefined) {
      const rebeccaPayload: any = {
        username: cleanUser,
        service_id: Number(targetServiceId) || targetServiceId,
        data_limit: dataLimitBytes,
        expire: expireTimestamp || 0,
        status: 'active',
        note: effectiveNote
      };

      console.log(`[Rebecca 0.3.0] Creating user ${cleanUser} with payload:`, JSON.stringify(rebeccaPayload));

      const endpoints = [
        `${baseURL}/api/v2/users`,
        `${baseURL}/api/user`,
        `${baseURL}/api/user/`
      ];

      for (const ep of endpoints) {
        try {
          const attempt = await this.client.post(ep, rebeccaPayload, {
            headers,
            validateStatus: () => true,
            timeout: 10000
          });

          if (attempt.status >= 200 && attempt.status < 300 && attempt.data) {
            res = attempt;
            console.log(`[Rebecca 0.3.0 Success] User created on ${ep}`);
            break;
          } else {
            lastError = attempt.data?.detail || attempt.data?.msg || attempt.data?.message || `Status ${attempt.status}`;
            console.log(`[Rebecca 0.3.0 Attempt ${ep}] Status ${attempt.status}:`, lastError);
          }
        } catch (e: any) {
          lastError = e.message;
        }
      }
    }

    // 2. Fallback to Marzban-compatible payload if Rebecca 0.3.0 was not accepted
    if (!res || !res.data) {
      console.log('[Rebecca] Attempting Marzban/legacy fallback payload...');
      let cleanTags: string[] | undefined = undefined;
      if (inboundTagsOrServiceId !== undefined && inboundTagsOrServiceId !== null) {
        if (Array.isArray(inboundTagsOrServiceId)) {
          cleanTags = inboundTagsOrServiceId.map(t => String(t).trim()).filter(Boolean);
        } else if (typeof inboundTagsOrServiceId === 'string' && !/^\d+$/.test(inboundTagsOrServiceId)) {
          cleanTags = [inboundTagsOrServiceId.trim()];
        }
      }

      const proxies: Record<string, any> = {
        vless: {},
        vmess: {},
        trojan: {},
        shadowsocks: {}
      };

      const legacyPayload: any = {
        username: cleanUser,
        proxies,
        data_limit: dataLimitBytes,
        expire: expireTimestamp || 0,
        data_limit_reset_strategy: 'no_reset',
        status: 'active',
        note: effectiveNote
      };

      if (cleanTags && cleanTags.length > 0) {
        const inboundsPayload: any = { vless: cleanTags };
        legacyPayload.inbounds = inboundsPayload;
      }

      const legacyEndpoints = [
        `${baseURL}/api/user`,
        `${baseURL}/api/user/`,
        `${baseURL}/api/users`,
        `${baseURL}/api/admin/user`
      ];

      for (const ep of legacyEndpoints) {
        try {
          let attempt = await this.client.post(ep, legacyPayload, {
            headers,
            validateStatus: () => true,
            timeout: 10000
          });

          if (attempt.status >= 400 && legacyPayload.inbounds) {
            const noInbounds = { ...legacyPayload };
            delete noInbounds.inbounds;
            attempt = await this.client.post(ep, noInbounds, {
              headers,
              validateStatus: () => true,
              timeout: 10000
            });
          }

          if (attempt.status >= 200 && attempt.status < 300 && attempt.data) {
            res = attempt;
            console.log(`[Rebecca Legacy Success] User created on ${ep}`);
            break;
          } else {
            lastError = attempt.data?.detail || attempt.data?.msg || attempt.data?.message || lastError;
          }
        } catch (e: any) {
          lastError = e.message;
        }
      }
    }

    if (!res || !res.data) {
      throw new Error(`خطا در ایجاد اکانت در پنل ربکا: ${lastError || 'پاسخی از پنل دریافت نشد.'}`);
    }

    const userData = res.data;
    let subUrl = userData.subscription_url || '';

    const customSubBase = state.rebeccaPanel?.subUrlBase?.trim();
    const effectiveBase = customSubBase ? (customSubBase.endsWith('/') ? customSubBase.slice(0, -1) : customSubBase) : baseURL;

    if (subUrl) {
      if (!subUrl.startsWith('http://') && !subUrl.startsWith('https://')) {
        let cleanRel = subUrl.startsWith('/') ? subUrl.slice(1) : subUrl;
        let cleanBase = effectiveBase.replace(/\/+$/, '');
        if (cleanBase.endsWith('/sub') && cleanRel.startsWith('sub/')) {
          cleanRel = cleanRel.slice(4);
        }
        subUrl = `${cleanBase}/${cleanRel}`;
      } else if (customSubBase) {
        try {
          const parsed = new URL(subUrl);
          let cleanBase = customSubBase.replace(/\/+$/, '');
          let pathAndQuery = parsed.pathname + parsed.search;

          // Prevent duplicate /sub/ if cleanBase ends with /sub and path starts with /sub
          if (cleanBase.endsWith('/sub') && pathAndQuery.startsWith('/sub')) {
            pathAndQuery = pathAndQuery.slice(4);
          }
          subUrl = `${cleanBase}${pathAndQuery.startsWith('/') ? '' : '/'}${pathAndQuery}`;
        } catch (e) {}
      }
    } else {
      let cleanBase = effectiveBase.replace(/\/+$/, '');
      const token = userData.token || cleanUser;
      let cleanToken = String(token).replace(/^\/+/, '');
      if (cleanToken.startsWith('sub/')) {
        cleanToken = cleanToken.slice(4);
      }
      if (customSubBase) {
        subUrl = `${cleanBase}/${cleanToken}`;
      } else if (cleanBase.endsWith('/sub')) {
        subUrl = `${cleanBase}/${cleanToken}`;
      } else {
        subUrl = `${cleanBase}/sub/${cleanToken}`;
      }
    }

    if (subUrl && subUrl.includes('/sub/sub/')) {
      subUrl = subUrl.replace(/\/sub\/sub\//g, '/sub/');
    }

    let links: string[] = Array.isArray(userData.links) ? userData.links : [];

    // If links array is empty, fetch configs directly from subUrl
    if (links.length === 0 && subUrl) {
      try {
        const subRes = await this.client.get(subUrl, { timeout: 6000, validateStatus: () => true });
        if (subRes.status === 200 && subRes.data) {
          let content = String(subRes.data);
          try {
            const decoded = Buffer.from(content, 'base64').toString('utf-8');
            if (decoded.includes('://')) content = decoded;
          } catch {}
          links = content.split('\n').map(l => l.trim()).filter(l => l.includes('://'));
        }
      } catch (e) {}
    }

    console.log(`[Rebecca Success] User "${cleanUser}" created successfully. Sub URL: ${subUrl}, Links count: ${links.length}`);

    const subToken = userData.token || this.extractSubToken(subUrl) || cleanUser;

    return {
      username: cleanUser,
      subUrl,
      subId: subToken,
      token: subToken,
      links,
      raw: userData
    };
  }

  public extractSubToken(url?: string): string | null {
    if (!url || typeof url !== 'string') return null;
    const trimmed = url.trim();
    if (!trimmed) return null;

    try {
      const parsed = new URL(trimmed.startsWith('http') ? trimmed : `http://${trimmed}`);
      const qToken = parsed.searchParams.get('token') || parsed.searchParams.get('sub') || parsed.searchParams.get('id');
      if (qToken && qToken.length >= 3) {
        return qToken.toLowerCase();
      }
      const segments = parsed.pathname.split('/').filter(Boolean);
      if (segments.length > 0) {
        const subIdx = segments.findIndex(s => s.toLowerCase() === 'sub');
        if (subIdx !== -1 && subIdx < segments.length - 1) {
          return segments[subIdx + 1].toLowerCase();
        }
        const last = segments[segments.length - 1];
        if (last && last.toLowerCase() !== 'sub' && last.length >= 3) {
          return last.toLowerCase();
        }
      }
    } catch {}

    const m = trimmed.match(/\/sub\/([a-zA-Z0-9_-]+)/i);
    if (m) return m[1].toLowerCase();

    return null;
  }

  public async getDirectConfigs(subUrlOrUsername: string): Promise<string[]> {
    try {
      const { baseURL, headers } = await this.getAuthHeaders();
      let subUrl = subUrlOrUsername;
      if (!subUrl.startsWith('http://') && !subUrl.startsWith('https://')) {
        const user = await this.getClient(subUrlOrUsername);
        if (user && user.links && Array.isArray(user.links) && user.links.length > 0) {
          return user.links;
        }
        subUrl = `${baseURL}/sub/${subUrlOrUsername}`;
      }

      const res = await this.client.get(subUrl, {
        timeout: 8000,
        validateStatus: () => true
      });

      if (res.status === 200 && res.data) {
        let content = String(res.data);
        try {
          const decoded = Buffer.from(content, 'base64').toString('utf-8');
          if (decoded.includes('://')) {
            content = decoded;
          }
        } catch {}

        const lines = content.split('\n').map(l => l.trim()).filter(l => l.includes('://'));
        return lines;
      }
      return [];
    } catch (e: any) {
      console.error('[Rebecca] getDirectConfigs error:', e.message);
      return [];
    }
  }

  public async getClient(username: string): Promise<any | null> {
    try {
      const { baseURL, headers } = await this.getAuthHeaders();
      const cleanUsername = encodeURIComponent(username.trim());

      // Try Rebecca 0.3.0 endpoint first: /api/v2/users/{username}
      let res = await this.client.get(`${baseURL}/api/v2/users/${cleanUsername}`, {
        headers,
        validateStatus: () => true,
        timeout: 6000
      });

      if (res.status === 200 && res.data) {
        return res.data;
      }

      // Fallback to legacy endpoint: /api/user/{username}
      res = await this.client.get(`${baseURL}/api/user/${cleanUsername}`, {
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
      const payload: any = { status };

      const res = await this.client.put(`${baseURL}/api/user/${username}`, payload, {
        headers,
        validateStatus: () => true,
        timeout: 6000
      });

      if (res.status >= 200 && res.status < 300) {
        return true;
      }

      const res2 = await this.client.put(`${baseURL}/api/v2/users/${username}`, payload, {
        headers,
        validateStatus: () => true,
        timeout: 6000
      });

      return res2.status >= 200 && res2.status < 300;
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

      // 2. Rebecca 0.3.0: PUT /api/user/{username}
      const payload: any = {
        status: 'active',
        data_limit: dataLimitBytes,
        expire: expireTimestamp || 0
      };

      const res = await this.client.put(`${baseURL}/api/user/${username}`, payload, {
        headers,
        validateStatus: () => true,
        timeout: 6000
      });

      if (res.status >= 200 && res.status < 300) {
        return true;
      }

      const res2 = await this.client.put(`${baseURL}/api/v2/users/${username}`, payload, {
        headers,
        validateStatus: () => true,
        timeout: 6000
      });

      if (res2.status >= 200 && res2.status < 300) {
        return true;
      }

      // Legacy fallback
      const existingUser = await this.getClient(username);
      const proxies = existingUser?.proxies || {
        vless: {},
        vmess: {},
        trojan: {},
        shadowsocks: {}
      };
      const legacyPayload = {
        ...payload,
        username,
        proxies
      };
      const res3 = await this.client.put(`${baseURL}/api/user/${username}`, legacyPayload, {
        headers,
        validateStatus: () => true,
        timeout: 6000
      });

      return res3.status >= 200 && res3.status < 300;
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

  public async delClientByEmail(email: string): Promise<boolean> {
    return this.delClient(email);
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
      // Try Rebecca 0.3.0 endpoint first: /api/v2/users
      let res = await this.client.get(`${baseURL}/api/v2/users?limit=1000`, {
        headers,
        validateStatus: () => true,
        timeout: 10000
      });

      if (res.status === 404) {
        res = await this.client.get(`${baseURL}/api/users?limit=1000`, {
          headers,
          validateStatus: () => true,
          timeout: 10000
        });
      }

      if (res.status === 200 && res.data) {
        const rawUsers: any[] = Array.isArray(res.data.users) ? res.data.users : (Array.isArray(res.data) ? res.data : []);
        
        return rawUsers.map((u: any) => {
          const usedTraffic = Number(u.used_traffic !== undefined ? u.used_traffic : (u.usedTraffic !== undefined ? u.usedTraffic : (u.traffic?.used || 0))) || 0;
          const dataLimit = Number(u.data_limit !== undefined ? u.data_limit : (u.dataLimit !== undefined ? u.dataLimit : (u.traffic?.limit || 0))) || 0;
          const expireSec = Number(u.expire !== undefined ? u.expire : (u.expire_date !== undefined ? u.expire_date : (u.expiry || 0))) || 0;
          const expiryMs = expireSec > 10000000000 ? expireSec : (expireSec > 0 ? expireSec * 1000 : 0);
          const isEnabled = u.status ? (u.status === 'active' || u.status === 'enabled') : (u.enable !== false && u.disabled !== true);
          const subUrl = u.subscription_url || u.sub_url || u.subscriptionUrl || '';
          const token = u.token || '';
          const extractedToken = this.extractSubToken(subUrl);
          const subId = token || extractedToken || u.sub_id || u.subId || '';

          return {
            id: u.username,
            email: u.username,
            username: u.username,
            subId: subId,
            token: token || subId,
            subUrl: subUrl,
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
