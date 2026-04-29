-- Promote two specific accounts to super_admin.
-- Idempotent: only updates rows that currently exist; safe to re-run.
UPDATE users SET role = 'super_admin', updated_at = NOW()
WHERE email IN ('admin@ailancers.com', 'mahesh.kumar@ongraph.com')
  AND role <> 'super_admin';
