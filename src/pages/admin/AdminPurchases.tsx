import { useState, useEffect } from 'react';
import {
  Table, Button, Select, Space, Tag, Modal, Form, InputNumber, Input, message, Popconfirm,
} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, ExportOutlined } from '@ant-design/icons';
import { supabase, type Customer, type Salesperson, type PurchaseSummary, CURRENCIES, PURCHASE_STATUSES } from '../../lib/supabase';
import dayjs from 'dayjs';

export default function AdminPurchases() {
  const [data, setData] = useState<PurchaseSummary[]>([]);
  const [loading, setLoading] = useState(false);

  // 筛选
  const [filterSp, setFilterSp] = useState('');
  const [filterCust, setFilterCust] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  // 基础数据
  const [salespersons, setSalespersons] = useState<Salesperson[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [custBySp, setCustBySp] = useState<Customer[]>([]);

  // 弹窗
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<PurchaseSummary | null>(null);
  const [form, setForm] = useState({ customer_id: '', customer_code: '', currency: '', quoted_price: '', actual_cost: '', status: 'in_progress', notes: '' });

  useEffect(() => {
    loadLookups();
  }, []);

  useEffect(() => {
    loadData();
  }, [filterSp, filterCust, filterStatus]);

  const loadLookups = async () => {
    const [spRes, custRes] = await Promise.all([
      supabase.from('salespersons').select('*').order('name'),
      supabase.from('customers').select('*').order('code'),
    ]);
    if (spRes.data) setSalespersons(spRes.data);
    if (custRes.data) setCustomers(custRes.data);
  };

  const loadData = async () => {
    setLoading(true);
    const { data: raw } = await supabase.from('purchase_summary').select('*').order('created_at', { ascending: false });
    if (raw) {
      let rows = raw as PurchaseSummary[];
      if (filterSp) rows = rows.filter(r => r.salesperson_id === filterSp);
      if (filterCust) rows = rows.filter(r => r.customer_id === filterCust);
      if (filterStatus) rows = rows.filter(r => r.status === filterStatus);
      setData(rows);
    }
    setLoading(false);
  };

  const openAdd = () => {
    setEditingRow(null);
    setForm({ customer_id: '', customer_code: '', currency: '', quoted_price: '', actual_cost: '', status: 'in_progress', notes: '' });
    setModalOpen(true);
  };

  const openEdit = (r: PurchaseSummary) => {
    setEditingRow(r);
    setForm({
      customer_id: r.customer_id,
      customer_code: r.customer_code || '',
      currency: r.currency,
      quoted_price: r.quoted_price != null ? String(r.quoted_price) : '',
      actual_cost: r.actual_cost != null ? String(r.actual_cost) : '',
      status: r.status,
      notes: r.notes || '',
    });
    setModalOpen(true);
  };

  const save = async () => {
    const code = form.customer_code.trim().toUpperCase();
    if (!code) { message.error('请输入客户代号'); return; }
    if (!form.currency) { message.error('请选择币种'); return; }

    // 查找或自动创建客户
    let custId = form.customer_id;
    const found = customers.find(c => c.code.toUpperCase() === code);
    if (found) {
      custId = found.id;
    }
    if (!custId || custId !== found?.id) {
      if (!found) {
        // 自动创建
        const spId = salespersons[0]?.id || '';
        const { data: newCust } = await supabase.from('customers').insert({
          code,
          salesperson_id: spId || null,
        }).select('id').single();
        if (newCust) {
          custId = newCust.id;
          // 刷新客户列表
          loadLookups();
        }
      } else {
        custId = found.id;
      }
    }

    const cust = customers.find(c => c.id === custId) || found;
    const payload: any = {
      customer_id: custId,
      salesperson_id: cust?.salesperson_id || salespersons[0]?.id || '',
      currency: form.currency,
      quoted_price: form.quoted_price ? parseFloat(form.quoted_price) : null,
      actual_cost: form.actual_cost ? parseFloat(form.actual_cost) : null,
      status: form.status,
      notes: form.notes || null,
      user_id: (editingRow?.user_id) || (salespersons[0]?.id || ''),
    };
    if (editingRow) {
      payload.updated_at = new Date().toISOString();
      await supabase.from('purchases').update(payload).eq('id', editingRow.id);
      message.success('已更新');
    } else {
      await supabase.from('purchases').insert(payload);
      message.success('已添加');
    }
    setModalOpen(false);
    loadData();
  };

  const deleteRow = async (id: string) => {
    await supabase.from('purchases').delete().eq('id', id);
    message.success('已删除');
    loadData();
  };

  const handleExport = () => {
    const headers = ['客户代号', '业务员', '币种', '报价', '实际支出', '已收款', '待补款', '利润', '状态', '备注'];
    const rows = data.map(r => [
      r.customer_code, r.salesperson_name, r.currency, r.quoted_price, r.actual_cost,
      r.total_received, r.shortfall, r.profit,
      r.status === 'in_progress' ? '进行中' : '已完成', r.notes || '',
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.map(c => `"${c ?? ''}"`).join(','))].join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `采购管理_${dayjs().format('YYYYMMDD')}.csv`;
    a.click();
    message.success('导出成功');
  };

  const columns = [
    {
      title: '客户代号', dataIndex: 'customer_code', key: 'customer', width: 110,
      render: (c: string) => <Tag color="blue" style={{ fontWeight: 600 }}>{c}</Tag>,
    },
    { title: '业务员', dataIndex: 'salesperson_name', key: 'sp', width: 80 },
    { title: '币种', dataIndex: 'currency', key: 'currency', width: 60 },
    {
      title: '报价', dataIndex: 'quoted_price', key: 'price', width: 90,
      render: (v: number) => v != null ? v.toLocaleString() : '—',
    },
    {
      title: '实际支出', dataIndex: 'actual_cost', key: 'cost', width: 90,
      render: (v: number) => v != null ? v.toLocaleString() : '—',
    },
    {
      title: '已收款', dataIndex: 'total_received', key: 'received', width: 90,
      render: (v: number) => v != null ? <span style={{ color: '#52c41a' }}>{v.toLocaleString()}</span> : '—',
    },
    {
      title: '待补款', dataIndex: 'shortfall', key: 'shortfall', width: 100,
      render: (v: number) => {
        if (v > 0) return <Tag color="error">⚠️ 差 {v.toLocaleString()}</Tag>;
        if (v <= 0 && v != null) return <Tag color="success">✓ 已收齐</Tag>;
        return '—';
      },
    },
    {
      title: '采购利润', dataIndex: 'profit', key: 'profit', width: 100,
      render: (v: number) => {
        if (v == null) return '—';
        return <span style={{ fontWeight: 600, color: v >= 0 ? '#52c41a' : '#ff4d4f' }}>{v >= 0 ? '+' : ''}{v.toLocaleString()}</span>;
      },
    },
    {
      title: '状态', dataIndex: 'status', key: 'status', width: 80,
      render: (s: string) => s === 'completed' ? <Tag color="green">已完成</Tag> : <Tag color="blue">进行中</Tag>,
    },
    { title: '备注', dataIndex: 'notes', key: 'notes', width: 150, ellipsis: true, render: (v: string) => v || '—' },
    {
      title: '操作', key: 'actions', width: 100, fixed: 'right' as const,
      render: (_: any, r: PurchaseSummary) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)} />
          <Popconfirm title="确定删除?" onConfirm={() => deleteRow(r.id)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  // 统计
  const totalProfit = data.reduce((s, r) => s + (r.profit || 0), 0);
  const pendingShortfall = data.filter(r => r.shortfall > 0).length;
  const totalShortfall = data.reduce((s, r) => s + Math.max(0, r.shortfall), 0);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ margin: 0 }}>🛒 采购管理</h2>
        <Space>
          <Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>新增采购</Button>
          <Button icon={<ExportOutlined />} onClick={handleExport}>导出CSV</Button>
        </Space>
      </div>

      {/* 统计卡片 */}
      <Space wrap style={{ marginBottom: 16 }}>
        <Tag color="blue" style={{ padding: '4px 12px', fontSize: 14 }}>采购利润: {totalProfit >= 0 ? '+' : ''}{totalProfit.toLocaleString()}</Tag>
        <Tag color="red" style={{ padding: '4px 12px', fontSize: 14 }}>待补款 {pendingShortfall} 笔，共 {totalShortfall.toLocaleString()}</Tag>
        <Tag style={{ padding: '4px 12px', fontSize: 14 }}>共 {data.length} 笔采购</Tag>
      </Space>

      {/* 筛选 */}
      <Space wrap style={{ marginBottom: 16 }}>
        <Select
          placeholder="按业务员" allowClear style={{ width: 120 }}
          value={filterSp || undefined} onChange={(v) => { setFilterSp(v || ''); setCustBySp(v ? customers.filter(c => c.salesperson_id === v) : []); }}
          options={salespersons.map(s => ({ label: s.name, value: s.id }))}
        />
        <Select
          placeholder="按客户" allowClear style={{ width: 140 }}
          value={filterCust || undefined} onChange={(v) => setFilterCust(v || '')}
          options={(filterSp ? custBySp : customers).map(c => ({ label: c.code, value: c.id }))}
          showSearch
          filterOption={(input, option) => (option?.label as string)?.toLowerCase().includes(input.toLowerCase())}
        />
        <Select
          placeholder="按状态" allowClear style={{ width: 110 }}
          value={filterStatus || undefined} onChange={(v) => setFilterStatus(v || '')}
          options={PURCHASE_STATUSES.map(s => ({ label: s.label, value: s.value }))}
        />
      </Space>

      <Table
        columns={columns}
        dataSource={data}
        rowKey="id"
        loading={loading}
        scroll={{ x: 1100 }}
        pagination={{ pageSize: 30, showTotal: (t) => `共 ${t} 笔` }}
        size="small"
      />

      {/* 新增/编辑弹窗 */}
      <Modal
        title={editingRow ? '编辑采购' : '新增采购'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={save}
        destroyOnClose
        width={500}
      >
        <Form layout="vertical">
          <Form.Item label="客户代号" required>
            <Input
              value={form.customer_code}
              onChange={(e) => {
                const code = e.target.value.toUpperCase();
                const found = customers.find(c => c.code.toUpperCase() === code);
                setForm({ ...form, customer_code: e.target.value, customer_id: found?.id || '' });
              }}
              placeholder="直接输入客户代号"
              style={{ fontFamily: 'monospace' }}
            />
            {form.customer_code && !customers.find(c => c.code.toUpperCase() === form.customer_code.toUpperCase()) && (
              <div style={{ fontSize: 11, color: '#fa8c16', marginTop: 2 }}>新客户，保存时自动创建</div>
            )}
            {form.customer_code && customers.find(c => c.code.toUpperCase() === form.customer_code.toUpperCase()) && (
              <div style={{ fontSize: 11, color: '#52c41a', marginTop: 2 }}>✅ 已匹配</div>
            )}
          </Form.Item>
          <Form.Item label="币种" required>
            <Select
              value={form.currency || undefined}
              onChange={(v) => setForm({ ...form, currency: v || '' })}
              options={CURRENCIES.filter(Boolean).map(c => ({ label: c, value: c }))}
              placeholder="选择币种"
            />
          </Form.Item>
          <Space>
            <Form.Item label="采购报价">
              <InputNumber value={form.quoted_price ? parseFloat(form.quoted_price) : undefined}
                onChange={(v) => setForm({ ...form, quoted_price: v != null ? String(v) : '' })}
                placeholder="对客户的报价" style={{ width: 160 }} />
            </Form.Item>
            <Form.Item label="实际支出">
              <InputNumber value={form.actual_cost ? parseFloat(form.actual_cost) : undefined}
                onChange={(v) => setForm({ ...form, actual_cost: v != null ? String(v) : '' })}
                placeholder="实际花费" style={{ width: 160 }} />
            </Form.Item>
          </Space>
          <Form.Item label="状态">
            <Select
              value={form.status}
              onChange={(v) => setForm({ ...form, status: v })}
              options={PURCHASE_STATUSES.map(s => ({ label: s.label, value: s.value }))}
            />
          </Form.Item>
          <Form.Item label="备注">
            <Input.TextArea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
          </Form.Item>
          {/* 预览利润 */}
          {form.quoted_price && form.actual_cost && (
            <div style={{ padding: 8, background: '#f6ffed', borderRadius: 4, marginBottom: 12 }}>
              采购利润 = {parseFloat(form.quoted_price).toLocaleString()} - {parseFloat(form.actual_cost).toLocaleString()} = {' '}
              <strong style={{ color: (parseFloat(form.quoted_price) - parseFloat(form.actual_cost)) >= 0 ? '#52c41a' : '#ff4d4f' }}>
                {(parseFloat(form.quoted_price) - parseFloat(form.actual_cost)).toLocaleString()}
              </strong>
            </div>
          )}
        </Form>
      </Modal>
    </div>
  );
}
