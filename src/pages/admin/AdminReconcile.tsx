import { useState, useEffect } from 'react';
import {
  Table, Card, Tag, Button, Space, Select, Modal,
  message, Typography,
} from 'antd';
import { CheckCircleOutlined, WarningOutlined, EyeOutlined, CheckOutlined } from '@ant-design/icons';
import { supabase, type Reconciliation } from '../../lib/supabase';
import dayjs from 'dayjs';

const { Text } = Typography;

interface RecRow extends Reconciliation {
  user_name?: string;
  account_name?: string;
}

export default function AdminReconcile() {
  const [data, setData] = useState<RecRow[]>([]);
  const [filterUser, setFilterUser] = useState<string | undefined>();
  const [filterStatus, setFilterStatus] = useState<string | undefined>();
  const [users, setUsers] = useState<{ id: string; name: string }[]>([]);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedRec, setSelectedRec] = useState<RecRow | null>(null);

  useEffect(() => {
    supabase.from('users').select('id, name').then(({ data: u }) => {
      if (u) setUsers(u);
    });
    loadData();
  }, []);

  const loadData = async () => {
    const { data: recData } = await supabase
      .from('reconciliations')
      .select('*, users!reconciliations_user_id_fkey(name), accounts!reconciliations_account_id_fkey(name, currency)')
      .order('created_at', { ascending: false })
      .limit(200);

    if (recData) {
      setData(recData.map((r: any) => ({
        ...r,
        user_name: r.users?.name,
        account_name: r.accounts?.name,
      })));
    }
  };

  const handleResolve = async (id: string) => {
    await supabase.from('reconciliations').update({ status: 'resolved' }).eq('id', id);
    message.success('已标记处理');
    loadData();
  };

  const filtered = data.filter(r => {
    if (filterUser && r.user_id !== filterUser) return false;
    if (filterStatus && r.status !== filterStatus) return false;
    return true;
  });

  const columns = [
    { title: '日期', dataIndex: 'reconcile_date', key: 'date', width: 100 },
    { title: '姓名', dataIndex: 'user_name', key: 'user', width: 80 },
    { title: '账户', dataIndex: 'account_name', key: 'account', width: 140 },
    {
      title: '系统余额', dataIndex: 'system_balance', key: 'sys', width: 120,
      render: (v: number) => v?.toLocaleString(),
    },
    {
      title: '实际余额', dataIndex: 'actual_balance', key: 'actual', width: 120,
      render: (v: number) => v?.toLocaleString(),
    },
    {
      title: '差异', dataIndex: 'difference', key: 'diff', width: 120,
      render: (v: number) => (
        <span style={{ color: v === 0 ? '#52c41a' : '#ff4d4f', fontWeight: 600 }}>
          {v === 0 ? '0' : `${v > 0 ? '+' : ''}${v?.toFixed(2)}`}
        </span>
      ),
    },
    {
      title: '状态', dataIndex: 'status', key: 'status', width: 100,
      render: (s: string) => {
        const map: Record<string, { color: string; icon: any; text: string }> = {
          matched: { color: 'success', icon: <CheckCircleOutlined />, text: '匹配' },
          mismatch: { color: 'error', icon: <WarningOutlined />, text: '差异' },
          pending: { color: 'default', icon: null, text: '待处理' },
          resolved: { color: 'processing', icon: <CheckOutlined />, text: '已处理' },
        };
        const m = map[s] || map.pending;
        return <Tag color={m.color}>{m.icon} {m.text}</Tag>;
      },
    },
    { title: '备注', dataIndex: 'notes', key: 'notes', ellipsis: true },
    {
      title: '操作', key: 'actions', width: 160,
      render: (_: any, r: RecRow) => (
        <Space>
          <Button size="small" icon={<EyeOutlined />} onClick={() => { setSelectedRec(r); setDetailOpen(true); }}>详情</Button>
          {r.status === 'mismatch' && (
            <Button size="small" type="primary" onClick={() => handleResolve(r.id)}>标记处理</Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>📊 对账管理</h2>
      </div>

      <Space wrap style={{ marginBottom: 16 }}>
        <Select
          placeholder="按人筛选" allowClear style={{ width: 120 }}
          value={filterUser}
          onChange={setFilterUser}
          options={users.map(u => ({ label: u.name, value: u.id }))}
        />
        <Select
          placeholder="按状态" allowClear style={{ width: 120 }}
          value={filterStatus}
          onChange={setFilterStatus}
          options={[
            { label: '匹配', value: 'matched' },
            { label: '差异', value: 'mismatch' },
            { label: '已处理', value: 'resolved' },
          ]}
        />
      </Space>

      {/* 差异统计 */}
      <div style={{ marginBottom: 16, display: 'flex', gap: 16 }}>
        {['matched', 'mismatch', 'resolved'].map(status => {
          const count = data.filter(r => r.status === status).length;
          const colors: Record<string, string> = { matched: '#52c41a', mismatch: '#ff4d4f', resolved: '#1677ff' };
          const labels: Record<string, string> = { matched: '✅ 匹配', mismatch: '⚠️ 差异', resolved: '✅ 已处理' };
          return (
            <Card key={status} size="small" style={{ flex: 1, textAlign: 'center', borderColor: colors[status] }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: colors[status] }}>{count}</div>
              <div>{labels[status]}</div>
            </Card>
          );
        })}
      </div>

      <Table columns={columns} dataSource={filtered} rowKey="id" size="small"
        pagination={{ pageSize: 30 }}
      />

      {/* 详情弹窗 */}
      <Modal
        title="对账详情"
        open={detailOpen}
        onCancel={() => { setDetailOpen(false); setSelectedRec(null); }}
        footer={null}
      >
        {selectedRec && (
          <div>
            <p><strong>用户:</strong> {selectedRec.user_name}</p>
            <p><strong>账户:</strong> {selectedRec.account_name}</p>
            <p><strong>对账日期:</strong> {selectedRec.reconcile_date}</p>
            <p><strong>系统余额:</strong> {selectedRec.system_balance?.toLocaleString()}</p>
            <p><strong>实际余额:</strong> {selectedRec.actual_balance?.toLocaleString()}</p>
            <p style={{ color: selectedRec.difference === 0 ? '#52c41a' : '#ff4d4f' }}>
              <strong>差异:</strong> {selectedRec.difference === 0 ? '0 (一致)' : `${selectedRec.difference > 0 ? '+' : ''}${selectedRec.difference?.toFixed(2)}`}
            </p>
            {selectedRec.notes && <p><strong>备注:</strong> {selectedRec.notes}</p>}
            {selectedRec.status === 'mismatch' && (
              <div style={{ background: '#fff2f0', borderRadius: 8, padding: 12, marginTop: 12 }}>
                <WarningOutlined style={{ color: '#ff4d4f' }} /> 请到"数据表格"页面查看该账户的流水记录，找出差异原因。
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
