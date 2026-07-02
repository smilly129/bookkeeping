import { useState, useEffect } from 'react';
import {
  Table, Button, Select, Space, Tag, Modal, InputNumber, Card, message, Input,
} from 'antd';
import { ExportOutlined, EditOutlined } from '@ant-design/icons';
import { supabase, type Salesperson, CURRENCIES } from '../../lib/supabase';
import dayjs from 'dayjs';

interface AssetRow {
  salesperson_id: string;
  salesperson_name: string;
  currency: string;
  total_received_foreign: number;
  total_received_cost: number;
  total_sold_foreign: number;
  total_sold_proceeds: number;
  weighted_avg_cost: number;
  current_holding: number;
  holding_cost: number;
  estimated_rate: number | null;
  estimated_value: number;
  unrealized_pnl: number;
  realized_pnl: number;
}

interface JournalEntry {
  id: string;
  transaction_date: string;
  currency: string;
  type: string;
  business_type: string;
  amount: number;
  from_amount: number;
  to_amount: number;
  direction: string;
  theoretical_cost: number;
  rate_direction: string;
  exchange_rate: number;
}

export default function AdminAssets() {
  const [data, setData] = useState<AssetRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterSp, setFilterSp] = useState('');
  const [filterCurrency, setFilterCurrency] = useState('');
  const [salespersons, setSalespersons] = useState<Salesperson[]>([]);

  // 预估汇率编辑弹窗
  const [rateModalOpen, setRateModalOpen] = useState(false);
  const [rateRow, setRateRow] = useState<AssetRow | null>(null);
  const [rateVal, setRateVal] = useState<number | null>(null);
  const [editInitForeign, setEditInitForeign] = useState<number | null>(null);
  const [editInitCost, setEditInitCost] = useState<number | null>(null);

  // 当月统计
  const [currentMonth, setCurrentMonth] = useState(dayjs().format('YYYY-MM'));
  const curMonthStart = `${currentMonth}-01`;
  const curMonthEnd = dayjs(curMonthStart).endOf('month').format('YYYY-MM-DD');

  useEffect(() => {
    supabase.from('salespersons').select('*').order('name').then(({ data }) => {
      if (data) setSalespersons(data);
    });
  }, []);

  useEffect(() => {
    loadData();
  }, [filterSp, filterCurrency, currentMonth]);

  const loadData = async () => {
    setLoading(true);

    // 加载所有业务相关交易（有 customer_id 的）
    let query = supabase.from('transactions')
      .select('*')
      .eq('is_deleted', false)
      .not('customer_id', 'is', null)
      .order('transaction_date', { ascending: true });

    const { data: txs } = await query;
    if (!txs) { setLoading(false); return; }

    const entries = txs as JournalEntry[];

    // 加载手动设置（预估汇率+期初）
    const { data: overrides } = await supabase.from('asset_override').select('*');
    const overrideMap = new Map<string, any>();
    overrides?.forEach((o: any) => {
      overrideMap.set(`${o.salesperson_id}|${o.currency}`, o);
    });

    // 按业务员+币种分组聚合
    const groups = new Map<string, {
      spId: string; spName: string; currency: string;
      receivedForeign: number; receivedCost: number;
      soldForeign: number; soldProceeds: number;
    }>();

    entries.forEach(e => {
      if (!e.customer_id) return;
      const key = `${e.customer_id ? 'has' : 'no'}`;
      // 用 salesperson 不直接存储，需要通过 customer 关联...
      // 简化: 用 user_id 暂时，实际应通过 customer 获取 salesperson
    });

    // 重新整理：需要先加载 customers 获取 salesperson 信息
    const { data: custData } = await supabase.from('customers').select('id, salesperson_id');
    const custMap = new Map<string, { spId: string; spName: string }>();
    const spNameMap = new Map(salespersons.map(s => [s.id, s.name]));
    custData?.forEach((c: any) => {
      custMap.set(c.id, { spId: c.salesperson_id, spName: spNameMap.get(c.salesperson_id) || '' });
    });

    entries.forEach(e => {
      if (!e.customer_id) return;
      const cust = custMap.get(e.customer_id);
      if (!cust) return;
      const spName = cust.spName;
      const key = `${cust.spId}|${e.currency || (e.type === 'exchange' ? e.from_currency : '')}`;
      const currency = e.type === 'exchange' ? (e.from_currency || '') : (e.currency || '');

      if (!currency) return;

      if (!groups.has(key)) {
        groups.set(key, { spId: cust.spId, spName, currency, receivedForeign: 0, receivedCost: 0, soldForeign: 0, soldProceeds: 0 });
      }
      const g = groups.get(key)!;

      // 收款 = 收到外币（direction 相关逻辑：income 是收，exchange 的 from 是支出外币）
      if (e.type === 'income' && e.amount) {
        g.receivedForeign += e.amount;
        g.receivedCost += e.theoretical_cost || 0;
      } else if (e.type === 'exchange' && e.from_amount) {
        // exchange: from_currency 是付出的外币
        g.soldForeign += e.from_amount;
        g.soldProceeds += e.to_amount || 0;
      }
    });

    const rows: AssetRow[] = [];
    groups.forEach(g => {
      const ov = overrideMap.get(`${g.spId}|${g.currency}`) || {};
      const initF = ov.initial_foreign || 0;
      const initC = ov.initial_cost || 0;

      const totalRcvd = g.receivedForeign + initF;
      const totalCost = g.receivedCost + initC;
      const wac = totalRcvd > 0 ? totalCost / totalRcvd : 0;
      const holding = totalRcvd - g.soldForeign;
      const hCost = holding * wac;
      const estRate = ov.estimated_rate || null;
      const estValue = holding * (estRate || 0);
      const unrealPnl = estValue - hCost;
      const realizedPnl = g.soldProceeds - (g.soldForeign * wac);

      rows.push({
        salesperson_id: g.spId,
        salesperson_name: g.spName,
        currency: g.currency,
        total_received_foreign: totalRcvd,
        total_received_cost: totalCost,
        total_sold_foreign: g.soldForeign,
        total_sold_proceeds: g.soldProceeds,
        weighted_avg_cost: wac,
        current_holding: holding,
        holding_cost: hCost,
        estimated_rate: estRate,
        estimated_value: estValue,
        unrealized_pnl: unrealPnl,
        realized_pnl: realizedPnl,
      });
    });

    let filtered = rows;
    if (filterSp) filtered = filtered.filter(r => r.salesperson_id === filterSp);
    if (filterCurrency) filtered = filtered.filter(r => r.currency === filterCurrency);
    setData(filtered);
    setLoading(false);
  };

  const openRateEdit = async (row: AssetRow) => {
    setRateRow(row);
    setRateVal(row.estimated_rate);
    // 加载当前期初数据
    const { data } = await supabase.from('asset_override').select('*')
      .eq('salesperson_id', row.salesperson_id).eq('currency', row.currency).single();
    setEditInitForeign(data?.initial_foreign || null);
    setEditInitCost(data?.initial_cost || null);
    setRateModalOpen(true);
  };

  const saveRate = async () => {
    if (!rateRow) return;
    await supabase.from('asset_override').upsert({
      salesperson_id: rateRow.salesperson_id,
      currency: rateRow.currency,
      estimated_rate: rateVal,
      initial_foreign: editInitForeign,
      initial_cost: editInitCost,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'salesperson_id,currency' });
    message.success('已保存');
    setRateModalOpen(false);
    loadData();
  };

  const handleExport = () => {
    const headers = ['业务员', '币种', '累计收外币', '加权成本', '当前持仓', '持仓成本', '预估市值', '浮动盈亏', '已实现利润'];
    const rows = data.map(r => [
      r.salesperson_name, r.currency,
      r.total_received_foreign, r.weighted_avg_cost.toFixed(4),
      r.current_holding, r.holding_cost.toFixed(2),
      r.estimated_value.toFixed(2), r.unrealized_pnl.toFixed(2), r.realized_pnl.toFixed(2),
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.map(c => `"${c ?? ''}"`).join(','))].join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `资产总表_${dayjs().format('YYYYMMDD')}.csv`;
    a.click();
    message.success('导出成功');
  };

  const columns = [
    { title: '业务员', dataIndex: 'salesperson_name', key: 'sp', width: 80 },
    {
      title: '币种', dataIndex: 'currency', key: 'cur', width: 70,
      render: (c: string) => <Tag color="blue">{c}</Tag>,
    },
    {
      title: '累计收外币', dataIndex: 'total_received_foreign', key: 'rf', width: 100,
      render: (v: number) => v.toLocaleString(),
    },
    {
      title: '加权成本', dataIndex: 'weighted_avg_cost', key: 'wac', width: 90,
      render: (v: number) => v > 0 ? v.toFixed(4) : '—',
    },
    {
      title: '累计卖外币', dataIndex: 'total_sold_foreign', key: 'sf', width: 100,
      render: (v: number) => v > 0 ? v.toLocaleString() : '0',
    },
    {
      title: '当前持仓', dataIndex: 'current_holding', key: 'hold', width: 100,
      render: (v: number) => <strong>{v.toLocaleString()}</strong>,
    },
    {
      title: '持仓成本(RMB)', dataIndex: 'holding_cost', key: 'hcost', width: 120,
      render: (v: number) => v.toFixed(2),
    },
    {
      title: '预估汇率', key: 'estRate', width: 100,
      render: (_: any, r: AssetRow) => (
        <Space size={4}>
          <span>{r.estimated_rate ? r.estimated_rate.toFixed(4) : '未设置'}</span>
          <Button size="small" type="link" icon={<EditOutlined />} onClick={() => openRateEdit(r)} />
        </Space>
      ),
    },
    {
      title: '预估市值(RMB)', dataIndex: 'estimated_value', key: 'estVal', width: 120,
      render: (v: number) => v > 0 ? v.toFixed(2) : <span style={{ color: '#ccc' }}>设置汇率后计算</span>,
    },
    {
      title: '浮动盈亏', dataIndex: 'unrealized_pnl', key: 'upnl', width: 110,
      render: (v: number) => {
        if (!v) return '—';
        return <span style={{ fontWeight: 600, color: v >= 0 ? '#52c41a' : '#ff4d4f' }}>{v >= 0 ? '+' : ''}{v.toFixed(2)}</span>;
      },
    },
    {
      title: '已实现利润', dataIndex: 'realized_pnl', key: 'rpnl', width: 110,
      render: (v: number) => {
        if (!v) return '—';
        return <span style={{ fontWeight: 600, color: v >= 0 ? '#52c41a' : '#ff4d4f' }}>{v >= 0 ? '+' : ''}{v.toFixed(2)}</span>;
      },
    },
  ];

  const totalUnrealized = data.reduce((s, r) => s + r.unrealized_pnl, 0);
  const totalRealized = data.reduce((s, r) => s + r.realized_pnl, 0);

  // 按币种分组
  const currencyGroups = [...new Set(data.map(r => r.currency))].sort();

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ margin: 0 }}>💰 资产总表</h2>
        <Button icon={<ExportOutlined />} onClick={handleExport}>导出CSV</Button>
      </div>

      {/* 汇总卡片 */}
      <Space wrap style={{ marginBottom: 16 }}>
        <Tag color="green" style={{ padding: '4px 12px', fontSize: 14 }}>
          已实现利润: {totalRealized >= 0 ? '+' : ''}{totalRealized.toFixed(2)}
        </Tag>
        <Tag color="orange" style={{ padding: '4px 12px', fontSize: 14 }}>
          浮动盈亏: {totalUnrealized >= 0 ? '+' : ''}{totalUnrealized.toFixed(2)}
        </Tag>
        <Tag style={{ padding: '4px 12px', fontSize: 14 }}>
          总盈亏: {(totalRealized + totalUnrealized) >= 0 ? '+' : ''}{(totalRealized + totalUnrealized).toFixed(2)}
        </Tag>
      </Space>

      {/* 筛选 */}
      <Space wrap style={{ marginBottom: 16 }}>
        <Select
          placeholder="按业务员" allowClear style={{ width: 120 }}
          value={filterSp || undefined} onChange={(v) => setFilterSp(v || '')}
          options={salespersons.map(s => ({ label: s.name, value: s.id }))}
        />
        <Select
          placeholder="按币种" allowClear style={{ width: 100 }}
          value={filterCurrency || undefined} onChange={(v) => setFilterCurrency(v || '')}
          options={CURRENCIES.filter(Boolean).map(c => ({ label: c, value: c }))}
        />
      </Space>

      {/* 按币种分组展示 */}
      {currencyGroups.map(cur => {
        const curRows = data.filter(r => r.currency === cur);
        if (curRows.length === 0) return null;
        const curRealized = curRows.reduce((s, r) => s + r.realized_pnl, 0);
        const curUnreal = curRows.reduce((s, r) => s + r.unrealized_pnl, 0);
        return (
          <Card
            key={cur}
            title={<span>💱 {cur} 资产</span>}
            size="small"
            style={{ marginBottom: 16 }}
            extra={
              <Space size={8}>
                <Tag color="green">已实现: {curRealized >= 0 ? '+' : ''}{curRealized.toFixed(2)}</Tag>
                <Tag color="orange">浮动: {curUnreal >= 0 ? '+' : ''}{curUnreal.toFixed(2)}</Tag>
              </Space>
            }
          >
            <Table
              columns={columns}
              dataSource={curRows}
              rowKey={(r) => `${r.salesperson_id}|${r.currency}`}
              loading={loading}
              pagination={false}
              size="small"
            />
          </Card>
        );
      })}
      {data.length === 0 && !loading && (
        <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>
          暂无资产数据。请在数据表格中录入带客户信息的业务流水。
        </div>
      )}

      {/* 设置弹窗：期初 + 预估汇率 */}
      <Modal
        title={`${rateRow?.salesperson_name} - ${rateRow?.currency} 设置`}
        open={rateModalOpen}
        onCancel={() => setRateModalOpen(false)}
        onOk={saveRate}
        width={420}
      >
        <h4>七月份之前期初持仓</h4>
        <Space style={{ marginBottom: 16 }}>
          <div>
            <label>期初外币数量</label>
            <InputNumber value={editInitForeign} onChange={(v) => setEditInitForeign(v)} placeholder="如 50000" style={{ width: 140 }} />
          </div>
          <div>
            <label>期初成本(RMB)</label>
            <InputNumber value={editInitCost} onChange={(v) => setEditInitCost(v)} placeholder="如 3500" style={{ width: 140 }} />
          </div>
        </Space>

        <h4>预估汇率</h4>
        <div>
          <label>1 {rateRow?.currency} = ? RMB</label>
          <InputNumber value={rateVal} onChange={(v) => setRateVal(v)} style={{ width: '100%', marginTop: 8 }} placeholder="例如 6.65" step={0.0001} />
        </div>
        {rateVal && rateRow && (
          <div style={{ padding: '8px 12px', marginTop: 12, background: '#f6ffed', borderRadius: 4 }}>
            预估市值 = {rateRow.current_holding.toLocaleString()} × {rateVal} = {' '}
            <strong>{(rateRow.current_holding * rateVal).toFixed(2)} RMB</strong><br />
            浮动盈亏 = {(rateRow.current_holding * rateVal).toFixed(2)} - {rateRow.holding_cost.toFixed(2)} = {' '}
            <strong style={{ color: ((rateRow.current_holding * rateVal) - rateRow.holding_cost) >= 0 ? '#52c41a' : '#ff4d4f' }}>
              {((rateRow.current_holding * rateVal) - rateRow.holding_cost) >= 0 ? '+' : ''}
              {((rateRow.current_holding * rateVal) - rateRow.holding_cost).toFixed(2)}
            </strong>
          </div>
        )}
      </Modal>
    </div>
  );
}
