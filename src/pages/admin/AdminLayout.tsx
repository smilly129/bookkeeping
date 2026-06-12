import { useState } from 'react';
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu, Button, theme } from 'antd';
import {
  DashboardOutlined, TableOutlined, CheckCircleOutlined,
  WalletOutlined, BarChartOutlined, UserOutlined,
  MenuFoldOutlined, MenuUnfoldOutlined, LogoutOutlined,
} from '@ant-design/icons';
import { useAuth } from '../../hooks/useAuth';
import AdminDashboard from './AdminDashboard';
import AdminRecords from './AdminRecords';
import AdminReconcile from './AdminReconcile';
import AdminAccounts from './AdminAccounts';
import AdminReports from './AdminReports';
import AdminUsers from './AdminUsers';

const { Header, Sider, Content } = Layout;

const menuItems = [
  { key: '/', icon: <DashboardOutlined />, label: '总览' },
  { key: '/records', icon: <TableOutlined />, label: '数据表格' },
  { key: '/reconcile', icon: <CheckCircleOutlined />, label: '对账管理' },
  { key: '/accounts', icon: <WalletOutlined />, label: '账户总表' },
  { key: '/reports', icon: <BarChartOutlined />, label: '汇总报表' },
  { key: '/users', icon: <UserOutlined />, label: '用户管理' },
];

export default function AdminLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const { token } = theme.useToken();

  if (user?.role !== 'admin') {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <div style={{ textAlign: 'center' }}>
          <h2>无权限访问</h2>
          <p>仅管理员可查看后台</p>
          <Button type="primary" onClick={() => { logout(); navigate('/login'); }}>返回登录</Button>
        </div>
      </div>
    );
  }

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        trigger={null}
        collapsible
        collapsed={collapsed}
        breakpoint="lg"
        style={{ background: token.colorBgContainer }}
      >
        <div style={{
          height: 64, display: 'flex', alignItems: 'center', justifyContent: 'center',
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
        }}>
          <span style={{ fontSize: collapsed ? 18 : 20, fontWeight: 700, color: token.colorPrimary }}>
            📒 {!collapsed && '随手记后台'}
          </span>
        </div>
        <Menu
          mode="inline"
          selectedKeys={[location.pathname]}
          items={menuItems}
          onClick={({ key, domEvent }) => {
            domEvent.preventDefault();
            navigate(key);
          }}
          style={{ borderRight: 0 }}
        />
      </Sider>

      <Layout>
        <Header style={{
          padding: '0 24px', background: token.colorBgContainer,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
        }}>
          <Button
            type="text"
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={() => setCollapsed(!collapsed)}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span>{user?.name} (管理员)</span>
            <Button
              type="text"
              icon={<LogoutOutlined />}
              onClick={() => { logout(); navigate('/login'); }}
            >
              退出
            </Button>
          </div>
        </Header>

        <Content style={{ margin: 16, padding: 24, background: token.colorBgContainer, borderRadius: 8, overflow: 'auto' }}>
          <Routes>
            <Route path="/" element={<AdminDashboard />} />
            <Route path="/records" element={<AdminRecords />} />
            <Route path="/reconcile" element={<AdminReconcile />} />
            <Route path="/accounts" element={<AdminAccounts />} />
            <Route path="/reports" element={<AdminReports />} />
            <Route path="/users" element={<AdminUsers />} />
          </Routes>
        </Content>
      </Layout>
    </Layout>
  );
}
