import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
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
  private tokenExpiryTime: number = 0;
  private discoveredApiKey: string = '';
  private cachedServices: any[] = [];
  private subscriptionPrefix: string = 'https://link.gridpointgo.com';
  private subscriptionTag: string = 'access';
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

  public sanitizeUsername(rawInput: any): string {
    let clean = String(rawInput || '')
      .trim()
      .replace(/[۰-۹]/g, d => String.fromCharCode(d.charCodeAt(0) - 1728))
      .replace(/[٠-٩]/g, d => String.fromCharCode(d.charCodeAt(0) - 1632))
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '');

    // Ensure at least one lowercase English letter exists
    if (!/[a-z]/.test(clean)) {
      clean = clean ? `u_${clean}` : `u_${Date.now().toString().slice(-6)}`;
    }

    // Truncate base before appending digits so digits never get cut off by 30-char limit
    if (clean.length > 24) {
      clean = clean.slice(0, 24).replace(/_+$/g, '');
    }

    // Ensure at least one digit exists
    if (!/[0-9]/.test(clean)) {
      const randDigits = Math.floor(10 + Math.random() * 89);
      clean = `${clean}_${randDigits}`;
    }

    // Ensure minimum 3 characters
    if (clean.length < 3) {
      const suffix = Math.floor(100 + Math.random() * 899);
      clean = `${clean}_${suffix}`;
    }

    // Final length guard (3-30 chars) while preserving digits
    if (clean.length > 30) {
      clean = clean.slice(0, 30).replace(/_+$/g, '');
      if (!/[0-9]/.test(clean)) {
        const randDigits = Math.floor(10 + Math.random() * 89);
        clean = `${clean.slice(0, 27).replace(/_+$/g, '')}_${randDigits}`;
      }
    }

    return clean;
  }

  private formatBaseUrl(rawUrl: string): string {
    let formattedUrl = rawUrl.trim().replace(/\s/g, '');
    if (!formattedUrl.startsWith('http://') && !formattedUrl.startsWith('https://')) {
      formattedUrl = 'https://' + formattedUrl;
    }

    let baseURL = formattedUrl.endsWith('/') ? formattedUrl.slice(0, -1) : formattedUrl;

    const commonSuffixes = [
      '/panel/api',
      '/api',
      '/panel',
      '/dashboard',
      '/subscriptions',
      '/login',
      '/docs/index.html',
      '/docs'
    ];
    let changed = true;
    while (changed) {
      changed = false;
      for (const suffix of commonSuffixes) {
        if (baseURL.toLowerCase().endsWith(suffix)) {
          baseURL = baseURL.slice(0, -suffix.length);
          if (baseURL.endsWith('/')) baseURL = baseURL.slice(0, -1);
          changed = true;
        }
      }
    }
    return baseURL;
  }

  private extractJwtExpiryMs(token: string): number {
    try {
      const parts = token.split('.');
      if (parts.length === 3) {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
        if (payload && typeof payload.exp === 'number') {
          // Refresh 1 hour before actual JWT expiration
          return (payload.exp * 1000) - 3600000;
        }
      }
    } catch (e) {}
    // Default 12 hours if not parseable
    return Date.now() + 12 * 3600 * 1000;
  }

  private captureAdminMetadata(adminObj: any) {
    if (!adminObj || typeof adminObj !== 'object') return;
    if (adminObj.api_key && typeof adminObj.api_key === 'string' && adminObj.api_key.trim() !== '') {
      this.discoveredApiKey = adminObj.api_key.trim();
    }
    if (adminObj.subscription_prefix && typeof adminObj.subscription_prefix === 'string') {
      this.subscriptionPrefix = adminObj.subscription_prefix.replace(/\/+$/, '');
    }
    if (adminObj.subscription_tag && typeof adminObj.subscription_tag === 'string') {
      this.subscriptionTag = adminObj.subscription_tag.replace(/^\/+|\/+$/g, '');
    }
    if (Array.isArray(adminObj.services) && adminObj.services.length > 0) {
      const mapped = adminObj.services.map((s: any) => ({
        id: s.id !== undefined ? s.id : s.service_id,
        remark: s.name || s.title || s.remark || `Service #${s.id}`,
        name: s.name || s.title || `Service #${s.id}`,
        protocol: 'Service',
        enable: true,
        ...s
      })).filter((s: any) => s.id !== undefined);
      if (mapped.length > 0) {
        this.cachedServices = mapped;
      }
    }
  }

  private async getAuthOptions(panelOverride?: any, forceRefresh: boolean = false): Promise<{ baseURL: string; headers: Record<string, string> }> {
    const state = db.getState();
    const savedPanel = state.panel4 || {};
    const panel = panelOverride ? { ...savedPanel, ...panelOverride } : savedPanel;

    // Resolve masked password from web UI if '********' was sent
    if (panel.password === '********' || !panel.password) {
      if (savedPanel.password && savedPanel.password !== '********') {
        panel.password = savedPanel.password;
      }
    }

    const normUrl = (panel.url || 'https://app.solidlayerco.com').trim();
    const normUser = (panel.username || '').trim();
    const normPass = (panel.password || '').trim();
    const normApiKey = (panel.apiKey || '').trim();

    const hasApiKey = normApiKey !== '';
    const hasUserPass = normUser !== '' && normPass !== '';

    if (!normUrl || (!hasApiKey && !hasUserPass)) {
      throw new Error('مشخصات پنل ۴ کامل نیست. لطفاً آدرس پنل به همراه نام کاربری و رمز ورود یا کلید API را وارد کنید.');
    }

    if (
      normUrl !== this.lastPanelUrl ||
      normUser !== this.lastPanelUser ||
      normPass !== this.lastPanelPass ||
      normApiKey !== this.lastPanelApiKey
    ) {
      this.cookie = '';
      this.tokenExpiryTime = 0;
      this.workingApiPrefix = '';
      this.lastPanelUrl = normUrl;
      this.lastPanelUser = normUser;
      this.lastPanelPass = normPass;
      this.lastPanelApiKey = normApiKey;
    }

    const baseURL = this.formatBaseUrl(normUrl);
    const now = Date.now();

    // 1. Username/Password Login Auth
    if (hasUserPass) {
      const isExpired = !this.cookie || (this.tokenExpiryTime > 0 && now >= this.tokenExpiryTime);
      if (forceRefresh || isExpired) {
        this.cookie = '';
        const loginPaths = ['/api/admins/token', '/login', '/panel/login'];
        let loginSuccess = false;
        let lastLoginError = '';

        for (const path of loginPaths) {
          try {
            // Form-encoded (FastAPI / Panel 4 standard)
            const params = new URLSearchParams();
            params.append('grant_type', 'password');
            params.append('username', normUser);
            params.append('password', normPass);

            let res = await this.client.post(`${baseURL}${path}`, params, {
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              validateStatus: () => true,
              timeout: 10000
            });

            if (res.data?.token || res.data?.access_token) {
              const tok = res.data.token || res.data.access_token;
              this.cookie = tok;
              this.tokenExpiryTime = this.extractJwtExpiryMs(tok);
              if (res.data?.admin) this.captureAdminMetadata(res.data.admin);
              loginSuccess = true;
              break;
            }

            // JSON mode
            res = await this.client.post(`${baseURL}${path}`, {
              username: normUser,
              password: normPass
            }, {
              headers: { 'Content-Type': 'application/json' },
              validateStatus: () => true,
              timeout: 10000
            });

            if (res.data?.token || res.data?.access_token) {
              const tok = res.data.token || res.data.access_token;
              this.cookie = tok;
              this.tokenExpiryTime = this.extractJwtExpiryMs(tok);
              if (res.data?.admin) this.captureAdminMetadata(res.data.admin);
              loginSuccess = true;
              break;
            } else if (res.data?.success || res.status === 200) {
              const rawCookies = res.headers['set-cookie'];
              if (rawCookies && rawCookies.length > 0) {
                this.cookie = rawCookies.map((c: string) => c.split(';')[0]).join('; ');
                this.tokenExpiryTime = Date.now() + 12 * 3600 * 1000;
                loginSuccess = true;
                break;
              }
            }
          } catch (e: any) {
            lastLoginError = e.message;
          }
        }

        // Fallback to configured or discovered API Key if password login failed
        if (!loginSuccess && !this.cookie) {
          const fallbackKey = normApiKey || this.discoveredApiKey;
          if (fallbackKey) {
            const isJwt = fallbackKey.includes('.');
            const headers: Record<string, string> = {
              'Accept': 'application/json'
            };
            if (isJwt) {
              headers['Authorization'] = fallbackKey.startsWith('Bearer ') ? fallbackKey : `Bearer ${fallbackKey}`;
            } else {
              headers['X-API-Key'] = fallbackKey;
            }
            return { baseURL, headers };
          }
          throw new Error(`عدم موفقیت در ورود به پنل ۴. لطفاً آدرس، نام کاربری و رمز عبور را بررسی فرمایید: ${lastLoginError}`);
        }
      }

      const isJwt = this.cookie.includes('.') || this.cookie.startsWith('Bearer ');
      const authHeader = this.cookie.startsWith('Bearer ') ? this.cookie : (this.cookie.includes('.') ? `Bearer ${this.cookie}` : this.cookie);
      const headers: Record<string, string> = {
        'Accept': 'application/json'
      };
      if (isJwt) {
        headers['Authorization'] = authHeader;
      } else {
        headers['Cookie'] = this.cookie;
      }
      return { baseURL, headers };
    }

    // 2. Pure API Key Auth (Important: Do NOT send Authorization: Bearer <raw_api_key> on Panel 4 as it triggers 401)
    if (hasApiKey) {
      const isJwt = normApiKey.includes('.');
      const headers: Record<string, string> = {
        'Accept': 'application/json'
      };
      if (isJwt) {
        headers['Authorization'] = normApiKey.startsWith('Bearer ') ? normApiKey : `Bearer ${normApiKey}`;
      } else {
        headers['X-API-Key'] = normApiKey;
      }
      return { baseURL, headers };
    }

    throw new Error('مشخصات احراز هویت پنل ۴ تعریف نشده است.');
  }

  private async requestWithRetry(
    configBuilder: (auth: { baseURL: string; headers: Record<string, string> }) => AxiosRequestConfig,
    panelOverride?: any
  ): Promise<AxiosResponse> {
    let auth = await this.getAuthOptions(panelOverride, false);
    let res = await this.client.request({
      ...configBuilder(auth),
      validateStatus: () => true
    });

    if (res.status === 401 || res.status === 403) {
      // Force token refresh and retry immediately
      try {
        auth = await this.getAuthOptions(panelOverride, true);
        res = await this.client.request({
          ...configBuilder(auth),
          validateStatus: () => true
        });
      } catch (e) {}

      // If still 401/403 and we have a discoveredApiKey, try X-API-Key directly
      if ((res.status === 401 || res.status === 403) && this.discoveredApiKey) {
        const keyAuth = {
          baseURL: auth.baseURL,
          headers: {
            'X-API-Key': this.discoveredApiKey,
            'Accept': 'application/json'
          }
        };
        res = await this.client.request({
          ...configBuilder(keyAuth),
          validateStatus: () => true
        });
      }
    }

    return res;
  }

  public async testConnection(panelOverride?: any): Promise<{ success: boolean; message: string; inboundsCount?: number; inbounds?: any[] }> {
    try {
      const inbounds = await this.getInbounds(panelOverride, true);
      if (!inbounds || inbounds.length === 0) {
        return {
          success: false,
          message: 'اتصال برقرار شد اما هیچ سرویس یا اینباند فعالی یافت نشد. لطفاً دسترسی اکانت را بررسی کنید.'
        };
      }
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

  public async getInbounds(panelOverride?: any, forceRefreshAuth: boolean = false): Promise<any[]> {
    try {
      const state = db.getState();
      const savedPanel = state.panel4 || {};
      const panel = panelOverride ? { ...savedPanel, ...panelOverride } : savedPanel;
      const urlToUse = panel.url || 'https://app.solidlayerco.com';
      if (!urlToUse || panel.enabled === false) return [];
      if (urlToUse.includes('test-') || urlToUse.includes('example.com')) return [];

      if (forceRefreshAuth) {
        await this.getAuthOptions(panelOverride, true);
      }

      const inboundsList: any[] = [];

      // 1. Check Panel 4 native Services API (/api/services and /api/admins/current) with automatic 401 retry
      const servicePaths = ['/api/services', '/api/admins/current'];
      for (const sp of servicePaths) {
        try {
          const res = await this.requestWithRetry((auth) => ({
            method: 'GET',
            url: `${auth.baseURL}${sp}`,
            headers: auth.headers,
            timeout: 8000
          }), panelOverride);

          if (res.status === 200 && res.data) {
            const data = res.data;
            if (sp === '/api/admins/current') {
              this.captureAdminMetadata(data);
            }
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
                this.cachedServices = inboundsList;
                return inboundsList;
              }
            }
          }
        } catch (e) {}
      }

      // If cachedServices was populated during login (/api/admins/token), return it immediately!
      if (this.cachedServices.length > 0) {
        return this.cachedServices;
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
          let res = await this.requestWithRetry((auth) => ({
            method: 'GET',
            url: `${auth.baseURL}${prefix}/list`,
            headers: auth.headers,
            timeout: 5000
          }), panelOverride);

          if (res.status !== 200 || !res.data || typeof res.data !== 'object') {
            res = await this.requestWithRetry((auth) => ({
              method: 'GET',
              url: `${auth.baseURL}${prefix}`,
              headers: auth.headers,
              timeout: 5000
            }), panelOverride);
          }

          if (res.status === 200 && res.data && typeof res.data === 'object') {
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

      // 3. Final fallback if panel has configured inboundIds or default service 4 on SolidLayer/GoGuard
      if (panel.inboundIds && Array.isArray(panel.inboundIds) && panel.inboundIds.length > 0) {
        return panel.inboundIds.map((id: any) => ({
          id: Number(id) || id,
          remark: `Service #${id}`,
          name: `Service #${id}`,
          protocol: 'Service',
          enable: true
        }));
      }
      if (panel.inboundId !== undefined && panel.inboundId !== null && String(panel.inboundId) !== '') {
        return [{
          id: Number(panel.inboundId) || panel.inboundId,
          remark: `Service #${panel.inboundId}`,
          name: `Service #${panel.inboundId}`,
          protocol: 'Service',
          enable: true
        }];
      }
      if (urlToUse.includes('solidlayerco.com')) {
        return [{ id: 4, remark: 'Full', name: 'Full', protocol: 'Service', enable: true }];
      }

      return inboundsList;
    } catch (e: any) {
      console.warn('[Panel4] getInbounds note:', e.message);
      if (this.cachedServices.length > 0) return this.cachedServices;
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

    // 2. Fetch available services/inbounds on Panel 4 (never fail hard if empty)
    const inbounds = await this.getInbounds();
    const availableServiceIds = inbounds.map((ib: any) => Number(ib.id) || ib.id);

    let matchedServices: number[] = [];
    if (targetInboundIds && targetInboundIds.length > 0) {
      matchedServices = targetInboundIds
        .map(Number)
        .filter(id => !isNaN(id) && (availableServiceIds.length === 0 || availableServiceIds.some((aid: any) => Number(aid) === id)));
    }
    if (matchedServices.length === 0 && panel.inboundIds && panel.inboundIds.length > 0) {
      matchedServices = panel.inboundIds
        .map(Number)
        .filter((id: number) => !isNaN(id) && (availableServiceIds.length === 0 || availableServiceIds.some((aid: any) => Number(aid) === id)));
    }
    if (matchedServices.length === 0 && panel.inboundId) {
      const pid = Number(panel.inboundId);
      if (!isNaN(pid) && pid > 0) matchedServices = [pid];
    }
    if (matchedServices.length === 0 && inbounds.length > 0) {
      matchedServices = [Number(inbounds[0].id) || 4];
    }
    if (matchedServices.length === 0) {
      matchedServices = [4];
    }

    const uuid = uuidv4();
    const subId = Math.random().toString(36).substring(2, 18);

    // 3. Ensure volume and duration adhere to Panel 4 permissions (seller cannot create unlimited usage/expiry)
    if (!volumeGb || volumeGb <= 0) {
      volumeGb = 10;
    }
    if (!durationDays || durationDays <= 0) {
      durationDays = 30;
    }

    const totalBytes = Math.round(volumeGb * 1024 * 1024 * 1024);
    // In GoGuard / Panel 4: Negative duration = relative "After first use: X days" (on-hold until connect)
    const limitExpireOnHold = -Math.round(durationDays * 86400);
    const expiryTime = Date.now() + Math.round(durationDays * 86400000);

    // 4. Sanitize username: Panel 4 strictly requires lowercase letters, numbers, and underscore (3-30 chars)
    let cleanEmail = this.sanitizeUsername(rawEmail);

    let createdSubUrl = '';
    let addedToAny = false;
    let lastErrorMsg = '';

    // 5. Native Panel 4 Subscriptions API (POST /api/subscriptions) with auto-retry on 401, 409, or validation errors
    const note = sellerGroupName ? String(sellerGroupName).slice(0, 60) : '';

    const attemptCreate = async (uname: string) => {
      const subPayload = {
        username: uname,
        services: matchedServices,
        limit_usage: totalBytes,
        limit_expire: limitExpireOnHold,
        note: note || undefined
      };

      const res = await this.requestWithRetry((auth) => ({
        method: 'POST',
        url: `${auth.baseURL}/api/subscriptions`,
        headers: auth.headers,
        data: subPayload,
        timeout: 12000
      }));

      return { res, payload: subPayload };
    };

    try {
      let { res, payload } = await attemptCreate(cleanEmail);

      // Up to 3 automatic retries if username conflict (409) or username validation issue
      let retries = 0;
      while (
        retries < 3 &&
        (res.status === 409 ||
          (res.data && JSON.stringify(res.data).toLowerCase().includes('already exists')) ||
          (res.status === 400 && res.data && JSON.stringify(res.data).toLowerCase().includes('username')))
      ) {
        retries++;
        const uniqueSuffix = `_${Math.floor(100 + Math.random() * 899)}`;
        const basePart = cleanEmail.replace(/_[0-9]+$/, '').slice(0, 30 - uniqueSuffix.length).replace(/_+$/g, '') || 'user';
        cleanEmail = this.sanitizeUsername(`${basePart}${uniqueSuffix}`);
        const retryAttempt = await attemptCreate(cleanEmail);
        res = retryAttempt.res;
        payload = retryAttempt.payload;
      }

      // If single object rejected with array requirement, retry with array
      if (res.status >= 400 && res.status !== 409) {
        const arrayRes = await this.requestWithRetry((auth) => ({
          method: 'POST',
          url: `${auth.baseURL}/api/subscriptions`,
          headers: auth.headers,
          data: [payload],
          timeout: 12000
        }));
        if (arrayRes.status >= 200 && arrayRes.status < 300) {
          res = arrayRes;
        }
      }

      if (res.status >= 200 && res.status < 300 && res.data) {
        addedToAny = true;
        const dataObj = Array.isArray(res.data) ? res.data[0] : res.data;
        if (dataObj && typeof dataObj === 'object') {
          if (dataObj.username) cleanEmail = String(dataObj.username);
          const link = dataObj.subscription_link || dataObj.subscription_url || dataObj.url || dataObj.link || '';
          if (typeof link === 'string' && link.startsWith('http')) {
            createdSubUrl = link.trim();
          } else if (dataObj.access_key && this.subscriptionPrefix) {
            createdSubUrl = `${this.subscriptionPrefix}/${this.subscriptionTag}/${dataObj.access_key}`;
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

    // 6. Try fetching subscription details directly if created but link was missing in response
    if (addedToAny && !createdSubUrl) {
      try {
        const subLookup = await this.requestWithRetry((auth) => ({
          method: 'GET',
          url: `${auth.baseURL}/api/subscriptions?usernames=${encodeURIComponent(cleanEmail)}`,
          headers: auth.headers,
          timeout: 6000
        }));
        if (subLookup.status === 200 && subLookup.data?.items?.[0]) {
          const item = subLookup.data.items[0];
          if (item.subscription_link && String(item.subscription_link).startsWith('http')) {
            createdSubUrl = String(item.subscription_link).trim();
          } else if (item.access_key && this.subscriptionPrefix) {
            createdSubUrl = `${this.subscriptionPrefix}/${this.subscriptionTag}/${item.access_key}`;
          }
        }
      } catch (e) {}
    }

    // 7. Fallback to 3x-ui / X-UI style addClient if native subscriptions endpoint was not supported
    if (!addedToAny && inbounds.some((ib: any) => ib.protocol !== 'Service')) {
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
          const res = await this.requestWithRetry((auth) => ({
            method: 'POST',
            url: `${auth.baseURL}${prefix}/addClient`,
            headers: auth.headers,
            data: {
              id: targetIb.id,
              settings: JSON.stringify({ clients: [clientPayload] })
            },
            timeout: 8000
          }));

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
        const auth = await this.getAuthOptions();
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
    const safeVolume = volumeGb > 0 ? volumeGb : 10;
    const safeDays = durationDays > 0 ? durationDays : 30;
    const totalBytes = Math.round(safeVolume * 1024 * 1024 * 1024);
    const limitExpireOnHold = -Math.round(safeDays * 86400);

    // Reset & update subscription in Panel 4 / GoGuard with automatic auth retry
    try {
      await this.requestWithRetry((auth) => ({
        method: 'POST',
        url: `${auth.baseURL}/api/subscriptions/reset`,
        headers: auth.headers,
        data: { usernames: [email] }
      }));

      await this.requestWithRetry((auth) => ({
        method: 'PUT',
        url: `${auth.baseURL}/api/subscriptions`,
        headers: auth.headers,
        data: {
          usernames: [email],
          limit_usage: totalBytes,
          limit_expire: limitExpireOnHold,
          enabled: true
        }
      }));
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

        await this.requestWithRetry((auth) => ({
          method: 'POST',
          url: `${auth.baseURL}${prefix}/updateClient/${clientObj.id}`,
          headers: auth.headers,
          data: {
            id: ib.id,
            settings: JSON.stringify({ clients: [clientObj] })
          }
        })).catch(() => null);
      }
    }
  }

  public async updateClientEnable(email: string, enable: boolean): Promise<void> {
    try {
      const actionEp = enable ? '/api/subscriptions/enable' : '/api/subscriptions/disable';
      await this.requestWithRetry((auth) => ({
        method: 'POST',
        url: `${auth.baseURL}${actionEp}`,
        headers: auth.headers,
        data: { usernames: [email] }
      }));

      await this.requestWithRetry((auth) => ({
        method: 'PUT',
        url: `${auth.baseURL}/api/subscriptions`,
        headers: auth.headers,
        data: {
          usernames: [email],
          enabled: enable
        }
      }));
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
        await this.requestWithRetry((auth) => ({
          method: 'POST',
          url: `${auth.baseURL}${prefix}/updateClient/${clientObj.id}`,
          headers: auth.headers,
          data: {
            id: ib.id,
            settings: JSON.stringify({ clients: [clientObj] })
          }
        })).catch(() => null);
      }
    }
  }

  public async delClient(email: string): Promise<void> {
    try {
      await this.requestWithRetry((auth) => ({
        method: 'DELETE',
        url: `${auth.baseURL}/api/subscriptions`,
        headers: auth.headers,
        data: { usernames: [email] }
      }));
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
        await this.requestWithRetry((auth) => ({
          method: 'POST',
          url: `${auth.baseURL}${prefix}/delClient/${clientObj.id}`,
          headers: auth.headers,
          data: { id: ib.id }
        })).catch(() => null);
      }
    }
  }

  public async getAllClientsWithTraffic(): Promise<any[]> {
    try {
      const state = db.getState();
      const panel = state.panel4 || {};
      const urlToUse = panel.url || 'https://app.solidlayerco.com';
      if (!urlToUse || panel.enabled === false) return [];
      if (urlToUse.includes('test-') || urlToUse.includes('example.com')) return [];

      const results: any[] = [];

      // 1. Try Panel 4 native Subscriptions API (/api/subscriptions?page=1&limit=100)
      try {
        let page = 1;
        let total = 0;
        do {
          const res = await this.requestWithRetry((auth) => ({
            method: 'GET',
            url: `${auth.baseURL}/api/subscriptions?page=${page}&limit=100`,
            headers: auth.headers,
            timeout: 8000
          }));

          if (res.status === 200 && res.data && typeof res.data === 'object') {
            const data = res.data;
            total = Number(data.total || 0);
            const items = Array.isArray(data)
              ? data
              : (data.items || data.subscriptions || data.data || data.obj || data.result);

            if (Array.isArray(items) && items.length > 0) {
              for (const sub of items) {
                const username = sub.username || sub.email || sub.id;
                if (!username) continue;

                const totalUsage = Number(sub.total_usage ?? sub.used_traffic ?? 0);
                const resetUsage = Number(sub.reset_usage ?? 0);
                const usedBytes = sub.current_usage !== undefined && sub.current_usage !== null
                  ? Number(sub.current_usage)
                  : Math.max(0, totalUsage - resetUsage);
                const limitBytes = sub.limit_usage !== undefined && sub.limit_usage !== null
                  ? Number(sub.limit_usage)
                  : (Number(sub.data_limit) || Number(sub.total) || 0);
                const rawExp = sub.limit_expire !== undefined && sub.limit_expire !== null ? Number(sub.limit_expire) : 0;

                let expiryTime = 0;
                if (rawExp > 0) {
                  expiryTime = rawExp < 10000000000 ? rawExp * 1000 : rawExp;
                } else if (rawExp < 0) {
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
                  subUrl: sub.subscription_link || sub.subscription_url || (sub.access_key ? `${this.subscriptionPrefix}/${this.subscriptionTag}/${sub.access_key}` : ''),
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
              page++;
            } else {
              break;
            }
          } else {
            break;
          }
        } while (results.length < total && page <= 20);

        if (results.length > 0) return results;
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

      const now = Date.now();
      const onlineList: Panel4OnlineUser[] = [];

      for (const cl of allClients) {
        if (cl.lastOnlineAt) {
          const t = new Date(cl.lastOnlineAt).getTime();
          if (!isNaN(t) && now - t < 180000) {
            onlineList.push({
              email: cl.email,
              lastOnline: new Date(t).toLocaleTimeString('fa-IR', { timeZone: 'Asia/Tehran' })
            });
          }
        }
      }

      // Also check native /api/subscriptions/stats for authoritative total & online count
      let totalUsers = allClients.length;
      let onlineCount = onlineList.length;
      try {
        const statsRes = await this.requestWithRetry((auth) => ({
          method: 'GET',
          url: `${auth.baseURL}/api/subscriptions/stats`,
          headers: auth.headers,
          timeout: 6000
        }));
        if (statsRes.status === 200 && statsRes.data) {
          if (typeof statsRes.data.total === 'number') totalUsers = statsRes.data.total;
          if (typeof statsRes.data.online === 'number' && statsRes.data.online > onlineCount) {
            onlineCount = statsRes.data.online;
          }
        }
      } catch (e) {}

      return {
        onlineCount,
        totalUsers,
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

  /**
   * Native Panel 4 Bulk Actions API (/api/actions/*)
   */
  public async getActionsPreview(serviceId: number = 0): Promise<{ total: number; with_expiry: number; with_service: number; with_usage_limit: number }> {
    const query = serviceId > 0 ? `?service_id=${serviceId}` : '';
    const res = await this.requestWithRetry((auth) => ({
      method: 'GET',
      url: `${auth.baseURL}/api/actions/preview${query}`,
      headers: auth.headers,
      timeout: 8000
    }));
    if (res.status === 200 && res.data) {
      return {
        total: Number(res.data.total || 0),
        with_expiry: Number(res.data.with_expiry || 0),
        with_service: Number(res.data.with_service || 0),
        with_usage_limit: Number(res.data.with_usage_limit || 0)
      };
    }
    throw new Error(res.data?.message || 'خطا در دریافت پیش‌نمایش عملیات همگانی پنل ۴');
  }

  public async bulkModifyExpire(
    days: number,
    action: 'add' | 'remove',
    includeExpired: boolean = false,
    includeOnHold: boolean = false
  ): Promise<{ affected: number; message: string }> {
    const cleanDays = Math.max(1, Math.round(Number(days)));
    const params = new URLSearchParams();
    params.append('days', String(cleanDays));
    if (includeExpired) params.append('include_expired', 'true');
    if (includeOnHold) params.append('include_on_hold', 'true');

    const res = await this.requestWithRetry((auth) => ({
      method: action === 'add' ? 'POST' : 'DELETE',
      url: `${auth.baseURL}/api/actions/expire/${cleanDays}?${params.toString()}`,
      headers: auth.headers,
      timeout: 12000
    }));

    if (res.status >= 200 && res.status < 300 && res.data) {
      return {
        affected: Number(res.data.affected || 0),
        message: res.data.message || `عملیات تغییر زمان (${cleanDays} روز) با موفقیت انجام شد.`
      };
    }
    throw new Error(res.data?.message || `خطا در عملیات همگانی زمان پنل ۴ (کد ${res.status})`);
  }

  public async bulkModifyUsage(
    gb: number,
    action: 'add' | 'remove',
    includeLimited: boolean = false
  ): Promise<{ affected: number; message: string }> {
    const cleanGb = Math.max(1, Math.round(Number(gb)));
    const params = new URLSearchParams();
    params.append('gb', String(cleanGb));
    if (includeLimited) params.append('include_limited', 'true');

    const res = await this.requestWithRetry((auth) => ({
      method: action === 'add' ? 'POST' : 'DELETE',
      url: `${auth.baseURL}/api/actions/usage/${cleanGb}?${params.toString()}`,
      headers: auth.headers,
      timeout: 12000
    }));

    if (res.status >= 200 && res.status < 300 && res.data) {
      return {
        affected: Number(res.data.affected || 0),
        message: res.data.message || `عملیات تغییر حجم (${cleanGb} گیگابایت) با موفقیت انجام شد.`
      };
    }
    throw new Error(res.data?.message || `خطا در عملیات همگانی حجم پنل ۴ (کد ${res.status})`);
  }

  public async bulkModifyService(
    serviceId: number,
    action: 'add' | 'remove' | 'migrate',
    targetServiceId?: number
  ): Promise<{ affected: number; message: string }> {
    const sId = Number(serviceId);
    let path = `/api/actions/services/${sId}`;
    let method: 'POST' | 'DELETE' = 'POST';
    if (action === 'remove') {
      method = 'DELETE';
    } else if (action === 'migrate' && targetServiceId) {
      path = `/api/actions/services/${sId}/migrate/${Number(targetServiceId)}`;
      method = 'POST';
    }

    const res = await this.requestWithRetry((auth) => ({
      method,
      url: `${auth.baseURL}${path}`,
      headers: auth.headers,
      timeout: 12000
    }));

    if (res.status >= 200 && res.status < 300 && res.data) {
      return {
        affected: Number(res.data.affected || 0),
        message: res.data.message || 'عملیات سرویس همگانی با موفقیت انجام شد.'
      };
    }
    throw new Error(res.data?.message || `خطا در عملیات سرویس همگانی پنل ۴ (کد ${res.status})`);
  }
}

export const panel4 = new Panel4Client();
