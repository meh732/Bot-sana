import { useState, useEffect } from 'react';
import { Save, RefreshCw, Send, Plus, Trash2, BatteryCharging, Settings2, Users as UsersIcon, Box, Download, Upload, Zap, CheckCircle, Percent, X, Edit2, Package, Menu, PanelLeftClose, PanelLeftOpen, ChevronRight, ChevronLeft } from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState<'settings' | 'products' | 'users' | 'sellers'>('settings');
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('sidebar_collapsed') === 'true';
    } catch {
      return false;
    }
  });

  const toggleSidebar = () => {
    setSidebarCollapsed(prev => {
      const next = !prev;
      try {
        localStorage.setItem('sidebar_collapsed', String(next));
      } catch {}
      return next;
    });
  };

  return (
    <div className="w-full h-full min-h-screen bg-slate-50 flex flex-row" dir="rtl" style={{ fontFamily: "'Tahoma', 'Arial', sans-serif" }}>
      {/* Sidebar */}
      <div 
        className={`bg-slate-900 h-full min-h-screen flex flex-col shadow-xl sticky top-0 transition-all duration-300 ease-in-out z-20 ${
          sidebarCollapsed ? 'w-20' : 'w-64'
        }`}
      >
        {/* Sidebar Header */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <div className={`flex items-center gap-3 overflow-hidden ${sidebarCollapsed ? 'justify-center w-full' : ''}`}>
            <div className="w-9 h-9 bg-gradient-to-br from-indigo-500 to-indigo-700 rounded-xl flex items-center justify-center text-white font-bold shadow-md shadow-indigo-900/50 flex-shrink-0">
              S
            </div>
            {!sidebarCollapsed && (
              <div className="flex flex-col whitespace-nowrap overflow-hidden">
                <span className="text-white font-bold text-base tracking-tight truncate">مدیریت پنل هوشمند</span>
                <span className="text-xs text-indigo-400 font-medium truncate">سنایی و ربکا</span>
              </div>
            )}
          </div>
          {!sidebarCollapsed && (
            <button
              onClick={toggleSidebar}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              title="بستن سایدبار"
            >
              <PanelLeftClose className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Navigation Tabs */}
        <nav className="flex-1 p-3 space-y-2 overflow-y-auto">
          <TabBtn 
            active={activeTab === 'settings'} 
            onClick={() => setActiveTab('settings')} 
            icon={<Settings2 className="w-5 h-5 flex-shrink-0"/>}
            collapsed={sidebarCollapsed}
          >
            تنظیمات ربات و سرور
          </TabBtn>
          <TabBtn 
            active={activeTab === 'products'} 
            onClick={() => setActiveTab('products')} 
            icon={<Box className="w-5 h-5 flex-shrink-0"/>}
            collapsed={sidebarCollapsed}
          >
            لیست محصولات
          </TabBtn>
          <TabBtn 
            active={activeTab === 'users'} 
            onClick={() => setActiveTab('users')} 
            icon={<UsersIcon className="w-5 h-5 flex-shrink-0"/>}
            collapsed={sidebarCollapsed}
          >
            مشتریان عادی
          </TabBtn>
          <TabBtn 
            active={activeTab === 'sellers'} 
            onClick={() => setActiveTab('sellers')} 
            icon={<UsersIcon className="w-5 h-5 text-indigo-400 flex-shrink-0"/>}
            collapsed={sidebarCollapsed}
          >
            همکاران و نمایندگان
          </TabBtn>
        </nav>

        {/* Sidebar Footer & Toggle Button */}
        <div className="p-3 mt-auto border-t border-slate-800 space-y-2">
          {sidebarCollapsed ? (
            <button
              onClick={toggleSidebar}
              className="w-full flex items-center justify-center p-2.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              title="باز کردن سایدبار"
            >
              <PanelLeftOpen className="w-5 h-5" />
            </button>
          ) : (
            <div className="bg-slate-800/80 rounded-xl p-3 border border-slate-700/50">
              <div className="flex justify-between items-center mb-1">
                <span className="text-xs font-medium text-slate-400">وضعیت سامانه</span>
                <span className="flex items-center gap-1.5 text-xs text-emerald-400 font-semibold">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                  آنلاین
                </span>
              </div>
              <p className="text-white text-xs font-mono" dir="ltr">Sanaei + Rebecca v3.0</p>
            </div>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col h-full min-h-screen overflow-hidden">
        {/* Header */}
        <header className="bg-white h-16 border-b border-slate-200 px-6 flex flex-shrink-0 items-center justify-between sticky top-0 z-10 w-full shadow-sm">
          <div className="flex items-center gap-4">
            <button
              onClick={toggleSidebar}
              className="p-2 rounded-lg text-slate-600 hover:text-indigo-600 hover:bg-slate-100 transition-colors"
              title={sidebarCollapsed ? "باز کردن سایدبار" : "بستن سایدبار"}
            >
              {sidebarCollapsed ? <PanelLeftOpen className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
            <h2 className="text-slate-800 font-bold text-lg md:text-xl">داشبورد عملیات خودکار و فروش</h2>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3">
              <div className="text-left hidden sm:block" dir="ltr">
                <p className="text-sm font-semibold text-slate-800">مدیریت کل</p>
                <p className="text-xs text-slate-500">Super Admin</p>
              </div>
              <div className="w-10 h-10 bg-indigo-50 rounded-xl border border-indigo-200 flex items-center justify-center font-bold text-indigo-600 shadow-sm">
                A
              </div>
            </div>
          </div>
        </header>

        <main className="p-6 md:p-8 flex flex-col gap-6 flex-1 overflow-y-auto w-full" dir="ltr">
          {activeTab === 'settings' && <SettingsView />}
          {activeTab === 'products' && <ProductsView />}
          {activeTab === 'users' && <UsersView />}
          {activeTab === 'sellers' && <SellersView />}
        </main>
      </div>
    </div>
  );
}

function TabBtn({ active, onClick, children, icon, collapsed }: any) {
  return (
    <button 
      onClick={onClick}
      title={collapsed ? children : undefined}
      className={`w-full flex items-center gap-3 p-3 rounded-xl transition-all text-sm font-medium ${
        collapsed ? 'justify-center px-2' : 'justify-start'
      } ${
        active 
          ? 'bg-gradient-to-r from-indigo-600 to-indigo-700 text-white shadow-md shadow-indigo-900/30 font-semibold' 
          : 'text-slate-400 hover:text-white hover:bg-slate-800/70'
      }`}
    >
      {icon}
      {!collapsed && <span className="truncate">{children}</span>}
    </button>
  );
}

function SettingsView() {
  const [state, setState] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [activeSection, setActiveSection] = useState<'sanaei' | 'rebecca' | 'general' | 'coupons' | 'backups'>('sanaei');
  const [inbounds, setInbounds] = useState<any[]>([]);
  const [rebeccaInbounds, setRebeccaInbounds] = useState<any[]>([]);
  const [rebeccaTesting, setRebeccaTesting] = useState(false);
  const [rebeccaSaving, setRebeccaSaving] = useState(false);
  const [adminIdsStr, setAdminIdsStr] = useState('');

  const [backupPassword, setBackupPassword] = useState('');
  const [restorePassword, setRestorePassword] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const [localBackups, setLocalBackups] = useState<any[]>([]);

  const [newCouponCode, setNewCouponCode] = useState('');
  const [newCouponPercent, setNewCouponPercent] = useState(20);
  const [newCouponType, setNewCouponType] = useState<'discount' | 'gift'>('discount');
  const [newCouponGiftAmount, setNewCouponGiftAmount] = useState('');
  const [newCouponMaxUsage, setNewCouponMaxUsage] = useState('');
  const [newCouponMaxUsagePerUser, setNewCouponMaxUsagePerUser] = useState('');
  const [newCouponExpirationDays, setNewCouponExpirationDays] = useState('');

  
  const [newFjId, setNewFjId] = useState('');
  const [newFjName, setNewFjName] = useState('');
  const [newFjUrl, setNewFjUrl] = useState('');

  const refreshAppState = async () => {
    try {
      const res = await fetch('/api/state');
      const data = await res.json();
      setState(data);
      if (data.adminIds) {
        setAdminIdsStr(data.adminIds.join(', '));
      }
      fetchLocalBackups();
    } catch (e) {
      console.error('Error refreshing state:', e);
    }
  };

  const fetchLocalBackups = async () => {
    try {
      const res = await fetch('/api/backup/local-list');
      const data = await res.json();
      if (data.success) {
        setLocalBackups(data.files || []);
      }
    } catch (e) {
      console.error('Error fetching list of local restore points:', e);
    }
  };

  const handleCreateLocalBackup = async () => {
    setActionLoading(true);
    try {
      const res = await fetch('/api/backup/create-local', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        alert('نقطه بازیابی دستی (Snapshot) با موفقیت روی حافظه سرور ایجاد شد.');
        fetchLocalBackups();
      } else {
        alert('خطا در ایجاد نقطه بازیابی: ' + data.message);
      }
    } catch (e: any) {
      alert('خطا در شبکه: ' + e.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleRestoreLocalBackup = async (filename: string) => {
    if (!confirm(`⚠️ هشدار بسیار مهم:\nآیا مطمئن هستید که می‌خواهید کل اطلاعات دیتابیس ربات (مشتری‌ها، نمایندگان، کدهای تخفیف، تراکنش‌ها و...) را به تاریخچه فایل "${filename}" برگردانید؟ تمامی اطلاعات بعد از این تاریخ از بین خواهد رفت.`)) {
      return;
    }
    setActionLoading(true);
    try {
      const res = await fetch('/api/backup/restore-local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename })
      });
      const data = await res.json();
      if (data.success) {
        alert('✅ دیتابیس با موفقیت بازگردانی شد و ربات با اطلاعات قدیمی راه‌اندازی گردید.');
        await refreshAppState();
      } else {
        alert('در بازیابی خطا رخ داد: ' + data.message);
      }
    } catch (e: any) {
      alert('خطای اتصال به سرور: ' + e.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleUnlinkLocalBackup = async (filename: string) => {
    if (!confirm(`آیا از حذف برگشت‌ناپذیر فایل بکاپ "${filename}" مطمئن هستید؟`)) {
      return;
    }
    setActionLoading(true);
    try {
      const res = await fetch(`/api/backup/delete-local/${filename}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        fetchLocalBackups();
      } else {
        alert('خطا در حذف بکاپ: ' + data.message);
      }
    } catch (e: any) {
      alert('خطا در شبکه: ' + e.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleAddCoupon = async () => {
    if (!newCouponCode) {
      alert('لطفا کد را وارد کنید.');
      return;
    }
    const code = newCouponCode.trim().toUpperCase();
    
    let percent = 0;
    let giftAmount: number | undefined = undefined;

    if (newCouponType === 'discount') {
      percent = Number(newCouponPercent);
      if (isNaN(percent) || percent <= 0 || percent > 100) {
        alert('درصد تخفیف معتبر نیست (باید بین ۱ تا ۱۰۰ باشد).');
        return;
      }
    } else {
      giftAmount = Number(newCouponGiftAmount);
      if (isNaN(giftAmount) || giftAmount <= 0) {
        alert('مبلغ هدیه معتبر نیست (باید بزرگتر از صفر باشد).');
        return;
      }
    }

    const currentCoupons = state.coupons || [];
    if (currentCoupons.some((c: any) => c.code === code)) {
      alert('این کد قبلاً تعریف شده است.');
      return;
    }

    const newCoupon: any = { 
      code, 
      maxUsage: newCouponMaxUsage ? parseInt(newCouponMaxUsage) : undefined,
      maxUsagePerUser: newCouponMaxUsagePerUser ? parseInt(newCouponMaxUsagePerUser) : undefined,
      expirationDate: newCouponExpirationDays ? new Date(Date.now() + parseInt(newCouponExpirationDays) * 24 * 60 * 60 * 1000).toISOString() : undefined,
      usedCount: 0,
      usedBy: {}
    };

    if (newCouponType === 'discount') {
      newCoupon.discountPercent = percent;
    } else {
      newCoupon.giftAmount = giftAmount;
      newCoupon.discountPercent = 0;
    }

    const updatedCoupons = [...currentCoupons, newCoupon];
    
    setSaving(true);
    const parsedAdminIds = adminIdsStr
      .split(',')
      .map(s => s.trim())
      .filter(s => s !== '')
      .map(s => parseInt(s))
      .filter(id => !isNaN(id));

    const res = await fetch('/api/update-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        botToken: state.botToken,
        freeTestVolumeGb: Number(state.freeTestVolumeGb),
        freeTestDurationDays: Number(state.freeTestDurationDays),
        freeTestEnabled: state.freeTestEnabled !== false,
        freeTestInboundId: state.freeTestInboundId ? Number(state.freeTestInboundId) : undefined,
        supportUsername: state.supportUsername,
        referralRewardToman: Number(state.referralRewardToman) || 0,
        cardNumber: state.cardNumber,
        cardHolder: state.cardHolder,
        adminIds: parsedAdminIds,
        coupons: updatedCoupons
      })
    });
    const data = await res.json();
    if (data.success) {
      setState((prev: any) => ({ ...prev, coupons: updatedCoupons }));
      setNewCouponCode('');
      setNewCouponGiftAmount('');
      setNewCouponMaxUsage('');
      setNewCouponMaxUsagePerUser('');
      setNewCouponExpirationDays('');
      alert('کد با موفقیت ایجاد شد.');
    }
    setSaving(false);
  };

  const handleDeleteCoupon = async (codeToDelete: string) => {
    if (!confirm(`آیا از حذف کد تخفیف ${codeToDelete} مطمئن هستید؟`)) return;
    const currentCoupons = state.coupons || [];
    const updatedCoupons = currentCoupons.filter((c: any) => c.code !== codeToDelete);

    setSaving(true);
    const parsedAdminIds = adminIdsStr
      .split(',')
      .map(s => s.trim())
      .filter(s => s !== '')
      .map(s => parseInt(s))
      .filter(id => !isNaN(id));

    const res = await fetch('/api/update-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        botToken: state.botToken,
        freeTestVolumeGb: Number(state.freeTestVolumeGb),
        freeTestDurationDays: Number(state.freeTestDurationDays),
        freeTestEnabled: state.freeTestEnabled !== false,
        freeTestInboundId: state.freeTestInboundId ? Number(state.freeTestInboundId) : undefined,
        supportUsername: state.supportUsername,
        referralRewardToman: Number(state.referralRewardToman) || 0,
        cardNumber: state.cardNumber,
        cardHolder: state.cardHolder,
        adminIds: parsedAdminIds,
        coupons: updatedCoupons
      })
    });
    const data = await res.json();
    if (data.success) {
      setState((prev: any) => ({ ...prev, coupons: updatedCoupons }));
      alert('کد تخفیف حذف شد.');
    }
    setSaving(false);
  };

  const handleAddForceJoin = () => {
    if(!newFjId || !newFjName || !newFjUrl) return alert('مشخصات کانال ناقص است');
    const channels = state.forceJoinChannels || [];
    setState({ ...state, forceJoinChannels: [...channels, { id: newFjId, name: newFjName, url: newFjUrl }] });
    setNewFjId(''); setNewFjName(''); setNewFjUrl('');
  };

  const handleDeleteForceJoin = (idx: number) => {
    const channels = state.forceJoinChannels || [];
    setState({ ...state, forceJoinChannels: channels.filter((_:any, i:number) => i !== idx) });
  };

  useEffect(() => {
    fetch('/api/state')
      .then(r => r.json())
      .then(data => {
        setState(data);
        if (data.adminIds) {
          setAdminIdsStr(data.adminIds.join(', '));
        }
      });

    fetchLocalBackups();

    // Prefetch inbounds automatically on mount if connected
    fetch('/api/xui-inbounds')
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          setInbounds(data.inbounds || []);
        }
      })
      .catch(e => console.log('Could not prefetch panel inbounds:', e));

    fetch('/api/rebecca-inbounds')
      .then(r => r.json())
      .then(data => {
        if (data && data.success) {
          setRebeccaInbounds(data.inbounds || []);
        }
      })
      .catch(() => {});
  }, []);

  if (!state) return <div className="text-center p-8">Loading...</div>;

  const saveGeneral = async () => {
    setSaving(true);
    // Parse comma-separated IDs to array of numbers
    const parsedAdminIds = adminIdsStr
      .split(',')
      .map(s => s.trim())
      .filter(s => s !== '')
      .map(s => parseInt(s))
      .filter(id => !isNaN(id));

    const res = await fetch('/api/update-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        botToken: state.botToken,
        freeTestVolumeGb: Number(state.freeTestVolumeGb),
        freeTestDurationDays: Number(state.freeTestDurationDays),
        freeTestEnabled: state.freeTestEnabled !== false,
        freeTestPanel: state.freeTestPanel || 'sanaei',
        freeTestInboundId: state.freeTestInboundId ? Number(state.freeTestInboundId) : undefined,
        freeTestInboundIds: state.freeTestInboundIds || [],
        freeTestRebeccaInbounds: state.freeTestRebeccaInbounds || [],
        supportUsername: state.supportUsername,
        referralRewardToman: Number(state.referralRewardToman) || 0,
        cardNumber: state.cardNumber,
        cardHolder: state.cardHolder,
        adminIds: parsedAdminIds,
        coupons: state.coupons || [],
        autoBackupIntervalHours: state.autoBackupIntervalHours !== undefined ? Number(state.autoBackupIntervalHours) : 0,
        autoBackupPassword: state.autoBackupPassword || '',
        forceJoinEnabled: state.forceJoinEnabled || false,
        forceJoinChannels: state.forceJoinChannels || []
      })
    });
    const data = await res.json();
    if (data.success) {
      setState((prevState: any) => ({
        ...prevState,
        adminIds: parsedAdminIds
      }));
    }
    setSaving(false);
    alert('تنظیمات عمومی با موفقیت ذخیره شد. اگر توکن ربات تغییر کرده، ربات مجدداً راه‌اندازی شد.');
  };

  const savePanel = async () => {
    setSaving(true);
    await fetch('/api/update-panel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state.panel)
    });
    setSaving(false);
    alert('اطلاعات پنل سنایی ذخیره شد.');
  };

  const saveRebeccaPanel = async () => {
    setRebeccaSaving(true);
    try {
      const res = await fetch('/api/update-rebecca-panel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state.rebeccaPanel || {})
      });
      const data = await res.json();
      if (data.success) {
        alert('✅ تنظیمات و اطلاعات اتصال پنل ربکا ذخیره شد.');
      } else {
        alert('❌ خطا در ذخیره پنل ربکا: ' + data.message);
      }
    } catch (e: any) {
      alert('خطای شبکه: ' + e.message);
    } finally {
      setRebeccaSaving(false);
    }
  };

  const loadInbounds = async () => {
    try {
      const res = await fetch('/api/xui-inbounds');
      const data = await res.json();
      if (data.success) {
        setInbounds(data.inbounds);
        alert(`✅ تعداد ${data.inbounds.length} اینباند از پنل سنایی با موفقیت دریافت شد.`);
      } else {
        alert('خطا در دریافت لیست اینباندها: ' + data.message);
      }
    } catch(e: any) {
      alert('خطا در ارتباط با پنل. مشخصات، آدرس و یا پورت و فایروال را بررسی کنید.');
    }
  };

  const loadRebeccaInbounds = async () => {
    try {
      const res = await fetch('/api/rebecca-inbounds');
      const data = await res.json();
      if (data.success) {
        setRebeccaInbounds(data.inbounds || []);
        alert(`✅ تعداد ${data.inbounds?.length || 0} پروتکل/اینباند از پنل ربکا دریافت شد.`);
      } else {
        alert('خطا در دریافت پروتکل‌های ربکا: ' + data.message);
      }
    } catch (e: any) {
      alert('خطا در ارتباط با پنل ربکا. آدرس و مشخصات ورود را بررسی کنید.');
    }
  };

  const testConnection = async () => {
    try {
      const res = await fetch('/api/test-panel-connection', { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state.panel)
      });
      const data = await res.json();
      if (data.success) {
        alert('✅ ' + data.message);
        loadInbounds();
      } else {
        alert('❌ خطا: ' + data.message);
      }
    } catch (e: any) {
      alert('خطای شبکه: ' + e.message);
    }
  };

  const testRebeccaConnection = async () => {
    setRebeccaTesting(true);
    try {
      const res = await fetch('/api/test-rebecca-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state.rebeccaPanel || {})
      });
      const data = await res.json();
      if (data.success) {
        alert('✅ ' + data.message);
        loadRebeccaInbounds();
      } else {
        alert('❌ خطا در اتصال به ربکا: ' + data.message);
      }
    } catch (e: any) {
      alert('خطای شبکه: ' + e.message);
    } finally {
      setRebeccaTesting(false);
    }
  };

  const handleDownloadBackup = async () => {
    if (!backupPassword) {
      alert('لطفا یک رمز عبور جهت رمزگذاری کانفیگ بکاپ تعیین کنید.');
      return;
    }
    setActionLoading(true);
    try {
      const res = await fetch('/api/backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: backupPassword })
      });
      const data = await res.json();
      if (data.success) {
        const blob = new Blob([data.payload], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `sanaei_bot_backup_${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } else {
        alert('خطا در ایجاد پشتیبان: ' + data.message);
      }
    } catch (e: any) {
      alert('خطای اتصال به سرور: ' + e.message);
    }
    setActionLoading(false);
  };

  const handleRestoreBackup = async () => {
    if (!restorePassword) {
      alert('لطفا ابتدا رمز عبور فایل بکاپ را وارد کنید.');
      return;
    }
    if (!selectedFile) {
      alert('لطفا ابتدا فایل بکاپ (.json) را انتخاب نمایید.');
      return;
    }
    
    setActionLoading(true);
    try {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const fileContent = event.target?.result as string;
        try {
          const res = await fetch('/api/restore', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              payload: fileContent,
              password: restorePassword
            })
          });
          const data = await res.json();
          if (data.success) {
            alert('بازیابی کامل اطلاعات ربات و دیتابیس با موفقیت انجام شد! تمامی بخش‌ها لود خواهند شد.');
            await refreshAppState();
          } else {
            alert('پشتیبان بازیابی نشد: ' + data.message);
          }
        } catch (e: any) {
          alert('خطا در رمزگشایی بکاپ. رمز وارد شده اشتباه است یا فایل مخدوش شده است.');
        }
        setActionLoading(false);
      };
      reader.readAsText(selectedFile);
    } catch(e: any) {
      alert('خطا در خواندن فایل: ' + e.message);
      setActionLoading(false);
    }
  };

  const rebeccaData = state.rebeccaPanel || {
    url: '',
    username: '',
    password: '',
    apiKey: '',
    subUrlBase: '',
    inboundTags: [],
    enabled: true
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto" dir="rtl">
      {/* Settings Subtabs Bar */}
      <div className="bg-white p-2 rounded-2xl shadow-sm border border-slate-200 flex flex-wrap gap-2">
        <button
          onClick={() => setActiveSection('sanaei')}
          className={`flex-1 min-w-[140px] py-2.5 px-4 rounded-xl font-bold text-xs md:text-sm flex items-center justify-center gap-2 transition-all ${
            activeSection === 'sanaei'
              ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md shadow-indigo-600/30'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <span className="w-2.5 h-2.5 rounded-full bg-blue-300"></span>
          🔵 پنل سنایی (X-UI)
        </button>

        <button
          onClick={() => setActiveSection('rebecca')}
          className={`flex-1 min-w-[140px] py-2.5 px-4 rounded-xl font-bold text-xs md:text-sm flex items-center justify-center gap-2 transition-all ${
            activeSection === 'rebecca'
              ? 'bg-gradient-to-r from-purple-600 to-indigo-700 text-white shadow-md shadow-purple-600/30'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <span className="w-2.5 h-2.5 rounded-full bg-purple-300"></span>
          🟣 پنل ربکا (Rebecca)
        </button>

        <button
          onClick={() => setActiveSection('general')}
          className={`flex-1 min-w-[140px] py-2.5 px-4 rounded-xl font-bold text-xs md:text-sm flex items-center justify-center gap-2 transition-all ${
            activeSection === 'general'
              ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Send className="w-4 h-4" />
          تنظیمات ربات و تست
        </button>

        <button
          onClick={() => setActiveSection('coupons')}
          className={`flex-1 min-w-[140px] py-2.5 px-4 rounded-xl font-bold text-xs md:text-sm flex items-center justify-center gap-2 transition-all ${
            activeSection === 'coupons'
              ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Percent className="w-4 h-4" />
          کدهای تخفیف و هدیه
        </button>

        <button
          onClick={() => setActiveSection('backups')}
          className={`flex-1 min-w-[140px] py-2.5 px-4 rounded-xl font-bold text-xs md:text-sm flex items-center justify-center gap-2 transition-all ${
            activeSection === 'backups'
              ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Download className="w-4 h-4" />
          بکاپ و بازیابی
        </button>
      </div>

      {/* SECTION 1: Sanaei Panel */}
      {activeSection === 'sanaei' && (
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 space-y-6">
          <div className="flex items-center justify-between border-b pb-4 border-slate-100">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600 font-bold">
                X
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-800">مشخصات و اتصال پنل سنایی (MHSanaei X-UI)</h2>
                <p className="text-xs text-slate-500">پیکربندی آدرس، پورت و کلید API پنل سنایی جهت ساخت و تمدید خودکار کانفیگ‌ها</p>
              </div>
            </div>
            <span className="bg-blue-50 text-blue-700 font-bold px-3 py-1 rounded-full text-xs border border-blue-200">
              X-UI Engine
            </span>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">آدرس کامل اتصال به پنل سنایی (X-UI URL)</label>
              <input 
                type="text" 
                value={state.panel?.url || ''} 
                onChange={e => setState({...state, panel: {...state.panel, url: e.target.value}})} 
                className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 text-left font-mono text-sm bg-slate-50/50" 
                dir="ltr" 
                placeholder="http://1.2.3.4:2053" 
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">نام کاربری ورود به پنل</label>
                <input 
                  type="text" 
                  value={state.panel?.username || ''} 
                  onChange={e => setState({...state, panel: {...state.panel, username: e.target.value}})} 
                  className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 text-sm" 
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">رمز عبور ورود به پنل</label>
                <input 
                  type="password" 
                  value={state.panel?.password || ''} 
                  onChange={e => setState({...state, panel: {...state.panel, password: e.target.value}})} 
                  className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 text-sm" 
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">کلید API Key اختصاصی سنایی (اختیاری جهت اتصال مستقیم و بدون سشن)</label>
              <input 
                type="text" 
                value={state.panel?.apiKey || ''} 
                onChange={e => setState({...state, panel: {...state.panel, apiKey: e.target.value}})} 
                className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 font-mono text-sm text-left bg-slate-50/50" 
                dir="ltr" 
                placeholder="vXg7hY..." 
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">دامنه اختصاصی لینک‌های سابسکریپشن سنایی (Subscription Base URL)</label>
              <input 
                type="text" 
                value={state.panel?.subUrlBase || ''} 
                onChange={e => setState({...state, panel: {...state.panel, subUrlBase: e.target.value}})} 
                className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 font-mono text-sm text-left bg-slate-50/50" 
                dir="ltr" 
                placeholder="https://sub.mydomain.com/" 
              />
              <p className="text-xs text-slate-400 mt-1">💡 اختیاری: اگر خالی باشد، لینک‌های سابسکریپشن مستقیماً بر اساس آدرس اصلی پنل ساخته می‌شوند.</p>
            </div>

            <div className="flex flex-wrap gap-3 pt-2">
              <button 
                onClick={testConnection} 
                className="flex-1 min-w-[180px] bg-slate-900 text-white px-4 py-2.5 rounded-xl hover:bg-slate-800 transition flex items-center justify-center font-bold text-sm shadow-sm"
              >
                <Zap className="w-4 h-4 ml-2 text-yellow-400" /> تست اتصال سنایی
              </button>
              <button 
                onClick={loadInbounds} 
                className="flex-1 min-w-[180px] bg-blue-600 text-white px-4 py-2.5 rounded-xl hover:bg-blue-700 transition flex items-center justify-center font-bold text-sm shadow-sm"
              >
                <RefreshCw className="w-4 h-4 ml-2" /> واکشی لیست اینباندها
              </button>
            </div>

            {/* Inbounds selection */}
            <div className="space-y-2 border-t pt-4">
              <label className="block text-sm font-bold text-slate-800">اینباندهای پیش‌فرض سنایی (Global Sanaei Inbounds):</label>
              <p className="text-xs text-slate-500">اینباندهایی که تیک می‌زنید به صورت رندوم یا پیش‌فرض برای فروش محصولات سنایی استفاده می‌شوند.</p>
              
              {inbounds.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 p-3.5 bg-slate-50 rounded-xl border border-slate-200 max-h-60 overflow-y-auto">
                  {inbounds.map((ib: any) => {
                    const isChecked = (state.panel?.inboundIds || []).includes(ib.id) || (state.panel?.inboundId === ib.id);
                    return (
                      <label key={ib.id} className="flex items-center gap-2.5 p-2.5 bg-white rounded-lg border border-slate-200 hover:border-blue-400 transition text-sm text-slate-700 cursor-pointer select-none shadow-xs">
                        <input 
                          type="checkbox" 
                          checked={isChecked}
                          onChange={e => {
                            let updatedIds = [...(state.panel?.inboundIds || [])];
                            if (state.panel?.inboundId && !updatedIds.includes(state.panel.inboundId)) {
                              updatedIds.push(state.panel.inboundId);
                            }
                            if (e.target.checked) {
                              if (!updatedIds.includes(ib.id)) updatedIds.push(ib.id);
                            } else {
                              updatedIds = updatedIds.filter(id => id !== ib.id);
                            }
                            setState({
                              ...state,
                              panel: {
                                ...state.panel,
                                inboundIds: updatedIds,
                                inboundId: updatedIds[0] || undefined
                              }
                            });
                          }}
                          className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 w-4 h-4"
                        />
                        <div className="flex flex-col overflow-hidden">
                          <span className="font-bold text-slate-800 truncate">{ib.remark}</span>
                          <span className="text-[10px] text-slate-500 font-mono">Port: {ib.port} | ID: {ib.id} ({ib.protocol})</span>
                        </div>
                      </label>
                    );
                  })}
                </div>
              ) : (
                <div className="p-6 border-2 border-dashed border-slate-200 rounded-xl flex flex-col items-center justify-center text-slate-400 bg-slate-50/50">
                  <Box className="w-8 h-8 mb-2 opacity-30" />
                  <p className="text-xs">هنوز لیستی از سنایی واکشی نشده است.</p>
                  <button onClick={loadInbounds} className="mt-2 text-blue-600 text-xs font-bold hover:underline">دریافت همین حالا</button>
                </div>
              )}
            </div>

            <div className="pt-2 border-t flex justify-end">
              <button 
                onClick={savePanel} 
                disabled={saving} 
                className="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2.5 rounded-xl font-bold text-sm transition flex items-center shadow-md shadow-emerald-700/20"
              >
                <Save className="w-4 h-4 ml-2" /> ذخیره مشخصات پنل سنایی
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SECTION 2: Rebecca Panel */}
      {activeSection === 'rebecca' && (
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 space-y-6">
          <div className="flex items-center justify-between border-b pb-4 border-slate-100">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-purple-50 border border-purple-200 flex items-center justify-center text-purple-600 font-bold">
                R
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-800">مشخصات و اتصال پنل ربکا (Rebecca API)</h2>
                <p className="text-xs text-slate-500">پیکربندی آدرس API و توکن ادمین پنل ربکا جهت ساخت اکانت‌های پیشرفته و سابسکریپشن</p>
              </div>
            </div>
            <span className="bg-purple-50 text-purple-700 font-bold px-3 py-1 rounded-full text-xs border border-purple-200">
              Rebecca API Engine
            </span>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">آدرس کامل اتصال به پنل ربکا (Rebecca Panel URL)</label>
              <input 
                type="text" 
                value={rebeccaData.url || ''} 
                onChange={e => setState({
                  ...state, 
                  rebeccaPanel: { ...rebeccaData, url: e.target.value }
                })} 
                className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-purple-500 text-left font-mono text-sm bg-slate-50/50" 
                dir="ltr" 
                placeholder="https://rebecca.example.com:8000" 
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">نام کاربری ادمین ربکا (Admin Username)</label>
                <input 
                  type="text" 
                  value={rebeccaData.username || ''} 
                  onChange={e => setState({
                    ...state, 
                    rebeccaPanel: { ...rebeccaData, username: e.target.value }
                  })} 
                  className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-purple-500 text-sm" 
                  placeholder="admin"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">رمز عبور ادمین ربکا (Admin Password)</label>
                <input 
                  type="password" 
                  value={rebeccaData.password || ''} 
                  onChange={e => setState({
                    ...state, 
                    rebeccaPanel: { ...rebeccaData, password: e.target.value }
                  })} 
                  className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-purple-500 text-sm" 
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">کلید API Key یا توکن اختصاصی ربکا (API Key / Bearer Token - اختیاری جهت اتصال مستقیم)</label>
              <input 
                type="text" 
                value={rebeccaData.apiKey || ''} 
                onChange={e => setState({
                  ...state, 
                  rebeccaPanel: { ...rebeccaData, apiKey: e.target.value }
                })} 
                className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-purple-500 font-mono text-sm text-left bg-slate-50/50" 
                dir="ltr" 
                placeholder="Bearer eyJhbGciOi..." 
              />
              <p className="text-xs text-slate-400 mt-1">💡 در صورت وارد کردن توکن API، سیستم به صورت مستقیم با API Key احراز هویت می‌کند.</p>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">دامنه یا بیس اختصاصی لینک‌های ساب ربکا (Base Subscription URL)</label>
              <input 
                type="text" 
                value={rebeccaData.subUrlBase || ''} 
                onChange={e => setState({
                  ...state, 
                  rebeccaPanel: { ...rebeccaData, subUrlBase: e.target.value }
                })} 
                className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-purple-500 font-mono text-sm text-left bg-slate-50/50" 
                dir="ltr" 
                placeholder="https://sub.rebeccasite.com/sub/" 
              />
              <p className="text-xs text-slate-400 mt-1">💡 اختیاری: اگر پر شود، لینک‌های سابسکریپشن ربکا با این دامنه برای کاربران ارسال می‌شود.</p>
            </div>

            <div className="flex flex-wrap gap-3 pt-2">
              <button 
                onClick={testRebeccaConnection} 
                disabled={rebeccaTesting}
                className="flex-1 min-w-[180px] bg-slate-900 text-white px-4 py-2.5 rounded-xl hover:bg-slate-800 transition flex items-center justify-center font-bold text-sm shadow-sm"
              >
                <Zap className="w-4 h-4 ml-2 text-yellow-400" /> {rebeccaTesting ? 'در حال تست...' : 'تست آنلاین اتصال ربکا'}
              </button>
              <button 
                onClick={loadRebeccaInbounds} 
                className="flex-1 min-w-[180px] bg-purple-600 text-white px-4 py-2.5 rounded-xl hover:bg-purple-700 transition flex items-center justify-center font-bold text-sm shadow-sm"
              >
                <RefreshCw className="w-4 h-4 ml-2" /> واکشی اینباندهای ربکا
              </button>
            </div>

            {/* Rebecca inbounds selection */}
            <div className="space-y-2 border-t pt-4">
              <label className="block text-sm font-bold text-slate-800">پروتکل‌ها و اینباندهای فعال در ربکا (Rebecca Inbounds):</label>
              <p className="text-xs text-slate-500">پروتکل‌هایی که تیک می‌زنید، هنگام ساخت اکانت در ربکا به کاربر اختصاص داده می‌شوند.</p>
              
              {rebeccaInbounds.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 p-3.5 bg-slate-50 rounded-xl border border-slate-200 max-h-60 overflow-y-auto">
                  {rebeccaInbounds.map((ib: any) => {
                    const tag = ib.tag || ib.remark || ib.name;
                    const isChecked = (rebeccaData.inboundTags || []).includes(tag);
                    return (
                      <label key={tag} className="flex items-center gap-2.5 p-2.5 bg-white rounded-lg border border-slate-200 hover:border-purple-400 transition text-sm text-slate-700 cursor-pointer select-none shadow-xs">
                        <input 
                          type="checkbox" 
                          checked={isChecked}
                          onChange={e => {
                            let updatedTags = [...(rebeccaData.inboundTags || [])];
                            if (e.target.checked) {
                              if (!updatedTags.includes(tag)) updatedTags.push(tag);
                            } else {
                              updatedTags = updatedTags.filter((t: string) => t !== tag);
                            }
                            setState({
                              ...state,
                              rebeccaPanel: {
                                ...rebeccaData,
                                inboundTags: updatedTags
                              }
                            });
                          }}
                          className="rounded border-slate-300 text-purple-600 focus:ring-purple-500 w-4 h-4"
                        />
                        <div className="flex flex-col overflow-hidden">
                          <span className="font-bold text-slate-800 truncate">{tag}</span>
                          <span className="text-[10px] text-slate-500 font-mono">{ib.protocol} / {ib.network || 'default'}</span>
                        </div>
                      </label>
                    );
                  })}
                </div>
              ) : (
                <div className="p-6 border-2 border-dashed border-slate-200 rounded-xl flex flex-col items-center justify-center text-slate-400 bg-slate-50/50">
                  <Box className="w-8 h-8 mb-2 opacity-30" />
                  <p className="text-xs">پروتکلی از پنل ربکا دریافت نشده است. روی دکمه واکشی بالا کلیک نمایید.</p>
                  <button onClick={loadRebeccaInbounds} className="mt-2 text-purple-600 text-xs font-bold hover:underline">واکشی اینباندهای ربکا</button>
                </div>
              )}
            </div>

            <div className="pt-2 border-t flex justify-end">
              <button 
                onClick={saveRebeccaPanel} 
                disabled={rebeccaSaving} 
                className="bg-purple-600 hover:bg-purple-700 text-white px-6 py-2.5 rounded-xl font-bold text-sm transition flex items-center shadow-md shadow-purple-700/20"
              >
                <Save className="w-4 h-4 ml-2" /> ذخیره مشخصات پنل ربکا
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SECTION 3: General & Telegram Bot Settings */}
      {activeSection === 'general' && (
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 space-y-6">
          <div className="flex items-center gap-3 border-b pb-4 border-slate-100">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-200 flex items-center justify-center text-indigo-600 font-bold">
              <Send className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-800">تنظیمات عمومی، ربات تلگرام و تست رایگان</h2>
              <p className="text-xs text-slate-500">پیکربندی توکن بات تلگرام، ادمین‌ها، شماره کارت و مدیریت تست رایگان</p>
            </div>
          </div>

          <div className="space-y-5">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">توکن ربات تلگرام (Telegram Bot Token)</label>
              <input 
                type="password" 
                value={state.botToken || ''} 
                onChange={e => setState({...state, botToken: e.target.value})} 
                className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 font-mono text-sm text-left bg-slate-50/50" 
                dir="ltr" 
                placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11" 
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">شناسه عددی ادمین‌های اصلی (با کاما انگلیسی , جدا کنید)</label>
              <input 
                type="text" 
                value={adminIdsStr} 
                onChange={e => setAdminIdsStr(e.target.value)} 
                className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 font-mono text-sm text-left bg-slate-50/50" 
                dir="ltr" 
                placeholder="51239241, 14023924" 
              />
            </div>

            {/* Free test card */}
            <div className="bg-slate-50/80 p-5 rounded-xl border border-slate-200 space-y-4">
              <div className="flex items-center justify-between border-b pb-3 border-slate-200">
                <div>
                  <h3 className="text-sm font-bold text-slate-800">⚙️ تنظیمات سرویس تست رایگان (Free Trial)</h3>
                  <p className="text-xs text-slate-500">مشخص کنید کانفیگ‌های تست رایگان روی کدام پنل ساخته شوند.</p>
                </div>
                <select 
                  value={state.freeTestEnabled !== false ? 'true' : 'false'} 
                  onChange={e => setState({...state, freeTestEnabled: e.target.value === 'true'})} 
                  className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs font-bold bg-white"
                >
                  <option value="true">✅ تست فعال</option>
                  <option value="false">❌ تست غیرفعال</option>
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">پنل ارائه دهنده تست رایگان</label>
                  <select 
                    value={state.freeTestPanel || 'sanaei'} 
                    onChange={e => setState({...state, freeTestPanel: e.target.value})} 
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm font-semibold bg-white" 
                  >
                    <option value="sanaei">🔵 فقط پنل سنایی (Sanaei)</option>
                    <option value="rebecca">🟣 فقط پنل ربکا (Rebecca)</option>
                    <option value="both">🚀 هر دو پنل به صورت همزمان (Both)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">حجم تست (گیگابایت)</label>
                  <input 
                    type="number" 
                    value={state.freeTestVolumeGb || 1} 
                    onChange={e => setState({...state, freeTestVolumeGb: e.target.value})} 
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm font-semibold bg-white" 
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">مدت اعتبار تست (روز)</label>
                  <input 
                    type="number" 
                    value={state.freeTestDurationDays || 1} 
                    onChange={e => setState({...state, freeTestDurationDays: e.target.value})} 
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm font-semibold bg-white" 
                  />
                </div>
              </div>

              {/* Free test specific inbounds */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-200">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">اینباند اختصاصی تست رایگان سنایی (Inbound ID)</label>
                  <input 
                    type="number" 
                    value={state.freeTestInboundId || ''} 
                    onChange={e => setState({...state, freeTestInboundId: e.target.value ? parseInt(e.target.value) : undefined})} 
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm font-mono bg-white" 
                    placeholder="مثال: 1 (در صورت خالی بودن از اینباند اصلی استفاده می‌شود)"
                  />
                  <p className="text-[11px] text-slate-400 mt-0.5">💡 آیدی اینباند اختصاصی سنایی جهت ساخت اکانت‌های تست رایگان</p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">اینباند/تگ‌های اختصاصی تست رایگان ربکا (کامای انگلیسی)</label>
                  <input 
                    type="text" 
                    value={Array.isArray(state.freeTestRebeccaTags) ? state.freeTestRebeccaTags.join(', ') : (state.freeTestRebeccaTags || '')} 
                    onChange={e => {
                      const tags = e.target.value.split(',').map(t => t.trim()).filter(Boolean);
                      setState({...state, freeTestRebeccaTags: tags});
                    }} 
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm font-mono bg-white" 
                    dir="ltr"
                    placeholder="vless-tcp, shadowsocks-tcp"
                  />
                  <p className="text-[11px] text-slate-400 mt-0.5">💡 تگ‌های پروتکل ربکا جهت ساخت اکانت تست رایگان</p>
                </div>
              </div>
            </div>

            {/* Financial & Support */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">شماره کارت بانکی (کارت به کارت)</label>
                <input 
                  type="text" 
                  value={state.cardNumber || ''} 
                  onChange={e => setState({...state, cardNumber: e.target.value})} 
                  className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 font-mono text-sm text-left bg-slate-50/50" 
                  dir="ltr" 
                  placeholder="6037997912345678" 
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">نام صاحب حساب کارت</label>
                <input 
                  type="text" 
                  value={state.cardHolder || ''} 
                  onChange={e => setState({...state, cardHolder: e.target.value})} 
                  className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 text-sm" 
                  placeholder="نام مدیریت" 
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">آیدی پشتیبانی تلگرام (بدون @)</label>
                <input 
                  type="text" 
                  value={state.supportUsername || ''} 
                  onChange={e => setState({...state, supportUsername: e.target.value})} 
                  className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 font-mono text-sm text-left bg-slate-50/50" 
                  dir="ltr" 
                  placeholder="SupportAdmin" 
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">پاداش معرفی زیرمجموعه (تومان)</label>
                <input 
                  type="number" 
                  value={state.referralRewardToman || 0} 
                  onChange={e => setState({...state, referralRewardToman: e.target.value})} 
                  className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 text-sm" 
                />
              </div>
            </div>

            {/* Forced Join */}
            <div className="border border-slate-200 rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-800">📢 جوین اجباری در کانال‌های تلگرام</h3>
                  <p className="text-xs text-slate-500">کاربران قبل از استفاده از ربات باید در کانال‌های زیر عضو شوند.</p>
                </div>
                <label className="flex items-center cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={state.forceJoinEnabled || false} 
                    onChange={e => setState({...state, forceJoinEnabled: e.target.checked})} 
                    className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 w-4 h-4" 
                  />
                  <span className="mr-2 text-xs font-bold text-slate-700">فعال بودن</span>
                </label>
              </div>

              {state.forceJoinEnabled && (
                <div className="space-y-3 pt-2">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                    <input 
                      type="text" 
                      value={newFjId} 
                      onChange={e => setNewFjId(e.target.value)} 
                      placeholder="یوزرنیم یا آیدی کانال (@mychannel)" 
                      className="border p-2.5 text-xs rounded-xl bg-slate-50 font-mono" 
                      dir="ltr" 
                    />
                    <input 
                      type="text" 
                      value={newFjName} 
                      onChange={e => setNewFjName(e.target.value)} 
                      placeholder="نام نمایشی کانال" 
                      className="border p-2.5 text-xs rounded-xl bg-slate-50" 
                    />
                    <div className="flex gap-2">
                      <input 
                        type="text" 
                        value={newFjUrl} 
                        onChange={e => setNewFjUrl(e.target.value)} 
                        placeholder="لینک عضویت کانال" 
                        className="border p-2.5 text-xs rounded-xl bg-slate-50 flex-1 font-mono" 
                        dir="ltr" 
                      />
                      <button 
                        onClick={handleAddForceJoin} 
                        className="bg-indigo-600 text-white px-3.5 py-2 rounded-xl text-xs font-bold shrink-0 hover:bg-indigo-700 transition"
                      >
                        افزودن
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2 mt-2">
                    {(state.forceJoinChannels || []).map((ch: any, idx: number) => (
                      <div key={idx} className="flex items-center justify-between bg-slate-50 p-2.5 rounded-xl border text-xs">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-indigo-700">{ch.name}</span>
                          <span className="text-slate-500 font-mono">({ch.id})</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <a href={ch.url} target="_blank" rel="noreferrer" className="text-blue-500 hover:underline">تست لینک</a>
                          <button onClick={() => handleDeleteForceJoin(idx)} className="text-red-500 hover:text-red-700">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="pt-3 border-t flex justify-end">
              <button 
                onClick={saveGeneral} 
                disabled={saving} 
                className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2.5 rounded-xl font-bold text-sm transition flex items-center shadow-md shadow-indigo-700/20"
              >
                <Save className="w-4 h-4 ml-2" /> ذخیره تنظیمات عمومی ربات
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SECTION 4: Coupons */}
      {activeSection === 'coupons' && (
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 space-y-6">
          <div className="flex items-center gap-3 border-b pb-4 border-slate-100">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-200 flex items-center justify-center text-indigo-600 font-bold">
              <Percent className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-800">مدیریت کدهای تخفیف و هدیه (Coupons & Gifts)</h2>
              <p className="text-xs text-slate-500">تعریف کدهای تخفیف درصدی برای خریدها یا کدهای هدیه جهت شارژ کیف پول کاربران</p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-6 gap-3 bg-slate-50 p-4 rounded-xl border border-slate-200 items-end">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">نوع کد</label>
                <select 
                  value={newCouponType} 
                  onChange={e => setNewCouponType(e.target.value as any)} 
                  className="w-full px-3 py-2 border rounded-xl text-xs bg-white"
                >
                  <option value="discount">کد تخفیف (درصدی)</option>
                  <option value="gift">کد هدیه (شارژ نقدی)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">کد (مثال: OFF20)</label>
                <input 
                  value={newCouponCode} 
                  onChange={e => setNewCouponCode(e.target.value)} 
                  type="text" 
                  className="w-full px-3 py-2 border rounded-xl text-xs font-mono text-left bg-white" 
                  placeholder="OFF20" 
                />
              </div>

              {newCouponType === 'discount' ? (
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">درصد تخفیف (٪)</label>
                  <input 
                    value={newCouponPercent} 
                    onChange={e => setNewCouponPercent(Number(e.target.value))} 
                    type="number" 
                    min="1" 
                    max="100" 
                    className="w-full px-3 py-2 border rounded-xl text-xs font-mono bg-white" 
                  />
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">مبلغ هدیه (تومان)</label>
                  <input 
                    value={newCouponGiftAmount} 
                    onChange={e => setNewCouponGiftAmount(e.target.value)} 
                    type="number" 
                    min="1" 
                    className="w-full px-3 py-2 border rounded-xl text-xs font-mono bg-white" 
                    placeholder="50000" 
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">تعداد مجاز کل</label>
                <input 
                  value={newCouponMaxUsage} 
                  onChange={e => setNewCouponMaxUsage(e.target.value)} 
                  type="number" 
                  className="w-full px-3 py-2 border rounded-xl text-xs font-mono bg-white" 
                  placeholder="نامحدود" 
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">مجاز هر کاربر</label>
                <input 
                  value={newCouponMaxUsagePerUser} 
                  onChange={e => setNewCouponMaxUsagePerUser(e.target.value)} 
                  type="number" 
                  className="w-full px-3 py-2 border rounded-xl text-xs font-mono bg-white" 
                  placeholder="1" 
                />
              </div>

              <div>
                <button 
                  onClick={handleAddCoupon} 
                  className="w-full bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl text-xs font-bold transition shadow-sm"
                >
                  ایجاد کد
                </button>
              </div>
            </div>

            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full text-xs text-right">
                <thead className="bg-slate-100 text-slate-600 border-b">
                  <tr>
                    <th className="px-4 py-2.5 font-bold">کد</th>
                    <th className="px-4 py-2.5 font-bold">نوع و مقدار</th>
                    <th className="px-4 py-2.5 font-bold text-center">وضعیت استفاده</th>
                    <th className="px-4 py-2.5 font-bold text-left">عملیات</th>
                  </tr>
                </thead>
                <tbody>
                  {(state.coupons || []).map((c: any) => (
                    <tr key={c.code} className="border-b last:border-0 hover:bg-slate-50 transition">
                      <td className="px-4 py-2.5 font-mono font-bold text-slate-800">{c.code}</td>
                      <td className="px-4 py-2.5 font-bold">
                        {c.giftAmount !== undefined ? (
                          <span className="text-emerald-600 font-mono">🎁 {c.giftAmount.toLocaleString()} تومان</span>
                        ) : (
                          <span className="text-indigo-600 font-mono">🎫 {c.discountPercent}٪ تخفیف</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-center text-slate-500 font-mono">
                        {c.usedCount || 0} / {c.maxUsage || '∞'}
                      </td>
                      <td className="px-4 py-2.5 text-left">
                        <button 
                          onClick={() => handleDeleteCoupon(c.code)} 
                          className="text-red-500 hover:text-red-700 p-1"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {(!state.coupons || state.coupons.length === 0) && (
                    <tr>
                      <td colSpan={4} className="px-4 py-6 text-center text-slate-400">هیچ کد تخفیف یا هدیه‌ای تعریف نشده است.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* SECTION 5: Backups */}
      {activeSection === 'backups' && (
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 space-y-6">
          <div className="flex items-center gap-3 border-b pb-4 border-slate-100">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-200 flex items-center justify-center text-indigo-600 font-bold">
              <Download className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-800">پشتیبان‌گیری و بازیابی اطلاعات (Backups & Restore)</h2>
              <p className="text-xs text-slate-500">ایجاد نسخه پشتیبان از کاربران، تنظیمات، محصولات و بازگردانی سریع</p>
            </div>
          </div>

          <div className="space-y-6">
            <div className="flex justify-between items-center bg-slate-50 p-4 rounded-xl border border-slate-200">
              <div>
                <h4 className="text-sm font-bold text-slate-800">ایجاد نقطه بازیابی دستی (Snapshot)</h4>
                <p className="text-xs text-slate-500 mt-0.5">یک نسخه پشتیبان کامل از دیتابیس فعلی روی سرور ذخیره می‌شود.</p>
              </div>
              <button 
                onClick={handleCreateLocalBackup} 
                disabled={actionLoading}
                className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl text-xs font-bold transition shadow-sm"
              >
                ایجاد نقطه بازیابی اکنون
              </button>
            </div>

            {/* Local Backups List */}
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full text-xs text-right">
                <thead className="bg-slate-100 text-slate-600 border-b">
                  <tr>
                    <th className="px-4 py-2.5 font-bold">نام فایل</th>
                    <th className="px-4 py-2.5 font-bold">تاریخ ایجاد</th>
                    <th className="px-4 py-2.5 font-bold">حجم</th>
                    <th className="px-4 py-2.5 font-bold text-left">عملیات</th>
                  </tr>
                </thead>
                <tbody>
                  {localBackups.map((b: any) => (
                    <tr key={b.filename} className="border-b last:border-0 hover:bg-slate-50 transition">
                      <td className="px-4 py-2.5 font-mono text-slate-700">{b.filename}</td>
                      <td className="px-4 py-2.5 text-slate-600">{new Date(b.createdAt).toLocaleString('fa-IR')}</td>
                      <td className="px-4 py-2.5 font-mono text-slate-500">{(b.sizeBytes / 1024).toFixed(1)} KB</td>
                      <td className="px-4 py-2.5 text-left flex items-center justify-end gap-2">
                        <button 
                          onClick={() => handleRestoreLocalBackup(b.filename)} 
                          disabled={actionLoading}
                          className="bg-emerald-50 text-emerald-700 border border-emerald-200 px-2.5 py-1 rounded-lg text-xs font-semibold hover:bg-emerald-100"
                        >
                          بازیابی
                        </button>
                        <button 
                          onClick={() => handleUnlinkLocalBackup(b.filename)} 
                          disabled={actionLoading}
                          className="text-red-500 hover:text-red-700 p-1"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {localBackups.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-4 py-6 text-center text-slate-400">هیچ نقطه بازیابی محلی ذخیره نشده است.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Manual Export & Import */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-slate-200">
              <div className="space-y-3 bg-slate-50 p-4 rounded-xl border border-slate-200">
                <h4 className="text-xs font-bold text-slate-800">📥 دانلود فایل پشتیبان دیتابیس</h4>
                <a 
                  href="/api/backup/plain-download" 
                  download 
                  className="w-full bg-slate-800 hover:bg-slate-900 text-white px-4 py-2.5 rounded-xl text-xs font-bold transition flex items-center justify-center gap-2"
                >
                  <Download className="w-4 h-4" /> دانلود JSON خام
                </a>
              </div>

              <div className="space-y-3 bg-slate-50 p-4 rounded-xl border border-slate-200">
                <h4 className="text-xs font-bold text-slate-800">📤 بازگردانی از فایل JSON</h4>
                <input 
                  type="file" 
                  accept=".json" 
                  onChange={e => setSelectedFile(e.target.files?.[0] || null)} 
                  className="w-full text-xs text-slate-600" 
                />
                <button 
                  onClick={handleRestoreBackup} 
                  disabled={actionLoading}
                  className="w-full bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 rounded-xl text-xs font-bold transition flex items-center justify-center gap-2"
                >
                  <Upload className="w-4 h-4" /> بازگردانی دیتابیس
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
function ProductsView() {
  const [products, setProducts] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [inbounds, setInbounds] = useState<any[]>([]);
  const [rebeccaInbounds, setRebeccaInbounds] = useState<any[]>([]);
  const [form, setForm] = useState({
    name: '',
    price: 0,
    volumeGb: 10,
    durationDays: 30,
    panelType: 'sanaei' as 'sanaei' | 'rebecca' | 'both',
    inboundId: '',
    inboundIds: [] as number[],
    rebeccaInboundTags: [] as string[],
    limitIp: 1,
    categoryId: '',
    isPayAsYouGo: false
  });
  const [newCatName, setNewCatName] = useState('');
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [bulkInboundIds, setBulkInboundIds] = useState<number[]>([]);
  const [bulkRebeccaTags, setBulkRebeccaTags] = useState<string[]>([]);
  const [bulkPanelType, setBulkPanelType] = useState<'sanaei' | 'rebecca' | 'both' | ''>('');

  useEffect(() => {
    fetch('/api/state')
      .then(r => r.json())
      .then(s => {
        setProducts(s.products || []);
        setCategories(s.categories || []);
      });
    
    // Fetch Sanaei inbounds
    fetch('/api/xui-inbounds')
      .then(r => r.json())
      .then(data => {
        if (data && data.success) {
          setInbounds(data.inbounds || []);
        }
      })
      .catch(() => {});

    // Fetch Rebecca inbounds
    fetch('/api/rebecca-inbounds')
      .then(r => r.json())
      .then(data => {
        if (data && data.success) {
          setRebeccaInbounds(data.inbounds || []);
        }
      })
      .catch(() => {});
  }, []);

  const addCategory = async () => {
    if (!newCatName.trim()) return;
    const res = await fetch('/api/categories', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ name: newCatName.trim() })
    });
    const data = await res.json();
    if (data.success) {
      setCategories(data.categories);
      setNewCatName('');
    }
  };

  const deleteCategory = async (id: string) => {
    if(!confirm('آیا از حذف این دسته مطمئن هستید؟ (محصولات این دسته بدون دسته خواهند شد)')) return;
    await fetch(`/api/categories/${id}`, { method: 'DELETE' });
    setCategories(categories.filter(c => c.id !== id));
  };

  const updateCategoryName = async (cat: any, newName: string) => {
    if (!newName.trim()) return;
    const res = await fetch('/api/categories', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ ...cat, name: newName.trim() })
    });
    const data = await res.json();
    if (data.success) {
      setCategories(data.categories);
    }
  };

  const toggleCategoryStatus = async (cat: any) => {
    const res = await fetch('/api/categories', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ ...cat, disabled: !cat.disabled })
    });
    const data = await res.json();
    if (data.success) {
      setCategories(data.categories);
    }
  };

  const addProduct = async () => {
    const payload = {
      ...form,
      id: editingProductId || undefined,
      inboundId: form.inboundId ? parseInt(form.inboundId) : undefined,
      inboundIds: form.inboundIds,
      rebeccaInboundTags: form.rebeccaInboundTags,
      panelType: form.panelType,
      categoryId: form.categoryId || undefined
    };
    const res = await fetch('/api/products', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success) {
      setProducts(data.products);
      cancelEdit();
    }
  };

  const startEditProduct = (p: any) => {
    setEditingProductId(p.id);
    setForm({
      name: p.name || '',
      price: p.price || 0,
      volumeGb: p.volumeGb !== undefined ? p.volumeGb : 10,
      durationDays: p.durationDays !== undefined ? p.durationDays : 30,
      panelType: p.panelType || 'sanaei',
      inboundId: p.inboundId ? String(p.inboundId) : '',
      inboundIds: p.inboundIds || (p.inboundId ? [Number(p.inboundId)] : []),
      rebeccaInboundTags: p.rebeccaInboundTags || [],
      limitIp: p.limitIp !== undefined ? p.limitIp : 1,
      categoryId: p.categoryId || '',
      isPayAsYouGo: p.isPayAsYouGo || false
    });
  };

  const cancelEdit = () => {
    setEditingProductId(null);
    setForm({
      name: '',
      price: 10000,
      volumeGb: 10,
      durationDays: 30,
      panelType: 'sanaei',
      inboundId: '',
      inboundIds: [],
      rebeccaInboundTags: [],
      limitIp: 1,
      categoryId: '',
      isPayAsYouGo: false
    });
  };

  const deleteProduct = async (id: string) => {
    if(!confirm('آیا از حذف این محصول مطمئن هستید؟')) return;
    await fetch(`/api/products/${id}`, { method: 'DELETE' });
    setProducts(products.filter(p => p.id !== id));
  };

  const toggleProductStatus = async (p: any) => {
    const payload = { ...p, disabled: !p.disabled };
    const res = await fetch('/api/products', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success) {
      setProducts(data.products);
    }
  };

  return (
    <div className="max-w-5xl mx-auto" dir="rtl">
       <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 mb-6">
          <h2 className="text-lg font-bold mb-4 flex items-center gap-2"><Box className="w-5 h-5 text-indigo-600"/> مدیریت گروه‌ها (دسته‌بندی‌ها)</h2>
          <div className="flex gap-2">
            <input 
              type="text" 
              value={newCatName} 
              onChange={e => setNewCatName(e.target.value)} 
              placeholder="نام گروه (مثلا: سرورهای آلمان، سرورهای ربکا، اشتراک VIP)"
              className="flex-1 px-3 py-2 border rounded-md focus:ring-2 focus:ring-indigo-500 text-sm"
            />
            <button onClick={addCategory} className="bg-indigo-600 text-white px-4 py-2 rounded-md hover:bg-indigo-700 font-semibold text-sm transition">ثبت گروه</button>
          </div>
          {categories.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {categories.map(c => (
                <div key={c.id} className="bg-slate-100 border border-slate-200 rounded-md px-3 py-1.5 flex items-center gap-2 text-sm text-slate-800">
                  <span className={c.disabled ? 'line-through text-slate-400' : ''}>{c.name} {c.disabled && '(غیرفعال)'}</span>
                  <button onClick={() => {
                     const newName = window.prompt('نام جدید گروه را وارد کنید:', c.name);
                     if (newName !== null) updateCategoryName(c, newName);
                  }} className="text-blue-500 hover:text-blue-700 transition" title="ویرایش نام گروه">
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button onClick={() => toggleCategoryStatus(c)} className={`${c.disabled ? 'text-green-600' : 'text-amber-600'} hover:opacity-80 transition`} title={c.disabled ? 'فعال کردن' : 'غیرفعال کردن'}>
                    {c.disabled ? <CheckCircle className="w-4 h-4" /> : <Box className="w-4 h-4" />}
                  </button>
                  <button onClick={() => deleteCategory(c.id)} className="text-red-500 hover:text-red-700 transition">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
       </div>

       <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 mb-8">
         <h2 className="text-lg font-bold mb-4 flex items-center gap-2"><Plus className="w-5 h-5 text-indigo-600"/> {editingProductId ? 'ویرایش و اصلاح جزئیات محصول انتخابی' : 'تعریف پکیج و محصول جدید (سازگار با سنایی و ربکا)'}</h2>
         
         <div className="space-y-4">
           {/* Panel Selection Selector */}
           <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
             <label className="block text-xs font-bold text-slate-800 mb-2">🌐 پنل ارائه‌دهنده سرویس (نوع سرور ساخت اکانت):</label>
             <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
               <label className={`flex items-center gap-2 p-3 rounded-lg border cursor-pointer transition ${form.panelType === 'sanaei' ? 'bg-blue-50 border-blue-500 text-blue-900 font-bold' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'}`}>
                 <input 
                   type="radio" 
                   name="panelType" 
                   checked={form.panelType === 'sanaei'} 
                   onChange={() => setForm({ ...form, panelType: 'sanaei' })} 
                   className="text-blue-600"
                 />
                 <div className="text-xs">
                   <div className="font-bold flex items-center gap-1">🔵 پنل سنایی (X-UI)</div>
                   <div className="text-[11px] text-slate-500">ساخت اتوماتیک در پنل سنایی</div>
                 </div>
               </label>

               <label className={`flex items-center gap-2 p-3 rounded-lg border cursor-pointer transition ${form.panelType === 'rebecca' ? 'bg-purple-50 border-purple-500 text-purple-900 font-bold' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'}`}>
                 <input 
                   type="radio" 
                   name="panelType" 
                   checked={form.panelType === 'rebecca'} 
                   onChange={() => setForm({ ...form, panelType: 'rebecca' })} 
                   className="text-purple-600"
                 />
                 <div className="text-xs">
                   <div className="font-bold flex items-center gap-1">🟣 پنل ربکا (Rebecca API)</div>
                   <div className="text-[11px] text-slate-500">ساخت اتوماتیک در پنل ربکا</div>
                 </div>
               </label>

               <label className={`flex items-center gap-2 p-3 rounded-lg border cursor-pointer transition ${form.panelType === 'both' ? 'bg-emerald-50 border-emerald-500 text-emerald-900 font-bold' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'}`}>
                 <input 
                   type="radio" 
                   name="panelType" 
                   checked={form.panelType === 'both'} 
                   onChange={() => setForm({ ...form, panelType: 'both' })} 
                   className="text-emerald-600"
                 />
                 <div className="text-xs">
                   <div className="font-bold flex items-center gap-1">🌐 هر دو پنل (Dual Config)</div>
                   <div className="text-[11px] text-slate-500">تولید همزمان کانفیگ در هر دو سرور</div>
                 </div>
               </label>
             </div>
           </div>

           {/* Row 1 fields */}
           <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
             <div className="md:col-span-2">
               <label className="block text-xs font-semibold text-slate-700 mb-1">گروه محصول</label>
               <select value={form.categoryId} onChange={e=>setForm({...form, categoryId: e.target.value})} className="w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-indigo-500 text-sm bg-white">
                 <option value="">بدون گروه (نمایش در لیست اصلی)</option>
                 {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
               </select>
             </div>
             <div>
               <label className="block text-xs font-semibold text-slate-700 mb-1">نام محصول (پکیج)</label>
               <input type="text" value={form.name} onChange={e=>setForm({...form, name: e.target.value})} className="w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-indigo-500 text-sm" placeholder="مثال: ۱ ماهه ۵۰ گیگابایت"/>
             </div>
             <div>
               <label className="block text-xs font-semibold text-slate-700 mb-1">{form.isPayAsYouGo ? 'قیمت هر گیگ (تومان)' : 'قیمت (تومان)'}</label>
               <input type="number" value={form.price} onChange={e=>setForm({...form, price: Number(e.target.value)})} className="w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-indigo-500 text-sm"/>
             </div>
             <div>
               <label className={`block text-xs font-semibold text-slate-700 mb-1 ${form.isPayAsYouGo ? 'opacity-50' : ''}`}>حجم (GB)</label>
               <input type="number" disabled={form.isPayAsYouGo} value={form.isPayAsYouGo ? 0 : form.volumeGb} onChange={e=>setForm({...form, volumeGb: Number(e.target.value)})} className="w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-indigo-500 text-sm disabled:bg-slate-100 disabled:text-slate-400"/>
             </div>
             <div>
               <label className={`block text-xs font-semibold text-slate-700 mb-1 ${form.isPayAsYouGo ? 'opacity-50' : ''}`}>مدت (روز)</label>
               <input type="number" disabled={form.isPayAsYouGo} value={form.isPayAsYouGo ? 0 : form.durationDays} onChange={e=>setForm({...form, durationDays: Number(e.target.value)})} className="w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-indigo-500 text-sm disabled:bg-slate-100 disabled:text-slate-400"/>
             </div>
           </div>

           <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
             <div>
               <label className="block text-xs font-semibold text-slate-700 mb-1">محدودیت تعداد کاربر همزمان (IP Limit):</label>
               <input type="number" value={form.limitIp} onChange={e=>setForm({...form, limitIp: Number(e.target.value)})} className="w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-indigo-500 text-sm"/>
             </div>
             <div className="flex items-center mt-6">
                <label className="flex items-center cursor-pointer">
                  <input type="checkbox" checked={form.isPayAsYouGo} onChange={e => setForm({...form, isPayAsYouGo: e.target.checked})} className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 form-checkbox w-4 h-4" />
                  <span className="mr-2 text-sm font-bold text-slate-800">محصول «پرداخت در ازای مصرف» (PAYG)</span>
                </label>
             </div>
           </div>

           {/* Sanaei Inbounds Section */}
           {(form.panelType === 'sanaei' || form.panelType === 'both') && (
             <div className="p-3 bg-blue-50/50 rounded-lg border border-blue-200">
               <label className="block text-xs font-bold text-blue-900 mb-1.5">🔵 اینباندهای پنل سنایی (X-UI) برای این پکیج:</label>
               {inbounds.length > 0 ? (
                 <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5 p-3 bg-white rounded-lg border max-h-40 overflow-y-auto">
                   {inbounds.map((ib: any) => {
                     const isChecked = form.inboundIds.includes(ib.id) || form.inboundId === String(ib.id);
                     return (
                       <label key={ib.id} className="flex items-center gap-2 text-xs text-slate-700 hover:text-blue-600 cursor-pointer select-none">
                         <input 
                           type="checkbox" 
                           checked={isChecked}
                           onChange={e => {
                             let updatedIds = [...form.inboundIds];
                             if (form.inboundId && !updatedIds.includes(Number(form.inboundId))) {
                               updatedIds.push(Number(form.inboundId));
                             }
                             if (e.target.checked) {
                               if (!updatedIds.includes(ib.id)) updatedIds.push(ib.id);
                             } else {
                               updatedIds = updatedIds.filter(id => id !== ib.id);
                             }
                             setForm({
                               ...form,
                               inboundIds: updatedIds,
                               inboundId: updatedIds[0] ? String(updatedIds[0]) : ''
                             });
                           }}
                           className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                         />
                         <span className="font-medium text-slate-800">{ib.remark}</span>
                         <span className="text-[10px] text-slate-500 font-mono bg-slate-100 px-1 py-0.5 rounded">ID: {ib.id} ({ib.protocol})</span>
                       </label>
                     );
                   })}
                 </div>
               ) : (
                 <div className="flex gap-2">
                   <input 
                     type="text" 
                     value={form.inboundId} 
                     onChange={e=> {
                       const val = e.target.value;
                       const numeric = parseInt(val);
                       setForm({
                         ...form, 
                         inboundId: val, 
                         inboundIds: isNaN(numeric) ? [] : [numeric]
                       });
                     }} 
                     className="w-full px-3 py-2 border rounded-md text-xs font-mono bg-white" 
                     placeholder="آیدی عددی اینباند سنایی (مثلاً 1, 2)"
                   />
                   <span className="text-[10px] text-blue-600 self-center">در صورت وارد نکردن، از اینباند پیش‌فرض سنایی استفاده می‌شود.</span>
                 </div>
               )}
             </div>
           )}

           {/* Rebecca Inbounds Section */}
           {(form.panelType === 'rebecca' || form.panelType === 'both') && (
             <div className="p-3 bg-purple-50/50 rounded-lg border border-purple-200">
               <label className="block text-xs font-bold text-purple-900 mb-1.5">🟣 اینباندهای پنل ربکا (Rebecca Inbounds):</label>
               {rebeccaInbounds.length > 0 ? (
                 <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5 p-3 bg-white rounded-lg border max-h-40 overflow-y-auto">
                   {rebeccaInbounds.map((ib: any) => {
                     const isChecked = form.rebeccaInboundTags.includes(ib.tag);
                     return (
                       <label key={ib.tag} className="flex items-center gap-2 text-xs text-slate-700 hover:text-purple-600 cursor-pointer select-none">
                         <input 
                           type="checkbox" 
                           checked={isChecked}
                           onChange={e => {
                             let updatedTags = [...form.rebeccaInboundTags];
                             if (e.target.checked) {
                               if (!updatedTags.includes(ib.tag)) updatedTags.push(ib.tag);
                             } else {
                               updatedTags = updatedTags.filter(t => t !== ib.tag);
                             }
                             setForm({ ...form, rebeccaInboundTags: updatedTags });
                           }}
                           className="rounded border-slate-300 text-purple-600 focus:ring-purple-500"
                         />
                         <span className="font-medium text-slate-800">{ib.tag}</span>
                         <span className="text-[10px] text-purple-700 font-mono bg-purple-100 px-1 py-0.5 rounded">{ib.protocol || 'VLESS'}</span>
                       </label>
                     );
                   })}
                 </div>
               ) : (
                 <div className="text-xs text-purple-700">
                   💡 تمام پروتکل‌ها و اینباندهای پیش‌فرض ربکا (VLESS, VMess, Trojan) به طور خودکار به این پکیج اختصاص داده خواهند شد.
                 </div>
               )}
             </div>
           )}
         </div>

         <div className="mt-5 text-left flex justify-end gap-2">
            {editingProductId && (
              <button onClick={cancelEdit} className="bg-slate-100 text-slate-700 hover:bg-slate-200 px-4 py-2 rounded-md font-semibold text-sm transition">
                انصراف از ویرایش
              </button>
            )}
            <button onClick={addProduct} className={`${editingProductId ? 'bg-amber-600 hover:bg-amber-700' : 'bg-indigo-600 hover:bg-indigo-700'} text-white px-6 py-2 rounded-md font-semibold text-sm transition`}>
               {editingProductId ? 'ذخیره تغییرات محصول' : 'ثبت و افزودن محصول'}
            </button>
         </div>
       </div>

       {/* بخش عملیات گروهی */}
       {products.length > 0 && (
         <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 mb-6">
           <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
             <div className="flex items-center gap-3">
               <input 
                 type="checkbox" 
                 checked={selectedProductIds.length === products.length && products.length > 0}
                 onChange={(e) => {
                   if (e.target.checked) {
                     setSelectedProductIds(products.map(p => p.id));
                   } else {
                     setSelectedProductIds([]);
                   }
                 }}
                 className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 w-4 h-4 cursor-pointer"
                 id="select-all-products"
               />
               <label htmlFor="select-all-products" className="text-sm font-semibold text-slate-700 cursor-pointer select-none">
                 انتخاب همه محصولات جهت ویرایش گروهی ({products.length} محصول)
               </label>
               {selectedProductIds.length > 0 && (
                 <span className="text-xs bg-indigo-100 text-indigo-800 font-bold px-2 py-0.5 rounded-full">
                   {selectedProductIds.length} محصول انتخاب شده
                 </span>
               )}
             </div>
             
             {selectedProductIds.length > 0 && (
               <button 
                 onClick={() => setSelectedProductIds([])} 
                 className="text-xs text-red-600 hover:text-red-800 font-semibold"
               >
                 لغو انتخاب‌ها
               </button>
             )}
           </div>

           {selectedProductIds.length > 0 && (
             <div className="mt-4 pt-4 border-t border-slate-200 space-y-4">
               <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                 <Settings2 className="w-4 h-4 text-indigo-600" />
                 تنظیمات گروهی محصولات انتخاب شده ({selectedProductIds.length} محصول)
               </h3>

               {/* Bulk Panel Type */}
               <div className="flex items-center gap-4 text-xs">
                 <span className="font-bold text-slate-700">تغییر پنل ارائه‌دهنده:</span>
                 <select 
                   value={bulkPanelType} 
                   onChange={e => setBulkPanelType(e.target.value as any)}
                   className="px-3 py-1.5 border rounded-md bg-white text-xs"
                 >
                   <option value="">بدون تغییر پنل</option>
                   <option value="sanaei">🔵 پنل سنایی (X-UI)</option>
                   <option value="rebecca">🟣 پنل ربکا (Rebecca)</option>
                   <option value="both">🌐 هر دو پنل همزمان (Dual)</option>
                 </select>
               </div>

               {/* Bulk Sanaei inbounds */}
               {inbounds.length > 0 && (
                 <div>
                   <label className="block text-xs font-semibold text-slate-700 mb-1">اینباندهای سنایی برای محصولات انتخابی:</label>
                   <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 p-2.5 bg-white rounded-lg border max-h-32 overflow-y-auto">
                     {inbounds.map((ib: any) => {
                       const isChecked = bulkInboundIds.includes(ib.id);
                       return (
                         <label key={ib.id} className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                           <input 
                             type="checkbox" 
                             checked={isChecked}
                             onChange={e => {
                               let updated = [...bulkInboundIds];
                               if (e.target.checked) {
                                 if (!updated.includes(ib.id)) updated.push(ib.id);
                               } else {
                                 updated = updated.filter(id => id !== ib.id);
                               }
                               setBulkInboundIds(updated);
                             }}
                             className="rounded border-slate-300 text-blue-600"
                           />
                           <span>{ib.remark} (ID: {ib.id})</span>
                         </label>
                       );
                     })}
                   </div>
                 </div>
               )}

               {/* Bulk Rebecca tags */}
               {rebeccaInbounds.length > 0 && (
                 <div>
                   <label className="block text-xs font-semibold text-slate-700 mb-1">اینباندهای ربکا برای محصولات انتخابی:</label>
                   <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 p-2.5 bg-white rounded-lg border max-h-32 overflow-y-auto">
                     {rebeccaInbounds.map((ib: any) => {
                       const isChecked = bulkRebeccaTags.includes(ib.tag);
                       return (
                         <label key={ib.tag} className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                           <input 
                             type="checkbox" 
                             checked={isChecked}
                             onChange={e => {
                               let updated = [...bulkRebeccaTags];
                               if (e.target.checked) {
                                 if (!updated.includes(ib.tag)) updated.push(ib.tag);
                               } else {
                                 updated = updated.filter(t => t !== ib.tag);
                               }
                               setBulkRebeccaTags(updated);
                             }}
                             className="rounded border-slate-300 text-purple-600"
                           />
                           <span>{ib.tag}</span>
                         </label>
                       );
                     })}
                   </div>
                 </div>
               )}

               <div className="flex justify-end gap-2">
                 <button
                   onClick={async () => {
                     if (!confirm(`آیا مطمئن هستید که می‌خواهید تنظیمات ${selectedProductIds.length} محصول انتخابی را بروزرسانی کنید؟`)) {
                       return;
                     }
                     
                     try {
                       const payload: any = {
                         productIds: selectedProductIds
                       };
                       if (bulkPanelType) payload.panelType = bulkPanelType;
                       if (bulkInboundIds.length > 0) {
                         payload.inboundIds = bulkInboundIds;
                         payload.inboundId = bulkInboundIds[0];
                       }
                       if (bulkRebeccaTags.length > 0) {
                         payload.rebeccaInboundTags = bulkRebeccaTags;
                       }

                       const res = await fetch('/api/products/bulk-update-inbounds', {
                         method: 'POST',
                         headers: { 'Content-Type': 'application/json' },
                         body: JSON.stringify(payload)
                       });
                       const data = await res.json();
                       if (data.success) {
                         setProducts(data.products);
                         setSelectedProductIds([]);
                         setBulkInboundIds([]);
                         setBulkRebeccaTags([]);
                         setBulkPanelType('');
                         alert('✅ تنظیمات محصولات با موفقیت به صورت گروهی تغییر یافت.');
                       } else {
                         alert('خطا در اعمال تغییرات: ' + data.message);
                       }
                     } catch (e: any) {
                       alert('خطای ارتباط با سرور: ' + e.message);
                     }
                   }}
                   className="bg-indigo-600 text-white px-4 py-2 rounded-md hover:bg-indigo-700 text-xs font-semibold transition"
                 >
                   اعمال همزمان بر روی {selectedProductIds.length} محصول
                 </button>
               </div>
             </div>
           )}
         </div>
       )}

       <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {products.map(p => {
            const panelType = p.panelType || 'sanaei';
            return (
              <div key={p.id} className={`bg-white border border-slate-200 rounded-xl p-6 shadow-sm flex flex-col hover:shadow-md transition ${p.disabled ? 'opacity-60' : ''}`}>
                 <div className="flex items-start justify-between mb-2 gap-2">
                   <h3 className={`text-base font-bold text-slate-900 ${p.disabled ? 'line-through text-slate-500' : ''}`}>
                     {p.name} {p.disabled && '(غیرفعال)'}
                     {p.isPayAsYouGo && <span className="mr-2 text-[10px] bg-amber-100 text-amber-700 font-bold px-1.5 py-0.5 rounded align-middle">PAYG</span>}
                   </h3>
                   <input 
                     type="checkbox" 
                     checked={selectedProductIds.includes(p.id)}
                     onChange={(e) => {
                       if (e.target.checked) {
                         setSelectedProductIds([...selectedProductIds, p.id]);
                       } else {
                         setSelectedProductIds(selectedProductIds.filter(id => id !== p.id));
                       }
                     }}
                     className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 w-5 h-5 cursor-pointer flex-shrink-0 mt-1"
                   />
                 </div>

                 <div className="flex flex-wrap items-center gap-1.5 mb-3">
                   {panelType === 'both' && (
                     <span className="text-[11px] bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded flex items-center gap-1">
                       🌐 هر دو پنل (دوگانه)
                     </span>
                   )}
                   {panelType === 'rebecca' && (
                     <span className="text-[11px] bg-purple-100 text-purple-800 font-bold px-2 py-0.5 rounded flex items-center gap-1">
                       🟣 پنل ربکا
                     </span>
                   )}
                   {panelType === 'sanaei' && (
                     <span className="text-[11px] bg-blue-100 text-blue-800 font-bold px-2 py-0.5 rounded flex items-center gap-1">
                       🔵 پنل سنایی
                     </span>
                   )}
                   {p.categoryId && (
                     <span className="text-[11px] text-slate-600 bg-slate-100 px-2 py-0.5 rounded">
                       📁 {categories.find(c => c.id === p.categoryId)?.name || 'دسته نامشخص'}
                     </span>
                   )}
                 </div>

                 <div className="text-2xl font-black text-indigo-600 mb-4">
                   {p.price.toLocaleString()} <span className="text-sm font-normal text-slate-500">{p.isPayAsYouGo ? 'تومان / هر گیگ' : 'تومان'}</span>
                 </div>
                 <div className="space-y-2 mb-6 flex-1 text-sm text-slate-700">
                   <div className="flex justify-between border-b pb-1"><span>میزان حجم:</span><span className="font-bold text-slate-800">{p.isPayAsYouGo ? 'نامحدود (PAYG)' : p.volumeGb === 0 ? 'نامحدود' : `${p.volumeGb} GB`}</span></div>
                   <div className="flex justify-between border-b pb-1"><span>مدت زمان:</span><span className="font-bold text-slate-800">{p.isPayAsYouGo ? 'نامحدود' : p.durationDays === 0 ? 'نامحدود' : `${p.durationDays} روز`}</span></div>
                   <div className="flex justify-between border-b pb-1"><span>محدودیت IP:</span><span className="font-bold text-slate-800">{p.limitIp || 0}</span></div>
                   {(panelType === 'sanaei' || panelType === 'both') && (
                     <div className="flex justify-between pb-1 border-b">
                       <span>اینباندهای سنایی:</span>
                       <span className="font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded text-[11px]">
                         {p.inboundIds && p.inboundIds.length > 0 
                           ? p.inboundIds.map((id: number) => `ID ${id}`).join(', ') 
                           : (p.inboundId ? `ID ${p.inboundId}` : 'پیشفرض')}
                       </span>
                     </div>
                   )}
                   {(panelType === 'rebecca' || panelType === 'both') && (
                     <div className="flex justify-between pb-1">
                       <span>اینباندهای ربکا:</span>
                       <span className="font-bold text-purple-600 bg-purple-50 px-2 py-0.5 rounded text-[11px]">
                         {p.rebeccaInboundTags && p.rebeccaInboundTags.length > 0
                           ? p.rebeccaInboundTags.join(', ')
                           : 'همه اینباندها (پیش‌فرض)'}
                       </span>
                     </div>
                   )}
                 </div>
                 <div className="flex gap-2 w-full mt-2">
                    <button onClick={() => startEditProduct(p)} className="flex-1 py-1.5 flex items-center justify-center gap-1 text-amber-600 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-md transition font-medium text-xs">
                      <Edit2 className="w-3.5 h-3.5" /> <span>ویرایش</span>
                    </button>
                    <button onClick={() => toggleProductStatus(p)} className={`flex-1 py-1.5 flex items-center justify-center gap-1 ${p.disabled ? 'text-green-600 bg-green-50 border-green-200' : 'text-slate-600 bg-slate-50 border-slate-200'} border rounded-md transition font-medium text-xs`} title={p.disabled ? 'فعال کردن' : 'غیرفعال کردن'}>
                      {p.disabled ? <CheckCircle className="w-3.5 h-3.5" /> : <Box className="w-3.5 h-3.5" />} <span>{p.disabled ? 'فعال' : 'غیرفعال'}</span>
                    </button>
                    <button onClick={() => deleteProduct(p.id)} className="flex-1 py-1.5 flex items-center justify-center gap-1 text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 rounded-md transition font-medium text-xs">
                      <Trash2 className="w-3.5 h-3.5" /> <span>حذف</span>
                    </button>
                 </div>
              </div>
            );
          })}
          {products.length === 0 && (
            <div className="col-span-full bg-slate-100/50 text-slate-500 text-center p-12 rounded-xl border border-dashed">هنوز هیچ پکیجی ثبت نکرده‌اید. از بخش بالا پکیج جدید تعریف کنید.</div>
          )}
       </div>
    </div>
  );
}

function UsersView() {
  const [users, setUsers] = useState<any[]>([]);

  useEffect(() => {
    fetch('/api/state').then(r => r.json()).then(s => setUsers(s.users || []));
  }, []);

  const charge = async (chatId: number) => {
    const amount = prompt("Enter amount to add (Toman):", "10000");
    if (!amount) return;
    const res = await fetch(`/api/users/${chatId}/charge`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ amount: Number(amount) })
    });
    const data = await res.json();
    if(data.success) {
      setUsers(users.map(u => u.chatId === chatId ? {...u, balance: data.balance} : u));
    }
  };

  const toggleSeller = async (chatId: number, currentStatus: boolean) => {
    if(!confirm(`آیا از تغییر نقش این کاربر به ${currentStatus ? 'کاربر عادی' : 'فروشنده'} مطمئن هستید؟`)) return;
    const res = await fetch(`/api/users/${chatId}/role`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ isSeller: !currentStatus })
    });
    const data = await res.json();
    if(data.success) {
      setUsers(users.map(u => u.chatId === chatId ? {...u, isSeller: !currentStatus, debt: !currentStatus ? (u.debt || 0) : u.debt} : u));
    }
  };

  const settleDebt = async (chatId: number) => {
    if(!confirm('آیا از صفر کردن بدهی این فروشنده مطمئن هستید؟ (تسویه حساب)')) return;
    const res = await fetch(`/api/users/${chatId}/settle`, { method: 'POST' });
    const data = await res.json();
    if(data.success) {
      setUsers(users.map(u => u.chatId === chatId ? {...u, debt: 0} : u));
    }
  };

  const toggleTest = async (chatId: number, currentStatus: boolean) => {
    const res = await fetch(`/api/users/${chatId}/reset-test`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ testUsed: !currentStatus })
    });
    const data = await res.json();
    if(data.success) {
      setUsers(users.map(u => u.chatId === chatId ? {...u, testUsed: !currentStatus} : u));
    }
  };

  return (
    <div className="max-w-5xl mx-auto" dir="rtl">
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <table className="w-full text-right">
          <thead className="bg-slate-50 border-b">
            <tr>
              <th className="px-6 py-4 font-semibold text-slate-600">کاربر / آیدی</th>
              <th className="px-6 py-4 font-semibold text-slate-600">نقش</th>
              <th className="px-6 py-4 font-semibold text-slate-600">موجودی / بدهی</th>
              <th className="px-6 py-4 font-semibold text-slate-600">تاریخ ثبت نام</th>
              <th className="px-6 py-4 font-semibold text-slate-600 text-left">عملیات</th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.chatId} className="border-b last:border-0 hover:bg-slate-50 transition">
                <td className="px-6 py-4">
                  <div className="font-medium text-slate-900" dir="ltr">{u.username ? `@${u.username}` : 'No Username'}</div>
                  <div className="text-sm text-slate-500 font-mono" dir="ltr">{u.chatId}</div>
                  <div className="mt-1">
                    {u.testUsed ? (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-amber-50 text-amber-700 border border-amber-200 font-semibold">🚫 تست استفاده شده</span>
                    ) : (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-teal-50 text-teal-700 border border-teal-200 font-semibold">✅ تست مجاز</span>
                    )}
                  </div>
                </td>
                <td className="px-6 py-4">
                  {u.isSeller ? (
                    <div>
                      <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-700 mb-1">فروشنده</span>
                    </div>
                  ) : (
                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-600">کاربر عادی</span>
                  )}
                </td>
                <td className="px-6 py-4">
                  {u.isSeller ? (
                     <div>
                       <div className="text-sm font-bold text-red-600">بدهی: {(u.debt || 0).toLocaleString()} ت</div>
                       <div className="text-xs text-slate-500 mt-1">فروش: {(u.totalSales || 0).toLocaleString()} ت</div>
                     </div>
                  ) : (
                     <div className="font-mono text-emerald-600 font-semibold text-sm">{(u.balance || 0).toLocaleString()} ت</div>
                  )}
                </td>
                <td className="px-6 py-4 text-sm text-slate-500">{new Date(u.registeredAt).toLocaleDateString('fa-IR')}</td>
                <td className="px-6 py-4 text-left flex items-center justify-end gap-2">
                  <button onClick={() => toggleTest(u.chatId, !!u.testUsed)} className={`px-2.5 py-1.5 rounded-md font-medium text-xs transition ${u.testUsed ? 'bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200' : 'bg-slate-50 text-slate-400 hover:bg-slate-150 border border-slate-200'}`}>
                    {u.testUsed ? '🔄 فعال‌سازی تست مجدد' : 'علامت تست‌شده'}
                  </button>
                  <button onClick={() => toggleSeller(u.chatId, !!u.isSeller)} className="px-3 py-1.5 bg-slate-100 text-slate-700 hover:bg-slate-200 rounded-md font-medium text-xs transition">
                    تغییر نقش
                  </button>
                  {u.isSeller ? (
                     <button onClick={() => settleDebt(u.chatId)} className="px-3 py-1.5 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-md font-medium text-xs transition">
                       تسویه حساب
                     </button>
                  ) : (
                     <button onClick={() => charge(u.chatId)} className="inline-flex items-center px-3 py-1.5 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-md font-medium text-xs transition">
                       <BatteryCharging className="w-4 h-4 ml-1" /> شارژ موجودی
                     </button>
                  )}
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr><td colSpan={5} className="px-6 py-8 text-center text-slate-500">هنوز کاربری ثبت نشده است.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function parseAmountInput(input: any): number | null {
  if (input === null || input === undefined) return null;
  let str = String(input).trim().toLowerCase();
  if (str === '') return null;
  
  if (['0', 'آزاد', 'نامحدود', 'سقف آزاد', 'unlimited', 'free', '-1', 'ندارد'].includes(str)) {
    return 0;
  }
  
  // Convert Persian & Arabic digits
  str = str.replace(/[۰-۹]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 1728));
  str = str.replace(/[٠-٩]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 1584));
  
  // Check for million / ملیون / میلیون / mil / million / m
  const millionMatch = str.match(/([\d\.]+)\s*(میلیون|ملیون|mil|million|m)/i);
  if (millionMatch) {
    const num = parseFloat(millionMatch[1]);
    if (!isNaN(num)) return Math.round(num * 1000000);
  }
  
  // Check for thousand / هزار / k / thousand / hezar
  const thousandMatch = str.match(/([\d\.]+)\s*(هزار|k|thousand|hezar)/i);
  if (thousandMatch) {
    const num = parseFloat(thousandMatch[1]);
    if (!isNaN(num)) return Math.round(num * 1000);
  }
  
  // Remove non-numeric characters except digits and decimal point
  str = str.replace(/[^\d\.]/g, '');
  const num = parseFloat(str);
  return isNaN(num) ? null : Math.round(num);
}

function SellersView() {
  const [users, setUsers] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [newChatId, setNewChatId] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newLimit, setNewLimit] = useState('1000000');
  const [loading, setLoading] = useState(false);
  
  const [discountModalUser, setDiscountModalUser] = useState<any>(null);
  const [editingDiscounts, setEditingDiscounts] = useState<any[]>([]);
  const [servicesModalUser, setServicesModalUser] = useState<any>(null);

  const handleSettlePaygPurchase = async (chatId: number, purchaseId: string) => {
    if (!confirm('آیا مطمئن هستید که می‌خواهید حجم دوره جاری این سرویس مصرف آزاد (PAYG) را تسویه کنید؟\nحجم مصرفی فعلی به عنوان مبنای جدید در نظر گرفته می‌شود و محاسبه بدهی از این به بعد اعمال خواهد شد.')) return;
    try {
      const res = await fetch(`/api/users/${chatId}/purchases/${purchaseId}/settle-payg`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        alert(data.message || 'با موفقیت تسویه شد.');
        if (data.users) setUsers(data.users);
        if (data.user) setServicesModalUser(data.user);
      } else {
        alert('خطا: ' + (data.message || 'نامشخص'));
      }
    } catch (e: any) {
      alert('خطای شبکه: ' + e.message);
    }
  };

  const handleSetBaseVolume = async (chatId: number, purchaseId: string, currentBaseGb: number) => {
    const val = prompt('حجم مبنای محاسبه را به گیگابایت (GB) وارد نمایید:\n(ترافیک تا این سقف به عنوان تسویه‌شده در نظر گرفته شده و محاسبه بدهی از این عدد به بعد انجام می‌شود)', String(currentBaseGb.toFixed(2)));
    if (val === null) return;
    const numGb = parseFloat(val);
    if (isNaN(numGb) || numGb < 0) {
      alert('مقدار گیگابایت وارد شده معتبر نیست.');
      return;
    }
    try {
      const res = await fetch(`/api/users/${chatId}/purchases/${purchaseId}/set-base-volume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseGb: numGb })
      });
      const data = await res.json();
      if (data.success) {
        alert(data.message || 'حجم مبنا با موفقیت تنظیم گردید.');
        if (data.users) setUsers(data.users);
        if (data.user) setServicesModalUser(data.user);
      } else {
        alert('خطا: ' + (data.message || 'نامشخص'));
      }
    } catch (e: any) {
      alert('خطای شبکه: ' + e.message);
    }
  };

  const fetchUsers = () => {
    fetch('/api/state')
      .then((r) => r.json())
      .then((s) => {
        setUsers(s.users || []);
        setProducts(s.products || []);
        setCategories(s.categories || []);
      });
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const sellers = users.filter((u) => u.isSeller);

  const handleAddSeller = async (e: any) => {
    e.preventDefault();
    if (!newChatId) {
      alert('شناسه عددی کاربری الزامی است.');
      return;
    }
    setLoading(true);
    try {
      const parsedLimit = parseAmountInput(newLimit);
      const isUnlimited = parsedLimit !== null && parsedLimit <= 0;
      const finalLimit = isUnlimited ? 0 : (parsedLimit === null ? 1000000 : parsedLimit);
      const res = await fetch('/api/users/add-seller', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatId: newChatId,
          username: newUsername,
          debtLimit: finalLimit,
          isUnlimitedLimit: isUnlimited,
        }),
      });
      const data = await res.json();
      if (data.success) {
        alert('همکار جدید با موفقیت اضافه شد.');
        setUsers(data.users || []);
        setNewChatId('');
        setNewUsername('');
        setNewLimit('1000000');
      } else {
        alert('خطا: ' + data.message);
      }
    } catch (err: any) {
      alert('خطای اتصال: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const settleDebt = async (chatId: number) => {
    if (
      !confirm(
        'آیا مطمئن هستید که می‌خواهید بدهی مالی و حجمی این همکار را تسویه (صفر) کنید؟ مبلغ بدهی به مجموع واریزی‌های همکار اضافه می‌شود.'
      )
    )
      return;
    const res = await fetch(`/api/users/${chatId}/settle`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      setUsers(
        users.map((u) =>
          u.chatId === chatId ? { ...u, debt: 0, debtVolume: 0, totalPayments: data.totalPayments } : u
        )
      );
      alert('حساب بدهی همکار با موفقیت تسویه گردید.');
    }
  };

  const recalculateSeller = async (chatId: number) => {
    try {
      const res = await fetch(`/api/users/${chatId}/recalculate`, { method: 'POST' });
      const data = await res.json();
      if (data.success && data.user) {
        setUsers(users.map((u) => (u.chatId === chatId ? data.user : u)));
        alert('تراز مالی، تخفیفات و بدهی همکار با موفقیت محاسبه مجدد و همگام‌سازی شد.');
      } else {
        alert('خطا در محاسبه مجدد: ' + (data.message || 'نامشخص'));
      }
    } catch (e: any) {
      alert('خطای اتصال: ' + e.message);
    }
  };

  const toggleUnlimitedLimit = async (chatId: number, currentUnlimited: boolean) => {
    const newUnlimited = !currentUnlimited;
    const res = await fetch(`/api/users/${chatId}/seller-limits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        isUnlimitedLimit: newUnlimited,
        debtLimit: newUnlimited ? 0 : 1000000,
      }),
    });
    const data = await res.json();
    if (data.success) {
      setUsers(
        users.map((u) =>
          u.chatId === chatId
            ? {
                ...u,
                isUnlimitedLimit: newUnlimited,
                debtLimit: newUnlimited ? 0 : (u.debtLimit && u.debtLimit > 0 ? u.debtLimit : 1000000),
              }
            : u
        )
      );
    }
  };

  const changeLimits = async (chatId: number, currentLimit?: number, currentVolumeGob?: number, currentDebt?: number, currentDiscount?: number, isUnlimited?: boolean) => {
    const limitPrompt = prompt(
      'سقف بدهی مجاز همکار را وارد کنید (به تومان، مثلاً 4000000 یا ۴ میلیون | برای سقف آزاد عدد 0 یا کلمه «آزاد» را وارد نمایید):',
      isUnlimited ? '0' : String(currentLimit || 1000000)
    );
    if (limitPrompt === null) return;
    const parsedLimit = parseAmountInput(limitPrompt);
    if (parsedLimit === null || parsedLimit < 0) {
      alert('مقدار سقف بدهی وارد شده معتبر نیست.');
      return;
    }

    const valVolumePrompt = prompt(
      'حجم بدهی همکار را وارد کنید (گیگابایت):',
      String(currentVolumeGob || 0)
    );
    if (valVolumePrompt === null) return;
    const parsedVolume = parseAmountInput(valVolumePrompt);
    const newVolumeNum = parsedVolume !== null ? parsedVolume : Number(valVolumePrompt);
    if (isNaN(newVolumeNum)) {
      alert('مقدار حجم بدهی وارد شده معتبر نیست.');
      return;
    }

    const valDebtPrompt = prompt(
      'میزان بدهی مالی فعلی همکار را وارد کنید (تومان - مثلاً 0 یا 50000):',
      String(currentDebt || 0)
    );
    if (valDebtPrompt === null) return;
    const parsedDebt = parseAmountInput(valDebtPrompt);
    const newDebtNum = parsedDebt !== null ? parsedDebt : Number(valDebtPrompt);
    if (isNaN(newDebtNum)) {
      alert('مقدار بدهی مالی وارد شده معتبر نیست.');
      return;
    }

    const valDiscountPrompt = prompt(
      'درصد تخفیف اختصاصی همکار (از 0 تا 100 وارد کنید):',
      String(currentDiscount || 0)
    );
    if (valDiscountPrompt === null) return;
    const newDiscountNum = Number(valDiscountPrompt);
    if (isNaN(newDiscountNum) || newDiscountNum < 0 || newDiscountNum > 100) {
      alert('درصد تخفیف باید عددی بین صفر تا 100 باشد.');
      return;
    }

    const newIsUnlimited = parsedLimit === 0;

    const res = await fetch(`/api/users/${chatId}/seller-limits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        debtLimit: parsedLimit,
        debtVolume: newVolumeNum,
        debt: newDebtNum,
        sellerDiscount: newDiscountNum,
        isUnlimitedLimit: newIsUnlimited,
      }),
    });
    const data = await res.json();
    if (data.success) {
      if (data.users) {
        setUsers(data.users);
      } else if (data.user) {
        setUsers(users.map((u) => (u.chatId === chatId ? data.user : u)));
      }
      alert('تغییرات با موفقیت ذخیره گردید.');
    }
  };

  const removeSeller = async (chatId: number) => {
    if (
      !confirm(
        'آیا از لغو نقش همکار به کاربر عادی مطمئن هستید؟ بدهی‌های او پاک نخواهد شد.'
      )
    )
      return;
    const res = await fetch(`/api/users/${chatId}/role`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isSeller: false }),
    });
    const data = await res.json();
    if (data.success) {
      setUsers(
        users.map((u) => (u.chatId === chatId ? { ...u, isSeller: false } : u))
      );
      alert('دسترسی همکار لغو گردید.');
    }
  };

  const openDiscountModal = (user: any) => {
    setDiscountModalUser(user);
    setEditingDiscounts(user.sellerDiscounts || []);
  };

  const saveDiscounts = async () => {
    if (!discountModalUser) return;
    try {
      const res = await fetch(`/api/users/${discountModalUser.chatId}/seller-limits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sellerDiscounts: editingDiscounts,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setUsers(
          users.map((u) =>
            u.chatId === discountModalUser.chatId
              ? { ...u, sellerDiscounts: editingDiscounts }
              : u
          )
        );
        alert('تخفیف‌های پیشرفته با موفقیت ذخیره شد.');
        setDiscountModalUser(null);
      }
    } catch (e: any) {
      alert('خطا در ذخیره: ' + e.message);
    }
  };

  const deleteRule = (index: number) => {
    setEditingDiscounts(editingDiscounts.filter((_, i) => i !== index));
  };
  const addRule = (type: 'global' | 'category' | 'product') => {
    setEditingDiscounts([...editingDiscounts, { type, targetId: '', percent: 0 }]);
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6" dir="rtl">
      {/* Discount Modal */}
      {discountModalUser && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-2xl max-h-[90vh] flex flex-col">
             <div className="flex justify-between items-center mb-4">
               <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                 <Percent className="w-5 h-5 text-indigo-600" />
                 تخفیف‌های اختصاصی: {discountModalUser.username ? `@${discountModalUser.username}` : discountModalUser.chatId}
               </h3>
               <button onClick={() => setDiscountModalUser(null)} className="text-slate-500 hover:text-slate-800"><X className="w-5 h-5" /></button>
             </div>
             
             <div className="overflow-y-auto flex-1 mb-4 space-y-3">
                <p className="text-sm text-slate-600 mb-2 leading-relaxed">
                  سیستم هوشمند تخفیف بدین صورت عمل می‌کند که برای هر خرید نماینده، <strong>بیشترین</strong> درصد تخفیف اختصاصی که مربوط به آن محصول یا گروهِ محصول است، اعمال می‌گردد. (مورد اولویت بالاتر دارد)
                </p>
                {editingDiscounts.map((rule, idx) => (
                  <div key={idx} className="flex gap-2 items-center bg-slate-50 p-2 border border-slate-200 rounded-lg">
                    <select 
                      value={rule.type} 
                      onChange={e => {
                        const newRules = [...editingDiscounts];
                        newRules[idx].type = e.target.value as 'global'|'category'|'product';
                        newRules[idx].targetId = '';
                        setEditingDiscounts(newRules);
                      }}
                      className="px-2 py-1.5 border rounded-md text-sm bg-white min-w-[120px]"
                    >
                      <option value="global">عمومی (همه)</option>
                      <option value="category">یک گروه خاص</option>
                      <option value="product">یک محصول خاص</option>
                    </select>
                    
                    {rule.type === 'category' && (
                      <select 
                        value={rule.targetId || ''} 
                        onChange={e => {
                          const newRules = [...editingDiscounts];
                          newRules[idx].targetId = e.target.value;
                          setEditingDiscounts(newRules);
                        }}
                        className="flex-1 px-2 py-1.5 border rounded-md text-sm bg-white"
                      >
                         <option value="">انتخاب گروه...</option>
                         {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    )}
                    
                    {rule.type === 'product' && (
                      <select 
                        value={rule.targetId || ''} 
                        onChange={e => {
                          const newRules = [...editingDiscounts];
                          newRules[idx].targetId = e.target.value;
                          setEditingDiscounts(newRules);
                        }}
                        className="flex-1 px-2 py-1.5 border rounded-md text-sm bg-white"
                      >
                         <option value="">انتخاب پکیج...</option>
                         {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    )}
                    
                    {rule.type === 'global' && <div className="flex-1 text-xs text-slate-500 mr-2">شامل تمامی محصولات می‌گردد</div>}

                    <div className="flex items-center gap-1">
                      <span className="text-xs text-slate-700 font-medium">درصد:</span>
                      <input 
                        type="number" min="0" max="100" 
                        value={rule.percent} 
                        onChange={e => {
                          const newRules = [...editingDiscounts];
                          newRules[idx].percent = Number(e.target.value);
                          setEditingDiscounts(newRules);
                        }}
                        className="w-16 px-2 py-1.5 border rounded-md text-sm text-center focus:ring-2 focus:ring-indigo-500" 
                      />
                    </div>
                    
                    <button onClick={() => deleteRule(idx)} className="p-1.5 text-red-500 hover:bg-red-50 rounded-md transition mr-1">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
                {editingDiscounts.length === 0 && <p className="text-sm text-slate-500 text-center py-4">بدون تخفیف اختصاصی.</p>}
             </div>
             
             <div className="flex items-center gap-2 mb-4 border-t pt-4">
                <span className="text-sm font-semibold text-slate-700">افزودن قانون تخفیف:</span>
                <button onClick={() => addRule('global')} className="px-3 py-1.5 bg-slate-100 text-slate-700 hover:bg-slate-200 rounded-md text-xs font-medium transition">عمومی (+)</button>
                <button onClick={() => addRule('category')} className="px-3 py-1.5 bg-slate-100 text-slate-700 hover:bg-slate-200 rounded-md text-xs font-medium transition">برای گروه خاص (+)</button>
                <button onClick={() => addRule('product')} className="px-3 py-1.5 bg-slate-100 text-slate-700 hover:bg-slate-200 rounded-md text-xs font-medium transition">برای محصول خاص (+)</button>
             </div>
             
             <div className="flex gap-2 justify-end pt-2 border-t mt-auto">
               <button onClick={() => setDiscountModalUser(null)} className="px-4 py-2 text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-md transition font-medium text-sm">انصراف</button>
               <button onClick={saveDiscounts} className="px-5 py-2 text-white bg-indigo-600 hover:bg-indigo-700 rounded-md transition font-semibold text-sm flex items-center gap-1.5"><Save className="w-4 h-4" /> ذخیره تخفیف‌ها</button>
             </div>
          </div>
        </div>
      )}

      {/* Services & PAYG Modal */}
      {servicesModalUser && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-4xl max-h-[90vh] flex flex-col">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <Package className="w-5 h-5 text-indigo-600" />
                سرویس‌ها و کانفیگ‌های همکار: {servicesModalUser.username ? `@${servicesModalUser.username}` : servicesModalUser.chatId}
              </h3>
              <button onClick={() => setServicesModalUser(null)} className="text-slate-500 hover:text-slate-800"><X className="w-5 h-5" /></button>
            </div>

            <div className="overflow-y-auto flex-1 mb-4 space-y-3">
              {(!servicesModalUser.purchases || servicesModalUser.purchases.length === 0) ? (
                <div className="p-8 text-center text-slate-500 bg-slate-50 rounded-lg">
                  هیچ سرویسی برای این همکار ثبت نشده است.
                </div>
              ) : (
                <div className="space-y-3">
                  {servicesModalUser.purchases.map((p: any) => {
                    const totalUsedGb = ((p.lastUsedBytes || 0) / (1024 * 1024 * 1024));
                    const baseSettledGb = ((p.baseSettledBytes || 0) / (1024 * 1024 * 1024));
                    const currentPeriodGb = Math.max(0, totalUsedGb - baseSettledGb);
                    const rawPricePerGb = p.originalPricePerGb || p.pricePerGb || 0;
                    const discountPct = p.discountPercent !== undefined ? p.discountPercent : (servicesModalUser.sellerDiscount || 0);
                    const netPricePerGb = Math.round(rawPricePerGb * (1 - discountPct / 100));
                    const currentAccruedCost = Math.ceil(currentPeriodGb * netPricePerGb);

                    return (
                      <div key={p.id} className="border border-slate-200 rounded-lg p-4 bg-slate-50 hover:bg-white transition">
                        <div className="flex justify-between items-start flex-wrap gap-2 mb-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-slate-800">{p.name || 'سرویس'}</span>
                              {p.isPayAsYouGo ? (
                                <span className="bg-amber-100 text-amber-800 text-[11px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                                  ⚡ مصرف آزاد (PAYG)
                                </span>
                              ) : (
                                <span className="bg-slate-200 text-slate-700 text-[11px] font-medium px-2 py-0.5 rounded-full">
                                  حجمی ثابت ({p.volume} GB)
                                </span>
                              )}
                              {p.isDeleted && (
                                <span className="bg-red-100 text-red-700 text-[11px] font-medium px-2 py-0.5 rounded-full">
                                  حذف شده
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-slate-500 font-mono mt-1" dir="ltr">
                              ID: {p.id}
                            </div>
                          </div>
                          <div className="text-left" dir="ltr">
                            <span className="text-xs text-slate-400">تاریخ خرید:</span>{' '}
                            <span className="text-xs text-slate-600 font-mono">
                              {p.purchasedAt ? new Date(p.purchasedAt).toLocaleDateString('fa-IR') : '—'}
                            </span>
                          </div>
                        </div>

                        {p.isPayAsYouGo ? (
                          <div className="bg-white border border-slate-200 rounded-lg p-3 space-y-3">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
                              <div className="bg-slate-50 p-2 rounded">
                                <span className="text-[11px] text-slate-500 block">کل مصرف ثبت‌شده</span>
                                <span className="font-bold text-sm font-mono text-slate-800">{totalUsedGb.toFixed(2)} GB</span>
                              </div>
                              <div className="bg-emerald-50 p-2 rounded border border-emerald-100">
                                <span className="text-[11px] text-emerald-700 block">حجم تسویه‌شده (مبنا)</span>
                                <span className="font-bold text-sm font-mono text-emerald-800">{baseSettledGb.toFixed(2)} GB</span>
                              </div>
                              <div className="bg-amber-50 p-2 rounded border border-amber-100">
                                <span className="text-[11px] text-amber-700 block">مصرف دوره جاری (بدهی)</span>
                                <span className="font-bold text-sm font-mono text-amber-800">{currentPeriodGb.toFixed(2)} GB</span>
                              </div>
                              <div className="bg-indigo-50 p-2 rounded border border-indigo-100">
                                <span className="text-[11px] text-indigo-700 block">مبلغ دوره جاری</span>
                                <span className="font-bold text-sm font-mono text-indigo-800">{currentAccruedCost.toLocaleString()} تومان</span>
                              </div>
                            </div>

                            <div className="flex items-center justify-between pt-2 border-t border-slate-100 flex-wrap gap-2 text-xs">
                              <div className="text-slate-500">
                                نرخ هر گیگ: <span className="font-mono font-semibold text-slate-700">{netPricePerGb.toLocaleString()}</span> تومان (با {discountPct}% تخفیف)
                              </div>
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => handleSettlePaygPurchase(servicesModalUser.chatId, p.id)}
                                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded font-medium text-xs transition flex items-center gap-1 shadow-sm"
                                  title="انتقال کل مصرف فعلی به حجم مبنا تا از این حجم به بعد محاسبه شود"
                                >
                                  <CheckCircle className="w-3.5 h-3.5" />
                                  تسویه دوره جاری (تنظیم مبنا روی {totalUsedGb.toFixed(2)} GB)
                                </button>
                                <button
                                  onClick={() => handleSetBaseVolume(servicesModalUser.chatId, p.id, baseSettledGb)}
                                  className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded font-medium text-xs transition flex items-center gap-1 border border-slate-200"
                                >
                                  <Edit2 className="w-3.5 h-3.5" />
                                  تنظیم دستی مبنا
                                </button>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="bg-white border border-slate-200 rounded-lg p-3 text-xs flex justify-between items-center">
                            <div>
                              حجم کل: <span className="font-bold font-mono">{p.volume} GB</span> | مصرف: <span className="font-mono">{totalUsedGb.toFixed(2)} GB</span>
                            </div>
                            <div>
                              قیمت پکیج: <span className="font-bold font-mono text-slate-800">{(p.price || 0).toLocaleString()} تومان</span>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex justify-end pt-3 border-t">
              <button
                onClick={() => setServicesModalUser(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md font-medium text-sm transition"
              >
                بستن
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Introduction Banner */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
        <h3 className="text-lg font-bold text-slate-900 mb-2">👥 پنل اختصاصی مدیریت نمایندگان (همکاران فروشنده)</h3>
        <p className="text-sm text-slate-600 leading-relaxed">
          در این بخش می‌توانید حساب‌های همکاران و نمایندگان فروش خود را مدیریت کنید. کارهای آنها به سقف اعتباری که مشخص می‌کنید محدود شده است و خریدهای آنها در پنل سنایی به صورت خودکار تحت فولدری با آیدی تلگرام آنها گروه بندی می‌شود.
        </p>
      </div>

      {/* Add Seller Form */}
      <form onSubmit={handleAddSeller} className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
        <h4 className="font-semibold text-slate-800 mb-4 flex items-center gap-2 text-right justify-start flex-row-reverse">
          <span className="ml-auto">افزودن نماینده همکار جدید</span>
          <Plus className="w-5 h-5 text-indigo-600" />
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
          <div className="text-right">
            <label className="block text-xs font-medium text-slate-700 mb-1">شناسه عددی تلگرام (Chat ID)</label>
            <input
              type="text"
              required
              placeholder="مثلا 14023924"
              value={newChatId}
              onChange={(e) => setNewChatId(e.target.value)}
              className="w-full px-3 py-2 border rounded-md text-sm font-mono text-left"
              dir="ltr"
            />
          </div>
          <div className="text-right">
            <label className="block text-xs font-medium text-slate-700 mb-1">آیدی تلگرام بدون @ (نام کاربری)</label>
            <input
              type="text"
              placeholder="مثلا PartnerVPN"
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              className="w-full px-3 py-2 border rounded-md text-sm font-mono text-left"
              dir="ltr"
            />
          </div>
          <div className="text-right">
            <label className="block text-xs font-medium text-slate-700 mb-1">سقف بدهی اولیه (تومان - 0 یعنی سقف آزاد)</label>
            <input
              type="number"
              placeholder="1000000 (یا 0 برای آزاد)"
              value={newLimit}
              onChange={(e) => setNewLimit(e.target.value)}
              className="w-full px-3 py-2 border rounded-md text-sm text-left font-mono"
              dir="ltr"
            />
          </div>
          <div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-indigo-600 text-white py-2 px-4 rounded-md hover:bg-indigo-700 transition font-semibold text-sm h-10 flex items-center justify-center gap-1"
            >
              <Plus className="w-4 h-4 animate-pulse" /> <span>ثبت نماینده جدید</span>
            </button>
          </div>
        </div>
      </form>

      {/* Sellers List Table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <table className="w-full text-right">
          <thead className="bg-slate-50 border-b">
            <tr>
              <th className="px-6 py-4 font-semibold text-slate-600">همکار / شناسه‌تلگرام</th>
              <th className="px-6 py-4 font-semibold text-slate-600">بدهی مالی / سقف خرید</th>
              <th className="px-6 py-4 font-semibold text-slate-600">کل بدهی حجمی (GB)</th>
              <th className="px-6 py-4 font-semibold text-slate-600">کل فروش تجمعی</th>
              <th className="px-6 py-4 font-semibold text-slate-600 text-left">عملیات مدیریت</th>
            </tr>
          </thead>
          <tbody>
            {sellers.map((u) => {
              const currentDebt = u.debt || 0;
              const isUnlimited = u.isUnlimitedLimit || (u.debtLimit !== undefined && u.debtLimit <= 0);
              const limit = u.debtLimit !== undefined && u.debtLimit > 0 ? u.debtLimit : 1000000;
              const remains = isUnlimited ? null : Math.max(0, limit - currentDebt);
              return (
                <tr key={u.chatId} className="border-b last:border-0 hover:bg-slate-50 transition">
                  <td className="px-6 py-4">
                    <div className="font-bold text-slate-900" dir="ltr">
                      {u.username ? `@${u.username}` : 'No Username'}
                    </div>
                    <div className="text-xs text-slate-500 font-mono" dir="ltr">
                      {u.chatId}
                    </div>
                    <div className="text-[10px] text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded inline-block mt-1">
                      گروه: {u.username ? u.username : `Seller_${u.chatId}`}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm font-bold text-red-650">
                      بدهی: <span className="font-mono">{currentDebt.toLocaleString()}</span> تومان
                    </div>
                    <div className="text-xs text-slate-550 mt-1 flex items-center gap-1.5 flex-wrap">
                      <span>سقف مجاز:</span>
                      {isUnlimited ? (
                        <span className="bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded text-[11px] inline-flex items-center gap-1">
                          ⚡ سقف آزاد (نامحدود)
                        </span>
                      ) : (
                        <span className="font-mono font-semibold">{limit.toLocaleString()} تومان</span>
                      )}
                    </div>
                    <div className="text-xs font-semibold mt-0.5">
                      اعتبار باقیمانده: {isUnlimited ? (
                        <span className="font-bold text-emerald-700">نامحدود (سقف آزاد)</span>
                      ) : remains! > 0 ? (
                        <span className="font-mono text-emerald-700 font-bold">{remains?.toLocaleString()} تومان</span>
                      ) : (
                        <span className="font-mono text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded font-bold">۰ تومان (سقف پر شده)</span>
                      )}
                    </div>
                    <div className="text-xs text-purple-700 font-semibold mt-0.5 bg-purple-50 px-1.5 py-0.5 rounded inline-block">
                      واریزی‌ها / تسویه‌ها: <span className="font-mono">{(u.totalPayments || 0).toLocaleString()}</span> تومان
                    </div>
                    <div className="text-xs text-blue-600 font-semibold mt-0.5 bg-blue-50 px-1 py-0.5 rounded block">
                      تخفیف فروشنده: <span className="font-mono">{u.sellerDiscount || 0}%</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="font-mono text-slate-800 font-bold text-sm">
                      {(u.debtVolume || 0).toLocaleString()} GB
                    </div>
                    <p className="text-[10px] text-slate-400">مجموع حجم کارهای همکار</p>
                  </td>
                  <td className="px-6 py-4">
                    <div className="font-mono text-slate-700 text-sm font-semibold">
                      {(u.totalSales || 0).toLocaleString()} تومان
                    </div>
                  </td>
                  <td className="px-6 py-4 text-left flex items-center justify-end gap-2 h-20">
                    <button
                      onClick={() => toggleUnlimitedLimit(u.chatId, !!isUnlimited)}
                      className={`px-2.5 py-1.5 rounded-md font-medium text-xs transition border ${
                        isUnlimited
                          ? 'bg-amber-50 text-amber-800 hover:bg-amber-100 border-amber-200'
                          : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100 border-emerald-200'
                      }`}
                      title="تغییر وضعیت سقف بین آزاد (نامحدود) و عددی"
                    >
                      {isUnlimited ? '🔒 محدود کردن سقف' : '⚡ سقف آزاد'}
                    </button>
                    <button
                      onClick={() => setServicesModalUser(u)}
                      className="px-2.5 py-1.5 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-md font-medium text-xs transition border border-blue-200 flex items-center gap-1"
                      title="مشاهده کانفیگ‌ها، ترافیک دوره جاری مصرف آزاد (PAYG) و تنظیم مبنای حجم"
                    >
                      <Package className="w-3.5 h-3.5" />
                      کانفیگ‌ها و PAYG
                    </button>
                    <button
                      onClick={() => recalculateSeller(u.chatId)}
                      className="px-2.5 py-1.5 bg-amber-50 text-amber-800 hover:bg-amber-100 rounded-md font-medium text-xs transition border border-amber-200"
                      title="محاسبه مجدد بدهی، تخفیفات و واریزی‌ها"
                    >
                      🔄 همگام‌سازی تراز
                    </button>
                    <button
                      onClick={() => openDiscountModal(u)}
                      className="px-3 py-1.5 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 rounded-md font-medium text-xs transition border border-indigo-100"
                    >
                      تخفیف‌های پیشرفته
                    </button>
                    <button
                      onClick={() => changeLimits(u.chatId, u.debtLimit, u.debtVolume, u.debt, u.sellerDiscount, isUnlimited)}
                      className="px-3 py-1.5 bg-slate-100 text-slate-700 hover:bg-slate-200 rounded-md font-medium text-xs transition"
                    >
                      ویرایش سقف و بدهی
                    </button>
                    <button
                      onClick={() => settleDebt(u.chatId)}
                      className="px-3 py-1.5 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-md font-medium text-xs transition"
                    >
                      تسویه کامل حساب
                    </button>
                    <button
                      onClick={() => removeSeller(u.chatId)}
                      className="px-3 py-1.5 bg-red-50 text-red-700 hover:bg-red-105 rounded-md font-medium text-xs transition border border-red-200"
                    >
                      لغو دسترسی همکار
                    </button>
                  </td>
                </tr>
              );
            })}
            {sellers.length === 0 && (
              <tr>
                <td colSpan={5} className="px-6 py-8 text-center text-slate-500">
                  هیچ نماینده همکاری ایجاد نگردیده است.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
