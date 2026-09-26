import axios, { AxiosInstance } from 'axios';
import https from 'https';
import { db } from './db.js';

export interface MrOceanDashboardUser {
  username: string;
  status: 'active' | 'suspended' | 'expired' | 'disabled' | string;
  statusText?: string;
  serviceName?: string;
  usedTraffic?: number;
  lifetimeUsedTraffic?: number;
  dataLimit?: number;
  expire?: number;
  online?: boolean;
  subscriptionUrl?: string;
  portalUrl?: string;
  dataResetStrategy?: string;
  note?: string;
  telegramId?: string;
  contactNumber?: string;
  createdAt?: string;
  lastOnline?: string;
}

export interface MrOceanDashboardData {
  serviceId: number;
  title: string;
  status: string;
  statusText?: string;
  usersLimit: number;
  maxUserDataGb?: number;
  usersTotal: number;
  activeTotal: number;
  onlineTotal?: number;
  usageTotal: number;
  expiresAt?: number;
  expiresAtText?: string;
  trafficUnlimited?: boolean;
  statusBreakdown?: Record<string, number>;
  users: MrOceanDashboardUser[];
}

export class MrOceanClient {
  private client: AxiosInstance;
  private sessionCookie: string = '';
  private csrfToken: string = '';
  private serviceId: number | string = '';
  private apiBase: string = '';
  private sessionExpiryTime: number = 0;
  private lastPanelUrl: string = '';
  private lastPanelUser: string = '';
  private lastPanelPass: string = '';
  private isAuthenticating: boolean = false;

  constructor() {
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
    if (!rawUrl) return 'https://panel.mrocean.ir';
    let formatted = rawUrl.trim().replace(/\s/g, '');
    if (!formatted.startsWith('http://') && !formatted.startsWith('https://')) {
      formatted = 'https://' + formatted;
    }
    return formatted.endsWith('/') ? formatted.slice(0, -1) : formatted;
  }

  private extractCookieHeader(rawCookies: string[] | string | undefined): string {
    if (!rawCookies) return '';
    if (Array.isArray(rawCookies)) {
      return rawCookies.map(c => c.split(';')[0].trim()).join('; ');
    }
    return String(rawCookies).split(';')[0].trim();
  }

  public async authenticate(overrideConfig?: any, forceRefresh: boolean = false): Promise<{
    baseURL: string;
    cookie: string;
    csrfToken: string;
    apiBase: string;
    serviceId: number | string;
  }> {
    const state = db.getState();
    const config = overrideConfig || state.mroceanPanel || {};
    const baseURL = this.formatBaseUrl(config.url);
    const username = config.username || '';
    const password = config.password || '';

    // If panel credentials changed, clear session cache
    if (
      baseURL !== this.lastPanelUrl ||
      username !== this.lastPanelUser ||
      password !== this.lastPanelPass
    ) {
      this.sessionCookie = '';
      this.csrfToken = '';
      this.sessionExpiryTime = 0;
      this.lastPanelUrl = baseURL;
      this.lastPanelUser = username;
      this.lastPanelPass = password;
    }

    const now = Date.now();
    // 1. Check in-memory cache
    if (!forceRefresh && this.sessionCookie && this.csrfToken && now < this.sessionExpiryTime) {
      return {
        baseURL,
        cookie: this.sessionCookie,
        csrfToken: this.csrfToken,
        apiBase: this.apiBase || `${baseURL}/api/reseller-panel/service/${this.serviceId || config.serviceId || 347}`,
        serviceId: this.serviceId || config.serviceId || 347
      };
    }

    // 2. Check persisted state cache
    if (!forceRefresh && config._sessionCookie && config._csrfToken && config._sessionExpiryTime && now < config._sessionExpiryTime) {
      this.sessionCookie = config._sessionCookie;
      this.csrfToken = config._csrfToken;
      this.sessionExpiryTime = config._sessionExpiryTime;
      this.serviceId = config._serviceId || config.serviceId || 347;
      this.apiBase = config._apiBase || `${baseURL}/api/reseller-panel/service/${this.serviceId}`;
      return {
        baseURL,
        cookie: this.sessionCookie,
        csrfToken: this.csrfToken,
        apiBase: this.apiBase,
        serviceId: this.serviceId
      };
    }

    if (!username || !password) {
      throw new Error('مشخصات پنل نمایندگی مستر اوشن کامل نیست. نام کاربری و رمز عبور را در تنظیمات وارد نمایید.');
    }

    if (this.isAuthenticating) {
      // Small sleep to avoid parallel login hammering
      await new Promise(r => setTimeout(r, 600));
      if (this.sessionCookie && this.csrfToken && Date.now() < this.sessionExpiryTime) {
        return {
          baseURL,
          cookie: this.sessionCookie,
          csrfToken: this.csrfToken,
          apiBase: this.apiBase,
          serviceId: this.serviceId
        };
      }
    }

    this.isAuthenticating = true;
    try {
      console.log(`[MrOcean] Authenticating with reseller panel at ${baseURL}/api/reseller-panel/login...`);
      const loginRes = await this.client.post(`${baseURL}/api/reseller-panel/login`, {
        username,
        password
      }, {
        headers: { 'Content-Type': 'application/json' },
        validateStatus: () => true
      });

      if (loginRes.status === 429) {
        throw new Error('تعداد تلاش‌های ورود به پنل مستر اوشن بیش از حد مجاز است. لطفاً چند دقیقه صبر کنید.');
      }

      if (loginRes.status !== 200 || loginRes.data?.ok === false) {
        const errMsg = loginRes.data?.error || loginRes.data?.message || `کد پاسخ ورود: ${loginRes.status}`;
        throw new Error(`خطا در ورود به پنل مستر اوشن: ${errMsg}`);
      }

      // Extract set-cookie
      const rawCookies = loginRes.headers['set-cookie'];
      const cookieHeader = this.extractCookieHeader(rawCookies);
      if (!cookieHeader) {
        throw new Error('کوکی ورود از پنل مستر اوشن دریافت نشد.');
      }

      // Extract CSRF token and serviceId by fetching main dashboard HTML
      const htmlRes = await this.client.get(`${baseURL}/`, {
        headers: { 'Cookie': cookieHeader },
        validateStatus: () => true
      });

      let extractedCsrf = '';
      let extractedServiceId: number | string = config.serviceId || '';
      let extractedApiBase = '';

      if (htmlRes.status === 200 && typeof htmlRes.data === 'string') {
        const configMatch = htmlRes.data.match(/<script[^>]*id="mrocean-reseller-config"[^>]*>([\s\S]*?)<\/script>/i);
        if (configMatch) {
          try {
            const parsedConfig = JSON.parse(configMatch[1]);
            if (parsedConfig.csrfToken) extractedCsrf = parsedConfig.csrfToken;
            if (parsedConfig.serviceId) extractedServiceId = parsedConfig.serviceId;
            if (parsedConfig.apiBase) extractedApiBase = `${baseURL}${parsedConfig.apiBase}`;
          } catch (err) {
            console.error('[MrOcean] Failed parsing reseller-config JSON script tag:', err);
          }
        }
      }

      // Fallback CSRF token extraction from cookie JWT payload
      if (!extractedCsrf && cookieHeader.includes('__Host-mrocean_reseller=')) {
        try {
          const cookieVal = cookieHeader.split('__Host-mrocean_reseller=')[1].split(';')[0].split('.')[0];
          const decoded = JSON.parse(Buffer.from(cookieVal, 'base64').toString('utf-8'));
          if (decoded.csrf_token) extractedCsrf = decoded.csrf_token;
          if (decoded.service_id && !extractedServiceId) extractedServiceId = decoded.service_id;
        } catch (e) {}
      }

      if (!extractedServiceId) {
        extractedServiceId = config.serviceId || 347;
      }
      if (!extractedApiBase) {
        extractedApiBase = `${baseURL}/api/reseller-panel/service/${extractedServiceId}`;
      }

      this.sessionCookie = cookieHeader;
      this.csrfToken = extractedCsrf;
      this.serviceId = extractedServiceId;
      this.apiBase = extractedApiBase;
      // Valid for 7 hours (panel cookie max-age is 8h)
      this.sessionExpiryTime = Date.now() + 7 * 60 * 60 * 1000;

      // Save to state so it persists across restarts
      try {
        const currentState = db.getState();
        db.updateState({
          mroceanPanel: {
            ...(currentState.mroceanPanel || {}),
            _sessionCookie: this.sessionCookie,
            _csrfToken: this.csrfToken,
            _sessionExpiryTime: this.sessionExpiryTime,
            _serviceId: this.serviceId,
            _apiBase: this.apiBase
          }
        });
      } catch (e) {}

      console.log(`[MrOcean Success] Logged in successfully. Service ID: ${extractedServiceId}, CSRF Token acquired.`);
      return {
        baseURL,
        cookie: this.sessionCookie,
        csrfToken: this.csrfToken,
        apiBase: this.apiBase,
        serviceId: this.serviceId
      };
    } finally {
      this.isAuthenticating = false;
    }
  }

  public async getDashboard(overrideConfig?: any): Promise<MrOceanDashboardData> {
    const auth = await this.authenticate(overrideConfig);
    const dashRes = await this.client.get(`${auth.apiBase}`, {
      headers: {
        'Cookie': auth.cookie,
        'Accept': 'application/json'
      },
      validateStatus: () => true
    });

    if (dashRes.status === 401) {
      console.log('[MrOcean] Session expired on dashboard fetch. Re-authenticating...');
      const reAuth = await this.authenticate(overrideConfig, true);
      const retryRes = await this.client.get(`${reAuth.apiBase}`, {
        headers: {
          'Cookie': reAuth.cookie,
          'Accept': 'application/json'
        }
      });
      return retryRes.data?.dashboard || retryRes.data;
    }

    if (dashRes.status !== 200) {
      throw new Error(`خطا در بازخوانی داشبورد مستر اوشن: کد ${dashRes.status}`);
    }

    return dashRes.data?.dashboard || dashRes.data;
  }

  public async testConnection(overrideConfig?: any): Promise<{
    success: boolean;
    message: string;
    dashboard?: MrOceanDashboardData;
  }> {
    try {
      const auth = await this.authenticate(overrideConfig, true);
      const dashboard = await this.getDashboard(overrideConfig);

      const title = dashboard.title || `سرویس نمایندگی شناسه ${dashboard.serviceId || auth.serviceId}`;
      const totalUsers = dashboard.usersTotal !== undefined ? dashboard.usersTotal : (dashboard.users?.length || 0);
      const limitUsers = dashboard.usersLimit || 50;
      const activeUsers = dashboard.activeTotal !== undefined ? dashboard.activeTotal : 0;
      const usageGb = (dashboard.usageTotal / (1024 * 1024 * 1024)).toFixed(2);
      const maxUserGb = dashboard.maxUserDataGb ? `${dashboard.maxUserDataGb} گیگابایت` : 'نامحدود';

      return {
        success: true,
        message: `✅ اتصال به پنل نمایندگی مستر اوشن با موفقیت برقرار شد!\n\n` +
          `🏢 <b>عنوان سرویس:</b> ${title}\n` +
          `🆔 <b>شناسه سرویس:</b> ${dashboard.serviceId || auth.serviceId}\n` +
          `👥 <b>تعداد کاربران:</b> ${totalUsers} از ${limitUsers} نفر (فعال: ${activeUsers})\n` +
          `📊 <b>کل مصرف ثبت‌شده:</b> ${usageGb} GB\n` +
          `⚡ <b>حداکثر حجم هر کاربر:</b> ${maxUserGb}\n` +
          `⏳ <b>اعتبار سرویس:</b> ${dashboard.expiresAtText || 'فعال'}`,
        dashboard
      };
    } catch (err: any) {
      console.error('[MrOcean Test Connection Error]:', err.message);
      return {
        success: false,
        message: `خطا در اتصال به پنل مستر اوشن: ${err.message}`
      };
    }
  }

  public async addClient(
    usernameOrOptions: string | { username: string; totalGB?: number; volumeGb?: number; expiryDays?: number; durationDays?: number; note?: string; limitIp?: number },
    volumeGbParam?: number,
    durationDaysParam?: number,
    noteParam?: string
  ): Promise<{
    username: string;
    subUrl: string;
    portalUrl: string;
    expire: number;
    dataLimit: number;
    raw?: any;
  }> {
    let username = '';
    let volumeGb = 0;
    let durationDays = 0;
    let note = '';

    if (typeof usernameOrOptions === 'object' && usernameOrOptions !== null) {
      username = usernameOrOptions.username || '';
      volumeGb = usernameOrOptions.volumeGb ?? usernameOrOptions.totalGB ?? 0;
      durationDays = usernameOrOptions.durationDays ?? usernameOrOptions.expiryDays ?? 0;
      note = usernameOrOptions.note || '';
    } else {
      username = String(usernameOrOptions || '');
      volumeGb = volumeGbParam ?? 0;
      durationDays = durationDaysParam ?? 0;
      note = noteParam || '';
    }

    const auth = await this.authenticate();
    const cleanUsername = (username || '').trim().replace(/[^a-zA-Z0-9_]/g, '_');
    const isUnlimitedData = volumeGb <= 0;
    const isUnlimitedExpire = durationDays <= 0;
    const dataLimitGb = isUnlimitedData ? 0 : Number(volumeGb);
    const expireAt = isUnlimitedExpire ? 0 : Math.floor((Date.now() + durationDays * 86400000) / 1000);

    const payload = {
      username: cleanUsername,
      status: 'active',
      dataLimitGb,
      unlimitedData: isUnlimitedData,
      expireAt,
      unlimitedExpire: isUnlimitedExpire,
      dataResetStrategy: 'no_reset',
      onHoldDays: durationDays > 0 ? durationDays : 30,
      note: note || ''
    };

    console.log(`[MrOcean] Creating user ${cleanUsername} (${volumeGb}GB, ${durationDays}d)...`);
    let createRes = await this.client.post(`${auth.apiBase}/users`, payload, {
      headers: {
        'Content-Type': 'application/json',
        'Cookie': auth.cookie,
        'X-CSRF-Token': auth.csrfToken
      },
      validateStatus: () => true
    });

    if (createRes.status === 401) {
      console.log('[MrOcean] 401 on user creation. Re-authenticating...');
      const reAuth = await this.authenticate(undefined, true);
      createRes = await this.client.post(`${reAuth.apiBase}/users`, payload, {
        headers: {
          'Content-Type': 'application/json',
          'Cookie': reAuth.cookie,
          'X-CSRF-Token': reAuth.csrfToken
        },
        validateStatus: () => true
      });
    }

    if (createRes.status < 200 || createRes.status >= 300 || (createRes.data && createRes.data.ok === false)) {
      const errMsg = createRes.data?.error || createRes.data?.message || `کد وضعیت: ${createRes.status}`;
      throw new Error(`خطا در ایجاد کاربر در مستر اوشن: ${errMsg}`);
    }

    const createdUser = createRes.data?.user || createRes.data;
    const subscriptionUrl = String(createdUser?.subscriptionUrl || '').trim();
    const portalUrl = String(createdUser?.portalUrl || '').trim();
    const subUrl = subscriptionUrl || portalUrl;

    if (!subUrl) {
      // If direct response lacked link, re-fetch from dashboard
      try {
        const dash = await this.getDashboard();
        const found = dash.users?.find(u => u.username === cleanUsername);
        if (found && (found.subscriptionUrl || found.portalUrl)) {
          return {
            username: cleanUsername,
            subUrl: found.subscriptionUrl || found.portalUrl || '',
            portalUrl: found.portalUrl || '',
            expire: found.expire || expireAt,
            dataLimit: found.dataLimit || (dataLimitGb * 1024 * 1024 * 1024),
            raw: found
          };
        }
      } catch (e) {}
    }

    return {
      username: cleanUsername,
      subUrl,
      portalUrl,
      expire: createdUser?.expire || expireAt,
      dataLimit: createdUser?.dataLimit || (dataLimitGb * 1024 * 1024 * 1024),
      raw: createdUser
    };
  }

  public async renewClient(username: string, volumeGb: number, durationDays: number): Promise<void> {
    const auth = await this.authenticate();
    const cleanUsername = username.trim();

    try {
      // Use bulk endpoint to add traffic & extend days
      if (durationDays > 0) {
        await this.client.post(`${auth.apiBase}/bulk`, {
          action: 'extend_expire',
          users: [cleanUsername],
          days: Number(durationDays)
        }, {
          headers: {
            'Content-Type': 'application/json',
            'Cookie': auth.cookie,
            'X-CSRF-Token': auth.csrfToken
          },
          validateStatus: () => true
        });
      }

      if (volumeGb > 0) {
        await this.client.post(`${auth.apiBase}/bulk`, {
          action: 'increase_traffic',
          users: [cleanUsername],
          dataLimitGb: Number(volumeGb)
        }, {
          headers: {
            'Content-Type': 'application/json',
            'Cookie': auth.cookie,
            'X-CSRF-Token': auth.csrfToken
          },
          validateStatus: () => true
        });
      }
      console.log(`[MrOcean] Successfully renewed client ${cleanUsername} (+${volumeGb}GB, +${durationDays}d)`);
    } catch (err: any) {
      console.error(`[MrOcean Renew Error for ${cleanUsername}]:`, err.message);
      throw err;
    }
  }

  public async updateClientEnable(username: string, enable: boolean): Promise<void> {
    const auth = await this.authenticate();
    const cleanUsername = username.trim();
    const action = enable ? 'active' : 'suspend';

    try {
      const res = await this.client.post(`${auth.apiBase}/users/${encodeURIComponent(cleanUsername)}/${action}`, {}, {
        headers: {
          'Content-Type': 'application/json',
          'Cookie': auth.cookie,
          'X-CSRF-Token': auth.csrfToken
        },
        validateStatus: () => true
      });
      console.log(`[MrOcean] updateClientEnable ${cleanUsername} -> ${action} (Status: ${res.status})`);
    } catch (err: any) {
      console.error(`[MrOcean updateClientEnable Error for ${cleanUsername}]:`, err.message);
    }
  }

  public async delClient(username: string): Promise<void> {
    const auth = await this.authenticate();
    const cleanUsername = username.trim();

    try {
      const res = await this.client.delete(`${auth.apiBase}/users/${encodeURIComponent(cleanUsername)}`, {
        headers: {
          'Cookie': auth.cookie,
          'X-CSRF-Token': auth.csrfToken
        },
        validateStatus: () => true
      });
      console.log(`[MrOcean] delClient ${cleanUsername} (Status: ${res.status})`);
    } catch (err: any) {
      console.error(`[MrOcean delClient Error for ${cleanUsername}]:`, err.message);
    }
  }

  public async getAllClientsWithTraffic(): Promise<any[]> {
    try {
      const state = db.getState();
      if (!state.mroceanPanel?.url && !state.mroceanPanel?.username) {
        return [];
      }
      const dashboard = await this.getDashboard();
      if (!dashboard || !Array.isArray(dashboard.users)) {
        return [];
      }

      return dashboard.users.map(u => ({
        id: u.username,
        email: u.username,
        username: u.username,
        subUrl: u.subscriptionUrl || u.portalUrl || '',
        portalUrl: u.portalUrl || '',
        up: 0,
        down: u.usedTraffic || 0,
        totalUsed: u.usedTraffic || 0,
        total: u.dataLimit || 0,
        expiryTime: u.expire ? u.expire * 1000 : 0,
        enable: u.status === 'active',
        panel: 'mrocean' as const
      }));
    } catch (err: any) {
      console.error('[MrOcean] getAllClientsWithTraffic error:', err.message);
      return [];
    }
  }

  public async getServices(): Promise<any[]> {
    try {
      const dash = await this.getDashboard();
      if (!dash) return [];
      return [{
        id: dash.serviceId,
        name: dash.title || `سرویس نمایندگی ${dash.serviceId}`,
        user_count: dash.usersTotal !== undefined ? dash.usersTotal : (dash.users?.length || 0),
        max_users: dash.usersLimit || 50,
        status: dash.status || 'active',
        usage_gb: ((dash.usageTotal || 0) / (1024 * 1024 * 1024)).toFixed(2),
        expires_at: dash.expiresAtText
      }];
    } catch (err: any) {
      console.error('[MrOcean] getServices error:', err.message);
      return [];
    }
  }

  public async getInbounds(): Promise<any[]> {
    try {
      const services = await this.getServices();
      return services.map(s => ({
        id: s.id,
        tag: `mrocean-service-${s.id}`,
        remark: s.name,
        protocol: 'V2Ray/Sub',
        port: s.id,
        enable: s.status === 'active'
      }));
    } catch (err: any) {
      console.error('[MrOcean] getInbounds error:', err.message);
      return [];
    }
  }
}

export const mrocean = new MrOceanClient();
