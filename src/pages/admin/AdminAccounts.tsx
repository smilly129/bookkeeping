import { useState, useEffect } from 'react';
import { Table, Card, Statistic, Row, Col, Button, Modal, Form, Input, Select, InputNumber, message, Popconfirm, Space, Collapse, Tag } from 'antd';
import { PlusOutlined, DeleteOutlined, EditOutlined, ExportOutlined } from '@ant-design/icons';
import { supabase, type AccountBalance, type Account, type CurrencyAlias, ACCOUNT_TYPES, CURRENCIES } from '../../lib/supabase';

interface AccountRow extends AccountBalance {
  user_name?: string;
}

export default function AdminAccounts() {
  const [data, setData] = useState<AccountRow[]>([]);
  const [users, setUsers] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterUser, setFilterUser] = useState<string | undefined>();

  // 币种别名管理
  const [aliases, setAliases] = useState<CurrencyAlias[]>([]);
  const [newAlias, setNewAlias] = useState({ alias: '', currency: '' });

  // 新增账户
  const [addOpen, setAddOpen] = useState(false);
  const [addLoading, setAddLoading] = useState(false);
  const [newAccount, setNewAccount] = useState({ user_id: '', account_type: '', name: '', currency: '', initial_balance: '0' });

  const handleAddAccount = async () => {
    const a = newAccount;
    if (!a.user_id || !a.account_type || !a.name || !a.currency) { message.error('请填写完整'); return; }
    setAddLoading(true);
    const { error } = await supabase.from('accounts').insert({
      user_id: a.user_id, account_type: a.account_type, name: a.name,
      currency: a.currency, initial_balance: parseFloat(a.initial_balance) || 0,
    });
    setAddLoading(false);
    if (error) { message.error('添加失败: ' + error.message); return; }
    message.success('已添加');
    setAddOpen(false);
    setNewAccount({ user_id: '', account_type: '', name: '', currency: '', initial_balance: '0' });
    loadBalances();
  };

  // 编辑账户
  const [editOpen, setEditOpen] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [editAccount, setEditAccount] = useState<Account | null>(null);

  const handleSaveEdit = async () => {
    if (!editAccount) return;
    setEditLoading(true);
    const { error } = await supabase.from('accounts').update({
      account_type: editAccount.account_type,
      name: editAccount.name,
      currency: editAccount.currency,
      initial_balance: editAccount.initial_balance,
    }).eq('id', editAccount.id);
    setEditLoading(false);
    if (error) { message.error('保存失败: ' + error.message); return; }
    message.success('已保存');
    setEditOpen(false);
    loadBalances();
  };

  // 删除账户
  const handleDeleteAccount = async (id: string) => {
    await supabase.from('accounts').delete().eq('id', id);
    message.success('已删除');
    loadBalances();
  };

  useEffect(() => {
    supabase.from('users').select('id, name').then(({ data: u }) => {
      if (u) setUsers(u);
    });
    loadBalances();
    loadAliases();
  }, []);

  const loadAliases = async () => {
    const { data } = await supabase.from('currency_aliases').select('*').order('created_at', { ascending: false });
    if (data) setAliases(data as CurrencyAlias[]);
  };

  const addAlias = async () => {
    if (!newAlias.alias.trim() || !newAlias.currency) { message.error('请填写别名和币种'); return; }
    const { error } = await supabase.from('currency_aliases').insert({ alias: newAlias.alias.trim(), currency: newAlias.currency });
    if (error) { message.error('添加失败: ' + error.message); return; }
    message.success('别名已添加');
    setNewAlias({ alias: '', currency: '' });
    loadAliases();
  };

  const deleteAlias = async (id: string) => {
    await supabase.from('currency_aliases').delete().eq('id', id);
    message.success('已删除');
    loadAliases();
  };

  const loadBalances = async () => {
    setLoading(true);
    const { data: accounts } = await supabase.from('accounts').select('*');
    if (!accounts) { setLoading(false); return; }

    const rows: AccountRow[] = [];
    for (const acc of accounts) {
      const { data: income } = await supabase.from('transactions').select('amount').eq('to_account_id', acc.id).eq('is_deleted', false);
      const totalIn = income?.reduce((s, t) => s + (Number(t.amount) || 0), 0) || 0;
      const { data: expense } = await supabase.from('transactions').select('amount').eq('from_account_id', acc.id).eq('is_deleted', false);
      const totalOut = expense?.reduce((s, t) => s + (Number(t.amount) || 0), 0) || 0;
      const { data: exIn } = await supabase.from('transactions').select('to_amount').eq('to_account_id', acc.id).eq('type', 'exchange').eq('is_deleted', false);
      const totalExIn = exIn?.reduce((s, t) => s + (Number(t.to_amount) || 0), 0) || 0;
      const { data: exOut } = await supabase.from('transactions').select('from_amount').eq('from_account_id', acc.id).eq('type', 'exchange').eq('is_deleted', false);
      const totalExOut = exOut?.reduce((s, t) => s + (Number(t.from_amount) || 0), 0) || 0;
      const balance = (Number(acc.initial_balance) || 0) + totalIn - totalOut + totalExIn - totalExOut;

      rows.push({
        account_id: acc.id, user_id: acc.user_id,
        account_type: acc.account_type, name: acc.name,
        currency: acc.currency, initial_balance: Number(acc.initial_balance) || 0,
        current_balance: balance,
      });
    }

    const userMap = new Map(users.map(u => [u.id, u.name]));
    setData(rows.map(r => ({ ...r, user_name: userMap.get(r.user_id) || r.user_id })));
    setLoading(false);
  };

  useEffect(() => {
    if (users.length > 0 && data.length > 0) {
      const userMap = new Map(users.map(u => [u.id, u.name]));
      setData(prev => prev.map(r => ({ ...r, user_name: userMap.get(r.user_id) || r.user_id })));
    }
  }, [users]);

  const filteredData = filterUser ? data.filter(r => r.user_id === filterUser) : data;

  const handleExport = () => {
    const headers = ['姓名', '类型', '名称', '币种', '期初余额', '当前余额'];
    const rows = filteredData.map(r => [
      r.user_name, ACCOUNT_TYPES.find(t => t.value === r.account_type)?.label || r.account_type,
      r.name, r.currency, r.initial_balance, r.current_balance,
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.map(c => `"${c ?? ''}"`).join(','))].join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `账户总表_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    message.success('导出成功');
  };

  const currencyTotals: Record<string, number> = {};
  filteredData.forEach(r => {
    if (!currencyTotals[r.currency]) currencyTotals[r.currency] = 0;
    currencyTotals[r.currency] += r.current_balance;
  });

  const columns = [
    {
      title: '姓名', dataIndex: 'user_name', key: 'user', width: 80,
      filters: users.map(u => ({ text: u.name, value: u.name })),
      onFilter: (v: any, r: AccountRow) => r.user_name === v,
    },
    {
      title: '类型', dataIndex: 'account_type', key: 'type', width: 110,
      render: (t: string) => {
        const info = ACCOUNT_TYPES.find(a => a.value === t);
        return `${info?.icon || ''} ${info?.label || t}`;
      },
    },
    { title: '名称', dataIndex: 'name', key: 'name', width: 110, ellipsis: true },
    { title: '币种', dataIndex: 'currency', key: 'currency', width: 60 },
    { title: '期初余额', dataIndex: 'initial_balance', key: 'init', width: 120, render: (v: number) => v?.toLocaleString() },
    { title: '当前余额', dataIndex: 'current_balance', key: 'balance', width: 130, render: (v: number) => <span style={{ fontWeight: 700, fontSize: 15, color: v < 0 ? '#ff4d4f' : '#1677ff' }}>{v?.toLocaleString()}</span> },
    {
      title: '操作', key: 'actions', width: 140, fixed: 'right' as const,
      render: (_: any, r: AccountRow) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => {
            setEditAccount({
              id: r.account_id, user_id: r.user_id,
              account_type: r.account_type, name: r.name,
              currency: r.currency, initial_balance: r.initial_balance,
              created_at: '',
            } as Account);
            setEditOpen(true);
          }} />
          <Popconfirm title="确定删除此账户?" onConfirm={() => handleDeleteAccount(r.account_id)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>🏦 账户余额总表</h2>
        <Space>
          <Select
            placeholder="按人筛选" allowClear style={{ width: 120 }}
            value={filterUser}
            onChange={setFilterUser}
            options={users.map(u => ({ label: u.name, value: u.id }))}
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setAddOpen(true)}>新增账户</Button>
          <Button icon={<ExportOutlined />} onClick={handleExport}>导出</Button>
        </Space>
      </div>
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        {Object.entries(currencyTotals).map(([cur, total]) => (
          <Col xs={12} sm={6} key={cur}>
            <Card size="small"><Statistic title={`${cur} 汇总`} value={total.toLocaleString()} valueStyle={{ color: total < 0 ? '#ff4d4f' : '#1677ff' }} /></Card>
          </Col>
        ))}
      </Row>
      <Table columns={columns} dataSource={filteredData} rowKey="account_id" loading={loading} size="small" pagination={{ pageSize: 50 }} scroll={{ x: 900 }} />

      {/* 币种别名管理 */}
      <Collapse ghost style={{ marginTop: 24 }} items={[{
        key: 'alias',
        label: <span style={{ color: '#1677ff' }}>🏷️ 币种别名管理（用于快速录入）</span>,
        children: (
          <div>
            {/* 内置映射 */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>内置别名</div>
              <Space wrap>
                {['卢布/卢→RUB', '美金/美元→USD', '欧元→EUR', 'USDT/U→USDT', '人民币/元→RMB', '英镑→GBP', '日元→JPY', '韩元→KRW'].map(m => (
                  <Tag key={m} style={{ marginBottom: 4 }}>{m}</Tag>
                ))}
              </Space>
            </div>

            {/* 自定义别名 */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>自定义别名</div>
              {aliases.length === 0 ? (
                <div style={{ color: '#999', fontSize: 13, marginBottom: 8 }}>暂无自定义别名</div>
              ) : (
                <Space wrap style={{ marginBottom: 8 }}>
                  {aliases.map(a => (
                    <Tag key={a.id} closable onClose={() => deleteAlias(a.id)} color="blue">
                      {a.alias} → {a.currency}
                    </Tag>
                  ))}
                </Space>
              )}
            </div>

            {/* 新增别名 */}
            <Space>
              <Input
                size="small"
                placeholder="别名（如 U, 刀）"
                value={newAlias.alias}
                onChange={(e) => setNewAlias({ ...newAlias, alias: e.target.value })}
                style={{ width: 140 }}
              />
              <Select
                size="small"
                placeholder="对应币种"
                value={newAlias.currency || undefined}
                onChange={(v) => setNewAlias({ ...newAlias, currency: v || '' })}
                options={CURRENCIES.filter(Boolean).map(c => ({ label: c, value: c }))}
                style={{ width: 100 }}
              />
              <Button size="small" type="primary" onClick={addAlias}>添加</Button>
            </Space>
          </div>
        ),
      }]} />

      <Modal title="新增账户" open={addOpen} onCancel={() => setAddOpen(false)} onOk={handleAddAccount} confirmLoading={addLoading}>
        <Form layout="vertical">
          <Form.Item label="用户" required>
            <Select value={newAccount.user_id || undefined} onChange={(v) => setNewAccount({ ...newAccount, user_id: v })}
              options={users.map(u => ({ label: u.name, value: u.id }))} placeholder="选择用户" />
          </Form.Item>
          <Form.Item label="账户类型" required>
            <Select value={newAccount.account_type || undefined} onChange={(v) => setNewAccount({ ...newAccount, account_type: v })}
              options={ACCOUNT_TYPES.map(t => ({ label: `${t.icon} ${t.label}`, value: t.value }))} />
          </Form.Item>
          <Form.Item label="账户名称" required>
            <Input value={newAccount.name} onChange={(e) => setNewAccount({ ...newAccount, name: e.target.value })} placeholder="如: 招行储蓄卡" />
          </Form.Item>
          <Form.Item label="币种" required>
            <Select value={newAccount.currency || undefined} onChange={(v) => setNewAccount({ ...newAccount, currency: v })}
              options={CURRENCIES.filter(Boolean).map(c => ({ label: c, value: c }))} />
          </Form.Item>
          <Form.Item label="期初余额">
            <InputNumber value={parseFloat(newAccount.initial_balance) || 0} onChange={(v) => setNewAccount({ ...newAccount, initial_balance: String(v || 0) })} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title="编辑账户" open={editOpen} onCancel={() => setEditOpen(false)} onOk={handleSaveEdit} confirmLoading={editLoading}>
        {editAccount && (
          <Form layout="vertical">
            <Form.Item label="账户类型">
              <Select value={editAccount.account_type} onChange={(v) => setEditAccount({ ...editAccount, account_type: v })}
                options={ACCOUNT_TYPES.map(t => ({ label: `${t.icon} ${t.label}`, value: t.value }))} />
            </Form.Item>
            <Form.Item label="账户名称">
              <Input value={editAccount.name} onChange={(e) => setEditAccount({ ...editAccount, name: e.target.value })} />
            </Form.Item>
            <Form.Item label="币种">
              <Select value={editAccount.currency} onChange={(v) => setEditAccount({ ...editAccount, currency: v })}
                options={CURRENCIES.filter(Boolean).map(c => ({ label: c, value: c }))} />
            </Form.Item>
            <Form.Item label="期初余额">
              <InputNumber value={editAccount.initial_balance} onChange={(v) => setEditAccount({ ...editAccount, initial_balance: v || 0 })} style={{ width: '100%' }} />
            </Form.Item>
          </Form>
        )}
      </Modal>
    </div>
  );
}
