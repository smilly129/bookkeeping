-- ============================================
-- 随手记记账小程序 — Supabase 数据库建表脚本
-- 在 Supabase SQL Editor 中执行此文件
-- ============================================

-- 使用 PostgreSQL 内置的 gen_random_uuid()（PG13+）

-- ============================================
-- 1. users 表
-- ============================================
CREATE TABLE users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'recorder' CHECK (role IN ('admin', 'recorder')),
  invite_code TEXT UNIQUE NOT NULL,
  avatar_url  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 2. accounts 表
-- ============================================
CREATE TABLE accounts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_type    TEXT NOT NULL CHECK (account_type IN (
                    'domestic_card', 'international_card', 'cash',
                    'alipay', 'wechat', 'crypto'
                  )),
  name            TEXT NOT NULL,
  currency        TEXT NOT NULL,
  initial_balance DECIMAL(18,4) DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_accounts_user ON accounts(user_id);

-- ============================================
-- 3. transactions 表
-- ============================================
CREATE TABLE transactions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type              TEXT NOT NULL CHECK (type IN ('expense', 'income', 'exchange', 'transfer')),
  direction         TEXT CHECK (direction IN ('domestic', 'international', 'outbound', 'inbound', 'domestic_domestic', 'international_international', 'domestic_international', 'international_domestic')),

  -- 金额
  currency          TEXT,
  amount            DECIMAL(18,4),
  from_currency     TEXT,
  to_currency       TEXT,
  from_amount       DECIMAL(18,4),
  to_amount         DECIMAL(18,4),
  exchange_rate     DECIMAL(18,6),

  -- 账户关联
  from_account_id   UUID REFERENCES accounts(id),
  to_account_id     UUID REFERENCES accounts(id),

  -- 凭证
  image_url         TEXT,

  -- 元数据
  notes             TEXT,
  transaction_date  DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ,
  updated_by        UUID REFERENCES users(id),

  is_deleted        BOOLEAN DEFAULT FALSE
);

CREATE INDEX idx_transactions_user ON transactions(user_id);
CREATE INDEX idx_transactions_date ON transactions(transaction_date);
CREATE INDEX idx_transactions_type ON transactions(type);
CREATE INDEX idx_transactions_from_acc ON transactions(from_account_id);
CREATE INDEX idx_transactions_to_acc ON transactions(to_account_id);

-- ============================================
-- 4. reconciliations 表
-- ============================================
CREATE TABLE reconciliations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id      UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  reconcile_date  DATE NOT NULL DEFAULT CURRENT_DATE,
  system_balance  DECIMAL(18,4) NOT NULL,
  actual_balance  DECIMAL(18,4) NOT NULL,
  difference      DECIMAL(18,4) GENERATED ALWAYS AS (actual_balance - system_balance) STORED,
  notes           TEXT,
  submitted_by    UUID NOT NULL REFERENCES users(id),
  status          TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'matched', 'mismatch', 'resolved')),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_reconciliations_user ON reconciliations(user_id);
CREATE INDEX idx_reconciliations_account ON reconciliations(account_id);
CREATE INDEX idx_reconciliations_status ON reconciliations(status);

-- ============================================
-- 5. invite_codes 表
-- ============================================
CREATE TABLE invite_codes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        TEXT UNIQUE NOT NULL,
  created_by  UUID NOT NULL REFERENCES users(id),
  used_by     UUID REFERENCES users(id),
  is_used     BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 6. 视图：账户当前余额
-- ============================================
CREATE VIEW account_balances AS
SELECT
  a.id AS account_id,
  a.user_id,
  a.account_type,
  a.name,
  a.currency,
  a.initial_balance,
  COALESCE(a.initial_balance, 0)
  + COALESCE((
    -- 收入（入账）
    SELECT SUM(t.amount) FROM transactions t
    WHERE t.to_account_id = a.id AND t.is_deleted = FALSE
  ), 0)
  - COALESCE((
    -- 支出（出账）
    SELECT SUM(t.amount) FROM transactions t
    WHERE t.from_account_id = a.id AND t.is_deleted = FALSE
  ), 0)
  + COALESCE((
    -- 换汇得到（入账金额）
    SELECT SUM(t.to_amount) FROM transactions t
    WHERE t.to_account_id = a.id AND t.type = 'exchange' AND t.is_deleted = FALSE
  ), 0)
  - COALESCE((
    -- 换汇付出（出账金额）
    SELECT SUM(t.from_amount) FROM transactions t
    WHERE t.from_account_id = a.id AND t.type = 'exchange' AND t.is_deleted = FALSE
  ), 0)
  AS current_balance
FROM accounts a;

-- ============================================
-- 7. Row Level Security 配置
-- ============================================
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE reconciliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE invite_codes ENABLE ROW LEVEL SECURITY;

-- users: 所有人可读（用于查邀请码等），管理员可写
CREATE POLICY "users_read_all" ON users FOR SELECT USING (true);
CREATE POLICY "users_insert_admin" ON users FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM users u WHERE u.invite_code = current_setting('app.invite_code', true) AND u.role = 'admin')
  OR NOT EXISTS (SELECT 1 FROM users)  -- 第一条记录（初始管理员）
);
CREATE POLICY "users_update_admin" ON users FOR UPDATE USING (
  EXISTS (SELECT 1 FROM users u WHERE u.invite_code = current_setting('app.invite_code', true) AND u.role = 'admin')
);

-- accounts: 用户可读自己，管理员全权
CREATE POLICY "accounts_read_own" ON accounts FOR SELECT USING (
  user_id = (SELECT id FROM users WHERE invite_code = current_setting('app.invite_code', true))
  OR EXISTS (SELECT 1 FROM users WHERE invite_code = current_setting('app.invite_code', true) AND role = 'admin')
);
CREATE POLICY "accounts_insert_own" ON accounts FOR INSERT WITH CHECK (
  user_id = (SELECT id FROM users WHERE invite_code = current_setting('app.invite_code', true))
);
CREATE POLICY "accounts_update_admin" ON accounts FOR UPDATE USING (
  EXISTS (SELECT 1 FROM users WHERE invite_code = current_setting('app.invite_code', true) AND role = 'admin')
);

-- transactions: 用户可读自己，只能新增，管理员可修改删除
CREATE POLICY "transactions_read_own" ON transactions FOR SELECT USING (
  user_id = (SELECT id FROM users WHERE invite_code = current_setting('app.invite_code', true))
  OR EXISTS (SELECT 1 FROM users WHERE invite_code = current_setting('app.invite_code', true) AND role = 'admin')
);
CREATE POLICY "transactions_insert_own" ON transactions FOR INSERT WITH CHECK (
  user_id = (SELECT id FROM users WHERE invite_code = current_setting('app.invite_code', true))
);
CREATE POLICY "transactions_update_admin" ON transactions FOR UPDATE USING (
  EXISTS (SELECT 1 FROM users WHERE invite_code = current_setting('app.invite_code', true) AND role = 'admin')
);

-- reconciliations: 用户可读写自己的
CREATE POLICY "rec_read_own" ON reconciliations FOR SELECT USING (
  user_id = (SELECT id FROM users WHERE invite_code = current_setting('app.invite_code', true))
  OR EXISTS (SELECT 1 FROM users WHERE invite_code = current_setting('app.invite_code', true) AND role = 'admin')
);
CREATE POLICY "rec_insert_own" ON reconciliations FOR INSERT WITH CHECK (
  user_id = (SELECT id FROM users WHERE invite_code = current_setting('app.invite_code', true))
);
CREATE POLICY "rec_update_admin" ON reconciliations FOR UPDATE USING (
  EXISTS (SELECT 1 FROM users WHERE invite_code = current_setting('app.invite_code', true) AND role = 'admin')
);

-- invite_codes: 管理员全权，记账人可读（验证邀请码时）
CREATE POLICY "invite_read_all" ON invite_codes FOR SELECT USING (true);
CREATE POLICY "invite_insert_admin" ON invite_codes FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM users WHERE invite_code = current_setting('app.invite_code', true) AND role = 'admin')
);

-- ============================================
-- 8. Storage: 凭证照片桶
-- ============================================
-- 在 Supabase Dashboard → Storage 中手动创建 bucket 'receipts'
-- 或执行以下 SQL:
-- INSERT INTO storage.buckets (id, name, public) VALUES ('receipts', 'receipts', true);

-- Storage RLS（在 Storage 页面的 Policies 中配置）
-- 允许所有人读取（公开桶）
-- 允许登录用户上传
