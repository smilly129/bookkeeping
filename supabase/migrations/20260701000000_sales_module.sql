-- ============================================
-- 业务员管理模块 — 数据库迁移
-- 1. 扩展 transactions 表（增加业务相关字段）
-- 2. 新建 salespersons / customers / purchases / asset_override 表
-- 3. 创建采购汇总视图
-- 4. RLS 策略
-- ============================================

-- ============================================
-- Part 1: 扩展 transactions 表
-- ============================================
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS customer_id     UUID,
  ADD COLUMN IF NOT EXISTS business_type   TEXT CHECK (business_type IN ('exchange', 'purchase', 'other')),
  ADD COLUMN IF NOT EXISTS rate_direction  TEXT CHECK (rate_direction IN ('divide', 'multiply')),
  ADD COLUMN IF NOT EXISTS theoretical_cost DECIMAL(18,4),
  ADD COLUMN IF NOT EXISTS purchase_id     UUID;

-- 为新增字段创建索引
CREATE INDEX IF NOT EXISTS idx_transactions_customer ON transactions(customer_id);
CREATE INDEX IF NOT EXISTS idx_transactions_business_type ON transactions(business_type);
CREATE INDEX IF NOT EXISTS idx_transactions_purchase ON transactions(purchase_id);

-- ============================================
-- Part 2: salespersons 表（业务员）
-- ============================================
CREATE TABLE IF NOT EXISTS salespersons (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  phone      TEXT,
  notes      TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Part 3: customers 表（客户）
-- ============================================
CREATE TABLE IF NOT EXISTS customers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code            TEXT NOT NULL,
  name            TEXT,
  salesperson_id  UUID NOT NULL REFERENCES salespersons(id) ON DELETE CASCADE,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_code ON customers(code);
CREATE INDEX IF NOT EXISTS idx_customers_salesperson ON customers(salesperson_id);

-- ============================================
-- Part 4: purchases 表（采购记录）
-- ============================================
CREATE TABLE IF NOT EXISTS purchases (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id     UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  salesperson_id  UUID NOT NULL REFERENCES salespersons(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id),
  currency        TEXT NOT NULL,
  quoted_price    DECIMAL(18,4),
  actual_cost     DECIMAL(18,4),
  status          TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed')),
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_purchases_customer ON purchases(customer_id);
CREATE INDEX IF NOT EXISTS idx_purchases_salesperson ON purchases(salesperson_id);
CREATE INDEX IF NOT EXISTS idx_purchases_status ON purchases(status);

-- 补充 transactions 的 purchase_id 外键
ALTER TABLE transactions
  ADD CONSTRAINT fk_transactions_purchase
  FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE SET NULL;

-- ============================================
-- Part 5: asset_override 表（资产手动调整）
-- ============================================
CREATE TABLE IF NOT EXISTS asset_override (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salesperson_id      UUID NOT NULL REFERENCES salespersons(id) ON DELETE CASCADE,
  currency            TEXT NOT NULL,
  estimated_rate      DECIMAL(18,6),
  notes               TEXT,
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(salesperson_id, currency)
);

CREATE INDEX IF NOT EXISTS idx_asset_override_salesperson ON asset_override(salesperson_id);
CREATE INDEX IF NOT EXISTS idx_asset_override_currency ON asset_override(currency);

-- ============================================
-- Part 6: 采购汇总视图
-- ============================================
CREATE OR REPLACE VIEW purchase_summary AS
SELECT
  p.id,
  p.customer_id,
  p.salesperson_id,
  p.user_id,
  p.currency,
  p.quoted_price,
  p.actual_cost,
  p.status,
  p.notes,
  p.created_at,
  p.updated_at,
  c.code AS customer_code,
  s.name AS salesperson_name,
  COALESCE((
    SELECT SUM(CASE
      WHEN t.type IN ('income', 'expense') THEN COALESCE(t.amount, 0)
      WHEN t.type = 'exchange' THEN COALESCE(t.to_amount, 0)
      ELSE 0
    END)
    FROM transactions t
    WHERE t.purchase_id = p.id AND t.is_deleted = FALSE
  ), 0) AS total_received,
  COALESCE(p.quoted_price, 0) - COALESCE((
    SELECT SUM(CASE
      WHEN t.type IN ('income', 'expense') THEN COALESCE(t.amount, 0)
      WHEN t.type = 'exchange' THEN COALESCE(t.to_amount, 0)
      ELSE 0
    END)
    FROM transactions t
    WHERE t.purchase_id = p.id AND t.is_deleted = FALSE
  ), 0) AS shortfall,
  COALESCE(p.quoted_price, 0) - COALESCE(p.actual_cost, 0) AS profit
FROM purchases p
JOIN customers c ON p.customer_id = c.id
JOIN salespersons s ON p.salesperson_id = s.id;

-- ============================================
-- Part 7: RLS 策略（新表）
-- ============================================
ALTER TABLE salespersons ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_override ENABLE ROW LEVEL SECURITY;

-- salespersons: admin 全权限，recorder 只读
CREATE POLICY "sp_admin_all" ON salespersons FOR ALL USING (
  EXISTS (SELECT 1 FROM users u WHERE u.invite_code = current_setting('app.invite_code', true) AND u.role = 'admin')
);
CREATE POLICY "sp_recorder_read" ON salespersons FOR SELECT USING (
  EXISTS (SELECT 1 FROM users u WHERE u.invite_code = current_setting('app.invite_code', true) AND u.role = 'recorder')
);

-- customers: admin 全权限，recorder 只读
CREATE POLICY "cust_admin_all" ON customers FOR ALL USING (
  EXISTS (SELECT 1 FROM users u WHERE u.invite_code = current_setting('app.invite_code', true) AND u.role = 'admin')
);
CREATE POLICY "cust_recorder_read" ON customers FOR SELECT USING (
  EXISTS (SELECT 1 FROM users u WHERE u.invite_code = current_setting('app.invite_code', true) AND u.role = 'recorder')
);

-- purchases: admin 全权限，recorder 只读
CREATE POLICY "pur_admin_all" ON purchases FOR ALL USING (
  EXISTS (SELECT 1 FROM users u WHERE u.invite_code = current_setting('app.invite_code', true) AND u.role = 'admin')
);
CREATE POLICY "pur_recorder_read" ON purchases FOR SELECT USING (
  EXISTS (SELECT 1 FROM users u WHERE u.invite_code = current_setting('app.invite_code', true) AND u.role = 'recorder')
);

-- asset_override: admin 全权限，recorder 只读
CREATE POLICY "ao_admin_all" ON asset_override FOR ALL USING (
  EXISTS (SELECT 1 FROM users u WHERE u.invite_code = current_setting('app.invite_code', true) AND u.role = 'admin')
);
CREATE POLICY "ao_recorder_read" ON asset_override FOR SELECT USING (
  EXISTS (SELECT 1 FROM users u WHERE u.invite_code = current_setting('app.invite_code', true) AND u.role = 'recorder')
);
