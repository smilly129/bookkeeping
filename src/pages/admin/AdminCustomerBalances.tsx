import { useState, useEffect } from 'react';
import {
  Table, Button, Select, Space, Tag, Modal, Input, InputNumber, message,
} from 'antd';
import { ExportOutlined, SearchOutlined } from '@ant-design/icons';
import { supabase, type Salesperson, type Customer, type PurchaseSummary } from '../../lib/supabase';
import dayjs from 'dayjs';

interface CustBalance {
  customer_id: string;
  customer_code: string;
  salesperson_id: string;
  salesperson_name: string;
  total_deposit: number;
  purchase_allocated: number;
  available_balance: number;
  purchase_count: number;
  pending_shortfall_count: number;
}

interface LedgerDetail {
  id: string;
  transaction_date: string;
  currency: string;
  type: string;
  business_type: string;
  amount: number;
  from_amount?: number;
  to_amount?: number;
  direction: string;
  notes: string;
  theoretical_cost?: number;
}

export default function AdminCustomerBalances() {
  const [data, setData] = useState<CustBalance[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterSp, setFilterSp] = useState('');
  const [filterCustSearch, setFilterCustSearch] = useState('');

  const [salespersons, setSalespersons] = useState<Salesperson[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [purchases, setPurchases] = useState<PurchaseSummary[]>([]);

  // 明细弹窗
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailCust, setDetailCust] = useState<CustBalance | null>(null);
  const [detailLedger, setDetailLedger] = useState<LedgerDetail[]>([]);
  const [detailPurchases, setDetailPurchases] = useState<PurchaseSummary[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    loadLookups();
  }, []);

  useEffect(() => {
    if (customers.length > 0 || salespersons.length > 0) computeBalances();
  }, [filterSp, filterCustSearch, customers, purchases]);

  const loadLookups = async () => {
    const [spRes, custRes, purRes] = await Promise.all([
      supabase.from('salespersons').select('*').order('name'),
      supabase.from('customers').select('*').order('code'),
      supabase.from('purchase_summary').select('*'),
    ]);
    if (spRes.data) setSalespersons(spRes.data);
    if (custRes.data) setCustomers(custRes.data);
    if (purRes.data) setPurchases(purRes.data as PurchaseSummary[]);
  };

  const computeBalances = async () => {
    setLoading(true);

    // 获取所有带 customer_id 的 transactions
    let custFilter = customers;
    if (filterSp) custFilter = custFilter.filter(c => c.salesperson_id === filterSp);
    if (filterCustSearch) {
      const s = filterCustSearch.toLowerCase();
      custFilter = custFilter.filter(c => c.code.toLowerCase().includes(s) || (c.name || '').toLowerCase().includes(s));
    }

    const custIds = custFilter.map(c => c.id);
    if (custIds.length === 0) { setData([]); setLoading(false); return; }

    const { data: txs } = await supabase.from('transactions')
      .select('customer_id, type, currency, amount, to_amount, direction, theoretical_cost, business_type')
      .in('customer_id', custIds)
      .eq('is_deleted', false);

    const rows: CustBalance[] = custFilter.map(c => {
      const custTxs = (txs || []).filter(t => t.customer_id === c.id && t.business_type !== 'exchange');
      const totalDeposit = custTxs.reduce((s, t) => {
        // 优先用理论成本（人民币），否则用金额
        if (t.theoretical_cost) return s + t.theoretical_cost;
        if (t.type === 'income') return s + (t.amount || 0);
        return s;
      }, 0);

      // 该客户关联的采购
      const custPurchases = purchases.filter(p => p.customer_id === c.id);
      const purchaseAllocated = custPurchases.reduce((s, p) => s + (p.quoted_price || 0), 0);
      const pendingCount = custPurchases.filter(p => p.shortfall > 0).length;

      return {
        customer_id: c.id,
        customer_code: c.code,
        salesperson_id: c.salesperson_id,
        salesperson_name: salespersons.find(s => s.id === c.salesperson_id)?.name || '',
        total_deposit: totalDeposit,
        purchase_allocated: purchaseAllocated,
        available_balance: totalDeposit - purchaseAllocated,
        purchase_count: custPurchases.length,
        pending_shortfall_count: pendingCount,
      };
    });

    // 过滤：存款余额绝对值 <= 1 的忽略
    const filtered = rows.filter(r => Math.abs(r.available_balance) > 1);

    setData(filtered);
    setLoading(false);
  };

  const showDetail = async (row: CustBalance) => {
    setDetailCust(row);
    setDetailOpen(true);
    setDetailLoading(true);

    const [txRes, purRes] = await Promise.all([
      supabase.from('transactions')
        .select('id, transaction_date, currency, type, business_type, amount, from_amount, to_amount, exchange_rate, direction, notes, theoretical_cost')
        .eq('customer_id', row.customer_id)
        .eq('is_deleted', false)
        .order('transaction_date', { ascending: false }),
      supabase.from('purchase_summary').select('*').eq('customer_id', row.customer_id),
    ]);

    if (txRes.data) setDetailLedger(txRes.data as LedgerDetail[]);
    if (purRes.data) setDetailPurchases(purRes.data as PurchaseSummary[]);
    setDetailLoading(false);
  };

  const handleExport = () => {
    const headers = ['客户代号', '业务员', '总打款', '采购占用', '可用余额', '采购笔数', '待补款笔数'];
    const rows = data.map(r => [
      r.customer_code, r.salesperson_name, r.total_deposit, r.purchase_allocated,
      r.available_balance, r.purchase_count, r.pending_shortfall_count,
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.map(c => `"${c ?? ''}"`).join(','))].join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `客户对账_${dayjs().format('YYYYMMDD')}.csv`;
    a.click();
    message.success('导出成功');
  };

  const columns = [
    {
      title: '客户代号', dataIndex: 'customer_code', key: 'code', width: 110,
      render: (c: string) => <Tag color="blue" style={{ fontWeight: 600 }}>{c}</Tag>,
    },
    { title: '业务员', dataIndex: 'salesperson_name', key: 'sp', width: 80 },
    {
      title: '总打款', dataIndex: 'total_deposit', key: 'deposit', width: 100,
      render: (v: number) => <span style={{ color: '#1677ff' }}>{v.toLocaleString()}</span>,
    },
    {
      title: '采购占用', dataIndex: 'purchase_allocated', key: 'alloc', width: 100,
      render: (v: number) => v > 0 ? v.toLocaleString() : '—',
    },
    {
      title: '存款/欠款', dataIndex: 'available_balance', key: 'bal', width: 110,
      render: (v: number) => (
        <span style={{ fontWeight: 600, color: v > 0 ? '#52c41a' : v < 0 ? '#ff4d4f' : '#888' }}>
          {v > 0 ? `存款+${v.toLocaleString()}` : v < 0 ? `欠款${v.toLocaleString()}` : '0'}
        </span>
      ),
    },
    {
      title: '采购情况', key: 'purchases', width: 120,
      render: (_: any, r: CustBalance) => (
        <Space size={4}>
          <Tag>{r.purchase_count}笔采购</Tag>
          {r.pending_shortfall_count > 0 && <Tag color="error">⚠️{r.pending_shortfall_count}笔待补</Tag>}
        </Space>
      ),
    },
    {
      title: '操作', key: 'actions', width: 80, fixed: 'right' as const,
      render: (_: any, r: CustBalance) => (
        <Button size="small" icon={<SearchOutlined />} onClick={() => showDetail(r)}>明细</Button>
      ),
    },
  ];

  const totalDeposit = data.reduce((s, r) => s + r.total_deposit, 0);
  const totalAvail = data.reduce((s, r) => s + r.available_balance, 0);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ margin: 0 }}>📋 客户对账总表</h2>
        <Button icon={<ExportOutlined />} onClick={handleExport}>导出CSV</Button>
      </div>

      {/* 汇总卡片 */}
      <Space wrap style={{ marginBottom: 16 }}>
        <Tag color="blue" style={{ padding: '4px 12px', fontSize: 14 }}>客户 {data.length} 个</Tag>
        <Tag color="blue" style={{ padding: '4px 12px', fontSize: 14 }}>总打款: {totalDeposit.toLocaleString()}</Tag>
        <Tag color={totalAvail >= 0 ? 'green' : 'red'} style={{ padding: '4px 12px', fontSize: 14 }}>可用余额: {totalAvail >= 0 ? '+' : ''}{totalAvail.toLocaleString()}</Tag>
      </Space>

      {/* 搜索 */}
      <Space wrap style={{ marginBottom: 16 }}>
        <Input.Search
          placeholder="输入客户代号搜索"
          value={filterCustSearch}
          onChange={(e) => setFilterCustSearch(e.target.value)}
          onSearch={(v) => setFilterCustSearch(v.trim().toUpperCase())}
          style={{ width: 220 }}
          enterButton={<SearchOutlined />}
          allowClear
        />
      </Space>

      <Table
        columns={columns}
        dataSource={data}
        rowKey="customer_id"
        loading={loading}
        scroll={{ x: 800 }}
        pagination={{ pageSize: 30, showTotal: (t) => `共 ${t} 个客户` }}
        size="small"
      />

      {/* 明细弹窗 */}
      <Modal
        title={`客户明细 - ${detailCust?.customer_code} (${detailCust?.salesperson_name})`}
        open={detailOpen}
        onCancel={() => setDetailOpen(false)}
        footer={null}
        width={800}
      >
        <div style={{ marginBottom: 16 }}>
          <Tag color="blue">总打款: {detailCust?.total_deposit?.toLocaleString()}</Tag>
          <Tag color="orange">采购占用: {detailCust?.purchase_allocated?.toLocaleString()}</Tag>
          <Tag color={detailCust && detailCust.available_balance >= 0 ? 'green' : 'red'}>
            可用余额: {detailCust?.available_balance?.toLocaleString()}
          </Tag>
        </div>

        <h4 style={{ marginBottom: 8 }}>流水记录</h4>
        <Table
          columns={[
            { title: '日期', dataIndex: 'transaction_date', key: 'date', width: 100 },
            { title: '币种', dataIndex: 'currency', key: 'cur', width: 60 },
            {
              title: '类型', dataIndex: 'type', key: 'type', width: 70,
              render: (t: string) => {
                const m: Record<string, string> = { expense: '付款', income: '收款', exchange: '换汇', transfer: '转款' };
                return <Tag>{m[t] || t}</Tag>;
              },
            },
            {
              title: '业务类型', dataIndex: 'business_type', key: 'bt', width: 70,
              render: (t: string) => {
                if (!t) return null;
                const m: Record<string, string> = { exchange: '换汇', purchase: '采购', other: '其他' };
                return <Tag color="purple">{m[t] || t}</Tag>;
              },
            },
            {
              title: '金额', key: 'amt', width: 100,
              render: (_: any, r: LedgerDetail) => {
                if (r.type === 'exchange') return `${r.from_amount}→${r.to_amount}`;
                return r.amount?.toLocaleString();
              },
            },
            {
              title: '汇率', dataIndex: 'exchange_rate', key: 'rate', width: 80,
              render: (v: number) => v != null ? v : '—',
            },
            {
              title: '理论成本', dataIndex: 'theoretical_cost', key: 'tc', width: 100,
              render: (v: number) => v != null ? `${v.toLocaleString()} RMB` : '—',
            },
            {
              title: '方向', dataIndex: 'direction', key: 'dir', width: 60,
              render: (d: string) => d ? <Tag color={d === 'receive' ? 'green' : 'red'}>{d === 'receive' ? '收' : '付'}</Tag> : null,
            },
            { title: '备注', dataIndex: 'notes', key: 'notes', ellipsis: true, render: (v: string) => v || '—' },
          ]}
          dataSource={detailLedger}
          rowKey="id"
          size="small"
          loading={detailLoading}
          pagination={false}
          style={{ marginBottom: 16 }}
          locale={{ emptyText: '暂无流水记录' }}
        />

        <h4 style={{ marginBottom: 8, marginTop: 16 }}>采购记录</h4>
        <Table
          columns={[
            { title: '币种', dataIndex: 'currency', key: 'cur', width: 60 },
            { title: '报价', dataIndex: 'quoted_price', key: 'price', width: 90,
              render: (_: number, r: any) => (
                <InputNumber size="small" style={{ width: 80 }}
                  value={r.quoted_price}
                  onChange={async (v) => {
                    const val = v || 0;
                    setDetailPurchases(prev => prev.map(p => p.id === r.id ? { ...p, quoted_price: val, profit: val - (p.actual_cost || 0) } : p));
                    await supabase.from('purchases').update({ quoted_price: val, updated_at: new Date().toISOString() }).eq('id', r.id);
                  }} />
              ),
            },
            { title: '实际支出', dataIndex: 'actual_cost', key: 'cost', width: 90,
              render: (_: number, r: any) => (
                <InputNumber size="small" style={{ width: 80 }}
                  value={r.actual_cost}
                  onChange={async (v) => {
                    const val = v || 0;
                    setDetailPurchases(prev => prev.map(p => p.id === r.id ? { ...p, actual_cost: val, profit: (p.quoted_price || 0) - val } : p));
                    await supabase.from('purchases').update({ actual_cost: val, updated_at: new Date().toISOString() }).eq('id', r.id);
                  }} />
              ),
            },
            { title: '存款', dataIndex: 'customer_deposit', key: 'dep', width: 90,
              render: (_: number, r: any) => (
                <InputNumber size="small" style={{ width: 80 }}
                  value={r.customer_deposit || 0}
                  onChange={async (v) => {
                    const val = v || 0;
                    setDetailPurchases(prev => prev.map(p => p.id === r.id ? { ...p, customer_deposit: val } : p));
                    await supabase.from('purchases').update({ customer_deposit: val, updated_at: new Date().toISOString() }).eq('id', r.id);
                  }} />
              ),
            },
            {
              title: '已收款', dataIndex: 'total_received', key: 'recv', width: 80,
              render: (v: number) => v?.toLocaleString() || '0',
            },
            {
              title: '待补款', dataIndex: 'shortfall', key: 'sf', width: 80,
              render: (v: number) => v > 0 ? <Tag color="error">{v.toLocaleString()}</Tag> : <Tag color="success">✓</Tag>,
            },
            {
              title: '利润', dataIndex: 'profit', key: 'profit', width: 80,
              render: (v: number) => v != null ? <span style={{ color: v >= 0 ? '#52c41a' : '#ff4d4f' }}>{v >= 0 ? '+' : ''}{v.toLocaleString()}</span> : '—',
            },
            {
              title: '状态', dataIndex: 'status', key: 'status', width: 70,
              render: (s: string) => s === 'completed' ? <Tag color="green">已完成</Tag> : <Tag color="blue">进行中</Tag>,
            },
            { title: '备注', dataIndex: 'notes', key: 'notes', ellipsis: true, render: (v: string) => v || '—' },
          ]}
          dataSource={detailPurchases}
          rowKey="id"
          size="small"
          loading={detailLoading}
          pagination={false}
          locale={{ emptyText: '暂无采购记录' }}
        />
      </Modal>
    </div>
  );
}
