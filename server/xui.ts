import axios, { AxiosInstance } from 'axios';
import https from 'https';
import { v4 as uuidv4 } from 'uuid';
import { db } from './db.js';

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

  public async testConnection(panelOverride?: any) {
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
              message: `اتصال برقرار شد. مسیر معتبر: ${path}`,
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

  public async getInbounds() {
    try {
      const state = db.getState();
      const panel = state.panel;
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

  public async delClient(inboundId: number, clientUuid: string) {
    try {
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

  public async delClientByEmail(email: string) {
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

  public async updateClientEnable(email: string, enable: boolean) {
    try {
      const opts = await this.getAuthOptions();
      const inboundsList = await this.getInbounds();
      let targetClient: any = null;
      let primaryInboundId = 0;
      
      for (const ib of inboundsList) {
        if (ib.settings) {
          const parsed = typeof ib.settings === 'string' ? JSON.parse(ib.settings) : ib.settings;
          if (parsed && parsed.clients) {
            const found = parsed.clients.find((c: any) => c.email === email);
            if (found) {
              targetClient = found;
              primaryInboundId = ib.id;
              break;
            }
          }
        }
      }

      if (!targetClient) {
        console.error(`[X-UI] Client ${email} not found for update`);
        return false;
      }

      const uuid = targetClient.id || targetClient.password;
      targetClient.enable = enable;

      const settingsParams = {
        clients: [targetClient]
      };

      // Depending on the exact X-UI panel, the payload needs the entire target config for that client
      const payload = {
        id: primaryInboundId,
        settings: JSON.stringify(settingsParams)
      };

      const workingPrefix = this.workingApiPrefix || '/panel/api';
      const paths = [
        `${workingPrefix}/inbounds/updateClient/${uuid}`,
        `${workingPrefix}/inbounds/updateclient/${uuid}`,
        `/panel/api/inbounds/updateClient/${uuid}`
      ];

      for (const p of paths) {
        try {
           const res = await this.client.post(`${opts.baseURL}${p}`, payload, { headers: opts.headers, validateStatus: () => true });
           if (res.data && res.data.success) {
             console.log(`[X-UI] Successfully updated client enable: ${enable} for ${email}`);
             return true;
           }
        } catch(e) {}
      }

      return false;
    } catch (e: any) {
      console.error('[X-UI] Error update client enable', e.message);
      return false;
    }
  }

  public async renewClient(email: string, volumeGb: number, durationDays: number) {
    try {
      const opts = await this.getAuthOptions();
      const state = db.getState();
      const inboundsList = await this.getInbounds();
      
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
        throw new Error(`کاربری با ایمیل ${email} در پنل یافت نشد.`);
      }

      console.log(`[X-UI] Renewing client ${email}. Deleting existing...`);
      // Delete old client first
      await this.delClientByEmail(email);
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

      const domain = new URL(state.panel.url).hostname;
      let subUrlStr;
      if (state.panel.subUrlBase && state.panel.subUrlBase.trim() !== '') {
        let base = state.panel.subUrlBase.trim();
        if (!base.endsWith('/')) {
          base += '/';
        }
        subUrlStr = `${base}${subId}`;
      } else {
        const panelPortMatch = state.panel.url.match(/:(\d+)$/);
        const panelPort = panelPortMatch ? panelPortMatch[1] : (state.panel.url.startsWith('https') ? '443' : '80');
        subUrlStr = `http://${domain}:${panelPort}/sub/${subId}`;
      }

      return {
        subUrl: subUrlStr,
        email: email,
        id: clientId
      };
    } catch (e: any) {
      console.error('[X-UI] addClient Error:', e.message);
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

  public async addClient(email: string, volumeGb: number, durationDays: number, targetInboundIds?: string | number | (string | number)[], limitIp: number = 0, telegramId?: string, group?: string) {
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
      const inboundsList: any[] = await this.getInbounds() || [];
      
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

      const domain = new URL(state.panel.url).hostname;
      let subUrlStr;
      if (state.panel.subUrlBase && state.panel.subUrlBase.trim() !== '') {
        let base = state.panel.subUrlBase.trim();
        if (!base.endsWith('/')) {
          base += '/';
        }
        subUrlStr = `${base}${subId}`;
      } else {
        const subPath = state.panel.url.endsWith('/') ? state.panel.url : state.panel.url + '/';
        subUrlStr = `${subPath}sub/${subId}`;
      }

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
