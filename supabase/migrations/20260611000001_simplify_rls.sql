-- 简化 RLS 策略：因为使用自定义邀请码认证（非 Supabase Auth）
-- 前端代码负责数据过滤和权限控制

-- 允许 anon 角色读写所有表（前端已做权限控制）
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
ALTER TABLE accounts DISABLE ROW LEVEL SECURITY;
ALTER TABLE transactions DISABLE ROW LEVEL SECURITY;
ALTER TABLE reconciliations DISABLE ROW LEVEL SECURITY;
ALTER TABLE invite_codes DISABLE ROW LEVEL SECURITY;

-- 为 storage.objects 添加公开访问策略
-- (在 Supabase Dashboard → Storage → Policies 中手动配置)
