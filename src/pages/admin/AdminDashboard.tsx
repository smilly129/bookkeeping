import { useState, useEffect } from 'react';
import { Card, Statistic, Row, Col, Tag, Table, Typography } from 'antd';
import { ArrowUpOutlined, ArrowDownOutlined, WarningOutlined } from '@ant-design/icons';
import { supabase, type Transaction } from '../../lib/supabase';
import dayjs from 'dayjs';

const { Text } = Typography;

export default function AdminDashboard() {
  const [stats, setStats] = useState<Record<string, { income: number; expense: number }>>({});
  const [recentTx, setRecentTx] = useState<Transaction[]>([]);
  const [mismatchCount, setMismatchCount] = useState(0);
  const [totalUsers, setTotalUsers] = useState(0);
  const [totalRecords, setTotalRecords] = useState(0);

  useEffect(() => {
    loadDashboard();
  }, []);

  const loadDashboard = async () => {
    // 本月交易
    const startOfMonth = dayjs().startOf('month').format('YYYY-MM-DD');
    const today = dayjs().format('YYYY-MM-DD');

    const { data: txData } = await supabase
      .from('transactions')
      .select('*')
      .eq('is_deleted', false)
      .gte('transaction_date', startOfMonth)
      .lte('transaction_date', today);

    // 按币种统计
    const currencyStats: Record<string, { income: number; expense: number }> = {};
    if (txData) {
      txData.forEach((t: Transaction) => {
        const c = t.currency || t.from_currency || t.to_currency;
        if (!c) return;
        if (!currencyStats[c]) currencyStats[c] = { income: 0, expense: 0 };
        if (t.type === 'income') currencyStats[c].income += Number(t.amount) || 0;
        if (t.type === 'expense') currencyStats[c].expense += Number(t.amount) || 0;
      });
    }
    setStats(currencyStats);

    // 最近记录
    const { data: recent } = await supabase
      .from('transactions')
      .select('*, users!transactions_user_id_fkey(name)')
      .eq('is_deleted', false)
      .order('created_at', { ascending: false })
      .limit(10);
    if (recent) setRecentTx(recent as any);

    // 对账差异数
    const { count } = await supabase
      .from('reconciliations')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'mismatch');
    setMismatchCount(count || 0);

    // 用户数和记录数
    const { count: uc } = await supabase.from('users').select('*', { count: 'exact', head: true });
    setTotalUsers(uc || 0);
    const { count: tc } = await supabase.from('transactions').select('*', { count: 'exact', head: true }).eq('is_deleted', false);
    setTotalRecords(tc || 0);
  };

  return (
    <div>
      <h2>📊 总览仪表盘</h2>

      {/* 统计卡片 */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={12} sm={6}>
          <Card><Statistic title="用户数" value={totalUsers} /></Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card><Statistic title="本月记录" value={totalRecords} /></Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card>
            <Statistic
              title="待处理差异"
              value={mismatchCount}
              valueStyle={{ color: mismatchCount > 0 ? '#ff4d4f' : '#52c41a' }}
              prefix={mismatchCount > 0 ? <WarningOutlined /> : undefined}
            />
          </Card>
        </Col>
      </Row>

      {/* 按币种汇总 */}
      <Card title="本月各币种统计" style={{ marginBottom: 24 }}>
        <Row gutter={[16, 16]}>
          {Object.entries(stats).map(([currency, s]) => (
            <Col xs={12} sm={6} key={currency}>
              <Card size="small">
                <div style={{ fontWeight: 600, marginBottom: 8 }}>{currency}</div>
                <div style={{ color: '#52c41a', marginBottom: 4 }}>
                  <ArrowUpOutlined /> 收入: {s.income.toLocaleString()}
                </div>
                <div style={{ color: '#ff4d4f' }}>
                  <ArrowDownOutlined /> 支出: {s.expense.toLocaleString()}
                </div>
              </Card>
            </Col>
          ))}
          {Object.keys(stats).length === 0 && <Text type="secondary">本月暂无记录</Text>}
        </Row>
      </Card>

      {/* 最近流水 */}
      <Card title="最近流水">
        <Table
          dataSource={recentTx}
          rowKey="id"
          size="small"
          pagination={false}
          columns={[
            { title: '日期', dataIndex: 'transaction_date', width: 100 },
            {
              title: '用户', dataIndex: ['users', 'name'], width: 80,
              render: (_: any, r: any) => r.users?.name || r.user_id,
            },
            {
              title: '类型', dataIndex: 'type', width: 80,
              render: (t: string) => {
                const m: Record<string, string> = { expense: '💸付款', income: '💰收款', exchange: '🔄换汇', transfer: '📤转款' };
                return <Tag>{m[t] || t}</Tag>;
              },
            },
            {
              title: '金额', key: 'amount', width: 120,
              render: (_: any, r: Transaction) => r.type === 'exchange' ? `${r.from_amount}→${r.to_amount}` : `${r.amount} ${r.currency || ''}`,
            },
            { title: '备注', dataIndex: 'notes', ellipsis: true },
          ]}
        />
      </Card>
    </div>
  );
}
