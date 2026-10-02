-- Expense sub-group for intelligent filtering (recharge, PMS, AGO, etc.)
alter table approvals_expenditures add column if not exists expense_group text;
create index if not exists idx_approvals_expense_group on approvals_expenditures(expense_group);
