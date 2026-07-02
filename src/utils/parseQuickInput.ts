import dayjs from 'dayjs';

export interface ParseResult {
  transaction_date: string;
  type: 'expense' | 'income';
  currency: string;
  amount: number;
  exchange_rate: number | null;  // 1外币=?RMB
  theoretical_cost: number | null;
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

// 需要做除法的币种（1 RMB = X 外币）
const DIVIDE_CURRENCIES = ['RUB', 'JPY', 'KRW'];

function calcTheoretical(amount: number, rate: number, currency: string): number {
  return DIVIDE_CURRENCIES.includes(currency)
    ? +(amount / rate).toFixed(4)
    : +(amount * rate).toFixed(4);
}

interface AccountInfo { id: string; name: string; currency: string; user_id: string; }
interface CustomerInfo { id: string; code: string; }

export function parseQuickInput(
  text: string,
  accounts: AccountInfo[],
  customAliases: Record<string, string>,
  customers: CustomerInfo[],
  defaultUserId: string,
  defaultSalespersonId: string,  // 用于自动创建客户
): ParseResult {
  const warnings: string[] = [];
  let dateStr = '';
  let type: 'expense' | 'income' = 'income';
  let currencyCode = '';
  let amountNum = 0;
  let exchangeRate: number | null = null;
  let accountName: string | null = null;
  let accountId: string | null = null;
  let customerCode: string | null = null;
  let customerId: string | null = null;
  let notesPart = '';

  const aliasMap = { ...BUILTIN_CURRENCY_MAP, ...customAliases };

  let t = text.trim();
  t = t.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
  t = t.replace(/．/g, '.');

  // + 分隔格式
  if (t.includes('+')) {
    const parts = t.split('+').map(p => p.trim()).filter(Boolean);
    return parsePlusFormat(parts, accounts, aliasMap, customers, defaultUserId, warnings);
  }

  // 1. 日期
  let dateMatch = t.match(/(\d+)\s*月\s*(\d+)\s*[日号]/);
  if (dateMatch) {
    dateStr = `${dayjs().year()}-${dateMatch[1].padStart(2, '0')}-${dateMatch[2].padStart(2, '0')}`;
    t = t.replace(dateMatch[0], ' ');
  } else {
    dateMatch = t.match(/(\d{1,2})[.\/](\d{1,2})/);
    if (dateMatch) {
      dateStr = `${dayjs().year()}-${dateMatch[1].padStart(2, '0')}-${dateMatch[2].padStart(2, '0')}`;
      t = t.replace(dateMatch[0], ' ');
    }
  }
  if (!dateStr) dateStr = dayjs().format('YYYY-MM-DD');

  // 2. 方向
  if (t.match(/^[-－]/) || t.includes('付')) {
    type = 'expense';
    t = t.replace(/^[-－]\s*/, '').replace(/付/g, ' ');
  }
  if (t.includes('收')) {
    type = 'income';
    t = t.replace(/收/g, ' ');
  }

  // 3. 提取金额（最后出现的数字是金额）
  const numbers = [...t.matchAll(/(\d[\d,.]*)/g)];
  if (numbers.length >= 1) {
    // 找主金额（最大的那个，排除日期相关的小数字）
    const candidates = numbers.map(m => ({
      val: parseFloat(m[1].replace(/,/g, '')),
      str: m[1],
      idx: m.index!,
    }));
    // 主金额：通常是最大的数字
    const main = candidates.reduce((a, b) => a.val >= b.val ? a : b);
    amountNum = main.val;
    t = t.replace(main.str, ' ');

    // 如果还有数字，可能是汇率
    const remaining = [...t.matchAll(/(\d[\d,.]*)/g)];
    if (remaining.length >= 1) {
      const rateMatch = remaining[0];
      exchangeRate = parseFloat(rateMatch[1].replace(/,/g, ''));
      t = t.replace(rateMatch[1], ' ');
    }
  } else {
    warnings.push('未识别到金额');
  }

  // 4. 匹配币种
  const sorted = Object.keys(aliasMap).sort((a, b) => b.length - a.length);
  for (const key of sorted) {
    const idx = t.toLowerCase().indexOf(key.toLowerCase());
    if (idx >= 0) {
      currencyCode = aliasMap[key];
      t = t.replace(new RegExp(key, 'i'), ' ');
      break;
    }
  }
  if (!currencyCode) { currencyCode = 'RUB'; warnings.push('未识别币种，默认卢布(RUB)'); }

  // 5. 客户
  const custMatch = t.match(/客户\s*(\S+)/);
  if (custMatch) {
    customerCode = custMatch[1].toUpperCase();
    t = t.replace(custMatch[0], ' ');
    const found = customers.find(c => c.code.toUpperCase() === customerCode);
    if (found) customerId = found.id;
  }

  // 6. 账户
  const remainingWords = t.split(/[\s,，]+/).filter(w => w.length > 0 && w !== '回款' && w !== '打款');
  for (const w of remainingWords) {
    const found = accounts.find(a =>
      a.name.toLowerCase().includes(w.toLowerCase()) ||
      w.toLowerCase().includes(a.name.toLowerCase())
    );
    if (found) { accountName = found.name; accountId = found.id; t = t.replace(w, ' '); break; }
  }

  // 7. 备注
  notesPart = t.replace(/\s+/g, ' ').trim();
  if (['回款', '打款', ''].includes(notesPart)) notesPart = '';

  return {
    transaction_date: dateStr,
    type,
    currency: currencyCode,
    amount: amountNum,
    exchange_rate: exchangeRate,
    theoretical_cost: exchangeRate != null ? calcTheoretical(amountNum, exchangeRate, currencyCode) : null,
    accountName, accountId, customerCode, customerId,
    notes: notesPart,
    warnings,
  };
}

// + 分隔格式
function parsePlusFormat(
  parts: string[], accounts: AccountInfo[], aliasMap: Record<string, string>,
  customers: CustomerInfo[], defaultUserId: string, warnings: string[],
): ParseResult {
  let dateStr = dayjs().format('YYYY-MM-DD');
  let type: 'expense' | 'income' = 'income';
  let currencyCode = 'RUB';
  let amountNum = 0;
  let exchangeRate: number | null = null;
  let accountName: string | null = null, accountId: string | null = null;
  let customerCode: string | null = null, customerId: string | null = null;
  let notesPart = '';

  for (const part of parts) {
    const p = part.trim();
    let dm = p.match(/^(\d{1,2})[.\/月](\d{1,2})/);
    if (dm) { dateStr = `${dayjs().year()}-${dm[1].padStart(2, '0')}-${dm[2].padStart(2, '0')}`; continue; }
    if (p === '收' || p.includes('收')) { type = 'income'; continue; }
    if (p === '付' || p.includes('付') || p.startsWith('-')) { type = 'expense'; continue; }
    let am = p.match(/^-?(\d[\d,.]*)/);
    if (am) {
      const v = parseFloat(am[1].replace(/,/g, ''));
      if (amountNum === 0) { amountNum = v; }
      else if (exchangeRate == null) { exchangeRate = v; }
      if (p.startsWith('-')) type = 'expense';
      continue;
    }
    const upper = p.toUpperCase();
    if (aliasMap[upper]) { currencyCode = aliasMap[upper]; continue; }
    if (p.toLowerCase().startsWith('客户')) {
      customerCode = p.replace(/客户/i, '').trim().toUpperCase();
      const found = customers.find(c => c.code.toUpperCase() === customerCode);
      if (found) customerId = found.id;
      continue;
    }
    if (customers.some(c => c.code.toUpperCase() === p.toUpperCase())) {
      customerCode = p.toUpperCase();
      customerId = customers.find(c => c.code.toUpperCase() === p.toUpperCase())!.id;
      continue;
    }
    const acc = accounts.find(a => a.name.toLowerCase().includes(p.toLowerCase()) || p.toLowerCase().includes(a.name.toLowerCase()));
    if (acc) { accountName = acc.name; accountId = acc.id; continue; }
    notesPart += (notesPart ? ' ' : '') + p;
  }

  return {
    transaction_date: dateStr, type, currency: currencyCode, amount: amountNum,
    exchange_rate: exchangeRate,
    theoretical_cost: exchangeRate != null ? calcTheoretical(amountNum, exchangeRate, currencyCode) : null,
    accountName, accountId, customerCode, customerId,
    notes: notesPart, warnings,
  };
}
