# School Manager

A web app that replaces the paper attendance register and fee book in a school. Teachers mark attendance in seconds, the bursar records payments and prints receipts, and parents can check their child's attendance and fee balance from their phone.

**Live demo:** https://YOUR-SITE.netlify.app
**Demo logins** (one per role, password `Demo@1234`):

| Role | Email |
|---|---|
| Admin | admin@demo.com |
| Teacher | teacher@demo.com |
| Parent | parent@demo.com |

> The demo data is shared and may be reset at any time.

![Admin dashboard](screenshots/dashboard.png)

## The problem

Many schools still track attendance in paper registers and fees in a handwritten book. Totals are added up by hand, part payments are easy to lose, parents have to visit the office to ask what they owe, and nobody can quickly see which students are often absent.

## What it does

**Admin (bursar or principal)**
- Dashboard with students, fees expected, fees collected, outstanding balances and recent attendance
- Add, edit and delete students and classes, and assign class teachers
- Set fee items per class per term (Tuition, Books, Uniform) in one go
- Record full or part payments, with an automatic receipt number and a printable receipt showing the balance after that payment
- Outstanding balances list with a class filter and CSV download
- Attendance reports by class and date range, with students below 75% flagged

**Teacher**
- Pick a class and date, mark each student present, absent or late, and save
- Everyone starts as present so only the exceptions need changing
- Can only see and mark their own class

**Parent**
- Sees only their own children
- Fee breakdown, payments made, balance, and the last 30 days of attendance

## Tech stack

- **Frontend:** HTML, CSS and vanilla JavaScript (ES modules, no framework or build step)
- **Backend:** Supabase (PostgreSQL, Auth and Row Level Security)
- **Hosting:** Netlify

## How it works

- **Role-based access.** A shared `guard.js` checks the signed-in user's role on every page and redirects anyone who is not allowed.
- **Security lives in the database, not the browser.** Row Level Security policies decide who can read and write each table, so a parent cannot see another family's data even if they edit the page in their browser. Teachers cannot see any payment data.
- **Fee balances are calculated in a database view** (`student_balances`) from fee items and payments, so the figure is always consistent between the dashboard, the students list and the parent page.
- **Data integrity is enforced by constraints:** one attendance record per student per day, positive payment amounts, a single current term, and unique receipt numbers.
- **Safe rendering.** All user-supplied text is escaped before it is shown, and CSV exports are protected against spreadsheet formula injection.

## Database

`classes`, `students`, `terms`, `fee_items`, `payments`, `attendance`, plus `profiles` linked to Supabase Auth. The full schema and security policies are in [`sql/schema.sql`](sql/schema.sql), and demo data is in [`sql/seed.sql`](sql/seed.sql).

## Run it yourself

1. Create a free project at [supabase.com](https://supabase.com).
2. In the SQL Editor, create the `profiles` table (see below), then run `sql/schema.sql` and `sql/seed.sql`.
3. In Authentication, create the three demo users and add a `profiles` row for each with the role `admin`, `teacher` or `parent`.
4. Copy your project URL and anon key into `js/config.js`.
5. Serve the folder with any static server (for example the VS Code Live Server extension). Opening the files directly will not work because the app uses ES modules.

```sql
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role text not null check (role in ('admin', 'teacher', 'parent')),
  phone text
);
alter table public.profiles enable row level security;
create policy "Users can read their own profile"
  on public.profiles for select using (auth.uid() = id);
```

## What I learned

- Writing Row Level Security policies, and why helper functions marked `security definer` are needed to avoid policies that call each other in a loop.
- Putting access control in the database instead of trusting the browser.
- Building a multi-page app with vanilla JavaScript: shared layout, shared guard, and small reusable helpers.
- Handling the unglamorous cases: part payments, overpayment checks, saving the same attendance day twice, and database row limits when reporting.

## What I would add next

- Online fee payment with Paystack
- SMS or email reminders for unpaid fees
- Creating terms and user accounts from inside the app
- Parent receipts and a password reset page
- Charts on the dashboard

## Author

Built by YOUR NAME. [Portfolio](https://YOUR-PORTFOLIO) | [LinkedIn](https://linkedin.com/in/YOUR-PROFILE)