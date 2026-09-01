import { useState, useEffect, useCallback } from 'react';
import {
  Table, Button, Input, Select, DatePicker, Space, Tag, Modal,
  Form, InputNumber, message, Popconfirm, Image, Collapse,
} from 'antd';
import { SearchOutlined, ExportOutlined, DeleteOutlined, EditOutlined, PlusOutlined, DownOutlined, TagOutlined } from '@ant-design/icons';
import { supabase, type Transaction, type Account, type Customer, type Salesperson, type CurrencyAlias, CURRENCIES, ACCOUNT_TYPES, TRANSFER_DIRECTIONS, BUSINESS_TYPES, RATE_DIRECTIONS } from '../../lib/supabase';
import dayjs from 'dayjs';
import * as XLSX from 'xlsx';
import { parseQuickInput } from '../../utils/parseQuickInput';

// 需要做除法的币种（1 RMB = X 外币）
function calcTheoretical(amount: number, rate: number, currency: string): number {
  const divideCurrencies = ['RUB', 'JPY', 'KRW'];
  return divideCurrencies.includes(currency)
    ? +(amount / rate).toFixed(4)
    : +(amount * rate).toFixed(4);
}

interface TxRow extends Transaction {
  user_name?: string;
  from_account_name?: string;
  to_account_name?: string;
  _isDuplicate?: boolean;
  customer_code?: string;
  salesperson_name?: string;
}

// 从备注提取客户代号和业务类型
function extractBizFromNotes(notes: string, allCustomers: Customer[]) {
  const result: { customer_code?: string; customer_id?: string; business_type?: string } = {};
  if (!notes?.trim()) return result;
  const n = notes.trim();

  // 提取客户代号（字母+数字组合，如BF9009, JY1906-37, lxd2852）
  const codeMatch = n.match(/[A-Za-z]{2,}\d{2,}(-\d+)?/);
  if (codeMatch) {
    const code = codeMatch[0].toUpperCase();
    result.customer_code = code;
    const found = allCustomers.find(c => c.code.toUpperCase() === code);
    if (found) result.customer_id = found.id;
  }

  // 提取业务类型
  if (/采购|回款|补款/.test(n)) result.business_type = 'purchase';
  else if (/换汇/.test(n)) result.business_type = 'exchange';
  else if (/客户/.test(n)) result.business_type = 'other';

  return result;
}

export default function AdminRecords() {
  const [data, setData] = useState<TxRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingRow, setEditingRow] = useState<TxRow | null>(null);
  const [editModalOpen, setEditModalOpen] = useState(false);

  // 新增记录
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addLoading, setAddLoading] = useState(false);
  const [newRecord, setNewRecord] = useState({
    user_id: '', type: 'expense' as string, direction: '',
    currency: '', amount: '',
    from_currency: '', to_currency: '', from_amount: '', to_amount: '', exchange_rate: '',
    from_account_id: '', to_account_id: '',
    transaction_date: dayjs(),
    notes: '',
    // 业务字段
    customer_id: '', business_type: '', purchase_id: '',
    customer_code: '',  // 直接输入的客户代号
  });
  const [addAccounts, setAddAccounts] = useState<Account[]>([]);

  // 加载新增用户的账户
  const loadAccounts = async (userId: string) => {
    if (!userId) { setAddAccounts([]); return; }
    const { data } = await supabase.from('accounts').select('*').eq('user_id', userId);
    if (data) setAddAccounts(data);
  };

  // 提交新增
  const handleAddRecord = async () => {
    const r = newRecord;
    if (!r.user_id || !r.type) { message.error('请选择用户和类型'); return; }
    setAddLoading(true);

    const base: any = {
      user_id: r.user_id,
      transaction_date: dayjs(r.transaction_date).format('YYYY-MM-DD'),
      notes: r.notes || null,
    };
    // 业务字段（可选）
    const custCode = r.customer_code?.trim().toUpperCase();
    if (custCode) {
      // 查找或自动创建客户
      let custId = r.customer_id;
      if (!custId) {
        const found = allCustomers.find(c => c.code.toUpperCase() === custCode);
        if (found) {
          custId = found.id;
        } else {
          const { data: newCust } = await supabase.from('customers').insert({
            code: custCode,
            salesperson_id: r.user_id || null,
          }).select('id').single();
          if (newCust) {
            custId = newCust.id;
            supabase.from('customers').select('*').order('code').then(({ data: d }) => {
              if (d) setAllCustomers(d as any);
            });
          }
        }
      }
      if (custId) {
        base.customer_id = custId;
        base.business_type = r.business_type || null;
        base.purchase_id = r.purchase_id || null;
        if (r.exchange_rate) {
          const rate = parseFloat(r.exchange_rate);
          base.exchange_rate = rate;
          if ((r.amount || r.from_amount)) {
            const amt = parseFloat(r.amount || r.from_amount);
            const cur = r.currency || r.from_currency || '';
            if (rate && amt) base.theoretical_cost = calcTheoretical(amt, rate, cur);
          }
        }
      }
    }

    let data: any = {};
    switch (r.type) {
      case 'expense':
        if (!r.direction || !r.currency || !r.amount || !r.from_account_id) {
          message.error('请填写完整'); setAddLoading(false); return;
        }
        data = { ...base, type: 'expense', direction: r.direction, currency: r.currency, amount: parseFloat(r.amount), from_account_id: r.from_account_id };
        break;
      case 'income':
        if (!r.direction || !r.currency || !r.amount || !r.to_account_id) {
          message.error('请填写完整'); setAddLoading(false); return;
        }
        data = { ...base, type: 'income', direction: r.direction, currency: r.currency, amount: parseFloat(r.amount), to_account_id: r.to_account_id };
        break;
      case 'exchange':
        if (!r.from_currency || !r.to_currency || !r.from_amount || !r.to_amount || !r.exchange_rate || !r.from_account_id || !r.to_account_id) {
          message.error('请填写完整'); setAddLoading(false); return;
        }
        data = { ...base, type: 'exchange', from_currency: r.from_currency, to_currency: r.to_currency, from_amount: parseFloat(r.from_amount), to_amount: parseFloat(r.to_amount), exchange_rate: parseFloat(r.exchange_rate), from_account_id: r.from_account_id, to_account_id: r.to_account_id };
        break;
      case 'transfer': {
        const fromAcc = addAccounts.find(a => a.id === r.from_account_id);
        const toAcc = addAccounts.find(a => a.id === r.to_account_id);
        const isCross = fromAcc && toAcc && fromAcc.currency !== toAcc.currency;
        if (!r.direction || !r.from_account_id || !r.to_account_id) {
          message.error('请填写完整'); setAddLoading(false); return;
        }
        if (isCross) {
          if (!r.from_amount || !r.to_amount || !r.exchange_rate) {
            message.error('请填写完整'); setAddLoading(false); return;
          }
          data = { ...base, type: 'transfer', direction: r.direction, from_currency: fromAcc.currency, to_currency: toAcc.currency, from_amount: parseFloat(r.from_amount), to_amount: parseFloat(r.to_amount), exchange_rate: parseFloat(r.exchange_rate), from_account_id: r.from_account_id, to_account_id: r.to_account_id };
        } else {
          if (!r.amount) {
            message.error('请填写金额'); setAddLoading(false); return;
          }
          data = { ...base, type: 'transfer', direction: r.direction, currency: fromAcc?.currency || '', amount: parseFloat(r.amount), from_account_id: r.from_account_id, to_account_id: r.to_account_id };
        }
        break;
      }
    }

    const { error } = await supabase.from('transactions').insert(data);
    setAddLoading(false);
    if (error) { message.error('添加失败: ' + error.message); return; }
    message.success('已添加');
    setAddModalOpen(false);
    setNewRecord({ user_id: '', type: 'expense', direction: '', currency: '', amount: '', from_currency: '', to_currency: '', from_amount: '', to_amount: '', exchange_rate: '', from_account_id: '', to_account_id: '', transaction_date: dayjs(), notes: '', customer_id: '', business_type: '', purchase_id: '', customer_code: '' });
    loadData();
  };

  // 筛选
  const [filterUser, setFilterUser] = useState('');
  const [filterType, setFilterType] = useState<string | undefined>();
  const [filterCurrency, setFilterCurrency] = useState('');
  const [filterDateRange, setFilterDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs]>([
    dayjs().subtract(30, 'day'), dayjs(),
  ]);
  const [users, setUsers] = useState<{ id: string; name: string }[]>([]);
  const [filterAccountId, setFilterAccountId] = useState('');
  const [allAccounts, setAllAccounts] = useState<{ id: string; name: string; currency: string; user_id: string }[]>([]);
  const [filterCustomer, setFilterCustomer] = useState('');

  // 业务管理模块相关
  const [salespersons, setSalespersons] = useState<Salesperson[]>([]);
  const [allCustomers, setAllCustomers] = useState<Customer[]>([]);
  const [custBySp, setCustBySp] = useState<Customer[]>([]); // 按业务员筛选的客户
  const [allPurchases, setAllPurchases] = useState<{ id: string; customer_id: string; quoted_price: number; }[]>([]);

  // 快速录入
  const [quickInputText, setQuickInputText] = useState('');
  const [quickResult, setQuickResult] = useState<ReturnType<typeof parseQuickInput> | null>(null);
  const [quickLoading, setQuickLoading] = useState(false);
  const [currencyAliases, setCurrencyAliases] = useState<Record<string, string>>({});

  // 加载用户和账户列表 + 业务模块数据
  useEffect(() => {
    supabase.from('users').select('id, name').then(({ data }) => {
      if (data) setUsers(data);
    });
    supabase.from('accounts').select('id, name, currency, user_id').then(({ data }) => {
      if (data) setAllAccounts(data);
    });
    // 业务模块: 加载业务员、客户、采购列表
    supabase.from('salespersons').select('*').order('name').then(({ data }) => {
      if (data) setSalespersons(data);
    });
    supabase.from('customers').select('*').order('code').then(({ data }) => {
      if (data) setAllCustomers(data as any);
    });
    supabase.from('purchases').select('id, customer_id, quoted_price').eq('status', 'in_progress').then(({ data }) => {
      if (data) setAllPurchases(data);
    });
    // 加载币种别名
    supabase.from('currency_aliases').select('*').then(({ data }) => {
      if (data) {
        const map: Record<string, string> = {};
        (data as CurrencyAlias[]).forEach(a => { map[a.alias] = a.currency; });
        setCurrencyAliases(map);
      }
    });
  }, []);

  // 加载交易数据
  const loadData = useCallback(async () => {
    setLoading(true);
    let query = supabase.from('transactions').select(`
      *,
      from_acc:from_account_id(name),
      to_acc:to_account_id(name)
    `).eq('is_deleted', false)
      .gte('transaction_date', filterDateRange[0].format('YYYY-MM-DD'))
      .lte('transaction_date', filterDateRange[1].format('YYYY-MM-DD'))
      .order('transaction_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(500);

    if (filterType) query = query.eq('type', filterType);
    if (filterCurrency) {
      query = query.or(`currency.eq.${filterCurrency},from_currency.eq.${filterCurrency},to_currency.eq.${filterCurrency}`);
    }
    if (filterCustomer) {
      query = query.eq('customer_id', filterCustomer);
    }

    const { data: txData } = await query;
    if (txData) {
      // 关联用户名称
      const userIds = [...new Set(txData.map(t => t.user_id))];
      const { data: userData } = await supabase.from('users').select('id, name').in('id', userIds);
      const userMap = new Map(userData?.map(u => [u.id, u.name]) || []);

      // 构建客户查找 Map（直接从数据库加载最新数据，不依赖缓存）
      const { data: freshCustomers } = await supabase.from('customers').select('*');
      const { data: freshSPs } = await supabase.from('salespersons').select('*');
      const custMap = new Map((freshCustomers || allCustomers).map((c: any) => [c.id, c]));
      const spMap = new Map((freshSPs || salespersons).map((s: any) => [s.id, s.name]));

      const rows: TxRow[] = txData.map(t => ({
        ...t,
        user_name: userMap.get(t.user_id) || t.user_id,
        from_account_name: (t as any).from_acc?.name,
        to_account_name: (t as any).to_acc?.name,
        customer_code: t.customer_id ? (custMap.get(t.customer_id)?.code || '') : '',
        salesperson_name: t.customer_id ? (spMap.get(custMap.get(t.customer_id)?.salesperson_id || '') || '') : '',
      }));

      // 疑似重复检测：同用户 + 同日期 + 同类型 + 同金额
      const groups = new Map<string, TxRow[]>();
      rows.forEach(r => {
        const key = `${r.user_id}|${r.transaction_date}|${r.type}|${r.amount || r.from_amount}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(r);
      });
      groups.forEach((group) => {
        if (group.length > 1) {
          group.forEach(r => { r._isDuplicate = true; });
        }
      });

      let filtered = rows;
      if (filterUser) { filtered = filtered.filter(r => r.user_id === filterUser); }
      if (filterAccountId) { filtered = filtered.filter(r => r.from_account_id === filterAccountId || r.to_account_id === filterAccountId); }
      setData(filtered);
    }
    setLoading(false);
  }, [filterType, filterCurrency, filterDateRange, filterUser, filterCustomer]);

  useEffect(() => { loadData(); }, [loadData]);

  // 编辑保存
  const handleSaveEdit = async () => {
    if (!editingRow) return;

    // 客户代号处理：有输入就找或创建客户
    const custCode = (editingRow as any).customer_code?.trim().toUpperCase() || '';
    let custId = editingRow.customer_id || '';
    if (custCode && !custId) {
      // 先从缓存找
      let found = allCustomers.find(c => c.code.toUpperCase() === custCode);
      if (!found) {
        // 从数据库查
        const { data: dbCust } = await supabase.from('customers').select('id').eq('code', custCode).single();
        if (dbCust) {
          custId = dbCust.id;
        } else {
          // 自动创建
          const spId = salespersons[0]?.id || '';
          const { data: newCust } = await supabase.from('customers').insert({
            code: custCode, salesperson_id: spId || null,
          }).select('id').single();
          if (newCust) custId = newCust.id;
        }
      } else {
        custId = found.id;
      }
    }

    // 计算理论成本
    const rateVal = editingRow.exchange_rate
      ? (typeof editingRow.exchange_rate === 'number' ? editingRow.exchange_rate : parseFloat(String(editingRow.exchange_rate)))
      : 0;
    const amtVal = editingRow.amount || editingRow.from_amount || 0;
    const curVal = editingRow.currency || editingRow.from_currency || '';
    const theoCost = (rateVal && amtVal) ? calcTheoretical(amtVal, rateVal, curVal) : null;

    const updateData: any = {
      type: editingRow.type,
      direction: editingRow.direction,
      currency: editingRow.currency,
      amount: editingRow.amount,
      from_currency: editingRow.from_currency,
      to_currency: editingRow.to_currency,
      from_amount: editingRow.from_amount,
      to_amount: editingRow.to_amount,
      exchange_rate: rateVal || editingRow.exchange_rate || null,
      from_account_id: editingRow.from_account_id,
      to_account_id: editingRow.to_account_id,
      notes: editingRow.notes,
      transaction_date: editingRow.transaction_date,
      updated_at: new Date().toISOString(),
      // 业务字段（总是写入，不管之前有没有）
      customer_id: custId || null,
      business_type: editingRow.business_type || null,
      purchase_id: editingRow.purchase_id || null,
      theoretical_cost: theoCost,
      rate_direction: null,
    };

    // 诊断：看看实际发送了什么
    console.log('SAVE EDIT:', { id: editingRow.id, custCode, custId, business_type: editingRow.business_type, rateVal, updateData });

    const { error } = await supabase.from('transactions').update(updateData).eq('id', editingRow.id);

    if (error) {
      message.error('保存失败: ' + error.message);
    } else {
      message.success('已保存' + (custCode ? `（客户: ${custCode}, ${editingRow.business_type || '无类型'}）` : ''));
      setEditModalOpen(false);
      setEditingRow(null);
      loadData();
    }
  };

  // 软删除
  const handleDelete = async (id: string) => {
    await supabase.from('transactions').update({
      is_deleted: true,
      updated_at: new Date().toISOString(),
    }).eq('id', id);
    message.success('已删除');
    loadData();
  };

  // 导出
  const handleExport = () => {
    const headers = ['日期', '姓名', '类型', '方向', '币种', '金额', '从币种', '到币种', '从金额', '到金额', '汇率', '出账账户', '入账账户', '备注'];
    const rows = data.map(r => [
      r.transaction_date, r.user_name, r.type, r.direction,
      r.currency || '', r.amount || '',
      r.from_currency || '', r.to_currency || '',
      r.from_amount || '', r.to_amount || '',
      r.exchange_rate || '',
      r.from_account_name || '', r.to_account_name || '',
      r.notes || '',
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.map(c => `"${c || ''}"`).join(','))].join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `流水导出_${dayjs().format('YYYYMMDD')}.csv`;
    a.click();
    message.success('导出成功');
  };

  // ========== 标客户 ==========
  const handleToggleFreight = async (record: TxRow) => {
    const note = (record.notes || '').trim();
    if (!note) { message.error('该记录没有备注，无法标记'); return; }

    if (record.is_freight) {
      // 取消标记
      await supabase.from('transactions').update({ is_freight: false }).eq('id', record.id);
      message.success('已取消标记');
    } else {
      // 人名入库
      await supabase.from('freight_persons').upsert({ name: note }, { onConflict: 'name' });
      // 把历史所有同备注的收款自动标记
      const { error } = await supabase.from('transactions').update({ is_freight: true })
        .eq('is_deleted', false)
        .eq('type', 'income')
        .eq('notes', note);
      if (error) { message.error('标记失败: ' + error.message); return; }
      message.success(`已标记「${note}」，历史同备注的收款已自动标记`);
    }
    loadData();
  };

  // ========== 月度总结导出 ==========
  const [summaryMonth, setSummaryMonth] = useState(dayjs());

  // 卡分类
  const classifyCard = (accName: string): string => {
    if (!accName) return '';
    if (accName.includes('阿尔法')) return '阿尔法卡';
    if (accName.includes('T卡') || accName === 'T') return 'T卡';
    if (accName.includes('C卡') || accName === 'C') return 'C卡';
    if (accName.includes('现金')) return '现金';
    return accName;
  };

  const handleExportMonthlySummary = async () => {
    const monthStart = summaryMonth.startOf('month').format('YYYY-MM-DD');
    const monthEnd = summaryMonth.endOf('month').format('YYYY-MM-DD');

    const { data: txs } = await supabase.from('transactions').select(`
      *,
      from_acc:from_account_id(name),
      to_acc:to_account_id(name)
    `).eq('is_deleted', false)
      .gte('transaction_date', monthStart)
      .lte('transaction_date', monthEnd)
      .order('transaction_date', { ascending: true });

    if (!txs || txs.length === 0) { message.warning('该月暂无流水'); return; }

    // ===== 分类聚合 =====
    // 卡总结: { date: { card: { RUB: {in,out}, USD: {in,out} } } }
    const cardMap = new Map<string, Map<string, { rubIn: number; rubOut: number; usdIn: number; usdOut: number }>>();
    // 运费: { date: { persons: { name: {rub, usd} }, customs: { company: {rub, usd} } } }
    const freightMap = new Map<string, { persons: Map<string, { rub: number; usd: number }>; customs: Map<string, { rub: number; usd: number }> }>();

    const allDates = new Set<string>();
    const allPersons = new Set<string>();
    const allCustoms = new Set<string>();

    const getDayFreight = (date: string) => {
      if (!freightMap.has(date)) freightMap.set(date, { persons: new Map(), customs: new Map() });
      return freightMap.get(date)!;
    };
    const getCardDay = (date: string) => {
      if (!cardMap.has(date)) cardMap.set(date, new Map());
      return cardMap.get(date)!;
    };
    const addCardAmt = (date: string, card: string, currency: string, amount: number, isIncome: boolean) => {
      if (!card || !amount) return;
      const day = getCardDay(date);
      if (!day.has(card)) day.set(card, { rubIn: 0, rubOut: 0, usdIn: 0, usdOut: 0 });
      const c = day.get(card)!;
      const isRUB = currency === 'RUB';
      if (isIncome) { if (isRUB) c.rubIn += amount; else c.usdIn += amount; }
      else { if (isRUB) c.rubOut += amount; else c.usdOut += amount; }
    };

    txs.forEach(t => {
      const date = (t.transaction_date || '').slice(0, 10);
      if (!date) return;
      allDates.add(date);
      const note = (t.notes || '').trim();
      const fromAcc = (t as any).from_acc?.name || '';
      const toAcc = (t as any).to_acc?.name || '';

      // 出账（支出）侧
      if (t.from_account_id) {
        const outAmt = t.from_amount || t.amount || 0;
        const outCur = t.from_currency || t.currency || '';
        const card = classifyCard(fromAcc);
        // 清关支出: 备注以「付」开头（付568/付707/付贝加尔）
        if (note.startsWith('付')) {
          const company = note.replace(/^付/, '').trim() || '未知';
          const fd = getDayFreight(date);
          if (!fd.customs.has(company)) fd.customs.set(company, { rub: 0, usd: 0 });
          const c = fd.customs.get(company)!;
          if (outCur === 'RUB') c.rub += outAmt; else c.usd += outAmt;
          allCustoms.add(company);
        } else {
          addCardAmt(date, card, outCur, outAmt, false);
        }
      }

      // 入账（收入）侧
      if (t.to_account_id) {
        const inAmt = t.to_amount || t.amount || 0;
        const inCur = t.to_currency || t.currency || '';
        const card = classifyCard(toAcc);
        // 运费收入: 标了客户(is_freight)的才计，且备注不以「付」开头
        if (t.is_freight && !note.startsWith('付')) {
          const person = note || '未备注';
          const fd = getDayFreight(date);
          if (!fd.persons.has(person)) fd.persons.set(person, { rub: 0, usd: 0 });
          const p = fd.persons.get(person)!;
          if (inCur === 'RUB') p.rub += inAmt; else p.usd += inAmt;
          allPersons.add(person);
        } else {
          addCardAmt(date, card, inCur, inAmt, true);
        }
      }
    });

    // ===== 构建 Excel =====
    const sortedDates = [...allDates].sort();
    const personsList = [...allPersons];
    const customsList = [...allCustoms];
    // 卡列: 收入侧和支出侧对称
    const inCols = ['收T卡', '收C卡', '收阿尔法卡', '收现金卢布', '收现金美金'];
    const outCols = ['支T卡', '支C卡', '支阿尔法卡', '支现金卢布', '支现金美金'];

    // 金额显示: 卢布≥10万 缩写 xx万
    const fmtRub = (v: number): string => {
      if (v === 0) return '';
      if (Math.abs(v) >= 100000) return `${+(v / 10000).toFixed(2)}万`;
      return String(v);
    };
    const fmtUsd = (v: number): string => {
      if (v === 0) return '';
      return String(v);
    };

    // 卡收入/支出汇总文本: 收入：xxx卢布+xx万美金（无千分位逗号）
    const fmtTotal = (rub: number, usd: number): string => {
      const parts: string[] = [];
      if (rub) parts.push(`${rub}卢布`);
      if (usd) parts.push(`${+(usd / 10000).toFixed(2)}万美金`);
      return parts.length > 0 ? parts.join('+') : '0';
    };
    // 运费汇总: 收入：103.84万卢布（无千分位逗号）
    const fmtFreightTotal = (rub: number, usd: number): string => {
      const parts: string[] = [];
      if (rub) parts.push(`${+(rub / 10000).toFixed(2)}万卢布`);
      if (usd) parts.push(`${usd}美金`);
      return parts.length > 0 ? parts.join('+') : '0';
    };

    const aoa: any[][] = [];

    // 取某天某卡的数据
    const getCardData = (date: string, card: string) => cardMap.get(date)?.get(card);

    // ===== 块1: 卡总结 =====
    const merges: any[] = [];
    const cardBlockStart = aoa.length;
    aoa.push([`${summaryMonth.format('YYYY-MM')} 卡总结`]);
    merges.push({ s: { r: cardBlockStart, c: 0 }, e: { r: cardBlockStart, c: 11 } }); // 标题跨12列
    // 分组表头: 日期 | 收入(5列) | 空 | 支出(5列)
    aoa.push(['日期', '收入', '', '', '', '', '', '支出', '', '', '', '']);
    merges.push({ s: { r: cardBlockStart + 1, c: 1 }, e: { r: cardBlockStart + 1, c: 5 } }); // 收入
    merges.push({ s: { r: cardBlockStart + 1, c: 7 }, e: { r: cardBlockStart + 1, c: 11 } }); // 支出
    merges.push({ s: { r: cardBlockStart + 1, c: 0 }, e: { r: cardBlockStart + 2, c: 0 } }); // 日期跨两行
    // 子表头
    aoa.push(['', ...inCols, '', ...outCols]);

    let monthRubIn = 0, monthRubOut = 0, monthUsdIn = 0, monthUsdOut = 0;

    sortedDates.forEach(date => {
      const row: any[] = [date];
      let dayRubIn = 0, dayRubOut = 0, dayUsdIn = 0, dayUsdOut = 0;

      // 收入侧
      const pushIn = (card: string, isRub: boolean) => {
        const c = getCardData(date, card);
        if (!c) { row.push(''); return; }
        if (isRub) { dayRubIn += c.rubIn; row.push(fmtRub(c.rubIn)); }
        else { dayUsdIn += c.usdIn; row.push(fmtUsd(c.usdIn)); }
      };
      pushIn('T卡', true);
      pushIn('C卡', true);
      pushIn('阿尔法卡', true);
      pushIn('现金', true);
      pushIn('现金', false);
      row.push('');
      // 支出侧
      const pushOut = (card: string, isRub: boolean) => {
        const c = getCardData(date, card);
        if (!c) { row.push(''); return; }
        if (isRub) { dayRubOut += c.rubOut; row.push(c.rubOut ? '-' + fmtRub(c.rubOut) : ''); }
        else { dayUsdOut += c.usdOut; row.push(c.usdOut ? '-' + fmtUsd(c.usdOut) : ''); }
      };
      pushOut('T卡', true);
      pushOut('C卡', true);
      pushOut('阿尔法卡', true);
      pushOut('现金', true);
      pushOut('现金', false);

      monthRubIn += dayRubIn; monthRubOut += dayRubOut; monthUsdIn += dayUsdIn; monthUsdOut += dayUsdOut;
      aoa.push(row);
      // 当日合计行
      const totalRowIdx = aoa.length;
      aoa.push([`${date.slice(5)}合计`, `收入：${fmtTotal(dayRubIn, dayUsdIn)}`, '', '', '', '', '', `支出：${fmtTotal(dayRubOut, dayUsdOut)}`, '', '', '', '']);
      merges.push({ s: { r: totalRowIdx, c: 1 }, e: { r: totalRowIdx, c: 6 } });
      merges.push({ s: { r: totalRowIdx, c: 7 }, e: { r: totalRowIdx, c: 11 } });
    });

    // 月总计
    const monthTotalIdx = aoa.length;
    aoa.push(['月总计', `收入：${fmtTotal(monthRubIn, monthUsdIn)}`, '', '', '', '', '', `支出：${fmtTotal(monthRubOut, monthUsdOut)}`, '', '', '', '']);
    merges.push({ s: { r: monthTotalIdx, c: 1 }, e: { r: monthTotalIdx, c: 6 } });
    merges.push({ s: { r: monthTotalIdx, c: 7 }, e: { r: monthTotalIdx, c: 11 } });
    aoa.push([]);
    aoa.push([]);

    // ===== 块2: 运费总结 =====
    const freightBlockStart = aoa.length;
    const freightCols = 1 + personsList.length + 1 + Math.max(customsList.length, 1); // 日期+人名+空+清关
    aoa.push([`${summaryMonth.format('YYYY-MM')} 运费总结`]);
    merges.push({ s: { r: freightBlockStart, c: 0 }, e: { r: freightBlockStart, c: freightCols - 1 } });
    // 分组表头
    const groupHeader = ['日期', '收入', ...Array(Math.max(personsList.length - 1, 0)).fill(''), '', '支出', ...Array(Math.max(customsList.length - 1, 0)).fill('')];
    aoa.push(groupHeader);
    merges.push({ s: { r: freightBlockStart + 1, c: 1 }, e: { r: freightBlockStart + 1, c: 1 + personsList.length - 1 } });
    merges.push({ s: { r: freightBlockStart + 1, c: 2 + personsList.length }, e: { r: freightBlockStart + 1, c: freightCols - 1 } });
    merges.push({ s: { r: freightBlockStart + 1, c: 0 }, e: { r: freightBlockStart + 2, c: 0 } });
    // 子表头
    const freightHeader = [''];
    personsList.forEach(p => freightHeader.push(`收${p}`));
    freightHeader.push('');
    customsList.forEach(c => freightHeader.push(`支付${c}`));
    if (customsList.length === 0) freightHeader.push('支付');
    aoa.push(freightHeader);

    let fRubIn = 0, fRubOut = 0, fUsdIn = 0, fUsdOut = 0;

    sortedDates.forEach(date => {
      const fd = freightMap.get(date);
      if (!fd) return;
      const row = [date];
      let dRubIn = 0, dRubOut = 0, dUsdIn = 0, dUsdOut = 0;
      personsList.forEach(p => {
        const v = fd.persons.get(p);
        if (!v) { row.push(''); return; }
        dRubIn += v.rub; dUsdIn += v.usd;
        row.push(v.rub ? fmtRub(v.rub) : v.usd ? fmtUsd(v.usd) : '');
      });
      row.push('');
      customsList.forEach(c => {
        const v = fd.customs.get(c);
        if (!v) { row.push(''); return; }
        dRubOut += v.rub; dUsdOut += v.usd;
        row.push('-' + (v.rub ? fmtRub(v.rub) : fmtUsd(v.usd)));
      });
      if (customsList.length === 0) row.push('');
      fRubIn += dRubIn; fRubOut += dRubOut; fUsdIn += dUsdIn; fUsdOut += dUsdOut;
      aoa.push(row);
      // 当日合计
      const ftIdx = aoa.length;
      aoa.push([`${date.slice(5)}合计`, `收入：${fmtFreightTotal(dRubIn, dUsdIn)}`, ...Array(Math.max(personsList.length - 1, 0)).fill(''), '', `支出：${fmtFreightTotal(dRubOut, dUsdOut)}`, ...Array(Math.max(customsList.length - 1, 0)).fill('')]);
      merges.push({ s: { r: ftIdx, c: 1 }, e: { r: ftIdx, c: 1 + personsList.length - 1 } });
      merges.push({ s: { r: ftIdx, c: 2 + personsList.length }, e: { r: ftIdx, c: freightCols - 1 } });
    });

    const fMonthIdx = aoa.length;
    aoa.push(['月总计', `收入：${fmtFreightTotal(fRubIn, fUsdIn)}`, ...Array(Math.max(personsList.length - 1, 0)).fill(''), '', `支出：${fmtFreightTotal(fRubOut, fUsdOut)}`, ...Array(Math.max(customsList.length - 1, 0)).fill('')]);
    merges.push({ s: { r: fMonthIdx, c: 1 }, e: { r: fMonthIdx, c: 1 + personsList.length - 1 } });
    merges.push({ s: { r: fMonthIdx, c: 2 + personsList.length }, e: { r: fMonthIdx, c: freightCols - 1 } });

    // 生成 Excel
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = Array.from({ length: 12 }, (_, i) => ({ wch: i === 0 ? 12 : 16 }));
    ws['!merges'] = merges;
    // 合并单元格居中
    const centerStyle = { alignment: { horizontal: 'center', vertical: 'center' } };
    merges.forEach(m => {
      for (let r = m.s.r; r <= m.e.r; r++) {
        for (let c = m.s.c; c <= m.e.c; c++) {
          const addr = XLSX.utils.encode_cell({ r, c });
          if (ws[addr]) ws[addr].s = centerStyle;
        }
      }
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '月度总结');
    XLSX.writeFile(wb, `月度总结_${summaryMonth.format('YYYYMM')}.xlsx`);
    message.success('导出成功');
  };

  // 快速录入：解析文本
  const handleQuickParse = () => {
    if (!quickInputText.trim()) return;
    const result = parseQuickInput(
      quickInputText,
      allAccounts,
      currencyAliases,
      allCustomers,
      users[0]?.id || '',
    );
    setQuickResult(result);
  };

  // 快速录入：一键创建
  const handleQuickCreate = async () => {
    if (!quickResult) return;
    const r = quickResult;
    if (!r.amount) { message.error('未识别到金额'); return; }
    if (!users[0]) { message.error('没有可用的记账人'); return; }

    setQuickLoading(true);

    // 客户不存在则自动创建
    let custId = r.customerId;
    if (r.customerCode && !custId) {
      const spId = salespersons[0]?.id || ''; // 默认关联第一个业务员
      const { data: newCust, error: custErr } = await supabase.from('customers').insert({
        code: r.customerCode,
        salesperson_id: spId || null,
      }).select('id').single();
      if (!custErr && newCust) {
        custId = newCust.id;
        // 刷新客户列表
        supabase.from('customers').select('*').order('code').then(({ data }) => {
          if (data) setAllCustomers(data as any);
        });
      }
    }

    const base: any = {
      user_id: users[0].id,
      type: r.type,
      transaction_date: r.transaction_date,
      currency: r.currency,
      amount: r.amount,
      notes: r.notes || null,
    };

    if (r.type === 'expense') {
      base.from_account_id = r.accountId || null;
    } else {
      base.to_account_id = r.accountId || null;
    }

    if (custId) {
      base.customer_id = custId;
      base.business_type = 'other';
    }
    if (r.exchange_rate) base.exchange_rate = r.exchange_rate;
    if (r.theoretical_cost != null) base.theoretical_cost = r.theoretical_cost;

    const { error } = await supabase.from('transactions').insert(base);
    setQuickLoading(false);

    if (error) {
      message.error('录入失败: ' + error.message);
    } else {
      let msg = `✅ 已录入: ${r.type === 'income' ? '收款' : '付款'} ${r.amount.toLocaleString()} ${r.currency}`;
      if (r.customerCode) msg += ` 客户${r.customerCode}${!r.customerId ? '（已自动创建）' : ''}`;
      if (r.accountName) msg += ` → ${r.accountName}`;
      if (r.exchange_rate) msg += ` 汇率${r.exchange_rate}`;
      message.success(msg);
      setQuickInputText('');
      setQuickResult(null);
      loadData();
    }
  };

  const typeOptions = [
    { value: 'expense', label: '💸 付款' },
    { value: 'income', label: '💰 收款' },
    { value: 'exchange', label: '🔄 换汇' },
    { value: 'transfer', label: '📤 转款' },
  ];

  const columns = [
    { title: '日期', dataIndex: 'transaction_date', key: 'date', width: 100, sorter: (a: TxRow, b: TxRow) => a.transaction_date.localeCompare(b.transaction_date),
      render: (date: string, record: TxRow) => (
        <span>
          {date}
          {record._isDuplicate && <Tag color="warning" style={{ marginLeft: 4, fontSize: 10 }}>疑似重复</Tag>}
        </span>
      ),
    },
    {
      title: '姓名', dataIndex: 'user_name', key: 'user', width: 80,
      filters: users.map(u => ({ text: u.name, value: u.name })),
      onFilter: (value: any, record: TxRow) => record.user_name === value,
    },
    {
      title: '类型', dataIndex: 'type', key: 'type', width: 80,
      render: (t: string) => {
        const m: Record<string, string> = { expense: '💸付款', income: '💰收款', exchange: '🔄换汇', transfer: '📤转款' };
        return <Tag>{m[t] || t}</Tag>;
      },
      filters: typeOptions.map(o => ({ text: o.label, value: o.value })),
      onFilter: (value: any, record: TxRow) => record.type === value,
    },
    { title: '方向', dataIndex: 'direction', key: 'dir', width: 60 },
    {
      title: '币种', key: 'currency_display', width: 80,
      render: (_: any, r: TxRow) => r.type === 'exchange' ? `${r.from_currency}→${r.to_currency}` : r.currency,
    },
    {
      title: '金额', key: 'amount_display', width: 100,
      render: (_: any, r: TxRow) => r.type === 'exchange' ? `${r.from_amount}→${r.to_amount}` : r.amount?.toLocaleString(),
    },
    { title: '汇率', dataIndex: 'exchange_rate', key: 'rate', width: 80 },
    { title: '出账账户', dataIndex: 'from_account_name', key: 'from_acc', width: 120, ellipsis: true },
    { title: '入账账户', dataIndex: 'to_account_name', key: 'to_acc', width: 120, ellipsis: true },
    {
      title: '凭证', dataIndex: 'image_url', key: 'img', width: 60,
      render: (url: string) => url ? <Image src={url} width={30} preview={{ mask: '🔍' }} /> : null,
    },
    { title: '备注', dataIndex: 'notes', key: 'notes', width: 150, ellipsis: true },
    {
      title: '客户', dataIndex: 'customer_code', key: 'customer', width: 100,
      render: (code: string, r: TxRow) => code ? <Tag color="blue">{code}</Tag> : null,
    },
    {
      title: '业务类型', dataIndex: 'business_type', key: 'biz_type', width: 80,
      render: (t: string) => {
        if (!t) return null;
        const m: Record<string, string> = { exchange: '🔄换汇', purchase: '🛒采购', other: '📌其他' };
        return <Tag>{m[t] || t}</Tag>;
      },
    },
    {
      title: '操作', key: 'actions', width: 150, fixed: 'right' as const,
      render: (_: any, record: TxRow) => (
        <Space>
          {record.type === 'income' && (
            <Popconfirm
              title={record.is_freight ? '取消标客户?' : `标记为运费客户「${(record.notes || '').trim() || '无备注'}」?`}
              onConfirm={() => handleToggleFreight(record)}
            >
              <Button size="small" type={record.is_freight ? 'primary' : 'default'} icon={<TagOutlined />}>
                {record.is_freight ? '已标' : '标客户'}
              </Button>
            </Popconfirm>
          )}
          <Button size="small" icon={<EditOutlined />} onClick={() => {
            const row = { ...record };
            // 如果 customer_code 为空但有 customer_id，从缓存补充
            if (!row.customer_code && row.customer_id) {
              const c = allCustomers.find(x => x.id === row.customer_id);
              if (c) row.customer_code = c.code;
            }
            setEditingRow(row);
            setEditModalOpen(true);
          }} />
          <Popconfirm title="确定删除?" onConfirm={() => handleDelete(record.id)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ margin: 0 }}>📋 数据表格</h2>
        <Space>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => {
            setAddModalOpen(true);
            setAddAccounts([]);
          }}>新增记录</Button>
          <Button icon={<ExportOutlined />} onClick={handleExport}>导出CSV</Button>
          <DatePicker
            picker="month"
            value={summaryMonth}
            onChange={(d) => setSummaryMonth(d || dayjs())}
            allowClear={false}
            style={{ width: 120 }}
          />
          <Button type="primary" icon={<ExportOutlined />} onClick={handleExportMonthlySummary}>导出月度总结</Button>
        </Space>
      </div>

      {/* 快速录入区 */}
      <div style={{
        marginBottom: 16, padding: 12, background: '#fafafa', borderRadius: 8,
        border: '1px solid #f0f0f0',
      }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: '#555' }}>💬 快速录入收款/付款</div>
        <textarea
          value={quickInputText}
          onChange={(e) => {
            setQuickInputText(e.target.value);
            if (e.target.value.trim()) {
              const result = parseQuickInput(e.target.value, allAccounts, currencyAliases, allCustomers, users[0]?.id || '', salespersons[0]?.id || '');
              setQuickResult(result);
            } else {
              setQuickResult(null);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (quickResult && quickResult.amount) handleQuickCreate();
            }
          }}
          placeholder={'例: 6月24日收5000卢布 t卡 客户alex回款\n     付2000美金 国外美元 客户bob\n     -3000卢布 t卡'}
          rows={2}
          style={{ width: '100%', padding: 8, borderRadius: 4, border: '1px solid #d9d9d9', fontFamily: 'inherit', fontSize: 14, resize: 'vertical' }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, flexWrap: 'wrap', gap: 8 }}>
          {/* 解析预览 */}
          {quickResult && quickInputText.trim() && (
            <div style={{ fontSize: 13, color: '#555', flex: 1 }}>
              <span>📅 {quickResult.transaction_date}</span>
              <span style={{ marginLeft: 12, color: quickResult.type === 'income' ? '#52c41a' : '#ff4d4f' }}>
                {quickResult.type === 'income' ? '💰收款' : '💸付款'}
              </span>
              {quickResult.amount > 0 && (
                <span style={{ marginLeft: 12, fontWeight: 600 }}>{quickResult.amount.toLocaleString()} {quickResult.currency}</span>
              )}
              {quickResult.accountName && (
                <span style={{ marginLeft: 12 }}>🏦 {quickResult.accountName}</span>
              )}
              {quickResult.customerCode && (
                <span style={{ marginLeft: 12, color: '#1677ff' }}>👤 {quickResult.customerCode}</span>
              )}
              {quickResult.notes && (
                <span style={{ marginLeft: 12, color: '#888' }}>📝 {quickResult.notes}</span>
              )}
              {quickResult.warnings.length > 0 && (
                <span style={{ marginLeft: 12, color: '#fa8c16' }}>⚠️ {quickResult.warnings.join(', ')}</span>
              )}
            </div>
          )}
          <Space>
            <Button size="small" onClick={() => { setQuickInputText(''); setQuickResult(null); }}>清空</Button>
            <Button
              size="small" type="primary"
              loading={quickLoading}
              disabled={!quickResult || !quickResult.amount}
              onClick={handleQuickCreate}
            >
              一键录入
            </Button>
          </Space>
        </div>
        <div style={{ fontSize: 11, color: '#bbb', marginTop: 4 }}>
          输入格式: [日期] [收/付] [金额] [币种] [账户] 客户[代号] [备注]。无日期=当天，无币种=卢布，无标记=收款。Enter直接提交。
        </div>
      </div>

      {/* 筛选栏 */}
      <Space wrap style={{ marginBottom: 16 }}>
        <Select
          placeholder="按人筛选" allowClear style={{ width: 120 }}
          value={filterUser || undefined}
          onChange={(v) => setFilterUser(v || '')}
          options={users.map(u => ({ label: u.name, value: u.id }))}
        />
        <Select
          placeholder="按类型" allowClear style={{ width: 120 }}
          value={filterType}
          onChange={setFilterType}
          options={typeOptions}
        />
        <Select
          placeholder="按币种" allowClear style={{ width: 100 }}
          value={filterCurrency || undefined}
          onChange={(v) => setFilterCurrency(v || '')}
          options={CURRENCIES.filter(Boolean).map(c => ({ label: c, value: c }))}
        />
        <Select
          placeholder="按账户" allowClear style={{ width: 160 }}
          value={filterAccountId || undefined}
          onChange={(v) => setFilterAccountId(v || '')}
          options={allAccounts.map(a => ({ label: `${a.name} (${a.currency})`, value: a.id }))}
        />
        <Select
          placeholder="按客户" allowClear style={{ width: 140 }}
          value={filterCustomer || undefined}
          onChange={(v) => setFilterCustomer(v || '')}
          options={allCustomers.map(c => ({ label: `${c.code}`, value: c.id }))}
          showSearch
          filterOption={(input, option) => (option?.label as string)?.toLowerCase().includes(input.toLowerCase())}
        />
        <DatePicker.RangePicker
          value={filterDateRange}
          onChange={(dates) => { if (dates && dates[0] && dates[1]) setFilterDateRange([dates[0], dates[1]]); }}
        />
        <Button icon={<SearchOutlined />} type="primary" onClick={loadData}>搜索</Button>
      </Space>

      <Table
        columns={columns}
        dataSource={data}
        rowKey="id"
        loading={loading}
        scroll={{ x: 1400 }}
        pagination={{ pageSize: 50, showTotal: (total) => `共 ${total} 条` }}
        size="small"
        onRow={(record) => ({
          style: record._isDuplicate ? { backgroundColor: '#fffbe6' } : undefined,
        })}
      />

      {/* 编辑弹窗 */}
      <Modal
        title="编辑记录"
        open={editModalOpen}
        onCancel={() => { setEditModalOpen(false); setEditingRow(null); }}
        onOk={handleSaveEdit}
        width={600}
      >
        {editingRow && (
          <Form layout="vertical">
            <Form.Item label="类型">
              <Select value={editingRow.type} onChange={(v) => setEditingRow({ ...editingRow, type: v })} options={typeOptions} />
            </Form.Item>
            <Form.Item label="方向">
              <Select value={editingRow.direction} onChange={(v) => setEditingRow({ ...editingRow, direction: v })}
                options={
                  editingRow.type === 'transfer'
                    ? TRANSFER_DIRECTIONS.map(d => ({ label: d.label, value: d.value }))
                    : [{ label: '国内', value: 'domestic' }, { label: '国外', value: 'international' }]
                }
                allowClear
              />
            </Form.Item>
            <Space>
              <Form.Item label="币种">
                <Select value={editingRow.currency} onChange={(v) => setEditingRow({ ...editingRow, currency: v })}
                  options={CURRENCIES.filter(Boolean).map(c => ({ label: c, value: c }))} allowClear style={{ width: 120 }} />
              </Form.Item>
              <Form.Item label="金额">
                <InputNumber value={editingRow.amount} onChange={(v) => setEditingRow({ ...editingRow, amount: v || 0 })} />
              </Form.Item>
            </Space>
            <Form.Item label="交易日期">
              <DatePicker
                value={editingRow.transaction_date ? dayjs(editingRow.transaction_date) : undefined}
                onChange={(date) => {
                  if (date) {
                    setEditingRow({ ...editingRow, transaction_date: dayjs(date).format('YYYY-MM-DD') });
                  }
                }}
              />
            </Form.Item>
            <Form.Item label="备注">
              <Input.TextArea value={editingRow.notes || ''} onChange={(e) => setEditingRow({ ...editingRow, notes: e.target.value })} rows={2} />
            </Form.Item>
            <div style={{ marginTop: 12, padding: '8px 0', borderTop: '1px dashed #d9d9d9' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 13, color: '#1677ff' }}>业务信息</span>
                <Button size="small" type="link" onClick={() => {
                  const extracted = extractBizFromNotes(editingRow?.notes || '', allCustomers);
                  if (extracted.customer_code) {
                    setEditingRow({ ...editingRow!, ...extracted });
                    message.success(`已提取: ${extracted.customer_code} ${extracted.business_type || ''}`);
                  } else {
                    message.warning('备注中未识别到客户代号');
                  }
                }}>📋 从备注提取</Button>
              </div>
              <Form.Item label="客户代号">
                <Input
                  value={editingRow.customer_code || ''}
                  onChange={(e) => {
                    const code = e.target.value.toUpperCase();
                    const found = allCustomers.find(c => c.code.toUpperCase() === code);
                    setEditingRow({ ...editingRow, customer_code: e.target.value, customer_id: found?.id || '' });
                  }}
                  placeholder="直接输入客户代号"
                  style={{ fontFamily: 'monospace' }}
                />
              </Form.Item>
              <Form.Item label="汇率">
                <Input
                  value={editingRow.exchange_rate || ''}
                  onChange={(e) => setEditingRow({ ...editingRow, exchange_rate: e.target.value || undefined as any })}
                  placeholder="卢布12.5 / USDT 6.65"
                />
              </Form.Item>
              <Form.Item label="业务类型">
                <Select
                  value={editingRow.business_type || undefined}
                  onChange={(v) => setEditingRow({ ...editingRow, business_type: v || '' })}
                  options={BUSINESS_TYPES.map(b => ({ label: b.label, value: b.value }))}
                  allowClear
                />
              </Form.Item>
            </div>
          </Form>
        )}
      </Modal>

      {/* 新增记录弹窗 */}
      <Modal
        title="新增记录"
        open={addModalOpen}
        onCancel={() => setAddModalOpen(false)}
        onOk={handleAddRecord}
        confirmLoading={addLoading}
        width={600}
      >
        <Form layout="vertical">
          <Form.Item label="记账人" required>
            <Select
              value={newRecord.user_id || undefined}
              onChange={(v) => {
                setNewRecord({ ...newRecord, user_id: v, from_account_id: '', to_account_id: '' });
                loadAccounts(v);
              }}
              options={users.map(u => ({ label: u.name, value: u.id }))}
              placeholder="选择记账人"
            />
          </Form.Item>
          <Form.Item label="类型" required>
            <Select value={newRecord.type} onChange={(v) => setNewRecord({ ...newRecord, type: v })}
              options={typeOptions} />
          </Form.Item>

          {/* 方向 (expense/income/transfer) */}
          {['expense', 'income'].includes(newRecord.type) && (
            <Form.Item label="方向">
              <Select value={newRecord.direction || undefined} onChange={(v) => setNewRecord({ ...newRecord, direction: v || '' })}
                options={[{ label: '国内', value: 'domestic' }, { label: '国外', value: 'international' }]}
                allowClear
              />
            </Form.Item>
          )}
          {newRecord.type === 'transfer' && (
            <Form.Item label="方向" required>
              <Select value={newRecord.direction || undefined} onChange={(v) => setNewRecord({ ...newRecord, direction: v || '' })}
                options={TRANSFER_DIRECTIONS.map(d => ({ label: d.label, value: d.value }))} />
            </Form.Item>
          )}

          {/* 币种 + 金额 (expense/income) */}
          {['expense', 'income'].includes(newRecord.type) && (
            <Space>
              <Form.Item label="币种">
                <Select value={newRecord.currency || undefined} onChange={(v) => setNewRecord({ ...newRecord, currency: v || '' })}
                  options={CURRENCIES.filter(Boolean).map(c => ({ label: c, value: c }))} allowClear style={{ width: 120 }} />
              </Form.Item>
              <Form.Item label="金额">
                <Input type="number" value={newRecord.amount} onChange={(e) => setNewRecord({ ...newRecord, amount: e.target.value })} placeholder="输入金额" />
              </Form.Item>
            </Space>
          )}

          {/* exchange 双币种 */}
          {newRecord.type === 'exchange' && (
            <>
              <Space>
                <Form.Item label="从币种">
                  <Select value={newRecord.from_currency || undefined} onChange={(v) => setNewRecord({ ...newRecord, from_currency: v || '' })}
                    options={CURRENCIES.filter(Boolean).map(c => ({ label: c, value: c }))} allowClear style={{ width: 120 }} />
                </Form.Item>
                <Form.Item label="换成">
                  <Select value={newRecord.to_currency || undefined} onChange={(v) => setNewRecord({ ...newRecord, to_currency: v || '' })}
                    options={CURRENCIES.filter(Boolean).map(c => ({ label: c, value: c }))} allowClear style={{ width: 120 }} />
                </Form.Item>
              </Space>
              <Space>
                <Form.Item label="付出金额">
                  <Input type="number" value={newRecord.from_amount} onChange={(e) => setNewRecord({ ...newRecord, from_amount: e.target.value })} />
                </Form.Item>
                <Form.Item label="得到金额">
                  <Input type="number" value={newRecord.to_amount} onChange={(e) => setNewRecord({ ...newRecord, to_amount: e.target.value })} />
                </Form.Item>
              </Space>
              <Form.Item label="汇率">
                <Input value={newRecord.exchange_rate} onChange={(e) => setNewRecord({ ...newRecord, exchange_rate: e.target.value })} placeholder="汇率" />
              </Form.Item>
            </>
          )}

          {/* 账户选择 (非转款) */}
          {newRecord.user_id && newRecord.type !== 'transfer' && (
            <>
              {['expense', 'exchange'].includes(newRecord.type) && (
                <Form.Item label="从账户出">
                  <Select value={newRecord.from_account_id || undefined} onChange={(v) => setNewRecord({ ...newRecord, from_account_id: v || '' })}
                    options={addAccounts.map(a => ({ label: `${a.name} (${a.currency})`, value: a.id }))} allowClear />
                </Form.Item>
              )}
              {['income', 'exchange'].includes(newRecord.type) && (
                <Form.Item label="入账账户">
                  <Select value={newRecord.to_account_id || undefined} onChange={(v) => setNewRecord({ ...newRecord, to_account_id: v || '' })}
                    options={addAccounts.map(a => ({ label: `${a.name} (${a.currency})`, value: a.id }))} allowClear />
                </Form.Item>
              )}
            </>
          )}

          {/* 转款：账户 + 金额 */}
          {newRecord.user_id && newRecord.type === 'transfer' && (() => {
            const fromAcc = addAccounts.find(a => a.id === newRecord.from_account_id);
            const toAcc = addAccounts.find(a => a.id === newRecord.to_account_id);
            const isCross = fromAcc && toAcc && fromAcc.currency !== toAcc.currency;
            return (
              <>
                <Form.Item label="从账户出" required>
                  <Select value={newRecord.from_account_id || undefined}
                    onChange={(v) => {
                      const id = v || '';
                      const acc = addAccounts.find(a => a.id === id);
                      setNewRecord({ ...newRecord, from_account_id: id, from_currency: acc?.currency || '', to_currency: toAcc?.currency || '' });
                    }}
                    options={addAccounts.map(a => ({ label: `${a.name} (${a.currency})`, value: a.id }))} />
                </Form.Item>
                <Form.Item label="入账账户" required>
                  <Select value={newRecord.to_account_id || undefined}
                    onChange={(v) => {
                      const id = v || '';
                      const acc = addAccounts.find(a => a.id === id);
                      setNewRecord({ ...newRecord, to_account_id: id, from_currency: fromAcc?.currency || '', to_currency: acc?.currency || '' });
                    }}
                    options={addAccounts.map(a => ({ label: `${a.name} (${a.currency})`, value: a.id }))} />
                </Form.Item>
                {fromAcc && toAcc && (
                  <div style={{ fontSize: 12, color: isCross ? '#fa8c16' : '#52c41a', marginBottom: 12 }}>
                    {isCross ? `⚠️ 跨币种: ${fromAcc.currency} → ${toAcc.currency}` : `✅ 同币种: ${fromAcc.currency}`}
                  </div>
                )}
                {isCross ? (
                  <>
                    <Space>
                      <Form.Item label={`付出金额 (${fromAcc.currency})`}>
                        <Input type="number" value={newRecord.from_amount} onChange={(e) => {
                          const fa = parseFloat(e.target.value) || 0;
                          const er = parseFloat(newRecord.exchange_rate) || 0;
                          setNewRecord({ ...newRecord, from_amount: e.target.value, to_amount: er ? String((fa * er).toFixed(2)) : newRecord.to_amount });
                        }} />
                      </Form.Item>
                      <Form.Item label={`汇率 (${fromAcc.currency}→${toAcc.currency})`}>
                        <Input value={newRecord.exchange_rate} onChange={(e) => {
                          const er = parseFloat(e.target.value) || 0;
                          const fa = parseFloat(newRecord.from_amount) || 0;
                          setNewRecord({ ...newRecord, exchange_rate: e.target.value, to_amount: fa && er ? String((fa * er).toFixed(2)) : newRecord.to_amount });
                        }} />
                      </Form.Item>
                    </Space>
                    <Form.Item label={`到账金额 (${toAcc.currency})`}>
                      <Input type="number" value={newRecord.to_amount} onChange={(e) => {
                        const ta = parseFloat(e.target.value) || 0;
                        const fa = parseFloat(newRecord.from_amount) || 1;
                        setNewRecord({ ...newRecord, to_amount: e.target.value, exchange_rate: String((ta / fa).toFixed(6)) });
                      }} />
                    </Form.Item>
                  </>
                ) : (
                  <Form.Item label="金额">
                    <Input type="number" value={newRecord.amount} onChange={(e) => setNewRecord({ ...newRecord, amount: e.target.value })} placeholder="输入金额" />
                  </Form.Item>
                )}
              </>
            );
          })()}

          <Form.Item label="交易日期">
            <DatePicker
              value={newRecord.transaction_date}
              onChange={(date) => { if (date) setNewRecord({ ...newRecord, transaction_date: date }); }}
            />
          </Form.Item>

          {/* 业务信息（折叠区域） */}
          <Collapse
            ghost
            size="small"
            items={[{
              key: 'biz',
              label: <span style={{ fontSize: 13, color: '#1677ff' }}>▶ 业务信息</span>,
              children: (
                <div style={{ padding: '8px 0' }}>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
                    <Button size="small" type="link" onClick={() => {
                      const extracted = extractBizFromNotes(newRecord.notes, allCustomers);
                      if (extracted.customer_code) {
                        const custId = extracted.customer_id || '';
                        setNewRecord({ ...newRecord, customer_code: extracted.customer_code, customer_id: custId, business_type: extracted.business_type || newRecord.business_type });
                        message.success(`已提取: ${extracted.customer_code} ${extracted.business_type || ''}`);
                      } else {
                        message.warning('备注中未识别到客户代号');
                      }
                    }}>📋 从备注提取</Button>
                  </div>
                  <Form.Item label="业务员">
                    <Select
                      value={newRecord.user_id || undefined}
                      onChange={(v) => {
                        const spId = v || '';
                        setNewRecord({ ...newRecord, user_id: spId, customer_id: '', purchase_id: '' });
                        if (spId) {
                          supabase.from('customers').select('*')
                            .eq('salesperson_id', spId).order('code')
                            .then(({ data }) => { if (data) setCustBySp(data as any); });
                        } else { setCustBySp([]); }
                      }}
                      options={salespersons.map(s => ({ label: s.name, value: s.id }))}
                      placeholder="选择业务员（选后加载客户）"
                      allowClear
                    />
                  </Form.Item>
                  <Form.Item label="客户代号">
                    <Input
                      value={newRecord.customer_code}
                      onChange={(e) => {
                        const code = e.target.value.toUpperCase();
                        const found = allCustomers.find(c => c.code.toUpperCase() === code);
                        setNewRecord({
                          ...newRecord,
                          customer_code: e.target.value,
                          customer_id: found?.id || '',
                          purchase_id: '',
                        });
                      }}
                      placeholder="直接输入客户代号，自动创建"
                      style={{ fontFamily: 'monospace' }}
                    />
                    {newRecord.customer_code && !allCustomers.find(c => c.code.toUpperCase() === newRecord.customer_code.toUpperCase()) && (
                      <div style={{ fontSize: 11, color: '#fa8c16', marginTop: 2 }}>新客户，保存时自动创建</div>
                    )}
                    {newRecord.customer_code && allCustomers.find(c => c.code.toUpperCase() === newRecord.customer_code.toUpperCase()) && (
                      <div style={{ fontSize: 11, color: '#52c41a', marginTop: 2 }}>
                        ✅ 已匹配: {allCustomers.find(c => c.code.toUpperCase() === newRecord.customer_code.toUpperCase())?.code}
                      </div>
                    )}
                  </Form.Item>
                  <Form.Item label="汇率">
                    <Input
                      value={newRecord.exchange_rate}
                      onChange={(e) => setNewRecord({ ...newRecord, exchange_rate: e.target.value })}
                      placeholder="卢布12.5 / USDT 6.65"
                    />
                  </Form.Item>
                  <Form.Item label="业务类型">
                    <Select
                      value={newRecord.business_type || undefined}
                      onChange={(v) => {
                        setNewRecord({ ...newRecord, business_type: v || '', purchase_id: '' });
                      }}
                      options={BUSINESS_TYPES.map(b => ({ label: b.label, value: b.value }))}
                      allowClear
                    />
                  </Form.Item>
                  {newRecord.exchange_rate && (newRecord.amount || newRecord.from_amount) && (
                    <Form.Item label="理论成本（自动）">
                      <Input
                        value={
                          (() => {
                            const amt = parseFloat(newRecord.amount || newRecord.from_amount);
                            const rate = parseFloat(newRecord.exchange_rate);
                            const cur = newRecord.currency || newRecord.from_currency || '';
                            if (rate && amt) {
                              const tc = calcTheoretical(amt, rate, cur);
                              return `${tc} RMB`;
                            }
                            return '—';
                          })()
                        }
                        readOnly
                        style={{ color: '#888' }}
                      />
                    </Form.Item>
                  )}
                  {newRecord.business_type === 'purchase' && newRecord.customer_id && (
                    <Form.Item label="关联采购">
                      <Select
                        value={newRecord.purchase_id || undefined}
                        onChange={(v) => setNewRecord({ ...newRecord, purchase_id: v || '' })}
                        options={allPurchases
                          .filter(p => p.customer_id === newRecord.customer_id)
                          .map(p => ({ label: `报价 ${p.quoted_price || '—'}`, value: p.id }))}
                        placeholder="关联到采购记录（可选）"
                        allowClear
                      />
                    </Form.Item>
                  )}
                </div>
              ),
            }]}
          />

          <Form.Item label="备注">
            <Input.TextArea value={newRecord.notes} onChange={(e) => setNewRecord({ ...newRecord, notes: e.target.value })} rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
