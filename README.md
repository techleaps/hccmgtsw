# NAFILHCC Administrative Management System (v4)

A secure, online replacement for the manual Provisional Offer (PO), Final Allocation (FA),
Change of Ownership (COO), Approvals/Expenditure, and Refunds registers — with role-based
access, full audit logging, a supervisor approval workflow for edits/deletes, admin-defined
custom columns and tabs, document uploads, username-based sign-in, bulk Excel import, a
Payments ledger, and a payment-percentage analysis tool.

Built with **free-tier services**, the same pattern as your Document Tracker:
- **Supabase** (free tier) — database, authentication, security rules, file storage, serverless functions
- **Vercel** (free tier) — hosts the website itself

---

## What's new in v4

- **Vacant/unallocated units can now be captured in Allocations.** A House No with no
  Subscriber Name is allowed — use this for units with a defect, bad structure, erosion,
  hillside location, etc. that can't be allocated yet. They show a "Vacant" tag and can be
  filtered separately. Once assigned, just edit the record and add the name.
- **Payments register** — a running ledger of every amount a subscriber has paid, tagged as
  **Property**, **Infrastructure**, or **Legal/TDP** (tracked separately, since infra/TDP is
  not part of the property cost). Same estate-by-estate layout, Manage Columns, and Bulk
  Import from Excel as Offers/Allocations.
- **Per-estate, per-property-type fee configuration** — since Property Cost, Infrastructure
  Fee, and Legal/TDP Fee vary from estate to estate (and by property type within an estate),
  set the expected amount for each under **Estates → (an estate) → Property Types & Expected
  Fees**. This powers accurate percentage calculations everywhere else.
- **Subscriber Profile** — click any subscriber's name (in Offers, Allocations, Payments, or
  Analysis) to see a full report: property type(s)/house no, offer & allocation status and who
  collected them, phone/email, a Property/Infrastructure/Legal-TDP payment breakdown with
  expected vs paid vs balance vs %, full payment history, and every comment/remark on file for
  that person in that estate.
- **Payment Analysis** — pick an estate (Sidebar → Payment Analysis) to see how many
  subscribers have paid 100%+, 60–99%, or below 60% of the expected property cost, each broken
  down by whether they've been allocated yet — built to answer exactly: who should be prioritized
  for housing (100%+, no allocation), who to follow up with to complete payment (60–99%), and
  who to consider for the refund conversation (below 60%).
- **Clear All Records for This Estate** (Admins only) — on Offers, Allocations, and Payments,
  to wipe one estate's records in one register before re-importing a corrected file. This is a
  soft delete (recoverable via the Audit Log), and only affects the one estate/register you're
  in.
- Bulk Import fixes: percentage-formatted cells (e.g. "100%") now import as text correctly
  instead of the raw underlying number; you can set a **Default Property Type** for files that
  don't have that column; and the preview screen now shows every row with a checkbox so you can
  exclude section-divider or repeated-header rows before importing.

## What was already in v3 and earlier

- Offers and Allocations as two separate registers, reached estate-by-estate (click an estate
  card, like the Estates page, to manage just that estate's records with its own serial numbers).
- Dashboard is fully clickable through to the relevant register/estate.
- No date field is required anywhere — fill them in later if you don't have them yet.
- Username + password sign-in (no email needed), forced password change on first sign-in, auto
  sign-out after 1 minute idle.
- Document upload, linked to a user and/or a specific record.
- Admin-defined custom columns on any register, and admin-created custom tabs for entirely
  new record types.
- Roles shown on the Dashboard and top bar for every signed-in user.

---

## IF YOU ALREADY HAVE v4 LIVE — read this first

**Do not run `sql/schema.sql` on your existing project — it is for brand-new projects only.**

To upgrade your live site without losing any data:

1. In your Supabase project, open **SQL Editor → New query**.
2. Open `sql/upgrade_v4_to_v5.sql` from this project, copy its entire contents, paste it in,
   and click **Run**. This adds a "property_type" column to the refunds register (safe to run
   even if it's already there) — nothing existing is touched or deleted.
3. Replace your deployed frontend code with this v5 folder, commit, and push — Vercel
   redeploys automatically. No new npm packages this time.

If you're not yet on v4, run `sql/upgrade_v1_to_v2.sql`, then `sql/upgrade_v2_to_v3.sql`, then
`sql/upgrade_v3_to_v4.sql`, then `sql/upgrade_v4_to_v5.sql`, in that order — all four are safe
to run in sequence.

---

## IF YOU ALREADY HAVE v3 LIVE — read this first

**Do not run `sql/schema.sql` on your existing project — it is for brand-new projects only.**

To upgrade your live site without losing any data:

1. In your Supabase project, open **SQL Editor → New query**.
2. Open `sql/upgrade_v3_to_v4.sql` from this project, copy its entire contents, paste it in,
   and click **Run**. This makes Allocation subscriber names optional, adds the new "payments"
   table, and adds the three expected-fee columns to estate property types — nothing existing
   is touched or deleted.
3. Replace your deployed frontend code with this v4 folder, commit, and push — Vercel
   redeploys automatically. No new npm packages this time.

If you're not yet on v3, run `sql/upgrade_v1_to_v2.sql`, then `sql/upgrade_v2_to_v3.sql`, then
`sql/upgrade_v3_to_v4.sql`, in that order — all three are safe to run in sequence.

---

## IF YOU ALREADY HAVE v2 LIVE — read this first

**Do not run `sql/schema.sql` on your existing project — it is for brand-new projects only.**

To upgrade your live site without losing any data:

1. In your Supabase project, open **SQL Editor → New query**.
2. Open `sql/upgrade_v2_to_v3.sql` from this project, copy its entire contents, paste it in,
   and click **Run**. This creates the two new "offers" and "allocation_records" tables and
   copies every existing row into the right one(s) — nothing is deleted. Your original combined
   data is additionally kept untouched in a table called `subscribers_legacy_v2` as a permanent
   backup.
3. Replace your deployed frontend code with this v3 folder, run `npm install` (to pick up the
   new `xlsx` package used for bulk import), commit, and push — Vercel redeploys automatically.
4. That's it — no changes needed to the edge function or to existing user accounts.

If you're coming straight from v1 (skipped v2 entirely), run `sql/upgrade_v1_to_v2.sql` first,
then `sql/upgrade_v2_to_v3.sql` — both are safe to run in sequence.

---

## IF YOU ALREADY HAVE v1 LIVE — read this first

**Do not run `sql/schema.sql` on your existing project — it is for brand-new projects only.**

To upgrade your live site without losing any data:

1. In your existing Supabase project, open **SQL Editor → New query**.
2. Open `sql/upgrade_v1_to_v2.sql` from this project, copy its entire contents, paste it in,
   and click **Run**. This only adds new tables/columns and migrates your existing PO/FA
   register into the new combined "Subscribers" format — it never deletes anything. Your
   original data is additionally kept untouched in a table called `allocations_legacy` as a
   permanent backup.
3. Redeploy the `admin-create-user` function (Step 4 below) — it has changed to support
   username-based accounts.
4. Replace your deployed frontend code with this v2 folder and redeploy on Vercel (push to the
   same GitHub repo — Vercel redeploys automatically).
5. Existing users can keep signing in exactly as before (their accounts are untouched). Only
   *new* accounts created from now on use the username + forced-password-change flow.

If anything looks wrong after upgrading, your old data is safe in `allocations_legacy` and
nothing was dropped — tell your developer/Claude session and it can be investigated without
risk to your data.

---

## PART 1 — One-time setup (brand-new installs)

### Step 1: Create your Supabase project
1. Go to https://supabase.com → **Start your project** → sign up (free).
2. Click **New project**. Name it `nafilhcc-admin`, choose a strong database password (save it
   somewhere safe), pick a region close to Nigeria (e.g. `eu-west` or `af-south` if available).
3. Wait ~2 minutes for the project to finish provisioning.

### Step 2: Run the database schema
1. In your Supabase project, open **SQL Editor** (left sidebar) → **New query**.
2. Open the file `sql/schema.sql` from this project, copy its entire contents, paste into the
   SQL editor, and click **Run**.
3. You should see "Success. No rows returned." This has created every table, security rule,
   storage bucket, and audit trigger the system needs.

### Step 3: Get your API keys
1. In Supabase, go to **Project Settings → API**.
2. Copy the **Project URL** and the **anon public** key.
3. In this project folder, copy `.env.example` to a new file named `.env` and paste in your
   values:
   ```
   VITE_SUPABASE_URL=https://xxxxxxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
   ```

### Step 4: Deploy the "create user" function (needed for Admins to add staff accounts)
This one function must run on Supabase's servers (not in the browser) because creating a
login account requires a secret key that must never be shown to users. It also generates the
hidden internal email behind each username.

1. Install the Supabase CLI on your computer (one-time): follow
   https://supabase.com/docs/guides/cli/getting-started for your OS (Windows/Mac/Linux).
2. In a terminal, inside this project folder, run:
   ```
   supabase login
   supabase link --project-ref YOUR-PROJECT-REF   (found in Project Settings → General)
   supabase functions deploy admin-create-user
   ```
3. (Optional) In **Project Settings → Edge Functions → admin-create-user → Secrets**, you can
   set `LOGIN_EMAIL_DOMAIN` to any placeholder domain you like (default:
   `login.nafilhcc.internal`). This is never shown to anyone or emailed — it only exists
   because Supabase's login system technically requires an email format internally.

> If you're not comfortable with the command line, you can instead paste the function code
> from `supabase/functions/admin-create-user/index.ts` directly into
> **Supabase Dashboard → Edge Functions → Create a new function**, name it
> `admin-create-user`, and deploy from there.

### Step 5: Deploy the website (Vercel)
1. Push this whole project folder to a GitHub repository (create one at github.com if you
   don't have one; upload the folder or use `git push`).
2. Go to https://vercel.com → sign up free with your GitHub account.
3. Click **Add New → Project**, select your repository.
4. Under **Environment Variables**, add:
   - `VITE_SUPABASE_URL` = (same value as your `.env`)
   - `VITE_SUPABASE_ANON_KEY` = (same value as your `.env`)
5. Click **Deploy**. In under a minute you'll get a live link like
   `https://nafilhcc-admin.vercel.app` — this is your system's online address.
6. (Optional) Under **Project Settings → Domains**, add your own domain, e.g.
   `admin.nafilhcc.com`, if you own one.

### Step 6: Create the first Super Admin
The very first account needs to be created by hand, since no admin exists yet to create one
through the app.
1. In Supabase Dashboard → **Authentication → Users → Add user**, create yourself an account.
   Use any email format you like (e.g. `you@nafilhcc.com` or `admin@login.nafilhcc.internal`)
   and a strong password (tick "Auto Confirm User").
2. Go to **Table Editor → profiles**, find the row for that account, and set:
   - `role` → `super_admin`
   - `username` → whatever you want to sign in with (e.g. `superadmin`)
   - `must_change_password` → `false` (since you set your own password already)
3. Visit your live website link and sign in with that **username** and the password you set.
   You now have full access, including creating other Admins, Supervisors, and Users from the
   **Users & Access** tab — no more manual database editing needed after this.

---

## PART 2 — How the roles work

| Role | Can do |
|---|---|
| **Super Admin** | Everything, including creating other Admins/Super Admins. There should normally be only 1–2 of these (e.g. the MD/ED or IT head). |
| **Admin** | Create/manage estates, custom columns, custom tabs, create Supervisors/Users, approve edit/delete requests, view audit log. |
| **Supervisor** | Manages an assigned group of Users; approves or rejects their edit/delete requests; can edit/delete records directly. |
| **User** | Enters Subscriber/Approval/Refund/custom-tab records. Cannot edit or delete a record directly — every edit or delete first goes to their Supervisor (or an Admin) as a **request**, shown under **Edit/Delete Requests**, and only takes effect once approved. |

The role assigned when an account is created is shown on that person's **Dashboard** and in
the top bar of every screen, so it's always clear what access someone has.

Every single insert, update, and delete in the system — no matter who does it — is written
automatically to the **Audit Log**, with who did it and exactly what changed.

---

## PART 3 — Signing in, passwords, and security

- **Username, not email**: Admins create accounts with a username (e.g. `jane.doe`) and a
  temporary password. The person signs in with that username.
- **Forced password change**: the first time a new account signs in, they are required to set
  their own password before they can do anything else in the system.
- **Auto sign-out after 1 minute of inactivity**: if a screen is left signed in and untouched
  (no mouse, keyboard, or touch activity) for 60 seconds, the system automatically signs the
  person out, so no one else can use or view the account if they walk away. Signing back in
  only needs the username and password again.
- An Admin/Supervisor can force any account to set a new password at any time from **Users &
  Access → Force Password Reset**.

---

## PART 4 — Day-to-day usage

- **Dashboard**: shows who's signed in and their role, plus totals for Offers/Allocations made,
  ownership changes, active estates, approved expenditure, approved refunds, and charts of
  records by estate and by property type.
- **Estates**: Admins create estates here (name, category = site & services or carcass level)
  and define the list of property types for that estate (e.g. `3br, 4br, 500sqm, 1 hectare`) —
  these automatically appear as a dropdown when anyone records an offer or allocation for that
  estate.
- **Offers**: the digital version of your Offer register — Subscriber Name, Form No/PON,
  Property Type, Phone, Email, Offer Printed/Collected, Offer Collected By/On, Amount Paid,
  Comment, Remarks. Nothing here is required except Estate and Subscriber Name — dates and
  everything else can be filled in later. Filter by estate or status, search, and click
  **Manage Columns** to add any extra field your office needs, or **Bulk Import from Excel** to
  load a whole estate's worth of offers at once (see Part 4a below).
- **Allocations**: the digital version of your Allocation register — House No, Subscriber Name,
  Property Type, Printed/Signed/Collected, Collected By, Date Collected, Phone Number, Remarks.
  Same optional-dates rule, same **Manage Columns** and **Bulk Import from Excel** options.
- **Change of Ownership**: from a row in either the Offers or Allocations register, click
  **Record COO** — enter the new owner's name, reason, and (if reissued) a new Form No/House No.
  This logs full history under the **Change of Ownership** tab and updates the name on the live
  record (subject to supervisor approval if a regular User does it).
- **Approvals / Expenditure**: title, purpose, category, optional estate, who applied, who was
  paid, amount applied vs approved, date. Filter by category or estate and see totals plus a
  bar chart of approved spend per category.
- **Refunds**: subscriber, optional estate, reason, who processed it, amounts, approval date,
  account paid to, with running totals.
- **Documents**: upload any file (e.g. a scanned signed letter, ID, or supporting document) and
  link it to a staff account and/or a specific record. Open it from **Documents** in the
  sidebar, or from **Docs** next to any offer/allocation record, or from **Documents** next to
  any user in **Users & Access**.
- **Custom Tabs** (Admins/Super Admins): add a completely new section to the sidebar for a
  record type not covered yet (e.g. "Site Visits", "Complaints"). Give it a name, then use
  **Manage Columns** to define its fields — it behaves like any other register (add, edit,
  delete with approval workflow, search).
- **Edit/Delete Requests**: where Users' change requests wait for a Supervisor/Admin to approve
  or reject.
- **Audit Log**: full history of every change made in the system (Supervisor/Admin/Super Admin
  only).

### Adding a custom column to an existing register
Open **Offers**, **Allocations**, **Approvals/Expenditure**, **Refunds**, or any custom tab →
click **Manage Columns** → **Add a New Column** → give it a name and a type (Text, Number, Date,
Dropdown, or Checkbox). It immediately appears as a field on the entry form and as an extra
column in the table for everyone — no code changes, no downtime, and it never affects existing
data.

---

## PART 4a — Bulk importing your existing 7,000+ records from Excel

Both **Offers** and **Allocations** have a **Bulk Import from Excel** button. Each file you
import must belong to a single estate and a single register (Offers or Allocations) — so if
you have separate spreadsheets per estate (e.g. `2br_payment.xlsx`, `ALLOCATION_-_2BR.xlsx`,
etc.), import each one separately, picking the right estate each time.

1. Click **Bulk Import from Excel** on the Offers or Allocations register.
2. Select the **estate** this file belongs to.
3. Upload the `.xlsx`/`.xls`/`.csv` file. The first row of the file should be column headers
   (e.g. "Subscriber", "House No", "Printed", "Signed", "Collected", "Remarks").
4. The system guesses which column matches which field — check the mapping and fix anything
   it guessed wrong, or set a column to "Ignore this column" (useful for a "Serial" column,
   which the system numbers automatically anyway).
5. Preview the first few rows exactly as they'll be saved, then click **Import**.
6. Rows missing the Subscriber Name are skipped automatically and reported in the summary at
   the end — everything else imports even if some fields (like dates) are blank.

For checkbox-style columns (Printed / Signed / Collected / Offer Printed / Offer Collected):
any cell that isn't blank counts as "checked" — so a "✔", "P", "C", "X", or "Yes" in that
column all work the same way. Names with typos, inconsistent titles, or spelling differences
between your Offer and Allocation sheets are not auto-matched between the two registers — they
import as separate rows exactly as written, and you can clean up duplicates or link them later
using **Manage Columns** / manual edits if needed.

---


## PART 5 — Keeping the live system safe during future upgrades

- Never run `DROP TABLE` or `DELETE FROM` broadly on production data.
- New features should be added as new tables/columns (`ALTER TABLE ... ADD COLUMN IF NOT
  EXISTS ...`), which is non-destructive to existing rows — this is exactly how
  `sql/upgrade_v1_to_v2.sql` was written, and how future upgrade scripts should be written too.
- Before any schema change, use Supabase's **Database → Backups** (or Table Editor → Export) to
  download a CSV/backup snapshot first.
- Test changes on a free **Supabase branch/staging project** if you want extra safety, then
  apply the same SQL to production once confirmed.

---

## PART 6 — Security notes

- All data access is enforced at the database level (Row Level Security), not just hidden in
  the app — so even if someone bypassed the website, the same rules apply.
- Only Admins/Super Admins can create login accounts, and only through a locked-down function
  that runs on Supabase's servers.
- Passwords are never stored or visible to Admins — Supabase's authentication system handles
  hashing/storage securely; new accounts are forced to set their own password on first sign-in.
- Sessions automatically end after 1 minute of inactivity.
- Uploaded documents are stored in a private (non-public) storage bucket — only signed-in users
  can access them, and only Supervisors/Admins can delete them.
- Use strong, unique passwords for the Supabase project owner account and enable 2FA on your
  Supabase and Vercel accounts (both support it under Account Settings).

---

## Project structure
```
nafil-admin/
├── sql/schema.sql                       ← run once, brand-new Supabase projects only
├── sql/upgrade_v1_to_v2.sql             ← run once on an existing live v1 project
├── sql/upgrade_v2_to_v3.sql             ← run once on an existing live v2 project
├── sql/upgrade_v3_to_v4.sql             ← run once on an existing live v3 project instead
├── sql/upgrade_v4_to_v5.sql             ← run once on an existing live v4 project instead
├── supabase/functions/admin-create-user ← deploy once (or redeploy after upgrading) via Supabase CLI
├── src/
│   ├── components/                      ← all screens (Dashboard, Estates, Offers, Allocations, etc.)
│   ├── lib/                             ← Supabase client, auth context, permission + custom-field helpers
│   ├── App.jsx, main.jsx, styles.css
├── public/logo.jpeg                     ← your company logo
├── .env.example                         ← copy to .env with your Supabase keys
└── package.json
```

## Running it on your own computer (optional, for testing before deploying)
```
npm install
npm run dev
```
Then open the link it prints (usually http://localhost:5173).
