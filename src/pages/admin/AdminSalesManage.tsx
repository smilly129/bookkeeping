import { useState, useEffect } from 'react';
import { Table, Button, Modal, Form, Input, Space, message, Popconfirm } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { supabase, type Salesperson } from '../../lib/supabase';
import dayjs from 'dayjs';

export default function AdminSalesManage() {
  const [salespersons, setSalespersons] = useState<Salesperson[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingSp, setEditingSp] = useState<Salesperson | null>(null);
  const [spForm, setSpForm] = useState({ name: '', phone: '', notes: '' });

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    const { data } = await supabase.from('salespersons').select('*').order('created_at', { ascending: false });
    if (data) setSalespersons(data);
    setLoading(false);
  };

  const openAdd = () => { setEditingSp(null); setSpForm({ name: '', phone: '', notes: '' }); setModalOpen(true); };
  const openEdit = (sp: Salesperson) => { setEditingSp(sp); setSpForm({ name: sp.name, phone: sp.phone || '', notes: sp.notes || '' }); setModalOpen(true); };

  const save = async () => {
    if (!spForm.name.trim()) { message.error('请输入姓名'); return; }
    if (editingSp) {
      await supabase.from('salespersons').update(spForm).eq('id', editingSp.id);
      message.success('已更新');
    } else {
      await supabase.from('salespersons').insert(spForm);
      message.success('已添加');
    }
    setModalOpen(false);
    loadData();
  };

  const deleteSp = async (id: string) => {
    await supabase.from('salespersons').delete().eq('id', id);
    message.success('已删除');
    loadData();
  };

  const columns = [
    { title: '姓名', dataIndex: 'name', key: 'name', width: 120 },
    { title: '电话', dataIndex: 'phone', key: 'phone', width: 140, render: (v: string) => v || '—' },
    { title: '备注', dataIndex: 'notes', key: 'notes', ellipsis: true, render: (v: string) => v || '—' },
    { title: '创建时间', dataIndex: 'created_at', key: 'date', width: 120, render: (d: string) => d ? dayjs(d).format('YYYY-MM-DD') : '' },
    {
      title: '操作', key: 'actions', width: 120,
      render: (_: any, r: Salesperson) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)} />
          <Popconfirm title="确定删除?" onConfirm={() => deleteSp(r.id)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>👤 业务员管理</h3>
        <Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>新增业务员</Button>
      </div>
      <Table columns={columns} dataSource={salespersons} rowKey="id" size="small"
        loading={loading} pagination={false}
        locale={{ emptyText: '暂无业务员，点击右上角添加' }}
      />
      <div style={{ marginTop: 16, color: '#888', fontSize: 13 }}>
        💡 提示：客户代号无需手动创建，在数据表格录入时直接填写即可自动创建。
      </div>

      <Modal
        title={editingSp ? '编辑业务员' : '新增业务员'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={save}
        destroyOnClose
      >
        <Form layout="vertical">
          <Form.Item label="姓名" required>
            <Input value={spForm.name} onChange={(e) => setSpForm({ ...spForm, name: e.target.value })} placeholder="业务员姓名" />
          </Form.Item>
          <Form.Item label="电话">
            <Input value={spForm.phone} onChange={(e) => setSpForm({ ...spForm, phone: e.target.value })} placeholder="手机号（可选）" />
          </Form.Item>
          <Form.Item label="备注">
            <Input.TextArea value={spForm.notes} onChange={(e) => setSpForm({ ...spForm, notes: e.target.value })} rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
