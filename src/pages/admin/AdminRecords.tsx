import { useState, useEffect, useCallback } from 'react';
import {
  Table, Button, Input, Select, DatePicker, Space, Tag, Modal,
  Form, InputNumber, message, Popconfirm, Image,
} from 'antd';
import { SearchOutlined, ExportOutlined, DeleteOutlined, EditOutlined } from '@ant-design/icons';
import { supabase, type Transaction, CURRENCIES } from '../../lib/supabase';
import dayjs from 'dayjs';

interface TxRow extends Transaction {
  user_name?: string;
  from_account_name?: string;
  to_account_name?: string;
}

export default function AdminRecords() {
  const [data, setData] = useState<TxRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingRow, setEditingRow] = useState<TxRow | null>(null);
  const [editModalOpen, setEditModalOpen] = useState(false);

  // 筛选
  const [filterUser, setFilterUser] = useState('');
  const [filterType, setFilterType] = useState<string | undefined>();
  const [filterCurrency, setFilterCurrency] = useState('');
  const [filterDateRange, setFilterDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs]>([
    dayjs().subtract(30, 'day'), dayjs(),
  ]);
  const [users, setUsers] = useState<{ id: string; name: string }[]>([]);

  // 加载用户列表
  useEffect(() => {
    supabase.from('users').select('id, name').then(({ data }) => {
      if (data) setUsers(data);
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

    const { data: txData } = await query;
    if (txData) {
      // 关联用户名称
      const userIds = [...new Set(txData.map(t => t.user_id))];
      const { data: userData } = await supabase.from('users').select('id, name').in('id', userIds);
      const userMap = new Map(userData?.map(u => [u.id, u.name]) || []);

      const rows: TxRow[] = txData.map(t => ({
        ...t,
        user_name: userMap.get(t.user_id) || t.user_id,
        from_account_name: (t as any).from_acc?.name,
        to_account_name: (t as any).to_acc?.name,
      }));

      if (filterUser) {
        setData(rows.filter(r => r.user_id === filterUser));
      } else {
        setData(rows);
      }
    }
    setLoading(false);
  }, [filterType, filterCurrency, filterDateRange, filterUser]);

  useEffect(() => { loadData(); }, [loadData]);

  // 编辑保存
  const handleSaveEdit = async () => {
    if (!editingRow) return;
    const { error } = await supabase.from('transactions').update({
      type: editingRow.type,
      direction: editingRow.direction,
      currency: editingRow.currency,
      amount: editingRow.amount,
      from_currency: editingRow.from_currency,
      to_currency: editingRow.to_currency,
      from_amount: editingRow.from_amount,
      to_amount: editingRow.to_amount,
      exchange_rate: editingRow.exchange_rate,
      from_account_id: editingRow.from_account_id,
      to_account_id: editingRow.to_account_id,
      notes: editingRow.notes,
      transaction_date: editingRow.transaction_date,
      updated_at: new Date().toISOString(),
    }).eq('id', editingRow.id);

    if (error) {
      message.error('保存失败');
    } else {
      message.success('已保存');
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

  const typeOptions = [
    { value: 'expense', label: '💸 付款' },
    { value: 'income', label: '💰 收款' },
    { value: 'exchange', label: '🔄 换汇' },
    { value: 'transfer', label: '📤 转款' },
  ];

  const columns = [
    { title: '日期', dataIndex: 'transaction_date', key: 'date', width: 100, sorter: (a: TxRow, b: TxRow) => a.transaction_date.localeCompare(b.transaction_date) },
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
      title: '操作', key: 'actions', width: 100, fixed: 'right' as const,
      render: (_: any, record: TxRow) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => { setEditingRow({ ...record }); setEditModalOpen(true); }} />
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
        <Button icon={<ExportOutlined />} onClick={handleExport}>导出CSV</Button>
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
                options={[
                  { label: '国内', value: 'domestic' }, { label: '国外', value: 'international' },
                  { label: '出境(国内→国外)', value: 'outbound' }, { label: '入境(国外→国内)', value: 'inbound' },
                ]}
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
            <Form.Item label="备注">
              <Input.TextArea value={editingRow.notes || ''} onChange={(e) => setEditingRow({ ...editingRow, notes: e.target.value })} rows={2} />
            </Form.Item>
          </Form>
        )}
      </Modal>
    </div>
  );
}
