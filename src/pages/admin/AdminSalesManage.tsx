import { useState, useEffect } from 'react';
import { Table, Button, Modal, Form, Input, Select, Space, message, Popconfirm, Tag } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { supabase, type Salesperson, type Customer } from '../../lib/supabase';
import dayjs from 'dayjs';

interface CustomerRow extends Customer {
  salesperson_name?: string;
}

export default function AdminSalesManage() {
  const [salespersons, setSalespersons] = useState<Salesperson[]>([]);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [loading, setLoading] = useState(false);

  // 业务员弹窗
  const [spModalOpen, setSpModalOpen] = useState(false);
  const [editingSp, setEditingSp] = useState<Salesperson | null>(null);
  const [spForm, setSpForm] = useState({ name: '', phone: '', notes: '' });

  // 客户弹窗
  const [custModalOpen, setCustModalOpen] = useState(false);
  const [editingCust, setEditingCust] = useState<CustomerRow | null>(null);
  const [custForm, setCustForm] = useState({ code: '', name: '', salesperson_id: '', notes: '' });

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    const [spRes, custRes] = await Promise.all([
      supabase.from('salespersons').select('*').order('created_at', { ascending: false }),
      supabase.from('customers').select('*, salesperson: salesperson_id(name)').order('created_at', { ascending: false }),
    ]);
    if (spRes.data) setSalespersons(spRes.data);
    if (custRes.data) {
      setCustomers(custRes.data.map((c: any) => ({
        ...c,
        salesperson_name: c.salesperson?.name || '',
      })));
    }
    setLoading(false);
  };

  // ====== 业务员 CRUD ======
  const openSpAdd = () => { setEditingSp(null); setSpForm({ name: '', phone: '', notes: '' }); setSpModalOpen(true); };
  const openSpEdit = (sp: Salesperson) => { setEditingSp(sp); setSpForm({ name: sp.name, phone: sp.phone || '', notes: sp.notes || '' }); setSpModalOpen(true); };

  const saveSp = async () => {
    if (!spForm.name.trim()) { message.error('请输入姓名'); return; }
    if (editingSp) {
      await supabase.from('salespersons').update(spForm).eq('id', editingSp.id);
      message.success('已更新');
    } else {
      await supabase.from('salespersons').insert(spForm);
      message.success('已添加');
    }
    setSpModalOpen(false);
    loadData();
  };

  const deleteSp = async (id: string) => {
    await supabase.from('salespersons').delete().eq('id', id);
    message.success('已删除（关联客户同步删除）');
    loadData();
  };

  // ====== 客户 CRUD ======
  const openCustAdd = () => { setEditingCust(null); setCustForm({ code: '', name: '', salesperson_id: '', notes: '' }); setCustModalOpen(true); };
  const openCustEdit = (c: CustomerRow) => { setEditingCust(c); setCustForm({ code: c.code, name: c.name || '', salesperson_id: c.salesperson_id, notes: c.notes || '' }); setCustModalOpen(true); };

  const saveCust = async () => {
    if (!custForm.code.trim()) { message.error('请输入客户代号'); return; }
    if (!custForm.salesperson_id) { message.error('请选择业务员'); return; }
    try {
      if (editingCust) {
        await supabase.from('customers').update(custForm).eq('id', editingCust.id);
        message.success('已更新');
      } else {
        await supabase.from('customers').insert(custForm);
        message.success('已添加');
      }
      setCustModalOpen(false);
      loadData();
    } catch (e: any) {
      message.error('保存失败: ' + (e.message || '客户代号可能重复'));
    }
  };

  const deleteCust = async (id: string) => {
    await supabase.from('customers').delete().eq('id', id);
    message.success('已删除客户');
    loadData();
  };

  const spColumns = [
    { title: '姓名', dataIndex: 'name', key: 'name', width: 120 },
    { title: '电话', dataIndex: 'phone', key: 'phone', width: 140, render: (v: string) => v || '—' },
    { title: '备注', dataIndex: 'notes', key: 'notes', ellipsis: true, render: (v: string) => v || '—' },
    { title: '创建时间', dataIndex: 'created_at', key: 'date', width: 120, render: (d: string) => d ? dayjs(d).format('YYYY-MM-DD') : '' },
    {
      title: '操作', key: 'actions', width: 120,
      render: (_: any, r: Salesperson) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => openSpEdit(r)} />
          <Popconfirm title="确定删除? 关联客户也会删除!" onConfirm={() => deleteSp(r.id)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const custColumns = [
    {
      title: '客户代号', dataIndex: 'code', key: 'code', width: 130,
      render: (c: string) => <Tag color="blue" style={{ fontWeight: 600 }}>{c}</Tag>,
    },
    { title: '名称', dataIndex: 'name', key: 'name', width: 130, render: (v: string) => v || '—' },
    {
      title: '所属业务员', dataIndex: 'salesperson_name', key: 'sp', width: 120,
      filters: salespersons.map(s => ({ text: s.name, value: s.name })),
      onFilter: (v: any, r: CustomerRow) => r.salesperson_name === v,
    },
    { title: '备注', dataIndex: 'notes', key: 'notes', ellipsis: true, render: (v: string) => v || '—' },
    { title: '创建时间', dataIndex: 'created_at', key: 'date', width: 120, render: (d: string) => d ? dayjs(d).format('YYYY-MM-DD') : '' },
    {
      title: '操作', key: 'actions', width: 120,
      render: (_: any, r: CustomerRow) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => openCustEdit(r)} />
          <Popconfirm title="确定删除?" onConfirm={() => deleteCust(r.id)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      {/* ====== 业务员管理 ====== */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>👤 业务员列表</h3>
        <Button type="primary" icon={<PlusOutlined />} onClick={openSpAdd}>新增业务员</Button>
      </div>
      <Table columns={spColumns} dataSource={salespersons} rowKey="id" size="small"
        loading={loading} pagination={false} style={{ marginBottom: 32 }}
        locale={{ emptyText: '暂无业务员，点击上方按钮添加' }}
      />

      {/* ====== 客户管理 ====== */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>🏷️ 客户列表</h3>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCustAdd}>新增客户</Button>
      </div>
      <Table columns={custColumns} dataSource={customers} rowKey="id" size="small"
        loading={loading} pagination={{ pageSize: 30, showTotal: (t) => `共 ${t} 个客户` }}
        locale={{ emptyText: '暂无客户，请先添加业务员再添加客户' }}
      />

      {/* 业务员弹窗 */}
      <Modal
        title={editingSp ? '编辑业务员' : '新增业务员'}
        open={spModalOpen}
        onCancel={() => setSpModalOpen(false)}
        onOk={saveSp}
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

      {/* 客户弹窗 */}
      <Modal
        title={editingCust ? '编辑客户' : '新增客户'}
        open={custModalOpen}
        onCancel={() => setCustModalOpen(false)}
        onOk={saveCust}
        destroyOnClose
      >
        <Form layout="vertical">
          <Form.Item label="客户代号" required>
            <Input value={custForm.code} onChange={(e) => setCustForm({ ...custForm, code: e.target.value.toUpperCase() })} placeholder="如 ZY6653, BF9009" />
          </Form.Item>
          <Form.Item label="客户名称">
            <Input value={custForm.name} onChange={(e) => setCustForm({ ...custForm, name: e.target.value })} placeholder="客户全称（可选）" />
          </Form.Item>
          <Form.Item label="所属业务员" required>
            <Select value={custForm.salesperson_id || undefined} onChange={(v) => setCustForm({ ...custForm, salesperson_id: v || '' })}
              options={salespersons.map(s => ({ label: s.name, value: s.id }))}
              placeholder="选择业务员"
            />
          </Form.Item>
          <Form.Item label="备注">
            <Input.TextArea value={custForm.notes} onChange={(e) => setCustForm({ ...custForm, notes: e.target.value })} rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
