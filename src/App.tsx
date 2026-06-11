import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import { useResponsive } from './hooks/useResponsive';
import LoginPage from './pages/auth/LoginPage';
import MobileLayout from './pages/mobile/MobileLayout';
import AdminLayout from './pages/admin/AdminLayout';
import { Spin } from 'antd';

export default function App() {
  const { user, loading } = useAuth();
  const { isMobile } = useResponsive();

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <Routes>
      {/* 登录页 */}
      <Route
        path="/login"
        element={user ? <Navigate to={isMobile ? '/' : '/admin'} replace /> : <LoginPage />}
      />

      {/* 手机端 */}
      <Route
        path="/*"
        element={
          !user ? <Navigate to="/login" replace /> :
          isMobile ? <MobileLayout /> :
          <AdminLayout />
        }
      />
    </Routes>
  );
}
