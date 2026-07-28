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
  inboundId?: number | string;
  inboundIds?: (number | string)[];
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
  volumeGb: number;
  durationDays: number;
  createdAt: string;
  isPayAsYouGo?: boolean;
  pricePerGb?: number;
  lastUsedBytes?: number;
  paygDisabled?: boolean;
  warnedPayg?: boolean;
  warnedData?: boolean;
  warnedTime?: boolean;
  originalPrice?: number;
  discountPercent?: number;
  discountAmount?: number;
  expiredAt?: number;
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
  totalSales?: number;
  purchases?: Purchase[];
}

export interface Coupon {
  code: string;
  discountPercent: number; // e.g. 15 for 15%
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
}

export interface AppState {
  botToken?: string;
  panel: PanelConfig;
  categories?: Category[];
  products: Product[];
  users: User[];
  pendingPayments?: PendingPayment[];
  freeTestVolumeGb: number;
  freeTestDurationDays: number;
  freeTestEnabled: boolean;
  freeTestInboundId?: number | string;
  freeTestInboundIds?: (number | string)[];
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
}

const DB_PATH = path.join(process.cwd(), 'db.json');

const defaultState: AppState = {
  botToken: '',
  panel: {},
  products: [],
  users: [],
  freeTestVolumeGb: 1,
  freeTestDurationDays: 3,
  freeTestEnabled: true,
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

  private load() {
    try {
      if (fs.existsSync(DB_PATH)) {
        const data = fs.readFileSync(DB_PATH, 'utf-8');
        const parsed = JSON.parse(data);
        this.state = { ...defaultState, ...parsed };
      } else {
        this.save();
      }
    } catch (e) {
      console.error('Failed to load db.json', e);
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
