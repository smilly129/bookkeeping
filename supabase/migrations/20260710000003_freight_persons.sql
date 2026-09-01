-- 运费客户标注
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS is_freight BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_transactions_is_freight ON transactions(is_freight);

-- 人名库
CREATE TABLE IF NOT EXISTS freight_persons (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE freight_persons DISABLE ROW LEVEL SECURITY;
