import { useState, useEffect } from 'react';
import { Table, Card, Statistic, Row, Col } from 'antd';
import { supabase, type AccountBalance, ACCOUNT_TYPES } from '../../lib/supabase';

interface AccountRow extends AccountBalance {
  user_name?: string;
}

export default function AdminAccounts() {
  const [data, setData] = useState<AccountRow[]>([]);
  const [users, setUsers] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.from('users').select('id, name').then(({ data: u }) => {
      if (u) setUsers(u);
    });
    loadBalances();
  }, []);

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

  const currencyTotals: Record<string, number> = {};
  data.forEach(r => {
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
    { title: '名称', dataIndex: 'name', key: 'name', width: 150 },
    { title: '币种', dataIndex: 'currency', key: 'currency', width: 70 },
    { title: '期初余额', dataIndex: 'initial_balance', key: 'init', width: 120, render: (v: number) => v?.toLocaleString() },
    { title: '当前余额', dataIndex: 'current_balance', key: 'balance', width: 130, render: (v: number) => <span style={{ fontWeight: 700, fontSize: 15, color: v < 0 ? '#ff4d4f' : '#1677ff' }}>{v?.toLocaleString()}</span> },
  ];

  return (
    <div>
      <h2>🏦 账户余额总表</h2>
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        {Object.entries(currencyTotals).map(([cur, total]) => (
          <Col xs={12} sm={6} key={cur}>
            <Card size="small"><Statistic title={`${cur} 汇总`} value={total.toLocaleString()} valueStyle={{ color: total < 0 ? '#ff4d4f' : '#1677ff' }} /></Card>
          </Col>
        ))}
      </Row>
      <Table columns={columns} dataSource={data} rowKey="account_id" loading={loading} size="small" pagination={{ pageSize: 50 }} scroll={{ x: 800 }} />
    </div>
  );
}
