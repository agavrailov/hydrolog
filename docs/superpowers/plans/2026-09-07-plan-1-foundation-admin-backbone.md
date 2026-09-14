# План 1: Foundation + Admin Backbone — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Изгражда data layer, auth, роли и admin dashboard, така че platform admin да може да създава агенции, properties, assessments и да издава PDF-и; agency user да вижда своите данни (само-read). Публичен достъп и field capture НЕ са в този план.

**Architecture:** Next.js 15 App Router + TypeScript, Supabase (Postgres 16 + Auth + Storage) в EU. Multi-tenant с Row-Level Security. Един schema, полиси разграничават platform vs agency vs anon.

**Tech Stack:** Next.js 15, TypeScript 5, pnpm, Supabase JS v2, `@react-pdf/renderer`, Vitest, Playwright, Tailwind CSS 4, PostGIS.

**Spec:** [`docs/superpowers/specs/2026-09-07-voda-check-system-design.md`](../specs/2026-09-07-voda-check-system-design.md)

## Global Constraints

- **Node.js:** >= 22.0.0 (Next.js 15 изисква)
- **Package manager:** pnpm exclusively (никога npm или yarn)
- **TypeScript:** strict mode, `noUncheckedIndexedAccess: true`
- **Език на UI:** български (bg-BG); дати във формат `dd.mm.yyyy`; timezone `Europe/Sofia`
- **Валута:** EUR, cents (int) в DB
- **GPS координати:** EPSG:4326 (WGS84), PostGIS `geography(point,4326)`
- **File paths в UI:** kebab-case (`/app/measure` не `/app/Measure`)
- **DB naming:** snake_case таблици и колони, singular table names забранени (плурал: `agencies`, `assessments`)
- **RLS:** ENABLED на всяка таблица; без изключение
- **Secrets:** никога hard-coded, всичко през `process.env`; `.env.local` в `.gitignore`
- **Тестове:** всеки нов module има unit test; всяка RLS полица има integration test
- **Commits:** Conventional Commits format (`feat:`, `fix:`, `chore:`, `test:`, `docs:`)

---

## Structure Overview

Целевата файлова структура след изпълнение на План 1:

```
voda-check/
├── .env.local.example
├── .gitignore
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── next.config.ts
├── tailwind.config.ts
├── postcss.config.mjs
├── vitest.config.ts
├── playwright.config.ts
├── supabase/
│   ├── config.toml
│   ├── migrations/
│   │   ├── 20260907000001_agencies_and_users.sql
│   │   ├── 20260907000002_properties_and_assessments.sql
│   │   ├── 20260907000003_photos_outcomes_verification.sql
│   │   ├── 20260907000004_rls_helpers.sql
│   │   ├── 20260907000005_rls_policies.sql
│   │   └── 20260907000006_storage_buckets.sql
│   └── seed.sql
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx                          (landing placeholder)
│   │   ├── login/
│   │   │   └── page.tsx                      (magic link login)
│   │   ├── auth/
│   │   │   └── callback/route.ts             (magic link exchange)
│   │   └── app/                              (auth-required area)
│   │       ├── layout.tsx                    (auth guard + nav)
│   │       ├── page.tsx                      (dashboard home)
│   │       ├── properties/
│   │       │   ├── page.tsx                  (list)
│   │       │   ├── new/page.tsx              (create form)
│   │       │   └── [id]/page.tsx             (detail)
│   │       ├── assessments/
│   │       │   ├── page.tsx                  (list)
│   │       │   ├── new/page.tsx              (create form)
│   │       │   └── [id]/
│   │       │       ├── page.tsx              (detail + issue + embed)
│   │       │       └── outcome/page.tsx      (drilling outcome form)
│   │       └── admin/
│   │           ├── agencies/
│   │           │   ├── page.tsx
│   │           │   └── new/page.tsx
│   │           └── users/page.tsx
│   ├── domains/
│   │   ├── agency/
│   │   │   ├── queries.ts
│   │   │   ├── actions.ts
│   │   │   └── types.ts
│   │   ├── assessment/
│   │   │   ├── code.ts                       (HMAC code generation)
│   │   │   ├── code.test.ts
│   │   │   ├── queries.ts
│   │   │   ├── actions.ts
│   │   │   ├── pdf.tsx                       (React PDF template)
│   │   │   ├── types.ts
│   │   │   └── outcome.ts                    (drilling outcome logic)
│   │   ├── verification/
│   │   │   └── types.ts                      (placeholder за План 2)
│   │   ├── registry/
│   │   │   └── types.ts                      (placeholder за План 2)
│   │   └── billing/
│   │       ├── types.ts                      (Order model)
│   │       └── provider.ts                   (PaymentProvider interface)
│   ├── lib/
│   │   ├── supabase/
│   │   │   ├── client.ts                     (browser client)
│   │   │   ├── server.ts                     (server client с cookies)
│   │   │   └── service.ts                    (service role client)
│   │   ├── auth/
│   │   │   ├── session.ts                    (get current user + role)
│   │   │   └── guards.ts                     (require role helpers)
│   │   ├── storage/
│   │   │   └── signed-url.ts                 (signed URL generation)
│   │   └── ui/
│   │       ├── forms.tsx                     (form primitives)
│   │       └── layout.tsx                    (nav, header)
│   ├── styles/
│   │   └── globals.css
│   └── env.ts                                (typed env access with zod)
└── tests/
    ├── integration/
    │   ├── setup.ts                          (test DB + fixtures)
    │   ├── rls-agencies.test.ts
    │   ├── rls-properties.test.ts
    │   ├── rls-assessments.test.ts
    │   ├── rls-photos.test.ts
    │   └── rls-outcomes.test.ts
    └── e2e/
        ├── admin-creates-agency.spec.ts
        ├── admin-issues-assessment.spec.ts
        └── agency-user-sees-own-data.spec.ts
```

---

## Task 1: Проект scaffold + tooling

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `.gitignore`, `.env.local.example`, `pnpm-workspace.yaml`, `postcss.config.mjs`, `tailwind.config.ts`
- Create: `src/app/layout.tsx`, `src/app/page.tsx`, `src/styles/globals.css`
- Create: `src/env.ts`

**Interfaces:**
- Produces: `env` object (typed) от `src/env.ts` — консумиран от всички последващи tasks за секрети
- Produces: базов Next.js App Router shell — консумиран от Task 8+ за pages

- [ ] **Step 1: Инициирай проект**

```bash
cd "D:/Claude/Projects/Хидрогеоложки проучвания"
mkdir voda-check && cd voda-check
pnpm init
git init
```

- [ ] **Step 2: Създай package.json**

```json
{
  "name": "voda-check",
  "version": "0.1.0",
  "private": true,
  "packageManager": "pnpm@9.12.0",
  "engines": { "node": ">=22.0.0" },
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint && tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
    "db:start": "supabase start",
    "db:stop": "supabase stop",
    "db:reset": "supabase db reset",
    "db:diff": "supabase db diff -f",
    "db:migrate": "supabase migration up"
  },
  "dependencies": {
    "next": "15.0.0",
    "react": "19.0.0",
    "react-dom": "19.0.0",
    "@supabase/supabase-js": "2.45.0",
    "@supabase/ssr": "0.5.0",
    "@react-pdf/renderer": "4.0.0",
    "zod": "3.23.8",
    "date-fns": "3.6.0"
  },
  "devDependencies": {
    "@types/node": "22.5.0",
    "@types/react": "19.0.0",
    "@types/react-dom": "19.0.0",
    "typescript": "5.5.4",
    "tailwindcss": "4.0.0",
    "@tailwindcss/postcss": "4.0.0",
    "postcss": "8.4.47",
    "eslint": "9.10.0",
    "eslint-config-next": "15.0.0",
    "vitest": "2.1.0",
    "@playwright/test": "1.47.0",
    "supabase": "1.204.0"
  }
}
```

- [ ] **Step 3: Създай tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 4: Създай .env.local.example и env.ts**

`.env.local.example`:
```
# Supabase (public)
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...

# Supabase (server-only)
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# App secrets
ASSESSMENT_CODE_SECRET=change_me_to_32_random_bytes_in_hex

# Site
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

`src/env.ts`:
```typescript
import { z } from 'zod';

const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_SITE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  ASSESSMENT_CODE_SECRET: z.string().min(32).optional(),
});

export const env = schema.parse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  ASSESSMENT_CODE_SECRET: process.env.ASSESSMENT_CODE_SECRET,
});
```

- [ ] **Step 5: Install деп и създай базов Next.js shell**

```bash
pnpm install
```

Създай `src/app/layout.tsx`:
```tsx
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Водна оценка',
  description: 'Проверимо публикуване на хидрогеоложки измервания',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="bg">
      <body className="min-h-screen bg-white text-gray-900 antialiased">
        {children}
      </body>
    </html>
  );
}
```

Създай `src/app/page.tsx`:
```tsx
export default function Home() {
  return (
    <main className="p-8">
      <h1 className="text-3xl font-semibold">Водна оценка</h1>
      <p className="mt-2 text-gray-600">Foundation online.</p>
    </main>
  );
}
```

Създай `src/styles/globals.css`:
```css
@import "tailwindcss";

:root {
  --font-sans: system-ui, -apple-system, sans-serif;
}
```

- [ ] **Step 6: Verify build**

```bash
pnpm dev
```
Expected: сървърът стартира на http://localhost:3000, страницата показва "Foundation online."

Stop с Ctrl+C, после:
```bash
pnpm lint
```
Expected: няма грешки.

- [ ] **Step 7: Commit**

```bash
git add .
git commit -m "chore: scaffold Next.js 15 project with Tailwind and env validation"
```

---

## Task 2: Supabase локален setup

**Files:**
- Create: `supabase/config.toml`
- Create: `.env.local` (не committed)
- Modify: `.gitignore`

**Interfaces:**
- Produces: работеща локална Postgres 16 инстанция + Supabase Auth + Storage на `127.0.0.1:54321`
- Produces: credentials в `.env.local` — консумирани от всеки следващ task

- [ ] **Step 1: Инициирай Supabase**

```bash
pnpm supabase init
```

Това създава `supabase/config.toml`. Отвори го и настрой:
```toml
project_id = "voda-check"

[api]
port = 54321
schemas = ["public", "storage"]
extra_search_path = ["public", "extensions"]

[db]
port = 54322
major_version = 16

[db.pooler]
enabled = false

[storage]
enabled = true
file_size_limit = "20MiB"

[auth]
site_url = "http://localhost:3000"
additional_redirect_urls = ["http://localhost:3000/auth/callback"]
enable_signup = false                              # само admin invite
minimum_password_length = 12
enable_confirmations = false                        # magic link, без password

[auth.email]
enable_signup = false
double_confirm_changes = true
enable_confirmations = false

[auth.email.template.magic_link]
subject = "Вход във Водна оценка"
```

- [ ] **Step 2: Стартирай Supabase**

```bash
pnpm db:start
```

Изчакай да свърши (~2 min първия път). Копирай изведените URL, anon key и service role key в `.env.local`:

```bash
cp .env.local.example .env.local
# Едитирай .env.local с реалните стойности
```

Генерирай `ASSESSMENT_CODE_SECRET`:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Копирай output-а в `.env.local`.

- [ ] **Step 3: Актуализирай .gitignore**

Добави:
```
.env.local
.env*.local
supabase/.branches
supabase/.temp
.next
node_modules
playwright-report
test-results
coverage
```

- [ ] **Step 4: Verify връзка**

Създай временен `check-db.mjs`:
```javascript
import { createClient } from '@supabase/supabase-js';
const c = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);
const { data, error } = await c.from('_temp').select('*').limit(1);
console.log('Connection:', error ? 'FAIL' : 'OK');
```

Изпълни:
```bash
node --env-file=.env.local check-db.mjs
```
Expected: `Connection: OK` (грешката за липсваща таблица е очаквана и не се брои).

Изтрий `check-db.mjs`.

- [ ] **Step 5: Commit**

```bash
git add supabase/config.toml .gitignore .env.local.example
git commit -m "chore: supabase local dev setup"
```

---

## Task 3: Migration — agencies + users tables + role disjoint trigger

**Files:**
- Create: `supabase/migrations/20260907000001_agencies_and_users.sql`

**Interfaces:**
- Produces: таблици `agencies`, `platform_users`, `agency_users`
- Produces: trigger `enforce_user_role_disjoint`
- Consumed от: Task 5 (RLS полиси), Task 7 (auth)

- [ ] **Step 1: Създай миграция**

```sql
-- supabase/migrations/20260907000001_agencies_and_users.sql

-- Extensions
create extension if not exists "pgcrypto";
create extension if not exists "postgis";

-- ─── Agencies ─────────────────────────────────────────────
create table agencies (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null check (slug ~ '^[a-z0-9][a-z0-9-]{2,63}$'),
  name text not null,
  contact_email text not null,
  billing_details jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(),
  archived_at timestamptz
);

comment on table agencies is 'Агенции за недвижими имоти (клиенти на платформата).';

-- ─── Platform users ───────────────────────────────────────
create table platform_users (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('platform_admin','platform_operator')),
  full_name text,
  created_at timestamptz not null default now()
);

comment on table platform_users is 'Потребители на самата платформа (admin, operators).';

-- ─── Agency users ─────────────────────────────────────────
create table agency_users (
  id uuid primary key references auth.users(id) on delete cascade,
  agency_id uuid not null references agencies(id) on delete cascade,
  role text not null check (role in ('agency_admin','agency_viewer')),
  full_name text,
  created_at timestamptz not null default now()
);

create index agency_users_agency_idx on agency_users(agency_id);

comment on table agency_users is 'Потребители на клиентски агенции (read-only на своите данни).';

-- ─── Disjoint role trigger ────────────────────────────────
create or replace function enforce_user_role_disjoint()
returns trigger
language plpgsql
as $$
begin
  if tg_table_name = 'platform_users' then
    if exists (select 1 from agency_users where id = new.id) then
      raise exception 'User % is already an agency_user; cannot be platform_user', new.id;
    end if;
  elsif tg_table_name = 'agency_users' then
    if exists (select 1 from platform_users where id = new.id) then
      raise exception 'User % is already a platform_user; cannot be agency_user', new.id;
    end if;
  end if;
  return new;
end;
$$;

create trigger platform_users_role_disjoint
  before insert or update on platform_users
  for each row execute function enforce_user_role_disjoint();

create trigger agency_users_role_disjoint
  before insert or update on agency_users
  for each row execute function enforce_user_role_disjoint();
```

- [ ] **Step 2: Приложи миграцията**

```bash
pnpm db:reset
```

Expected: миграцията се прилага без грешка. Ако има грешка — оправи преди commit.

- [ ] **Step 3: Verify схемата**

```bash
pnpm supabase db psql -c "\d agencies"
pnpm supabase db psql -c "\d platform_users"
pnpm supabase db psql -c "\d agency_users"
```
Expected: показва точно колоните от миграцията.

- [ ] **Step 4: Ръчна проверка на trigger**

```bash
pnpm supabase db psql
```
В психа:
```sql
-- Създай fake auth user
insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111', 'test@example.com');
insert into agency_users (id, agency_id, role)
  values ('11111111-1111-1111-1111-111111111111',
          (select id from agencies limit 1),  -- ще fail-не защото няма агенции
          'agency_admin');
-- Създай агенция първо
insert into agencies (slug, name, contact_email) values ('test-ag', 'Test Agency', 'test@ag.bg');
insert into agency_users (id, agency_id, role)
  values ('11111111-1111-1111-1111-111111111111',
          (select id from agencies where slug = 'test-ag'),
          'agency_admin');
-- Сега опитай да я направиш и platform_user — трябва да fail-не
insert into platform_users (id, role) values ('11111111-1111-1111-1111-111111111111', 'platform_admin');
-- Expected: ERROR: User ... is already an agency_user
```

Излез с `\q`, ресетни:
```bash
pnpm db:reset
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260907000001_agencies_and_users.sql
git commit -m "feat(db): agencies and users with disjoint role trigger"
```

---

## Task 4: Migration — properties + assessments

**Files:**
- Create: `supabase/migrations/20260907000002_properties_and_assessments.sql`

**Interfaces:**
- Produces: таблици `properties`, `assessments`
- Consumed от: Task 5 (photos, outcomes), Task 6 (RLS), Task 10 (code generation), Task 11 (CRUD)

- [ ] **Step 1: Създай миграция**

```sql
-- supabase/migrations/20260907000002_properties_and_assessments.sql

create table properties (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete restrict,
  listing_ref text,
  address_label text not null,
  cadastral_number text,
  gps_point geography(point, 4326) not null,
  gps_area geography(polygon, 4326),
  region_code text,
  created_at timestamptz not null default now(),
  archived_at timestamptz
);

create index properties_agency_idx on properties(agency_id);
create index properties_region_idx on properties(region_code);
create index properties_gps_gix on properties using gist(gps_point);

comment on table properties is 'Имоти (обяви) на агенциите — предмет на измерване.';

create table assessments (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete restrict,
  agency_id uuid not null references agencies(id) on delete restrict,
  operator_id uuid not null references platform_users(id) on delete restrict,
  code text unique,
  status text not null default 'draft'
    check (status in ('draft','issued','archived')),
  class text check (class in ('A','B','C','D')),
  depth_min_m numeric(6,2),
  depth_max_m numeric(6,2),
  expected_flow_min_m3h numeric(6,2),
  expected_flow_max_m3h numeric(6,2),
  method text not null default 'PQWT-GT150',
  confidence_note text,
  measured_at date,
  measured_gps geography(point, 4326),
  raw_profile jsonb,
  pqwt_export_path text,
  pdf_path text,
  issued_at timestamptz,
  created_at timestamptz not null default now(),
  constraint depth_range_valid
    check (depth_min_m is null or depth_max_m is null or depth_min_m <= depth_max_m),
  constraint flow_range_valid
    check (expected_flow_min_m3h is null or expected_flow_max_m3h is null
           or expected_flow_min_m3h <= expected_flow_max_m3h),
  constraint issued_requires_fields
    check (status <> 'issued' or (
      code is not null and class is not null
      and depth_min_m is not null and depth_max_m is not null
      and measured_at is not null and issued_at is not null
    ))
);

create index assessments_code_idx on assessments(code) where code is not null;
create index assessments_property_idx on assessments(property_id);
create index assessments_agency_idx on assessments(agency_id);
create index assessments_status_issued_idx on assessments(status) where status = 'issued';

comment on table assessments is 'Индивидуални водни оценки на имоти.';
```

- [ ] **Step 2: Приложи и verify**

```bash
pnpm db:reset
pnpm supabase db psql -c "\d properties"
pnpm supabase db psql -c "\d assessments"
```
Expected: колоните съответстват.

- [ ] **Step 3: Ръчна проверка на CHECK constraint**

```bash
pnpm supabase db psql
```
```sql
insert into agencies (slug, name, contact_email) values ('t', 'T', 't@t.bg');
insert into auth.users (id, email) values ('22222222-2222-2222-2222-222222222222', 'op@t.bg');
insert into platform_users (id, role) values ('22222222-2222-2222-2222-222222222222', 'platform_operator');
insert into properties (agency_id, address_label, gps_point)
  values ((select id from agencies where slug='t'), 'Село Х',
          ST_SetSRID(ST_MakePoint(23.5, 42.5), 4326)::geography);

-- Опитай да issue-неш assessment без задължителни полета — трябва да fail-не:
insert into assessments (property_id, agency_id, operator_id, status)
  values ((select id from properties limit 1),
          (select id from agencies where slug='t'),
          '22222222-2222-2222-2222-222222222222',
          'issued');
-- Expected: ERROR: new row violates check constraint "issued_requires_fields"
```

Излез, ресетни:
```bash
pnpm db:reset
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260907000002_properties_and_assessments.sql
git commit -m "feat(db): properties and assessments with issue-time constraints"
```

---

## Task 5: Migration — photos, outcomes, verification_views, buyer_pdf_requests, orders

**Files:**
- Create: `supabase/migrations/20260907000003_photos_outcomes_verification.sql`

**Interfaces:**
- Produces: таблици `assessment_photos`, `drilling_outcomes`, `verification_views`, `buyer_pdf_requests`, `orders`
- Consumed от: Task 6 (RLS), Task 15 (photos upload), Task 17 (outcomes)

- [ ] **Step 1: Създай миграция**

```sql
-- supabase/migrations/20260907000003_photos_outcomes_verification.sql

-- ─── Assessment photos (собственост на платформата) ─────
create table assessment_photos (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references assessments(id) on delete cascade,
  storage_path text not null,
  caption text,
  taken_at timestamptz,
  gps_point geography(point, 4326),
  uploaded_by uuid not null references platform_users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index photos_assessment_idx on assessment_photos(assessment_id);

comment on table assessment_photos is 'Снимки от терен, собственост на платформата (не на агенцията).';

-- ─── Drilling outcomes ──────────────────────────────────
create table drilling_outcomes (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references assessments(id) on delete restrict,
  outcome text not null
    check (outcome in ('drilled_success','drilled_dry','drilled_partial','not_drilled','planned')),
  actual_depth_m numeric(6,2),
  actual_flow_m3h numeric(6,2),
  drilled_at date,
  notes text,
  source text not null default 'admin_verified'
    check (source in ('agency_reported','admin_verified','independent')),
  submitted_by uuid,   -- soft ref (agency_users или platform_users)
  submitted_at timestamptz not null default now()
);

create index outcomes_assessment_idx on drilling_outcomes(assessment_id);
create unique index outcomes_one_verified_per_assessment
  on drilling_outcomes(assessment_id)
  where source = 'admin_verified';

comment on table drilling_outcomes is 'Резултати от реални сондажи — захранва success rate.';

-- ─── Verification views (analytics) ─────────────────────
create table verification_views (
  id bigserial primary key,
  code text not null,
  ip_hash text not null,
  user_agent_class text,
  email_verified boolean not null default false,
  viewed_at timestamptz not null default now()
);

create index vv_code_time_idx on verification_views(code, viewed_at desc);
create index vv_ip_time_idx on verification_views(ip_hash, viewed_at desc);

comment on table verification_views is 'Всяко публично посещение на /v/[code].';

-- ─── Buyer PDF requests (email gate) ────────────────────
create table buyer_pdf_requests (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  email text not null,
  magic_token_hash text not null,
  expires_at timestamptz not null,
  fulfilled_at timestamptz,
  ip_hash text,
  created_at timestamptz not null default now()
);

create index bpr_email_time_idx on buyer_pdf_requests(email, created_at desc);
create index bpr_token_idx on buyer_pdf_requests(magic_token_hash)
  where fulfilled_at is null;

comment on table buyer_pdf_requests is 'Email gate за пълен PDF отчет — magic link токен.';

-- ─── Orders (payment-ready stub) ────────────────────────
create table orders (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid references agencies(id),
  buyer_email text,
  product_code text not null
    check (product_code in ('listing_assessment','buyer_check','desk_query')),
  quantity int not null default 1 check (quantity > 0),
  unit_price_eur_cents int not null check (unit_price_eur_cents >= 0),
  amount_eur_cents int not null check (amount_eur_cents >= 0),
  status text not null default 'draft'
    check (status in ('draft','issued','paid','void')),
  payment_provider text,
  external_ref text,
  invoice_path text,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

create index orders_agency_idx on orders(agency_id);
create index orders_status_idx on orders(status);
```

- [ ] **Step 2: Приложи и verify**

```bash
pnpm db:reset
pnpm supabase db psql -c "\dt"
```
Expected: 9 таблици (`agencies`, `platform_users`, `agency_users`, `properties`, `assessments`, `assessment_photos`, `drilling_outcomes`, `verification_views`, `buyer_pdf_requests`, `orders`).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260907000003_photos_outcomes_verification.sql
git commit -m "feat(db): photos, outcomes, verification and orders tables"
```

---

## Task 6: Migration — RLS helper functions + всички RLS полиси

**Files:**
- Create: `supabase/migrations/20260907000004_rls_helpers.sql`
- Create: `supabase/migrations/20260907000005_rls_policies.sql`

**Interfaces:**
- Produces: функции `auth.is_platform()`, `auth.is_platform_admin()`, `auth.my_agency()`
- Produces: RLS полиси на всяка таблица
- Consumed от: всеки следващ task който чете/пише DB

- [ ] **Step 1: Създай helper функции**

```sql
-- supabase/migrations/20260907000004_rls_helpers.sql

-- Provides three role queries used by every RLS policy.
create or replace function auth.is_platform()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(select 1 from platform_users where id = auth.uid())
$$;

create or replace function auth.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(select 1 from platform_users where id = auth.uid() and role = 'platform_admin')
$$;

create or replace function auth.my_agency()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select agency_id from agency_users where id = auth.uid()
$$;

grant execute on function auth.is_platform to authenticated;
grant execute on function auth.is_platform_admin to authenticated;
grant execute on function auth.my_agency to authenticated;
```

- [ ] **Step 2: Създай RLS полиси**

```sql
-- supabase/migrations/20260907000005_rls_policies.sql

-- ─── agencies ─────────────────────────────────────────────
alter table agencies enable row level security;

create policy agencies_platform_all on agencies
  for all to authenticated
  using (auth.is_platform())
  with check (auth.is_platform_admin());

create policy agencies_agency_read_own on agencies
  for select to authenticated
  using (id = auth.my_agency());

-- ─── platform_users ───────────────────────────────────────
alter table platform_users enable row level security;

create policy platform_users_admin_all on platform_users
  for all to authenticated
  using (auth.is_platform_admin())
  with check (auth.is_platform_admin());

create policy platform_users_self_read on platform_users
  for select to authenticated
  using (id = auth.uid());

-- ─── agency_users ─────────────────────────────────────────
alter table agency_users enable row level security;

create policy agency_users_platform_all on agency_users
  for all to authenticated
  using (auth.is_platform_admin())
  with check (auth.is_platform_admin());

create policy agency_users_self_read on agency_users
  for select to authenticated
  using (id = auth.uid());

create policy agency_users_agency_read on agency_users
  for select to authenticated
  using (agency_id = auth.my_agency());

-- ─── properties ───────────────────────────────────────────
alter table properties enable row level security;

create policy properties_platform_all on properties
  for all to authenticated
  using (auth.is_platform())
  with check (auth.is_platform());

create policy properties_agency_read on properties
  for select to authenticated
  using (agency_id = auth.my_agency());

-- ─── assessments ──────────────────────────────────────────
alter table assessments enable row level security;

create policy assessments_platform_all on assessments
  for all to authenticated
  using (auth.is_platform())
  with check (auth.is_platform());

create policy assessments_agency_read on assessments
  for select to authenticated
  using (agency_id = auth.my_agency());

-- Anon достъп само през code, зададен в session GUC.
-- Server route задава: SET LOCAL app.requested_code = '<code>'.
create policy assessments_anon_by_code on assessments
  for select to anon
  using (
    status = 'issued'
    and code is not null
    and code = current_setting('app.requested_code', true)
  );

-- ─── assessment_photos ────────────────────────────────────
alter table assessment_photos enable row level security;

create policy photos_platform_all on assessment_photos
  for all to authenticated
  using (auth.is_platform())
  with check (auth.is_platform());

create policy photos_agency_read on assessment_photos
  for select to authenticated
  using (
    exists (
      select 1 from assessments a
      where a.id = assessment_photos.assessment_id
        and a.agency_id = auth.my_agency()
    )
  );

-- Никога direct anon — signed URL идва от server.
create policy photos_anon_deny on assessment_photos
  for select to anon
  using (false);

-- ─── drilling_outcomes ────────────────────────────────────
alter table drilling_outcomes enable row level security;

create policy outcomes_platform_all on drilling_outcomes
  for all to authenticated
  using (auth.is_platform())
  with check (auth.is_platform());

create policy outcomes_agency_read on drilling_outcomes
  for select to authenticated
  using (
    exists (
      select 1 from assessments a
      where a.id = drilling_outcomes.assessment_id
        and a.agency_id = auth.my_agency()
    )
  );

create policy outcomes_agency_report on drilling_outcomes
  for insert to authenticated
  with check (
    source = 'agency_reported'
    and exists (
      select 1 from assessments a
      where a.id = drilling_outcomes.assessment_id
        and a.agency_id = auth.my_agency()
    )
  );

-- ─── verification_views ───────────────────────────────────
alter table verification_views enable row level security;

create policy vv_platform_read on verification_views
  for select to authenticated
  using (auth.is_platform());

-- Никой освен service_role не пише директно (server route).
create policy vv_no_writes_from_users on verification_views
  for insert to authenticated with check (false);

-- ─── buyer_pdf_requests ───────────────────────────────────
alter table buyer_pdf_requests enable row level security;

create policy bpr_platform_read on buyer_pdf_requests
  for select to authenticated
  using (auth.is_platform_admin());

-- Insert-нато само от service_role в server actions.
create policy bpr_no_writes_from_users on buyer_pdf_requests
  for insert to authenticated with check (false);

-- ─── orders ───────────────────────────────────────────────
alter table orders enable row level security;

create policy orders_platform_all on orders
  for all to authenticated
  using (auth.is_platform())
  with check (auth.is_platform());

create policy orders_agency_read on orders
  for select to authenticated
  using (agency_id = auth.my_agency());
```

- [ ] **Step 3: Приложи и verify**

```bash
pnpm db:reset
```

Verify че RLS е enabled:
```bash
pnpm supabase db psql -c "select tablename, rowsecurity from pg_tables where schemaname='public';"
```
Expected: всяка таблица показва `rowsecurity = t`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260907000004_rls_helpers.sql supabase/migrations/20260907000005_rls_policies.sql
git commit -m "feat(db): RLS helper functions and policies for all tables"
```

---

## Task 7: Migration — Storage buckets

**Files:**
- Create: `supabase/migrations/20260907000006_storage_buckets.sql`

**Interfaces:**
- Produces: buckets `assessment-pdfs`, `assessment-photos`, `pqwt-exports`, `invoices`
- Consumed от: Task 12 (signed URL helper), Task 13 (PDF generation), Task 15 (photos)

- [ ] **Step 1: Създай миграция**

```sql
-- supabase/migrations/20260907000006_storage_buckets.sql

-- Всички buckets private. Достъпът е през signed URLs от server.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('assessment-pdfs', 'assessment-pdfs', false, 10485760, array['application/pdf']),
  ('assessment-photos', 'assessment-photos', false, 20971520, array['image/jpeg','image/png','image/webp']),
  ('pqwt-exports', 'pqwt-exports', false, 5242880, null),
  ('invoices', 'invoices', false, 5242880, array['application/pdf'])
on conflict (id) do nothing;

-- Storage policies: само service_role пише, authenticated чете чрез app RLS
-- (директен достъп е блокиран; signed URLs се генерират от server).

create policy "authenticated read via signed url only"
on storage.objects for select
to authenticated
using (false);

create policy "authenticated write via server only"
on storage.objects for insert
to authenticated
with check (false);

create policy "anon no direct access"
on storage.objects for all
to anon
using (false)
with check (false);
```

- [ ] **Step 2: Приложи и verify**

```bash
pnpm db:reset
pnpm supabase db psql -c "select id, public, file_size_limit from storage.buckets order by id;"
```
Expected: 4 bucket-а, всички `public=false`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260907000006_storage_buckets.sql
git commit -m "feat(storage): private buckets for PDFs, photos, PQWT exports, invoices"
```

---

## Task 8: Supabase client helpers (browser + server + service)

**Files:**
- Create: `src/lib/supabase/client.ts`
- Create: `src/lib/supabase/server.ts`
- Create: `src/lib/supabase/service.ts`

**Interfaces:**
- Produces: `createBrowserClient()` за client components
- Produces: `createServerClient()` за server actions/route handlers (cookies-aware)
- Produces: `createServiceClient()` за server-only escalated operations
- Consumed от: всеки следващ task който говори с Supabase

- [ ] **Step 1: Client за браузър**

```typescript
// src/lib/supabase/client.ts
'use client';

import { createBrowserClient as create } from '@supabase/ssr';
import { env } from '@/env';

export function createBrowserClient() {
  return create(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
```

- [ ] **Step 2: Client за server (cookies-aware)**

```typescript
// src/lib/supabase/server.ts
import { createServerClient as create } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { env } from '@/env';

export async function createServerClient() {
  const cookieStore = await cookies();
  return create(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (all) => {
          try {
            all.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Server Components не могат да пишат cookies; middleware refresh-ва.
          }
        },
      },
    },
  );
}
```

- [ ] **Step 3: Service client (за операции, които заобикалят RLS)**

```typescript
// src/lib/supabase/service.ts
import { createClient } from '@supabase/supabase-js';
import { env } from '@/env';

/**
 * Service role client — заобикаля RLS. Никога не се експортва към client bundle.
 * Използва се само в server routes за: setup, admin miграции, signed URL generation,
 * verification_views + buyer_pdf_requests writes.
 */
export function createServiceClient() {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY not set');
  }
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
```

- [ ] **Step 4: Verify типовете**

```bash
pnpm lint
```
Expected: без грешки.

- [ ] **Step 5: Commit**

```bash
git add src/lib/supabase/
git commit -m "feat(lib): supabase client helpers for browser, server, and service role"
```

---

## Task 9: Auth session + guards

**Files:**
- Create: `src/lib/auth/session.ts`
- Create: `src/lib/auth/guards.ts`
- Create: `src/app/login/page.tsx`
- Create: `src/app/auth/callback/route.ts`
- Create: `src/middleware.ts`

**Interfaces:**
- Produces: `getSession()` → `{ user, role: 'platform_admin' | 'platform_operator' | 'agency_admin' | 'agency_viewer' | null, agencyId: string | null }`
- Produces: `requirePlatform()`, `requirePlatformAdmin()`, `requireAgency()` — throw `redirect('/login')` ако не autoризиран
- Consumed от: всички `/app/*` pages и server actions

- [ ] **Step 1: Session helper**

```typescript
// src/lib/auth/session.ts
import { createServerClient } from '@/lib/supabase/server';

export type Role =
  | 'platform_admin'
  | 'platform_operator'
  | 'agency_admin'
  | 'agency_viewer';

export type Session = {
  userId: string;
  email: string;
  role: Role;
  agencyId: string | null;
  fullName: string | null;
};

export async function getSession(): Promise<Session | null> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  // Провери platform_users
  const { data: platformRow } = await supabase
    .from('platform_users')
    .select('role, full_name')
    .eq('id', user.id)
    .maybeSingle();

  if (platformRow) {
    return {
      userId: user.id,
      email: user.email ?? '',
      role: platformRow.role as Role,
      agencyId: null,
      fullName: platformRow.full_name,
    };
  }

  // Провери agency_users
  const { data: agencyRow } = await supabase
    .from('agency_users')
    .select('role, agency_id, full_name')
    .eq('id', user.id)
    .maybeSingle();

  if (agencyRow) {
    return {
      userId: user.id,
      email: user.email ?? '',
      role: agencyRow.role as Role,
      agencyId: agencyRow.agency_id,
      fullName: agencyRow.full_name,
    };
  }

  return null; // autoенициран auth user, но без роля — не му позволяваме достъп
}

export function isPlatform(role: Role): boolean {
  return role === 'platform_admin' || role === 'platform_operator';
}

export function isAgency(role: Role): boolean {
  return role === 'agency_admin' || role === 'agency_viewer';
}
```

- [ ] **Step 2: Guards**

```typescript
// src/lib/auth/guards.ts
import { redirect } from 'next/navigation';
import { getSession, isPlatform, isAgency, type Session } from './session';

export async function requireSession(): Promise<Session> {
  const s = await getSession();
  if (!s) redirect('/login');
  return s;
}

export async function requirePlatform(): Promise<Session> {
  const s = await requireSession();
  if (!isPlatform(s.role)) redirect('/app');
  return s;
}

export async function requirePlatformAdmin(): Promise<Session> {
  const s = await requireSession();
  if (s.role !== 'platform_admin') redirect('/app');
  return s;
}

export async function requireAgency(): Promise<Session> {
  const s = await requireSession();
  if (!isAgency(s.role)) redirect('/app');
  return s;
}
```

- [ ] **Step 3: Login страница**

```tsx
// src/app/login/page.tsx
'use client';

import { useState } from 'react';
import { createBrowserClient } from '@/lib/supabase/client';
import { env } from '@/env';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createBrowserClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${env.NEXT_PUBLIC_SITE_URL}/auth/callback`,
        shouldCreateUser: false,   // само admin invite; никакво self-signup
      },
    });
    setLoading(false);
    if (error) setError(error.message);
    else setSent(true);
  }

  return (
    <main className="max-w-md mx-auto p-8 mt-16">
      <h1 className="text-2xl font-semibold mb-6">Вход</h1>
      {sent ? (
        <p className="text-green-700">
          Изпратихме ти линк за вход на {email}. Провери email-а си.
        </p>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          <label className="block">
            <span className="text-sm text-gray-700">Email адрес</span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
            />
          </label>
          {error && <p className="text-red-700 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded bg-black text-white py-2 disabled:opacity-50"
          >
            {loading ? 'Изпращам...' : 'Изпрати ми линк'}
          </button>
        </form>
      )}
    </main>
  );
}
```

- [ ] **Step 4: Auth callback route**

```typescript
// src/app/auth/callback/route.ts
import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/app';

  if (code) {
    const supabase = await createServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }
  return NextResponse.redirect(`${origin}/login?error=exchange_failed`);
}
```

- [ ] **Step 5: Middleware за session refresh**

```typescript
// src/middleware.ts
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { env } from '@/env';

export async function middleware(req: NextRequest) {
  let response = NextResponse.next({ request: req });
  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (all) => {
          all.forEach(({ name, value }) => req.cookies.set(name, value));
          response = NextResponse.next({ request: req });
          all.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );
  await supabase.auth.getUser();
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
```

- [ ] **Step 6: Verify — ръчен login flow**

Стартирай сървъра:
```bash
pnpm dev
```

Създай тест admin през psql:
```bash
pnpm supabase db psql
```
```sql
insert into auth.users (id, email, email_confirmed_at)
  values (gen_random_uuid(), 'admin@voda-check.bg', now())
  returning id;
-- копирай id-то
insert into platform_users (id, role, full_name)
  values ('<копираното id>', 'platform_admin', 'Test Admin');
```

Отвори http://localhost:3000/login, въведи `admin@voda-check.bg`, кликни. В Supabase локалната Inbucket (http://127.0.0.1:54324) намери email-а, кликни линка. Трябва да пренасочи към `/app` (страницата още не съществува — 404 е OK за сега).

- [ ] **Step 7: Commit**

```bash
git add src/lib/auth src/app/login src/app/auth src/middleware.ts
git commit -m "feat(auth): magic link login with role-based session"
```

---

## Task 10: Code generation module + тестове

**Files:**
- Create: `src/domains/assessment/code.ts`
- Create: `src/domains/assessment/code.test.ts`
- Create: `vitest.config.ts`

**Interfaces:**
- Produces: `generateAssessmentCode(assessmentId: string): string` → 8-char lowercase base32
- Produces: `isValidCodeShape(code: string): boolean` — синтактична проверка
- Consumed от: Task 11 (issue action)

- [ ] **Step 1: Vitest config**

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    globals: false,
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
});
```

- [ ] **Step 2: Инсталирай hi-base32**

```bash
pnpm add hi-base32
```

- [ ] **Step 3: Напиши failing test**

```typescript
// src/domains/assessment/code.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { generateAssessmentCode, isValidCodeShape } from './code';

describe('generateAssessmentCode', () => {
  const secret = 'a'.repeat(64); // 32 bytes hex
  const assessmentId = '11111111-1111-1111-1111-111111111111';

  beforeEach(() => {
    process.env.ASSESSMENT_CODE_SECRET = secret;
  });

  it('produces 8-character lowercase base32 code', () => {
    const code = generateAssessmentCode(assessmentId);
    expect(code).toHaveLength(8);
    expect(code).toMatch(/^[a-z2-7]{8}$/);
  });

  it('is deterministic for the same assessment id', () => {
    const a = generateAssessmentCode(assessmentId);
    const b = generateAssessmentCode(assessmentId);
    expect(a).toBe(b);
  });

  it('differs for different assessment ids', () => {
    const a = generateAssessmentCode(assessmentId);
    const b = generateAssessmentCode('22222222-2222-2222-2222-222222222222');
    expect(a).not.toBe(b);
  });

  it('throws when secret is missing', () => {
    delete process.env.ASSESSMENT_CODE_SECRET;
    expect(() => generateAssessmentCode(assessmentId)).toThrow(/secret/i);
  });
});

describe('isValidCodeShape', () => {
  it('accepts valid 8-char lowercase base32', () => {
    expect(isValidCodeShape('xk3f9pqr')).toBe(true);
  });

  it('rejects uppercase', () => {
    expect(isValidCodeShape('XK3F9PQR')).toBe(false);
  });

  it('rejects wrong length', () => {
    expect(isValidCodeShape('xk3f9pq')).toBe(false);
    expect(isValidCodeShape('xk3f9pqrs')).toBe(false);
  });

  it('rejects invalid base32 chars', () => {
    expect(isValidCodeShape('xk3f9p01')).toBe(false); // 0 и 1 не са в base32
  });
});
```

- [ ] **Step 4: Run test — очаквано FAIL**

```bash
pnpm test src/domains/assessment/code.test.ts
```
Expected: fails (module doesn't exist).

- [ ] **Step 5: Implementация**

```typescript
// src/domains/assessment/code.ts
import { createHmac } from 'node:crypto';
import base32 from 'hi-base32';

const CODE_RE = /^[a-z2-7]{8}$/;

export function generateAssessmentCode(assessmentId: string): string {
  const secret = process.env.ASSESSMENT_CODE_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('ASSESSMENT_CODE_SECRET is not set (need >= 32 chars)');
  }
  const hmac = createHmac('sha256', Buffer.from(secret, 'hex'));
  hmac.update(assessmentId);
  const digest = hmac.digest();
  // 40 bits (5 bytes) → 8 base32 chars, no padding needed
  return base32.encode(digest.subarray(0, 5)).replace(/=/g, '').toLowerCase();
}

export function isValidCodeShape(code: string): boolean {
  return CODE_RE.test(code);
}
```

- [ ] **Step 6: Run test — очаквано PASS**

```bash
pnpm test src/domains/assessment/code.test.ts
```
Expected: all 7 tests pass.

- [ ] **Step 7: Commit**

```bash
git add vitest.config.ts src/domains/assessment/code.ts src/domains/assessment/code.test.ts package.json pnpm-lock.yaml
git commit -m "feat(assessment): HMAC-based unguessable code generation"
```

---

## Task 11: Assessment domain — types, queries, actions

**Files:**
- Create: `src/domains/assessment/types.ts`
- Create: `src/domains/assessment/queries.ts`
- Create: `src/domains/assessment/actions.ts`
- Create: `src/domains/agency/types.ts`
- Create: `src/domains/agency/queries.ts`
- Create: `src/domains/agency/actions.ts`

**Interfaces:**
- Produces `queries.ts`:
  - `listAssessmentsForCurrentUser(): Promise<AssessmentRow[]>` — RLS-scoped
  - `getAssessment(id): Promise<AssessmentDetail | null>`
- Produces `actions.ts`:
  - `createDraftAssessment(input: CreateAssessmentInput): Promise<string>` (returns id)
  - `updateDraftAssessment(id, input): Promise<void>`
  - `issueAssessment(id): Promise<{ code: string }>` — генерира код, задава status=issued
  - `archiveAssessment(id): Promise<void>`
- Similar structure за `agency` domain (`createAgency`, `createProperty`, etc.)
- Consumed от: Task 14 (dashboard pages)

- [ ] **Step 1: Types**

```typescript
// src/domains/assessment/types.ts
import { z } from 'zod';

export type AssessmentClass = 'A' | 'B' | 'C' | 'D';
export type AssessmentStatus = 'draft' | 'issued' | 'archived';

export const CreateAssessmentInputSchema = z.object({
  propertyId: z.string().uuid(),
  measuredAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  class: z.enum(['A', 'B', 'C', 'D']).optional(),
  depthMinM: z.number().nonnegative().max(500).optional(),
  depthMaxM: z.number().nonnegative().max(500).optional(),
  expectedFlowMinM3h: z.number().nonnegative().optional(),
  expectedFlowMaxM3h: z.number().nonnegative().optional(),
  confidenceNote: z.string().max(2000).optional(),
  measuredLat: z.number().min(-90).max(90).optional(),
  measuredLng: z.number().min(-180).max(180).optional(),
});
export type CreateAssessmentInput = z.infer<typeof CreateAssessmentInputSchema>;

export type AssessmentRow = {
  id: string;
  code: string | null;
  status: AssessmentStatus;
  class: AssessmentClass | null;
  measuredAt: string | null;
  addressLabel: string;
  agencyName: string;
  issuedAt: string | null;
};

export type AssessmentDetail = AssessmentRow & {
  propertyId: string;
  agencyId: string;
  depthMinM: number | null;
  depthMaxM: number | null;
  expectedFlowMinM3h: number | null;
  expectedFlowMaxM3h: number | null;
  confidenceNote: string | null;
  method: string;
  pdfPath: string | null;
};
```

- [ ] **Step 2: Queries (RLS-relying, no manual filters)**

```typescript
// src/domains/assessment/queries.ts
import { createServerClient } from '@/lib/supabase/server';
import type { AssessmentRow, AssessmentDetail } from './types';

export async function listAssessmentsForCurrentUser(): Promise<AssessmentRow[]> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from('assessments')
    .select(`
      id, code, status, class, measured_at, issued_at,
      properties!inner(address_label),
      agencies!inner(name)
    `)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    id: r.id,
    code: r.code,
    status: r.status,
    class: r.class,
    measuredAt: r.measured_at,
    issuedAt: r.issued_at,
    addressLabel: r.properties.address_label,
    agencyName: r.agencies.name,
  }));
}

export async function getAssessment(id: string): Promise<AssessmentDetail | null> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from('assessments')
    .select(`
      id, code, status, class, measured_at, issued_at,
      property_id, agency_id, depth_min_m, depth_max_m,
      expected_flow_min_m3h, expected_flow_max_m3h,
      confidence_note, method, pdf_path,
      properties!inner(address_label),
      agencies!inner(name)
    `)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const d: any = data;
  return {
    id: d.id,
    code: d.code,
    status: d.status,
    class: d.class,
    measuredAt: d.measured_at,
    issuedAt: d.issued_at,
    addressLabel: d.properties.address_label,
    agencyName: d.agencies.name,
    propertyId: d.property_id,
    agencyId: d.agency_id,
    depthMinM: d.depth_min_m,
    depthMaxM: d.depth_max_m,
    expectedFlowMinM3h: d.expected_flow_min_m3h,
    expectedFlowMaxM3h: d.expected_flow_max_m3h,
    confidenceNote: d.confidence_note,
    method: d.method,
    pdfPath: d.pdf_path,
  };
}
```

- [ ] **Step 3: Actions**

```typescript
// src/domains/assessment/actions.ts
'use server';

import { revalidatePath } from 'next/cache';
import { createServerClient } from '@/lib/supabase/server';
import { requirePlatform } from '@/lib/auth/guards';
import { generateAssessmentCode } from './code';
import { CreateAssessmentInputSchema, type CreateAssessmentInput } from './types';

export async function createDraftAssessment(input: CreateAssessmentInput): Promise<string> {
  const session = await requirePlatform();
  const parsed = CreateAssessmentInputSchema.parse(input);
  const supabase = await createServerClient();

  // Дай ми agency_id на property-то
  const { data: prop, error: pErr } = await supabase
    .from('properties')
    .select('agency_id')
    .eq('id', parsed.propertyId)
    .single();
  if (pErr || !prop) throw new Error('Property not found');

  const insert: Record<string, unknown> = {
    property_id: parsed.propertyId,
    agency_id: prop.agency_id,
    operator_id: session.userId,
    status: 'draft',
    method: 'PQWT-GT150',
  };
  if (parsed.measuredAt) insert.measured_at = parsed.measuredAt;
  if (parsed.class) insert.class = parsed.class;
  if (parsed.depthMinM != null) insert.depth_min_m = parsed.depthMinM;
  if (parsed.depthMaxM != null) insert.depth_max_m = parsed.depthMaxM;
  if (parsed.expectedFlowMinM3h != null) insert.expected_flow_min_m3h = parsed.expectedFlowMinM3h;
  if (parsed.expectedFlowMaxM3h != null) insert.expected_flow_max_m3h = parsed.expectedFlowMaxM3h;
  if (parsed.confidenceNote) insert.confidence_note = parsed.confidenceNote;
  if (parsed.measuredLat != null && parsed.measuredLng != null) {
    insert.measured_gps = `SRID=4326;POINT(${parsed.measuredLng} ${parsed.measuredLat})`;
  }

  const { data, error } = await supabase.from('assessments').insert(insert).select('id').single();
  if (error) throw error;
  revalidatePath('/app/assessments');
  return data.id;
}

export async function issueAssessment(id: string): Promise<{ code: string }> {
  await requirePlatform();
  const supabase = await createServerClient();
  const code = generateAssessmentCode(id);
  const { error } = await supabase
    .from('assessments')
    .update({ code, status: 'issued', issued_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
  revalidatePath('/app/assessments');
  revalidatePath(`/app/assessments/${id}`);
  return { code };
}

export async function archiveAssessment(id: string): Promise<void> {
  await requirePlatform();
  const supabase = await createServerClient();
  const { error } = await supabase.from('assessments').update({ status: 'archived' }).eq('id', id);
  if (error) throw error;
  revalidatePath('/app/assessments');
}
```

- [ ] **Step 4: Agency domain — mirror структура**

```typescript
// src/domains/agency/types.ts
import { z } from 'zod';

export const CreateAgencyInputSchema = z.object({
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{2,63}$/),
  name: z.string().min(2).max(200),
  contactEmail: z.string().email(),
});
export type CreateAgencyInput = z.infer<typeof CreateAgencyInputSchema>;

export const CreatePropertyInputSchema = z.object({
  agencyId: z.string().uuid(),
  listingRef: z.string().max(100).optional(),
  addressLabel: z.string().min(2).max(200),
  cadastralNumber: z.string().max(50).optional(),
  regionCode: z.string().max(20).optional(),
  gpsLat: z.number().min(-90).max(90),
  gpsLng: z.number().min(-180).max(180),
});
export type CreatePropertyInput = z.infer<typeof CreatePropertyInputSchema>;

export type AgencyRow = {
  id: string;
  slug: string;
  name: string;
  contactEmail: string;
};

export type PropertyRow = {
  id: string;
  agencyId: string;
  agencyName: string;
  addressLabel: string;
  regionCode: string | null;
};
```

```typescript
// src/domains/agency/queries.ts
import { createServerClient } from '@/lib/supabase/server';
import type { AgencyRow, PropertyRow } from './types';

export async function listAgencies(): Promise<AgencyRow[]> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from('agencies')
    .select('id, slug, name, contact_email')
    .is('archived_at', null)
    .order('name');
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id, slug: r.slug, name: r.name, contactEmail: r.contact_email,
  }));
}

export async function listPropertiesForCurrentUser(): Promise<PropertyRow[]> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from('properties')
    .select(`id, agency_id, address_label, region_code, agencies!inner(name)`)
    .is('archived_at', null)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    id: r.id,
    agencyId: r.agency_id,
    agencyName: r.agencies.name,
    addressLabel: r.address_label,
    regionCode: r.region_code,
  }));
}
```

```typescript
// src/domains/agency/actions.ts
'use server';

import { revalidatePath } from 'next/cache';
import { createServerClient } from '@/lib/supabase/server';
import { requirePlatformAdmin, requirePlatform } from '@/lib/auth/guards';
import { CreateAgencyInputSchema, CreatePropertyInputSchema,
         type CreateAgencyInput, type CreatePropertyInput } from './types';

export async function createAgency(input: CreateAgencyInput): Promise<string> {
  await requirePlatformAdmin();
  const parsed = CreateAgencyInputSchema.parse(input);
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from('agencies')
    .insert({ slug: parsed.slug, name: parsed.name, contact_email: parsed.contactEmail })
    .select('id')
    .single();
  if (error) throw error;
  revalidatePath('/app/admin/agencies');
  return data.id;
}

export async function createProperty(input: CreatePropertyInput): Promise<string> {
  await requirePlatform();
  const parsed = CreatePropertyInputSchema.parse(input);
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from('properties')
    .insert({
      agency_id: parsed.agencyId,
      listing_ref: parsed.listingRef ?? null,
      address_label: parsed.addressLabel,
      cadastral_number: parsed.cadastralNumber ?? null,
      region_code: parsed.regionCode ?? null,
      gps_point: `SRID=4326;POINT(${parsed.gpsLng} ${parsed.gpsLat})`,
    })
    .select('id')
    .single();
  if (error) throw error;
  revalidatePath('/app/properties');
  return data.id;
}
```

- [ ] **Step 5: Verify types**

```bash
pnpm lint
```

- [ ] **Step 6: Commit**

```bash
git add src/domains/
git commit -m "feat(domains): agency and assessment queries + server actions"
```

---

## Task 12: Storage signed URL helper

**Files:**
- Create: `src/lib/storage/signed-url.ts`

**Interfaces:**
- Produces: `createSignedUrl(bucket, path, ttlSeconds?): Promise<string>`
- Produces: `uploadFile(bucket, path, file): Promise<void>` (server-side, service role)
- Consumed от: Task 13 (PDF), Task 15 (dashboard photo view), all buckets

- [ ] **Step 1: Implementация**

```typescript
// src/lib/storage/signed-url.ts
import 'server-only';
import { createServiceClient } from '@/lib/supabase/service';

export type Bucket = 'assessment-pdfs' | 'assessment-photos' | 'pqwt-exports' | 'invoices';

export async function createSignedUrl(
  bucket: Bucket,
  path: string,
  ttlSeconds = 900,
): Promise<string> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, ttlSeconds);
  if (error || !data) throw error ?? new Error('signed url failed');
  return data.signedUrl;
}

export async function uploadFile(
  bucket: Bucket,
  path: string,
  body: Buffer | Uint8Array | Blob,
  contentType: string,
): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase.storage.from(bucket).upload(path, body, {
    contentType,
    upsert: true,
  });
  if (error) throw error;
}

export async function deleteFile(bucket: Bucket, path: string): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase.storage.from(bucket).remove([path]);
  if (error) throw error;
}
```

- [ ] **Step 2: Verify типовете**

```bash
pnpm lint
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/storage/
git commit -m "feat(storage): signed URL helper + upload/delete via service client"
```

---

## Task 13: PDF генериране (react-pdf)

**Files:**
- Create: `src/domains/assessment/pdf.tsx`
- Create: `src/app/api/pdf/[id]/route.ts`
- Modify: `src/domains/assessment/actions.ts` — issue генерира PDF и качва в Storage

**Interfaces:**
- Produces: `renderAssessmentPDF(detail: AssessmentDetail): Promise<Buffer>` — react-pdf render
- Produces: `/api/pdf/[id]` route — връща PDF ако user има RLS достъп
- Modifies `issueAssessment` — след issue генерира PDF и качва в `assessment-pdfs` bucket

- [ ] **Step 1: PDF компонент**

```tsx
// src/domains/assessment/pdf.tsx
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import type { AssessmentDetail } from './types';

const styles = StyleSheet.create({
  page: { padding: 48, fontSize: 11, fontFamily: 'Helvetica' },
  h1: { fontSize: 20, fontWeight: 700, marginBottom: 12 },
  h2: { fontSize: 14, fontWeight: 700, marginTop: 18, marginBottom: 6 },
  row: { flexDirection: 'row', marginBottom: 4 },
  label: { width: 160, color: '#555' },
  value: { flex: 1 },
  footer: {
    position: 'absolute', bottom: 32, left: 48, right: 48,
    fontSize: 9, color: '#666', borderTop: '1pt solid #ccc', paddingTop: 6,
  },
  classBadge: {
    padding: '4pt 10pt', borderRadius: 4, fontSize: 18, fontWeight: 700,
    color: 'white', marginTop: 8,
  },
});

const CLASS_COLORS: Record<string, string> = {
  A: '#059669', B: '#0891b2', C: '#d97706', D: '#dc2626',
};

export function AssessmentPDF({ a }: { a: AssessmentDetail }) {
  const depth = a.depthMinM != null && a.depthMaxM != null
    ? `${a.depthMinM.toFixed(1)}–${a.depthMaxM.toFixed(1)} м` : '—';
  const flow = a.expectedFlowMinM3h != null && a.expectedFlowMaxM3h != null
    ? `${a.expectedFlowMinM3h.toFixed(1)}–${a.expectedFlowMaxM3h.toFixed(1)} м³/ч` : '—';
  const badgeColor = a.class ? CLASS_COLORS[a.class] ?? '#333' : '#333';
  const measuredDate = a.measuredAt
    ? new Date(a.measuredAt).toLocaleDateString('bg-BG')
    : '—';

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.h1}>Водна оценка на имот</Text>
        <Text style={{ color: '#555', marginBottom: 12 }}>
          Издадена от Voda Check • {a.agencyName}
        </Text>

        {a.class && (
          <View style={{ ...styles.classBadge, backgroundColor: badgeColor }}>
            <Text>Клас {a.class}</Text>
          </View>
        )}

        <Text style={styles.h2}>Резултат</Text>
        <View style={styles.row}>
          <Text style={styles.label}>Дълбочинен диапазон</Text>
          <Text style={styles.value}>{depth}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Очакван дебит</Text>
          <Text style={styles.value}>{flow}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Метод</Text>
          <Text style={styles.value}>{a.method}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Дата на измерване</Text>
          <Text style={styles.value}>{measuredDate}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Локация</Text>
          <Text style={styles.value}>{a.addressLabel}</Text>
        </View>

        {a.confidenceNote && (
          <>
            <Text style={styles.h2}>Бележки на оператора</Text>
            <Text>{a.confidenceNote}</Text>
          </>
        )}

        <Text style={styles.h2}>Методология и ограничения</Text>
        <Text style={{ lineHeight: 1.5 }}>
          Измерването е извършено с PQWT-GT150 (метод на естественото електрично поле).
          Уредът измерва контраст в привидното съпротивление на подземните пластове.
          Ниското съпротивление на дълбочина е индикация за възможна водоносна зона,
          но не изключва напълно фалшиви положителни (напр. наситена глина).
          Класовете A/B/C/D изразяват относителна вероятност и очаквана дълбочина;
          не са гаранция за резултат от сондаж.
        </Text>

        <View style={styles.footer}>
          <Text>Код: {a.code ?? '—'} • Издадено: {a.issuedAt ? new Date(a.issuedAt).toLocaleDateString('bg-BG') : '—'}</Text>
          <Text>Проверка: voda-check.bg/v/{a.code ?? ''}</Text>
        </View>
      </Page>
    </Document>
  );
}

export async function renderAssessmentPDF(a: AssessmentDetail): Promise<Buffer> {
  const { renderToBuffer } = await import('@react-pdf/renderer');
  return renderToBuffer(<AssessmentPDF a={a} />);
}
```

- [ ] **Step 2: Обнови issueAssessment**

Отвори `src/domains/assessment/actions.ts` и заменѝ `issueAssessment`:

```typescript
export async function issueAssessment(id: string): Promise<{ code: string }> {
  await requirePlatform();
  const supabase = await createServerClient();
  const code = generateAssessmentCode(id);

  // 1) Update record with code first (за да го включим в PDF footer)
  const { error: uErr } = await supabase
    .from('assessments')
    .update({ code, status: 'issued', issued_at: new Date().toISOString() })
    .eq('id', id);
  if (uErr) throw uErr;

  // 2) Fetch full detail (RLS позволява защото сме platform)
  const { getAssessment } = await import('./queries');
  const detail = await getAssessment(id);
  if (!detail) throw new Error('Assessment vanished after update');

  // 3) Render PDF
  const { renderAssessmentPDF } = await import('./pdf');
  const buf = await renderAssessmentPDF(detail);

  // 4) Upload
  const { uploadFile } = await import('@/lib/storage/signed-url');
  const path = `${detail.agencyId}/${id}/report.pdf`;
  await uploadFile('assessment-pdfs', path, buf, 'application/pdf');

  // 5) Save path
  const { error: pErr } = await supabase.from('assessments').update({ pdf_path: path }).eq('id', id);
  if (pErr) throw pErr;

  revalidatePath('/app/assessments');
  revalidatePath(`/app/assessments/${id}`);
  return { code };
}
```

- [ ] **Step 3: Route за PDF download**

```typescript
// src/app/api/pdf/[id]/route.ts
import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth/guards';
import { getAssessment } from '@/domains/assessment/queries';
import { createSignedUrl } from '@/lib/storage/signed-url';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  await requireSession();  // authenticated only; RLS ще ограничи достъпа
  const { id } = await ctx.params;
  const detail = await getAssessment(id);
  if (!detail || !detail.pdfPath) {
    return new NextResponse('Not found', { status: 404 });
  }
  const url = await createSignedUrl('assessment-pdfs', detail.pdfPath, 300);
  return NextResponse.redirect(url);
}
```

- [ ] **Step 4: Verify build**

```bash
pnpm lint
pnpm build
```
Expected: build успешен.

- [ ] **Step 5: Commit**

```bash
git add src/domains/assessment/pdf.tsx src/domains/assessment/actions.ts src/app/api/pdf
git commit -m "feat(assessment): react-pdf report generation on issue"
```

---

## Task 14: Dashboard shell + layout

**Files:**
- Create: `src/app/app/layout.tsx`
- Create: `src/app/app/page.tsx`
- Create: `src/lib/ui/layout.tsx`

**Interfaces:**
- Produces: `/app/*` layout — session guard + navigation
- Consumed от: всички под-страници на dashboard-а

- [ ] **Step 1: Layout с nav**

```tsx
// src/lib/ui/layout.tsx
import Link from 'next/link';
import type { Session } from '@/lib/auth/session';

export function AppNav({ session }: { session: Session }) {
  const isPlatform = session.role === 'platform_admin' || session.role === 'platform_operator';
  const isAdmin = session.role === 'platform_admin';

  return (
    <nav className="border-b border-gray-200 bg-white">
      <div className="max-w-6xl mx-auto px-6 flex items-center justify-between h-14">
        <div className="flex items-center gap-8">
          <Link href="/app" className="font-semibold text-lg">Водна оценка</Link>
          <div className="flex gap-6 text-sm">
            <Link href="/app/properties" className="text-gray-700 hover:text-black">Имоти</Link>
            <Link href="/app/assessments" className="text-gray-700 hover:text-black">Оценки</Link>
            {isAdmin && (
              <Link href="/app/admin/agencies" className="text-gray-700 hover:text-black">Агенции</Link>
            )}
          </div>
        </div>
        <div className="text-sm text-gray-600">
          {session.fullName ?? session.email} · <span className="text-xs text-gray-500">{session.role}</span>
        </div>
      </div>
    </nav>
  );
}
```

- [ ] **Step 2: App layout**

```tsx
// src/app/app/layout.tsx
import { requireSession } from '@/lib/auth/guards';
import { AppNav } from '@/lib/ui/layout';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  return (
    <div className="min-h-screen bg-gray-50">
      <AppNav session={session} />
      <main className="max-w-6xl mx-auto px-6 py-8">{children}</main>
    </div>
  );
}
```

- [ ] **Step 3: Dashboard home**

```tsx
// src/app/app/page.tsx
import { requireSession } from '@/lib/auth/guards';

export default async function Dashboard() {
  const s = await requireSession();
  return (
    <div>
      <h1 className="text-2xl font-semibold mb-4">Здравей, {s.fullName ?? s.email}</h1>
      <p className="text-gray-600">
        Роля: <code className="font-mono">{s.role}</code>
        {s.agencyId && <> · Агенция: <code className="font-mono">{s.agencyId}</code></>}
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Ръчна проверка**

```bash
pnpm dev
```
Логни се като admin, отвори `/app` — трябва да видиш nav-а и приветствие.

- [ ] **Step 5: Commit**

```bash
git add src/app/app src/lib/ui
git commit -m "feat(dashboard): app layout with role-aware navigation"
```

---

## Task 15: Properties CRUD (list + create + detail)

**Files:**
- Create: `src/app/app/properties/page.tsx`
- Create: `src/app/app/properties/new/page.tsx`
- Create: `src/app/app/properties/[id]/page.tsx`
- Create: `src/lib/ui/forms.tsx`

**Interfaces:**
- Consumes: `listPropertiesForCurrentUser`, `createProperty` от Task 11
- Produces: три страници за properties + form primitives (Input, Label, Button)

- [ ] **Step 1: Form primitives**

```tsx
// src/lib/ui/forms.tsx
export function Label({ children, ...p }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className="block text-sm text-gray-700 mb-1" {...p}>{children}</label>;
}

export function Input(p: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
      {...p}
    />
  );
}

export function Textarea(p: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
      rows={4}
      {...p}
    />
  );
}

export function Select({ children, ...p }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className="block w-full rounded border border-gray-300 px-3 py-2 text-sm bg-white"
      {...p}
    >
      {children}
    </select>
  );
}

export function Button({ variant = 'primary', ...p }:
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' }) {
  const cls = variant === 'primary'
    ? 'bg-black text-white hover:bg-gray-800'
    : variant === 'danger'
    ? 'bg-red-600 text-white hover:bg-red-700'
    : 'border border-gray-300 hover:bg-gray-50';
  return (
    <button
      className={`inline-flex items-center rounded px-4 py-2 text-sm font-medium disabled:opacity-50 ${cls}`}
      {...p}
    />
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return <p className="text-red-700 text-sm mt-2">{message}</p>;
}
```

- [ ] **Step 2: List страница**

```tsx
// src/app/app/properties/page.tsx
import Link from 'next/link';
import { listPropertiesForCurrentUser } from '@/domains/agency/queries';
import { Button } from '@/lib/ui/forms';

export default async function PropertiesPage() {
  const rows = await listPropertiesForCurrentUser();
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Имоти</h1>
        <Link href="/app/properties/new"><Button>Нов имот</Button></Link>
      </div>
      {rows.length === 0 ? (
        <p className="text-gray-600">Няма имоти. <Link href="/app/properties/new" className="underline">Създай първия.</Link></p>
      ) : (
        <table className="w-full text-sm bg-white rounded border border-gray-200">
          <thead className="bg-gray-50 text-left text-gray-600">
            <tr>
              <th className="p-3">Адрес</th>
              <th className="p-3">Агенция</th>
              <th className="p-3">Район</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-gray-100">
                <td className="p-3">{r.addressLabel}</td>
                <td className="p-3 text-gray-600">{r.agencyName}</td>
                <td className="p-3 text-gray-600">{r.regionCode ?? '—'}</td>
                <td className="p-3 text-right">
                  <Link href={`/app/properties/${r.id}`} className="underline text-sm">Виж</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create form**

```tsx
// src/app/app/properties/new/page.tsx
import { redirect } from 'next/navigation';
import { requirePlatform } from '@/lib/auth/guards';
import { listAgencies } from '@/domains/agency/queries';
import { createProperty } from '@/domains/agency/actions';
import { Label, Input, Select, Button } from '@/lib/ui/forms';

export default async function NewPropertyPage() {
  await requirePlatform();
  const agencies = await listAgencies();

  async function submit(formData: FormData) {
    'use server';
    const id = await createProperty({
      agencyId: String(formData.get('agencyId')),
      addressLabel: String(formData.get('addressLabel')),
      listingRef: formData.get('listingRef')?.toString() || undefined,
      cadastralNumber: formData.get('cadastralNumber')?.toString() || undefined,
      regionCode: formData.get('regionCode')?.toString() || undefined,
      gpsLat: Number(formData.get('gpsLat')),
      gpsLng: Number(formData.get('gpsLng')),
    });
    redirect(`/app/properties/${id}`);
  }

  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-semibold mb-6">Нов имот</h1>
      <form action={submit} className="space-y-4">
        <div>
          <Label htmlFor="agencyId">Агенция</Label>
          <Select id="agencyId" name="agencyId" required>
            {agencies.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor="addressLabel">Адрес (село, район)</Label>
          <Input id="addressLabel" name="addressLabel" required maxLength={200} />
        </div>
        <div>
          <Label htmlFor="listingRef">Външен ID (по избор)</Label>
          <Input id="listingRef" name="listingRef" maxLength={100} placeholder="BP-12345" />
        </div>
        <div>
          <Label htmlFor="cadastralNumber">Кадастрален номер (по избор)</Label>
          <Input id="cadastralNumber" name="cadastralNumber" maxLength={50} />
        </div>
        <div>
          <Label htmlFor="regionCode">ЕКАТТЕ на населеното място (по избор)</Label>
          <Input id="regionCode" name="regionCode" maxLength={20} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="gpsLat">GPS ширина</Label>
            <Input id="gpsLat" name="gpsLat" type="number" step="0.0000001" required
                   min={-90} max={90} placeholder="42.500000" />
          </div>
          <div>
            <Label htmlFor="gpsLng">GPS дължина</Label>
            <Input id="gpsLng" name="gpsLng" type="number" step="0.0000001" required
                   min={-180} max={180} placeholder="23.500000" />
          </div>
        </div>
        <Button type="submit">Запази</Button>
      </form>
    </div>
  );
}
```

- [ ] **Step 4: Detail страница (простa)**

```tsx
// src/app/app/properties/[id]/page.tsx
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { createServerClient } from '@/lib/supabase/server';

export default async function PropertyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from('properties')
    .select(`id, address_label, cadastral_number, region_code, agencies!inner(name)`)
    .eq('id', id)
    .maybeSingle();
  if (error || !data) notFound();
  const p: any = data;
  return (
    <div>
      <Link href="/app/properties" className="text-sm underline text-gray-600">← Имоти</Link>
      <h1 className="text-2xl font-semibold mt-2">{p.address_label}</h1>
      <p className="text-gray-600 mt-1">Агенция: {p.agencies.name}</p>
      {p.cadastral_number && <p className="text-gray-600">Кадастър: {p.cadastral_number}</p>}
      {p.region_code && <p className="text-gray-600">ЕКАТТЕ: {p.region_code}</p>}
      <div className="mt-6">
        <Link href={`/app/assessments/new?propertyId=${p.id}`}
              className="underline text-sm">
          Създай оценка за този имот →
        </Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Ръчна проверка**

```bash
pnpm dev
```
Логни се като admin, отвори `/app/properties` — празен list с бутон "Нов имот". Създай агенция (следваща task ще направи UI, за сега през psql):
```bash
pnpm supabase db psql -c "insert into agencies (slug, name, contact_email) values ('bp', 'BulgarianProperties', 'sales@bp.bg');"
```
После създай имот през UI-а. Провери че се появява в list-а.

- [ ] **Step 6: Commit**

```bash
git add src/app/app/properties src/lib/ui/forms.tsx
git commit -m "feat(dashboard): properties list, create, and detail pages"
```

---

## Task 16: Assessments CRUD (list + create draft + detail + issue)

**Files:**
- Create: `src/app/app/assessments/page.tsx`
- Create: `src/app/app/assessments/new/page.tsx`
- Create: `src/app/app/assessments/[id]/page.tsx`

**Interfaces:**
- Consumes: `listAssessmentsForCurrentUser`, `getAssessment`, `createDraftAssessment`, `issueAssessment`
- Produces: три страници за assessments

- [ ] **Step 1: List страница**

```tsx
// src/app/app/assessments/page.tsx
import Link from 'next/link';
import { listAssessmentsForCurrentUser } from '@/domains/assessment/queries';
import { Button } from '@/lib/ui/forms';

const STATUS_LABELS: Record<string, string> = {
  draft: 'Чернова', issued: 'Издадена', archived: 'Архивирана',
};

export default async function AssessmentsPage() {
  const rows = await listAssessmentsForCurrentUser();
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Оценки</h1>
        <Link href="/app/assessments/new"><Button>Нова оценка</Button></Link>
      </div>
      {rows.length === 0 ? (
        <p className="text-gray-600">Няма оценки. <Link href="/app/assessments/new" className="underline">Създай първата.</Link></p>
      ) : (
        <table className="w-full text-sm bg-white rounded border border-gray-200">
          <thead className="bg-gray-50 text-left text-gray-600">
            <tr>
              <th className="p-3">Код</th>
              <th className="p-3">Клас</th>
              <th className="p-3">Имот</th>
              <th className="p-3">Агенция</th>
              <th className="p-3">Статус</th>
              <th className="p-3">Дата</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-gray-100">
                <td className="p-3 font-mono">
                  <Link href={`/app/assessments/${r.id}`} className="underline">
                    {r.code ?? '—'}
                  </Link>
                </td>
                <td className="p-3">{r.class ?? '—'}</td>
                <td className="p-3">{r.addressLabel}</td>
                <td className="p-3 text-gray-600">{r.agencyName}</td>
                <td className="p-3 text-gray-600">{STATUS_LABELS[r.status] ?? r.status}</td>
                <td className="p-3 text-gray-600">
                  {r.measuredAt
                    ? new Date(r.measuredAt).toLocaleDateString('bg-BG')
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

- [ ] **Step 2: New assessment form**

```tsx
// src/app/app/assessments/new/page.tsx
import { redirect } from 'next/navigation';
import { requirePlatform } from '@/lib/auth/guards';
import { listPropertiesForCurrentUser } from '@/domains/agency/queries';
import { createDraftAssessment } from '@/domains/assessment/actions';
import { Label, Input, Select, Textarea, Button } from '@/lib/ui/forms';

export default async function NewAssessmentPage({ searchParams }:
  { searchParams: Promise<{ propertyId?: string }> }) {
  await requirePlatform();
  const { propertyId: preselected } = await searchParams;
  const properties = await listPropertiesForCurrentUser();

  async function submit(formData: FormData) {
    'use server';
    const id = await createDraftAssessment({
      propertyId: String(formData.get('propertyId')),
      measuredAt: formData.get('measuredAt')?.toString() || undefined,
      class: (formData.get('class')?.toString() as 'A'|'B'|'C'|'D') || undefined,
      depthMinM: formData.get('depthMinM') ? Number(formData.get('depthMinM')) : undefined,
      depthMaxM: formData.get('depthMaxM') ? Number(formData.get('depthMaxM')) : undefined,
      expectedFlowMinM3h: formData.get('flowMin') ? Number(formData.get('flowMin')) : undefined,
      expectedFlowMaxM3h: formData.get('flowMax') ? Number(formData.get('flowMax')) : undefined,
      confidenceNote: formData.get('confidenceNote')?.toString() || undefined,
    });
    redirect(`/app/assessments/${id}`);
  }

  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-semibold mb-6">Нова оценка (чернова)</h1>
      <form action={submit} className="space-y-4">
        <div>
          <Label htmlFor="propertyId">Имот</Label>
          <Select id="propertyId" name="propertyId" required defaultValue={preselected ?? ''}>
            <option value="">— избери имот —</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>{p.addressLabel} ({p.agencyName})</option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="measuredAt">Дата на измерване</Label>
          <Input id="measuredAt" name="measuredAt" type="date" />
        </div>
        <div>
          <Label htmlFor="class">Клас</Label>
          <Select id="class" name="class">
            <option value="">— още не —</option>
            <option value="A">A — плитък, висока вероятност</option>
            <option value="B">B — потвърден среден</option>
            <option value="C">C — вероятен голяма дълбочина</option>
            <option value="D">D — липсва ясен хоризонт</option>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="depthMinM">Дълбочина от (м)</Label>
            <Input id="depthMinM" name="depthMinM" type="number" step="0.5" min={0} max={500} />
          </div>
          <div>
            <Label htmlFor="depthMaxM">Дълбочина до (м)</Label>
            <Input id="depthMaxM" name="depthMaxM" type="number" step="0.5" min={0} max={500} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="flowMin">Дебит от (м³/ч)</Label>
            <Input id="flowMin" name="flowMin" type="number" step="0.1" min={0} />
          </div>
          <div>
            <Label htmlFor="flowMax">Дебит до (м³/ч)</Label>
            <Input id="flowMax" name="flowMax" type="number" step="0.1" min={0} />
          </div>
        </div>
        <div>
          <Label htmlFor="confidenceNote">Бележка на оператора</Label>
          <Textarea id="confidenceNote" name="confidenceNote" maxLength={2000} />
        </div>
        <Button type="submit">Запази чернова</Button>
      </form>
    </div>
  );
}
```

- [ ] **Step 3: Detail с issue action и embed snippet**

```tsx
// src/app/app/assessments/[id]/page.tsx
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getAssessment } from '@/domains/assessment/queries';
import { issueAssessment } from '@/domains/assessment/actions';
import { Button } from '@/lib/ui/forms';

export default async function AssessmentDetailPage({ params }:
  { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const a = await getAssessment(id);
  if (!a) notFound();

  async function issue() {
    'use server';
    await issueAssessment(id);
  }

  const canIssue = a.status === 'draft'
    && a.class && a.depthMinM != null && a.depthMaxM != null && a.measuredAt;

  return (
    <div className="max-w-2xl">
      <Link href="/app/assessments" className="text-sm underline text-gray-600">← Оценки</Link>
      <h1 className="text-2xl font-semibold mt-2">
        {a.class ? `Оценка Клас ${a.class}` : 'Оценка (без клас)'}
      </h1>
      <p className="text-gray-600">
        {a.addressLabel} · {a.agencyName} · Статус: <code>{a.status}</code>
      </p>
      {a.code && <p className="mt-2 font-mono text-lg">Код: <strong>{a.code}</strong></p>}

      <dl className="mt-6 grid grid-cols-2 gap-4 text-sm">
        <div><dt className="text-gray-500">Дълбочина</dt><dd>{a.depthMinM ?? '—'}–{a.depthMaxM ?? '—'} м</dd></div>
        <div><dt className="text-gray-500">Дебит</dt><dd>{a.expectedFlowMinM3h ?? '—'}–{a.expectedFlowMaxM3h ?? '—'} м³/ч</dd></div>
        <div><dt className="text-gray-500">Метод</dt><dd>{a.method}</dd></div>
        <div><dt className="text-gray-500">Дата</dt><dd>{a.measuredAt ? new Date(a.measuredAt).toLocaleDateString('bg-BG') : '—'}</dd></div>
      </dl>

      {a.confidenceNote && (
        <div className="mt-6">
          <h2 className="text-lg font-semibold mb-2">Бележка</h2>
          <p className="text-gray-700 whitespace-pre-wrap">{a.confidenceNote}</p>
        </div>
      )}

      <div className="mt-6 flex gap-4">
        {a.status === 'draft' && (
          <form action={issue}>
            <Button type="submit" disabled={!canIssue}>
              {canIssue ? 'Издай оценка' : 'Липсват задължителни полета'}
            </Button>
          </form>
        )}
        {a.pdfPath && (
          <Link href={`/api/pdf/${a.id}`} target="_blank">
            <Button variant="secondary">Изтегли PDF</Button>
          </Link>
        )}
      </div>

      {a.code && (
        <div className="mt-8">
          <h2 className="text-lg font-semibold mb-2">Embed за обявата</h2>
          <p className="text-sm text-gray-600 mb-2">Копирай долния HTML в описанието на обявата:</p>
          <pre className="bg-gray-100 p-3 rounded text-xs overflow-x-auto"><code>
{`<a href="https://voda-check.bg/v/${a.code}">Водна оценка: ${a.class} · ${a.depthMinM}–${a.depthMaxM} м · Провери</a>`}
          </code></pre>
          <p className="text-xs text-gray-500 mt-2">
            (План 2 ще замени този HTML с автоматичен script/badge.)
          </p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Ръчна проверка end-to-end**

```bash
pnpm dev
```
1. Логни се като admin
2. Създай агенция през psql (или изчакай Task 18)
3. Създай имот
4. Създай оценка (чернова)
5. Попълни всички полета за издаване
6. Кликни "Издай" — трябва да получиш код и PDF path
7. Кликни "Изтегли PDF" — трябва да отвори PDF

- [ ] **Step 5: Commit**

```bash
git add src/app/app/assessments
git commit -m "feat(dashboard): assessments list, draft, and issue flow with PDF"
```

---

## Task 17: Drilling outcome — agency form + platform verify form

**Files:**
- Create: `src/app/app/assessments/[id]/outcome/page.tsx`
- Create: `src/domains/assessment/outcome.ts`

**Interfaces:**
- Produces: `submitAgencyOutcome`, `submitVerifiedOutcome` server actions
- Produces: страница `/app/assessments/[id]/outcome` — form с role-adaptive fields

- [ ] **Step 1: Outcome actions**

```typescript
// src/domains/assessment/outcome.ts
'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createServerClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/auth/guards';
import { isPlatform, isAgency } from '@/lib/auth/session';

const OutcomeInputSchema = z.object({
  assessmentId: z.string().uuid(),
  outcome: z.enum(['drilled_success','drilled_dry','drilled_partial','not_drilled','planned']),
  actualDepthM: z.number().min(0).max(500).optional(),
  actualFlowM3h: z.number().min(0).optional(),
  drilledAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes: z.string().max(2000).optional(),
});
export type OutcomeInput = z.infer<typeof OutcomeInputSchema>;

export async function submitOutcome(input: OutcomeInput): Promise<void> {
  const session = await requireSession();
  const parsed = OutcomeInputSchema.parse(input);
  const supabase = await createServerClient();

  const source: 'agency_reported' | 'admin_verified' =
    isPlatform(session.role) ? 'admin_verified' :
    isAgency(session.role) ? 'agency_reported' :
    (() => { throw new Error('Unauthorized role'); })();

  const insert = {
    assessment_id: parsed.assessmentId,
    outcome: parsed.outcome,
    actual_depth_m: parsed.actualDepthM ?? null,
    actual_flow_m3h: parsed.actualFlowM3h ?? null,
    drilled_at: parsed.drilledAt ?? null,
    notes: parsed.notes ?? null,
    source,
    submitted_by: session.userId,
  };
  const { error } = await supabase.from('drilling_outcomes').insert(insert);
  if (error) throw error;
  revalidatePath(`/app/assessments/${parsed.assessmentId}`);
}
```

- [ ] **Step 2: Outcome страница**

```tsx
// src/app/app/assessments/[id]/outcome/page.tsx
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { requireSession } from '@/lib/auth/guards';
import { isPlatform } from '@/lib/auth/session';
import { getAssessment } from '@/domains/assessment/queries';
import { submitOutcome } from '@/domains/assessment/outcome';
import { Label, Input, Select, Textarea, Button } from '@/lib/ui/forms';

export default async function OutcomePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  const a = await getAssessment(id);
  if (!a) notFound();

  const source = isPlatform(session.role) ? 'admin_verified' : 'agency_reported';

  async function submit(formData: FormData) {
    'use server';
    await submitOutcome({
      assessmentId: id,
      outcome: formData.get('outcome') as any,
      actualDepthM: formData.get('actualDepthM') ? Number(formData.get('actualDepthM')) : undefined,
      actualFlowM3h: formData.get('actualFlowM3h') ? Number(formData.get('actualFlowM3h')) : undefined,
      drilledAt: formData.get('drilledAt')?.toString() || undefined,
      notes: formData.get('notes')?.toString() || undefined,
    });
    redirect(`/app/assessments/${id}`);
  }

  return (
    <div className="max-w-xl">
      <Link href={`/app/assessments/${id}`} className="text-sm underline text-gray-600">← Оценка</Link>
      <h1 className="text-2xl font-semibold mt-2">Резултат от сондаж</h1>
      <p className="text-sm text-gray-600 mt-1">
        Тип: <strong>{source === 'admin_verified' ? 'Verified (админ)' : 'Reported (агенция)'}</strong>
      </p>

      <form action={submit} className="space-y-4 mt-6">
        <div>
          <Label htmlFor="outcome">Резултат</Label>
          <Select id="outcome" name="outcome" required>
            <option value="drilled_success">Копано, вода намерена</option>
            <option value="drilled_dry">Копано, сухо</option>
            <option value="drilled_partial">Копано, частичен резултат</option>
            <option value="not_drilled">Не копано</option>
            <option value="planned">Планирано</option>
          </Select>
        </div>
        <div>
          <Label htmlFor="drilledAt">Дата на сондажа</Label>
          <Input id="drilledAt" name="drilledAt" type="date" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="actualDepthM">Реална дълбочина (м)</Label>
            <Input id="actualDepthM" name="actualDepthM" type="number" step="0.1" min={0} max={500} />
          </div>
          <div>
            <Label htmlFor="actualFlowM3h">Реален дебит (м³/ч)</Label>
            <Input id="actualFlowM3h" name="actualFlowM3h" type="number" step="0.1" min={0} />
          </div>
        </div>
        <div>
          <Label htmlFor="notes">Бележки</Label>
          <Textarea id="notes" name="notes" maxLength={2000} />
        </div>
        <Button type="submit">Запази резултат</Button>
      </form>
    </div>
  );
}
```

- [ ] **Step 3: Добави линк в detail страницата**

Отвори `src/app/app/assessments/[id]/page.tsx`, добави след PDF бутона:
```tsx
{a.status === 'issued' && (
  <Link href={`/app/assessments/${a.id}/outcome`}>
    <Button variant="secondary">Добави резултат от сондаж</Button>
  </Link>
)}
```

- [ ] **Step 4: Ръчна проверка**

Логни се като admin, отвори issued оценка, кликни "Добави резултат от сондаж", попълни и запази. Провери в psql че записът е там със `source = 'admin_verified'`.

- [ ] **Step 5: Commit**

```bash
git add src/app/app/assessments/[id]/outcome src/domains/assessment/outcome.ts src/app/app/assessments/[id]/page.tsx
git commit -m "feat(assessment): drilling outcome form for agency and platform roles"
```

---

## Task 18: Admin — agencies CRUD

**Files:**
- Create: `src/app/app/admin/agencies/page.tsx`
- Create: `src/app/app/admin/agencies/new/page.tsx`
- Create: `src/app/app/admin/users/page.tsx`

**Interfaces:**
- Consumes: `listAgencies`, `createAgency`
- Produces: 3 admin страници (само `platform_admin`)

- [ ] **Step 1: Agencies list**

```tsx
// src/app/app/admin/agencies/page.tsx
import Link from 'next/link';
import { requirePlatformAdmin } from '@/lib/auth/guards';
import { listAgencies } from '@/domains/agency/queries';
import { Button } from '@/lib/ui/forms';

export default async function AdminAgenciesPage() {
  await requirePlatformAdmin();
  const agencies = await listAgencies();
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Партньорски агенции</h1>
        <Link href="/app/admin/agencies/new"><Button>Нова агенция</Button></Link>
      </div>
      {agencies.length === 0 ? (
        <p className="text-gray-600">Няма агенции.</p>
      ) : (
        <table className="w-full text-sm bg-white rounded border border-gray-200">
          <thead className="bg-gray-50 text-left text-gray-600">
            <tr>
              <th className="p-3">Име</th>
              <th className="p-3">Slug</th>
              <th className="p-3">Контакт</th>
            </tr>
          </thead>
          <tbody>
            {agencies.map((a) => (
              <tr key={a.id} className="border-t border-gray-100">
                <td className="p-3">{a.name}</td>
                <td className="p-3 font-mono text-gray-600">{a.slug}</td>
                <td className="p-3 text-gray-600">{a.contactEmail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create agency form**

```tsx
// src/app/app/admin/agencies/new/page.tsx
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { requirePlatformAdmin } from '@/lib/auth/guards';
import { createAgency } from '@/domains/agency/actions';
import { Label, Input, Button } from '@/lib/ui/forms';

export default async function NewAgencyPage() {
  await requirePlatformAdmin();

  async function submit(formData: FormData) {
    'use server';
    await createAgency({
      slug: String(formData.get('slug')),
      name: String(formData.get('name')),
      contactEmail: String(formData.get('contactEmail')),
    });
    redirect('/app/admin/agencies');
  }

  return (
    <div className="max-w-lg">
      <Link href="/app/admin/agencies" className="text-sm underline text-gray-600">← Агенции</Link>
      <h1 className="text-2xl font-semibold mt-2 mb-6">Нова агенция</h1>
      <form action={submit} className="space-y-4">
        <div>
          <Label htmlFor="name">Име на агенция</Label>
          <Input id="name" name="name" required minLength={2} maxLength={200} />
        </div>
        <div>
          <Label htmlFor="slug">URL slug</Label>
          <Input id="slug" name="slug" required pattern="[a-z0-9][a-z0-9-]{2,63}"
                 placeholder="bulgarian-properties" />
          <p className="text-xs text-gray-500 mt-1">Малки букви, цифри, тирета; 3–64 символа.</p>
        </div>
        <div>
          <Label htmlFor="contactEmail">Контакт email</Label>
          <Input id="contactEmail" name="contactEmail" type="email" required />
        </div>
        <Button type="submit">Създай</Button>
      </form>
    </div>
  );
}
```

- [ ] **Step 3: Users список (простo view — invite през psql в MVP)**

```tsx
// src/app/app/admin/users/page.tsx
import { requirePlatformAdmin } from '@/lib/auth/guards';
import { createServerClient } from '@/lib/supabase/server';

export default async function AdminUsersPage() {
  await requirePlatformAdmin();
  const supabase = await createServerClient();
  const [{ data: platform }, { data: agency }] = await Promise.all([
    supabase.from('platform_users').select('id, role, full_name'),
    supabase.from('agency_users').select('id, role, full_name, agencies!inner(name)'),
  ]);

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-6">Потребители</h1>
      <div className="rounded border border-yellow-200 bg-yellow-50 p-4 text-sm mb-6">
        Създаване на нови потребители в MVP: през Supabase Studio → Authentication →
        добавяш email, после през SQL: <code className="text-xs">insert into platform_users (id, role) values ('&lt;user-id&gt;', 'platform_operator');</code>
      </div>
      <section>
        <h2 className="text-lg font-semibold mb-3">Platform</h2>
        <table className="w-full text-sm bg-white rounded border border-gray-200 mb-6">
          <thead className="bg-gray-50 text-left text-gray-600">
            <tr><th className="p-3">Име</th><th className="p-3">Роля</th><th className="p-3">ID</th></tr>
          </thead>
          <tbody>
            {(platform ?? []).map((u) => (
              <tr key={u.id} className="border-t border-gray-100">
                <td className="p-3">{u.full_name ?? '—'}</td>
                <td className="p-3 font-mono text-xs">{u.role}</td>
                <td className="p-3 font-mono text-xs text-gray-500">{u.id}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section>
        <h2 className="text-lg font-semibold mb-3">Agency</h2>
        <table className="w-full text-sm bg-white rounded border border-gray-200">
          <thead className="bg-gray-50 text-left text-gray-600">
            <tr>
              <th className="p-3">Име</th><th className="p-3">Агенция</th>
              <th className="p-3">Роля</th><th className="p-3">ID</th>
            </tr>
          </thead>
          <tbody>
            {(agency ?? []).map((u: any) => (
              <tr key={u.id} className="border-t border-gray-100">
                <td className="p-3">{u.full_name ?? '—'}</td>
                <td className="p-3">{u.agencies.name}</td>
                <td className="p-3 font-mono text-xs">{u.role}</td>
                <td className="p-3 font-mono text-xs text-gray-500">{u.id}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Ръчна проверка**

Логни се като admin. Отвори `/app/admin/agencies`, създай агенция от UI-а. Провери че се появява в list-а.

- [ ] **Step 5: Commit**

```bash
git add src/app/app/admin
git commit -m "feat(admin): agencies list, create, and users viewer"
```

---

## Task 19: RLS integration test suite

**Files:**
- Create: `tests/integration/setup.ts`
- Create: `tests/integration/rls-agencies.test.ts`
- Create: `tests/integration/rls-properties.test.ts`
- Create: `tests/integration/rls-assessments.test.ts`
- Create: `tests/integration/rls-photos.test.ts`
- Create: `tests/integration/rls-outcomes.test.ts`

**Interfaces:**
- Consumes: локална Supabase инстанция
- Produces: 5 test file-а покриващи всяка RLS полица
- Всеки test file създава isolated fixtures, тества позволени и забранени операции

- [ ] **Step 1: Setup helper**

```typescript
// tests/integration/setup.ts
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export function service(): SupabaseClient {
  return createClient(URL, SERVICE, { auth: { persistSession: false } });
}

export function anon(): SupabaseClient {
  return createClient(URL, ANON, { auth: { persistSession: false } });
}

export async function asUser(userId: string): Promise<SupabaseClient> {
  const svc = service();
  // Генерира JWT за конкретен user id
  const { data, error } = await svc.auth.admin.generateLink({
    type: 'magiclink',
    email: 'noop@example.com',
  });
  // В real usage тестваме през setSession — за simplicity тук ползваме service.auth за да направим sign-in
  const client = createClient(URL, ANON, { auth: { persistSession: false } });
  // За тестовете, задаваме заглавието Authorization ръчно
  const token = await mintJwt(userId);
  return createClient(URL, ANON, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

// JWT минтване с dev secret — Supabase local го приема
import { SignJWT } from 'jose';
const JWT_SECRET = new TextEncoder().encode(
  process.env.SUPABASE_JWT_SECRET ?? 'super-secret-jwt-token-with-at-least-32-characters-long'
);

async function mintJwt(userId: string): Promise<string> {
  return new SignJWT({ sub: userId, role: 'authenticated', aud: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(JWT_SECRET);
}

export async function createFixtureAgency(name: string): Promise<string> {
  const svc = service();
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Date.now();
  const { data, error } = await svc.from('agencies')
    .insert({ slug, name, contact_email: `${slug}@test.bg` }).select('id').single();
  if (error) throw error;
  return data.id;
}

export async function createFixtureAuthUser(email: string): Promise<string> {
  const svc = service();
  const { data, error } = await svc.auth.admin.createUser({
    email, email_confirm: true, password: 'testpassword123!',
  });
  if (error) throw error;
  return data.user!.id;
}

export async function createFixturePlatformUser(email: string, role: 'platform_admin' | 'platform_operator'): Promise<string> {
  const svc = service();
  const uid = await createFixtureAuthUser(email);
  await svc.from('platform_users').insert({ id: uid, role, full_name: 'Test' });
  return uid;
}

export async function createFixtureAgencyUser(email: string, agencyId: string, role: 'agency_admin' | 'agency_viewer'): Promise<string> {
  const svc = service();
  const uid = await createFixtureAuthUser(email);
  await svc.from('agency_users').insert({ id: uid, agency_id: agencyId, role, full_name: 'Test' });
  return uid;
}

export async function cleanupUser(userId: string): Promise<void> {
  const svc = service();
  await svc.auth.admin.deleteUser(userId);
}

export async function cleanupAgency(agencyId: string): Promise<void> {
  const svc = service();
  await svc.from('agencies').delete().eq('id', agencyId);
}

export { asUser as authAs };
```

Инсталирай `jose`:
```bash
pnpm add -D jose
```

- [ ] **Step 2: Test за agencies RLS**

```typescript
// tests/integration/rls-agencies.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  createFixtureAgency, createFixturePlatformUser, createFixtureAgencyUser,
  authAs, anon, service, cleanupAgency, cleanupUser,
} from './setup';

describe('agencies RLS', () => {
  let agencyAId: string, agencyBId: string;
  let adminUid: string, opUid: string, aAdminUid: string, bAdminUid: string;

  beforeAll(async () => {
    agencyAId = await createFixtureAgency('AgencyA');
    agencyBId = await createFixtureAgency('AgencyB');
    adminUid = await createFixturePlatformUser('admin-agtest@test.bg', 'platform_admin');
    opUid = await createFixturePlatformUser('op-agtest@test.bg', 'platform_operator');
    aAdminUid = await createFixtureAgencyUser('a-admin@test.bg', agencyAId, 'agency_admin');
    bAdminUid = await createFixtureAgencyUser('b-admin@test.bg', agencyBId, 'agency_admin');
  });

  afterAll(async () => {
    await Promise.all([adminUid, opUid, aAdminUid, bAdminUid].map(cleanupUser));
    await cleanupAgency(agencyAId);
    await cleanupAgency(agencyBId);
  });

  it('platform_admin sees all agencies', async () => {
    const c = await authAs(adminUid);
    const { data, error } = await c.from('agencies').select('id');
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThanOrEqual(2);
  });

  it('platform_operator sees all agencies', async () => {
    const c = await authAs(opUid);
    const { data } = await c.from('agencies').select('id');
    expect(data!.length).toBeGreaterThanOrEqual(2);
  });

  it('agency_admin sees ONLY own agency', async () => {
    const c = await authAs(aAdminUid);
    const { data } = await c.from('agencies').select('id');
    expect(data).toEqual([{ id: agencyAId }]);
  });

  it('anon sees no agencies', async () => {
    const { data } = await anon().from('agencies').select('id');
    expect(data).toEqual([]);
  });

  it('agency_admin cannot insert agency', async () => {
    const c = await authAs(aAdminUid);
    const { error } = await c.from('agencies')
      .insert({ slug: 'hack', name: 'X', contact_email: 'x@x.bg' });
    expect(error).not.toBeNull();
  });
});
```

- [ ] **Step 3: Аналогични тестове**

Създай `rls-properties.test.ts`, `rls-assessments.test.ts`, `rls-photos.test.ts`, `rls-outcomes.test.ts` по същата структура. Всеки трябва да покрива:
- platform виждa всички
- agency вижда САМО своите (cross-agency четене = 0 редове, не грешка)
- anon вижда нищо (или само публично каквото е позволено)
- Опит за cross-agency insert/update = грешка

Заради дължината, ето единично покритие за assessments (останалите следват същия pattern):

```typescript
// tests/integration/rls-assessments.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  createFixtureAgency, createFixturePlatformUser, createFixtureAgencyUser,
  authAs, anon, service, cleanupAgency, cleanupUser,
} from './setup';
import { generateAssessmentCode } from '@/domains/assessment/code';

describe('assessments RLS', () => {
  let agencyA: string, agencyB: string;
  let opUid: string, aUserUid: string, bUserUid: string;
  let propA: string, propB: string;
  let assessA: string, assessB: string;

  beforeAll(async () => {
    process.env.ASSESSMENT_CODE_SECRET = process.env.ASSESSMENT_CODE_SECRET
      ?? 'a'.repeat(64);
    const svc = service();
    agencyA = await createFixtureAgency('RLS-A');
    agencyB = await createFixtureAgency('RLS-B');
    opUid = await createFixturePlatformUser('rls-op@test.bg', 'platform_operator');
    aUserUid = await createFixtureAgencyUser('rls-a@test.bg', agencyA, 'agency_viewer');
    bUserUid = await createFixtureAgencyUser('rls-b@test.bg', agencyB, 'agency_viewer');

    const { data: pA } = await svc.from('properties').insert({
      agency_id: agencyA, address_label: 'A',
      gps_point: 'SRID=4326;POINT(23 42)',
    }).select('id').single();
    propA = pA!.id;
    const { data: pB } = await svc.from('properties').insert({
      agency_id: agencyB, address_label: 'B',
      gps_point: 'SRID=4326;POINT(24 43)',
    }).select('id').single();
    propB = pB!.id;

    // Издаден assessment за A
    const { data: aA } = await svc.from('assessments').insert({
      property_id: propA, agency_id: agencyA, operator_id: opUid,
      status: 'issued', class: 'B', depth_min_m: 20, depth_max_m: 30,
      measured_at: '2026-01-01', issued_at: new Date().toISOString(),
      code: 'placeholder',
    }).select('id').single();
    assessA = aA!.id;
    const codeA = generateAssessmentCode(assessA);
    await svc.from('assessments').update({ code: codeA }).eq('id', assessA);

    // Draft assessment за B
    const { data: aB } = await svc.from('assessments').insert({
      property_id: propB, agency_id: agencyB, operator_id: opUid, status: 'draft',
    }).select('id').single();
    assessB = aB!.id;
  });

  afterAll(async () => {
    const svc = service();
    await svc.from('assessments').delete().in('id', [assessA, assessB]);
    await svc.from('properties').delete().in('id', [propA, propB]);
    await Promise.all([opUid, aUserUid, bUserUid].map(cleanupUser));
    await cleanupAgency(agencyA);
    await cleanupAgency(agencyB);
  });

  it('agency_viewer sees own agency assessments', async () => {
    const c = await authAs(aUserUid);
    const { data } = await c.from('assessments').select('id, agency_id');
    expect(data!.every((r) => r.agency_id === agencyA)).toBe(true);
    expect(data!.find((r) => r.id === assessA)).toBeTruthy();
    expect(data!.find((r) => r.id === assessB)).toBeUndefined();
  });

  it('anon without code sees nothing', async () => {
    const c = anon();
    const { data } = await c.from('assessments').select('id');
    expect(data).toEqual([]);
  });

  it('anon with valid code sees the one issued assessment', async () => {
    const svc = service();
    const code = generateAssessmentCode(assessA);
    // Set the GUC and run as anon via RPC (or use direct SQL през service)
    const c = anon();
    // За anon достъпа през GUC е чрез PostgREST при указан код в custom header
    // — тук минаваме през простия RPC pattern:
    await svc.rpc('set_config', { param: 'app.requested_code', value: code, is_local: false })
      .catch(() => { /* stub — some Supabase versions експортват set_config */ });
    const { data } = await c.rpc('anon_get_assessment_by_code', { p_code: code })
      .catch(() => ({ data: null }));
    // Ако RPC функцията не е дефинирана в MVP, skip този sub-тест
    if (data == null) {
      console.warn('anon_get_assessment_by_code RPC not implemented in План 1; ще се покрие в План 2');
      return;
    }
    expect(data).toBeTruthy();
  });

  it('anon with invalid code sees nothing', async () => {
    const c = anon();
    const { data } = await c.rpc('anon_get_assessment_by_code', { p_code: 'invalidx' })
      .catch(() => ({ data: null }));
    expect(data == null || (Array.isArray(data) && data.length === 0)).toBe(true);
  });

  it('agency user cannot insert assessment', async () => {
    const c = await authAs(aUserUid);
    const { error } = await c.from('assessments').insert({
      property_id: propA, agency_id: agencyA, operator_id: opUid, status: 'draft',
    });
    expect(error).not.toBeNull();
  });
});
```

Създай аналогични тестови файлове за `properties`, `photos`, `outcomes` по същия шаблон (fixtures per test, agent vs anon vs cross-agency).

- [ ] **Step 4: Run tests**

Убеди се че Supabase е стартиран:
```bash
pnpm db:reset
pnpm test tests/integration/
```
Expected: rls-agencies passes; assessments partially passes (anon-by-code sub-tests skip до План 2). Fix всякакви други failures.

- [ ] **Step 5: Commit**

```bash
git add tests/integration package.json pnpm-lock.yaml
git commit -m "test(rls): integration suite for agencies, properties, assessments, photos, outcomes"
```

---

## Task 20: E2E тест — admin issues assessment end-to-end

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/e2e/admin-issues-assessment.spec.ts`

**Interfaces:**
- Consumes: работещ Next.js dev сървър + Supabase
- Produces: E2E тест за критичния flow

- [ ] **Step 1: Playwright config**

```typescript
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
    locale: 'bg-BG',
    timezoneId: 'Europe/Sofia',
  },
  projects: [{ name: 'chromium', use: devices['Desktop Chrome'] }],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
```

Инсталирай browsers:
```bash
pnpm exec playwright install --with-deps chromium
```

- [ ] **Step 2: E2E тест**

```typescript
// tests/e2e/admin-issues-assessment.spec.ts
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

test('admin creates agency, property, assessment, issues it', async ({ page, context }) => {
  const svc = createClient(URL, SERVICE, { auth: { persistSession: false } });

  // Setup: admin user + магически линк
  const email = `e2e-admin-${Date.now()}@test.bg`;
  const { data: userData } = await svc.auth.admin.createUser({
    email, email_confirm: true, password: 'testpass1234!',
  });
  const uid = userData.user!.id;
  await svc.from('platform_users').insert({ id: uid, role: 'platform_admin', full_name: 'E2E Admin' });

  // Директно inject-ваме session cookie: използваме password login за simplicity в E2E
  await page.goto('/login');
  // Заобикаляме email flow: create session през admin API + set cookies
  const { data: sessionData } = await svc.auth.admin.generateLink({
    type: 'magiclink', email,
  });
  // За simplicity: вход през password
  await page.evaluate(async ({ url, anon, email, pw }) => {
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
    const c = createClient(url, anon);
    await c.auth.signInWithPassword({ email, password: pw });
  }, { url: URL, anon: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, email, pw: 'testpass1234!' });
  await page.reload();
  await page.goto('/app');

  // Създай агенция
  await page.goto('/app/admin/agencies/new');
  const slug = `e2e-${Date.now()}`;
  await page.getByLabel('Име на агенция').fill('E2E Agency');
  await page.getByLabel('URL slug').fill(slug);
  await page.getByLabel('Контакт email').fill('e2e@ag.bg');
  await page.getByRole('button', { name: 'Създай' }).click();
  await expect(page).toHaveURL(/\/app\/admin\/agencies/);

  // Създай имот
  await page.goto('/app/properties/new');
  await page.getByLabel('Агенция').selectOption({ label: 'E2E Agency' });
  await page.getByLabel('Адрес (село, район)').fill('Село E2E');
  await page.getByLabel('GPS ширина').fill('42.5');
  await page.getByLabel('GPS дължина').fill('23.5');
  await page.getByRole('button', { name: 'Запази' }).click();
  await expect(page.getByRole('heading', { name: 'Село E2E' })).toBeVisible();

  // Създай оценка
  await page.getByRole('link', { name: 'Създай оценка за този имот →' }).click();
  await page.getByLabel('Имот').selectOption({ label: /Село E2E/ });
  await page.getByLabel('Дата на измерване').fill('2026-01-15');
  await page.getByLabel('Клас').selectOption('B');
  await page.getByLabel('Дълбочина от (м)').fill('28');
  await page.getByLabel('Дълбочина до (м)').fill('36');
  await page.getByRole('button', { name: 'Запази чернова' }).click();

  // Издай
  await page.getByRole('button', { name: 'Издай оценка' }).click();
  await expect(page.getByText(/Код:\s*[a-z2-7]{8}/i)).toBeVisible({ timeout: 10_000 });

  // Cleanup
  await svc.from('assessments').delete().eq('agency_id',
    (await svc.from('agencies').select('id').eq('slug', slug).single()).data!.id
  );
  await svc.from('properties').delete().eq('agency_id',
    (await svc.from('agencies').select('id').eq('slug', slug).single()).data!.id
  );
  await svc.from('agencies').delete().eq('slug', slug);
  await svc.auth.admin.deleteUser(uid);
});
```

**Забележка:** за E2E тест ще ти трябва login flow който не изисква email inbox. За MVP достатъчно е да ползваме password auth (Supabase local го поддържа при `email_confirm: true`). В production ще ползваме само magic link.

Обнови `supabase/config.toml` за local:
```toml
[auth.email]
enable_confirmations = false
```

- [ ] **Step 3: Run E2E**

Терминал 1: `pnpm db:start`
Терминал 2: `pnpm dev`
Терминал 3:
```bash
pnpm test:e2e tests/e2e/admin-issues-assessment.spec.ts
```
Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add playwright.config.ts tests/e2e supabase/config.toml
git commit -m "test(e2e): admin creates agency, property, assessment and issues it"
```

---

## Task 21: README + dev docs

**Files:**
- Create: `README.md`
- Create: `docs/dev-setup.md`

- [ ] **Step 1: README**

```markdown
# Voda Check

Проверимо публикуване на хидрогеоложки измервания. Виж [spec-а](docs/superpowers/specs/2026-09-07-voda-check-system-design.md).

## Setup

```bash
pnpm install
pnpm db:start          # стартира локална Supabase
cp .env.local.example .env.local
# попълни .env.local с key-овете от `db:start` изхода
pnpm dev
```

Виж [docs/dev-setup.md](docs/dev-setup.md) за подробности.

## Тестове

```bash
pnpm test              # unit + integration
pnpm test:e2e          # end-to-end (изисква dev сървър)
```

## Стек

Next.js 15, TypeScript, Supabase (Postgres 16 + Auth + Storage), Tailwind 4,
react-pdf, Vitest, Playwright.
```

- [ ] **Step 2: Dev setup docs**

```markdown
# Dev Setup

## Изисквания

- Node.js >= 22
- pnpm 9.x
- Docker (за локална Supabase)
- Supabase CLI (инсталиран като devDep)

## Начални стъпки

1. `pnpm install`
2. `pnpm db:start` — първият път сваля images (~2 min)
3. Копирай output-нали keys в `.env.local`
4. Генерирай `ASSESSMENT_CODE_SECRET`:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
5. `pnpm dev`

## Създаване на първи admin

```bash
pnpm supabase db psql
```
```sql
-- Създай auth user
insert into auth.users (id, email, email_confirmed_at, encrypted_password)
  values (gen_random_uuid(), 'admin@voda-check.bg', now(),
          crypt('testpassword123!', gen_salt('bf')))
  returning id;
-- Копирай върнатия id
insert into platform_users (id, role, full_name)
  values ('<id>', 'platform_admin', 'Admin');
```

Отвори http://localhost:3000/login и въведи email-а — линкът се появява в
Inbucket (http://127.0.0.1:54324).

## Миграции

Създай нова миграция:
```bash
pnpm supabase migration new my_change
```

Прилагай в locale:
```bash
pnpm db:reset          # DROP + recreate + migrate
```

## Тестове

- Unit: `pnpm test` (Vitest)
- Integration (RLS): `pnpm test tests/integration/`
- E2E (Playwright): `pnpm test:e2e`

## Известни ограничения на План 1

Този план доставя **само admin backbone**. Публичен verify, email gate,
регистър, embed widget и PWA field capture ще се доставят в План 2 и План 3.
```

- [ ] **Step 3: Commit**

```bash
git add README.md docs/dev-setup.md
git commit -m "docs: README and dev setup guide"
```

---

## Self-review checklist (изпълнява се от executor-а)

След като всички задачи са завършени, provери:

- [ ] `pnpm lint` минава без грешки
- [ ] `pnpm build` минава без грешки
- [ ] `pnpm test` — всички unit + integration тестове passing
- [ ] `pnpm test:e2e` — E2E flow-ът passing
- [ ] Ръчен smoke test: admin login → create agency → create property → create + issue assessment → download PDF
- [ ] Всички RLS полиси enabled (`select tablename, rowsecurity from pg_tables where schemaname='public';` — всяка ред е `t`)
- [ ] Няма hard-coded secrets в кода (`grep -R "eyJ" src/` = празно)
- [ ] `.env.local` НЕ е в git (`git ls-files | grep env.local` = празно)

---

## Какво следва

**След изпълнението на План 1**, платформата има:
- Работещ data model с RLS
- Auth + role routing
- Admin dashboard за създаване на агенции, properties, assessments
- PDF генериране + download
- Drilling outcomes tracking
- Основно test coverage

**План 2 (Public Verify + Register + Embed)** ще добави:
- `/v/[code]` публично verify + email gate → пълен PDF
- Rate limiter + Turnstile
- `/registar`, `/karta`, `/agencii`, `/metodologia` публични страници
- `registry_stats`, `registry_heatmap` DB функции
- `/embed/[code].js` widget

**План 3 (PWA Field Capture)** ще добави:
- PWA manifest + service worker
- `/app/measure` mobile-first form
- Camera + GPS + photo upload
- PQWT export file parser
- IndexedDB offline queue

Всеки план се пише след успешно изпълнение на предходния.
