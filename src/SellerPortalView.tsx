import React, { useState, useEffect } from 'react';
import { 
  ShoppingBag, 
  Settings, 
  Search, 
  Copy, 
  Check, 
  QrCode, 
  ShieldCheck, 
  Zap, 
  Globe, 
  Clock, 
  HardDrive, 
  X, 
  Sliders, 
  LogOut,
  Sparkles,
  AlertCircle
} from 'lucide-react';

interface SellerPortalProps {
  chatIdParam?: string;
}

export const SellerPortalView: React.FC<SellerPortalProps> = ({ chatIdParam }) => {
  const [chatId, setChatId] = useState<string>(() => {
    if (chatIdParam) return chatIdParam;
    const urlParams = new URLSearchParams(window.location.search);
    const qId = urlParams.get('id') || urlParams.get('chatId');
    if (qId) return qId;
    return localStorage.getItem('seller_portal_chatid') || '';
  });

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [sellerData, setSellerData] = useState<any>(null);
  const [categories, setCategories] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);

  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Settings state
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [customPrices, setCustomPrices] = useState<{ [key: string]: number }>({});
  const [showCustomPricesOnly, setShowCustomPricesOnly] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);

  // Buy modal state
  const [selectedProduct, setSelectedProduct] = useState<any>(null);
  const [customClientName, setCustomClientName] = useState('');
  const [purchasing, setPurchasing] = useState(false);

  // Result state
  const [purchaseResult, setPurchaseResult] = useState<any>(null);
  const [copiedText, setCopiedText] = useState(false);

  useEffect(() => {
    if (chatId) {
      fetchPortalInfo(chatId);
    } else {
      setLoading(false);
    }
  }, [chatId]);

  const fetchPortalInfo = async (idToUse: string) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/seller-portal/info/${idToUse}`);
      const data = await res.json();
      if (data.success) {
        setSellerData(data.seller);
        setCategories(data.categories || []);
        setProducts(data.products || []);
        setCustomPrices(data.seller.customDisplayPrices || {});
        setShowCustomPricesOnly(data.seller.showCustomPricesOnly ?? true);
        setIsLoggedIn(true);
        localStorage.setItem('seller_portal_chatid', idToUse);
      } else {
        setIsLoggedIn(false);
        setError(data.message || 'اعتبارسنجی ناموفق بود.');
      }
    } catch (err: any) {
      setError('خطا در ارتباط با سرور.');
      setIsLoggedIn(false);
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/seller-portal/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, chatId })
      });
      const data = await res.json();
      if (data.success) {
        const activeChatId = String(data.seller.chatId);
        setChatId(activeChatId);
        fetchPortalInfo(activeChatId);
      } else {
        setError(data.message || 'نام کاربری یا کلمه عبور نادرست است.');
        setLoading(false);
      }
    } catch (err) {
      setError('خطا در برقرار اتصال با سرور.');
      setLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('seller_portal_chatid');
    setIsLoggedIn(false);
    setSellerData(null);
    setChatId('');
  };

  const handleSavePrices = async () => {
    setSavingSettings(true);
    try {
      const res = await fetch(`/api/seller-portal/save-prices/${chatId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customDisplayPrices: customPrices,
          showCustomPricesOnly
        })
      });
      const data = await res.json();
      if (data.success) {
        setShowSettingsModal(false);
        fetchPortalInfo(chatId);
      } else {
        alert(data.message || 'خطا در ذخیره قیمت‌ها');
      }
    } catch (err) {
      alert('خطا در ذخیره‌سازی.');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleBuyProduct = async () => {
    if (!selectedProduct) return;
    setPurchasing(true);
    try {
      const res = await fetch(`/api/seller-portal/buy/${chatId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: selectedProduct.id,
          customName: customClientName.trim()
        })
      });
      const data = await res.json();
      if (data.success) {
        setPurchaseResult(data);
        setSelectedProduct(null);
        setCustomClientName('');
        // Refresh seller debt
        fetchPortalInfo(chatId);
      } else {
        alert(`❌ خطا: ${data.message}`);
      }
    } catch (err) {
      alert('خطا در ثبت سفارش.');
    } finally {
      setPurchasing(false);
    }
  };

  const handleCopyCleanText = () => {
    if (!purchaseResult?.cleanMessage) return;
    const plainText = purchaseResult.cleanMessage.replace(/<[^>]+>/g, '');
    navigator.clipboard.writeText(plainText);
    setCopiedText(true);
    setTimeout(() => setCopiedText(false), 2500);
  };

  const filteredProducts = products.filter(p => {
    const matchesCat = selectedCategory === 'all' || p.categoryId === selectedCategory;
    const matchesSearch = !searchQuery || 
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
      String(p.volumeGb).includes(searchQuery);
    return matchesCat && matchesSearch;
  });

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-4 dir-rtl font-vazir">
        <div className="relative w-16 h-16 mb-4">
          <div className="absolute inset-0 rounded-full border-4 border-emerald-500/20 border-t-emerald-500 animate-spin"></div>
          <Zap className="w-8 h-8 text-emerald-400 absolute inset-0 m-auto" />
        </div>
        <p className="text-slate-400 text-sm animate-pulse">در حال بارگذاری فروشگاه...</p>
      </div>
    );
  }

  if (!isLoggedIn) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-100 flex items-center justify-center p-4 dir-rtl font-vazir">
        <div className="w-full max-w-md bg-slate-900/90 backdrop-blur-xl border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl">
          <div className="flex flex-col items-center text-center mb-8">
            <div className="w-16 h-16 bg-gradient-to-br from-emerald-500 to-teal-700 rounded-2xl flex items-center justify-center shadow-lg shadow-emerald-500/20 mb-4">
              <ShoppingBag className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-slate-100 mb-1">پورتال فروشگاهی همکار</h1>
            <p className="text-xs text-slate-400">ورود به محیط اختصاصی ساخت کانفیگ برای مشتریان</p>
          </div>

          {error && (
            <div className="mb-6 p-3.5 bg-rose-500/10 border border-rose-500/20 rounded-2xl flex items-center gap-3 text-rose-400 text-xs">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">شناسه کاربری (Chat ID) یا نام کاربری</label>
              <input
                type="text"
                value={chatId || username}
                onChange={(e) => {
                  setChatId(e.target.value);
                  setUsername(e.target.value);
                }}
                placeholder="مثال: 123456789"
                className="w-full px-4 py-3 bg-slate-950/80 border border-slate-800 rounded-2xl text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:border-emerald-500 transition"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">کلمه عبور اختصاصی همکار</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="کلمه عبور دریافتی از ربات"
                className="w-full px-4 py-3 bg-slate-950/80 border border-slate-800 rounded-2xl text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:border-emerald-500 transition"
              />
            </div>

            <button
              type="submit"
              className="w-full py-3.5 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white font-semibold rounded-2xl shadow-lg shadow-emerald-500/20 text-sm transition flex items-center justify-center gap-2"
            >
              <span>ورود به فروشگاه</span>
              <ShieldCheck className="w-4 h-4" />
            </button>
          </form>

          <div className="mt-8 pt-6 border-t border-slate-800/80 text-center">
            <p className="text-xs text-slate-500 leading-relaxed">
              💡 برای دریافت مشخصات ورود اختصاصی، در ربات تلگرام دکمه <span className="text-slate-300">«🌐 پورتال بی‌نام»</span> را لمس نمایید.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 dir-rtl font-vazir pb-12">
      {/* Top Header - White Label Storefront Style */}
      <header className="sticky top-0 z-30 bg-slate-900/80 backdrop-blur-xl border-b border-slate-800/80 px-4 py-3.5 shadow-md">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-500/10 border border-emerald-500/20 rounded-xl flex items-center justify-center text-emerald-400">
              <Globe className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-base font-bold text-slate-100 flex items-center gap-1.5">
                <span>فروشگاه خدمات شبکه</span>
                <span className="text-[10px] bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full border border-emerald-500/30 font-medium">فعال</span>
              </h1>
              <p className="text-[11px] text-slate-400">تحویل آنی و مستقیم کانفیگ اختصاصی</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSettingsModal(true)}
              className="p-2.5 bg-slate-800/90 hover:bg-slate-700 text-slate-200 rounded-xl border border-slate-700/60 transition flex items-center gap-1.5 text-xs font-medium"
              title="تنظیمات قیمت مشتری"
            >
              <Settings className="w-4 h-4 text-emerald-400" />
              <span className="hidden sm:inline">تنظیم قیمت‌ها</span>
            </button>

            <button
              onClick={handleLogout}
              className="p-2.5 bg-slate-800/90 hover:bg-rose-950/40 text-slate-400 hover:text-rose-400 rounded-xl border border-slate-700/60 transition"
              title="خروج"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-4 pt-6 space-y-6">

        {/* Search & Categories Bar */}
        <div className="space-y-3">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute right-3.5 top-3.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="جستجوی سرویس یا حجم..."
              className="w-full pl-4 pr-10 py-2.5 bg-slate-900 border border-slate-800 rounded-2xl text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:border-emerald-500/60 transition"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="absolute left-3 top-3 text-slate-500 hover:text-slate-300">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Categories Horizontal Scroll */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
            <button
              onClick={() => setSelectedCategory('all')}
              className={`px-4 py-2 rounded-xl text-xs font-medium whitespace-nowrap transition ${
                selectedCategory === 'all'
                  ? 'bg-emerald-500 text-slate-950 font-bold shadow-lg shadow-emerald-500/20'
                  : 'bg-slate-900 text-slate-400 hover:bg-slate-850 border border-slate-800'
              }`}
            >
              همه سرویس‌ها ({products.length})
            </button>

            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                className={`px-4 py-2 rounded-xl text-xs font-medium whitespace-nowrap transition ${
                  selectedCategory === cat.id
                    ? 'bg-emerald-500 text-slate-950 font-bold shadow-lg shadow-emerald-500/20'
                    : 'bg-slate-900 text-slate-400 hover:bg-slate-850 border border-slate-800'
                }`}
              >
                {cat.name}
              </button>
            ))}
          </div>
        </div>

        {/* Product Grid */}
        {filteredProducts.length === 0 ? (
          <div className="text-center py-12 bg-slate-900/50 border border-slate-800/80 rounded-3xl p-6">
            <ShoppingBag className="w-12 h-12 text-slate-600 mx-auto mb-3" />
            <p className="text-slate-400 text-sm font-medium">هیچ سرویسی در این بخش یافت نشد.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredProducts.map((product) => {
              const displayPrice = product.customDisplayPrice;
              const hasCustomPrice = displayPrice !== null && displayPrice !== undefined;

              return (
                <div
                  key={product.id}
                  className="bg-slate-900/90 border border-slate-800 hover:border-emerald-500/40 rounded-3xl p-5 flex flex-col justify-between space-y-4 transition-all duration-200 shadow-lg hover:shadow-emerald-500/5 group"
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-bold text-slate-100 text-base group-hover:text-emerald-400 transition">
                        {product.name}
                      </h3>
                      {product.isPayAsYouGo ? (
                        <span className="bg-amber-500/10 border border-amber-500/30 text-amber-400 text-[10px] px-2 py-0.5 rounded-full font-medium whitespace-nowrap">
                          مصرف آزاد
                        </span>
                      ) : (
                        <span className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[10px] px-2 py-0.5 rounded-full font-medium whitespace-nowrap">
                          استاندارد
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800/80 text-xs text-slate-300">
                      <div className="flex items-center gap-1.5 bg-slate-950/60 p-2 rounded-xl">
                        <HardDrive className="w-3.5 h-3.5 text-emerald-400" />
                        <span>{product.isPayAsYouGo ? 'نامحدود' : `${product.volumeGb} GB`}</span>
                      </div>
                      <div className="flex items-center gap-1.5 bg-slate-950/60 p-2 rounded-xl">
                        <Clock className="w-3.5 h-3.5 text-teal-400" />
                        <span>{product.isPayAsYouGo ? 'نامحدود' : `${product.durationDays} روز`}</span>
                      </div>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between gap-2">
                    <div>
                      {showCustomPricesOnly && hasCustomPrice ? (
                        <div>
                          <span className="text-xs text-slate-500 block">قیمت:</span>
                          <span className="text-base font-extrabold text-slate-100">
                            {displayPrice.toLocaleString()} <span className="text-xs font-normal text-slate-400">تومان</span>
                          </span>
                        </div>
                      ) : (
                        <div>
                          <span className="text-xs text-slate-500 block">قیمت:</span>
                          <span className="text-sm font-semibold text-emerald-400">تماس / توافقی</span>
                        </div>
                      )}
                    </div>

                    <button
                      onClick={() => setSelectedProduct(product)}
                      className="px-4 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold text-xs rounded-2xl shadow-md shadow-emerald-500/10 transition flex items-center gap-1.5"
                    >
                      <span>انتخاب</span>
                      <Zap className="w-3.5 h-3.5 fill-current" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Settings Modal (Custom Display Prices for Reseller) */}
      {showSettingsModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 dir-rtl">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800 mb-4">
              <div className="flex items-center gap-2">
                <Sliders className="w-5 h-5 text-emerald-400" />
                <h2 className="font-bold text-slate-100 text-base">تنظیم لیست قیمت فروشگاهی مشتری</h2>
              </div>
              <button onClick={() => setShowSettingsModal(false)} className="text-slate-400 hover:text-slate-200 p-1">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="text-xs text-slate-400 mb-4 bg-slate-950 p-3 rounded-2xl border border-slate-800 leading-relaxed">
              💡 <b>توجه:</b> قیمت‌های وارد شده در این بخش صرفاً برای <b>نمایش به مشتری حضوری</b> است و هیچ تاثیری در قیمت خرید عمده شما در ربات ندارد. خرید واقعی شما در ربات طبق تخفیف همکاری محاسبه می‌شود.
            </div>

            <div className="flex items-center justify-between bg-slate-950 p-3.5 rounded-2xl border border-slate-800 mb-4">
              <span className="text-xs font-medium text-slate-200">نمایش قیمت‌های سفارشی به مشتری</span>
              <input
                type="checkbox"
                checked={showCustomPricesOnly}
                onChange={(e) => setShowCustomPricesOnly(e.target.checked)}
                className="w-4 h-4 accent-emerald-500 cursor-pointer"
              />
            </div>

            <div className="overflow-y-auto space-y-3 flex-1 pr-1">
              {products.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-3 bg-slate-950/80 p-3 rounded-2xl border border-slate-800">
                  <div className="flex-1">
                    <p className="text-xs font-bold text-slate-200">{p.name}</p>
                    <p className="text-[10px] text-slate-500">
                      {p.isPayAsYouGo ? 'مصرف آزاد' : `${p.volumeGb}GB / ${p.durationDays}روز`}
                    </p>
                  </div>

                  <div className="w-36">
                    <input
                      type="number"
                      value={customPrices[p.id] !== undefined ? customPrices[p.id] : ''}
                      onChange={(e) => {
                        const val = e.target.value === '' ? undefined : Number(e.target.value);
                        setCustomPrices(prev => {
                          const next = { ...prev };
                          if (val === undefined) delete next[p.id];
                          else next[p.id] = val;
                          return next;
                        });
                      }}
                      placeholder="قیمت تومان"
                      className="w-full px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-xl text-slate-100 text-xs focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="pt-4 border-t border-slate-800 mt-4 flex justify-end gap-2">
              <button
                onClick={() => setShowSettingsModal(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded-xl"
              >
                انصراف
              </button>
              <button
                onClick={handleSavePrices}
                disabled={savingSettings}
                className="px-5 py-2 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold text-xs rounded-xl transition"
              >
                {savingSettings ? 'در حال ذخیره...' : 'ذخیره تنظیمات'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Buy Modal */}
      {selectedProduct && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 dir-rtl">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-emerald-400" />
                <h2 className="font-bold text-slate-100 text-base">ثبت سفارش و ساخت آنی کانفیگ</h2>
              </div>
              <button onClick={() => setSelectedProduct(null)} className="text-slate-400 hover:text-slate-200">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">نام پکیج:</span>
                <span className="font-bold text-slate-100">{selectedProduct.name}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">حجم و زمان:</span>
                <span className="text-slate-200">
                  {selectedProduct.isPayAsYouGo ? 'مصرف آزاد' : `${selectedProduct.volumeGb} GB / ${selectedProduct.durationDays} روز`}
                </span>
              </div>
              <div className="flex justify-between text-xs pt-2 border-t border-slate-800/80">
                <span className="text-slate-400">مبلغ ثبت در بدهی شما (عمده):</span>
                <span className="font-bold text-emerald-400">
                  {selectedProduct.realWholesalePrice.toLocaleString()} تومان
                </span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">عنوان اختصاصی کانفیگ برای مشتری (اختیاری)</label>
              <input
                type="text"
                value={customClientName}
                onChange={(e) => setCustomClientName(e.target.value)}
                placeholder="مثال: علی - آیفون"
                className="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 rounded-2xl text-slate-100 placeholder-slate-500 text-xs focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setSelectedProduct(null)}
                className="px-4 py-2.5 bg-slate-800 text-slate-300 text-xs font-medium rounded-xl"
              >
                انصراف
              </button>
              <button
                onClick={handleBuyProduct}
                disabled={purchasing}
                className="px-5 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold text-xs rounded-xl shadow-lg shadow-emerald-500/20 transition flex items-center gap-1.5"
              >
                {purchasing ? (
                  <span>در حال ساخت کانفیگ...</span>
                ) : (
                  <>
                    <span>تأیید و دریافت کانفیگ</span>
                    <Check className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Result Modal (QR Code & Clean Client Info) */}
      {purchaseResult && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 dir-rtl">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-5 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Check className="w-5 h-5 text-emerald-400" />
                <h2 className="font-bold text-slate-100 text-base">کانفیگ با موفقیت ساخته شد</h2>
              </div>
              <button onClick={() => setPurchaseResult(null)} className="text-slate-400 hover:text-slate-200">
                <X className="w-5 h-5" />
              </button>
            </div>

            {purchaseResult.qrCodeDataUrl && (
              <div className="bg-white p-4 rounded-2xl flex flex-col items-center justify-center w-48 h-48 mx-auto shadow-inner">
                <img src={purchaseResult.qrCodeDataUrl} alt="QR Code" className="w-full h-full object-contain" />
              </div>
            )}

            <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 text-xs text-slate-300 leading-relaxed space-y-2">
              <p className="font-bold text-slate-100 mb-2 border-b border-slate-800/80 pb-2 flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>اطلاعات بدون نام و برند آماده ارسال به مشتری</span>
              </p>
              <pre className="whitespace-pre-wrap font-vazir text-[11px] text-slate-300 bg-slate-900/80 p-3 rounded-xl border border-slate-800 overflow-x-auto">
                {purchaseResult.cleanMessage.replace(/<[^>]+>/g, '')}
              </pre>
            </div>

            <div className="space-y-2">
              <button
                onClick={handleCopyCleanText}
                className="w-full py-3 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold text-xs rounded-2xl shadow-lg shadow-emerald-500/20 transition flex items-center justify-center gap-2"
              >
                {copiedText ? (
                  <>
                    <Check className="w-4 h-4" />
                    <span>متن کپی شد!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" />
                    <span>کپی متن کامل بدون برند جهت ارسال به مشتری</span>
                  </>
                )}
              </button>

              <button
                onClick={() => setPurchaseResult(null)}
                className="w-full py-2.5 bg-slate-800 text-slate-300 text-xs font-medium rounded-2xl hover:bg-slate-700"
              >
                بستن
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
