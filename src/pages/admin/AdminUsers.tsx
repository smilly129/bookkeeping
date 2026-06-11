import { useState, useEffect } from 'react';
import {
  Table, Button, Modal, Form, Input, Tag, Space,
  message, Popconfirm, Typography,
} from 'antd';
import { PlusOutlined, CopyOutlined, DeleteOutlined } from '@ant-design/icons';
import { supabase, type User, type InviteCode } from '../../lib/supabase';
import dayjs from 'dayjs';

const { Text } = Typography;

export default function AdminUsers() {
  const [users, setUsers] = useState<User[]>([]);
  const [inviteCodes, setInviteCodes] = useState<InviteCode[]>([]);
  const [showGenModal, setShowGenModal] = useState(false);
  const [newCodeCount, setNewCodeCount] = useState(1);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const [userRes, codeRes] = await Promise.all([
      supabase.from('users').select('*').order('created_at', { ascending: false }),
      supabase.from('invite_codes').select('*').order('created_at', { ascending: false }),
    ]);
    if (userRes.data) setUsers(userRes.data);
    if (codeRes.data) setInviteCodes(codeRes.data);
  };

  // 生成邀请码
  const generateCodes = async () => {
    setLoading(true);
    const codes = Array.from({ length: newCodeCount }, () => ({
      code: 'BK' + Math.random().toString(36).substring(2, 8).toUpperCase(),
      created_by: users.find(u => u.role === 'admin')?.id || '',
    }));

    const { error } = await supabase.from('invite_codes').insert(codes);
    setLoading(false);

    if (error) {
      message.error('生成失败');
    } else {
      message.success(`生成了 ${newCodeCount} 个邀请码`);
      setShowGenModal(false);
      loadData();
    }
  };

  // 复制邀请码
  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    message.success('已复制: ' + code);
  };

  // 删除邀请码
  const deleteCode = async (id: string) => {
    await supabase.from('invite_codes').delete().eq('id', id).eq('is_used', false);
    message.success('已删除');
    loadData();
  };

  const userColumns = [
    { title: '姓名', dataIndex: 'name', key: 'name' },
    {
      title: '角色', dataIndex: 'role', key: 'role',
      render: (r: string) => r === 'admin' ? <Tag color="red">管理员</Tag> : <Tag color="blue">记账人</Tag>,
    },
    { title: '邀请码', dataIndex: 'invite_code', key: 'code', render: (c: string) => <Text code>{c}</Text> },
    { title: '加入时间', dataIndex: 'created_at', key: 'date', render: (d: string) => d ? dayjs(d).format('YYYY-MM-DD HH:mm') : '' },
  ];

  const codeColumns = [
    {
      title: '邀请码', dataIndex: 'code', key: 'code',
      render: (c: string) => <Text code style={{ fontSize: 16, fontWeight: 600 }}>{c}</Text>,
    },
    {
      title: '状态', dataIndex: 'is_used', key: 'status',
      render: (used: boolean) => used ? <Tag color="default">已使用</Tag> : <Tag color="success">可用</Tag>,
    },
    {
      title: '使用者', dataIndex: 'used_by', key: 'used',
      render: (uid: string) => {
        const u = users.find(u => u.id === uid);
        return u?.name || (uid ? uid.slice(0, 8) : '—');
      },
    },
    { title: '生成时间', dataIndex: 'created_at', key: 'date', render: (d: string) => d ? dayjs(d).format('YYYY-MM-DD') : '' },
    {
      title: '操作', key: 'actions',
      render: (_: any, r: InviteCode) => (
        <Space>
          <Button size="small" icon={<CopyOutlined />} onClick={() => copyCode(r.code)}>复制</Button>
          {!r.is_used && (
            <Popconfirm title="确定删除?" onConfirm={() => deleteCode(r.id)}>
              <Button size="small" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>👥 用户管理</h2>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setShowGenModal(true)}>
          生成邀请码
        </Button>
      </div>

      <h3 style={{ marginBottom: 8 }}>用户列表</h3>
      <Table columns={userColumns} dataSource={users} rowKey="id" size="small"
        pagination={false} style={{ marginBottom: 32 }}
      />

      <h3 style={{ marginBottom: 8 }}>邀请码管理</h3>
      <Table columns={codeColumns} dataSource={inviteCodes} rowKey="id" size="small"
        pagination={{ pageSize: 20 }}
      />

      {/* 生成邀请码弹窗 */}
      <Modal
        title="生成邀请码"
        open={showGenModal}
        onCancel={() => setShowGenModal(false)}
        onOk={generateCodes}
        confirmLoading={loading}
      >
        <Form layout="vertical">
          <Form.Item label="生成数量">
            <Input type="number" min={1} max={10} value={newCodeCount}
              onChange={(e) => setNewCodeCount(parseInt(e.target.value) || 1)} />
          </Form.Item>
        </Form>
        <Text type="secondary">
          生成的邀请码格式为 BK + 随机字符，如 BKX3K9A。每个邀请码只能使用一次。
        </Text>
      </Modal>
    </div>
  );
}
