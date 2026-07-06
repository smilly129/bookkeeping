-- ============================================
-- 采购账户对账模块 — 数据库迁移
-- 1. procurement_transfers（转款/代付记录）
-- 2. procurement_excel_records（Excel导入记录）
-- 3. procurement_reconciliations（资金对账历史）
-- ============================================

-- ============================================
-- Part 1: procurement_transfers 转款记录
-- ============================================
CREATE TABLE IF NOT EXISTS procurement_transfers (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  amount         DECIMAL(18,2) NOT NULL,
  transfer_date  DATE NOT NULL DEFAULT CURRENT_DATE,
  transfer_type  TEXT NOT NULL DEFAULT 'transfer' CHECK (transfer_type IN ('transfer', 'proxy')),
  notes          TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE procurement_transfers IS '采购转款/代付记录';
COMMENT ON COLUMN procurement_transfers.transfer_type IS 'transfer=转款, proxy=代付';

CREATE INDEX IF NOT EXISTS idx_procurement_transfers_date ON procurement_transfers(transfer_date);

-- ============================================
-- Part 2: procurement_excel_records Excel导入记录
-- ============================================
CREATE TABLE IF NOT EXISTS procurement_excel_records (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  record_date        DATE NOT NULL,
  customer_code      TEXT NOT NULL,
  quoted_price       DECIMAL(18,4),
  items              JSONB DEFAULT '[]',
  total_amount       DECIMAL(18,4) DEFAULT 0,
  total_express      DECIMAL(18,4) DEFAULT 0,
  total_procurement  DECIMAL(18,4) DEFAULT 0,
  amount_diff        DECIMAL(18,4) DEFAULT 0,
  purchase_id        UUID,
  upload_batch_id    TEXT,
  is_active          BOOLEAN DEFAULT TRUE,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE procurement_excel_records IS 'Excel导入的采购付款记录';
COMMENT ON COLUMN procurement_excel_records.items IS '明细数组[{size,qty,unit_price,amount,express,procurement_price}]';
COMMENT ON COLUMN procurement_excel_records.amount_diff IS '(total_amount+total_express) - total_procurement';
COMMENT ON COLUMN procurement_excel_records.is_active IS '软删除标记';

CREATE INDEX IF NOT EXISTS idx_excel_records_date_customer ON procurement_excel_records(record_date, customer_code);
CREATE INDEX IF NOT EXISTS idx_excel_records_batch ON procurement_excel_records(upload_batch_id);
CREATE INDEX IF NOT EXISTS idx_excel_records_purchase ON procurement_excel_records(purchase_id);

-- ============================================
-- Part 3: procurement_reconciliations 对账历史
-- ============================================
CREATE TABLE IF NOT EXISTS procurement_reconciliations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reconcile_date   DATE NOT NULL DEFAULT CURRENT_DATE,
  opening_balance  DECIMAL(18,2) DEFAULT 0,
  total_transfers  DECIMAL(18,2) DEFAULT 0,
  total_payments   DECIMAL(18,2) DEFAULT 0,
  system_balance   DECIMAL(18,2) DEFAULT 0,
  actual_balance   DECIMAL(18,2) DEFAULT 0,
  difference       DECIMAL(18,2) GENERATED ALWAYS AS (actual_balance - system_balance) STORED,
  notes            TEXT,
  submitted_by     UUID REFERENCES users(id),
  status           TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'matched', 'mismatch', 'resolved')),
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE procurement_reconciliations IS '采购资金对账历史';

CREATE INDEX IF NOT EXISTS idx_procurement_reconciliations_date ON procurement_reconciliations(reconcile_date);
CREATE INDEX IF NOT EXISTS idx_procurement_reconciliations_status ON procurement_reconciliations(status);

-- ============================================
-- 关闭 RLS（与项目整体策略一致）
-- ============================================
ALTER TABLE procurement_transfers DISABLE ROW LEVEL SECURITY;
ALTER TABLE procurement_excel_records DISABLE ROW LEVEL SECURITY;
ALTER TABLE procurement_reconciliations DISABLE ROW LEVEL SECURITY;
