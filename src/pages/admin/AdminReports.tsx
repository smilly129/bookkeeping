import { useState, useEffect } from 'react';
import { Table, Card, Button, DatePicker } from 'antd';
import { ExportOutlined } from '@ant-design/icons';
import { supabase, type Transaction } from '../../lib/supabase';
import dayjs from 'dayjs';

interface UserSummary {
  user_name: string;
  expense: number;
  income: number;
  exchange: number;
  transfer: number;
  net: number;
}

export default function AdminReports() {
  const [yearMonth, setYearMonth] = useState(dayjs());
  const [users, setUsers] = useState<{ id: string; name: string }[]>([]);
  const [userSummary, setUserSummary] = useState<UserSummary[]>([]);
  const [currencySummary, setCurrencySummary] = useState<Record<string, { inflow: number; outflow: number }>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.from('users').select('id, name').then(({ data }) => {
      if (data) setUsers(data);
    });
  }, []);

  useEffect(() => {
    loadReport();
  }, [yearMonth]);

  const loadReport = async () => {
    setLoading(true);
    const start = yearMonth.startOf('month').format('YYYY-MM-DD');
    const end = yearMonth.endOf('month').format('YYYY-MM-DD');
    const userMap = new Map(users.map(u => [u.id, u.name]));

    // 获取本月所有交易（包括已删除的？不包括）
    const { data: txData } = await supabase
      .from('transactions')
      .select('*')
      .eq('is_deleted', false)
      .gte('transaction_date', start)
      .lte('transaction_date', end);

    if (!txData) { setLoading(false); return; }

    // 用户维度汇总
    const userStats: Record<string, UserSummary> = {};
    const curStats: Record<string, { inflow: number; outflow: number }> = {};

    txData.forEach((t: Transaction) => {
      const name = userMap.get(t.user_id) || t.user_id;
      if (!userStats[name]) userStats[name] = { user_name: name, expense: 0, income: 0, exchange: 0, transfer: 0, net: 0 };

      const c = t.currency || t.from_currency || t.to_currency;
      if (c && !curStats[c]) curStats[c] = { inflow: 0, outflow: 0 };

      switch (t.type) {
        case 'expense':
          userStats[name].expense += Number(t.amount) || 0;
          if (t.currency) curStats[t.currency].outflow += Number(t.amount) || 0;
          break;
        case 'income':
          userStats[name].income += Number(t.amount) || 0;
          if (t.currency) curStats[t.currency].inflow += Number(t.amount) || 0;
          break;
        case 'exchange':
          userStats[name].exchange += Number(t.from_amount) || 0;
          if (t.from_currency) curStats[t.from_currency].outflow += Number(t.from_amount) || 0;
          if (t.to_currency) curStats[t.to_currency].inflow += Number(t.to_amount) || 0;
          break;
        case 'transfer':
          userStats[name].transfer += Number(t.amount) || 0;
          break;
      }
    });

    // 计算净额
    Object.values(userStats).forEach(s => {
      s.net = s.income - s.expense;
    });

    setUserSummary(Object.values(userStats));
    setCurrencySummary(curStats);
    setLoading(false);
  };

  const handleExport = () => {
    const headers = ['姓名', '收入', '支出', '换汇', '转款', '净额'];
    const rows = userSummary.map(s => [s.user_name, s.income, s.expense, s.exchange, s.transfer, s.net]);
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `月报_${yearMonth.format('YYYYMM')}.csv`;
    a.click();
  };

  const userCols = [
    { title: '姓名', dataIndex: 'user_name', key: 'name' },
    { title: '收入', dataIndex: 'income', key: 'income', render: (v: number) => v?.toLocaleString() },
    { title: '支出', dataIndex: 'expense', key: 'expense', render: (v: number) => v?.toLocaleString() },
    { title: '换汇', dataIndex: 'exchange', key: 'exchange', render: (v: number) => v?.toLocaleString() },
    { title: '转款', dataIndex: 'transfer', key: 'transfer', render: (v: number) => v?.toLocaleString() },
    {
      title: '净额', dataIndex: 'net', key: 'net',
      render: (v: number) => (
        <span style={{ fontWeight: 600, color: v >= 0 ? '#52c41a' : '#ff4d4f' }}>
          {v >= 0 ? '+' : ''}{v?.toLocaleString()}
        </span>
      ),
    },
  ];

  const curCols = [
    { title: '币种', dataIndex: 'currency', key: 'currency' },
    { title: '流入', dataIndex: 'inflow', key: 'inflow', render: (v: number) => v?.toLocaleString() },
    { title: '流出', dataIndex: 'outflow', key: 'outflow', render: (v: number) => v?.toLocaleString() },
    {
      title: '净额', key: 'net',
      render: (_: any, r: { currency: string; inflow: number; outflow: number }) => (
        <span style={{ fontWeight: 600, color: r.inflow - r.outflow >= 0 ? '#52c41a' : '#ff4d4f' }}>
          {r.inflow - r.outflow >= 0 ? '+' : ''}{(r.inflow - r.outflow).toLocaleString()}
        </span>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>📊 汇总报表</h2>
        <Button icon={<ExportOutlined />} onClick={handleExport}>导出月报</Button>
      </div>

      <div style={{ marginBottom: 24 }}>
        <DatePicker
          picker="month"
          value={yearMonth}
          onChange={(d) => { if (d) setYearMonth(d); }}
          allowClear={false}
        />
      </div>

      {/* 按用户汇总 */}
      <Card title={`按人汇总 — ${yearMonth.format('YYYY年M月')}`} style={{ marginBottom: 24 }}>
        <Table
          columns={userCols}
          dataSource={userSummary}
          rowKey="user_name"
          size="small"
          loading={loading}
          pagination={false}
          summary={() => {
            const totalIncome = userSummary.reduce((s, r) => s + r.income, 0);
            const totalExpense = userSummary.reduce((s, r) => s + r.expense, 0);
            return (
              <Table.Summary.Row>
                <Table.Summary.Cell index={0}><strong>合计</strong></Table.Summary.Cell>
                <Table.Summary.Cell index={1}><strong>{totalIncome.toLocaleString()}</strong></Table.Summary.Cell>
                <Table.Summary.Cell index={2}><strong>{totalExpense.toLocaleString()}</strong></Table.Summary.Cell>
                <Table.Summary.Cell index={3} colSpan={2} />
                <Table.Summary.Cell index={5}><strong style={{ color: totalIncome - totalExpense >= 0 ? '#52c41a' : '#ff4d4f' }}>{totalIncome - totalExpense >= 0 ? '+' : ''}{(totalIncome - totalExpense).toLocaleString()}</strong></Table.Summary.Cell>
              </Table.Summary.Row>
            );
          }}
        />
      </Card>

      {/* 按币种汇总 */}
      <Card title="按币种汇总">
        <Table
          columns={curCols}
          dataSource={Object.entries(currencySummary).map(([currency, s]) => ({ currency, ...s }))}
          rowKey="currency"
          size="small"
          loading={loading}
          pagination={false}
        />
      </Card>
    </div>
  );
}
