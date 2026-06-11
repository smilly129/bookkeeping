import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { Button, Input, Form, Toast } from 'antd-mobile';
import { supabase } from '../../lib/supabase';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'check' | 'register'>('check');
  const [inviteCode, setInviteCode] = useState('');
  const [name, setName] = useState('');

  const handleCheckCode = async () => {
    if (!inviteCode.trim()) return;
    setLoading(true);
    try {
      const { data } = await supabase
        .from('users')
        .select('id, name')
        .eq('invite_code', inviteCode.trim())
        .single();

      if (data) {
        await login(inviteCode.trim(), data.name, false);
        navigate('/');
      } else {
        const { data: codeData } = await supabase
          .from('invite_codes')
          .select('id')
          .eq('code', inviteCode.trim())
          .eq('is_used', false)
          .single();

        if (codeData) {
          setMode('register');
        } else {
          Toast.show({ icon: 'fail', content: '邀请码无效或已被使用' });
        }
      }
    } catch {
      setMode('register');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async () => {
    if (!name.trim()) {
      Toast.show({ icon: 'fail', content: '请输入你的名字' });
      return;
    }
    setLoading(true);
    try {
      await login(inviteCode.trim(), name.trim(), true);
      navigate('/');
    } catch {
      Toast.show({ icon: 'fail', content: '注册失败，请重试' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      padding: '32px',
      background: 'linear-gradient(135deg, #1677ff 0%, #0958d9 100%)',
    }}>
      <div style={{
        width: '100%',
        maxWidth: 400,
        background: '#fff',
        borderRadius: 16,
        padding: 32,
        boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
      }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontSize: 48, marginBottom: 8 }}>📒</div>
          <h2 style={{ margin: 0, fontSize: 22 }}>随手记</h2>
          <p style={{ color: '#999', margin: '4px 0 0' }}>一大家子记账工具</p>
        </div>

        {mode === 'check' ? (
          <>
            <Form layout="vertical">
              <Form.Item label="请输入邀请码">
                <Input
                  placeholder="输入管理员给你的邀请码"
                  value={inviteCode}
                  onChange={setInviteCode}
                  clearable
                  maxLength={20}
                />
              </Form.Item>
            </Form>
            <Button
              block
              color="primary"
              size="large"
              loading={loading}
              onClick={handleCheckCode}
              style={{ marginTop: 16, borderRadius: 8 }}
            >
              进入
            </Button>
          </>
        ) : (
          <>
            <div style={{
              background: '#f6ffed',
              border: '1px solid #b7eb8f',
              borderRadius: 8,
              padding: '8px 12px',
              marginBottom: 16,
              fontSize: 13,
              color: '#52c41a',
            }}>
              邀请码有效！首次使用，请设置你的名字
            </div>
            <Form layout="vertical">
              <Form.Item label="邀请码">
                <Input value={inviteCode} disabled />
              </Form.Item>
              <Form.Item label="你的名字">
                <Input
                  placeholder="让大家知道你是谁"
                  value={name}
                  onChange={setName}
                  clearable
                />
              </Form.Item>
            </Form>
            <Button
              block
              color="primary"
              size="large"
              loading={loading}
              onClick={handleRegister}
              style={{ marginTop: 16, borderRadius: 8 }}
            >
              开始记账
            </Button>
            <Button
              block
              fill="none"
              size="small"
              onClick={() => setMode('check')}
              style={{ marginTop: 8 }}
            >
              换一个邀请码
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
