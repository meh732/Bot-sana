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
  AlertCircle,
  CreditCard,
  Receipt,
  BarChart3,
  List,
  RefreshCw,
  Edit3,
  Trash2,
  Gift,
  Upload,
  ExternalLink,
  Server,
  TrendingUp,
  Plus,
  Minus,
  Layers,
  Download,
  Ban,
  Key,
  Info,
  Bot,
  Power
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
  const [accountingData, setAccountingData] = useState<any>(null);
  const [categories, setCategories] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [freeTestInfo, setFreeTestInfo] = useState<{ enabled: boolean; volumeGb: number; durationDays: number }>({
    enabled: true,
    volumeGb: 1,
    durationDays: 3
  });

  // Navigation tabs
  const [activeTab, setActiveTab] = useState<'store' | 'debt' | 'purchases' | 'ledger' | 'reports' | 'api' | 'bot'>('store');
  const [reportPeriod, setReportPeriod] = useState<'today' | 'monthly' | 'all'>('today');

  // White-label Reseller Telegram Bot state
  const [botConfig, setBotConfig] = useState<any>({
    enabled: false,
    botToken: '',
    botName: '',
    adminChatId: '',
    logoUrl: '',
    welcomeMessage: '',
    supportUsername: '',
    channelUsername: '',
    cardNumber: '',
    cardHolder: '',
    autoDeliverAfterPayment: false,
    freeTestEnabled: true,
    customRetailPrices: {},
    customVolumeRetailPricePerGb: 3500
  });
  const [botStatus, setBotStatus] = useState<any>({
    isOnline: false,
    botUsername: '',
    buyersCount: 0,
    ordersCount: 0,
    pendingOrdersCount: 0,
    totalRevenue: 0,
    totalProfit: 0
  });
  const [botProducts, setBotProducts] = useState<any[]>([]);
  const [botCustomVolume, setBotCustomVolume] = useState<any>({
    wholesalePricePerGb: 3000,
    retailPricePerGb: 3500,
    profitPerGb: 500
  });
  const [loadingBotConfig, setLoadingBotConfig] = useState(false);
  const [savingBotConfig, setSavingBotConfig] = useState(false);
  const [botSaveSuccessMsg, setBotSaveSuccessMsg] = useState('');
  const [botSaveErrorMsg, setBotSaveErrorMsg] = useState('');
  const [orderActionLoading, setOrderActionLoading] = useState<string | null>(null);

  // Live API Tester states
  const [testingApi, setTestingApi] = useState(false);
  const [apiTestResponse, setApiTestResponse] = useState<any>(null);
  const [apiTestError, setApiTestError] = useState<string>('');

  // Custom Shamsi Date Search
  const [shamsiStart, setShamsiStart] = useState('');
  const [shamsiEnd, setShamsiEnd] = useState('');

  // Bank Info for debt payments
  const [bankInfo, setBankInfo] = useState<{ cardNumber: string; cardHolder: string }>({ cardNumber: '', cardHolder: '' });
  const [showDebtPaymentModal, setShowDebtPaymentModal] = useState(false);
  const [debtPaymentAmount, setDebtPaymentAmount] = useState('');
  const [debtReceiptBase64, setDebtReceiptBase64] = useState('');
  const [submittingDebtPayment, setSubmittingDebtPayment] = useState(false);
  const [debtPaymentSuccessMsg, setDebtPaymentSuccessMsg] = useState('');

  // Store filters & Custom volume order states
  const [storeMode, setStoreMode] = useState<'custom_volume' | 'packages'>('custom_volume');
  const [customVolumeInfo, setCustomVolumeInfo] = useState<{
    enabled: boolean;
    pricePerGb: number;
    finalPricePerGb: number;
    sellerDiscount: number;
    minGb: number;
    defaultDays: number;
    defaultPanel: string;
    availablePanels: { id: string; name: string }[];
  }>({
    enabled: true,
    pricePerGb: 3000,
    finalPricePerGb: 3000,
    sellerDiscount: 0,
    minGb: 1,
    defaultDays: 30,
    defaultPanel: 'mrocean',
    availablePanels: [
      { id: 'mrocean', name: 'مستر اوشن (Mr Ocean) 🌊' },
      { id: 'sanaei', name: 'سنایی (X-UI) 🔵' },
      { id: 'rebecca', name: 'ربکا (Rebecca) 🟣' },
      { id: 'panel4', name: 'پنل ۴ (Panel 4) 🔸' }
    ]
  });

  const [customVolGb, setCustomVolGb] = useState<number>(20);
  const [customDurDays, setCustomDurDays] = useState<number>(30);
  const [customSelectedPanel, setCustomSelectedPanel] = useState<string>('mrocean');
  const [customSelectedCategoryId, setCustomSelectedCategoryId] = useState<string>('');
  const [customClientRemark, setCustomClientRemark] = useState<string>('');
  const [customClientSellingPrice, setCustomClientSellingPrice] = useState<string>('');
  const [orderingCustomVolume, setOrderingCustomVolume] = useState<boolean>(false);
  const [customVolumeError, setCustomVolumeError] = useState<string>('');

  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Settings state (Customer pricing)
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showApiModal, setShowApiModal] = useState(false);
  const [regeneratingApiKey, setRegeneratingApiKey] = useState(false);
  const [customPrices, setCustomPrices] = useState<{ [key: string]: number }>({});
  const [showCustomPricesOnly, setShowCustomPricesOnly] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);

  // Buy modal state
  const [selectedProduct, setSelectedProduct] = useState<any>(null);
  const [customClientName, setCustomClientName] = useState('');
  const [purchasing, setPurchasing] = useState(false);
  const [showWholesalePrice, setShowWholesalePrice] = useState(false);

  // Free Test Modal state
  const [showFreeTestModal, setShowFreeTestModal] = useState(false);
  const [freeTestClientName, setFreeTestClientName] = useState('');
  const [creatingFreeTest, setCreatingFreeTest] = useState(false);

  // Purchase Result Modal
  const [purchaseResult, setPurchaseResult] = useState<any>(null);
  const [copiedText, setCopiedText] = useState(false);
  const [copiedCleanMsg, setCopiedCleanMsg] = useState(false);

  // Purchased Config Detail Modal
  const [viewingPurchase, setViewingPurchase] = useState<any>(null);
  const [viewingQrCode, setViewingQrCode] = useState<string>('');
  const [purchasesSearchQuery, setPurchasesSearchQuery] = useState('');
  const [purchasesFilter, setPurchasesFilter] = useState<'all' | 'active' | 'disabled'>('all');
  const [togglingPurchaseId, setTogglingPurchaseId] = useState<string | null>(null);

  // Config actions modals
  const [renewingPurchase, setRenewingPurchase] = useState<any>(null);
  const [isRenewing, setIsRenewing] = useState(false);
  const [renamingPurchase, setRenamingPurchase] = useState<any>(null);
  const [newConfigName, setNewConfigName] = useState('');
  const [isRenaming, setIsRenaming] = useState(false);
  const [deletingPurchase, setDeletingPurchase] = useState<any>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [cancelPreview, setCancelPreview] = useState<any>(null);
  const [loadingCancelPreview, setLoadingCancelPreview] = useState(false);

  useEffect(() => {
    if (deletingPurchase && chatId) {
      setLoadingCancelPreview(true);
      setCancelPreview(null);
      fetch(`/api/seller-portal/purchases/${chatId}/${deletingPurchase.id}/cancel-preview`)
        .then(res => res.json())
        .then(data => {
          if (data.success) {
            setCancelPreview(data);
          }
        })
        .catch(() => {})
        .finally(() => setLoadingCancelPreview(false));
    } else {
      setCancelPreview(null);
    }
  }, [deletingPurchase, chatId]);

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
        setAccountingData(data.accounting);
        setCategories(data.categories || []);
        setProducts(data.products || []);
        if (data.freeTest) setFreeTestInfo(data.freeTest);
        if (data.customVolume) {
          setCustomVolumeInfo(data.customVolume);
          if (data.customVolume.defaultPanel) {
            setCustomSelectedPanel(data.customVolume.defaultPanel);
          }
          if (data.customVolume.defaultDays) {
            setCustomDurDays(data.customVolume.defaultDays);
          }
        }
        setCustomPrices(data.seller.customDisplayPrices || {});
        setShowCustomPricesOnly(data.seller.showCustomPricesOnly ?? true);
        if (data.bankInfo) setBankInfo(data.bankInfo);
        setIsLoggedIn(true);
        localStorage.setItem('seller_portal_chatid', idToUse);
        fetchBotConfig(idToUse);
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

  const fetchBotConfig = async (idToUse?: string) => {
    const targetId = idToUse || chatId;
    if (!targetId) return;
    setLoadingBotConfig(true);
    try {
      const res = await fetch(`/api/seller-portal/bot-config/${targetId}`);
      const data = await res.json();
      if (data.success) {
        if (data.sellerBot) setBotConfig(data.sellerBot);
        if (data.status) setBotStatus(data.status);
        if (data.products) setBotProducts(data.products);
        if (data.customVolume) setBotCustomVolume(data.customVolume);
      }
    } catch (e) {
      console.error('Error fetching reseller bot config', e);
    } finally {
      setLoadingBotConfig(false);
    }
  };

  const handleSaveBotConfig = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!chatId || !botConfig) return;
    setSavingBotConfig(true);
    setBotSaveSuccessMsg('');
    setBotSaveErrorMsg('');
    try {
      const res = await fetch(`/api/seller-portal/bot-config/${chatId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(botConfig)
      });
      const data = await res.json();
      if (data.success) {
        setBotSaveSuccessMsg(data.message || 'تنظیمات ربات اختصاصی با موفقیت ذخیره و اعمال شد.');
        if (data.status) setBotStatus(data.status);
        if (data.sellerBot) setBotConfig(data.sellerBot);
        fetchBotConfig(chatId);
      } else {
        setBotSaveErrorMsg(data.message || 'خطا در ذخیره تنظیمات ربات.');
      }
    } catch (err: any) {
      setBotSaveErrorMsg('خطا در برقراری ارتباط با سرور.');
    } finally {
      setSavingBotConfig(false);
    }
  };

  const handleBotOrderAction = async (orderId: string, action: 'approve' | 'reject') => {
    if (!chatId) return;
    setOrderActionLoading(orderId);
    try {
      const res = await fetch(`/api/seller-portal/bot-order-action/${chatId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, action })
      });
      const data = await res.json();
      if (data.success) {
        alert(data.message || 'عملیات با موفقیت انجام شد.');
        fetchBotConfig(chatId);
        fetchPortalInfo(chatId);
      } else {
        alert(data.message || 'خطا در انجام عملیات.');
      }
    } catch (e: any) {
      alert('خطا در ارتباط با سرور.');
    } finally {
      setOrderActionLoading(null);
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
        const targetChatId = String(data.seller?.chatId || data.chatId || chatId);
        setChatId(targetChatId);
        fetchPortalInfo(targetChatId);
      } else {
        setError(data.message || 'نام کاربری یا کلمه عبور اشتباه است.');
        setLoading(false);
      }
    } catch (err: any) {
      setError('خطا در اتصال به سرور.');
      setLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('seller_portal_chatid');
    setChatId('');
    setIsLoggedIn(false);
    setSellerData(null);
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
        alert('خطا در ذخیره‌سازی قیمت‌ها.');
      }
    } catch (err) {
      alert('خطا در ارتباط با سرور.');
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
        fetchPortalInfo(chatId);
      } else {
        alert(`❌ خطا: ${data.message}`);
      }
    } catch (err: any) {
      alert('خطا در ثبت سفارش: ' + err.message);
    } finally {
      setPurchasing(false);
    }
  };

  const handleOrderCustomVolume = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setCustomVolumeError('');

    const vol = Math.max(1, Number(customVolGb));
    if (isNaN(vol) || vol <= 0) {
      setCustomVolumeError('لطفاً میزان حجم معتبری به گیگابایت وارد فرمایید.');
      return;
    }

    if (vol < (customVolumeInfo.minGb || 1)) {
      setCustomVolumeError(`حداقل حجم مجاز برای سفارش ${customVolumeInfo.minGb} گیگابایت می‌باشد.`);
      return;
    }

    const dur = Math.max(1, Number(customDurDays || 30));

    setOrderingCustomVolume(true);
    try {
      const res = await fetch(`/api/seller-portal/buy-custom-volume/${chatId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          volumeGb: vol,
          durationDays: dur,
          panelType: customSelectedPanel || undefined,
          customName: customClientRemark.trim() || undefined,
          categoryId: customSelectedCategoryId || undefined
        })
      });
      const data = await res.json();
      if (data.success && data.purchase) {
        setPurchaseResult({
          purchase: data.purchase,
          qrCodeDataUrl: data.qrCodeDataUrl,
          cleanMessage: data.cleanMessage
        });
        if (sellerData) {
          const updatedPurchases = [data.purchase, ...(sellerData.purchases || [])];
          const newDebt = (sellerData.debt || 0) + (data.purchase.price || 0);
          setSellerData({
            ...sellerData,
            purchases: updatedPurchases,
            debt: newDebt,
            debtVolume: (sellerData.debtVolume || 0) + vol
          });
        }
        setCustomClientRemark('');
        setCustomClientSellingPrice('');
        fetchPortalInfo(chatId);
      } else {
        setCustomVolumeError(data.message || 'خطا در ثبت سفارش حجم دلخواه.');
      }
    } catch (err: any) {
      setCustomVolumeError(err.message || 'خطا در برقراری ارتباط با سرور.');
    } finally {
      setOrderingCustomVolume(false);
    }
  };

  const handleCreateFreeTest = async () => {
    setCreatingFreeTest(true);
    try {
      const res = await fetch(`/api/seller-portal/free-test/${chatId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customName: freeTestClientName.trim() })
      });
      const data = await res.json();
      if (data.success) {
        setShowFreeTestModal(false);
        setFreeTestClientName('');
        setPurchaseResult(data);
        fetchPortalInfo(chatId);
      } else {
        alert(`❌ خطا: ${data.message}`);
      }
    } catch (e: any) {
      alert('خطا در ایجاد اکانت تست: ' + e.message);
    } finally {
      setCreatingFreeTest(false);
    }
  };

  const handleToggleEnablePurchase = async (purchaseId: string, currentDisabled: boolean) => {
    setTogglingPurchaseId(purchaseId);
    try {
      const targetEnable = !!currentDisabled;
      const res = await fetch(`/api/seller-portal/purchases/${chatId}/${purchaseId}/toggle-enable`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enable: targetEnable })
      });
      const data = await res.json();
      if (data.success) {
        fetchPortalInfo(chatId);
      } else {
        alert('❌ خطا: ' + (data.message || 'عملیات ناموفق بود'));
      }
    } catch (e: any) {
      alert('خطا در ارتباط با سرور: ' + e.message);
    } finally {
      setTogglingPurchaseId(null);
    }
  };

  const handleRenewPurchase = async () => {
    if (!renewingPurchase) return;
    setIsRenewing(true);
    try {
      const res = await fetch(`/api/seller-portal/purchases/${chatId}/${renewingPurchase.id}/renew`, {
        method: 'POST'
      });
      const data = await res.json();
      if (data.success) {
        alert('🎉 ' + data.message);
        setRenewingPurchase(null);
        fetchPortalInfo(chatId);
      } else {
        alert('❌ خطا: ' + (data.message || 'تمدید سرویس ناموفق بود'));
      }
    } catch (e: any) {
      alert('خطا در ارتباط با سرور: ' + e.message);
    } finally {
      setIsRenewing(false);
    }
  };

  const handleRenamePurchase = async () => {
    if (!renamingPurchase || !newConfigName.trim()) return;
    setIsRenaming(true);
    try {
      const res = await fetch(`/api/seller-portal/purchases/${chatId}/${renamingPurchase.id}/rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newName: newConfigName.trim() })
      });
      const data = await res.json();
      if (data.success) {
        setRenamingPurchase(null);
        fetchPortalInfo(chatId);
      } else {
        alert('❌ خطا: ' + (data.message || 'تغییر نام ناموفق بود'));
      }
    } catch (e: any) {
      alert('خطا در ارتباط با سرور: ' + e.message);
    } finally {
      setIsRenaming(false);
    }
  };

  const handleDeletePurchase = async () => {
    if (!deletingPurchase) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/seller-portal/purchases/${chatId}/${deletingPurchase.id}`, {
        method: 'DELETE'
      });
      const data = await res.json();
      if (data.success) {
        alert(data.message || 'سرویس متوقف و با موفقیت ابطال شد.');
        setDeletingPurchase(null);
        fetchPortalInfo(chatId);
      } else {
        alert('❌ خطا: ' + (data.message || 'ابطال ناموفق بود'));
      }
    } catch (e: any) {
      alert('خطا در ارتباط با سرور: ' + e.message);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDebtPaymentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsedAmount = parseInt(debtPaymentAmount.replace(/[^0-9]/g, ''));
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      alert('لطفاً مبلغ معتبری به تومان وارد فرمایید.');
      return;
    }

    setSubmittingDebtPayment(true);
    try {
      const res = await fetch(`/api/seller-portal/submit-debt-payment/${chatId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: parsedAmount,
          receiptBase64: debtReceiptBase64
        })
      });
      const data = await res.json();
      if (data.success) {
        setDebtPaymentSuccessMsg(data.message || 'رسید پرداخت شما با موفقیت ارسال شد و در انتظار تایید مدیریت قرار گرفت.');
        setTimeout(() => {
          setShowDebtPaymentModal(false);
          setDebtPaymentSuccessMsg('');
          setDebtPaymentAmount('');
          setDebtReceiptBase64('');
          fetchPortalInfo(chatId);
        }, 2500);
      } else {
        alert(data.message || 'خطا در ثبت پرداخت.');
      }
    } catch (e: any) {
      alert('خطا در برقراری ارتباط با سرور.');
    } finally {
      setSubmittingDebtPayment(false);
    }
  };

  const handleCopyCleanText = (textOverride?: string) => {
    const rawMsg = textOverride || purchaseResult?.cleanMessage || '';
    if (!rawMsg) return;
    const plainText = rawMsg.replace(/<[^>]+>/g, '');
    navigator.clipboard.writeText(plainText);
    setCopiedText(true);
    setTimeout(() => setCopiedText(false), 2500);
  };

  const getCleanCustomerMessage = (p: any) => {
    if (!p) return '';
    const volStr = p.isPayAsYouGo ? 'نامحدود (مصرف آزاد)' : `${p.volumeGb || 0} گیگابایت`;
    const durStr = p.isPayAsYouGo ? 'نامحدود' : `${p.durationDays || 0} روز`;
    let txt = `🚀 کانفیگ اختصاصی شما آماده است\n\n` +
      `👤 عنوان سرویس: ${p.name || 'سرویس اشتراکی'}\n` +
      `📊 حجم کل: ${volStr}\n` +
      `⏳ مدت اعتبار: ${durStr}\n\n`;

    if (p.panel4SubUrl) {
      txt += `🔗 لینک اتصال (پنل ۴):\n${p.panel4SubUrl}\n\n`;
    }
    if (p.sanaeiSubUrl) {
      txt += `🔗 لینک اتصال (سرور ۱):\n${p.sanaeiSubUrl}\n\n`;
    }
    if (p.rebeccaSubUrl) {
      txt += `🔗 لینک اتصال (سرور ۲):\n${p.rebeccaSubUrl}\n\n`;
    }
    if (!p.sanaeiSubUrl && !p.rebeccaSubUrl && p.subUrl) {
      txt += `🔗 لینک اتصال:\n${p.subUrl}\n\n`;
    }
    txt += `⚡ راهنمای استفاده: لینک بالا را کپی کرده و در اپلیکیشن‌های V2RayNG / MahsaNG / Shadowrocket / Nekobox با لمس علامت + یا Update Subscription اضافه نمایید.`;
    return txt;
  };

  const filteredProducts = products.filter(p => {
    const matchesCat = selectedCategory === 'all' || p.categoryId === selectedCategory;
    const matchesSearch = !searchQuery || 
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
      String(p.volumeGb).includes(searchQuery);
    return matchesCat && matchesSearch;
  });

  const sellerPurchases = (sellerData?.purchases || []).filter((p: any) => {
    const matchesSearch = !purchasesSearchQuery || 
      (p.id && p.id.toLowerCase().includes(purchasesSearchQuery.toLowerCase())) ||
      (p.name && p.name.toLowerCase().includes(purchasesSearchQuery.toLowerCase())) ||
      (p.subId && String(p.subId).toLowerCase().includes(purchasesSearchQuery.toLowerCase()));

    if (!matchesSearch) return false;

    if (purchasesFilter === 'active') return !p.disabled;
    if (purchasesFilter === 'disabled') return !!p.disabled;
    return true;
  });

  const currentReport = accountingData?.[reportPeriod] || { summary: {}, salesItems: [], ledgerRows: [] };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-4 dir-rtl font-vazir">
        <div className="relative w-16 h-16 mb-4">
          <div className="absolute inset-0 rounded-full border-4 border-emerald-500/20 border-t-emerald-500 animate-spin"></div>
          <Zap className="w-8 h-8 text-emerald-400 absolute inset-0 m-auto" />
        </div>
        <p className="text-slate-400 text-sm animate-pulse">در حال بارگذاری اطلاعات پورتال همکار...</p>
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
            <h1 className="text-2xl font-bold text-slate-100 mb-1">پورتال اختصاصی همکار</h1>
            <p className="text-xs text-slate-400">ورود به محیط فروش، گزارشات و صورتحساب همکاران</p>
          </div>

          {error && (
            <div className="mb-6 p-3.5 bg-rose-500/10 border border-rose-500/20 rounded-2xl flex items-center gap-3 text-rose-400 text-xs leading-relaxed">
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
              <span>ورود به پورتال</span>
              <ShieldCheck className="w-4 h-4" />
            </button>
          </form>

          <div className="mt-8 pt-6 border-t border-slate-800/80 text-center">
            <p className="text-xs text-slate-500 leading-relaxed">
              💡 برای دریافت مشخصات ورود اختصاصی، در ربات تلگرام دکمه <span className="text-slate-300 font-bold">«🌐 پورتال بی‌نام»</span> را لمس نمایید.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 dir-rtl font-vazir pb-16">
      {/* Top Header - White Label Storefront & Dashboard Header */}
      <header className="sticky top-0 z-30 bg-slate-900/90 backdrop-blur-xl border-b border-slate-800/80 px-4 py-3.5 shadow-md">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl flex items-center justify-center text-emerald-400">
              <Globe className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-base font-bold text-slate-100 flex items-center gap-1.5">
                <span>پورتال اختصاصی همکار</span>
                <span className="text-[10px] bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full border border-emerald-500/30 font-medium">
                  {sellerData?.portalUsername ? `@${sellerData.portalUsername}` : sellerData?.chatId}
                </span>
              </h1>
              <p className="text-[11px] text-slate-400">ساخت کانفیگ بی‌نام، تمدید، وضعیت بدهی و گزارشات</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {freeTestInfo.enabled && (
              <button
                onClick={() => setShowFreeTestModal(true)}
                className="px-3 py-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-slate-950 font-bold rounded-xl text-xs transition flex items-center gap-1.5 shadow-sm"
                title="ساخت اکانت تست رایگان برای مشتری"
              >
                <Gift className="w-4 h-4 fill-current" />
                <span className="hidden sm:inline">اکانت تست رایگان</span>
              </button>
            )}

            <button
              onClick={() => setActiveTab('api')}
              className={`px-3 py-2 rounded-xl border transition flex items-center gap-1.5 text-xs font-bold shadow-sm ${
                activeTab === 'api'
                  ? 'bg-violet-600 text-white border-violet-400 shadow-violet-500/30'
                  : 'bg-violet-600/20 hover:bg-violet-600/30 text-violet-300 border-violet-500/40'
              }`}
              title="وب‌سرویس API برای اتصال به ربات فروشگاهی دیگر"
            >
              <Server className="w-4 h-4 text-violet-400" />
              <span>وب‌سرویس API</span>
            </button>

            <button
              onClick={() => setShowSettingsModal(true)}
              className="p-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl border border-slate-700/60 transition flex items-center gap-1.5 text-xs font-medium"
              title="تنظیم قیمت‌های فروش به مشتری"
            >
              <Settings className="w-4 h-4 text-emerald-400" />
              <span className="hidden sm:inline">تعیین قیمت مشتری</span>
            </button>

            <button
              onClick={handleLogout}
              className="p-2.5 bg-slate-800 hover:bg-rose-950/40 text-slate-400 hover:text-rose-400 rounded-xl border border-slate-700/60 transition"
              title="خروج"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Tab Navigation Menu */}
        <div className="max-w-5xl mx-auto mt-3 pt-3 border-t border-slate-800/60 flex items-center gap-2 overflow-x-auto no-scrollbar">
          <button
            onClick={() => setActiveTab('store')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'store'
                ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
                : 'bg-slate-800/70 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
            }`}
          >
            <ShoppingBag className="w-4 h-4" />
            <span>🛒 خرید سرویس جدید</span>
          </button>

          <button
            onClick={() => { setActiveTab('bot'); fetchBotConfig(); }}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'bot'
                ? 'bg-gradient-to-r from-blue-600 to-cyan-600 text-white shadow-md shadow-blue-500/30 ring-1 ring-blue-400'
                : 'bg-blue-950/40 text-blue-200 border border-blue-500/40 hover:bg-blue-900/50'
            }`}
          >
            <Bot className="w-4 h-4 text-cyan-400" />
            <span>🤖 ربات تلگرام اختصاصی من (برند و آرم شما)</span>
            {botStatus.isOnline && (
              <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block animate-pulse"></span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('api')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'api'
                ? 'bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-md shadow-violet-500/30 ring-1 ring-violet-400/50'
                : 'bg-violet-950/50 text-violet-200 border border-violet-500/50 hover:bg-violet-900/60'
            }`}
          >
            <Server className="w-4 h-4 text-violet-400" />
            <span>🔌 اتصال به وب‌سرویس API</span>
          </button>

          <button
            onClick={() => setActiveTab('purchases')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'purchases'
                ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
                : 'bg-slate-800/70 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
            }`}
          >
            <List className="w-4 h-4" />
            <span>📋 کانفیگ‌ها و مشتریان من ({sellerData?.purchases?.length || 0})</span>
          </button>

          <button
            onClick={() => setActiveTab('debt')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'debt'
                ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
                : 'bg-slate-800/70 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
            }`}
          >
            <CreditCard className="w-4 h-4" />
            <span>📉 بدهی و سقف اعتبار</span>
          </button>

          <button
            onClick={() => setActiveTab('ledger')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'ledger'
                ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
                : 'bg-slate-800/70 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
            }`}
          >
            <Receipt className="w-4 h-4" />
            <span>🧾 صورتحساب و تراکنش‌ها</span>
          </button>

          <button
            onClick={() => setActiveTab('reports')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'reports'
                ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
                : 'bg-slate-800/70 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
            }`}
          >
            <BarChart3 className="w-4 h-4" />
            <span>📊 گزارش عملکرد و فروش</span>
          </button>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-5xl mx-auto px-4 pt-6">

        {/* TAB 1: STORE / BUY SERVICE */}
        {activeTab === 'store' && (
          <div className="space-y-6">
            {/* Free Test Banner if active */}
            {freeTestInfo.enabled && (
              <div className="bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent border border-amber-500/30 rounded-3xl p-4 sm:p-5 flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-amber-500/20 border border-amber-500/30 rounded-2xl flex items-center justify-center text-amber-400">
                    <Gift className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-100 text-sm">اکانت تست رایگان برای جذب مشتری</h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      حجم تست: {freeTestInfo.volumeGb} GB | مدت اعتبار: {freeTestInfo.durationDays} روز (بدون کسر از اعتبار)
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setShowFreeTestModal(true)}
                  className="px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs rounded-xl shadow-md transition flex items-center gap-1.5"
                >
                  <span>ساخت اکانت تست</span>
                  <Zap className="w-4 h-4 fill-current" />
                </button>
              </div>
            )}

            {/* Mode Switcher */}
            <div className="bg-slate-900/90 backdrop-blur-md p-1.5 rounded-2xl border border-slate-800 flex items-center gap-2 shadow-lg">
              <button
                type="button"
                onClick={() => setStoreMode('custom_volume')}
                className={`flex-1 py-3 px-4 rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 ${
                  storeMode === 'custom_volume'
                    ? 'bg-gradient-to-r from-emerald-500 to-teal-600 text-slate-950 shadow-lg shadow-emerald-500/20'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                }`}
              >
                <Sliders className="w-4 h-4" />
                <span>⚡ سفارش با حجم دلخواه (نرخ هر گیگ)</span>
                <span className="text-[10px] bg-slate-950/40 text-emerald-950 px-2 py-0.5 rounded-full font-bold">
                  {customVolumeInfo.finalPricePerGb.toLocaleString()} ت/گیگ
                </span>
              </button>

              <button
                type="button"
                onClick={() => setStoreMode('packages')}
                className={`flex-1 py-3 px-4 rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 ${
                  storeMode === 'packages'
                    ? 'bg-gradient-to-r from-emerald-500 to-teal-600 text-slate-950 shadow-lg shadow-emerald-500/20'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                }`}
              >
                <ShoppingBag className="w-4 h-4" />
                <span>📦 لیست پکیج‌های آماده فروش ({products.length})</span>
              </button>
            </div>

            {/* SUB-TAB 1: CUSTOM VOLUME ORDERING */}
            {storeMode === 'custom_volume' && (
              <div className="bg-slate-900/90 backdrop-blur-xl border border-slate-800 rounded-3xl p-5 sm:p-7 shadow-2xl space-y-6">
                {/* Header */}
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-5 border-b border-slate-800/80">
                  <div className="flex items-center gap-3.5">
                    <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-teal-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                      <Sliders className="w-6 h-6" />
                    </div>
                    <div>
                      <h2 className="text-base sm:text-lg font-bold text-slate-100 flex items-center gap-2">
                        <span>سفارش کانفیگ بر اساس حجم دلخواه</span>
                        <span className="text-[10px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-full font-semibold">
                          تحویل لحظه‌ای
                        </span>
                      </h2>
                      <p className="text-xs text-slate-400 mt-0.5">
                        تعیین دقیق گیگابایت و مدت زمان با نرخ ثابت هر گیگابایت برای همکار
                      </p>
                    </div>
                  </div>

                  <div className="bg-slate-950/80 border border-slate-800/90 rounded-2xl p-3 text-left sm:text-right w-full sm:w-auto">
                    <div className="text-[11px] text-slate-400">نرخ هر گیگابایت برای شما:</div>
                    <div className="text-base font-extrabold text-emerald-400 font-mono">
                      {customVolumeInfo.finalPricePerGb.toLocaleString()} <span className="text-xs font-normal text-slate-400">تومان</span>
                    </div>
                    {customVolumeInfo.sellerDiscount > 0 && (
                      <div className="text-[10px] text-teal-300">
                        ({customVolumeInfo.sellerDiscount}٪ تخفیف از {customVolumeInfo.pricePerGb.toLocaleString()} ت)
                      </div>
                    )}
                  </div>
                </div>

                {customVolumeError && (
                  <div className="p-4 bg-rose-500/10 border border-rose-500/30 rounded-2xl flex items-center gap-3 text-rose-400 text-xs leading-relaxed">
                    <AlertCircle className="w-5 h-5 shrink-0" />
                    <span>{customVolumeError}</span>
                  </div>
                )}

                {/* 1. Category / Group Choice */}
                <div className="space-y-2.5">
                  <label className="block text-xs font-bold text-slate-200">
                    📁 انتخاب گروه / دسته بندی محصول:
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    <div
                      onClick={() => setCustomSelectedCategoryId('')}
                      className={`cursor-pointer rounded-2xl p-3 border transition-all flex flex-col justify-between space-y-1.5 ${
                        !customSelectedCategoryId
                          ? 'bg-emerald-500/10 border-emerald-500 shadow-md shadow-emerald-500/10'
                          : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <div className="font-bold text-xs text-slate-100 flex items-center gap-1.5">
                        <span>🌟 پیش‌فرض / همه گروه‌ها</span>
                      </div>
                      <p className="text-[10px] text-slate-400">استفاده از تنظیمات پیش‌فرض پنل</p>
                    </div>

                    {categories.map((cat) => (
                      <div
                        key={cat.id}
                        onClick={() => setCustomSelectedCategoryId(cat.id)}
                        className={`cursor-pointer rounded-2xl p-3 border transition-all flex flex-col justify-between space-y-1.5 ${
                          customSelectedCategoryId === cat.id
                            ? 'bg-emerald-500/10 border-emerald-500 shadow-md shadow-emerald-500/10'
                            : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                        }`}
                      >
                        <div className="font-bold text-xs text-slate-100 flex items-center gap-1.5 truncate">
                          <span className="truncate">{cat.name}</span>
                        </div>
                        <p className="text-[10px] text-slate-400 truncate">ساخت کانفیگ از این گروه</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 2. Volume Selection */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-slate-200">
                      📦 حجم مورد نظر (گیگابایت):
                    </label>
                    <span className="text-xs text-emerald-400 font-mono font-bold">
                      {customVolGb} GB
                    </span>
                  </div>

                  {/* Fast Volume Chips */}
                  <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
                    {[10, 20, 30, 50, 80, 100, 150, 200].map((gb) => (
                      <button
                        key={gb}
                        type="button"
                        onClick={() => setCustomVolGb(gb)}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold font-mono transition whitespace-nowrap ${
                          customVolGb === gb
                            ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
                            : 'bg-slate-950/60 text-slate-300 hover:bg-slate-800 border border-slate-800'
                        }`}
                      >
                        {gb} GB
                      </button>
                    ))}
                  </div>

                  {/* Stepper + Input */}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setCustomVolGb((prev) => Math.max(customVolumeInfo.minGb || 1, prev - 5))}
                      className="p-3 bg-slate-950 hover:bg-slate-850 text-slate-300 rounded-2xl border border-slate-800 transition cursor-pointer"
                      title="کاهش ۵ گیگ"
                    >
                      <Minus className="w-4 h-4" />
                    </button>

                    <div className="relative flex-1">
                      <input
                        type="number"
                        min={customVolumeInfo.minGb || 1}
                        max={1000}
                        value={customVolGb}
                        onChange={(e) => setCustomVolGb(Math.max(1, Number(e.target.value) || 1))}
                        className="w-full px-4 py-3 bg-slate-950/90 border border-slate-800 rounded-2xl text-slate-100 text-center font-mono font-bold text-lg focus:outline-none focus:border-emerald-500 transition"
                      />
                      <span className="absolute left-4 top-3.5 text-xs text-slate-500 font-mono">GB</span>
                    </div>

                    <button
                      type="button"
                      onClick={() => setCustomVolGb((prev) => prev + 5)}
                      className="p-3 bg-slate-950 hover:bg-slate-850 text-slate-300 rounded-2xl border border-slate-800 transition cursor-pointer"
                      title="افزایش ۵ گیگ"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Range slider */}
                  <input
                    type="range"
                    min={customVolumeInfo.minGb || 1}
                    max={200}
                    value={customVolGb}
                    onChange={(e) => setCustomVolGb(Number(e.target.value))}
                    className="w-full accent-emerald-500 bg-slate-800 h-2 rounded-lg cursor-pointer"
                  />
                </div>

                {/* 3. Duration Selection */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-slate-200">
                      ⏳ مدت زمان اعتبار (روز):
                    </label>
                    <span className="text-xs text-teal-400 font-mono font-bold">
                      {customDurDays} روز
                    </span>
                  </div>

                  <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
                    {[30, 60, 90, 180, 365].map((days) => (
                      <button
                        key={days}
                        type="button"
                        onClick={() => setCustomDurDays(days)}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap ${
                          customDurDays === days
                            ? 'bg-teal-500 text-slate-950 shadow-md shadow-teal-500/20'
                            : 'bg-slate-950/60 text-slate-300 hover:bg-slate-800 border border-slate-800'
                        }`}
                      >
                        {days} روزه
                      </button>
                    ))}
                  </div>

                  <div className="relative">
                    <input
                      type="number"
                      min={1}
                      max={365}
                      value={customDurDays}
                      onChange={(e) => setCustomDurDays(Math.max(1, Number(e.target.value) || 30))}
                      className="w-full px-4 py-2.5 bg-slate-950/90 border border-slate-800 rounded-2xl text-slate-100 text-sm font-mono focus:outline-none focus:border-teal-500 transition"
                      placeholder="تعداد روز دلخواه..."
                    />
                    <span className="absolute left-4 top-3 text-xs text-slate-500">روز</span>
                  </div>
                </div>

                {/* 4. Customer Name / Remark */}
                <div className="space-y-2">
                  <label className="block text-xs font-bold text-slate-200">
                    👤 نام یا عنوان سرویس برای مشتری (اختیاری):
                  </label>
                  <input
                    type="text"
                    value={customClientRemark}
                    onChange={(e) => setCustomClientRemark(e.target.value)}
                    placeholder="مثال: گوشی علی، شرکت، لپ‌تاپ (جهت شناسایی در لیست)"
                    className="w-full px-4 py-3 bg-slate-950/90 border border-slate-800 rounded-2xl text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:border-emerald-500 transition"
                  />
                </div>

                {/* 5. Live Financial Summary & Optional Client Retail Price */}
                {(() => {
                  const wholesaleCost = Math.round(customVolGb * customVolumeInfo.finalPricePerGb);
                  const retailPriceNum = Number(customClientSellingPrice) || 0;
                  const estimatedProfit = retailPriceNum > 0 ? (retailPriceNum - wholesaleCost) : 0;

                  return (
                    <div className="bg-slate-950/80 border border-slate-800/90 rounded-2xl p-4 sm:p-5 space-y-4">
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                        <div className="bg-slate-900/60 p-3 rounded-xl border border-slate-800/60">
                          <span className="text-[11px] text-slate-400 block mb-1">حجم سفارش:</span>
                          <span className="font-bold font-mono text-slate-100 text-sm">{customVolGb} GB</span>
                        </div>
                        <div className="bg-slate-900/60 p-3 rounded-xl border border-slate-800/60">
                          <span className="text-[11px] text-slate-400 block mb-1">نرخ هر گیگابایت:</span>
                          <span className="font-bold font-mono text-emerald-400 text-sm">{customVolumeInfo.finalPricePerGb.toLocaleString()} ت</span>
                        </div>
                        <div className="bg-slate-900/60 p-3 rounded-xl border border-slate-800/60 col-span-2 sm:col-span-1">
                          <span className="text-[11px] text-slate-400 block mb-1">مبلغ ثبت در بدهی:</span>
                          <span className="font-extrabold font-mono text-emerald-400 text-base">{wholesaleCost.toLocaleString()} ت</span>
                        </div>
                      </div>

                      {/* Optional Retail Price Input */}
                      <div className="pt-3 border-t border-slate-800/80 space-y-2">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <label className="text-xs text-slate-300 font-medium">
                            💰 قیمت فروش پیشنهادی شما به مشتری (جهت محاسبه سود):
                          </label>
                          {retailPriceNum > 0 && (
                            <span className={`text-xs font-bold px-2.5 py-1 rounded-xl border ${
                              estimatedProfit >= 0
                                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                                : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                            }`}>
                              {estimatedProfit >= 0 ? `✨ سود شما: ${estimatedProfit.toLocaleString()} تومان` : `ضرر: ${Math.abs(estimatedProfit).toLocaleString()} تومان`}
                            </span>
                          )}
                        </div>
                        <div className="relative">
                          <input
                            type="number"
                            value={customClientSellingPrice}
                            onChange={(e) => setCustomClientSellingPrice(e.target.value)}
                            placeholder="مثال: ۱۲۰۰۰۰ (تومان)"
                            className="w-full px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-slate-100 placeholder-slate-600 text-xs font-mono focus:outline-none focus:border-emerald-500"
                          />
                          <span className="absolute left-3 top-2.5 text-[11px] text-slate-500">تومان</span>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* Submit Button */}
                <button
                  type="button"
                  onClick={handleOrderCustomVolume}
                  disabled={orderingCustomVolume}
                  className="w-full py-4 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 disabled:opacity-50 text-slate-950 font-bold text-sm rounded-2xl shadow-xl shadow-emerald-500/20 transition flex items-center justify-center gap-2 cursor-pointer"
                >
                  {orderingCustomVolume ? (
                    <>
                      <RefreshCw className="w-5 h-5 animate-spin" />
                      <span>در حال ساخت و ثبت آنی کانفیگ...</span>
                    </>
                  ) : (
                    <>
                      <Zap className="w-5 h-5 fill-current" />
                      <span>
                        ثبت سفارش و تحویل آنی کانفیگ ({Math.round(customVolGb * customVolumeInfo.finalPricePerGb).toLocaleString()} تومان)
                      </span>
                    </>
                  )}
                </button>
              </div>
            )}

            {/* SUB-TAB 2: READY PACKAGES LIST */}
            {storeMode === 'packages' && (
              <div className="space-y-6">
                {/* Search & Categories */}
                <div className="space-y-3">
                  <div className="relative">
                    <Search className="w-4 h-4 text-slate-400 absolute right-3.5 top-3.5" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="جستجوی پکیج آماده فروش..."
                      className="w-full pl-4 pr-10 py-2.5 bg-slate-900 border border-slate-800 rounded-2xl text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:border-emerald-500/60 transition"
                    />
                    {searchQuery && (
                      <button onClick={() => setSearchQuery('')} className="absolute left-3 top-3 text-slate-500 hover:text-slate-300">
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>

                  {/* Categories Scroll */}
                  <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
                    <button
                      onClick={() => setSelectedCategory('all')}
                      className={`px-4 py-2 rounded-xl text-xs font-medium whitespace-nowrap transition ${
                        selectedCategory === 'all'
                          ? 'bg-emerald-500 text-slate-950 font-bold shadow-lg shadow-emerald-500/20'
                          : 'bg-slate-900 text-slate-400 hover:bg-slate-850 border border-slate-800'
                      }`}
                    >
                      همه محصولات آماده فروش ({products.length})
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

                {/* Product Cards */}
                {filteredProducts.length === 0 ? (
                  <div className="text-center py-12 bg-slate-900/50 border border-slate-800/80 rounded-3xl p-6">
                    <ShoppingBag className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                    <p className="text-slate-400 text-sm font-medium">هیچ محصول آماده فروشی در این بخش موجود نیست.</p>
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
                                  آماده فروش
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
                                  <span className="text-[10px] text-slate-500 block">قیمت مشتری:</span>
                                  <span className="text-base font-extrabold text-slate-100 font-mono">
                                    {displayPrice.toLocaleString()} <span className="text-xs font-normal text-slate-400">تومان</span>
                                  </span>
                                </div>
                              ) : (
                                <div>
                                  <span className="text-[10px] text-slate-500 block">قیمت مشتری:</span>
                                  <span className="text-sm font-semibold text-emerald-400">توافقی / تماس</span>
                                </div>
                              )}
                            </div>

                            <button
                              onClick={() => setSelectedProduct(product)}
                              className="px-4 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold text-xs rounded-2xl shadow-md shadow-emerald-500/10 transition flex items-center gap-1.5 cursor-pointer"
                            >
                              <span>ثبت و ساخت آنی</span>
                              <Zap className="w-3.5 h-3.5 fill-current" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* TAB 2: SOLD CONFIGS & CUSTOMERS */}
        {activeTab === 'purchases' && (
          <div className="space-y-4">
            {/* Search & Status Filters */}
            <div className="flex flex-col sm:flex-row items-center gap-3">
              <div className="relative flex-1 w-full">
                <Search className="w-4 h-4 text-slate-400 absolute right-3.5 top-3.5" />
                <input
                  type="text"
                  value={purchasesSearchQuery}
                  onChange={(e) => setPurchasesSearchQuery(e.target.value)}
                  placeholder="جستجوی نام مشتری، شناسه یا ساب..."
                  className="w-full pl-4 pr-10 py-2.5 bg-slate-900 border border-slate-800 rounded-2xl text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="flex items-center gap-1.5 bg-slate-900 p-1 rounded-2xl border border-slate-800 text-xs w-full sm:w-auto justify-center">
                <button
                  onClick={() => setPurchasesFilter('all')}
                  className={`px-3 py-1.5 rounded-xl font-bold transition ${
                    purchasesFilter === 'all' ? 'bg-emerald-500 text-slate-950' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  همه ({sellerData?.purchases?.length || 0})
                </button>
                <button
                  onClick={() => setPurchasesFilter('active')}
                  className={`px-3 py-1.5 rounded-xl font-bold transition ${
                    purchasesFilter === 'active' ? 'bg-emerald-500 text-slate-950' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  فعال ({(sellerData?.purchases || []).filter((p: any) => !p.disabled).length})
                </button>
                <button
                  onClick={() => setPurchasesFilter('disabled')}
                  className={`px-3 py-1.5 rounded-xl font-bold transition ${
                    purchasesFilter === 'disabled' ? 'bg-rose-500 text-slate-950' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  قطع شده ({(sellerData?.purchases || []).filter((p: any) => !!p.disabled).length})
                </button>
              </div>
            </div>

            {sellerPurchases.length === 0 ? (
              <div className="text-center py-12 bg-slate-900/50 border border-slate-800 rounded-3xl p-6">
                <List className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                <p className="text-slate-400 text-sm">هیچ کانفیگی مطابق با فیلتر شما یافت نشد.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {sellerPurchases.map((p: any) => {
                  const usedGb = ((p.lastUsedBytes || 0) / (1024 * 1024 * 1024)).toFixed(1);
                  const totalGb = p.volumeGb || 0;
                  const percentUsed = totalGb > 0 ? Math.min(100, Math.round((Number(usedGb) / totalGb) * 100)) : 0;

                  return (
                    <div key={p.id} className="bg-slate-900 border border-slate-800 rounded-3xl p-4 sm:p-5 space-y-4 hover:border-slate-700 transition shadow-lg">
                      <div className="flex justify-between items-start flex-wrap gap-2">
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <h4 className="font-bold text-slate-100 text-base">
                              {p.name || 'سرویس اشتراکی'}
                            </h4>
                            {p.disabled ? (
                              <span className="bg-rose-500/20 text-rose-400 text-[10px] px-2.5 py-0.5 rounded-full border border-rose-500/30 font-medium">
                                🛑 قطع شده
                              </span>
                            ) : (
                              <span className="bg-emerald-500/20 text-emerald-400 text-[10px] px-2.5 py-0.5 rounded-full border border-emerald-500/30 font-medium">
                                🟢 متصل و فعال
                              </span>
                            )}
                            {p.isPayAsYouGo ? (
                              <span className="bg-amber-500/20 text-amber-400 text-[10px] px-2.5 py-0.5 rounded-full border border-amber-500/30 font-medium">
                                مصرف آزاد
                              </span>
                            ) : (
                              <span className="bg-slate-800 text-slate-300 text-[10px] px-2.5 py-0.5 rounded-full border border-slate-700 font-medium">
                                {p.volumeGb} GB / {p.durationDays} روز
                              </span>
                            )}
                            {p.isCancelled && (
                              <span className="bg-rose-500/20 text-rose-400 text-[10px] px-2.5 py-0.5 rounded-full border border-rose-500/30 font-medium">
                                ابطال‌شده {p.cancellationCost === 0 ? '(رایگان)' : `(${Number(p.cancellationCost).toLocaleString()} ت)`}
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-slate-500 font-mono mt-1" dir="ltr">
                            ID: {p.id}
                          </p>
                        </div>

                        <div className="text-left text-xs">
                          <span className="text-slate-500 block">ثبت سفارش:</span>
                          <span className="text-slate-300 font-mono">
                            {p.createdAt ? new Date(p.createdAt).toLocaleDateString('fa-IR') : '—'}
                          </span>
                        </div>
                      </div>

                      {/* Usage & Progress */}
                      {!p.isPayAsYouGo && totalGb > 0 && (
                        <div className="space-y-1.5 bg-slate-950 p-3 rounded-2xl border border-slate-800/80">
                          <div className="flex justify-between text-xs text-slate-400">
                            <span>مصرف حجم: <b>{usedGb} GB</b> از <b>{totalGb} GB</b></span>
                            <span className="font-mono">{percentUsed}٪</span>
                          </div>
                          <div className="w-full h-2 bg-slate-900 rounded-full overflow-hidden">
                            <div
                              className={`h-full transition-all duration-300 ${
                                percentUsed > 90 ? 'bg-rose-500' : percentUsed > 70 ? 'bg-amber-500' : 'bg-emerald-500'
                              }`}
                              style={{ width: `${percentUsed}%` }}
                            />
                          </div>
                        </div>
                      )}

                      {/* Control Actions Bar */}
                      <div className="pt-2 border-t border-slate-800 flex items-center justify-between flex-wrap gap-2">
                        <div className="text-xs">
                          <span className="text-slate-500">قیمت عمده: </span>
                          <span className="font-bold text-slate-100 font-mono">{(p.price || 0).toLocaleString()} تومان</span>
                        </div>

                        <div className="flex items-center gap-1.5 flex-wrap">
                          {/* Renew Button */}
                          <button
                            onClick={() => setRenewingPurchase(p)}
                            className="px-3 py-1.5 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded-xl text-xs font-bold transition flex items-center gap-1"
                            title="تمدید سرویس و ریست حجم/زمان"
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                            <span>تمدید</span>
                          </button>

                          {/* Toggle Enable/Disable Button */}
                          <button
                            disabled={togglingPurchaseId === p.id}
                            onClick={() => handleToggleEnablePurchase(p.id, !!p.disabled)}
                            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1 ${
                              p.disabled
                                ? 'bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 border border-emerald-500/30'
                                : 'bg-rose-500/15 text-rose-400 hover:bg-rose-500/25 border border-rose-500/30'
                            }`}
                            title="قطع یا وصل فوری در سرور"
                          >
                            <Zap className="w-3.5 h-3.5" />
                            <span>{togglingPurchaseId === p.id ? '...' : (p.disabled ? 'اتصال' : 'قطع')}</span>
                          </button>

                          {/* Rename Button */}
                          <button
                            onClick={() => {
                              setRenamingPurchase(p);
                              setNewConfigName(p.name || '');
                            }}
                            className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs transition"
                            title="تغییر نام دلخواه مشتری"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>

                          {/* View Links & QR */}
                          <button
                            onClick={() => {
                              setViewingPurchase(p);
                              const mainSub = p.panel4SubUrl || p.mroceanSubUrl || p.subUrl || p.sanaeiSubUrl || p.rebeccaSubUrl || '';
                              if (mainSub) {
                                import('qrcode').then(QRCode => {
                                  QRCode.toDataURL(mainSub, { width: 350, margin: 2 }).then(setViewingQrCode).catch(() => {});
                                });
                              }
                            }}
                            className="px-3 py-1.5 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 border border-emerald-500/30 rounded-xl text-xs font-bold transition flex items-center gap-1"
                          >
                            <QrCode className="w-3.5 h-3.5" />
                            <span>لینک و QR</span>
                          </button>

                          {/* Cancel / Stop Button */}
                          <button
                            disabled={p.isCancelled}
                            onClick={() => setDeletingPurchase(p)}
                            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1 ${
                              p.isCancelled
                                ? 'bg-slate-800/40 text-slate-500 cursor-not-allowed border border-slate-700/40'
                                : 'bg-rose-500/15 hover:bg-rose-500/25 text-rose-400 border border-rose-500/30'
                            }`}
                            title={p.isCancelled ? 'این سرویس قبلاً ابطال شده است' : 'توقف و ابطال کانفیگ (با محاسبه بازگشت وجه)'}
                          >
                            <Ban className="w-3.5 h-3.5" />
                            <span>{p.isCancelled ? 'ابطال‌شده' : 'توقف و ابطال'}</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* TAB 3: DEBT & CREDIT STATUS */}
        {activeTab === 'debt' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-slate-900 border border-slate-800 p-5 rounded-3xl space-y-2 shadow-lg">
                <span className="text-xs text-slate-400">بدهی فعلی به مدیریت:</span>
                <p className="text-2xl font-black text-rose-400 font-mono">
                  {(sellerData?.debt || 0).toLocaleString()} <span className="text-xs font-normal text-slate-400">تومان</span>
                </p>
                <p className="text-[11px] text-slate-500">مجموع مبالغ ثبت شده بدهی همکاری</p>
              </div>

              <div className="bg-slate-900 border border-slate-800 p-5 rounded-3xl space-y-2 shadow-lg">
                <span className="text-xs text-slate-400">سقف مجاز اعتبار خرید:</span>
                <p className="text-2xl font-black text-emerald-400 font-mono">
                  {sellerData?.isUnlimitedLimit ? 'نامحدود (سقف آزاد)' : `${(sellerData?.debtLimit || 0).toLocaleString()} تومان`}
                </p>
                <p className="text-[11px] text-slate-500">حد مجاز بدهکار شدن حساب همکار</p>
              </div>

              <div className="bg-slate-900 border border-slate-800 p-5 rounded-3xl space-y-2 shadow-lg">
                <span className="text-xs text-slate-400">تخفیف اختصاصی شما:</span>
                <p className="text-2xl font-black text-amber-400 font-mono">
                  {sellerData?.sellerDiscount || 0}٪ <span className="text-xs font-normal text-slate-400">تخفیف همکاری</span>
                </p>
                <p className="text-[11px] text-slate-500">کسر مستقیم از قیمت تمام پکیج‌ها</p>
              </div>
            </div>

            {/* Financial Overview Card */}
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-5 shadow-xl">
              <div className="flex items-center justify-between flex-wrap gap-3 border-b border-slate-800 pb-4">
                <h3 className="font-bold text-slate-100 text-base flex items-center gap-2">
                  <CreditCard className="w-5 h-5 text-emerald-400" />
                  <span>تراز مالی و تسویه بدهی همکار</span>
                </h3>

                <button
                  onClick={() => setShowDebtPaymentModal(true)}
                  className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold text-xs rounded-xl shadow-lg shadow-emerald-500/20 transition flex items-center gap-1.5"
                >
                  <CreditCard className="w-4 h-4" />
                  <span>پرداخت بدهی (کارت به کارت)</span>
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                <div className="bg-slate-950 p-4 rounded-2xl space-y-1">
                  <span className="text-slate-500 block">کل فروش تجمعی:</span>
                  <span className="text-base font-bold text-slate-100 font-mono">{(sellerData?.totalSales || 0).toLocaleString()} تومان</span>
                </div>

                <div className="bg-slate-950 p-4 rounded-2xl space-y-1">
                  <span className="text-slate-500 block">کل واریزی‌ها و تسویه‌ها:</span>
                  <span className="text-base font-bold text-teal-400 font-mono">{(sellerData?.totalPayments || 0).toLocaleString()} تومان</span>
                </div>

                <div className="bg-slate-950 p-4 rounded-2xl space-y-1">
                  <span className="text-slate-500 block">مجموع بدهی حجمی:</span>
                  <span className="text-base font-bold text-indigo-400 font-mono">{(sellerData?.debtVolume || 0).toLocaleString()} GB</span>
                </div>

                <div className="bg-slate-950 p-4 rounded-2xl space-y-1">
                  <span className="text-slate-500 block">تعداد کانفیگ‌های فعال:</span>
                  <span className="text-base font-bold text-emerald-400 font-mono">{(sellerData?.purchases || []).length} عدد</span>
                </div>
              </div>

              <div className="bg-slate-950 p-4 rounded-2xl text-xs text-slate-400 leading-relaxed space-y-2">
                <p className="text-slate-200 font-bold">💳 اطلاعات حساب جهت واریز:</p>
                <div className="flex items-center gap-4 flex-wrap text-slate-300 font-mono">
                  <span>شماره کارت: <b>{bankInfo.cardNumber}</b></span>
                  <span>به نام: <b>{bankInfo.cardHolder}</b></span>
                </div>
                <p className="pt-2 text-slate-400">پس از واریز، با زدن دکمه <b>«پرداخت بدهی»</b> عکس فیش را ارسال فرمایید تا کسر از بدهی ثبت گردد.</p>
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: ACCOUNTING & LEDGER */}
        {activeTab === 'ledger' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between bg-slate-900 p-4 rounded-3xl border border-slate-800 flex-wrap gap-3">
              <div>
                <h3 className="font-bold text-slate-100 text-sm flex items-center gap-2">
                  <Receipt className="w-5 h-5 text-emerald-400" />
                  <span>دفترکل و صورتحساب تراکنش‌های مالی همکار</span>
                </h3>
                <p className="text-[11px] text-slate-400 mt-1">مشاهده ریز تمام اسناد بدهکار و بستانکار همراه با امکان فیلتر بازه شمسی و خروجی PDF</p>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <a
                  href={`/api/seller-portal/download-pdf/${sellerData?.chatId || ''}${shamsiStart || shamsiEnd ? `?shamsiStart=${encodeURIComponent(shamsiStart)}&shamsiEnd=${encodeURIComponent(shamsiEnd)}` : ''}`}
                  target="_blank"
                  rel="noreferrer"
                  className="px-3.5 py-1.5 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-slate-950 font-bold rounded-xl transition flex items-center gap-1.5 shadow-md shadow-emerald-500/20 text-xs shrink-0"
                >
                  <Download className="w-4 h-4 text-slate-950" />
                  <span>دانلود PDF صورتحساب {shamsiStart || shamsiEnd ? 'بازه' : 'کامل'}</span>
                </a>

                <div className="flex items-center gap-1.5 bg-slate-950 p-1.5 rounded-2xl border border-slate-800 text-xs">
                  <button
                    onClick={() => { setReportPeriod('today'); setShamsiStart(''); setShamsiEnd(''); }}
                    className={`px-3 py-1.5 rounded-xl font-bold transition ${
                      reportPeriod === 'today' && !shamsiStart && !shamsiEnd ? 'bg-emerald-500 text-slate-950' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    امروز (۲۴ساعت)
                  </button>
                  <button
                    onClick={() => { setReportPeriod('monthly'); setShamsiStart(''); setShamsiEnd(''); }}
                    className={`px-3 py-1.5 rounded-xl font-bold transition ${
                      reportPeriod === 'monthly' && !shamsiStart && !shamsiEnd ? 'bg-emerald-500 text-slate-950' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    این ماه
                  </button>
                  <button
                    onClick={() => { setReportPeriod('all'); setShamsiStart(''); setShamsiEnd(''); }}
                    className={`px-3 py-1.5 rounded-xl font-bold transition ${
                      reportPeriod === 'all' && !shamsiStart && !shamsiEnd ? 'bg-emerald-500 text-slate-950' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    کل اسناد
                  </button>
                </div>
              </div>
            </div>

            {/* Custom Shamsi Search Bar */}
            <div className="bg-slate-900 border border-slate-800 p-4 rounded-3xl flex items-center justify-between flex-wrap gap-3 text-xs">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-slate-300 font-bold flex items-center gap-1.5">
                  <Search className="w-4 h-4 text-emerald-400" />
                  <span>جستجو و فیلتر بازه تاریخی شمسی:</span>
                </span>
                <input
                  type="text"
                  placeholder="از تاریخ (۱۴۰۵/۰۷/۰۱)"
                  value={shamsiStart}
                  onChange={(e) => setShamsiStart(e.target.value)}
                  className="px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 placeholder-slate-600 focus:outline-none focus:border-emerald-500 w-36 font-mono text-center"
                />
                <span className="text-slate-500">تا</span>
                <input
                  type="text"
                  placeholder="تا تاریخ (۱۴۰۵/۰۷/۱۵)"
                  value={shamsiEnd}
                  onChange={(e) => setShamsiEnd(e.target.value)}
                  className="px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 placeholder-slate-600 focus:outline-none focus:border-emerald-500 w-36 font-mono text-center"
                />
                {(shamsiStart || shamsiEnd) && (
                  <button
                    onClick={() => { setShamsiStart(''); setShamsiEnd(''); }}
                    className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition text-[11px]"
                  >
                    پاک‌سازی فیلتر
                  </button>
                )}
              </div>

              {shamsiStart || shamsiEnd ? (
                <span className="text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-3 py-1 rounded-xl text-[11px] font-medium">
                  فیلتر فعال: از {shamsiStart || 'ابتدا'} تا {shamsiEnd || 'اکنون'}
                </span>
              ) : null}
            </div>

            {/* Ledger Table */}
            <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-xl">
              <div className="overflow-x-auto">
                <table className="w-full text-right text-xs">
                  <thead className="bg-slate-950 border-b border-slate-800 text-slate-400">
                    <tr>
                      <th className="p-3.5 font-bold">تاریخ و زمان</th>
                      <th className="p-3.5 font-bold">شرح تراکنش</th>
                      <th className="p-3.5 font-bold text-rose-400">بدهکار (تومان)</th>
                      <th className="p-3.5 font-bold text-emerald-400">بستانکار (تومان)</th>
                      <th className="p-3.5 font-bold">مانده بدهی</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {currentReport.ledgerRows.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="p-8 text-center text-slate-500">
                          هیچ تراکنشی در این بازه زمانی ثبت نشده است.
                        </td>
                      </tr>
                    ) : (
                      currentReport.ledgerRows.map((row: any) => (
                        <tr key={row.id} className="hover:bg-slate-850/50 transition">
                          <td className="p-3.5 font-mono text-slate-400">{row.dateStr} {row.timeStr}</td>
                          <td className="p-3.5 text-slate-200">{row.description}</td>
                          <td className="p-3.5 font-mono font-bold text-rose-400">
                            {row.debit > 0 ? row.debit.toLocaleString() : '—'}
                          </td>
                          <td className="p-3.5 font-mono font-bold text-emerald-400">
                            {row.credit > 0 ? row.credit.toLocaleString() : '—'}
                          </td>
                          <td className="p-3.5 font-mono font-bold text-slate-100">
                            {row.runningBalance.toLocaleString()} تومان
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 5: SALES REPORTS & ANALYTICS */}
        {activeTab === 'reports' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between bg-slate-900 p-4 rounded-3xl border border-slate-800 flex-wrap gap-3">
              <div>
                <h3 className="font-bold text-slate-100 text-sm flex items-center gap-2">
                  <BarChart3 className="w-5 h-5 text-emerald-400" />
                  <span>گزارش جامع فروش و آمار عملکرد همکار</span>
                </h3>
                <p className="text-[11px] text-slate-400 mt-1">
                  {currentReport.periodLabel ? currentReport.periodLabel : (reportPeriod === 'today' ? '۲۴ ساعت شبانه‌روز شمسی (۰۰:۰۰ تا ۲۳:۵۹)' : reportPeriod === 'monthly' ? '۳۰ روز اخیر' : 'کل دوره')}
                </p>
              </div>

              <div className="flex items-center gap-1.5 bg-slate-950 p-1.5 rounded-2xl border border-slate-800 text-xs">
                <button
                  onClick={() => setReportPeriod('today')}
                  className={`px-3 py-1.5 rounded-xl font-bold transition ${
                    reportPeriod === 'today' ? 'bg-emerald-500 text-slate-950' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  امروز (۲۴ساعت شمسی)
                </button>
                <button
                  onClick={() => setReportPeriod('monthly')}
                  className={`px-3 py-1.5 rounded-xl font-bold transition ${
                    reportPeriod === 'monthly' ? 'bg-emerald-500 text-slate-950' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  این ماه
                </button>
                <button
                  onClick={() => setReportPeriod('all')}
                  className={`px-3 py-1.5 rounded-xl font-bold transition ${
                    reportPeriod === 'all' ? 'bg-emerald-500 text-slate-950' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  کل دوره
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
              <div className="bg-slate-900 border border-slate-800 p-5 rounded-3xl space-y-1">
                <span className="text-slate-400">تعداد خریدهای بازه:</span>
                <p className="text-2xl font-extrabold text-emerald-400 font-mono">
                  {currentReport.summary?.totalCount || 0} <span className="text-xs text-slate-500 font-normal">عدد</span>
                </p>
              </div>

              <div className="bg-slate-900 border border-slate-800 p-5 rounded-3xl space-y-1">
                <span className="text-slate-400">مجموع حجم فروخته شده:</span>
                <p className="text-2xl font-extrabold text-teal-400 font-mono">
                  {(currentReport.summary?.totalVolumeGb || 0).toFixed(1)} <span className="text-xs text-slate-500 font-normal">گیگابایت</span>
                </p>
              </div>

              <div className="bg-slate-900 border border-slate-800 p-5 rounded-3xl space-y-1">
                <span className="text-slate-400">مبلغ کل خریدهای عمده:</span>
                <p className="text-2xl font-extrabold text-amber-400 font-mono">
                  {(currentReport.summary?.totalSalesAmount || 0).toLocaleString()} <span className="text-xs text-slate-500 font-normal">تومان</span>
                </p>
              </div>
            </div>

            {/* Detailed Sales Items List */}
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 space-y-4">
              <h3 className="font-bold text-slate-100 text-sm flex items-center gap-2 border-b border-slate-800 pb-3">
                <BarChart3 className="w-5 h-5 text-emerald-400" />
                <span>ریز گزارش فروش و کانفیگ‌های ساخته شده</span>
              </h3>

              <div className="space-y-2">
                {currentReport.salesItems.length === 0 ? (
                  <p className="text-xs text-slate-500 text-center py-6">هیچ فروشی در این بازه زمانی ثبت نشده است.</p>
                ) : (
                  currentReport.salesItems.map((item: any) => (
                    <div key={item.id} className="bg-slate-950 p-3.5 rounded-2xl border border-slate-800 flex items-center justify-between text-xs flex-wrap gap-2">
                      <div>
                        <p className="font-bold text-slate-200">{item.name}</p>
                        <p className="text-[11px] text-slate-500 font-mono mt-0.5">{item.dateStr} - {item.timeStr}</p>
                      </div>

                      <div className="flex items-center gap-4 text-slate-300">
                        <span>{item.volumeGb} GB / {item.durationDays} روز</span>
                        <span className="font-bold text-emerald-400 font-mono">{item.price.toLocaleString()} تومان</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 6: DEDICATED RESELLER PROVIDER API VIEW */}
        {activeTab === 'api' && (
          <div className="space-y-6">
            {/* Header Banner */}
            <div className="bg-gradient-to-r from-violet-950/80 via-slate-900 to-slate-900 p-6 rounded-3xl border border-violet-500/30 shadow-xl space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-violet-600/20 text-violet-300 rounded-2xl border border-violet-500/30 shadow-inner">
                    <Server className="w-7 h-7 text-violet-400" />
                  </div>
                  <div>
                    <h2 className="font-extrabold text-slate-100 text-base sm:text-lg flex items-center gap-2">
                      <span>وب‌سرویس ارائه‌دهنده (API) اتصال به ربات فروشگاهی</span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">تایید شده و فعال</span>
                    </h2>
                    <p className="text-xs text-slate-400 mt-0.5">
                      اتصال مستقیم ربات تلگرام شما به این پنل جهت استعلام قیمت همکار و ساخت خودکار کانفیگ
                    </p>
                  </div>
                </div>

                <button
                  onClick={async () => {
                    setTestingApi(true);
                    setApiTestError('');
                    setApiTestResponse(null);
                    try {
                      const res = await fetch(`/api/v1/reseller/products?key=${sellerData?.apiKey || ''}`);
                      const data = await res.json();
                      setApiTestResponse(data);
                    } catch (err: any) {
                      setApiTestError(err.message || 'خطا در ارتباط با سرور');
                    } finally {
                      setTestingApi(false);
                    }
                  }}
                  disabled={testingApi}
                  className="px-4 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-bold rounded-xl text-xs transition flex items-center gap-2 shadow-md shadow-emerald-500/20"
                >
                  <RefreshCw className={`w-4 h-4 ${testingApi ? 'animate-spin' : ''}`} />
                  <span>تست زنده خروجی وب‌سرویس</span>
                </button>
              </div>

              {/* Strict Requirement Notice for Shop Bots */}
              <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-2xl text-amber-200 text-xs leading-relaxed space-y-1">
                <div className="flex items-center gap-1.5 font-bold text-amber-300">
                  <Sparkles className="w-4 h-4" />
                  <span>سازگاری ۱۰۰٪ با ربات‌های ارائه‌دهنده تلگرام:</span>
                </div>
                <p className="text-[11px] text-amber-200/90">
                  ⚠️ همان‌طور که در ربات شما ذکر شده: «سایت‌های ارائه‌دهندگان الزاماً باید خروجی محصولات را در یک درخواست با جزئیات (قیمت / توضیحات / نام محصول / نام دسته‌بندی) نمایش دهند تا مورد تایید قرار گیرند».
                  وب‌سرویس زیر دقیقاً این استاندارد را رعایت کرده و قیمت‌های همکاری کسر شده از سقف اعتبار شما را تحویل می‌دهد.
                </p>
              </div>
            </div>

            {/* API Key Card */}
            <div className="bg-slate-900 border border-slate-800 p-5 rounded-3xl space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <h3 className="font-bold text-slate-200 text-sm flex items-center gap-2">
                    <Key className="w-4 h-4 text-amber-400" />
                    <span>کلید اختصاصی وب‌سرویس شما (API Key)</span>
                  </h3>
                  <p className="text-[11px] text-slate-400">این کلید هویت همکاری شما را برای ربات احراز کرده و خریدها از بدهی شما کسر می‌شوند.</p>
                </div>

                <button
                  disabled={regeneratingApiKey}
                  onClick={async () => {
                    if (!confirm('آیا از ساخت مجدد کلید API مطمئن هستید؟ در صورت تایید، کلید قبلی در ربات تلگرام غیرفعال خواهد شد و باید کلید جدید را در ربات ثبت کنید.')) return;
                    setRegeneratingApiKey(true);
                    try {
                      const res = await fetch(`/api/seller-portal/regenerate-api-key/${chatId}`, { method: 'POST' });
                      const data = await res.json();
                      if (data.success && sellerData) {
                        setSellerData({ ...sellerData, apiKey: data.apiKey, apiEnabled: data.apiEnabled });
                        alert('✅ کلید جدید وب‌سرویس با موفقیت تولید شد.');
                      }
                    } finally {
                      setRegeneratingApiKey(false);
                    }
                  }}
                  className="text-xs px-3 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 rounded-xl font-bold transition flex items-center gap-1.5"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${regeneratingApiKey ? 'animate-spin' : ''}`} />
                  <span>تولید کلید جدید</span>
                </button>
              </div>

              <div className="flex items-center gap-2">
                <code className="flex-1 bg-slate-950 border border-slate-800 text-emerald-400 p-3 rounded-2xl font-mono text-xs select-all text-left overflow-x-auto tracking-wide" dir="ltr">
                  {sellerData?.apiKey || 'در حال بارگذاری کلید...'}
                </code>
                <button
                  onClick={() => {
                    if (sellerData?.apiKey) {
                      navigator.clipboard.writeText(sellerData.apiKey);
                      alert('✅ کلید API با موفقیت کپی شد.');
                    }
                  }}
                  className="px-4 py-3 bg-violet-600 hover:bg-violet-500 text-white rounded-2xl text-xs font-bold transition flex items-center gap-1.5 shadow-md shadow-violet-600/30"
                >
                  <Copy className="w-4 h-4" />
                  <span>کپی کلید</span>
                </button>
              </div>
            </div>

            {/* Endpoints Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Endpoint 1: Products */}
              <div className="bg-slate-900 border border-slate-800 p-5 rounded-3xl space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded-lg bg-emerald-500/20 text-emerald-400 font-mono text-[11px] font-bold">GET</span>
                    <h4 className="font-bold text-slate-200 text-xs">۱. دریافت لیست کامل محصولات (برای ربات)</h4>
                  </div>
                  <button
                    onClick={() => {
                      const url = `${window.location.origin}/api/v1/reseller/products?key=${sellerData?.apiKey || ''}`;
                      navigator.clipboard.writeText(url);
                      alert('✅ لینک وب‌سرویس محصولات کپی شد.');
                    }}
                    className="text-xs text-violet-400 hover:text-violet-300 font-bold flex items-center gap-1"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>کپی لینک</span>
                  </button>
                </div>

                <code className="block bg-slate-950 border border-slate-800 p-3 rounded-2xl font-mono text-[11px] text-emerald-400 select-all text-left overflow-x-auto break-all" dir="ltr">
                  {`${typeof window !== 'undefined' ? window.location.origin : ''}/api/v1/reseller/products?key=${sellerData?.apiKey || ''}`}
                </code>

                <p className="text-[11px] text-slate-400 leading-relaxed">
                  📌 <strong>توضیح:</strong> این همان لینکی است که باید در بخش «افزودن ارائه‌دهنده» در ربات تلگرام وارد کنید. شامل تمام محصولات با فیلدهای <span className="font-mono text-slate-200">name, category, price, description</span>.
                </p>

                <div className="pt-2 border-t border-slate-800/80 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-amber-300">💡 مخصوص ربات‌های دومرحله‌ای (مثل کانفیگ‌هاب Config Hub):</span>
                    <button
                      onClick={() => {
                        const url = `${window.location.origin}/api/provider`;
                        navigator.clipboard.writeText(url);
                        alert('✅ لینک پایه کپی شد. در مرحله اول این لینک، و در مرحله بعد کد API را بفرستید.');
                      }}
                      className="text-xs text-amber-400 hover:text-amber-300 font-bold flex items-center gap-1"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      <span>کپی لینک پایه</span>
                    </button>
                  </div>
                  <code className="block bg-slate-950 border border-amber-500/30 p-2.5 rounded-xl font-mono text-[11px] text-amber-300 select-all text-left overflow-x-auto break-all" dir="ltr">
                    {`${typeof window !== 'undefined' ? window.location.origin : ''}/api/provider`}
                  </code>
                  <p className="text-[10px] text-slate-400">
                    مرحله ۱ (لینک): لینک بالا را بفرستید | مرحله ۲ (کد): کلید API خود را بفرستید.
                  </p>
                </div>

                <div className="pt-2 border-t border-slate-800/80">
                  <span className="text-[10px] text-slate-500 block mb-1">فرمت جایگزین برای ربات‌هایی که مستقیماً آرایه [...] می‌خواهند:</span>
                  <div className="flex items-center justify-between bg-slate-950 p-2 rounded-xl border border-slate-800/80">
                    <code className="text-[10px] font-mono text-violet-300 select-all overflow-x-auto" dir="ltr">
                      {`${typeof window !== 'undefined' ? window.location.origin : ''}/api/v1/reseller/products-list?key=${sellerData?.apiKey || ''}`}
                    </code>
                    <button
                      onClick={() => {
                        const url = `${window.location.origin}/api/v1/reseller/products-list?key=${sellerData?.apiKey || ''}`;
                        navigator.clipboard.writeText(url);
                        alert('✅ لینک کپی شد.');
                      }}
                      className="text-[10px] text-slate-400 hover:text-slate-200 px-2 py-0.5 rounded bg-slate-800"
                    >
                      کپی
                    </button>
                  </div>
                </div>
              </div>

              {/* Endpoint 2: Purchase */}
              <div className="bg-slate-900 border border-slate-800 p-5 rounded-3xl space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded-lg bg-blue-500/20 text-blue-400 font-mono text-[11px] font-bold">POST</span>
                    <h4 className="font-bold text-slate-200 text-xs">۲. ثبت سفارش و تحویل آنی کانفیگ</h4>
                  </div>
                  <button
                    onClick={() => {
                      const url = `${window.location.origin}/api/v1/reseller/purchase?key=${sellerData?.apiKey || ''}`;
                      navigator.clipboard.writeText(url);
                      alert('✅ لینک سفارش کپی شد.');
                    }}
                    className="text-xs text-violet-400 hover:text-violet-300 font-bold flex items-center gap-1"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>کپی لینک</span>
                  </button>
                </div>

                <code className="block bg-slate-950 border border-slate-800 p-3 rounded-2xl font-mono text-[11px] text-emerald-400 select-all text-left overflow-x-auto break-all" dir="ltr">
                  {`${typeof window !== 'undefined' ? window.location.origin : ''}/api/v1/reseller/purchase?key=${sellerData?.apiKey || ''}`}
                </code>

                <p className="text-[11px] text-slate-400 leading-relaxed">
                  📌 وقتی مشتری در ربات شما خرید می‌کند، ربات این متد را صدا زده، کانفیگ فوراً در پنل اصلی ساخته شده و لینک سابسکریپشن به همراه QR Code بازگردانده می‌شود.
                </p>

                <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800 text-[10px] font-mono text-slate-300 overflow-x-auto" dir="ltr">
                  <code>{`// نمونه پارامتر ارسالی (JSON Body):\n{\n  "productId": "شناسه_محصول",\n  "customName": "نام_مشتری"\n}`}</code>
                </div>
              </div>

              {/* Endpoint 3: Balance & Debt */}
              <div className="bg-slate-900 border border-slate-800 p-5 rounded-3xl space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded-lg bg-emerald-500/20 text-emerald-400 font-mono text-[11px] font-bold">GET</span>
                    <h4 className="font-bold text-slate-200 text-xs">۳. استعلام بدهی، سقف اعتبار و موجودی همکار</h4>
                  </div>
                  <button
                    onClick={() => {
                      const url = `${window.location.origin}/api/v1/reseller/balance?key=${sellerData?.apiKey || ''}`;
                      navigator.clipboard.writeText(url);
                      alert('✅ لینک استعلام کپی شد.');
                    }}
                    className="text-xs text-violet-400 hover:text-violet-300 font-bold flex items-center gap-1"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>کپی لینک</span>
                  </button>
                </div>

                <code className="block bg-slate-950 border border-slate-800 p-3 rounded-2xl font-mono text-[11px] text-emerald-400 select-all text-left overflow-x-auto break-all" dir="ltr">
                  {`${typeof window !== 'undefined' ? window.location.origin : ''}/api/v1/reseller/balance?key=${sellerData?.apiKey || ''}`}
                </code>

                <p className="text-[11px] text-slate-400 leading-relaxed">
                  ربات تلگرام می‌تواند میزان اعتبار باقی‌مانده و بدهی فعلی حساب شما را با این آدرس بررسی کند.
                </p>
              </div>

              {/* Endpoint 4: Cancel / Delete Config */}
              <div className="bg-slate-900 border border-slate-800 p-5 rounded-3xl space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded-lg bg-rose-500/20 text-rose-400 font-mono text-[11px] font-bold">POST</span>
                    <h4 className="font-bold text-slate-200 text-xs">۴. لغو سرویس و عودت وجه به بدهی همکار</h4>
                  </div>
                  <button
                    onClick={() => {
                      const url = `${window.location.origin}/api/v1/reseller/cancel?key=${sellerData?.apiKey || ''}`;
                      navigator.clipboard.writeText(url);
                      alert('✅ لینک لغو کپی شد.');
                    }}
                    className="text-xs text-violet-400 hover:text-violet-300 font-bold flex items-center gap-1"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>کپی لینک</span>
                  </button>
                </div>

                <code className="block bg-slate-950 border border-slate-800 p-3 rounded-2xl font-mono text-[11px] text-emerald-400 select-all text-left overflow-x-auto break-all" dir="ltr">
                  {`${typeof window !== 'undefined' ? window.location.origin : ''}/api/v1/reseller/cancel?key=${sellerData?.apiKey || ''}`}
                </code>

                <p className="text-[11px] text-slate-400 leading-relaxed">
                  در صورت لغو سرویس از سوی مشتری، کانفیگ از روی سرورهای VPN حذف شده و مبلغ خرید از بدهی شما کسر می‌شود.
                </p>
              </div>
            </div>

            {/* Live API Tester Result Box */}
            {(apiTestResponse || apiTestError) && (
              <div className="bg-slate-900 border border-slate-800 p-5 rounded-3xl space-y-3 animate-fade-in">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-emerald-400" />
                    <h4 className="font-bold text-slate-200 text-xs">نتیجه تست زنده پاسخ وب‌سرویس به ربات</h4>
                  </div>
                  {apiTestResponse && (
                    <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-mono">
                      HTTP 200 OK - {Array.isArray(apiTestResponse.products) ? `${apiTestResponse.products.length} محصول دریافت شد` : 'تایید شد'}
                    </span>
                  )}
                </div>

                {apiTestError ? (
                  <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-2xl text-rose-300 text-xs font-mono">
                    خطا در تست: {apiTestError}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <pre className="bg-slate-950 p-4 rounded-2xl border border-slate-800 font-mono text-[11px] text-emerald-300 overflow-x-auto max-h-72 select-all leading-relaxed" dir="ltr">
                      {JSON.stringify(apiTestResponse, null, 2)}
                    </pre>
                    <p className="text-[11px] text-emerald-400 font-bold">
                      ✅ این دقیقاً همان پاسخی است که ربات تلگرام شما پس از اتصال دریافت خواهد کرد و به عنوان ارائه‌دهنده تایید می‌شود.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Step-by-Step Guide for External Telegram Shop Bots */}
            <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl space-y-4">
              <h3 className="font-bold text-slate-100 text-sm flex items-center gap-2">
                <Info className="w-5 h-5 text-violet-400" />
                <span>راهنمای گام‌به‌گام اتصال به ربات فروشگاهی تلگرام</span>
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-2">
                  <div className="w-6 h-6 rounded-full bg-violet-600/30 text-violet-400 font-bold flex items-center justify-center font-mono">۱</div>
                  <h5 className="font-bold text-slate-200">بخش ارائه‌دهندگان در ربات</h5>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    در ربات تلگرام خود وارد پنل مدیریت شده و گزینه <b>«ارائه‌دهندگان»</b> را انتخاب کنید.
                  </p>
                </div>

                <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-2">
                  <div className="w-6 h-6 rounded-full bg-violet-600/30 text-violet-400 font-bold flex items-center justify-center font-mono">۲</div>
                  <h5 className="font-bold text-slate-200">ثبت لینک و کلید API</h5>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    روی «افزودن ارائه‌دهنده» بزنید و لینک <b>«دریافت محصولات»</b> (بخش ۱ در بالا) را ارسال نمایید.
                  </p>
                </div>

                <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-2">
                  <div className="w-6 h-6 rounded-full bg-violet-600/30 text-violet-400 font-bold flex items-center justify-center font-mono">۳</div>
                  <h5 className="font-bold text-slate-200">همگام‌سازی خودکار</h5>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    ربات فوراً محصولات را با قیمت‌های همکاری می‌خواند و فروش‌ها به صورت خودکار از سقف اعتبار شما کسر می‌شود.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB: WHITE-LABEL RESELLER TELEGRAM BOT (ربات تلگرام اختصاصی همکار) */}
        {activeTab === 'bot' && (
          <div className="space-y-6">
            {/* Top Status & Overview Card */}
            <div className="bg-gradient-to-br from-slate-900 via-blue-950/20 to-slate-900 border border-blue-500/30 p-6 rounded-3xl shadow-xl space-y-4">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-blue-500/30 flex-shrink-0">
                    <Bot className="w-6 h-6" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-base font-bold text-slate-100">
                        {botConfig.botName ? `ربات تلگرام: ${botConfig.botName}` : 'ربات تلگرام اختصاصی شما (White-Label)'}
                      </h2>
                      <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border flex items-center gap-1 ${
                        botStatus.isOnline
                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                          : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${botStatus.isOnline ? 'bg-emerald-400 animate-ping' : 'bg-rose-400'}`}></span>
                        <span>{botStatus.isOnline ? 'روشن و آنلاین' : 'خاموش / متوقف'}</span>
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">
                      با نام تجاری، آرم اختصاصی، شماره کارت بانکی خودتان و قیمت‌های دلخواه به مشتریانتان VPN بفروشید.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 self-stretch sm:self-auto justify-end">
                  {botStatus.botUsername && (
                    <a
                      href={`https://t.me/${botStatus.botUsername}`}
                      target="_blank"
                      rel="noreferrer"
                      className="px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-md shadow-blue-500/20"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>ورود به ربات (@{botStatus.botUsername})</span>
                    </a>
                  )}

                  <button
                    onClick={() => {
                      const nextEnabled = !botConfig.enabled;
                      setBotConfig((prev: any) => ({ ...prev, enabled: nextEnabled }));
                      setTimeout(() => handleSaveBotConfig(), 50);
                    }}
                    disabled={savingBotConfig}
                    className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 ${
                      botConfig.enabled
                        ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30 hover:bg-rose-500/30'
                        : 'bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold shadow-lg shadow-emerald-500/20'
                    }`}
                  >
                    <Power className="w-3.5 h-3.5" />
                    <span>{botConfig.enabled ? 'خاموش کردن ربات' : 'روشن کردن ربات'}</span>
                  </button>
                </div>
              </div>

              {/* Real-time Bot Stats */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t border-slate-800/80">
                <div className="bg-slate-950/80 p-3 rounded-2xl border border-slate-800/80">
                  <span className="text-[11px] text-slate-400 block mb-0.5">👥 خریداران در ربات</span>
                  <span className="text-sm font-bold text-slate-100 font-mono">{botStatus.buyersCount || 0} نفر</span>
                </div>
                <div className="bg-slate-950/80 p-3 rounded-2xl border border-slate-800/80">
                  <span className="text-[11px] text-slate-400 block mb-0.5">📦 کل سفارشات</span>
                  <span className="text-sm font-bold text-blue-400 font-mono">{botStatus.ordersCount || 0} سفارش</span>
                </div>
                <div className="bg-slate-950/80 p-3 rounded-2xl border border-slate-800/80">
                  <span className="text-[11px] text-slate-400 block mb-0.5">💵 کل فروش ناخالص</span>
                  <span className="text-sm font-bold text-slate-100 font-mono">{(botStatus.totalRevenue || 0).toLocaleString()} تومان</span>
                </div>
                <div className="bg-slate-950/80 p-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/5">
                  <span className="text-[11px] text-emerald-400 block mb-0.5">💎 سود خالص شما</span>
                  <span className="text-sm font-bold text-emerald-400 font-mono">+{(botStatus.totalProfit || 0).toLocaleString()} تومان</span>
                </div>
              </div>

              {botSaveSuccessMsg && (
                <div className="bg-emerald-500/10 border border-emerald-500/30 p-3 rounded-2xl text-xs text-emerald-300 flex items-center gap-2">
                  <Check className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                  <span>{botSaveSuccessMsg}</span>
                </div>
              )}
              {botSaveErrorMsg && (
                <div className="bg-rose-500/10 border border-rose-500/30 p-3 rounded-2xl text-xs text-rose-300 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
                  <span>{botSaveErrorMsg}</span>
                </div>
              )}
            </div>

            <form onSubmit={handleSaveBotConfig} className="space-y-6">
              {/* Section 1: Telegram Bot Credentials & Brand */}
              <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl shadow-lg space-y-4">
                <div className="flex items-center gap-2 pb-3 border-b border-slate-800">
                  <Sparkles className="w-5 h-5 text-cyan-400" />
                  <h3 className="font-bold text-slate-100 text-sm">۱. هویت و مشخصات ربات تلگرام اختصاصی شما</h3>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5 md:col-span-2">
                    <label className="text-xs font-bold text-slate-200 flex items-center justify-between">
                      <span>توکن ربات تلگرام (Bot Token دریافتی از @BotFather):</span>
                      <span className="text-[11px] text-cyan-400 font-normal">دریافت شده از ربات رسمی BotFather@ در تلگرام</span>
                    </label>
                    <input
                      type="text"
                      value={botConfig.botToken || ''}
                      onChange={(e) => setBotConfig({ ...botConfig, botToken: e.target.value.trim() })}
                      placeholder="123456789:ABCdefGhIJKlmNoPQRstuvWXyz..."
                      dir="ltr"
                      className="w-full bg-slate-950 border border-slate-800 focus:border-cyan-500 rounded-2xl p-3 text-xs text-cyan-300 font-mono outline-none transition"
                    />
                    <p className="text-[11px] text-slate-400">
                      💡 <b>آموزش سریع:</b> در تلگرام به <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="text-cyan-400 underline">BotFather@</a> پیام دهید، دستور <code>/newbot</code> را بفرستید، نام و آیدی ربات دلخواهتان را مشخص کنید، و توکنی که می‌دهد را اینجا کپی کنید.
                    </p>
                  </div>

                  <div className="space-y-2 md:col-span-2 bg-gradient-to-r from-amber-500/10 via-slate-950 to-slate-950 p-4 rounded-2xl border border-amber-500/30">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <label className="text-xs font-bold text-amber-200 flex items-center gap-1.5">
                        <Key className="w-4 h-4 text-amber-400" />
                        <span>شناسه عددی تلگرام مدیر ربات (Chat ID ادمین همکار):</span>
                      </label>
                      <button
                        type="button"
                        onClick={() => setBotConfig({ ...botConfig, adminChatId: chatId })}
                        className="text-[11px] text-amber-300 hover:text-amber-200 transition flex items-center gap-1 bg-amber-500/20 hover:bg-amber-500/30 px-3 py-1 rounded-xl border border-amber-500/40 font-semibold"
                      >
                        <span>تنظیم خودکار شناسه من ({chatId})</span>
                      </button>
                    </div>
                    <input
                      type="text"
                      value={botConfig.adminChatId || ''}
                      onChange={(e) => setBotConfig({ ...botConfig, adminChatId: e.target.value.trim() })}
                      placeholder={chatId || "مثال: 7314628134"}
                      dir="ltr"
                      className="w-full bg-slate-950 border border-slate-800 focus:border-amber-500 rounded-xl p-3 text-xs text-amber-300 font-mono outline-none transition"
                    />
                    <div className="text-[11px] text-slate-300 leading-relaxed space-y-1">
                      <p>
                        ⚡ <b>کاربرد این شناسه:</b> تمام اعلان‌های سفارش مشتریان، عکس فیش‌های واریزی و دکمه‌های تایید/رد آنی فیش مستقیماً به این حساب تلگرام ارسال می‌شود. همچنین در ربات به منوی مدیریت و دستور <code>/admin</code> دسترسی انحصاری خواهد داشت.
                      </p>
                      <p className="text-slate-400">
                        💡 اگر خالی بگذارید، به طور پیش‌فرض از شناسه اکانت همکار شما (<code>{chatId}</code>) استفاده می‌شود. برای دریافت شناسه عددی هر اکانت دیگر، در تلگرام به <a href="https://t.me/userinfobot" target="_blank" rel="noreferrer" className="text-cyan-400 underline">userinfobot@</a> پیام دهید.
                      </p>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-200">نام تجاری / فروشگاه شما (عنوان بالای ربات):</label>
                    <input
                      type="text"
                      value={botConfig.botName || ''}
                      onChange={(e) => setBotConfig({ ...botConfig, botName: e.target.value })}
                      placeholder="مثال: کانفیگ شاپ حیدر / وی‌پی‌ان پارس"
                      className="w-full bg-slate-950 border border-slate-800 focus:border-cyan-500 rounded-2xl p-3 text-xs text-slate-100 outline-none transition"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-200">آیدی پشتیبانی تلگرام شما:</label>
                    <input
                      type="text"
                      value={botConfig.supportUsername || ''}
                      onChange={(e) => setBotConfig({ ...botConfig, supportUsername: e.target.value })}
                      placeholder="مثال: Support_Admin@"
                      dir="ltr"
                      className="w-full bg-slate-950 border border-slate-800 focus:border-cyan-500 rounded-2xl p-3 text-xs text-slate-100 outline-none transition"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-200">کانال اطلاع‌رسانی یا آموزش تلگرام (اختیاری):</label>
                    <input
                      type="text"
                      value={botConfig.channelUsername || ''}
                      onChange={(e) => setBotConfig({ ...botConfig, channelUsername: e.target.value })}
                      placeholder="مثال: MyVpnChannel@"
                      dir="ltr"
                      className="w-full bg-slate-950 border border-slate-800 focus:border-cyan-500 rounded-2xl p-3 text-xs text-slate-100 outline-none transition"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-200">لینک بنر / عکس خوش‌آمدگویی (اختیاری):</label>
                    <input
                      type="text"
                      value={botConfig.logoUrl || ''}
                      onChange={(e) => setBotConfig({ ...botConfig, logoUrl: e.target.value.trim() })}
                      placeholder="https://example.com/logo.jpg"
                      dir="ltr"
                      className="w-full bg-slate-950 border border-slate-800 focus:border-cyan-500 rounded-2xl p-3 text-xs text-slate-100 outline-none transition"
                    />
                  </div>

                  <div className="space-y-1.5 md:col-span-2">
                    <label className="text-xs font-bold text-slate-200">متن خوش‌آمدگویی استارت ربات (Welcome Message):</label>
                    <textarea
                      rows={3}
                      value={botConfig.welcomeMessage || ''}
                      onChange={(e) => setBotConfig({ ...botConfig, welcomeMessage: e.target.value })}
                      placeholder="سلام! به ربات رسمی فروش کانفیگ‌های اختصاصی و پرسرعت خوش آمدید..."
                      className="w-full bg-slate-950 border border-slate-800 focus:border-cyan-500 rounded-2xl p-3 text-xs text-slate-100 outline-none transition"
                    />
                  </div>
                </div>
              </div>

              {/* Section 2: Bank Account & Payment Reception */}
              <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl shadow-lg space-y-4">
                <div className="flex items-center gap-2 pb-3 border-b border-slate-800">
                  <CreditCard className="w-5 h-5 text-emerald-400" />
                  <h3 className="font-bold text-slate-100 text-sm">۲. شماره کارت و نحوه دریافت پول از مشتریان شما</h3>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-200">شماره کارت بانکی شما (جهت واریز مشتریان):</label>
                    <input
                      type="text"
                      value={botConfig.cardNumber || ''}
                      onChange={(e) => setBotConfig({ ...botConfig, cardNumber: e.target.value.trim() })}
                      placeholder="۶۰۳۷-۹۹۷۹-xxxx-xxxx"
                      dir="ltr"
                      className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 rounded-2xl p-3 text-xs text-emerald-400 font-mono font-bold outline-none transition"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-200">نام و نام خانوادگی صاحب کارت:</label>
                    <input
                      type="text"
                      value={botConfig.cardHolder || ''}
                      onChange={(e) => setBotConfig({ ...botConfig, cardHolder: e.target.value })}
                      placeholder="مثال: حیدر رضایی"
                      className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 rounded-2xl p-3 text-xs text-slate-100 outline-none transition"
                    />
                  </div>
                </div>

                <div className="pt-2 flex items-center justify-between bg-slate-950 p-4 rounded-2xl border border-slate-800">
                  <div>
                    <h5 className="text-xs font-bold text-slate-200">تحویل آنی خودکار بلافاصله پس از آپلود فیش توسط مشتری</h5>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      در صورت فعال‌بودن، کانفیگ فوراً بدون نیاز به تایید دستی برای خریدار صادر می‌شود (توصیه: در صورت تمایل به چک‌کردن فیش‌ها، این گزینه را غیرفعال بگذارید).
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={!!botConfig.autoDeliverAfterPayment}
                    onChange={(e) => setBotConfig({ ...botConfig, autoDeliverAfterPayment: e.target.checked })}
                    className="w-5 h-5 accent-emerald-500 cursor-pointer"
                  />
                </div>
              </div>

              {/* Section 3: Custom Retail Pricing Table */}
              <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl shadow-lg space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-800">
                  <div className="flex items-center gap-2">
                    <Sliders className="w-5 h-5 text-amber-400" />
                    <div>
                      <h3 className="font-bold text-slate-100 text-sm">۳. تعیین قیمت فروش اختصاصی شما برای هر پلن (سود دلخواه)</h3>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        قیمت عمده خرید شما ثابت است؛ قیمت فروش به مشتری را تعیین کنید تا سود خالص شما از هر خرید به صورت زنده محاسبه شود.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-right text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400 text-[11px]">
                        <th className="py-2.5 px-3">نام پلن</th>
                        <th className="py-2.5 px-3">مشخصات</th>
                        <th className="py-2.5 px-3">قیمت عمده خرید شما</th>
                        <th className="py-2.5 px-3">قیمت فروش شما به مشتری (تومان)</th>
                        <th className="py-2.5 px-3 text-left">سود خالص شما</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-vazir">
                      {botProducts.map((p) => {
                        const retailVal = botConfig.customRetailPrices?.[p.id] !== undefined
                          ? botConfig.customRetailPrices[p.id]
                          : p.retailPrice;
                        const profitVal = Math.max(0, retailVal - p.wholesalePrice);

                        return (
                          <tr key={p.id} className="hover:bg-slate-800/40 transition">
                            <td className="py-3 px-3 font-bold text-slate-200">{p.name}</td>
                            <td className="py-3 px-3 text-slate-400 font-mono text-[11px]">
                              {p.volumeGb} GB / {p.durationDays ? `${p.durationDays} روز` : 'نامحدود'}
                            </td>
                            <td className="py-3 px-3 font-mono text-slate-300">
                              {p.wholesalePrice.toLocaleString()} ت
                            </td>
                            <td className="py-3 px-3">
                              <input
                                type="number"
                                value={retailVal || ''}
                                onChange={(e) => {
                                  const val = parseInt(e.target.value) || 0;
                                  setBotConfig((prev: any) => ({
                                    ...prev,
                                    customRetailPrices: {
                                      ...(prev.customRetailPrices || {}),
                                      [p.id]: val
                                    }
                                  }));
                                }}
                                className="w-36 bg-slate-950 border border-slate-700 focus:border-amber-400 rounded-xl px-2.5 py-1.5 text-xs text-amber-300 font-mono font-bold outline-none"
                              />
                            </td>
                            <td className="py-3 px-3 text-left font-mono font-bold text-emerald-400">
                              +{profitVal.toLocaleString()} تومان
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Custom Volume Pricing per GB */}
                <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 mt-4 flex flex-col sm:flex-row items-center justify-between gap-4">
                  <div>
                    <h5 className="text-xs font-bold text-slate-200">⚡ نرخ فروش هر گیگابایت در سفارش حجم دلخواه:</h5>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      قیمت عمده خرید هر گیگابایت شما: <b>{botCustomVolume.wholesalePricePerGb?.toLocaleString()} تومان</b>
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <label className="text-xs text-slate-400">نرخ فروش شما به مشتری:</label>
                    <input
                      type="number"
                      value={botConfig.customVolumeRetailPricePerGb || ''}
                      onChange={(e) => setBotConfig({ ...botConfig, customVolumeRetailPricePerGb: parseInt(e.target.value) || 0 })}
                      className="w-32 bg-slate-900 border border-slate-700 focus:border-emerald-400 rounded-xl px-3 py-1.5 text-xs text-emerald-400 font-mono font-bold outline-none"
                    />
                    <span className="text-xs text-emerald-400 font-mono font-bold">
                      سود: +{Math.max(0, (botConfig.customVolumeRetailPricePerGb || 0) - (botCustomVolume.wholesalePricePerGb || 0)).toLocaleString()} ت/گیگ
                    </span>
                  </div>
                </div>

                {/* Free test toggle for reseller bot */}
                <div className="pt-2 flex items-center justify-between bg-slate-950 p-4 rounded-2xl border border-slate-800">
                  <div>
                    <h5 className="text-xs font-bold text-slate-200">🎁 فعال بودن اکانت تست رایگان برای مشتریان در ربات شما</h5>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      مشتریان جدید ربات شما می‌توانند یک‌بار اکانت تست رایگان ۱ گیگابایتی دریافت کنند.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={botConfig.freeTestEnabled !== false}
                    onChange={(e) => setBotConfig({ ...botConfig, freeTestEnabled: e.target.checked })}
                    className="w-5 h-5 accent-cyan-500 cursor-pointer"
                  />
                </div>
              </div>

              {/* Submit / Save Button */}
              <div className="sticky bottom-4 z-10 bg-slate-950/90 backdrop-blur-md p-4 rounded-2xl border border-slate-800 flex items-center justify-between shadow-2xl">
                <div className="text-xs text-slate-400 hidden sm:block">
                  پس از ذخیره، ربات به صورت خودکار روشن یا بازراه‌اندازی می‌شود.
                </div>
                <button
                  type="submit"
                  disabled={savingBotConfig}
                  className="w-full sm:w-auto px-8 py-3 bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-500 hover:to-cyan-400 text-slate-950 font-bold text-xs rounded-xl shadow-lg shadow-blue-500/20 transition flex items-center justify-center gap-2"
                >
                  {savingBotConfig ? <RefreshCw className="w-4 h-4 animate-spin text-slate-950" /> : <Save className="w-4 h-4 text-slate-950" />}
                  <span>{savingBotConfig ? 'در حال راه‌اندازی و اتصال...' : 'ذخیره تنظیمات و آنلاین‌سازی ربات'}</span>
                </button>
              </div>
            </form>

            {/* Section 4: Live Orders & Receipts from Reseller Bot Customers */}
            <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl shadow-lg space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <Receipt className="w-5 h-5 text-indigo-400" />
                  <h3 className="font-bold text-slate-100 text-sm">
                    ۴. سفارشات و فیش‌های دریافتی از مشتریان ربات شما ({botConfig.orders?.length || 0})
                  </h3>
                </div>
                <button
                  onClick={() => fetchBotConfig()}
                  className="p-1.5 bg-slate-800 text-slate-300 rounded-lg hover:text-white transition flex items-center gap-1 text-xs"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>بروزرسانی لیست</span>
                </button>
              </div>

              {(!botConfig.orders || botConfig.orders.length === 0) ? (
                <div className="text-center py-10 bg-slate-950/60 rounded-2xl border border-slate-800/60 text-slate-500 text-xs">
                  هنوز سفارشی از سوی مشتریان در ربات اختصاصی شما ثبت نشده است. به محض ارسال اولین سفارش یا فیش، در این جدول ظاهر خواهد شد.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-right text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400 text-[11px]">
                        <th className="py-2.5 px-3">شناسه / تاریخ</th>
                        <th className="py-2.5 px-3">مشتری</th>
                        <th className="py-2.5 px-3">محصول / حجم</th>
                        <th className="py-2.5 px-3">واریزی مشتری</th>
                        <th className="py-2.5 px-3">هزینه عمده شما</th>
                        <th className="py-2.5 px-3">سود شما</th>
                        <th className="py-2.5 px-3">وضعیت</th>
                        <th className="py-2.5 px-3 text-left">عملیات</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-vazir">
                      {botConfig.orders.map((ord: any) => (
                        <tr key={ord.id} className="hover:bg-slate-800/40 transition">
                          <td className="py-3 px-3">
                            <span className="font-mono text-[10px] text-slate-400 block">{ord.id}</span>
                            <span className="text-[10px] text-slate-500">{new Date(ord.createdAt).toLocaleDateString('fa-IR')}</span>
                          </td>
                          <td className="py-3 px-3">
                            <span className="font-bold text-slate-200 block">{ord.buyerName || 'مشتری'}</span>
                            <span className="font-mono text-[10px] text-slate-400" dir="ltr">
                              {ord.buyerUsername ? `@${ord.buyerUsername}` : ord.buyerChatId}
                            </span>
                          </td>
                          <td className="py-3 px-3 font-bold text-cyan-400">{ord.productName || 'وی‌پی‌ان اختصاصی'}</td>
                          <td className="py-3 px-3 font-mono font-bold text-slate-100">{ord.retailPrice?.toLocaleString()} تومان</td>
                          <td className="py-3 px-3 font-mono text-slate-400">{ord.wholesalePrice?.toLocaleString()} تومان</td>
                          <td className="py-3 px-3 font-mono font-bold text-emerald-400">+{ord.profit?.toLocaleString()} تومان</td>
                          <td className="py-3 px-3">
                            {ord.status === 'approved' && (
                              <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 text-[10px]">
                                تحویل داده شد ✅
                              </span>
                            )}
                            {ord.status === 'pending' && (
                              <span className="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30 text-[10px] animate-pulse">
                                در انتظار تایید فیش ⏳
                              </span>
                            )}
                            {ord.status === 'rejected' && (
                              <span className="px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/30 text-[10px]">
                                رد شده ❌
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-3 text-left">
                            {ord.status === 'pending' ? (
                              <div className="flex items-center gap-1.5 justify-end">
                                <button
                                  onClick={() => handleBotOrderAction(ord.id, 'approve')}
                                  disabled={orderActionLoading === ord.id}
                                  className="px-2.5 py-1 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold rounded-lg text-[11px] transition shadow"
                                >
                                  {orderActionLoading === ord.id ? 'در حال صدور...' : 'تایید و صدور آنی'}
                                </button>
                                <button
                                  onClick={() => handleBotOrderAction(ord.id, 'reject')}
                                  disabled={orderActionLoading === ord.id}
                                  className="px-2 py-1 bg-rose-500/20 text-rose-300 hover:bg-rose-500/30 rounded-lg text-[11px] transition"
                                >
                                  رد
                                </button>
                              </div>
                            ) : ord.deliveredSubUrl ? (
                              <button
                                onClick={() => {
                                  navigator.clipboard.writeText(ord.deliveredSubUrl);
                                  alert('✅ لینک سابسکریپشن تحویل داده شده کپی شد:\n' + ord.deliveredSubUrl);
                                }}
                                className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-[10px] transition flex items-center gap-1"
                              >
                                <Copy className="w-3 h-3" />
                                <span>کپی لینک تحویلی</span>
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

      </main>

      {/* Settings Modal: Custom Customer Pricing (Only active ready-for-sale products!) */}
      {showSettingsModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 dir-rtl">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800 mb-4">
              <div className="flex items-center gap-2">
                <Sliders className="w-5 h-5 text-emerald-400" />
                <h2 className="font-bold text-slate-100 text-base">تعیین قیمت فروشگاهی محصولات آماده فروش</h2>
              </div>
              <button onClick={() => setShowSettingsModal(false)} className="text-slate-400 hover:text-slate-200 p-1">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="text-xs text-slate-400 mb-4 bg-slate-950 p-3 rounded-2xl border border-slate-800 leading-relaxed">
              💡 <b>راهنما:</b> این لیست صرفاً شامل <b>محصولات فعال و آماده فروش</b> است. قیمتی که در اینجا وارد می‌کنید به مشتری حضوری نمایش داده شده و سود هر فروش را مشخص می‌نماید.
            </div>

            <div className="flex items-center justify-between bg-slate-950 p-3.5 rounded-2xl border border-slate-800 mb-4">
              <span className="text-xs font-medium text-slate-200">نمایش قیمت‌های سفارشی شما به مشتریان</span>
              <input
                type="checkbox"
                checked={showCustomPricesOnly}
                onChange={(e) => setShowCustomPricesOnly(e.target.checked)}
                className="w-4 h-4 accent-emerald-500 cursor-pointer"
              />
            </div>

            <div className="overflow-y-auto space-y-3 flex-1 pr-1">
              {products.length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-6">هیچ محصول فعالی برای قیمت‌گذاری یافت نشد.</p>
              ) : (
                products.map((p) => {
                  const wholesale = p.realWholesalePrice || 0;
                  const currentCustom = customPrices[p.id] !== undefined ? customPrices[p.id] : '';
                  const profit = typeof currentCustom === 'number' && currentCustom > wholesale ? currentCustom - wholesale : 0;

                  return (
                    <div key={p.id} className="bg-slate-950/80 p-3.5 rounded-2xl border border-slate-800 space-y-2">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-xs font-bold text-slate-100">{p.name}</p>
                          <p className="text-[11px] text-slate-400">
                            {p.isPayAsYouGo ? 'مصرف آزاد' : `${p.volumeGb} GB / ${p.durationDays} روز`}
                          </p>
                        </div>
                        <div className="text-left">
                          <span className="text-[10px] text-slate-500 block">خرید عمده شما:</span>
                          <span className="text-xs font-bold text-rose-400 font-mono">{wholesale.toLocaleString()} تومان</span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-3 pt-2 border-t border-slate-800/80">
                        <div className="flex items-center gap-2 flex-1">
                          <span className="text-xs text-slate-300 whitespace-nowrap">قیمت مشتری:</span>
                          <input
                            type="number"
                            value={currentCustom}
                            onChange={(e) => {
                              const val = e.target.value === '' ? undefined : Number(e.target.value);
                              setCustomPrices(prev => {
                                const next = { ...prev };
                                if (val === undefined) delete next[p.id];
                                else next[p.id] = val;
                                return next;
                              });
                            }}
                            placeholder="تومان"
                            className="w-full px-3 py-1.5 bg-slate-900 border border-slate-700/80 rounded-xl text-slate-100 text-xs font-mono focus:outline-none focus:border-emerald-500"
                          />
                        </div>
                        {profit > 0 && (
                          <div className="bg-emerald-500/10 border border-emerald-500/30 px-2.5 py-1 rounded-xl whitespace-nowrap text-left">
                            <span className="text-[10px] text-emerald-400 block font-medium">سود شما:</span>
                            <span className="text-xs font-bold text-emerald-400 font-mono">+{profit.toLocaleString()} ت</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="pt-4 border-t border-slate-800 mt-4 flex justify-end gap-2">
              <button
                onClick={() => setShowSettingsModal(false)}
                className="px-4 py-2 bg-slate-800 text-slate-300 text-xs rounded-xl"
              >
                انصراف
              </button>
              <button
                onClick={handleSavePrices}
                disabled={savingSettings}
                className="px-5 py-2 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold text-xs rounded-xl transition"
              >
                {savingSettings ? 'در حال ذخیره...' : 'ذخیره لیست قیمت‌ها'}
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
                <span className="text-slate-400">قیمت فروش به مشتری:</span>
                <span className="font-bold text-slate-100">
                  {selectedProduct.customDisplayPrice ? `${selectedProduct.customDisplayPrice.toLocaleString()} تومان` : 'توافقی / تماس'}
                </span>
              </div>
              <div className="pt-2 border-t border-slate-800/80 text-[11px]">
                <button
                  type="button"
                  onClick={() => setShowWholesalePrice(!showWholesalePrice)}
                  className="text-slate-500 hover:text-slate-300 transition flex items-center gap-1"
                >
                  <span>{showWholesalePrice ? '🙈 مخفی‌سازی قیمت عمده همکار' : '👁‍🗨 مشاهده قیمت بدهی عمده'}</span>
                </button>
                {showWholesalePrice && (
                  <div className="mt-1.5 p-2 bg-slate-900 rounded-xl border border-slate-800 flex justify-between text-xs text-emerald-400 font-bold">
                    <span>ثبت بدهی عمده شما:</span>
                    <span>{selectedProduct.realWholesalePrice.toLocaleString()} تومان</span>
                  </div>
                )}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">عنوان مشتری یا نام دلخواه کانفیگ (اختیاری)</label>
              <input
                type="text"
                value={customClientName}
                onChange={(e) => setCustomClientName(e.target.value)}
                placeholder="مثال: علی - آیفون ۱۶"
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
                    <span>تأیید و ساخت فوری کانفیگ</span>
                    <Check className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Free Test Modal */}
      {showFreeTestModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 dir-rtl">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Gift className="w-5 h-5 text-amber-400" />
                <h2 className="font-bold text-slate-100 text-base">ساخت اکانت تست رایگان برای مشتری</h2>
              </div>
              <button onClick={() => setShowFreeTestModal(false)} className="text-slate-400 hover:text-slate-200">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">حجم تست:</span>
                <span className="font-bold text-slate-100">{freeTestInfo.volumeGb} گیگابایت</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">مدت اعتبار:</span>
                <span className="font-bold text-slate-100">{freeTestInfo.durationDays} روز</span>
              </div>
              <div className="flex justify-between pt-2 border-t border-slate-800/80 text-emerald-400 font-bold">
                <span>هزینه همکار:</span>
                <span>۰ تومان (کاملاً رایگان)</span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">عنوان تست برای مشتری (اختیاری)</label>
              <input
                type="text"
                value={freeTestClientName}
                onChange={(e) => setFreeTestClientName(e.target.value)}
                placeholder="مثال: رضا - تست"
                className="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 rounded-2xl text-slate-100 placeholder-slate-500 text-xs focus:outline-none focus:border-amber-500"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setShowFreeTestModal(false)}
                className="px-4 py-2.5 bg-slate-800 text-slate-300 text-xs font-medium rounded-xl"
              >
                انصراف
              </button>
              <button
                onClick={handleCreateFreeTest}
                disabled={creatingFreeTest}
                className="px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs rounded-xl shadow-lg transition flex items-center gap-1.5"
              >
                {creatingFreeTest ? <span>در حال ساخت تست...</span> : <span>ساخت و دریافت آنی تست</span>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Renew Purchase Modal */}
      {renewingPurchase && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 dir-rtl">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <RefreshCw className="w-5 h-5 text-blue-400" />
                <h2 className="font-bold text-slate-100 text-base">تمدید سرویس مشتری</h2>
              </div>
              <button onClick={() => setRenewingPurchase(null)} className="text-slate-400 hover:text-slate-200">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">نام سرویس:</span>
                <span className="font-bold text-slate-100">{renewingPurchase.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">مشخصات تمدید:</span>
                <span className="text-slate-200">{renewingPurchase.volumeGb} GB / {renewingPurchase.durationDays} روز</span>
              </div>
              <div className="flex justify-between pt-2 border-t border-slate-800 text-rose-400 font-bold">
                <span>ثبت در بدهی همکار:</span>
                <span>{(renewingPurchase.price || 0).toLocaleString()} تومان</span>
              </div>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
              با تمدید، حجم و تاریخ انقضای کانفیگ در سرور مجدداً از نو تنظیم شده و در صورت قطع بودن به حالت متصل بازمی‌گردد.
            </p>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setRenewingPurchase(null)}
                className="px-4 py-2.5 bg-slate-800 text-slate-300 text-xs font-medium rounded-xl"
              >
                انصراف
              </button>
              <button
                onClick={handleRenewPurchase}
                disabled={isRenewing}
                className="px-5 py-2.5 bg-blue-500 hover:bg-blue-600 text-white font-bold text-xs rounded-xl shadow-lg transition flex items-center gap-1.5"
              >
                {isRenewing ? <span>در حال تمدید...</span> : <span>تأیید و تمدید در سرور</span>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rename Purchase Modal */}
      {renamingPurchase && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 dir-rtl">
          <div className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-4">
            <h3 className="font-bold text-slate-100 text-sm">تغییر عنوان کانفیگ</h3>
            <input
              type="text"
              value={newConfigName}
              onChange={(e) => setNewConfigName(e.target.value)}
              placeholder="عنوان جدید مشتری..."
              className="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 rounded-2xl text-slate-100 text-xs focus:outline-none focus:border-emerald-500"
            />
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setRenamingPurchase(null)}
                className="px-4 py-2 bg-slate-800 text-slate-300 text-xs rounded-xl"
              >
                انصراف
              </button>
              <button
                onClick={handleRenamePurchase}
                disabled={isRenaming}
                className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold text-xs rounded-xl"
              >
                {isRenaming ? 'در حال ثبت...' : 'ذخیره'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cancellation / Delete Confirmation Modal */}
      {deletingPurchase && (
        <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4 dir-rtl">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-2 text-rose-400">
              <Ban className="w-5 h-5 flex-shrink-0" />
              <h3 className="font-bold text-sm">توقف و ابطال کانفیگ همکار</h3>
            </div>
            
            <p className="text-xs text-slate-300 leading-relaxed">
              آیا از توقف و ابطال کانفیگ «<span className="text-white font-bold">{deletingPurchase.name || deletingPurchase.id}</span>» اطمینان دارید؟ با ابطال، این کانفیگ از سرور حذف شده و محاسبات مالی طبق قوانین همکاری انجام می‌شود:
            </p>

            {loadingCancelPreview ? (
              <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-4 flex items-center justify-center gap-2 text-xs text-slate-400">
                <RefreshCw className="w-4 h-4 animate-spin text-indigo-400" />
                <span>در حال استعلام مصرف دقیق لحظه‌ای از سرور...</span>
              </div>
            ) : cancelPreview ? (
              <div className="space-y-2.5">
                <div className="bg-slate-950/70 border border-slate-800 rounded-2xl p-3.5 space-y-2 text-xs">
                  <div className="flex justify-between items-center text-slate-400">
                    <span>میزان مصرف ثبت‌شده:</span>
                    <span className="font-mono font-bold text-white">
                      {cancelPreview.isUnderOneGb 
                        ? `${(cancelPreview.usedBytes / (1024 * 1024)).toFixed(1)} مگابایت (زیر ۱ گیگ)`
                        : `${cancelPreview.usedGb} گیگابایت`}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-slate-400">
                    <span>مبلغ اولیه پکیج:</span>
                    <span className="font-mono text-slate-200">{(cancelPreview.originalPrice || 0).toLocaleString()} تومان</span>
                  </div>
                  <div className="flex justify-between items-center text-slate-400">
                    <span>هزینه اعمال‌شده در صورتحساب:</span>
                    <span className={`font-mono font-bold ${cancelPreview.isUnderOneGb ? 'text-emerald-400' : 'text-amber-400'}`}>
                      {cancelPreview.billedCost === 0 ? '۰ تومان (بدون هزینه)' : `${cancelPreview.billedCost.toLocaleString()} تومان`}
                    </span>
                  </div>
                  {cancelPreview.refundAmount > 0 && (
                    <div className="flex justify-between items-center text-emerald-400 pt-1 border-t border-slate-800">
                      <span>مبلغ کسرشده از بدهی (عودت):</span>
                      <span className="font-mono font-bold">+{cancelPreview.refundAmount.toLocaleString()} تومان</span>
                    </div>
                  )}
                </div>

                {cancelPreview.isUnderOneGb ? (
                  <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-3 text-[11px] text-emerald-300 leading-relaxed flex items-start gap-2">
                    <Check className="w-4 h-4 flex-shrink-0 mt-0.5 text-emerald-400" />
                    <span>
                      <b>مصرف کمتر از ۱ گیگابایت:</b> با توجه به اینکه مصرف این کانفیگ زیر یک گیگ بوده است، <b>هیچ هزینه‌ای</b> در صورتحساب شما اعمال نمی‌شود و کل مبلغ به حساب شما عودت داده خواهد شد.
                    </span>
                  </div>
                ) : (
                  <div className="bg-indigo-500/10 border border-indigo-500/30 rounded-2xl p-3 text-[11px] text-indigo-300 leading-relaxed flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-indigo-400" />
                    <span>
                      <b>مصرف بالای ۱ گیگابایت:</b> هزینه منحصراً بر اساس مصرف واقعی ({cancelPreview.usedGb} گیگابایت) روی صورتحساب اعمال شده و مابقی مبلغ پکیج از بدهی کسر می‌گردد.
                    </span>
                  </div>
                )}
              </div>
            ) : null}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                onClick={() => setDeletingPurchase(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded-xl transition"
              >
                انصراف
              </button>
              <button
                onClick={handleDeletePurchase}
                disabled={isDeleting || loadingCancelPreview}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs rounded-xl transition flex items-center gap-1.5"
              >
                {isDeleting && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                <span>{isDeleting ? 'در حال ابطال...' : 'تأیید توقف و ابطال'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Purchase Result Modal */}
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
                {purchaseResult.cleanMessage ? purchaseResult.cleanMessage.replace(/<[^>]+>/g, '') : ''}
              </pre>
            </div>

            <div className="space-y-2">
              <button
                onClick={() => handleCopyCleanText()}
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

      {/* Viewing Config Detail Modal */}
      {viewingPurchase && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 dir-rtl">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-5 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <QrCode className="w-5 h-5 text-emerald-400" />
                <h2 className="font-bold text-slate-100 text-base">{viewingPurchase.name || 'جزئیات کانفیگ'}</h2>
              </div>
              <button onClick={() => { setViewingPurchase(null); setViewingQrCode(''); }} className="text-slate-400 hover:text-slate-200">
                <X className="w-5 h-5" />
              </button>
            </div>

            {viewingQrCode && (
              <div className="bg-white p-4 rounded-2xl flex flex-col items-center justify-center w-48 h-48 mx-auto shadow-inner">
                <img src={viewingQrCode} alt="QR Code" className="w-full h-full object-contain" />
              </div>
            )}

            <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 text-xs text-slate-300 space-y-2">
              <p className="font-bold text-slate-100 border-b border-slate-800/80 pb-2">🔗 لینک اتصال سابسکریپشن:</p>
              <pre className="whitespace-pre-wrap font-mono text-[11px] text-emerald-400 bg-slate-900/80 p-3 rounded-xl border border-slate-800 overflow-x-auto" dir="ltr">
                {viewingPurchase.panel4SubUrl || viewingPurchase.mroceanSubUrl || viewingPurchase.subUrl || viewingPurchase.sanaeiSubUrl || viewingPurchase.rebeccaSubUrl || 'لینک ساب موجود نیست'}
              </pre>
            </div>

            {/* Clean Message for Client */}
            <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 text-xs text-slate-300 space-y-2">
              <p className="font-bold text-slate-100 border-b border-slate-800/80 pb-2 flex items-center justify-between">
                <span>💬 پیام بدون برند مخصوص ارسال به مشتری:</span>
                <button
                  onClick={() => {
                    const text = getCleanCustomerMessage(viewingPurchase);
                    navigator.clipboard.writeText(text);
                    setCopiedCleanMsg(true);
                    setTimeout(() => setCopiedCleanMsg(false), 2500);
                  }}
                  className="text-emerald-400 hover:text-emerald-300 text-[11px] flex items-center gap-1 font-bold"
                >
                  {copiedCleanMsg ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedCleanMsg ? 'کپی شد!' : 'کپی پیام'}</span>
                </button>
              </p>
              <pre className="whitespace-pre-wrap font-vazir text-[11px] text-slate-400 bg-slate-900/60 p-3 rounded-xl border border-slate-800/80 overflow-x-auto">
                {getCleanCustomerMessage(viewingPurchase)}
              </pre>
            </div>

            <div className="space-y-2">
              <button
                onClick={() => {
                  const mainSub = viewingPurchase.panel4SubUrl || viewingPurchase.mroceanSubUrl || viewingPurchase.subUrl || viewingPurchase.sanaeiSubUrl || viewingPurchase.rebeccaSubUrl || '';
                  navigator.clipboard.writeText(mainSub);
                  setCopiedText(true);
                  setTimeout(() => setCopiedText(false), 2500);
                }}
                className="w-full py-3 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold text-xs rounded-2xl shadow-lg transition flex items-center justify-center gap-2"
              >
                {copiedText ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                <span>کپی لینک مستقیم ساب</span>
              </button>

              <button
                onClick={() => { setViewingPurchase(null); setViewingQrCode(''); }}
                className="w-full py-2.5 bg-slate-800 text-slate-300 text-xs font-medium rounded-2xl hover:bg-slate-700"
              >
                بستن
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Debt Payment Modal */}
      {showDebtPaymentModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 dir-rtl">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <CreditCard className="w-5 h-5 text-emerald-400" />
                <h2 className="font-bold text-slate-100 text-base">پرداخت بدهی همکاری</h2>
              </div>
              <button onClick={() => setShowDebtPaymentModal(false)} className="text-slate-400 hover:text-slate-200">
                <X className="w-5 h-5" />
              </button>
            </div>

            {debtPaymentSuccessMsg ? (
              <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl text-emerald-400 text-xs leading-relaxed text-center space-y-2">
                <Check className="w-8 h-8 mx-auto" />
                <p className="font-bold">{debtPaymentSuccessMsg}</p>
              </div>
            ) : (
              <form onSubmit={handleDebtPaymentSubmit} className="space-y-4">
                <div className="bg-slate-950 p-3.5 rounded-2xl border border-slate-800 text-xs space-y-1.5">
                  <div className="flex justify-between">
                    <span className="text-slate-500">شماره کارت مدیریت:</span>
                    <span className="font-bold text-slate-200 font-mono" dir="ltr">{bankInfo.cardNumber}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">نام صاحب کارت:</span>
                    <span className="font-bold text-slate-200">{bankInfo.cardHolder}</span>
                  </div>
                  <div className="flex justify-between pt-1 border-t border-slate-800 text-rose-400 font-bold">
                    <span>بدهی فعلی شما:</span>
                    <span>{(sellerData?.debt || 0).toLocaleString()} تومان</span>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">مبلغ واریزی به تومان</label>
                  <input
                    type="text"
                    value={debtPaymentAmount}
                    onChange={(e) => setDebtPaymentAmount(e.target.value)}
                    placeholder="مثال: ۵۰۰۰۰۰"
                    className="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 rounded-2xl text-slate-100 text-xs font-mono focus:outline-none focus:border-emerald-500"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">تصویر فیش واریزی (اختیاری)</label>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        const reader = new FileReader();
                        reader.onloadend = () => setDebtReceiptBase64(reader.result as string);
                        reader.readAsDataURL(file);
                      }
                    }}
                    className="w-full text-xs text-slate-400 file:mr-0 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-slate-800 file:text-slate-200 hover:file:bg-slate-700"
                  />
                </div>

                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowDebtPaymentModal(false)}
                    className="px-4 py-2.5 bg-slate-800 text-slate-300 text-xs font-medium rounded-xl"
                  >
                    انصراف
                  </button>
                  <button
                    type="submit"
                    disabled={submittingDebtPayment}
                    className="px-5 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold text-xs rounded-xl shadow-lg transition"
                  >
                    {submittingDebtPayment ? 'در حال ارسال...' : 'ارسال فیش و تایید'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
      {/* Reseller External Provider API Modal */}
      {showApiModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4 dir-rtl">
          <div className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Server className="w-5 h-5 text-violet-400" />
                <div>
                  <h2 className="font-bold text-slate-100 text-base">وب‌سرویس ارائه‌دهنده (اتصال به ربات دیگر)</h2>
                  <p className="text-[11px] text-slate-400">با این وب‌سرویس می‌توانید ربات فروشگاهی خود را به این بات متصل کنید</p>
                </div>
              </div>
              <button onClick={() => setShowApiModal(false)} className="text-slate-400 hover:text-slate-200">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3.5 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl text-emerald-300 text-xs leading-relaxed">
              ✅ <strong>سازگار با بخش «ارائه‌دهندگان» ربات‌های فروشگاهی:</strong> خروجی محصولات در یک درخواست واحد به همراه تمامی جزئیات الزامی (<strong>قیمت همکاری شما</strong>، <strong>توضیحات کامل</strong>، <strong>نام محصول</strong> و <strong>نام دسته‌بندی</strong>) ارسال می‌شود و هر خرید به صورت خودکار روی حساب بدهی همکاری شما منظور می‌گردد.
            </div>

            <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-300">🔑 کلید اختصاصی وب‌سرویس شما (API Key):</span>
                <button
                  disabled={regeneratingApiKey}
                  onClick={async () => {
                    if (!confirm('آیا از تغییر کلید API مطمئن هستید؟ کلید قبلی غیرفعال خواهد شد.')) return;
                    setRegeneratingApiKey(true);
                    try {
                      const res = await fetch(`/api/seller-portal/regenerate-api-key/${chatId}`, { method: 'POST' });
                      const data = await res.json();
                      if (data.success && sellerData) {
                        setSellerData({ ...sellerData, apiKey: data.apiKey, apiEnabled: data.apiEnabled });
                        alert('کلید جدید با موفقیت ساخته شد.');
                      }
                    } finally {
                      setRegeneratingApiKey(false);
                    }
                  }}
                  className="text-[11px] px-2.5 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 rounded-lg font-bold transition flex items-center gap-1"
                >
                  <RefreshCw className={`w-3 h-3 ${regeneratingApiKey ? 'animate-spin' : ''}`} />
                  <span>ساخت کلید جدید</span>
                </button>
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-slate-900 border border-slate-800 text-emerald-400 p-2.5 rounded-xl font-mono text-xs select-all text-left overflow-x-auto" dir="ltr">
                  {sellerData?.apiKey || ''}
                </code>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(sellerData?.apiKey || '');
                    alert('کلید API کپی شد!');
                  }}
                  className="px-3.5 py-2.5 bg-violet-600 hover:bg-violet-500 text-white rounded-xl text-xs font-bold transition flex items-center gap-1"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>کپی</span>
                </button>
              </div>
            </div>

            <div className="space-y-3 text-xs">
              <div className="bg-slate-950 p-3.5 rounded-2xl border border-slate-800 space-y-2">
                <div className="flex items-center justify-between font-bold text-slate-200">
                  <span>۱. لینک ثبت در بخش «ارائه‌دهندگان» (دریافت یکجای محصولات با جزئیات):</span>
                  <button
                    onClick={() => {
                      const url = `${window.location.origin}/api/v1/reseller/products?key=${sellerData?.apiKey || ''}`;
                      navigator.clipboard.writeText(url);
                      alert('لینک محصولات کپی شد!');
                    }}
                    className="text-violet-400 hover:text-violet-300 flex items-center gap-1"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>کپی لینک</span>
                  </button>
                </div>
                <code className="block bg-slate-900 border border-slate-800 p-2.5 rounded-xl font-mono text-[11px] text-emerald-400 select-all text-left overflow-x-auto" dir="ltr">
                  {`${window.location.origin}/api/v1/reseller/products?key=${sellerData?.apiKey || ''}`}
                </code>
                <p className="text-[11px] text-slate-400">
                  💡 اگر ربات مقصد خروجی آرایه مستقیم <code>[...]</code> نیاز دارد از این آدرس استفاده کنید:{' '}
                  <code className="font-mono text-violet-300 select-all" dir="ltr">
                    {`${window.location.origin}/api/v1/reseller/products-list?key=${sellerData?.apiKey || ''}`}
                  </code>
                </p>
              </div>

              <div className="bg-slate-950 p-3.5 rounded-2xl border border-slate-800 space-y-2">
                <div className="flex items-center justify-between font-bold text-slate-200">
                  <span>۲. لینک خرید خودکار کانفیگ و ثبت در حساب همکاری (POST / GET):</span>
                  <button
                    onClick={() => {
                      const url = `${window.location.origin}/api/v1/reseller/purchase?key=${sellerData?.apiKey || ''}`;
                      navigator.clipboard.writeText(url);
                      alert('لینک خرید کپی شد!');
                    }}
                    className="text-violet-400 hover:text-violet-300 flex items-center gap-1"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>کپی لینک خرید</span>
                  </button>
                </div>
                <code className="block bg-slate-900 border border-slate-800 p-2.5 rounded-xl font-mono text-[11px] text-emerald-400 select-all text-left overflow-x-auto" dir="ltr">
                  {`${window.location.origin}/api/v1/reseller/purchase?key=${sellerData?.apiKey || ''}`}
                </code>
                <pre className="bg-slate-900 border border-slate-800 p-2.5 rounded-xl font-mono text-[11px] text-slate-300 text-left overflow-x-auto" dir="ltr">
{`// خرید بسته با شناسه محصول:
{ "productId": "PRODUCT_ID", "customName": "client_name" }

// یا خرید حجم دلخواه:
{ "volumeGb": 30, "durationDays": 30, "customName": "client_name" }`}
                </pre>
              </div>
            </div>

            <button
              onClick={() => setShowApiModal(false)}
              className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-2xl transition"
            >
              بستن
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
