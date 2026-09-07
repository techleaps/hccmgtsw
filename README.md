# NAFILHCC Administrative Management System (v2)

A secure, online replacement for the manual Provisional Offer (PO), Final Allocation (FA),
Change of Ownership (COO), Approvals/Expenditure, and Refunds registers — with role-based
access, full audit logging, a supervisor approval workflow for edits/deletes, admin-defined
custom columns and tabs, document uploads, and username-based sign-in.

Built with **free-tier services**, the same pattern as your Document Tracker:
- **Supabase** (free tier) — database, authentication, security rules, file storage, serverless functions
- **Vercel** (free tier) — hosts the website itself

---

## What's new in v2

- **Username + password sign-in** — no email address needed. New accounts must set their own
  password the first time they sign in.
- **Auto sign-out after 1 minute idle** — protects the screen if someone walks away.
- **Documents** — upload files and link them to a specific user and/or a specific record
  (e.g. a scanned signed offer letter attached to a subscriber's record).
- **Admin-defined custom columns** — add extra fields to the Subscribers, Approvals, Refunds
  registers (or any custom tab) at any time, from the app itself — no developer needed.
- **Admin-created custom tabs** — add a brand-new register/section to the sidebar (its own
  admin-defined columns) without touching code.
- **Subscribers register redesigned** to match your office register exactly: PON, Estate,
  Property Type, Offer/Allocated checkboxes, Allocation Number, phone/email, Offer
  Printed/Collected, Offer/Allocation Collected By, Amount Paid (Property/Infrastructure),
  Legal/TDP, Comment, Remarks — with Change of Ownership recorded directly from a subscriber's
  row.
- Roles are now clearly assigned at account creation and shown on the Dashboard and in the top
  bar for every signed-in user.

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
  subscribers by estate and by property type.
- **Estates**: Admins create estates here (name, category = site & services or carcass level)
  and define the list of property types for that estate (e.g. `3br, 4br, 500sqm, 1 hectare`) —
  these automatically appear as a dropdown when anyone records a subscriber for that estate.
- **Subscribers (PO / FA)**: the digital version of your office register — one row per
  subscriber holding both their Offer and Allocation details (PON, Property Type, Offer made /
  printed / collected, Allocation Number, Allocation collected by, phone, email, amounts paid,
  Legal/TDP, comments, remarks). Filter by estate or by status (Offer made / Allocated / Both /
  Neither), search, and click **Manage Columns** to add any extra field your office needs.
- **Change of Ownership**: from a subscriber's row in the Subscribers register, click
  **Record COO** — enter the new owner's name, reason, and (if reissued) a new PON/allocation
  number. This logs full history under the **Change of Ownership** tab and updates the name on
  the live record (subject to supervisor approval if a regular User does it).
- **Approvals / Expenditure**: title, purpose, category, optional estate, who applied, who was
  paid, amount applied vs approved, date. Filter by category or estate and see totals plus a
  bar chart of approved spend per category.
- **Refunds**: subscriber, optional estate, reason, who processed it, amounts, approval date,
  account paid to, with running totals.
- **Documents**: upload any file (e.g. a scanned signed letter, ID, or supporting document) and
  link it to a staff account and/or a specific record. Open it from **Documents** in the
  sidebar, or from **Docs** next to any subscriber record, or from **Documents** next to any
  user in **Users & Access**.
- **Custom Tabs** (Admins/Super Admins): add a completely new section to the sidebar for a
  record type not covered yet (e.g. "Site Visits", "Complaints"). Give it a name, then use
  **Manage Columns** to define its fields — it behaves like any other register (add, edit,
  delete with approval workflow, search).
- **Edit/Delete Requests**: where Users' change requests wait for a Supervisor/Admin to approve
  or reject.
- **Audit Log**: full history of every change made in the system (Supervisor/Admin/Super Admin
  only).

### Adding a custom column to an existing register
Open **Subscribers**, **Approvals/Expenditure**, **Refunds**, or any custom tab → click
**Manage Columns** → **Add a New Column** → give it a name and a type (Text, Number, Date,
Dropdown, or Checkbox). It immediately appears as a field on the entry form and as an extra
column in the table for everyone — no code changes, no downtime, and it never affects existing
data.

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
├── sql/upgrade_v1_to_v2.sql             ← run once on an existing live v1 project instead
├── supabase/functions/admin-create-user ← deploy once (or redeploy after upgrading) via Supabase CLI
├── src/
│   ├── components/                      ← all screens (Dashboard, Estates, Subscribers, etc.)
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
