import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { supabase, type User } from '../lib/supabase';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  error: string | null;
  login: (inviteCode: string, name: string, isNew: boolean) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

const STORAGE_KEY = 'bookkeep_user';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 从 localStorage 恢复登录状态
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as User;
        setUser(parsed);
      } catch {
        localStorage.removeItem(STORAGE_KEY);
      }
    }
    setLoading(false);
  }, []);

  // 登录：验证邀请码
  const login = useCallback(async (inviteCode: string, name: string, isNew: boolean) => {
    setError(null);
    setLoading(true);

    try {
      if (isNew) {
        // 新用户注册：检查邀请码是否可用
        const { data: codes, error: codeErr } = await supabase
          .from('invite_codes')
          .select('*')
          .eq('code', inviteCode)
          .eq('is_used', false)
          .single();

        if (codeErr || !codes) {
          throw new Error('邀请码无效或已被使用');
        }

        // 创建用户
        const { data: newUser, error: createErr } = await supabase
          .from('users')
          .insert({
            name,
            role: 'recorder',
            invite_code: inviteCode,
          })
          .select()
          .single();

        if (createErr) throw createErr;

        // 标记邀请码已使用
        await supabase
          .from('invite_codes')
          .update({ is_used: true, used_by: newUser.id })
          .eq('id', codes.id);

        setUser(newUser as User);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(newUser));
      } else {
        // 已有用户登录：查找匹配的用户
        const { data: existingUser, error: findErr } = await supabase
          .from('users')
          .select('*')
          .eq('invite_code', inviteCode)
          .single();

        if (findErr || !existingUser) {
          throw new Error('未找到该邀请码对应的用户');
        }

        setUser(existingUser as User);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(existingUser));
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : '登录失败';
      setError(message);
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  // 登出
  const logout = useCallback(() => {
    setUser(null);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  // 刷新用户信息
  const refreshUser = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('users')
      .select('*')
      .eq('id', user.id)
      .single();
    if (data) {
      setUser(data as User);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    }
  }, [user]);

  return (
    <AuthContext.Provider value={{ user, loading, error, login, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
}
