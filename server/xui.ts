import axios, { AxiosInstance } from 'axios';
import https from 'https';
import { v4 as uuidv4 } from 'uuid';
import { db } from './db.js';
import { rebecca } from './rebecca.js';

class XuiClient {
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
      }), // Ignore self-signed certificates
    });
  }

  private async getAuthOptions(panelOverride?: any) {
    const state = db.getState();
    const panel = panelOverride || state.panel;
    
    // Check which authentication method is configured
    const hasApiKey = panel.apiKey && panel.apiKey.trim() !== '';
    const hasUserPass = (panel.username && panel.username.trim() !== '') && (panel.password && panel.password.trim() !== '');

    if (!panel.url || (!hasApiKey && !hasUserPass)) {
      throw new Error('مشخصات پنل کامل نیست. لطفا آبرس کامل پنل را به همراه «نام کاربری و رمز ورود» و یا «کلید API Key» وارد نمایید.');
    }
    
    // Clear cookie and prefix cache if connection details changed
    if (
      panel.url !== this.lastPanelUrl ||
      panel.username !== this.lastPanelUser ||
      panel.password !== this.lastPanelPass ||
      panel.apiKey !== this.lastPanelApiKey
    ) {
      console.log('[X-UI] Panel connection configurations changed. Cleared cookie session cache.');
      this.cookie = '';
      this.workingApiPrefix = '';
      this.lastPanelUrl = panel.url || '';
      this.lastPanelUser = panel.username || '';
      this.lastPanelPass = panel.password || '';
      this.lastPanelApiKey = panel.apiKey || '';
    }

    // Auto-prepend http:// if no protocol is defined
    let formattedUrl = panel.url.trim().replace(/\s/g, '');
    if (!formattedUrl.startsWith('http://') && !formattedUrl.startsWith('https://')) {
      formattedUrl = 'http://' + formattedUrl;
    }
    
    // Create base URL without trailing slash
    let baseURL = formattedUrl.endsWith('/') ? formattedUrl.slice(0, -1) : formattedUrl;
    
    // Auto-fix common mistakes: user entering URL with /panel or /api at the end
    const commonSuffixes = ['/panel', '/api', '/panel/api'];
    for (const suffix of commonSuffixes) {
        if (baseURL.toLowerCase().endsWith(suffix)) {
            console.log(`[X-UI] Normalizing URL: removed trailing ${suffix} from ${baseURL}`);
            baseURL = baseURL.slice(0, -suffix.length);
        }
    }

    // 1. Prioritize API Key login if provided
    if (hasApiKey) {
      const apiKey = panel.apiKey.trim();
      console.log(`[X-UI] Authenticating using API Key with baseURL: ${baseURL}`);
      return { 
        baseURL, 
        headers: { 
          'Api-Key': apiKey, 
          'X-Api-Key': apiKey, 
          'X-API-KEY': apiKey,
          'api-key': apiKey,
          'Authorization': `Bearer ${apiKey}`, 
          'Accept': 'application/json' 
        } 
      };
    }

    // 2. Fall back to Session Cookie (login) authentication
    if (!this.cookie) {
      console.log(`[X-UI] No session cookie. Trying login credentials at: ${baseURL}`);
      const loginPaths = ['/login', '/panel/login'];
      let loginSuccess = false;
      let lastLoginError = '';

      for (const loginPath of loginPaths) {
        try {
          console.log(`[X-UI Attempt] Login probe: ${baseURL}${loginPath}`);
          
          // Try JSON
          let res = await this.client.post(`${baseURL}${loginPath}`, { 
            username: panel.username, 
            password: panel.password 
          }, { 
            headers: { 'Content-Type': 'application/json' }, 
            validateStatus: () => true 
          });
          
          // Try Form if JSON failed
          if (!res.data?.success) {
            const params = new URLSearchParams();
            params.append('username', panel.username || '');
            params.append('password', panel.password || '');
            res = await this.client.post(`${baseURL}${loginPath}`, params, { 
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, 
              validateStatus: () => true 
            });
          }

          if (res.data?.success) {
            loginSuccess = true;
            // Extract the set-cookie header robustly case-insensitively
            const keys = Object.keys(res.headers);
            const cookieKey = keys.find(k => k.toLowerCase() === 'set-cookie');
            const cookiesHeader = cookieKey ? res.headers[cookieKey] : undefined;
            
            if (cookiesHeader) {
                const cookies = Array.isArray(cookiesHeader) ? cookiesHeader : [cookiesHeader];
                this.cookie = cookies.map(c => c.split(';')[0]).join('; ');
                console.log(`[X-UI Success] Logged in with session cookie via ${loginPath}`);
            } else {
                console.log(`[X-UI Success] Logged in via ${loginPath} but no set-cookie header found.`);
            }
            break;
          }
          lastLoginError = res.data?.msg || 'نام کاربری یا رمز عبور اشتباه است.';
        } catch (e: any) {
          lastLoginError = e.message;
        }
      }

      if (!loginSuccess) {
        throw new Error(lastLoginError || 'خطا در ورود به پنل. لطفا آدرس و مشخصات را بررسی کنید.');
      }
    }
    
    return {
      baseURL,
      headers: {
        'Cookie': this.cookie,
        'Accept': 'application/json, text/plain, */*'
      }
    };
  }

  public getActiveMode(): 'xui' | 'rebecca' | 'both' {
    const state = db.getState();
    if (state.activePanelMode) return state.activePanelMode;
    const hasXui = !!(state.panel?.url && state.panel?.panelType !== 'rebecca');
    const hasRebecca = !!(state.rebeccaPanel?.url || (state.panel?.panelType === 'rebecca' && state.panel?.url));
    if (hasXui && hasRebecca) return 'both';
    if (hasRebecca) return 'rebecca';
    return 'xui';
  }

  public async testConnection(panelOverride?: any) {
    try {
      const state = db.getState();
      const mode = panelOverride?.panelType || state.activePanelMode || (state.panel?.panelType === 'rebecca' ? 'rebecca' : 'xui');

      if (mode === 'both') {
        const xuiConf = panelOverride?.xui || (state.panel?.panelType !== 'rebecca' ? state.panel : {});
        const rebConf = panelOverride?.rebecca || state.rebeccaPanel || (state.panel?.panelType === 'rebecca' ? state.panel : {});

        const [xuiRes, rebRes] = await Promise.allSettled([
          this.testXuiDirect(xuiConf),
          rebecca.testConnection(rebConf)
        ]);

        const xuiResult = xuiRes.status === 'fulfilled' ? xuiRes.value : { success: false, message: (xuiRes as any).reason?.message || 'خطای اتصال به سنایی' };
        const rebResult = rebRes.status === 'fulfilled' ? rebRes.value : { success: false, message: (rebRes as any).reason?.message || 'خطای اتصال به ربکا' };

        const bothSuccess = !!(xuiResult.success && rebResult.success);
        const anySuccess = !!(xuiResult.success || rebResult.success);

        let msg = '';
        if (bothSuccess) {
          msg = `✅ هر دو پنل با موفقیت متصل شدند!\n• سنایی/3X-UI: متصل\n• ربکا: متصل`;
        } else if (anySuccess) {
          msg = `⚠️ وضعیت اتصال پنل‌ها:\n• سنایی/3X-UI: ${xuiResult.success ? 'متصل ✅' : 'خطا ❌ (' + xuiResult.message + ')'}\n• ربکا: ${rebResult.success ? 'متصل ✅' : 'خطا ❌ (' + rebResult.message + ')'}`;
        } else {
          msg = `❌ عدم برقراری ارتباط با پنل‌ها:\n• سنایی: ${xuiResult.message}\n• ربکا: ${rebResult.message}`;
        }

        return {
          success: anySuccess,
          bothSuccess,
          message: msg,
          xui: xuiResult,
          rebecca: rebResult
        };
      }

      if (mode === 'rebecca') {
        return await rebecca.testConnection(panelOverride || state.rebeccaPanel || state.panel);
      }

      return await this.testXuiDirect(panelOverride || state.panel);
    } catch (e: any) {
      console.error('[Panel Test Error]:', e.message);
      return { success: false, message: e.message };
    }
  }

  public async testXuiDirect(panelOverride?: any) {
    try {
      const opts = await this.getAuthOptions(panelOverride);
      const paths = [
        '/panel/api/inbounds/list',
        '/api/inbounds/list',
        '/xui/api/inbounds/list',
        '/panel/inbounds/list'
      ];
      
      let lastError = null;
      for (const path of paths) {
        try {
          console.log(`[X-UI Test] Probing: ${opts.baseURL}${path}`);
          const res = await this.client.get(`${opts.baseURL}${path}`, {
            headers: opts.headers,
            validateStatus: () => true,
            timeout: 5000
          });
          
          if (res.data?.success || (res.status === 200 && Array.isArray(res.data?.obj))) {
            const idx = path.indexOf('/inbounds/list');
            if (idx !== -1) {
              this.workingApiPrefix = path.substring(0, idx);
              console.log(`[X-UI] Connection test successful. Cached working API prefix: ${this.workingApiPrefix}`);
            }
            return { 
              success: true, 
              message: `اتصال پنل سنایی برقرار شد. مسیر معتبر: ${path}`,
              path: path
            };
          }
          lastError = res.data?.msg || `وضعیت ${res.status}`;
        } catch (e: any) {
          lastError = e.message;
        }
      }
      
      return { success: false, message: `پنل در این آدرس شناسایی نشد. آخرین خطا: ${lastError}` };
    } catch (e: any) {
      console.error('[X-UI Test Error]:', e.message);
      return { success: false, message: e.message };
    }
  }

  public async getXuiInboundsDirect(): Promise<any[]> {
    try {
      const state = db.getState();
      const panel = (state.panel?.panelType !== 'rebecca' ? state.panel : {}) || {};
      const hasApiKey = panel.apiKey && panel.apiKey.trim() !== '';
      const hasUserPass = (panel.username && panel.username.trim() !== '') && (panel.password && panel.password.trim() !== '');
      if (!panel.url || (!hasApiKey && !hasUserPass)) {
        return [];
      }

      const opts = await this.getAuthOptions();
      const paths = [
        '/panel/api/inbounds/list',
        '/api/inbounds/list',
        '/xui/api/inbounds/list',
        '/panel/inbounds/list'
      ];
      
      for (const path of paths) {
        try {
          const res = await this.client.get(`${opts.baseURL}${path}`, {
            headers: opts.headers,
            validateStatus: () => true
          });
          if (res.data?.success || (res.status === 200 && Array.isArray(res.data?.obj))) {
            const idx = path.indexOf('/inbounds/list');
            if (idx !== -1) {
              this.workingApiPrefix = path.substring(0, idx);
              console.log(`[X-UI] Successfully fetched inbounds. Cached working API prefix: ${this.workingApiPrefix}`);
            }
            return res.data.obj || [];
          }
        } catch (e) {
          // Continue
        }
      }
      return [];
    } catch (e: any) {
      this.cookie = ''; 
      return [];
    }
  }

  public async getInbounds(): Promise<any[]> {
    try {
      const state = db.getState();
      const mode = this.getActiveMode();

      if (mode === 'rebecca') {
        const rebInbounds = await rebecca.getInbounds();
        return (rebInbounds || []).map((ib: any) => ({
          ...ib,
          panelType: 'rebecca',
          rawId: ib.id,
          remark: ib.remark || ib.tag || ib.id
        }));
      }

      if (mode === 'both') {
        const hasXui = !!(state.panel?.url && state.panel.url.trim() !== '');
        const hasRebecca = !!(state.rebeccaPanel?.url && state.rebeccaPanel.url.trim() !== '');

        const [xuiRes, rebRes] = await Promise.allSettled([
          hasXui ? this.getXuiInboundsDirect() : Promise.resolve([]),
          hasRebecca ? rebecca.getInbounds() : Promise.resolve([])
        ]);

        const list: any[] = [];
        if (xuiRes.status === 'fulfilled' && Array.isArray(xuiRes.value)) {
          for (const ib of xuiRes.value) {
            list.push({
              ...ib,
              panelType: 'xui',
              rawId: ib.id,
              remark: `[سنایی] ${ib.remark || `اینباند ${ib.id}`}`
            });
          }
        }
        if (rebRes.status === 'fulfilled' && Array.isArray(rebRes.value)) {
          for (const ib of rebRes.value) {
            list.push({
              ...ib,
              panelType: 'rebecca',
              rawId: ib.id,
              remark: `[ربکا] ${ib.remark || ib.tag || ib.id}`
            });
          }
        }
        return list;
      }

      // Default: X-UI only
      const xuiInbounds = await this.getXuiInboundsDirect();
      return (xuiInbounds || []).map((ib: any) => ({
        ...ib,
        panelType: 'xui',
        rawId: ib.id
      }));
    } catch (e: any) {
      console.error('[getInbounds Error]:', e.message);
      return [];
    }
  }

  public async delClient(inboundId: number, clientUuid: string) {
    try {
      const state = db.getState();
      if (state.panel?.panelType === 'rebecca') {
        return await rebecca.delClient(clientUuid);
      }

      const opts = await this.getAuthOptions();
      console.log(`[X-UI] Deleting client ${clientUuid} from inbound ${inboundId}`);
      
      const workingPrefix = this.workingApiPrefix || '/panel/api';
      
      // 1. Try using the successful workingPrefix
      let res = await this.client.post(`${opts.baseURL}${workingPrefix}/inbounds/delClient/${clientUuid}`, {}, {
        headers: opts.headers,
        validateStatus: () => true
      });
      
      // 2. Try with workingPrefix and inbound ID
      if (!res.data || !res.data.success) {
        res = await this.client.post(`${opts.baseURL}${workingPrefix}/inbounds/delClient/${inboundId}/${clientUuid}`, {}, {
          headers: opts.headers,
          validateStatus: () => true
        });
      }
      
      // 3. Static fallback: /panel/api/inbounds/delClient/
      if (!res.data || !res.data.success) {
        res = await this.client.post(`${opts.baseURL}/panel/api/inbounds/delClient/${clientUuid}`, {}, {
          headers: opts.headers,
          validateStatus: () => true
        });
      }

      // 4. Static fallback with inbound ID: /panel/api/inbounds/delClient/inboundId/clientUuid
      if (!res.data || !res.data.success) {
        res = await this.client.post(`${opts.baseURL}/panel/api/inbounds/delClient/${inboundId}/${clientUuid}`, {}, {
          headers: opts.headers,
          validateStatus: () => true
        });
      }
      
      console.log(`[X-UI] delClient response:`, JSON.stringify(res.data));
      return res.data?.success || false;
    } catch (e: any) {
      console.error('[X-UI] Failed to delete client:', e.message);
      return false;
    }
  }

  public async delClientByEmail(email: string, panelType?: 'xui' | 'rebecca') {
    try {
      const mode = this.getActiveMode();
      if (panelType === 'rebecca' || (mode === 'rebecca' && panelType !== 'xui')) {
        return await rebecca.delClientByEmail(email);
      }
      if (panelType === 'xui' || (mode === 'xui' && panelType !== 'rebecca')) {
        return await this.delXuiClientByEmailDirect(email);
      }

      // 'both' mode
      let deleted = false;
      try {
        const r1 = await this.delXuiClientByEmailDirect(email);
        if (r1) deleted = true;
      } catch {}
      try {
        const r2 = await rebecca.delClientByEmail(email);
        if (r2) deleted = true;
      } catch {}
      return deleted;
    } catch (e: any) {
      console.error('[delClientByEmail Error]:', e.message);
      return false;
    }
  }

  public async delXuiClientByEmailDirect(email: string) {
    try {
      const opts = await this.getAuthOptions();
      console.log(`[X-UI] Deleting client by email: ${email}`);
      const workingPrefix = this.workingApiPrefix || '/panel/api';
      
      const res = await this.client.post(`${opts.baseURL}${workingPrefix}/clients/del/${email}`, {}, {
        headers: opts.headers,
        validateStatus: () => true
      });
      
      console.log(`[X-UI] delClientByEmail response:`, JSON.stringify(res.data));
      return res.data?.success || false;
    } catch (e: any) {
      console.error('[X-UI] Failed to delete client by email:', e.message);
      return false;
    }
  }

  public async resetClientTraffic(email: string, inboundId?: number | string): Promise<boolean> {
    try {
      const opts = await this.getAuthOptions();
      const workingPrefix = this.workingApiPrefix || '/panel/api';
      const cleanEmail = encodeURIComponent(email.trim());
      const endpoints = [
        `${opts.baseURL}${workingPrefix}/inbounds/resetClientTraffic/${cleanEmail}`,
        `${opts.baseURL}${workingPrefix}/clients/resetClientTraffic/${cleanEmail}`,
        `${opts.baseURL}/panel/api/inbounds/resetClientTraffic/${cleanEmail}`
      ];
      if (inboundId !== undefined && inboundId !== null) {
        endpoints.push(`${opts.baseURL}${workingPrefix}/inbounds/${inboundId}/resetClientTraffic/${cleanEmail}`);
        endpoints.push(`${opts.baseURL}/panel/api/inbounds/${inboundId}/resetClientTraffic/${cleanEmail}`);
      }
      for (const ep of endpoints) {
        try {
          const res = await this.client.post(ep, {}, { headers: opts.headers, validateStatus: () => true, timeout: 5000 });
          if (res.data?.success || res.status === 200) {
            console.log(`[X-UI] Successfully reset client traffic for ${email}`);
            return true;
          }
        } catch {}
      }
    } catch (e: any) {
      console.warn(`[X-UI] resetClientTraffic warning for ${email}:`, e.message);
    }
    return false;
  }

  public buildXuiSubUrl(subId: string, panelOverride?: any): string {
    if (!subId) return '';
    const state = db.getState();
    const panelConfig = panelOverride || (state.panel?.panelType !== 'rebecca' ? state.panel : {}) || {};
    const subBase = (panelConfig.subUrlBase || '').trim();

    // Clean subId so it never has leading slashes or redundant sub/ prefix
    let cleanSubId = String(subId).trim().replace(/^\/+/, '');
    if (cleanSubId.startsWith('sub/')) {
      cleanSubId = cleanSubId.slice(4);
    }

    if (subBase && subBase.startsWith('http')) {
      const baseClean = subBase.replace(/\/+$/, '');
      if (baseClean.endsWith('/sub')) {
        return `${baseClean}/${cleanSubId}`;
      } else if (baseClean.includes('/sub/')) {
        return `${baseClean}/${cleanSubId}`;
      } else {
        return `${baseClean}/sub/${cleanSubId}`;
      }
    }

    if (!panelConfig.url) return '';
    try {
      const parsed = new URL(panelConfig.url);
      return `${parsed.origin}/sub/${cleanSubId}`;
    } catch {
      const cleanUrl = panelConfig.url.replace(/\/+$/, '').replace(/\/panel.*$/, '');
      return `${cleanUrl}/sub/${cleanSubId}`;
    }
  }

  public async getClient(idOrEmail: string, preferredPanel?: 'xui' | 'rebecca'): Promise<any | null> {
    if (!idOrEmail) return null;
    const cleanId = String(idOrEmail).trim();

    // 1. If preferredPanel is rebecca, query Rebecca first
    if (preferredPanel === 'rebecca') {
      try {
        const reb = await rebecca.getClient(cleanId);
        if (reb) return reb;
      } catch {}
    }

    // 2. Query unified client list with forceBoth
    const all = await this.getAllClientsWithTraffic(true);
    const cleanLower = cleanId.toLowerCase();
    const found = all.find(c => 
      (c.id && c.id.toLowerCase() === cleanLower) ||
      (c.email && c.email.toLowerCase() === cleanLower) ||
      (c.subId && c.subId.toLowerCase() === cleanLower)
    );
    if (found) return found;

    // 3. Fallback: try Rebecca directly if not tried yet
    if (preferredPanel !== 'rebecca') {
      try {
        const reb = await rebecca.getClient(cleanId);
        if (reb) return reb;
      } catch {}
    }

    return null;
  }

  public async getAllClientsWithTraffic(forceBoth: boolean = false): Promise<Array<{
    id: string;
    email: string;
    subId?: string;
    up: number;
    down: number;
    totalUsed: number;
    total: number;
    expiryTime: number;
    enable: boolean;
    inboundIds?: number[];
    subUrl?: string;
    links?: string[];
    panelType?: 'xui' | 'rebecca';
  }>> {
    try {
      const mode = this.getActiveMode();
      const state = db.getState();
      const hasXui = !!(state.panel?.url && state.panel?.panelType !== 'rebecca');
      const hasRebecca = !!(state.rebeccaPanel?.url || (state.panel?.panelType === 'rebecca' && state.panel?.url));

      if (forceBoth || mode === 'both' || (hasXui && hasRebecca)) {
        const [xuiRes, rebRes] = await Promise.allSettled([
          hasXui ? this.getXuiAllClientsWithTrafficDirect() : Promise.resolve([]),
          hasRebecca ? rebecca.getAllClientsWithTraffic() : Promise.resolve([])
        ]);

        const list: any[] = [];
        if (xuiRes.status === 'fulfilled' && Array.isArray(xuiRes.value)) {
          for (const c of xuiRes.value) {
            list.push({ ...c, panelType: 'xui' as const });
          }
        }
        if (rebRes.status === 'fulfilled' && Array.isArray(rebRes.value)) {
          for (const c of rebRes.value) {
            list.push({ ...c, panelType: 'rebecca' as const });
          }
        }
        return list;
      }

      if (mode === 'rebecca') {
        const rebClients = await rebecca.getAllClientsWithTraffic();
        return rebClients.map(c => ({ ...c, panelType: 'rebecca' as const }));
      }

      const xuiClients = await this.getXuiAllClientsWithTrafficDirect();
      return xuiClients.map(c => ({ ...c, panelType: 'xui' as const }));
    } catch (err: any) {
      console.error('[getAllClientsWithTraffic Error]:', err.message);
      return [];
    }
  }

  public async getXuiAllClientsWithTrafficDirect(): Promise<Array<{
    id: string;
    email: string;
    subId?: string;
    up: number;
    down: number;
    totalUsed: number;
    total: number;
    expiryTime: number;
    enable: boolean;
    inboundIds?: number[];
    subUrl?: string;
    links?: string[];
  }>> {
    try {
      const inboundsList = await this.getXuiInboundsDirect();
      if (!inboundsList || !Array.isArray(inboundsList) || inboundsList.length === 0) {
        return [];
      }

      const clientsMap = new Map<string, {
        id: string;
        email: string;
        subId?: string;
        up: number;
        down: number;
        totalUsed: number;
        total: number;
        expiryTime: number;
        enable: boolean;
        inboundIds: number[];
      }>();

      for (const ib of inboundsList) {
        const ibId = Number(ib.id);
        
        // 1. Extract settings clients
        let settingsClients: any[] = [];
        if (ib.settings) {
          try {
            const parsed = typeof ib.settings === 'string' ? JSON.parse(ib.settings) : ib.settings;
            if (parsed && Array.isArray(parsed.clients)) {
              settingsClients = parsed.clients;
            }
          } catch (e) {}
        }

        // 2. Extract clientStats
        const clientStats: any[] = Array.isArray(ib.clientStats) 
          ? ib.clientStats 
          : (Array.isArray(ib.client_stats) 
            ? ib.client_stats 
            : (Array.isArray(ib.clientsStats) 
              ? ib.clientsStats 
              : (Array.isArray(ib.stat) ? ib.stat : [])));

        // Process settingsClients
        for (const sc of settingsClients) {
          const email = String(sc.email || sc.id || '');
          const id = String(sc.id || sc.password || email);
          const subId = String(sc.subId || '');
          const key = (email || id).toLowerCase().trim();
          if (!key) continue;

          // Find matching stat in clientStats
          const stat = clientStats.find((s: any) => 
            (s.email && String(s.email).toLowerCase().trim() === email.toLowerCase().trim()) ||
            (s.id && String(s.id) === id) ||
            (s.clientId && String(s.clientId) === id)
          );

          const up = Number((stat && stat.up !== undefined) ? stat.up : (sc.up || 0)) || 0;
          const down = Number((stat && stat.down !== undefined) ? stat.down : (sc.down || 0)) || 0;
          const total = Number((stat && stat.total !== undefined) ? stat.total : (sc.total || (sc.totalGB ? sc.totalGB * 1024 * 1024 * 1024 : 0))) || 0;
          const expiryTime = Number((stat && stat.expiryTime !== undefined) ? stat.expiryTime : (sc.expiryTime || 0)) || 0;
          const isEnabled = (stat && stat.enable !== undefined) ? !!stat.enable : (sc.enable !== undefined ? !!sc.enable : true);

          if (clientsMap.has(key)) {
            const existing = clientsMap.get(key)!;
            existing.up += up;
            existing.down += down;
            existing.totalUsed = existing.up + existing.down;
            if (!existing.subId && subId) existing.subId = subId;
            if (total > existing.total) existing.total = total;
            if (expiryTime > existing.expiryTime) existing.expiryTime = expiryTime;
            if (!isEnabled) existing.enable = false;
            if (!existing.inboundIds.includes(ibId)) existing.inboundIds.push(ibId);
          } else {
            clientsMap.set(key, {
              id,
              email,
              subId,
              up,
              down,
              totalUsed: up + down,
              total,
              expiryTime,
              enable: isEnabled,
              inboundIds: [ibId]
            });
          }
        }

        // Also process any clientStats not present in settingsClients
        for (const cs of clientStats) {
          const email = String(cs.email || cs.id || '');
          const id = String(cs.clientId || cs.id || email);
          const key = (email || id).toLowerCase().trim();
          if (!key) continue;

          if (!clientsMap.has(key)) {
            const up = Number(cs.up || 0);
            const down = Number(cs.down || 0);
            const total = Number(cs.total || 0);
            const expiryTime = Number(cs.expiryTime || 0);
            const isEnabled = cs.enable !== false;

            clientsMap.set(key, {
              id,
              email,
              subId: '',
              up,
              down,
              totalUsed: up + down,
              total,
              expiryTime,
              enable: isEnabled,
              inboundIds: [ibId]
            });
          }
        }
      }

      return Array.from(clientsMap.values());
    } catch (e: any) {
      console.error('[X-UI] Failed to get clients with traffic:', e.message);
      return [];
    }
  }

  public async updateClientEnable(email: string, enable: boolean, panelType?: 'xui' | 'rebecca') {
    try {
      const mode = this.getActiveMode();
      if (panelType === 'rebecca' || (mode === 'rebecca' && panelType !== 'xui')) {
        return await rebecca.updateClientEnable(email, enable);
      }
      if (panelType === 'xui' || (mode === 'xui' && panelType !== 'rebecca')) {
        return await this.updateXuiClientEnableDirect(email, enable);
      }

      let updated = false;
      try {
        const r1 = await this.updateXuiClientEnableDirect(email, enable);
        if (r1) updated = true;
      } catch {}
      try {
        const r2 = await rebecca.updateClientEnable(email, enable);
        if (r2) updated = true;
      } catch {}
      return updated;
    } catch (e: any) {
      console.error('[updateClientEnable Error]', e.message);
      return false;
    }
  }

  public async updateXuiClientEnableDirect(email: string, enable: boolean) {
    try {
      const opts = await this.getAuthOptions();
      const inboundsList = await this.getXuiInboundsDirect();
      if (!inboundsList || !Array.isArray(inboundsList) || inboundsList.length === 0) return false;

      let successCount = 0;
      const cleanIdent = String(email || '').toLowerCase().trim();
      if (!cleanIdent) return false;

      const workingPrefix = this.workingApiPrefix || '/panel/api';

      for (const ib of inboundsList) {
        if (!ib.settings) continue;
        let parsed: any;
        try {
          parsed = typeof ib.settings === 'string' ? JSON.parse(ib.settings) : ib.settings;
        } catch (e) {
          continue;
        }
        if (!parsed || !Array.isArray(parsed.clients)) continue;

        const targetClient = parsed.clients.find((c: any) => 
          (c.email && String(c.email).toLowerCase().trim() === cleanIdent) ||
          (c.id && String(c.id).toLowerCase().trim() === cleanIdent) ||
          (c.subId && cleanIdent.includes(String(c.subId).toLowerCase().trim()))
        );

        if (targetClient) {
          const uuid = targetClient.id || targetClient.password;
          targetClient.enable = enable;

          const payload = {
            id: ib.id,
            settings: JSON.stringify({ clients: [targetClient] })
          };

          const paths = [
            `${workingPrefix}/inbounds/updateClient/${uuid}`,
            `${workingPrefix}/inbounds/updateclient/${uuid}`,
            `/panel/api/inbounds/updateClient/${uuid}`,
            `/api/inbounds/updateClient/${uuid}`,
            `${workingPrefix}/clients/update/${uuid}`
          ];

          let updatedForThisInbound = false;
          for (const p of paths) {
            try {
              const res = await this.client.post(`${opts.baseURL}${p}`, payload, {
                headers: { ...opts.headers, 'Content-Type': 'application/json' },
                validateStatus: () => true,
                timeout: 6000
              });
              if (res.data && res.data.success) {
                updatedForThisInbound = true;
                break;
              }
            } catch (e) {}
          }

          if (updatedForThisInbound) {
            successCount++;
          }
        }
      }

      console.log(`[X-UI] updateClientEnable for ${email} -> enable: ${enable}, updated ${successCount} inbounds`);
      return successCount > 0;
    } catch (e: any) {
      console.error('[X-UI] Error update client enable', e.message);
      return false;
    }
  }

  public async renewClient(email: string, volumeGb: number, durationDays: number, panelType?: 'xui' | 'rebecca') {
    try {
      const mode = this.getActiveMode();
      if (panelType === 'rebecca' || (mode === 'rebecca' && panelType !== 'xui')) {
        return await rebecca.renewClient(email, volumeGb, durationDays);
      }
      if (panelType === 'xui' || (mode === 'xui' && panelType !== 'rebecca')) {
        return await this.renewXuiClientDirect(email, volumeGb, durationDays);
      }

      try {
        const res = await this.renewXuiClientDirect(email, volumeGb, durationDays);
        if (res) return res;
      } catch {
        // Fallback to rebecca
      }
      return await rebecca.renewClient(email, volumeGb, durationDays);
    } catch (e: any) {
      console.error('[renewClient Error]', e.message);
      throw e;
    }
  }

  public async renewXuiClientDirect(email: string, volumeGb: number, durationDays: number) {
    try {
      const state = db.getState();
      const opts = await this.getAuthOptions();
      const inboundsList = await this.getXuiInboundsDirect();
      
      let targetClient: any = null;
      let targetInboundIds: number[] = [];
      let originalLimitIp = 0;
      let originalTelegramId = "";
      let originalGroup = "";
      
      for (const inbound of inboundsList) {
        if (inbound.settings) {
          const parsed = typeof inbound.settings === 'string' ? JSON.parse(inbound.settings) : inbound.settings;
          if (parsed && parsed.clients) {
            const found = parsed.clients.find((c: any) => c.email === email);
            if (found) {
              if (!targetClient) targetClient = found;
              targetInboundIds.push(inbound.id);
              if (found.limitIp) originalLimitIp = found.limitIp;
              if (found.tgId) originalTelegramId = found.tgId;
              if (found.group) originalGroup = found.group;
            }
          }
        }
      }
      
      if (!targetClient) {
        throw new Error(`کاربری با ایمیل ${email} در پنل سنایی یافت نشد.`);
      }

      console.log(`[X-UI] Renewing client ${email}. Deleting existing...`);
      // Delete old client first
      await this.delXuiClientByEmailDirect(email);
      for (const ibId of targetInboundIds) {
        await this.delClient(ibId, targetClient.id || targetClient.password);
      }
      
      // Calculate new props
      const expiryTime = durationDays > 0 ? Date.now() + durationDays * 24 * 60 * 60 * 1000 : 0;
      const totalBytes = volumeGb > 0 ? Math.floor(volumeGb * 1024 * 1024 * 1024) : 0;
      
      const clientId = targetClient.id || targetClient.password;
      const subId = targetClient.subId || uuidv4().replace(/-/g, '').substring(0, 16);

      // Reconstruct Multi-Inbound Tags from targetInboundIds if needed
      const otherTags: string[] = [];
      if (targetInboundIds.length > 1 && inboundsList.length > 0) {
        targetInboundIds.slice(1).forEach(id => {
          const found = inboundsList.find(ib => Number(ib.id) === Number(id));
          if (found && found.remark) {
            otherTags.push(found.remark);
          }
        });
      }

      const clientObj: any = {
        id: clientId,
        password: clientId,
        email: email,
        enable: true,
        expiryTime: expiryTime,
        total: totalBytes,
        totalGB: totalBytes,
        limitIp: Number(originalLimitIp) || 0,
        flow: targetClient.flow || "",
        tgId: originalTelegramId || "",
        subId: subId,
        group: originalGroup || ""
      };

      if (otherTags.length > 0) {
        clientObj.inboundTags = otherTags;
      }

      const settings = {
        clients: [clientObj]
      };

      let isSuccess = false;
      let lastError = null;
      let lastResponse = null;
      let non404Response = null;
      const primaryInboundId = targetInboundIds[0];
      const workingPrefix = this.workingApiPrefix || '/panel/api';

      try {
        const url = `${opts.baseURL}${workingPrefix}/inbounds/addClient`;
        let res = await this.client.post(url, { id: Number(primaryInboundId), settings: JSON.stringify(settings) }, {
             headers: { ...opts.headers, 'Content-Type': 'application/json' },
             validateStatus: () => true
        });
        lastResponse = res;
        if (res?.status && res.status !== 404) non404Response = res;
        if (res?.data?.success) isSuccess = true;

        if (!isSuccess) {
           res = await this.client.post(url, { id: Number(primaryInboundId), settings: settings }, {
               headers: { ...opts.headers, 'Content-Type': 'application/json' },
               validateStatus: () => true
           });
           lastResponse = res;
           if (res?.status && res.status !== 404) non404Response = res;
           if (res?.data?.success) isSuccess = true;
        }
      } catch (err: any) { lastError = err; }
      
      // Legacy URL fallbacks if needed...
      if (!isSuccess) {
         const possibleUrls = [
           `${opts.baseURL}/panel/api/inbounds/addClient`,
           `${opts.baseURL}/api/inbounds/addClient`,
           `${opts.baseURL}/panel/inbounds/addclient`
         ];
         for (const url of possibleUrls) {
           try {
             let res = await this.client.post(url, { id: Number(primaryInboundId), settings: JSON.stringify(settings) }, {
               headers: { ...opts.headers, 'Content-Type': 'application/json' },
               validateStatus: () => true
             });
             lastResponse = res;
             if (res?.status && res.status !== 404) non404Response = res;
             if (res?.data?.success) { isSuccess = true; break; }
             
             res = await this.client.post(url, { id: Number(primaryInboundId), settings: settings }, {
               headers: { ...opts.headers, 'Content-Type': 'application/json' },
               validateStatus: () => true
             });
             lastResponse = res;
             if (res?.status && res.status !== 404) non404Response = res;
             if (res?.data?.success) { isSuccess = true; break; }
           } catch(e:any) { lastError = e; }
         }
      }

      if (!isSuccess) {
        const responseToUse = non404Response || lastResponse;
        let errorMsg = responseToUse?.data?.msg || lastError?.message || 'پنل پاسخ ناموفق در ثبت مجدد مشتری بازگرداند.';
        throw new Error(errorMsg);
      }

      const subUrlStr = this.buildXuiSubUrl(subId);

      return {
        subUrl: subUrlStr,
        email: email,
        id: clientId,
        panelType: 'xui' as const
      };
    } catch (e: any) {
      console.error('[X-UI] renewClient Error:', e.message);
      throw e;
    }
  }

  public selfHealProductsAndInbounds(inboundsList: any[]) {
    if (!inboundsList || inboundsList.length === 0) return;
    try {
      const state = db.getState();
      
      const isTargetValid = (target: any) => {
        if (target === undefined || target === null || target === '') return false;
        const targetStr = String(target).trim().toLowerCase();
        // In dual-panel mode or for Rebecca inbounds, preserve string/tag IDs
        if (targetStr.startsWith('reb_') || (isNaN(Number(target)) && isNaN(Number(targetStr)))) {
          return true;
        }
        const targetNum = Number(target);
        return inboundsList.some(ib => (
          (!isNaN(targetNum) && Number(ib.id) === targetNum) ||
          (ib.remark && String(ib.remark).trim().toLowerCase() === targetStr) ||
          (ib.tag && String(ib.tag).trim().toLowerCase() === targetStr) ||
          (ib.port && String(ib.port).trim() === targetStr)
        ));
      };

      let stateChanged = false;

      // 1. Clean products
      const updatedProducts = (state.products || []).map(product => {
        let inboundIdsChanged = false;
        let validInboundIds: (string | number)[] = [];

        if (Array.isArray(product.inboundIds) && product.inboundIds.length > 0) {
          validInboundIds = product.inboundIds.filter(id => {
            if (isTargetValid(id)) {
              return true;
            } else {
              inboundIdsChanged = true;
              return false;
            }
          });
        }

        let updatedProduct = { ...product };

        if (product.inboundId) {
          if (!isTargetValid(product.inboundId)) {
            inboundIdsChanged = true;
            delete updatedProduct.inboundId;
          }
        }

        if (validInboundIds.length === 0 && !updatedProduct.inboundId) {
          const fallbackInboundId = inboundsList[0].id;
          validInboundIds = [fallbackInboundId];
          inboundIdsChanged = true;
          console.log(`[Self-Heal] Product "${product.name}" had all configured inbounds deleted. Falling back to inbound ID: ${fallbackInboundId}`);
        }

        if (inboundIdsChanged) {
          stateChanged = true;
          return {
            ...updatedProduct,
            inboundIds: validInboundIds
          };
        }
        return product;
      });

      // 2. Clean free test config
      let validFreeTestInboundIds: (string | number)[] = [];
      let freeTestChanged = false;

      if (Array.isArray(state.freeTestInboundIds) && state.freeTestInboundIds.length > 0) {
        validFreeTestInboundIds = state.freeTestInboundIds.filter(id => {
          if (isTargetValid(id)) {
            return true;
          } else {
            freeTestChanged = true;
            return false;
          }
        });
      }

      let validFreeTestInboundId = state.freeTestInboundId;
      if (state.freeTestInboundId && !isTargetValid(state.freeTestInboundId)) {
        validFreeTestInboundId = undefined;
        freeTestChanged = true;
      }

      if (validFreeTestInboundIds.length === 0 && !validFreeTestInboundId) {
        const fallbackInboundId = inboundsList[0].id;
        validFreeTestInboundIds = [fallbackInboundId];
        freeTestChanged = true;
        console.log(`[Self-Heal] Free test had all configured inbounds deleted. Falling back to inbound ID: ${fallbackInboundId}`);
      }

      // 3. Clean default panel settings
      let panelInboundIdsChanged = false;
      let validPanelInboundIds: (string | number)[] = [];
      let validPanelInboundId = state.panel ? state.panel.inboundId : undefined;

      if (state.panel) {
        if (Array.isArray(state.panel.inboundIds) && state.panel.inboundIds.length > 0) {
          validPanelInboundIds = state.panel.inboundIds.filter(id => {
            if (isTargetValid(id)) {
              return true;
            } else {
              panelInboundIdsChanged = true;
              return false;
            }
          });
        }

        if (state.panel.inboundId && !isTargetValid(state.panel.inboundId)) {
          validPanelInboundId = undefined;
          panelInboundIdsChanged = true;
        }

        if (validPanelInboundIds.length === 0 && !validPanelInboundId) {
          const fallbackInboundId = inboundsList[0].id;
          validPanelInboundIds = [fallbackInboundId];
          panelInboundIdsChanged = true;
          console.log(`[Self-Heal] Panel settings had all configured inbounds deleted. Falling back to inbound ID: ${fallbackInboundId}`);
        }
      }

      if (stateChanged || freeTestChanged || panelInboundIdsChanged) {
        const updatedPanel = state.panel ? {
          ...state.panel,
          inboundIds: validPanelInboundIds,
          inboundId: validPanelInboundId
        } : undefined;

        db.updateState({
          products: updatedProducts,
          freeTestInboundIds: validFreeTestInboundIds,
          freeTestInboundId: validFreeTestInboundId,
          panel: updatedPanel
        });
        console.log('[Self-Heal] Successfully synchronized database state to remove deleted inbounds.');
      }
    } catch (err: any) {
      console.error('[Self-Heal Error] Failed to execute self healing:', err.message);
    }
  }

  public async addClient(
    email: string, 
    volumeGb: number, 
    durationDays: number, 
    targetInboundIds?: string | number | (string | number)[], 
    limitIp: number = 0, 
    telegramId?: string, 
    group?: string,
    preferredPanelType?: 'xui' | 'rebecca'
  ) {
    const state = db.getState();
    const mode = this.getActiveMode();

    let targetPanel: 'xui' | 'rebecca' = 'xui';
    if (preferredPanelType === 'rebecca') {
      targetPanel = 'rebecca';
    } else if (preferredPanelType === 'xui') {
      targetPanel = 'xui';
    } else if (mode === 'rebecca') {
      targetPanel = 'rebecca';
    } else if (mode === 'both') {
      const rawTargets = Array.isArray(targetInboundIds) ? targetInboundIds : (targetInboundIds !== undefined ? [targetInboundIds] : []);
      const hasRebTag = rawTargets.some(t => typeof t === 'string' && (t.startsWith('reb_') || isNaN(Number(t))));
      if (hasRebTag) {
        targetPanel = 'rebecca';
      } else {
        targetPanel = (state.panel?.url ? 'xui' : (state.rebeccaPanel?.url ? 'rebecca' : 'xui'));
      }
    }

    if (targetPanel === 'rebecca') {
      let cleanTargets = targetInboundIds;
      if (Array.isArray(targetInboundIds)) {
        cleanTargets = targetInboundIds.map(t => typeof t === 'string' && t.startsWith('reb_') ? t.replace('reb_', '') : t);
      } else if (typeof targetInboundIds === 'string' && targetInboundIds.startsWith('reb_')) {
        cleanTargets = targetInboundIds.replace('reb_', '');
      }
      const res = await rebecca.addClient(email, volumeGb, durationDays, cleanTargets, limitIp, telegramId, group);
      return { ...res, panelType: 'rebecca' as const };
    }

    const res = await this.addXuiClientDirect(email, volumeGb, durationDays, targetInboundIds, limitIp, telegramId, group);
    return { ...res, panelType: 'xui' as const };
  }

  public async addXuiClientDirect(email: string, volumeGb: number, durationDays: number, targetInboundIds?: string | number | (string | number)[], limitIp: number = 0, telegramId?: string, group?: string) {
    const state = db.getState();
    let rawTargets: (string | number)[] = [];

    if (Array.isArray(targetInboundIds) && targetInboundIds.length > 0) {
      rawTargets = targetInboundIds;
      console.log(`[X-UI] Target Inbound IDs requested: ${JSON.stringify(rawTargets)}`);
    } else if (targetInboundIds !== undefined && targetInboundIds !== null && targetInboundIds !== '') {
      rawTargets = [targetInboundIds as any];
    } else {
      // Fallback to saved panel state inbounds
      if (state.panel.inboundIds && state.panel.inboundIds.length > 0) {
        rawTargets = state.panel.inboundIds;
      } else if (state.panel.inboundId) {
        rawTargets = [state.panel.inboundId];
      }
    }

    if (rawTargets.length === 0) {
      throw new Error('هیچ شناسه، نام، یا پورتی برای اینباند (Inbound ID) تعریف نشده است. لطفا در محصولات یا تنظیمات پنل چک نمایید.');
    }

    try {
      const opts = await this.getAuthOptions();
      
      // Fetch live inbounds from the panel to resolve tags, remarks, and ports dynamically
      const inboundsList: any[] = await this.getXuiInboundsDirect() || [];
      
      // Perform self-healing on database state for deleted inbounds
      if (inboundsList.length > 0) {
        this.selfHealProductsAndInbounds(inboundsList);
      }

      let resolvedInboundIds: number[] = [];

      for (const target of rawTargets) {
        if (target === undefined || target === null || target === '') continue;
        
        const targetStr = String(target).trim().toLowerCase();
        const targetNum = Number(target);

        // Let's search inside the live inbounds list for a robust match (by ID, Remark/Name, Tag, or Port)
        let matchedInbound = inboundsList.find(ib => {
          return (
            (!isNaN(targetNum) && Number(ib.id) === targetNum) ||
            (ib.remark && String(ib.remark).trim().toLowerCase() === targetStr) ||
            (ib.tag && String(ib.tag).trim().toLowerCase() === targetStr) ||
            (ib.port && String(ib.port).trim() === targetStr)
          );
        });

        if (matchedInbound) {
          resolvedInboundIds.push(Number(matchedInbound.id));
        }
      }

      // De-duplicate resolved IDs
      resolvedInboundIds = Array.from(new Set(resolvedInboundIds));

      if (resolvedInboundIds.length === 0) {
        if (inboundsList.length > 0) {
          const fallbackId = Number(inboundsList[0].id);
          resolvedInboundIds.push(fallbackId);
          console.log(`[X-UI] Fallback to first active inbound ID: ${fallbackId} as all requested inbounds were deleted/invalid.`);
        } else {
          throw new Error('هیچ اینباند فعالی در پنل شما پیدا نشد. لطفا حداقل یک اینباند در پنل ایجاد کنید.');
        }
      }

      const primaryInboundId = resolvedInboundIds[0];
      const finalInboundIds = resolvedInboundIds;

      // 1. Scan and delete existing client with the same email in ALL discovered inbounds to prevent duplication
      if (inboundsList && inboundsList.length > 0) {
        try {
          for (const inbound of inboundsList) {
            if (inbound.settings) {
              const parsedSettings = typeof inbound.settings === 'string' ? JSON.parse(inbound.settings) : inbound.settings;
              if (parsedSettings && parsedSettings.clients) {
                const found = parsedSettings.clients.find((c: any) => c.email === email);
                if (found) {
                  console.log(`[X-UI] Found existing client "${email}" in inbound ${inbound.id}. Deleting...`);
                  const delEmailSuccess = await this.delClientByEmail(email);
                  if (!delEmailSuccess) {
                    await this.delClient(inbound.id, found.id || found.password);
                  }
                }
              }
            }
          }
        } catch (scanErr: any) {
          console.error('[X-UI Error] Error scanning duplicates:', scanErr.message);
        }
      }

      // Calculate common properties
      const expiryTime = durationDays > 0 ? Date.now() + durationDays * 24 * 60 * 60 * 1000 : 0;
      const totalBytes = volumeGb > 0 ? Math.floor(volumeGb * 1024 * 1024 * 1024) : 0;
      const clientId = uuidv4();
      const subId = uuidv4().replace(/-/g, '').substring(0, 16);

      // Multi-Inbound Tags Support (for newer MHSanaei 3x-ui versions)
      const otherTags: string[] = [];
      if (finalInboundIds.length > 1 && inboundsList.length > 0) {
        finalInboundIds.slice(1).forEach(id => {
          const found = inboundsList.find(ib => Number(ib.id) === Number(id));
          if (found && found.remark) {
            otherTags.push(found.remark);
          }
        });
      }

      const clientObj: any = {
        id: clientId,
        password: clientId,
        email: email,
        enable: true,
        expiryTime: expiryTime,
        total: totalBytes,
        totalGB: totalBytes,
        limitIp: Number(limitIp) || 0,
        flow: "",
        tgId: telegramId || "",
        subId: subId,
        group: group || ""
      };

      // Add "Attached inbounds" tags using specifically 'inboundTags' field
      if (otherTags.length > 0) {
        console.log(`[X-UI Debug] Attaching extra inbounds by tags: ${JSON.stringify(otherTags)}`);
        clientObj.inboundTags = otherTags;
      }

      const settings = {
        clients: [clientObj]
      };

      console.log(`[X-UI Debug] Final Primary Inbound ID: ${primaryInboundId}`);
      console.log(`[X-UI Debug] Payload being sent:`, JSON.stringify(settings));
      
      const workingPrefix = this.workingApiPrefix || '/panel/api';
      
      let lastResponse: any = null;
      let non404Response: any = null;
      let lastError: any = null;
      let isSuccess = false;

      // First priority: Try modern client-based endpoint
      try {
        console.log(`[X-UI Attempt] Modern Client-based add probe: ${opts.baseURL}${workingPrefix}/clients/add`);
        const clientPayload = {
          client: {
            id: clientId,
            password: clientId,
            uuid: clientId,
            email: email,
            enable: true,
            expiryTime: expiryTime,
            total: totalBytes,
            totalGB: totalBytes,
            limitIp: Number(limitIp) || 0,
            flow: "",
            tgId: telegramId ? (Number(telegramId) || 0) : 0, // must be integer / number (int64 in Go)
            subId: subId,
            group: group || ""
          },
          inboundIds: finalInboundIds
        };

        const res = await this.client.post(`${opts.baseURL}${workingPrefix}/clients/add`, clientPayload, {
          headers: { ...opts.headers, 'Content-Type': 'application/json' },
          validateStatus: () => true,
          timeout: 10000
        });

        lastResponse = res;
        if (res?.status && res.status !== 404) {
          non404Response = res;
        }
        if (res?.data?.success) {
          isSuccess = true;
          console.log(`[X-UI Success] Created client via modern clients/add`);
        }
      } catch (err: any) {
        lastError = err;
        console.warn('[X-UI Warn] Modern clients/add endpoint failed, falling back. error:', err.message);
      }

      // Second priority: Try legacy inbound-based endpoints
      if (!isSuccess) {
        const possibleUrls = [
          // 1. Dynamic endpoints matching the verified successful prefix of this panel
          `${opts.baseURL}${workingPrefix}/inbounds/addClient`,
          `${opts.baseURL}${workingPrefix}/inbounds/addclient`,
          `${opts.baseURL}${workingPrefix}/inbound/addClient`,
          `${opts.baseURL}${workingPrefix}/inbound/addclient`,
          `${opts.baseURL}${workingPrefix}/inbounds/client/add`,
          `${opts.baseURL}${workingPrefix}/inbound/client/add`,
          `${opts.baseURL}${workingPrefix}/client/add`,

          // 2. Standard static fallback endpoints
          `${opts.baseURL}/panel/api/inbounds/addClient`,
          `${opts.baseURL}/panel/api/inbounds/addclient`,
          `${opts.baseURL}/api/inbounds/addClient`,
          `${opts.baseURL}/api/inbounds/addclient`,
          `${opts.baseURL}/panel/api/inbounds/client/add`,
          `${opts.baseURL}/api/inbounds/client/add`,
          `${opts.baseURL}/panel/api/inbound/addClient`,
          `${opts.baseURL}/api/inbound/addClient`,
          `${opts.baseURL}/panel/inbounds/addclient`,
          `${opts.baseURL}/panel/inbound/addclient`,
          `${opts.baseURL}/api/inbound/addclient`,
          `${opts.baseURL}/xui/api/inbounds/addClient`,
          `${opts.baseURL}/xui/api/inbounds/addclient`,
        ];

        for (const url of possibleUrls) {
          try {
            console.log(`[X-UI Attempt] Legacy Account creation probe: ${url} | Inbound ID: ${primaryInboundId}`);
            
            let res = await this.client.post(url, {
              id: Number(primaryInboundId),
              settings: JSON.stringify(settings)
            }, {
              headers: { ...opts.headers, 'Content-Type': 'application/json' },
              validateStatus: () => true,
              timeout: 10000
            });
            
            lastResponse = res;
            if (res?.status && res.status !== 404) {
              non404Response = res;
            }
            if (res?.data?.success) {
              isSuccess = true;
              console.log(`[X-UI Success] Created client via legacy: ${url}`);
              break;
            }

            // Fallback: settings as object
            res = await this.client.post(url, {
              id: Number(primaryInboundId),
              settings: settings
            }, {
              headers: { ...opts.headers, 'Content-Type': 'application/json' },
              validateStatus: () => true
            });
            lastResponse = res;
            if (res?.status && res.status !== 404) {
              non404Response = res;
            }
            if (res?.data?.success) {
              isSuccess = true;
              console.log(`[X-UI Success] Created client via legacy (Object Mode): ${url}`);
              break;
            }
          } catch (err: any) {
            lastError = err;
          }
        }
      }

      if (!isSuccess) {
        // Prefer any response that didn't yield a routing 404 error
        const responseToUse = non404Response || lastResponse;
        
        let errorMsg = responseToUse?.data?.msg || lastError?.message || 'پنل پاسخ ناموفق در ثبت مشتری بازگرداند.';
        if (responseToUse?.status === 404) {
          // Extra diagnostic checking if listing inbounds had succeeded previously (which means base URL/ApiKey is valid but write action failed)
          const apiConfiguredWithKey = !!state.panel.apiKey;
          if (apiConfiguredWithKey) {
            errorMsg = `❌ خطا در ساخت اکانت: آدرس API ثبت کلاینت یافت نشد (404) با وجود اینکه دریافت لیست اینباندها با کلید API موفق است. این خطا به احتمال قوی نشان می‌دهد "کلید API" تعریف شده شما فقط خواندنی (Read-Only) است و مجوزهای نوشتن (POST / WRITE) را ندارد. لطفا در پنل سنایی به مسیر تنظیمات پنل > کلیدهای API رفته و اطمینان حاصل کنید دسترسی‌های POST/WRITE (یا تمامی دسترسی‌ها) برای این کلید فعال شده باشد.`;
          } else {
            errorMsg = `❌ خطا در ساخت اکانت: آدرس API ثبت کلاینت پیدا نشد (404) یا شناسه اینباند [ID: ${primaryInboundId}] در پنل شما وجود ندارد. لطفا شناسه اینباند یا Web Base Path را بررسی کنید.`;
          }
        }
        if (responseToUse?.status === 401 || responseToUse?.status === 403) {
          errorMsg = 'خطای دسترسی و اعتبار سنجی (401/403). لطفا کلید API یا نام کاربری و رمز ورود را مجدد بررسی کنید و از داشتن مجوزهای کامل مطمئن شوید.';
        }
        throw new Error(errorMsg);
      }

      // Reset any pre-existing or residual traffic stats for this email on the panel
      await this.resetClientTraffic(email, primaryInboundId).catch(() => {});

      const subUrlStr = this.buildXuiSubUrl(subId);
      let domain = 'vpn.domain.com';
      try {
        const pUrl = this.lastPanelUrl || db.getState().panel?.url;
        if (pUrl) {
          domain = new URL(pUrl).hostname;
        }
      } catch {}

      return {
        uuid: clientId,
        email: email,
        subUrl: subUrlStr,
        vlessUrl: `vless://${clientId}@${domain}:443?type=grpc&serviceName=grpc&security=tls&sni=${domain}#${email}`,
      };
    } catch (e: any) {
      console.error('XUI AddClient Final Error:', e.message);
      this.cookie = '';
      throw e;
    }
  }
}

export const xui = new XuiClient();
