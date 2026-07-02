import dayjs from 'dayjs';

export interface ParseResult {
  transaction_date: string;
  type: 'expense' | 'income';
  currency: string;
  amount: number;
  accountName: string | null;
  accountId: string | null;
  customerCode: string | null;
  customerId: string | null;
  notes: string;
  warnings: string[];
}

// 内置币种映射
const BUILTIN_CURRENCY_MAP: Record<string, string> = {
  '卢布': 'RUB', '卢': 'RUB', 'rub': 'RUB', 'RUB': 'RUB',
  '美金': 'USD', '美元': 'USD', '美刀': 'USD', '$': 'USD', 'usd': 'USD', 'USD': 'USD',
  '欧元': 'EUR', '欧': 'EUR', 'eur': 'EUR', 'EUR': 'EUR',
  '泰达币': 'USDT', 'usdt': 'USDT', 'USDT': 'USDT', 'u': 'USDT',
  '人民币': 'RMB', '元': 'RMB', 'rmb': 'RMB', 'RMB': 'RMB',
  '英镑': 'GBP', 'gbp': 'GBP', 'GBP': 'GBP',
  '日元': 'JPY', '日币': 'JPY', 'jpy': 'JPY', 'JPY': 'JPY',
  '韩元': 'KRW', 'krw': 'KRW', 'KRW': 'KRW',
  '澳元': 'AUD', 'aud': 'AUD', 'AUD': 'AUD',
  '加元': 'CAD', 'cad': 'CAD', 'CAD': 'CAD',
};

interface AccountInfo { id: string; name: string; currency: string; user_id: string; }
interface CustomerInfo { id: string; code: string; }

export function parseQuickInput(
  text: string,
  accounts: AccountInfo[],
  customAliases: Record<string, string>, // alias -> currency code
  customers: CustomerInfo[],
  defaultUserId: string,
): ParseResult {
  const warnings: string[] = [];
  let dateStr = '';
  let type: 'expense' | 'income' = 'income';
  let currencyCode = '';
  let amountNum = 0;
  let accountName: string | null = null;
  let accountId: string | null = null;
  let customerCode: string | null = null;
  let customerId: string | null = null;
  let notesPart = '';

  // 合并别名（自定义优先）
  const aliasMap = { ...BUILTIN_CURRENCY_MAP, ...customAliases };

  // 预处理
  let t = text.trim();
  // 全角数字转半角
  t = t.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
  t = t.replace(/．/g, '.');

  // 检测 + 分隔符格式
  if (t.includes('+')) {
    const parts = t.split('+').map(p => p.trim()).filter(Boolean);
    return parsePlusFormat(parts, accounts, aliasMap, customers, defaultUserId, warnings);
  }

  // ---- 自然语言解析 ----

  // 1. 提取日期
  let dateMatch = t.match(/(\d+)\s*月\s*(\d+)\s*[日号]/);
  if (dateMatch) {
    const m = dateMatch[1].padStart(2, '0');
    const d = dateMatch[2].padStart(2, '0');
    dateStr = `${dayjs().year()}-${m}-${d}`;
    t = t.replace(dateMatch[0], ' ');
  } else {
    dateMatch = t.match(/(\d{1,2})[.\/](\d{1,2})/);
    if (dateMatch) {
      const m = dateMatch[1].padStart(2, '0');
      const d = dateMatch[2].padStart(2, '0');
      dateStr = `${dayjs().year()}-${m}-${d}`;
      t = t.replace(dateMatch[0], ' ');
    }
  }
  if (!dateStr) dateStr = dayjs().format('YYYY-MM-DD');

  // 2. 检测方向
  const dirMatch = t.match(/^[-－]/);
  if (dirMatch || t.includes('付')) {
    type = 'expense';
    if (dirMatch) t = t.replace(/^[-－]\s*/, '');
    t = t.replace(/付/g, ' ');
  }
  if (t.includes('收')) {
    type = 'income';
    t = t.replace(/收/g, ' ');
  }

  // 3. 提取金额
  const amtMatch = t.match(/(\d[\d,.]*)/);
  if (amtMatch) {
    amountNum = parseFloat(amtMatch[1].replace(/,/g, ''));
    t = t.replace(amtMatch[1], ' ');
  } else {
    warnings.push('未识别到金额');
  }

  // 4. 匹配币种（从字符串中找币种名）
  const words = t.split(/[\s,，]+/).filter(Boolean);
  for (const w of words) {
    const upper = w.toUpperCase();
    if (aliasMap[upper]) {
      currencyCode = aliasMap[upper];
      t = t.replace(w, ' ');
      break;
    }
  }
  // 二次尝试：整段匹配
  if (!currencyCode) {
    const sorted = Object.keys(aliasMap).sort((a, b) => b.length - a.length);
    for (const key of sorted) {
      const idx = t.toLowerCase().indexOf(key.toLowerCase());
      if (idx >= 0) {
        currencyCode = aliasMap[key];
        t = t.replace(new RegExp(key, 'i'), ' ');
        break;
      }
    }
  }
  if (!currencyCode) {
    currencyCode = 'RUB';
    warnings.push('未识别币种，默认使用卢布(RUB)');
  }

  // 5. 匹配客户
  const custMatch = t.match(/客户\s*(\S+)/);
  if (custMatch) {
    customerCode = custMatch[1].toUpperCase();
    t = t.replace(custMatch[0], ' ');
    const found = customers.find(c => c.code.toUpperCase() === customerCode);
    if (found) customerId = found.id;
    else warnings.push(`未知客户: ${customerCode}`);
  }

  // 6. 匹配账户
  const remainingWords = t.split(/[\s,，]+/).filter(w => w.length > 0 && w !== '回款' && w !== '打款');
  for (const w of remainingWords) {
    const found = accounts.find(a =>
      a.name.toLowerCase().includes(w.toLowerCase()) ||
      w.toLowerCase().includes(a.name.toLowerCase())
    );
    if (found) {
      accountName = found.name;
      accountId = found.id;
      t = t.replace(w, ' ');
      break;
    }
  }

  // 7. 剩余 = 备注
  notesPart = t.replace(/\s+/g, ' ').trim();
  if (notesPart === '回款' || notesPart === '打款' || notesPart === '') notesPart = '';

  return {
    transaction_date: dateStr,
    type,
    currency: currencyCode,
    amount: amountNum,
    accountName,
    accountId,
    customerCode,
    customerId,
    notes: notesPart,
    warnings,
  };
}

// + 分隔格式解析
function parsePlusFormat(
  parts: string[],
  accounts: AccountInfo[],
  aliasMap: Record<string, string>,
  customers: CustomerInfo[],
  defaultUserId: string,
  warnings: string[],
): ParseResult {
  let dateStr = dayjs().format('YYYY-MM-DD');
  let type: 'expense' | 'income' = 'income';
  let currencyCode = 'RUB';
  let amountNum = 0;
  let accountName: string | null = null;
  let accountId: string | null = null;
  let customerCode: string | null = null;
  let customerId: string | null = null;
  let notesPart = '';

  for (const part of parts) {
    const p = part.trim();
    // 日期
    let dm = p.match(/^(\d{1,2})[.\/月](\d{1,2})/);
    if (dm) {
      dateStr = `${dayjs().year()}-${dm[1].padStart(2, '0')}-${dm[2].padStart(2, '0')}`;
      continue;
    }
    // 方向
    if (p === '收' || p.includes('收')) { type = 'income'; continue; }
    if (p === '付' || p.includes('付') || p.startsWith('-')) { type = 'expense'; continue; }
    // 金额
    let am = p.match(/^-?(\d[\d,.]*)/);
    if (am) {
      amountNum = parseFloat(am[1].replace(/,/g, ''));
      if (p.startsWith('-')) type = 'expense';
      continue;
    }
    // 币种
    const upper = p.toUpperCase();
    if (aliasMap[upper]) { currencyCode = aliasMap[upper]; continue; }
    // 客户
    if (p.toLowerCase().startsWith('客户')) {
      customerCode = p.replace(/客户/i, '').trim().toUpperCase();
      const found = customers.find(c => c.code.toUpperCase() === customerCode);
      if (found) customerId = found.id;
      else warnings.push(`未知客户: ${customerCode}`);
      continue;
    }
    if (customers.some(c => c.code.toUpperCase() === p.toUpperCase())) {
      customerCode = p.toUpperCase();
      customerId = customers.find(c => c.code.toUpperCase() === p.toUpperCase())!.id;
      continue;
    }
    // 账户
    const acc = accounts.find(a =>
      a.name.toLowerCase().includes(p.toLowerCase()) ||
      p.toLowerCase().includes(a.name.toLowerCase())
    );
    if (acc) { accountName = acc.name; accountId = acc.id; continue; }
    // 剩下是备注
    notesPart += (notesPart ? ' ' : '') + p;
  }

  return {
    transaction_date: dateStr,
    type,
    currency: currencyCode,
    amount: amountNum,
    accountName,
    accountId,
    customerCode,
    customerId,
    notes: notesPart,
    warnings,
  };
}
