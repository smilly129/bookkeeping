DROP VIEW IF EXISTS purchase_summary;
CREATE VIEW purchase_summary AS
SELECT
  p.id,
  p.customer_id,
  p.salesperson_id,
  p.user_id,
  p.currency,
  p.quoted_price,
  p.actual_cost,
  p.customer_deposit,
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
  GREATEST(0, COALESCE(p.quoted_price, 0) - COALESCE((
    SELECT SUM(CASE
      WHEN t.type IN ('income', 'expense') THEN COALESCE(t.amount, 0)
      WHEN t.type = 'exchange' THEN COALESCE(t.to_amount, 0)
      ELSE 0
    END)
    FROM transactions t
    WHERE t.purchase_id = p.id AND t.is_deleted = FALSE
  ), 0) - COALESCE(p.customer_deposit, 0)) AS shortfall,
  COALESCE(p.quoted_price, 0) - COALESCE(p.actual_cost, 0) AS profit
FROM purchases p
JOIN customers c ON p.customer_id = c.id
JOIN salespersons s ON p.salesperson_id = s.id;
