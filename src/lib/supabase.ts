import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('请在 .env 文件中配置 VITE_SUPABASE_URL 和 VITE_SUPABASE_ANON_KEY');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    storageKey: 'bookkeep_auth',
  },
});

// 数据库类型定义
export interface User {
  id: string;
  name: string;
  role: 'admin' | 'recorder';
  invite_code: string;
  avatar_url?: string;
  created_at: string;
}

export interface Account {
  id: string;
  user_id: string;
  account_type: 'domestic_card' | 'international_card' | 'cash' | 'alipay' | 'wechat' | 'crypto';
  name: string;
  currency: string;
  initial_balance: number;
  created_at: string;
}

export interface Transaction {
  id: string;
  user_id: string;
  type: 'expense' | 'income' | 'exchange' | 'transfer';
  direction?: 'domestic' | 'international' | 'outbound' | 'inbound' | 'domestic_domestic' | 'international_international' | 'domestic_international' | 'international_domestic';
  currency?: string;
  amount?: number;
  from_currency?: string;
  to_currency?: string;
  from_amount?: number;
  to_amount?: number;
  exchange_rate?: number;
  from_account_id?: string;
  to_account_id?: string;
  image_url?: string;
  notes?: string;
  transaction_date: string;
  created_at: string;
  updated_at?: string;
  updated_by?: string;
  is_deleted: boolean;
  // 业务管理模块扩展字段
  customer_id?: string;
  business_type?: 'exchange' | 'purchase' | 'other';
  rate_direction?: 'divide' | 'multiply';
  theoretical_cost?: number;
  purchase_id?: string;
}

export interface Reconciliation {
  id: string;
  user_id: string;
  account_id: string;
  reconcile_date: string;
  system_balance: number;
  actual_balance: number;
  difference: number;
  notes?: string;
  submitted_by: string;
  status: 'pending' | 'matched' | 'mismatch' | 'resolved';
  created_at: string;
}

export interface InviteCode {
  id: string;
  code: string;
  created_by: string;
  used_by?: string;
  is_used: boolean;
  created_at: string;
}

// 账户余额视图
export interface AccountBalance {
  account_id: string;
  user_id: string;
  account_type: string;
  name: string;
  currency: string;
  initial_balance: number;
  current_balance: number;
}

// 账户类型配置
export const ACCOUNT_TYPES = [
  { value: 'domestic_card', label: '国内银行卡', icon: '🏦' },
  { value: 'international_card', label: '国外银行卡', icon: '🏦' },
  { value: 'cash', label: '现金', icon: '💵' },
  { value: 'alipay', label: '支付宝', icon: '📱' },
  { value: 'wechat', label: '微信支付', icon: '💬' },
  { value: 'crypto', label: '加密货币', icon: '₿' },
] as const;

// 常见币种
export const CURRENCIES = ['RMB', 'USD', 'EUR', 'RUB', 'USDT', 'GBP', 'JPY', 'KRW', 'AUD', 'CAD'];

// 转款方向
export const TRANSFER_DIRECTIONS = [
  { value: 'domestic_domestic', label: '国内转国内' },
  { value: 'international_international', label: '国外转国外' },
  { value: 'domestic_international', label: '国内转国外' },
  { value: 'international_domestic', label: '国外转国内' },
] as const;

// ========== 业务员管理模块新增类型 ==========

export interface Salesperson {
  id: string;
  name: string;
  phone?: string;
  notes?: string;
  created_at: string;
}

export interface Customer {
  id: string;
  code: string;
  name?: string;
  salesperson_id: string;
  notes?: string;
  created_at: string;
}

export interface Purchase {
  id: string;
  customer_id: string;
  salesperson_id: string;
  user_id: string;
  currency: string;
  quoted_price?: number;
  actual_cost?: number;
  status: 'in_progress' | 'completed';
  notes?: string;
  created_at: string;
  updated_at?: string;
}

export interface PurchaseSummary extends Purchase {
  customer_code: string;
  salesperson_name: string;
  total_received: number;
  shortfall: number;
  profit: number;
}

export interface AssetOverride {
  id: string;
  salesperson_id: string;
  currency: string;
  estimated_rate?: number;
  initial_foreign?: number;
  initial_cost?: number;
  notes?: string;
  updated_at: string;
}

// 业务类型常量
export const BUSINESS_TYPES = [
  { value: 'exchange', label: '换汇' },
  { value: 'purchase', label: '采购' },
  { value: 'other', label: '其他' },
] as const;

// 收付方向常量
export const LEDGER_DIRECTIONS = [
  { value: 'receive', label: '收' },
  { value: 'pay', label: '付' },
] as const;

// 汇率方向常量
export const RATE_DIRECTIONS = [
  { value: 'divide', label: '÷ (外币÷汇率=RMB)', desc: '如RUB：1元=12.5卢布' },
  { value: 'multiply', label: '× (外币×汇率=RMB)', desc: '如USDT：1U=6.65元' },
] as const;

// 币种别名
export interface CurrencyAlias {
  id: string;
  alias: string;
  currency: string;
  created_at: string;
}

// 采购状态常量
export const PURCHASE_STATUSES = [
  { value: 'in_progress', label: '进行中' },
  { value: 'completed', label: '已完成' },
] as const;
