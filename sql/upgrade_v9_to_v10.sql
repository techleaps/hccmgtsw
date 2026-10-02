-- Operational expenditure detail fields (RCA, DTA, Salary, Others)
alter table approvals_expenditures add column if not exists month_label text;
alter table approvals_expenditures add column if not exists site text;
alter table approvals_expenditures add column if not exists request_ref text;
alter table approvals_expenditures add column if not exists date_applied date;

create index if not exists idx_approvals_month on approvals_expenditures(month_label);
create index if not exists idx_approvals_site on approvals_expenditures(site);

alter table approvals_expenditures add column if not exists expense_group text;
create index if not exists idx_approvals_expense_group on approvals_expenditures(expense_group);
