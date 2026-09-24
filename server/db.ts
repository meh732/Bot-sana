import fs from 'fs';
import path from 'path';

export interface PanelConfig {
  url?: string;
  username?: string;
  password?: string;
  inboundId?: number | string;
  inboundIds?: (number | string)[];
  apiKey?: string;
  subUrlBase?: string;
  panelType?: 'sanaei' | 'rebecca' | 'both' | string;
}

export interface RebeccaPanelConfig {
  url?: string;
  username?: string;
  password?: string;
  apiKey?: string;
  inboundTags?: string[];
  serviceId?: number | string;
  subUrlBase?: string;
  enabled?: boolean;
}

export interface Category {
  id: string;
  name: string;
  disabled?: boolean;
}

export interface Product {
  id: string;
  name: string;
  price: number; // in Toman
  volumeGb: number; // Gigabytes
  durationDays: number;
  categoryId?: string;
  panelType?: 'sanaei' | 'rebecca' | 'both';
  inboundId?: number | string;
  inboundIds?: (number | string)[];
  rebeccaInboundTags?: string[];
  rebeccaServiceId?: number | string;
  limitIp?: number;
  disabled?: boolean;
  isPayAsYouGo?: boolean;
}

export interface SellerDiscountRule {
  type: 'global' | 'category' | 'product';
  targetId?: string; // categoryId or productId (empty for global)
  percent: number;
}

export interface Purchase {
  id: string;
  name: string;
  price: number;
  subUrl: string;
  sanaeiSubUrl?: string;
  rebeccaSubUrl?: string;
  panelType?: 'sanaei' | 'rebecca' | 'both';
  volumeGb: number;
  durationDays: number;
  createdAt: string;
  isPayAsYouGo?: boolean;
  pricePerGb?: number;
  lastUsedBytes?: number;
  baseSettledBytes?: number; // Volume in bytes already settled / paid for
  paygDisabled?: boolean;
  warnedPayg?: boolean;
  warnedData?: boolean;
  warnedTime?: boolean;
  originalPrice?: number;
  originalPricePerGb?: number;
  discountPercent?: number;
  discountAmount?: number;
  expiredAt?: number;
  isDeleted?: boolean;
}

export interface User {
  chatId: number;
  username?: string;
  nickname?: string;
  balance: number;
  testUsed: boolean;
  registeredAt: string;
  referredBy?: number;
  referralsMade?: number;
  isSeller?: boolean;
  sellerDiscount?: number; // legacy global discount
  sellerDiscounts?: SellerDiscountRule[];
  debt?: number;
  debtVolume?: number;
  debtLimit?: number;
  isUnlimitedLimit?: boolean;
  totalSales?: number;
  totalPayments?: number;
  purchases?: Purchase[];
}

export interface Coupon {
  code: string;
  discountPercent: number; // e.g. 15 for 15%
  giftAmount?: number; // Optional amount for gift coupon
  maxUsage?: number;
  usedCount?: number;
  expirationDate?: string;
  maxUsagePerUser?: number;
  usedBy?: Record<string, number>; // Stringified chatId to avoid index signature issues, or number
}

export interface PendingPayment {
  id: string;
  chatId: number;
  amount: number;
  fileId?: string;
  timestamp: number;
  pendingPurchase?: {
    productId: string;
    couponCode?: string;
    customName?: string;
  };
}

export interface AppState {
  botToken?: string;
  activePanelMode?: 'xui' | 'rebecca' | 'both';
  panel: PanelConfig;
  rebeccaPanel?: RebeccaPanelConfig;
  categories?: Category[];
  products: Product[];
  users: User[];
  pendingPayments?: PendingPayment[];
  freeTestVolumeGb: number;
  freeTestDurationDays: number;
  freeTestEnabled: boolean;
  freeTestPanel?: 'sanaei' | 'rebecca' | 'both';
  freeTestInboundId?: number | string;
  freeTestInboundIds?: (number | string)[];
  freeTestRebeccaInbounds?: string[];
  freeTestRebeccaTags?: string[];
  forceJoinEnabled?: boolean;
  forceJoinChannels?: { id: string; name: string; url: string }[];
  adminIds: number[];
  referralRewardToman: number;
  cardNumber?: string;
  cardHolder?: string;
  supportUsername?: string;
  coupons: Coupon[];
  autoBackupIntervalHours?: number;
  autoBackupPassword?: string;
  lastAutoBackupSent?: number;
  lastDailyReportSent?: number;
}

const DB_PATH = path.join(process.cwd(), 'db.json');

const defaultState: AppState = {
  botToken: '',
  panel: {},
  rebeccaPanel: {
    enabled: true
  },
  products: [],
  users: [],
  freeTestVolumeGb: 1,
  freeTestDurationDays: 3,
  freeTestEnabled: true,
  freeTestPanel: 'sanaei',
  adminIds: [],
  referralRewardToman: 0,
  cardNumber: '۶۰۳۷۹۹۷۹۱۲۳۴۵۶۷۸',
  cardHolder: 'نام مدیر حساب',
  supportUsername: '',
  coupons: []
};

class Database {
  private state: AppState;

  constructor() {
    this.state = { ...defaultState };
    this.load();
  }

  private sanitizeState(rawState: any): AppState {
    const sanitized: AppState = {
      ...defaultState,
      ...(typeof rawState === 'object' && rawState !== null ? rawState : {})
    };

    // Sanitize users
    if (!Array.isArray(sanitized.users)) {
      sanitized.users = [];
    } else {
      sanitized.users = sanitized.users
        .filter((u: any) => u && (u.chatId !== undefined && u.chatId !== null))
        .map((u: any) => ({
          ...u,
          chatId: Number(u.chatId),
          balance: typeof u.balance === 'number' && !isNaN(u.balance) ? u.balance : Number(u.balance || 0),
          debt: typeof u.debt === 'number' && !isNaN(u.debt) ? u.debt : Number(u.debt || 0),
          testUsed: Boolean(u.testUsed),
          registeredAt: u.registeredAt || u.joinedAt || new Date().toISOString(),
          purchases: Array.isArray(u.purchases) ? u.purchases.map((p: any) => ({
            ...p,
            id: p.id ? String(p.id) : `p_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            name: p.name || 'سرویس',
            price: Number(p.price || 0),
            volumeGb: Number(p.volumeGb || 0),
            durationDays: Number(p.durationDays || 0),
            createdAt: p.createdAt || new Date().toISOString()
          })) : []
        }));
    }

    // Sanitize products
    if (!Array.isArray(sanitized.products)) {
      sanitized.products = [];
    } else {
      sanitized.products = sanitized.products
        .filter((p: any) => p && p.id)
        .map((p: any) => ({
          ...p,
          id: String(p.id),
          name: p.name || 'محصول بدون نام',
          price: Number(p.price || 0),
          volumeGb: Number(p.volumeGb || 0),
          durationDays: Number(p.durationDays || 0),
          panelType: p.panelType || 'sanaei'
        }));
    }

    // Sanitize categories
    if (!Array.isArray(sanitized.categories)) {
      sanitized.categories = [];
    } else {
      sanitized.categories = sanitized.categories
        .filter((c: any) => c && c.id)
        .map((c: any) => ({
          ...c,
          id: String(c.id),
          name: c.name || 'دسته'
        }));
    }

    // Sanitize adminIds
    if (!Array.isArray(sanitized.adminIds)) {
      sanitized.adminIds = [];
    } else {
      sanitized.adminIds = sanitized.adminIds.map((id: any) => Number(id)).filter((id: number) => !isNaN(id));
    }

    // Sanitize coupons
    if (!Array.isArray(sanitized.coupons)) {
      sanitized.coupons = [];
    }

    // Sanitize pendingPayments
    if (!Array.isArray(sanitized.pendingPayments)) {
      sanitized.pendingPayments = [];
    }

    return sanitized;
  }

  private load() {
    try {
      if (fs.existsSync(DB_PATH)) {
        const data = fs.readFileSync(DB_PATH, 'utf-8');
        const parsed = JSON.parse(data);
        this.state = this.sanitizeState(parsed);
      } else {
        this.save();
      }
    } catch (e) {
      console.error('Failed to load db.json', e);
      this.state = { ...defaultState };
    }
  }

  private lastBackupTime = 0;

  private triggerAutoBackup() {
    try {
      const now = Date.now();
      // Wait at least 1 minute between auto-backups to prevent disk spam
      if (now - this.lastBackupTime < 60000) {
        return;
      }
      this.lastBackupTime = now;

      const BACKUPS_DIR = path.join(process.cwd(), 'backups');
      if (!fs.existsSync(BACKUPS_DIR)) {
        fs.mkdirSync(BACKUPS_DIR, { recursive: true });
      }

      const timestamp = new Date().toISOString()
        .replace(/T/, '_')
        .replace(/\..+/, '')
        .replace(/:/g, '-');
      const backupPath = path.join(BACKUPS_DIR, `backup_auto_${timestamp}.json`);
      
      fs.writeFileSync(backupPath, JSON.stringify(this.state, null, 2), 'utf8');
      console.log(`[Backup Engine] Auto snapshot saved: backup_auto_${timestamp}.json`);

      // Keep only the last 20 backups overall
      const files = fs.readdirSync(BACKUPS_DIR)
        .filter(f => f.startsWith('backup_') && f.endsWith('.json'))
        .map(f => {
          const filePath = path.join(BACKUPS_DIR, f);
          return { name: f, path: filePath, time: fs.statSync(filePath).mtime.getTime() };
        })
        .sort((a, b) => b.time - a.time);

      if (files.length > 20) {
        const toDelete = files.slice(20);
        for (const item of toDelete) {
          try {
            fs.unlinkSync(item.path);
            console.log(`[Backup Engine] Pruned outdated snapshot: ${item.name}`);
          } catch (delErr) {}
        }
      }
    } catch (err: any) {
      console.error('[Backup Engine] Failed to save auto backup snapshot:', err.message);
    }
  }

  public createManualBackup() {
    try {
      const BACKUPS_DIR = path.join(process.cwd(), 'backups');
      if (!fs.existsSync(BACKUPS_DIR)) {
        fs.mkdirSync(BACKUPS_DIR, { recursive: true });
      }

      const timestamp = new Date().toISOString()
        .replace(/T/, '_')
        .replace(/\..+/, '')
        .replace(/:/g, '-');
      const filename = `backup_manual_${timestamp}.json`;
      const backupPath = path.join(BACKUPS_DIR, filename);
      
      fs.writeFileSync(backupPath, JSON.stringify(this.state, null, 2), 'utf8');
      console.log(`[Backup Engine] Manual restore point created: ${filename}`);
      return filename;
    } catch (err: any) {
      console.error('[Backup Engine] Manual backup creation failed:', err.message);
      throw err;
    }
  }

  private save() {
    try {
      fs.writeFileSync(DB_PATH, JSON.stringify(this.state, null, 2));
      this.triggerAutoBackup();
    } catch (e) {
      console.error('Failed to save db.json', e);
    }
  }

  public getState() {
    return this.state;
  }

  public updateState(partial: Partial<AppState>) {
    this.state = { ...this.state, ...partial };
    this.save();
  }

  public saveUser(user: User) {
    const idx = this.state.users.findIndex(u => u.chatId === user.chatId);
    if (idx >= 0) {
      this.state.users[idx] = user;
    } else {
      this.state.users.push(user);
    }
    this.save();
  }

  public getUser(chatId: number): User | undefined {
    return this.state.users.find(u => u.chatId === chatId);
  }

  public getUserByUsername(username: string): User | undefined {
    const cleanUsername = username.replace('@', '').toLowerCase();
    return this.state.users.find(u => u.username?.toLowerCase() === cleanUsername);
  }
}

export const db = new Database();
