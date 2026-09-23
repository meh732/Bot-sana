import axios, { AxiosInstance } from 'axios';
import https from 'https';
import { db, PanelConfig } from './db.js';

export interface RebeccaInbound {
  id: string;
  tag: string;
  protocol: string;
  port: number;
  network?: string;
  tls?: string;
  remark: string;
  enable: boolean;
  total: number;
  up: number;
  down: number;
}

export interface RebeccaUserResponse {
  username: string;
  status: 'active' | 'disabled' | 'limited' | 'expired' | 'on_hold';
  used_traffic?: number;
  data_limit?: number;
  expire?: number; // Unix timestamp in seconds
  data_limit_reset_strategy?: string;
  subscription_url?: string;
  links?: string[];
  proxies?: Record<string, any>;
  inbounds?: Record<string, string[]>;
  note?: string;
  sub_revoked_at?: string;
  created_at?: string;
}

export class RebeccaService {
  private cachedToken: string | null = null;
  private tokenExpiresAt: number = 0;
  private httpsAgent = new https.Agent({
    rejectUnauthorized: false
  });

  private getPanelConfig(panelOverride?: any): PanelConfig {
    if (panelOverride && panelOverride.url) {
      return panelOverride;
    }
    const state = db.getState();
    if (state.rebeccaPanel && state.rebeccaPanel.url) {
      return state.rebeccaPanel;
    }
    if (state.panel?.panelType === 'rebecca' || state.activePanelMode === 'rebecca') {
      return state.panel || {};
    }
    return state.rebeccaPanel || state.panel || {};
  }

  private getBaseUrl(panelOverride?: any): string {
    const config = this.getPanelConfig(panelOverride);
    let url = (config.url || '').trim();
    if (!url) return '';
    
    // Remove trailing slashes
    url = url.replace(/\/+$/, '');
    
    // Ensure protocol
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }
    
    // Remove trailing /api or /dashboard if mistakenly added by user
    url = url.replace(/\/api\/?$/, '').replace(/\/dashboard\/?$/, '');
    
    return url;
  }

  private createHttpClient(panelOverride?: any, token?: string): AxiosInstance {
    const baseUrl = this.getBaseUrl(panelOverride);
    const headers: Record<string, string> = {
      'Accept': 'application/json'
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return axios.create({
      baseURL: baseUrl,
      headers,
      timeout: 12000,
      httpsAgent: this.httpsAgent,
      validateStatus: (status) => status < 500 // Allow handling 4xx without throwing immediately
    });
  }

  /**
   * Acquires or returns cached Bearer access token for Rebecca API
   */
  public async getAuthToken(panelOverride?: any, forceRefresh: boolean = false): Promise<string> {
    const config = this.getPanelConfig(panelOverride);
    
    // If API Key is explicitly provided, use it directly
    if (config.apiKey && config.apiKey.trim().length > 10) {
      return config.apiKey.trim();
    }

    const now = Date.now();
    if (!forceRefresh && this.cachedToken && this.tokenExpiresAt > now) {
      return this.cachedToken;
    }

    const baseUrl = this.getBaseUrl(panelOverride);
    if (!baseUrl) {
      throw new Error('آدرس پنل ربکا (URL) تنظیم نشده است.');
    }

    const username = (config.username || '').trim();
    const password = (config.password || '').trim();

    if (!username || !password) {
      throw new Error('نام کاربری یا رمز عبور ادمین پنل ربکا تنظیم نشده است.');
    }

    const client = axios.create({
      baseURL: baseUrl,
      timeout: 10000,
      httpsAgent: this.httpsAgent
    });

    console.log(`[Rebecca] Authenticating with ${baseUrl}/api/admin/token for user: ${username}`);

    try {
      // Standard OAuth2 form-urlencoded request for Rebecca/Marzban
      const formParams = new URLSearchParams();
      formParams.append('grant_type', 'password');
      formParams.append('username', username);
      formParams.append('password', password);

      const response = await client.post('/api/admin/token', formParams.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json'
        }
      });

      if (response.data && response.data.access_token) {
        this.cachedToken = response.data.access_token;
        // Cache token for 12 hours
        this.tokenExpiresAt = Date.now() + 12 * 3600 * 1000;
        console.log('[Rebecca] Authentication successful. Token cached.');
        return this.cachedToken!;
      } else {
        throw new Error('پاسخ توکن از پنل ربکا فاقد access_token است.');
      }
    } catch (err: any) {
      console.error('[Rebecca] Auth error:', err.response?.data || err.message);
      
      // Fallback: Try with json body in case specific Rebecca build expects JSON
      try {
        const jsonResp = await client.post('/api/admin/token', { username, password }, {
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }
        });
        if (jsonResp.data && jsonResp.data.access_token) {
          this.cachedToken = jsonResp.data.access_token;
          this.tokenExpiresAt = Date.now() + 12 * 3600 * 1000;
          return this.cachedToken!;
        }
      } catch {
        // Ignore fallback error
      }

      if (err.response?.status === 401 || err.response?.status === 422) {
        throw new Error('نام کاربری یا رمز عبور پنل ربکا اشتباه است.');
      }
      if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
        throw new Error(`ارتباط با سرور ربکا برقرار نشد. لطفاً از صحت آدرس دامنه و باز بودن پورت اطمینان حاصل کنید: ${baseUrl}`);
      }
      throw new Error(`خطا در ورود به پنل ربکا: ${err.response?.data?.detail || err.message}`);
    }
  }

  /**
   * Helper method to execute authorized requests with automatic retry on token expiration
   */
  private async request(method: 'get' | 'post' | 'put' | 'delete', endpoint: string, data?: any, params?: any, panelOverride?: any): Promise<any> {
    let token = await this.getAuthToken(panelOverride);
    let client = this.createHttpClient(panelOverride, token);

    let res = await client.request({
      method,
      url: endpoint,
      data,
      params
    });

    // If 401 Unauthorized, refresh token and retry once
    if (res.status === 401) {
      console.log('[Rebecca] Received 401 Unauthorized. Refreshing token...');
      token = await this.getAuthToken(panelOverride, true);
      client = this.createHttpClient(panelOverride, token);
      res = await client.request({
        method,
        url: endpoint,
        data,
        params
      });
    }

    if (res.status >= 400) {
      const errorMsg = res.data?.detail || (typeof res.data === 'string' ? res.data : JSON.stringify(res.data)) || `خطای HTTP ${res.status}`;
      throw new Error(errorMsg);
    }

    return res.data;
  }

  /**
   * Tests connection to Rebecca panel and returns system stats
   */
  public async testConnection(panelOverride?: any): Promise<{ success: boolean; message: string; version?: string; inboundsCount?: number }> {
    try {
      const baseUrl = this.getBaseUrl(panelOverride);
      if (!baseUrl) {
        return { success: false, message: 'آدرس پنل ربکا (URL) مشخص نشده است.' };
      }

      // Check auth token
      const token = await this.getAuthToken(panelOverride, true);
      if (!token) {
        return { success: false, message: 'دریافت توکن دسترسی از پنل ربکا با شکست مواجه شد.' };
      }

      // Query system status
      let systemInfo: any = null;
      try {
        systemInfo = await this.request('get', '/api/system', null, null, panelOverride);
      } catch (e: any) {
        console.log('[Rebecca] /api/system failed, falling back to /api/admin:', e.message);
        try {
          systemInfo = await this.request('get', '/api/admin', null, null, panelOverride);
        } catch {
          // Continue to inbounds check
        }
      }

      // Query inbounds count
      let inboundsCount = 0;
      try {
        const inbounds = await this.getInbounds(panelOverride);
        inboundsCount = inbounds.length;
      } catch {
        // Ignore inbounds count error
      }

      const versionStr = systemInfo?.version || systemInfo?.xray_version || 'فعال (v1.x)';
      return {
        success: true,
        message: `✅ اتصال به پنل ربکا (Rebecca) با موفقیت برقرار شد. وضعیت: فعال | تعداد اینباندها: ${inboundsCount}`,
        version: versionStr,
        inboundsCount
      };
    } catch (err: any) {
      console.error('[Rebecca] testConnection error:', err);
      return {
        success: false,
        message: `❌ خطا در اتصال به پنل ربکا: ${err.message}`
      };
    }
  }

  /**
   * Retrieves all inbounds from Rebecca panel and maps them to unified inbound format
   */
  public async getInbounds(panelOverride?: any): Promise<RebeccaInbound[]> {
    try {
      const baseUrl = this.getBaseUrl(panelOverride);
      if (!baseUrl) {
        return [];
      }
      const data = await this.request('get', '/api/inbounds', null, null, panelOverride);
      const inbounds: RebeccaInbound[] = [];

      if (!data) return [];

      // Rebecca/Marzban returns inbounds grouped by protocol: { vless: [...], vmess: [...], trojan: [...], shadowsocks: [...] }
      if (typeof data === 'object' && !Array.isArray(data)) {
        for (const [protocol, items] of Object.entries(data)) {
          if (Array.isArray(items)) {
            items.forEach((item: any) => {
              const tag = item.tag || `${protocol}_${item.port || ''}`;
              inbounds.push({
                id: tag,
                tag: tag,
                protocol: item.protocol || protocol,
                port: item.port || 0,
                network: item.network || 'tcp',
                tls: item.tls || 'none',
                remark: tag,
                enable: true,
                total: 0,
                up: 0,
                down: 0
              });
            });
          }
        }
      } else if (Array.isArray(data)) {
        data.forEach((item: any) => {
          const tag = item.tag || `${item.protocol || 'inbound'}_${item.port || ''}`;
          inbounds.push({
            id: tag,
            tag: tag,
            protocol: item.protocol || 'vless',
            port: item.port || 0,
            network: item.network || 'tcp',
            tls: item.tls || 'none',
            remark: tag,
            enable: true,
            total: 0,
            up: 0,
            down: 0
          });
        });
      }

      return inbounds;
    } catch (err: any) {
      console.error('[Rebecca] getInbounds error:', err.message);
      return [];
    }
  }

  /**
   * Normalizes client identifier into a valid Rebecca username (alphanumeric and underscores)
   */
  public normalizeUsername(input: string): string {
    let clean = (input || '').replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
    clean = clean.replace(/_+/g, '_').replace(/^_+|_+$/g, '');
    if (clean.length < 3) {
      clean = 'usr_' + clean;
    }
    if (clean.length > 32) {
      clean = clean.slice(0, 32);
    }
    return clean;
  }

  /**
   * Constructs the full, accessible subscription URL
   */
  public buildFullSubUrl(rawSubUrl?: string, panelOverride?: any): string {
    if (!rawSubUrl) return '';
    const config = this.getPanelConfig(panelOverride);
    const subBase = (config.subUrlBase || '').trim();

    // If subUrl is already an absolute HTTP URL
    if (rawSubUrl.startsWith('http://') || rawSubUrl.startsWith('https://')) {
      if (subBase && subBase.startsWith('http')) {
        const subIdMatch = rawSubUrl.match(/\/sub\/([^/?#]+)/);
        if (subIdMatch && subIdMatch[1]) {
          const baseClean = subBase.replace(/\/+$/, '');
          if (baseClean.endsWith('/sub')) {
            return `${baseClean}/${subIdMatch[1]}`;
          } else {
            return `${baseClean}/sub/${subIdMatch[1]}`;
          }
        }
      }
      return rawSubUrl;
    }

    // If relative path e.g. /sub/eyJ...
    const cleanPath = rawSubUrl.startsWith('/') ? rawSubUrl : `/${rawSubUrl}`;
    if (subBase && subBase.startsWith('http')) {
      const baseClean = subBase.replace(/\/+$/, '');
      if (baseClean.endsWith('/sub') && cleanPath.startsWith('/sub/')) {
        return `${baseClean}${cleanPath.replace('/sub', '')}`;
      }
      return `${baseClean}${cleanPath}`;
    }

    const panelBase = this.getBaseUrl(panelOverride);
    return `${panelBase}${cleanPath}`;
  }

  /**
   * Retrieves a single client from Rebecca panel by username/email
   */
  public async getClient(emailOrUsername: string, panelOverride?: any): Promise<any | null> {
    try {
      const username = this.normalizeUsername(emailOrUsername);
      const u = await this.request('get', `/api/user/${encodeURIComponent(username)}`, null, null, panelOverride);
      if (!u || !u.username) return null;
      const usedBytes = u.used_traffic || u.lifetime_used_traffic || 0;
      const subIdMatch = u.subscription_url ? u.subscription_url.match(/\/sub\/([^/?#]+)/) : null;
      const subId = subIdMatch ? subIdMatch[1] : u.username;
      const fullSubUrl = this.buildFullSubUrl(u.subscription_url, panelOverride);

      return {
        id: u.username,
        email: u.username,
        subId,
        total: u.data_limit || 0,
        up: Math.floor(usedBytes / 2),
        down: Math.ceil(usedBytes / 2),
        totalUsed: usedBytes,
        expiryTime: (u.expire || 0) * 1000,
        enable: u.status === 'active',
        subUrl: fullSubUrl,
        links: u.links || [],
        panelType: 'rebecca' as const
      };
    } catch {
      return null;
    }
  }

  /**
   * Adds or creates a new client/config in Rebecca panel
   */
  public async addClient(
    email: string,
    volumeGb: number,
    durationDays: number,
    targetInboundIds?: string | number | (string | number)[],
    limitIp: number = 0,
    telegramId?: string,
    group?: string
  ): Promise<{
    id: string;
    uuid: string;
    email: string;
    subId: string;
    subUrl: string;
    links: string[];
    total: number;
    expiryTime: number;
    enable: boolean;
  }> {
    const username = this.normalizeUsername(email);
    const dataLimitBytes = volumeGb > 0 ? Math.round(volumeGb * 1024 * 1024 * 1024) : 0;
    const expireTimestamp = durationDays > 0 ? Math.floor(Date.now() / 1000) + (durationDays * 86400) : 0;

    // Build proxies and inbounds structure
    const proxies: Record<string, any> = {
      vless: { flow: "xtls-rprx-vision" },
      vmess: {},
      trojan: {},
      shadowsocks: {}
    };

    let inboundsObj: Record<string, string[]> = {};
    if (targetInboundIds) {
      const idsArray = Array.isArray(targetInboundIds) ? targetInboundIds : [targetInboundIds];
      const stringTags = idsArray.map(id => String(id).trim()).filter(Boolean);
      
      if (stringTags.length > 0) {
        // Fetch inbounds to map tags to protocols
        const allInbounds = await this.getInbounds();
        for (const tag of stringTags) {
          const matched = allInbounds.find(ib => ib.tag === tag || String(ib.id) === tag);
          if (matched) {
            if (!inboundsObj[matched.protocol]) {
              inboundsObj[matched.protocol] = [];
            }
            if (!inboundsObj[matched.protocol].includes(matched.tag)) {
              inboundsObj[matched.protocol].push(matched.tag);
            }
          }
        }
      }
    }

    const note = `Tg: ${telegramId || 'None'} | Group: ${group || 'None'}`;
    const payload = {
      username,
      proxies,
      inbounds: Object.keys(inboundsObj).length > 0 ? inboundsObj : {},
      expire: expireTimestamp,
      data_limit: dataLimitBytes,
      data_limit_reset_strategy: "no_reset",
      status: "active",
      note
    };

    console.log(`[Rebecca] Creating client ${username} (Vol: ${volumeGb}GB, Dur: ${durationDays}d)...`);

    let resData: RebeccaUserResponse;
    try {
      resData = await this.request('post', '/api/user', payload);
    } catch (err: any) {
      // If user already exists (409 Conflict), update the existing user
      if (err.message.includes('409') || err.message.includes('already exists') || err.message.includes('Conflict')) {
        console.log(`[Rebecca] User ${username} already exists. Updating existing user...`);
        resData = await this.request('put', `/api/user/${encodeURIComponent(username)}`, {
          proxies,
          inbounds: Object.keys(inboundsObj).length > 0 ? inboundsObj : {},
          expire: expireTimestamp,
          data_limit: dataLimitBytes,
          status: "active"
        });
        // Reset traffic on update
        await this.request('post', `/api/user/${encodeURIComponent(username)}/reset`).catch(() => {});
      } else {
        throw new Error(`خطا در ایجاد کاربر در پنل ربکا: ${err.message}`);
      }
    }

    const fullSubUrl = this.buildFullSubUrl(resData.subscription_url);
    const subIdMatch = resData.subscription_url ? resData.subscription_url.match(/\/sub\/([^/?#]+)/) : null;
    const subId = subIdMatch ? subIdMatch[1] : username;
    const clientUuid = resData.proxies?.vless?.id || resData.proxies?.vmess?.id || username;

    return {
      id: resData.username,
      uuid: clientUuid,
      email: resData.username,
      subId,
      subUrl: fullSubUrl,
      links: resData.links || [],
      total: resData.data_limit || 0,
      expiryTime: (resData.expire || 0) * 1000,
      enable: resData.status === 'active'
    };
  }

  /**
   * Retrieves all clients and their live traffic usage from Rebecca panel
   */
  public async getAllClientsWithTraffic(): Promise<Array<{
    id: string;
    email: string;
    subId: string;
    total: number;
    up: number;
    down: number;
    totalUsed: number;
    expiryTime: number;
    enable: boolean;
    subUrl: string;
    links?: string[];
  }>> {
    try {
      const baseUrl = this.getBaseUrl();
      if (!baseUrl) {
        return [];
      }
      const data = await this.request('get', '/api/users', null, { limit: 1000, offset: 0 });
      let usersList: any[] = [];
      if (data && Array.isArray(data.users)) {
        usersList = data.users;
      } else if (Array.isArray(data)) {
        usersList = data;
      }

      return usersList.map((u: any) => {
        const usedBytes = u.used_traffic || u.lifetime_used_traffic || 0;
        const subIdMatch = u.subscription_url ? u.subscription_url.match(/\/sub\/([^/?#]+)/) : null;
        const subId = subIdMatch ? subIdMatch[1] : u.username;
        const fullSubUrl = this.buildFullSubUrl(u.subscription_url);

        return {
          id: u.username,
          email: u.username,
          subId,
          total: u.data_limit || 0,
          up: Math.floor(usedBytes / 2),
          down: Math.ceil(usedBytes / 2),
          totalUsed: usedBytes,
          expiryTime: (u.expire || 0) * 1000,
          enable: u.status === 'active',
          subUrl: fullSubUrl,
          links: u.links || []
        };
      });
    } catch (err: any) {
      console.error('[Rebecca] getAllClientsWithTraffic error:', err.message);
      return [];
    }
  }

  /**
   * Renews or recharges an existing client on Rebecca panel
   */
  public async renewClient(email: string, volumeGb: number, durationDays: number): Promise<void> {
    const username = this.normalizeUsername(email);
    console.log(`[Rebecca] Renewing user ${username} (Vol: ${volumeGb}GB, Dur: ${durationDays}d)...`);

    // Fetch current user details
    let currentUser: any = null;
    try {
      currentUser = await this.request('get', `/api/user/${encodeURIComponent(username)}`);
    } catch (e: any) {
      console.warn(`[Rebecca] Could not fetch current user for renewal: ${e.message}`);
    }

    const nowSec = Math.floor(Date.now() / 1000);
    let newExpire = 0;
    if (durationDays > 0) {
      if (currentUser && currentUser.expire && currentUser.expire > nowSec) {
        // Add days to current active period
        newExpire = currentUser.expire + (durationDays * 86400);
      } else {
        newExpire = nowSec + (durationDays * 86400);
      }
    }

    const newDataLimit = volumeGb > 0 ? Math.round(volumeGb * 1024 * 1024 * 1024) : 0;

    // Reset traffic
    await this.request('post', `/api/user/${encodeURIComponent(username)}/reset`).catch(() => {});

    // Update user
    await this.request('put', `/api/user/${encodeURIComponent(username)}`, {
      data_limit: newDataLimit,
      expire: newExpire,
      status: "active"
    });

    console.log(`[Rebecca] User ${username} successfully renewed.`);
  }

  /**
   * Enables or disables a user in Rebecca panel
   */
  public async updateClientEnable(email: string, enable: boolean): Promise<boolean> {
    const username = this.normalizeUsername(email);
    console.log(`[Rebecca] Updating status for ${username} to: ${enable ? 'active' : 'disabled'}`);
    try {
      await this.request('put', `/api/user/${encodeURIComponent(username)}`, {
        status: enable ? 'active' : 'disabled'
      });
      return true;
    } catch (err: any) {
      console.error(`[Rebecca] updateClientEnable error for ${username}:`, err.message);
      return false;
    }
  }

  /**
   * Deletes a user by email/username in Rebecca panel
   */
  public async delClientByEmail(email: string): Promise<boolean> {
    const username = this.normalizeUsername(email);
    console.log(`[Rebecca] Deleting client ${username}...`);
    try {
      await this.request('delete', `/api/user/${encodeURIComponent(username)}`);
      return true;
    } catch (err: any) {
      console.error(`[Rebecca] delClientByEmail error for ${username}:`, err.message);
      return false;
    }
  }

  /**
   * Deletes client by inbound and UUID/username
   */
  public async delClient(inboundId: number | string, clientUuid: string): Promise<boolean> {
    return this.delClientByEmail(clientUuid);
  }
}

export const rebecca = new RebeccaService();
