import { TabBar } from 'antd-mobile';
import { useNavigate, useLocation, Routes, Route } from 'react-router-dom';
import { AppOutline, UnorderedListOutline } from 'antd-mobile-icons';
import RecordTab from './RecordTab';
import ReconcileTab from './ReconcileTab';

const tabs = [
  { key: '/', title: '记账', icon: <AppOutline /> },
  { key: '/reconcile', title: '对账', icon: <UnorderedListOutline /> },
];

export default function MobileLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const activeKey = location.pathname === '/reconcile' ? '/reconcile' : '/';

  return (
    <div style={{ paddingBottom: 50, minHeight: '100vh', background: '#f5f5f5' }}>
      <Routes>
        <Route path="/" element={<RecordTab />} />
        <Route path="/reconcile" element={<ReconcileTab />} />
      </Routes>

      <TabBar
        activeKey={activeKey}
        onChange={(key) => navigate(key)}
        style={{ position: 'fixed', bottom: 0, width: '100%', background: '#fff' }}
      >
        {tabs.map((tab) => (
          <TabBar.Item key={tab.key} icon={tab.icon} title={tab.title} />
        ))}
      </TabBar>
    </div>
  );
}
