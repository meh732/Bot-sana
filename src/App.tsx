import { useState, useEffect } from 'react';
import { Save, RefreshCw, Send, Plus, Trash2, BatteryCharging, Settings2, Users as UsersIcon, Box, Download, Upload, Zap, CheckCircle, Percent, X, Edit2 } from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState<'settings' | 'products' | 'users' | 'sellers'>('settings');

  return (
    <div className="w-full h-full min-h-screen bg-slate-50 flex flex-row" dir="rtl" style={{ fontFamily: "'Tahoma', 'Arial', sans-serif" }}>
      {/* Sidebar */}
      <div className="w-64 bg-slate-900 h-full min-h-screen flex flex-col shadow-xl sticky top-0">
        <div className="p-6 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-indigo-500 rounded-lg flex items-center justify-center text-white font-bold">S</div>
            <span className="text-white font-semibold text-lg tracking-tight">مدیریت پنل سنایی</span>
          </div>
        </div>
        <nav className="flex-1 p-4 space-y-2">
          <TabBtn active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} icon={<Settings2 className="w-5 h-5"/>}>تنظیمات ربات</TabBtn>
          <TabBtn active={activeTab === 'products'} onClick={() => setActiveTab('products')} icon={<Box className="w-5 h-5"/>}>لیست محصولات</TabBtn>
          <TabBtn active={activeTab === 'users'} onClick={() => setActiveTab('users')} icon={<UsersIcon className="w-5 h-5"/>}>مشتریان عادی</TabBtn>
          <TabBtn active={activeTab === 'sellers'} onClick={() => setActiveTab('sellers')} icon={<UsersIcon className="w-5 h-5 text-indigo-400"/>}>همکاران فروشنده (نمایندگان)</TabBtn>
        </nav>
        <div className="p-4 mt-auto border-t border-slate-800">
          <div className="bg-slate-800 rounded-lg p-3">
            <div className="flex justify-between items-center mb-1">
              <span className="text-xs text-slate-400">وضعیت سرور</span>
              <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
            </div>
            <p className="text-white text-sm" dir="ltr">Sanaei Bot v2.1</p>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col h-full min-h-screen overflow-hidden">
        {/* Header */}
        <header className="bg-white h-16 border-b border-slate-200 px-8 flex flex-shrink-0 items-center justify-between sticky top-0 z-10 w-full">
          <h2 className="text-slate-800 font-bold text-xl">داشبورد عملیات خودکار</h2>
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <div className="text-left" dir="ltr">
                <p className="text-sm font-medium">Main Admin</p>
                <p className="text-xs text-slate-400">Management</p>
              </div>
              <div className="w-10 h-10 bg-slate-200 rounded-full border-2 border-indigo-500 flex items-center justify-center font-bold text-indigo-500">A</div>
            </div>
          </div>
        </header>

        <main className="p-8 flex flex-col gap-6 flex-1 overflow-y-auto w-full" dir="ltr">
          {activeTab === 'settings' && <SettingsView />}
          {activeTab === 'products' && <ProductsView />}
          {activeTab === 'users' && <UsersView />}
          {activeTab === 'sellers' && <SellersView />}
        </main>
      </div>
    </div>
  );
}

function TabBtn({ active, onClick, children, icon }: any) {
  return (
    <button 
      onClick={onClick}
      className={`w-full flex items-center gap-3 p-3 rounded-lg transition-colors text-sm font-medium ${active ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:bg-slate-800'}`}
    >
      {icon}
      <span>{children}</span>
    </button>
  );
}

function SettingsView() {
  const [state, setState] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [inbounds, setInbounds] = useState<any[]>([]);
  const [adminIdsStr, setAdminIdsStr] = useState('');

  const [backupPassword, setBackupPassword] = useState('');
  const [restorePassword, setRestorePassword] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const [localBackups, setLocalBackups] = useState<any[]>([]);

  const [newCouponCode, setNewCouponCode] = useState('');
  const [newCouponPercent, setNewCouponPercent] = useState(20);
  const [newCouponMaxUsage, setNewCouponMaxUsage] = useState('');
  const [newCouponMaxUsagePerUser, setNewCouponMaxUsagePerUser] = useState('');
  const [newCouponExpirationDays, setNewCouponExpirationDays] = useState('');

  
  const [newFjId, setNewFjId] = useState('');
  const [newFjName, setNewFjName] = useState('');
  const [newFjUrl, setNewFjUrl] = useState('');

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
        window.location.reload();
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
      alert('لطفا کد تخفیف را وارد کنید.');
      return;
    }
    const code = newCouponCode.trim().toUpperCase();
    const percent = Number(newCouponPercent);
    if (isNaN(percent) || percent <= 0 || percent > 100) {
      alert('درصد تخفیف معتبر نیست (باید بین ۱ تا ۱۰۰ باشد).');
      return;
    }

    const currentCoupons = state.coupons || [];
    if (currentCoupons.some((c: any) => c.code === code)) {
      alert('این کد تخفیف قبلاً تعریف شده است.');
      return;
    }

    const updatedCoupons = [...currentCoupons, { 
      code, 
      discountPercent: percent,
      maxUsage: newCouponMaxUsage ? parseInt(newCouponMaxUsage) : undefined,
      maxUsagePerUser: newCouponMaxUsagePerUser ? parseInt(newCouponMaxUsagePerUser) : undefined,
      expirationDate: newCouponExpirationDays ? new Date(Date.now() + parseInt(newCouponExpirationDays) * 24 * 60 * 60 * 1000).toISOString() : undefined,
      usedCount: 0,
      usedBy: {}
    }];
    
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
      setNewCouponMaxUsage('');
      setNewCouponMaxUsagePerUser('');
      setNewCouponExpirationDays('');
      alert('کد تخفیف با موفقیت ایجاد شد.');
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
        freeTestInboundId: state.freeTestInboundId ? Number(state.freeTestInboundId) : undefined,
        freeTestInboundIds: state.freeTestInboundIds || [],
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
      setState(prevState => ({
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

  const loadInbounds = async () => {
    try {
      const res = await fetch('/api/xui-inbounds');
      const data = await res.json();
      if (data.success) {
        setInbounds(data.inbounds);
      } else {
        alert('خطا در دریافت لیست اینباندها: ' + data.message);
      }
    } catch(e: any) {
      alert('خطا در ارتباط با پنل. مشخصات، آدرس و یا پورت و فایروال را بررسی کنید.');
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
            window.location.reload();
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

  return (
    <div className="space-y-8 max-w-2xl mx-auto" dir="rtl">
      {/* Configuration Help Card */}
      <div className="bg-gradient-to-tr from-slate-900 to-indigo-900 text-white p-6 rounded-xl shadow-md border border-slate-750">
        <h3 className="text-lg font-bold mb-2 flex items-center">💡 راهنمای کانفیگ و اتصال ربات به X-UI :</h3>
        <ul className="text-sm space-y-2 text-slate-200 leading-relaxed pr-4 list-disc">
          <li><strong>آیدی ادمین اصلی (Admin Chat IDs):</strong> هر کاربر تلگرام یک شناسه عددی دارد (مثلاً <code>51239241</code>) که می‌توانید آن را از ربات‌هایی مثل <code className="bg-slate-850 px-1 py-0.5 rounded text-indigo-300">@userinfobot</code> دریافت نموده و در بخش زیر ذخیره کنید. فقط این آیدی‌ها به بخش <code>/admin</code> در ربات دسترسی خواهند داشت.</li>
          <li><strong>اتصال سنایی (X-UI Connection):</strong> آدرس IP و پورت پنل خود را دقیقاً با پورت تعریف شده (مثلاً <code>http://1.2.3.4:2053</code>) وارد کنید. اگر پنل شما دارای پسوند مسیر (basePath) است حتماً آن را نیز بنویسید (مثل <code>http://1.2.3.4:2053/myprefix</code>).</li>
          <li><strong>شناسه اینباند (Inbound ID):</strong> تمام اکانت‌های تستی و فروخته شده به عنوان کلاینت (User) داخل یک <strong>Inbound</strong> در پنل سنایی اضافه می‌شوند. پس از ذخیره آدرس و پسورد پنل، روی دکمه <strong>"دریافت لیست اینباندها"</strong> کلیک کنید تا لیست اینباندهای شما لود شود و سپس شناسه (مثلاً <code>1</code> یا <code>2</code>) را کلیک یا تایپ کنید.</li>
        </ul>
      </div>

      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
        <h2 className="text-lg font-bold mb-4 flex items-center gap-2"><Send className="w-5 h-5 text-indigo-600"/> تنظیمات عمومی و توکن ربات تلگرام</h2>
        
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">توکن ربات تلگرام (Telegram Bot Token)</label>
            <input type="password" value={state.botToken} onChange={e => setState({...state, botToken: e.target.value})} className="w-full px-3 py-2 border border-slate-300 rounded-md focus:ring-2 focus:ring-indigo-500 font-mono text-sm text-left" dir="ltr" placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11" />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">شناسه عددی ادمین‌های اصلی (با ویرگول انگلیسی , جدا کنید)</label>
            <input type="text" value={adminIdsStr} onChange={e => setAdminIdsStr(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-md focus:ring-2 focus:ring-indigo-500 font-mono text-sm text-left" dir="ltr" placeholder="e.g. 51239241, 14023924" />
            <p className="text-xs text-slate-400 mt-1" dir="rtl">برای وارد کردن ادمین‌های ربات، شناسه‌های عددی آنها را با کاما جدا کنید.</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">فعال بودن اکانت تست</label>
              <select 
                value={state.freeTestEnabled !== false ? 'true' : 'false'} 
                onChange={e => setState({...state, freeTestEnabled: e.target.value === 'true'})} 
                className="w-full px-3 py-2 border border-slate-300 rounded-md focus:ring-2 focus:ring-indigo-500"
              >
                <option value="true">فعال (روشن)</option>
                <option value="false">غیرفعال (خاموش)</option>
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-2">اینباندهای منتخب اکانت تست (می‌توانید یک یا چند اینباند را انتخاب کنید تا موازنه موازنه شوند):</label>
              {inbounds.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-3 bg-slate-50 rounded-lg border max-h-48 overflow-y-auto">
                  {inbounds.map((ib: any) => {
                    const isChecked = (state.freeTestInboundIds || []).includes(ib.id) || (state.freeTestInboundId === ib.id);
                    return (
                      <label key={ib.id} className="flex items-center gap-2 text-sm text-slate-700 hover:text-indigo-600 cursor-pointer select-none">
                        <input 
                          type="checkbox" 
                          checked={isChecked}
                          onChange={e => {
                            let updatedIds = [...(state.freeTestInboundIds || [])];
                            if (state.freeTestInboundId && !updatedIds.includes(state.freeTestInboundId)) {
                              updatedIds.push(state.freeTestInboundId);
                            }
                            if (e.target.checked) {
                              if (!updatedIds.includes(ib.id)) updatedIds.push(ib.id);
                            } else {
                              updatedIds = updatedIds.filter(id => id !== ib.id);
                            }
                            setState({
                              ...state,
                              freeTestInboundIds: updatedIds,
                              freeTestInboundId: updatedIds[0] || undefined
                            });
                          }}
                          className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        <span className="font-medium text-slate-800">{ib.remark}</span>
                        <span className="text-xs text-slate-500 font-mono bg-slate-200 px-1.5 py-0.5 rounded">ID: {ib.id} ({ib.protocol})</span>
                      </label>
                    );
                  })}
                </div>
              ) : (
                <div className="p-3 bg-amber-50 rounded-lg border border-amber-200 text-xs text-amber-700">
                  ⚠️ ابتدا دکمه "دریافت لیست اینباندها" را در پایین کلیک کنید تا اتصال برقرار شده و اینباندها جهت انتخاب لود گردند. در صورت نبود اتصال، می‌توانید از همان آیدی پیشفرض استفاده کنید.
                </div>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">حجم تست رایگان (گیگابایت)</label>
              <input type="number" value={state.freeTestVolumeGb} onChange={e => setState({...state, freeTestVolumeGb: e.target.value})} className="w-full px-3 py-2 border border-slate-300 rounded-md focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">مدت زمان تست رایگان (روز)</label>
              <input type="number" value={state.freeTestDurationDays} onChange={e => setState({...state, freeTestDurationDays: e.target.value})} className="w-full px-3 py-2 border border-slate-300 rounded-md focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">شماره کارت بانکی (کارت به کارت)</label>
              <input type="text" value={state.cardNumber || ''} onChange={e => setState({...state, cardNumber: e.target.value})} className="w-full px-3 py-2 border border-slate-300 rounded-md focus:ring-2 focus:ring-indigo-500 font-mono text-left" dir="ltr" placeholder="۶۰۳۷۹۹۷۹۱۲۳۴۵۶۷۸" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">نام صاحب کارت حساب</label>
              <input type="text" value={state.cardHolder || ''} onChange={e => setState({...state, cardHolder: e.target.value})} className="w-full px-3 py-2 border border-slate-300 rounded-md focus:ring-2 focus:ring-indigo-500 text-right" placeholder="مدیریت حساب" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">آیدی پشتیبانی تلگرام (بدون @)</label>
              <input type="text" value={state.supportUsername || ''} onChange={e => setState({...state, supportUsername: e.target.value})} className="w-full px-3 py-2 border border-slate-300 rounded-md focus:ring-2 focus:ring-indigo-500 text-left font-mono" dir="ltr" placeholder="SanaeiSupportAdmin" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">پاداش معرفی زیرمجموعه (تومان)</label>
              <input type="number" value={state.referralRewardToman || 0} onChange={e => setState({...state, referralRewardToman: e.target.value})} className="w-full px-3 py-2 border border-slate-300 rounded-md focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">بازه زمانی ارسال بکاپ خودکار (ساعت)</label>
              <input type="number" value={state.autoBackupIntervalHours || 0} min="0" max="24" placeholder="مثلا 12 (صفر برای غیرفعال)" onChange={e => setState({...state, autoBackupIntervalHours: e.target.value})} className="w-full px-3 py-2 border border-slate-300 rounded-md focus:ring-2 focus:ring-indigo-500 text-left font-mono" dir="ltr" />
              <p className="text-[11px] text-slate-500 mt-1">تعداد ساعت بین هر ارسال بکاپ به تلگرام ادمین مشخص شده. ۰ = غیرفعال.</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">رمز عبور فایل بکاپ خودکار</label>
              <input type="text" value={state.autoBackupPassword || ''} placeholder="رمز بکاپ (خالی برای عدم رمزگذاری)" onChange={e => setState({...state, autoBackupPassword: e.target.value})} className="w-full px-3 py-2 border border-slate-300 rounded-md focus:ring-2 focus:ring-indigo-500 text-left font-mono" dir="ltr" />
              <p className="text-[11px] text-slate-500 mt-1">این پسورد برای رمزگذاری و محافظت از فایل‌های بکاپ ارسالی استفاده می‌شود.</p>
            </div>
          </div>

          <div className="border border-slate-200 rounded-lg p-5">
            <div className="flex items-center justify-between mb-4">
               <div>
                  <h3 className="text-md font-bold text-slate-800 flex items-center gap-2"><Plus className="w-4 h-4 text-slate-500"/> جوین اجباری کانال‌ها</h3>
                  <p className="text-xs text-slate-500">کاربران برای استفاده از ربات ملزم به عضویت در کانال‌های زیر خواهند بود.</p>
               </div>
               <label className="flex items-center cursor-pointer">
                  <div className="relative">
                    <input type="checkbox" className="sr-only" checked={state.forceJoinEnabled || false} onChange={e => setState({...state, forceJoinEnabled: e.target.checked})} />
                    <div className={`block w-10 h-6 rounded-full transition ${state.forceJoinEnabled ? 'bg-indigo-600' : 'bg-slate-300'}`}></div>
                    <div className={`dot absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition transform ${state.forceJoinEnabled ? 'translate-x-4' : ''}`}></div>
                  </div>
                  <span className="mr-3 font-semibold text-sm">فعال‌سازی جوین اجباری</span>
               </label>
            </div>

            {state.forceJoinEnabled && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2 items-end">
                    <div>
                      <label className="text-xs font-semibold text-slate-700 mb-1 block">آیدی عددی یا یوزرنیم کانال (مانند @mychannel)</label>
                      <input type="text" value={newFjId} onChange={e=>setNewFjId(e.target.value)} className="w-full border p-2 text-sm rounded bg-slate-50" dir="ltr" />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-700 mb-1 block">نام نمایشی کانال (روی دکمه)</label>
                      <input type="text" value={newFjName} onChange={e=>setNewFjName(e.target.value)} className="w-full border p-2 text-sm rounded bg-slate-50" />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-700 mb-1 block">لینک عضویت کانال</label>
                      <div className="flex gap-2">
                        <input type="text" value={newFjUrl} onChange={e=>setNewFjUrl(e.target.value)} className="w-full border p-2 text-sm rounded bg-slate-50" dir="ltr" />
                        <button onClick={handleAddForceJoin} className="bg-indigo-600 text-white px-3 py-2 rounded shrink-0">افزودن</button>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-2 mt-4">
                    {(!state.forceJoinChannels || state.forceJoinChannels.length === 0) && <div className="text-center text-sm text-slate-500">هیچ کانالی ثبت نشده است. ربات باید در کانال‌های ثبت شده ادمین باشد.</div>}
                    {(state.forceJoinChannels || []).map((ch:any, idx:number) => (
                       <div key={idx} className="flex items-center justify-between bg-slate-50 p-2 rounded border text-sm">
                          <div className="flex items-center gap-3">
                             <span className="font-bold text-indigo-700">{ch.name}</span>
                             <span className="text-slate-500 font-mono text-xs">{ch.id}</span>
                          </div>
                          <div className="flex items-center gap-3">
                             <a href={ch.url} target="_blank" className="text-blue-500 hover:underline px-2 text-xs">تست لینک</a>
                             <button onClick={() => handleDeleteForceJoin(idx)} className="text-red-500 hover:text-red-700"><Trash2 className="w-4 h-4"/></button>
                          </div>
                       </div>
                    ))}
                  </div>
                </div>
            )}
          </div>

          <button onClick={saveGeneral} disabled={saving} className="bg-indigo-600 text-white px-4 py-2 rounded-md hover:bg-indigo-700 transition flex items-center mr-auto">
            <Save className="w-4 h-4 ml-2" /> ذخیره تنظیمات عمومی ربات
          </button>
        </div>
      </div>

      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
        <h2 className="text-lg font-bold mb-4 flex items-center gap-2"><RefreshCw className="w-5 h-5 text-emerald-600"/> مشخصات و اتصال پنل سنایی X-UI</h2>
        
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">آدرس کامل اتصال به پنل سنایی (X-UI URL)</label>
            <input type="text" value={state.panel.url || ''} onChange={e => setState({...state, panel: {...state.panel, url: e.target.value}})} className="w-full px-3 py-2 border border-slate-300 rounded-md focus:ring-2 focus:ring-indigo-500 text-left font-mono" dir="ltr" placeholder="http://1.2.3.4:2053" />
          </div>
          <div className="grid grid-cols-2 gap-4">
             <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">نام کاربری ورود به پنل</label>
              <input type="text" value={state.panel.username || ''} onChange={e => setState({...state, panel: {...state.panel, username: e.target.value}})} className="w-full px-3 py-2 border border-slate-300 rounded-md focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">رمز عبور ورود به پنل</label>
              <input type="password" value={state.panel.password || ''} onChange={e => setState({...state, panel: {...state.panel, password: e.target.value}})} className="w-full px-3 py-2 border border-slate-300 rounded-md focus:ring-2 focus:ring-indigo-500" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">کلید API Key اختصاصی پنل جدید (جهت عدم نیاز به نام کاربری و رمز عبور)</label>
            <input type="text" value={state.panel.apiKey || ''} onChange={e => setState({...state, panel: {...state.panel, apiKey: e.target.value}})} className="w-full px-3 py-2 border border-slate-300 rounded-md focus:ring-2 focus:ring-indigo-500 font-mono text-left" dir="ltr" placeholder="vXg7hY..." />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">دامنه یا بیس آدرس اختصاصی برای لینک‌های ساب (Subscription Base URL)</label>
            <input type="text" value={state.panel.subUrlBase || ''} onChange={e => setState({...state, panel: {...state.panel, subUrlBase: e.target.value}})} className="w-full px-3 py-2 border border-slate-300 rounded-md focus:ring-2 focus:ring-indigo-500 font-mono text-left" dir="ltr" placeholder="https://sub.mydomain.com/" />
            <p className="text-xs text-slate-400 mt-1">💡 اختیاری: اگر خالی بماند، لینک‌های ساب بر اساس آدرس اصلی پنل به صورت خودکار ساخته خواهند شد.</p>
          </div>

          <div className="space-y-4">
            <div className="bg-amber-50 border border-amber-200 p-3 rounded-lg flex items-start gap-3">
              <Settings2 className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
              <div className="text-sm text-amber-800">
                <p className="font-bold">راهنمای اتصال به پنل سنایی (MHSanaei):</p>
                <p className="mt-1">۱. آدرس پنل را با پورت وارد کنید (مثلا <code className="bg-amber-100 px-1 rounded">http://1.2.3.4:2053</code>).</p>
                <p>۲. اگر «Web Base Path» در تنظیمات پنل دارید، آن را به انتهای آدرس اضافه نکنید (ربات خودکار شناسایی می‌کند).</p>
                <p>۳. پیشنهاد می‌شود از کلید API برای امنیت و سرعت بیشتر استفاده کنید.</p>
              </div>
            </div>

            <div className="flex gap-2">
              <button 
                onClick={testConnection} 
                className="flex-1 bg-slate-800 text-white px-4 py-2.5 rounded-md hover:bg-slate-900 transition flex items-center justify-center font-medium shadow-sm"
              >
                <Zap className="w-4 h-4 ml-2" /> تست سریع و شناسایی مسیر پنل
              </button>
              <button 
                onClick={loadInbounds} 
                className="flex-1 bg-indigo-600 text-white px-4 py-2.5 rounded-md hover:bg-indigo-700 transition flex items-center justify-center font-medium shadow-sm"
              >
                <RefreshCw className="w-4 h-4 ml-2" /> واکشی لیست اینباندها
              </button>
            </div>

            <div className="space-y-2 border-t pt-4">
              <label className="block text-sm font-medium text-slate-700">اینباندهای پیش‌فرض (Global Inbounds)</label>
              <p className="text-[11px] text-slate-400">اینباندهایی که تیک می‌زنید، مقصد پیش‌فرض برای تمام فروش‌ها خواهند بود.</p>
              
              {inbounds.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 p-3 bg-slate-50 rounded-lg border max-h-60 overflow-y-auto">
                  {inbounds.map((ib: any) => {
                    const isChecked = (state.panel.inboundIds || []).includes(ib.id) || (state.panel.inboundId === ib.id);
                    return (
                      <label key={ib.id} className="flex items-center gap-2 p-2 hover:bg-white rounded border border-transparent hover:border-slate-200 transition text-sm text-slate-700 cursor-pointer select-none">
                        <input 
                          type="checkbox" 
                          checked={isChecked}
                          onChange={e => {
                            let updatedIds = [...(state.panel.inboundIds || [])];
                            if (state.panel.inboundId && !updatedIds.includes(state.panel.inboundId)) {
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
                          className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 w-4 h-4"
                        />
                        <div className="flex flex-col">
                          <span className="font-bold text-slate-800">{ib.remark}</span>
                          <span className="text-[10px] text-slate-500 font-mono">Port: {ib.port} | ID: {ib.id}</span>
                        </div>
                      </label>
                    );
                  })}
                </div>
              ) : (
                <div className="p-8 border-2 border-dashed border-slate-200 rounded-lg flex flex-col items-center justify-center text-slate-400 bg-slate-50">
                  <Box className="w-10 h-10 mb-2 opacity-20" />
                  <p className="text-sm">هنوز لیستی دریافت نشده است.</p>
                  <button onClick={loadInbounds} className="mt-2 text-indigo-600 text-xs font-bold hover:underline">دریافت همین حالا</button>
                </div>
              )}
            </div>
          </div>

          {inbounds.length > 0 && (
            <div className="mt-4 border rounded-md overflow-hidden bg-slate-50">
               <table className="w-full text-sm text-right">
                  <thead className="bg-slate-100 text-slate-600 border-b">
                    <tr>
                      <th className="px-4 py-2 font-medium">شناسه ID</th>
                      <th className="px-4 py-2 font-medium">عنوان (Remark)</th>
                      <th className="px-4 py-2 font-medium">پورت</th>
                      <th className="px-4 py-2 font-medium">پروتکل</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inbounds.map((ib: any) => (
                      <tr key={ib.id} className="border-b last:border-0 hover:bg-white cursor-pointer" onClick={() => setState({...state, panel: { ...state.panel, inboundId: ib.id }})}>
                        <td className="px-4 py-2 font-mono">{ib.id}</td>
                        <td className="px-4 py-2 font-bold text-slate-800">{ib.remark}</td>
                        <td className="px-4 py-2 font-mono">{ib.port}</td>
                        <td className="px-4 py-2 text-indigo-600 font-bold">{ib.protocol}</td>
                      </tr>
                    ))}
                  </tbody>
               </table>
               <p className="text-xs text-emerald-600 p-2 text-center font-medium">💡 با کلیک روی هر ردیف بالا, شناسه آن به صورت اتوماتیک انتخاب می‌شود.</p>
            </div>
          )}

          <div className="flex gap-2 mr-auto">
            <button onClick={testConnection} className="bg-slate-800 text-white px-4 py-2 rounded-md hover:bg-slate-900 transition flex items-center">
              <Zap className="w-4 h-4 ml-2" /> تست سریع اتصال
            </button>
            <button onClick={savePanel} disabled={saving} className="bg-emerald-600 text-white px-4 py-2 rounded-md hover:bg-emerald-700 transition flex items-center">
              <Save className="w-4 h-4 ml-2" /> ذخیره اطلاعات اتصال پنل
            </button>
          </div>
        </div>
      </div>

      {/* Coupons/Discounts Management Secured Card */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
        <h2 className="text-lg font-bold mb-4 flex items-center gap-2"><Plus className="w-5 h-5 text-indigo-600"/> مدیریت کدهای تخفیف و کوپن‌ها (Tickets)</h2>
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4 items-end bg-slate-50 p-4 rounded-lg border">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">کد (مثال: YALDA)</label>
              <input value={newCouponCode} onChange={e => setNewCouponCode(e.target.value)} type="text" className="w-full px-3 py-1.5 border rounded-md text-sm font-mono text-left" placeholder="OFF50" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">درصد تخفیف (٪)</label>
              <input value={newCouponPercent} onChange={e => setNewCouponPercent(Number(e.target.value))} type="number" min="1" max="100" className="w-full px-3 py-1.5 border rounded-md text-sm font-mono" placeholder="20" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">تعداد مجاز کل (اختیاری)</label>
              <input value={newCouponMaxUsage} onChange={e => setNewCouponMaxUsage(e.target.value)} type="number" className="w-full px-3 py-1.5 border rounded-md text-sm font-mono" placeholder="بدون محدودیت" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">مجاز هر کاربر (اختیاری)</label>
              <input value={newCouponMaxUsagePerUser} onChange={e => setNewCouponMaxUsagePerUser(e.target.value)} type="number" className="w-full px-3 py-1.5 border rounded-md text-sm font-mono" placeholder="1" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">اعتبار (روز - اختیاری)</label>
              <input value={newCouponExpirationDays} onChange={e => setNewCouponExpirationDays(e.target.value)} type="number" className="w-full px-3 py-1.5 border rounded-md text-sm font-mono" placeholder="مثلا 10" />
            </div>
          </div>
          <div>
            <button onClick={handleAddCoupon} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-md font-medium text-xs transition">ایجاد کد تخفیف جدید</button>
          </div>

          <div className="border rounded-md overflow-hidden">
             <table className="w-full text-sm text-right">
                <thead className="bg-slate-100 text-slate-600 border-b">
                  <tr>
                    <th className="px-4 py-2 font-medium">کد تخفیف</th>
                    <th className="px-4 py-2 font-medium">درصد</th>
                    <th className="px-4 py-2 font-medium text-center">جزئیات و محدودیت‌ها</th>
                    <th className="px-4 py-2 font-medium text-left">عملیات</th>
                  </tr>
                </thead>
                <tbody>
                  {(state.coupons || []).map((c: any) => (
                    <tr key={c.code} className="border-b last:border-0 hover:bg-slate-50 transition">
                      <td className="px-4 py-2 font-mono font-bold text-slate-800">{c.code}</td>
                      <td className="px-4 py-2 font-mono text-indigo-600 font-bold">{c.discountPercent}٪</td>
                      <td className="px-4 py-2 text-xs text-slate-600 text-center space-y-1">
                        {c.maxUsage && <div>کل: {c.usedCount || 0}/{c.maxUsage}</div>}
                        {c.maxUsagePerUser && <div>هر کاربر: {c.maxUsagePerUser}</div>}
                        {c.expirationDate && <div>اعتبار تا: {new Date(c.expirationDate).toLocaleDateString('fa-IR')}</div>}
                        {!c.maxUsage && !c.maxUsagePerUser && !c.expirationDate && <span className="text-slate-400">بدون محدودیت خاص</span>}
                      </td>
                      <td className="px-4 py-2 text-left">
                        <button onClick={() => handleDeleteCoupon(c.code)} className="text-red-600 hover:text-red-800 p-1 font-medium text-xs transition">حذف</button>
                      </td>
                    </tr>
                  ))}
                  {(!state.coupons || state.coupons.length === 0) && (
                    <tr><td colSpan={4} className="px-4 py-4 text-center text-slate-400 text-xs">هیچ کد تخفیفی تعریف نشده است.</td></tr>
                  )}
                </tbody>
             </table>
          </div>
        </div>
      </div>

      {/* Backup and Restore Secured System */}
      <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200 mt-6 space-y-6">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2 text-slate-800 justify-start flex-row-reverse text-right">
            <span className="ml-auto">🛡️ موتور هوشمند پشتیبان‌گیری و بازیابی فوق‌سریع دیتابیس</span>
            <Download className="w-5 h-5 text-indigo-600" />
          </h2>
          <p className="text-xs text-slate-500 mt-1 leading-relaxed text-right">
            سیستم به طور خودکار با هر تغییر وضعیت در پنل، تنظیمات، تراکنش‌ها یا مشتریان، تا حداکثر ۲۰ کپی زمانی (Snapshot) به عنوان نقطه بازگردانی روی سرور ذخیره می‌کند. همچنین می‌توانید در هر زمان به صورت اینترنتی بکاپ را دانلود یا مجدداً لود نمایید.
          </p>
        </div>

        {/* 1. Local Restore Points Table & Actions */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 space-y-4">
          <div className="flex flex-col md:flex-row items-center md:justify-between gap-3 border-b pb-3 border-slate-100 flex-row-reverse">
            <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2 justify-start flex-row-reverse">
              <span>📋 لیست نقاط بازگردانی زمانی (Local Snapshots)</span>
            </h3>
            <button
              onClick={handleCreateLocalBackup}
              disabled={actionLoading}
              className="bg-indigo-600 text-white hover:bg-indigo-700 font-semibold text-xs px-3.5 py-2 rounded-md transition duration-150 flex items-center gap-1.5 self-end"
            >
              <span>📸 ثبت و ایجاد سریع نقطه بازگردانی دستی</span>
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-50 border-b text-slate-650">
                <tr>
                  <th className="px-3 py-2.5 font-semibold">ردیف</th>
                  <th className="px-3 py-2.5 font-semibold">نام فایل نقطه بازیابی</th>
                  <th className="px-3 py-2.5 font-semibold">نوع نسخه</th>
                  <th className="px-3 py-2.5 font-semibold">تاریخ ایجاد</th>
                  <th className="px-3 py-2.5 font-semibold">حجم فایل</th>
                  <th className="px-3 py-2.5 font-semibold text-left">عملیات بازگردانی</th>
                </tr>
              </thead>
              <tbody>
                {localBackups.map((b, idx) => (
                  <tr key={b.filename} className="border-b last:border-0 hover:bg-slate-50/60 transition">
                    <td className="px-3 py-3 font-mono text-slate-400">{idx + 1}</td>
                    <td className="px-3 py-3">
                      <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded text-slate-705 text-[10px] break-all">{b.filename}</span>
                    </td>
                    <td className="px-3 py-3">
                      {b.type === 'manual' ? (
                        <span className="bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full font-semibold text-[10px]">دستی (Manual)</span>
                      ) : (
                        <span className="bg-sky-50 text-sky-700 border border-sky-100 px-2 py-0.5 rounded-full font-semibold text-[10px]">خودکار سیستم</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-slate-600 font-medium">
                      {new Date(b.createdAt).toLocaleString('fa-IR', { hour12: false })}
                    </td>
                    <td className="px-3 py-3 font-mono text-slate-500">{(b.sizeBytes / 1024).toFixed(2)} KB</td>
                    <td className="px-3 py-3 text-left flex items-center justify-end gap-2">
                      <button
                        onClick={() => handleRestoreLocalBackup(b.filename)}
                        disabled={actionLoading}
                        className="bg-emerald-55 text-emerald-700 border border-emerald-100 hover:bg-emerald-100 hover:text-emerald-800 transition px-2.5 py-1 rounded font-semibold text-[11px]"
                      >
                        بازیابی این نسخه
                      </button>
                      <button
                        onClick={() => handleUnlinkLocalBackup(b.filename)}
                        disabled={actionLoading}
                        className="bg-red-50 text-red-600 border border-red-100 hover:bg-red-100 hover:text-red-700 transition p-1 rounded"
                        title="حذف دائمی"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
                {localBackups.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-slate-400 text-xs text-right">
                      هیچ نقطه بازیابی محلی در حال حاضر یافت نشد. به زودی اولین کپی‌های خودکار ثبت خواهند شد.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* 2. Download / Upload External Backup Section (2 columns split) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-slate-200 divide-y md:divide-y-0 md:divide-x md:divide-x-reverse divide-slate-200">
          {/* Column A: Download backup formats */}
          <div className="space-y-4 pb-4 md:pb-0 text-right">
            <h3 className="text-sm font-bold text-slate-700 flex items-center gap-1.5 justify-start flex-row-reverse">
              <span>📥 دانلود و خروجی فایلی دیتابیس (Export)</span>
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">بکاپ کامل دیتابیس بات شامل اعضا، بدهی‌ها، محصولات و توکن‌ها را با یکی از قالب‌های زیر دانلود کنید:</p>
            
            <div className="space-y-4 bg-white p-4 rounded-xl border border-slate-200">
              {/* Plain Download Option */}
              <div className="flex items-center justify-between gap-3 border-b pb-3 border-slate-100 flex-row-reverse">
                <div className="text-right">
                  <h4 className="text-xs font-bold text-slate-800">۱. دانلود مستقیم و بدون رمز (سریع)</h4>
                  <p className="text-[10px] text-slate-400 mt-0.5">دانلود سریع به صورت فایل JSON خام و آماده بازنشانی</p>
                </div>
                <a 
                  href="/api/backup/plain-download"
                  download
                  className="bg-slate-100 text-slate-700 border border-slate-200 px-3 py-1.5 rounded hover:bg-slate-200 transition text-[11px] font-semibold flex items-center gap-1 shrink-0"
                >
                  <Download className="w-3.5 h-3.5" /> دانلود JSON خام
                </a>
              </div>

              {/* Encrypted Download Option */}
              <div className="space-y-3 pt-1">
                <h4 className="text-xs font-bold text-slate-800 text-right">۲. خروجی فوق‌امنیتی رمزگذاری شده</h4>
                <div className="space-y-2">
                  <label className="block text-[11px] text-slate-500 text-right font-medium">تعриф رمز عبور یا کلید خصوصی جهت قفل کردن فایل بکاپ:</label>
                  <input 
                    type="password" 
                    value={backupPassword} 
                    onChange={e => setBackupPassword(e.target.value)} 
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-md focus:ring-2 focus:ring-indigo-500 font-mono text-xs text-left" 
                    dir="ltr"
                    placeholder="MySecuredPass" 
                  />
                </div>
                <button 
                  onClick={handleDownloadBackup} 
                  disabled={actionLoading} 
                  className="bg-indigo-600 text-white px-3 py-1.5 rounded hover:bg-indigo-700 transition flex items-center text-xs font-medium mr-auto"
                >
                  <Download className="w-3.5 h-3.5 ml-1.5" /> تولید و دانلود فایل رمزگذاری شده
                </button>
              </div>
            </div>
          </div>

          {/* Column B: Upload and Restore backup from External File */}
          <div className="space-y-4 pt-4 md:pt-0 md:pr-4 text-right">
            <h3 className="text-sm font-bold text-slate-700 flex items-center gap-1.5 justify-start flex-row-reverse">
              <span>📤 ورود و ریکاوری فایلی دیتابیس (Import)</span>
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">فایل پشتیبان خارجی با پسوند <code>.json</code> را انتخاب کرده و جهت بازنشانی و جایگذاری تمام اطلاعات آپلود کنید:</p>
            
            <div className="space-y-4 bg-white p-4 rounded-xl border border-slate-205">
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1 text-right">فایل بکاپ را انتخاب کنید:</label>
                  <input 
                    type="file" 
                    accept=".json" 
                    onChange={e => setSelectedFile(e.target.files?.[0] || null)} 
                    className="w-full text-xs text-slate-550 file:mr-4 file:py-1.5 file:px-2.5 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100 cursor-pointer" 
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-650 mb-1 text-right">رمز بازگشایی (اگر فایل رمزشده است وارد کنید):</label>
                  <input 
                    type="password" 
                    value={restorePassword} 
                    onChange={e => setRestorePassword(e.target.value)} 
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-md focus:ring-2 focus:ring-indigo-500 font-mono text-xs text-left" 
                    dir="ltr"
                    placeholder="رمز عبور بکاپ" 
                  />
                </div>
              </div>

              <div className="flex gap-2">
                <button 
                  onClick={handleRestoreBackup} 
                  disabled={actionLoading} 
                  className="bg-emerald-600 text-white px-3.5 py-1.5 rounded hover:bg-emerald-700 transition flex items-center text-xs font-medium mr-auto"
                >
                  <Upload className="w-3.5 h-3.5 ml-1.5" /> آپلود، بازیابی و بازنشانی دیتابیس
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
function ProductsView() {
  const [products, setProducts] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [inbounds, setInbounds] = useState<any[]>([]);
  const [form, setForm] = useState({ name: '', price: 0, volumeGb: 10, durationDays: 30, inboundId: '', inboundIds: [] as number[], limitIp: 1, categoryId: '', isPayAsYouGo: false });
  const [newCatName, setNewCatName] = useState('');
  const [editingProductId, setEditingProductId] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/state')
      .then(r => r.json())
      .then(s => {
        setProducts(s.products || []);
        setCategories(s.categories || []);
      });
    
    // Fetch inbounds on load if available - don't log errors to main console
    fetch('/api/xui-inbounds')
      .then(r => r.json())
      .then(data => {
        if (data && data.success) {
          setInbounds(data.inbounds || []);
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
      inboundId: p.inboundId ? String(p.inboundId) : '',
      inboundIds: p.inboundIds || [],
      limitIp: p.limitIp !== undefined ? p.limitIp : 1,
      categoryId: p.categoryId || '',
      isPayAsYouGo: p.isPayAsYouGo || false
    });
  };

  const cancelEdit = () => {
    setEditingProductId(null);
    setForm({ name: '', price: 10000, volumeGb: 10, durationDays: 30, inboundId: '', inboundIds: [], limitIp: 1, categoryId: '', isPayAsYouGo: false });
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
    <div className="max-w-4xl mx-auto" dir="rtl">
       <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 mb-6">
          <h2 className="text-lg font-bold mb-4 flex items-center gap-2"><Box className="w-5 h-5 text-indigo-600"/> مدیریت گروه‌ها (دسته‌بندی‌ها)</h2>
          <div className="flex gap-2">
            <input 
              type="text" 
              value={newCatName} 
              onChange={e => setNewCatName(e.target.value)} 
              placeholder="نام گروه (مثلا: سرورهای آلمان)"
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
         <h2 className="text-lg font-bold mb-4 flex items-center gap-2"><Plus className="w-5 h-5 text-indigo-600"/> {editingProductId ? 'ویرایش و اصلاح جزئیات محصول انتخابی' : 'تعریف پکیج و محصول جدید با اینباندهای انتخابی'}</h2>
         
         <div className="space-y-4">
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
             <div>
               <label className="block text-xs font-semibold text-slate-700 mb-1">IP Limit</label>
               <input type="number" value={form.limitIp} onChange={e=>setForm({...form, limitIp: Number(e.target.value)})} className="w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-indigo-500 text-sm"/>
             </div>
           </div>

           <div>
              <label className="flex items-center cursor-pointer mb-2">
                <input type="checkbox" checked={form.isPayAsYouGo} onChange={e => setForm({...form, isPayAsYouGo: e.target.checked})} className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 form-checkbox w-4 h-4" />
                <span className="mr-2 text-sm font-bold text-slate-800">محصول «پرداخت در ازای مصرف» (Pay-As-You-Go)</span>
              </label>
              {form.isPayAsYouGo && <p className="text-xs text-amber-600 font-medium">با انتخاب این گزینه، حجم و زمان کاربر نامحدود تنظیم می‌شود و هزینه بر اساس میزان مصرف (به ازای هر گیگابایت) از کیف پول کاربر کسر خواهد شد.</p>}
           </div>

           {/* Row 2: Multiple Inbound Checkboxes */}
           <div>
             <label className="block text-xs font-semibold text-slate-700 mb-1.5">اینباندهای منتخب این پکیج (مشتریان جدید به طور خودکار به صورت تقسیم لود بین اینباندهای علامت‌خورده ساخته خواهند شد):</label>
             {inbounds.length > 0 ? (
               <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5 p-3 bg-slate-50 rounded-lg border max-h-40 overflow-y-auto">
                 {inbounds.map((ib: any) => {
                   const isChecked = form.inboundIds.includes(ib.id) || form.inboundId === String(ib.id);
                   return (
                     <label key={ib.id} className="flex items-center gap-2 text-xs text-slate-700 hover:text-indigo-600 cursor-pointer select-none">
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
                         className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                       />
                       <span className="font-medium text-slate-800">{ib.remark}</span>
                       <span className="text-[10px] text-slate-500 font-mono bg-slate-200 px-1 py-0.5 rounded">ID: {ib.id} ({ib.protocol})</span>
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
                   className="w-full px-3 py-2 border rounded-md text-xs font-mono" 
                   placeholder="آیدی عددی اینباند (مثلاً 2)"
                 />
                 <span className="text-[10px] text-amber-600 self-center">ابتدا مشخصات اتصال پنل سنایی را لود کنید تا لیست به صورت خودکار لود شود.</span>
               </div>
             )}
           </div>
         </div>

         <p className="text-xs text-slate-400 mt-3.5">💡 سیستم هوشمند موازنه بار: با انتخاب چند اینباند، ربات به طور خودکار به صورت چرخشی (Round-Robin رندم) کلاینت‌های جدید با پروتکل متناظر را روی این اینباندها تقسیم می‌کند تا لود روی سرورها یکنواخت گردد.</p>
         <div className="mt-4 text-left">
            <button onClick={addProduct} className={`${editingProductId ? 'bg-amber-600 hover:bg-amber-700' : 'bg-indigo-600 hover:bg-indigo-700'} text-white px-5 py-2 rounded-md font-semibold text-sm transition`}>
               {editingProductId ? 'ذخیره تغییرات محصول' : 'ثبت و افزودن محصول'}
             </button>
             {editingProductId && (
               <button onClick={cancelEdit} className="bg-slate-100 text-slate-700 hover:bg-slate-200 px-4 py-2 rounded-md font-semibold text-sm transition">
                 انصراف از ویرایش
               </button>
             )}
         </div>
       </div>

       <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {products.map(p => (
            <div key={p.id} className={`bg-white border border-slate-200 rounded-xl p-6 shadow-sm flex flex-col hover:shadow-md transition ${p.disabled ? 'opacity-60' : ''}`}>
               <h3 className={`text-lg font-bold text-slate-900 mb-2 ${p.disabled ? 'line-through text-slate-500' : ''}`}>
                 {p.name} {p.disabled && '(غیرفعال)'}
                 {p.isPayAsYouGo && <span className="mr-2 text-[10px] bg-amber-100 text-amber-700 font-bold px-1.5 py-0.5 rounded align-middle">پرداخت در ازای مصرف</span>}
               </h3>
               {p.categoryId && (
                 <div className="text-xs text-indigo-600 bg-indigo-50 px-2 py-1 rounded inline-block w-fit mb-3">
                   گروه: {categories.find(c => c.id === p.categoryId)?.name || 'نامشخص'}
                 </div>
               )}
               <div className="text-2xl font-black text-indigo-600 mb-4">
                 {p.price.toLocaleString()} <span className="text-sm font-normal text-slate-500">{p.isPayAsYouGo ? 'تومان / هر گیگابایت' : 'تومان'}</span>
               </div>
               <div className="space-y-2 mb-6 flex-1 text-sm text-slate-700">
                 <div className="flex justify-between border-b pb-1"><span>میزان حجم:</span><span className="font-bold text-slate-800">{p.isPayAsYouGo ? 'نامحدود (پرداخت درصدی)' : p.volumeGb === 0 ? 'نامحدود' : `${p.volumeGb} GB`}</span></div>
                 <div className="flex justify-between border-b pb-1"><span>مدت زمان:</span><span className="font-bold text-slate-800">{p.isPayAsYouGo ? 'نامحدود' : p.durationDays === 0 ? 'نامحدود' : `${p.durationDays} روز`}</span></div>
                 <div className="flex justify-between border-b pb-1"><span>محدودیت کاربر (IP):</span><span className="font-bold text-slate-800">{p.limitIp || 0}</span></div>
                 <div className="flex justify-between pb-1">
                   <span>اینباندهای پکیج:</span>
                   <span className="font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded text-[11px]">
                     {p.inboundIds && p.inboundIds.length > 0 
                       ? p.inboundIds.map((id: number) => `ID ${id}`).join(', ') 
                       : (p.inboundId ? `اینباند ${p.inboundId}` : 'پیشفرض عمومی')}
                   </span>
                 </div>
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
                <button style={{ display: 'none' }} className="hidden">
                 <Trash2 className="w-4 h-4" /> <span>حذف محصول</span>
               </button>
            </div>
          ))}
          {products.length === 0 && (
            <div className="col-span-full bg-slate-100/50 text-slate-500 text-center p-12 rounded-xl border border-dashed">هنوز هیچ پکیجی ثبت nکرده‌اید. از بخش بالا پکیج جدید تعریف کنید.</div>
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
      const res = await fetch('/api/users/add-seller', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatId: newChatId,
          username: newUsername,
          debtLimit: Number(newLimit) || 1000000,
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
        'آیا مطمئن هستید که می‌خواهید بدهی مالی و حجمی این همکار را صفر (تسویه حساب کامل) کنید؟'
      )
    )
      return;
    const res = await fetch(`/api/users/${chatId}/settle`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      setUsers(
        users.map((u) =>
          u.chatId === chatId ? { ...u, debt: 0, debtVolume: 0 } : u
        )
      );
      alert('حساب همکار با موفقیت تسویه گردید.');
    }
  };

  const changeLimits = async (chatId: number, currentLimit?: number, currentVolumeGob?: number, currentDebt?: number, currentDiscount?: number) => {
    const limitPrompt = prompt(
      'سقف بدهی مجاز همکار را وارد کنید (تومان):',
      String(currentLimit || 1000000)
    );
    if (limitPrompt === null) return;
    const newLimitNum = Number(limitPrompt);
    if (isNaN(newLimitNum)) {
      alert('مقدار سقف بدهی وارد شده معتبر نیست.');
      return;
    }

    const valVolumePrompt = prompt(
      'حجم بدهی همکار را وارد کنید (گیگابایت):',
      String(currentVolumeGob || 0)
    );
    if (valVolumePrompt === null) return;
    const newVolumeNum = Number(valVolumePrompt);
    if (isNaN(newVolumeNum)) {
      alert('مقدار حجم بدهی وارد شده معتبر نیست.');
      return;
    }

    const valDebtPrompt = prompt(
      'میزان بدهی مالی فعلی همکار را وارد کنید (تومان):',
      String(currentDebt || 0)
    );
    if (valDebtPrompt === null) return;
    const newDebtNum = Number(valDebtPrompt);
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

    const res = await fetch(`/api/users/${chatId}/seller-limits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        debtLimit: newLimitNum,
        debtVolume: newVolumeNum,
        debt: newDebtNum,
        sellerDiscount: newDiscountNum,
      }),
    });
    const data = await res.json();
    if (data.success) {
      setUsers(
        users.map((u) =>
          u.chatId === chatId
            ? {
                ...u,
                debtLimit: newLimitNum,
                debtVolume: newVolumeNum,
                debt: newDebtNum,
                sellerDiscount: newDiscountNum,
              }
            : u
        )
      );
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
            <label className="block text-xs font-medium text-slate-700 mb-1">سقف بدهی مجاز اولیه (تومان)</label>
            <input
              type="number"
              placeholder="1000000"
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
              const limit = u.debtLimit !== undefined ? u.debtLimit : 1000000;
              const remains = Math.max(0, limit - currentDebt);
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
                    <div className="text-xs text-slate-550 mt-1">
                      سقف مجاز: <span className="font-mono">{limit.toLocaleString()}</span> تومان
                    </div>
                    <div className="text-xs text-emerald-600 font-semibold mt-0.5">
                      اعتبار باقیمانده: <span className="font-mono">{remains.toLocaleString()}</span> تومان
                    </div>
                    <div className="text-xs text-blue-600 font-semibold mt-0.5 bg-blue-50 px-1 py-0.5 rounded inline-block">
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
                      onClick={() => openDiscountModal(u)}
                      className="px-3 py-1.5 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 rounded-md font-medium text-xs transition border border-indigo-100"
                    >
                      تخفیف‌های پیشرفته
                    </button>
                    <button
                      onClick={() => changeLimits(u.chatId, u.debtLimit, u.debtVolume, u.debt, u.sellerDiscount)}
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
