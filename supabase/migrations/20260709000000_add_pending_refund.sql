-- 给已有的 procurement_excel_records 添加尾款和回款字段
ALTER TABLE procurement_excel_records
  ADD COLUMN IF NOT EXISTS pending_balance DECIMAL(18,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refund_amount DECIMAL(18,2) DEFAULT 0;
