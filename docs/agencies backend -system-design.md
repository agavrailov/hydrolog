# Водна оценка — Система за проверимо публикуване на хидрогеоложки измервания

**Статус:** Design draft за одобрение
**Дата:** 7 септември 2026 г.
**Автор:** Антон Гавраилов + Claude
**Цел на документа:** Дефинира MVP архитектурата на платформа, която събира резултатите от полеви хидрогеоложки измервания (PQWT-GT150 + експертна интерпретация), издава проверими сертификати с кратък код и позволява публиката да провери конкретна обява без възможност за масово изтегляне.

---

## 1. Контекст и цели

### 1.1 Бизнес контекст

Услугата "водна оценка на имот" се продава през канал на агенции за недвижими имоти (Канал 3 от GTM). Всеки измерен имот получава клас **A/B/C/D** плюс дълбочинен диапазон и очакван дебит. Основният актив на бизнеса е **доверието** в публикуваните оценки — без проверим публичен регистър оценката не е сертификат, а маркетинг.

Референтни бизнес документи:
- `kanal-agencii-vodna-ocenka.md` — GTM канал 3 (агенции)
- `model-izmervane-doverie-skalirane.md` — измерването като продукт
- `komersialni-usloviya.md` — комерсиални условия
- `pazaren-analiz-hidrogeologia-sondazhi.md` — пазарен анализ

### 1.2 Цели на системата (MVP)

Системата трябва да:

1. **Издава проверими сертификати** — всяко измерване получава уникален код (напр. `xK3f9pQr`), който агенцията вгражда в обявата за имота.
2. **Позволява публична проверка по код** — купувач въвежда/кликва код и вижда основната оценка (клас, дълбочина, дата, метод, агенция).
3. **Издава пълен PDF отчет след email verification** — координати, крива на профила и снимки от терен са достъпни само след потвърждение на email.
4. **Предпазва от масово изтегляне** — unguessable кодове + rate limit + CAPTCHA + email gate за пълен отчет.
5. **Поддържа множество агенции** в общ публичен регистър, където всяка е кредитирана като атрибут.
6. **Публикува агрегати за доверие** — разпределение на класовете A/B/C/D, verified success rate след сондажи, heatmap по райони, поток от последна активност.
7. **Позволява полеви екип да записва измерванията** от терен (PWA с камера и GPS + вносител на PQWT export файл).
8. **Позволява agency dashboard** за преглед на своите оценки, копиране на embed код, изтегляне на PDF.
9. **Осигурява embed widget** (JS) за вграждане в порталите на агенциите.
10. **Готова е за плащания** без реални payments в MVP — Order/Invoice модел с webhook stub.

### 1.3 Non-goals за MVP

Изрично **извън** обхвата на MVP:

- Публичен follow-up form (агрегатите се захранват само от agency/admin-submitted outcomes)
- Реални Stripe плащания (архитектурата е готова, но интеграцията не се пуска)
- Native мобилни apps за iOS/Android (само PWA)
- Мулти-езичен UI (само български; английският идва в Y2 за чужди купувачи)
- Публичен API за трети страни (само embed widget)
- ML/AI калибровка на PQWT интерпретацията (крив-нивото данни се събират, но моделите идват в Y2)
- Аудио логове или видео от терен
- Интеграция с портали за имоти през техните API (само copy-paste embed за MVP)
- SSO/OAuth (magic link auth за всички)
- White-label брандинг за агенциите (общ voda-check.bg бранд)
- Cloudflare слой пред приложението (добавя се в Y2 ако трафикът/атаките го наложат)

---

## 2. Архитектурни решения

### 2.1 Стек

| Компонент | Технология | Разположение | Y1 цена |
|---|---|---|---|
| Frontend + backend | Next.js 15 (App Router, RSC + Server Actions) | Vercel EU | €0 → €20/мес когато Hobby limits се задминат |
| База данни + auth + storage | Supabase (Postgres 16, GoTrue, Storage) | EU-Frankfurt | €25/мес Pro plan |
| PostGIS | Разширение в Supabase Postgres | — | вкл. |
| Karti | MapLibre GL JS + Protomaps EU tiles | статично сервирано | €0 |
| CAPTCHA | Cloudflare Turnstile (widget standalone, не изисква CF пред приложението) | — | €0 |
| Email (magic link + notifications) | Supabase Auth built-in SMTP + Resend backup | — | €0 → €20/мес при обем |
| PDF generation | `@react-pdf/renderer` в Next.js API route | — | вкл. в Vercel |
| Rate limiting | `@upstash/ratelimit` + Upstash Redis | Upstash EU | €0 free tier достатъчен |
| Мониторинг | Sentry (frontend + API errors) | — | €0 free tier |
| Домейн | voda-check.bg (или подобен) | Bulgarian регистратор | ~€15/год |

**Общо Y1:** ~€25–€65/мес — под €100 бюджет.

### 2.2 Multi-tenant модел

**Ключово решение (уточнено с потребителя):** истинският "tenant" е **платформата**, не real estate агенцията.

- **Platform admin** = super-user, вижда и променя всичко (ти)
- **Platform operator** = полеви техник, може да въвежда оценки/снимки за всички агенции
- **Agency user** = представител на real estate агенция, **read-only** за своите properties + assessments, може да въвежда agency-reported drilling outcomes

Един публичен регистър, брандиран `voda-check.bg`. Всяка оценка носи атрибут `agency_id` = кой е поръчал/за чия обява. Публичните views показват името на агенцията като кредит, не като собственик на регистъра.

### 2.3 Пет UI повърхности

| # | Route | Trust profile | Кеширане |
|---|---|---|---|
| 1 | `/` , `/registar`, `/karta`, `/metodologia` | Публично, без PII | CDN 5 min |
| 2 | `/v/[code]` (verify) | Публично read с валиден код + rate limit + Turnstile | Не-кеширано (rate limit решение per-request) |
| 3 | `/app/*` (agency + platform dashboard) | Authenticated, роля-базирано | Не-кеширано |
| 4 | `/app/measure/*` (PWA field capture) | Authenticated operator | Service worker offline shell |
| 5 | `/embed/[code].js` (embed widget) | Публично, но валиден код | CDN 5 min |

### 2.4 Пет домейн папки

`src/domains/`:

- **`agency/`** — агенции, потребители, роли, properties
- **`assessment/`** — оценки, снимки, PQWT данни, генериране на код
- **`verification/`** — публични views, buyer email gates, verification_views логове
- **`registry/`** — агрегати за public register, heatmap данни, activity feed
- **`billing/`** — Order/Invoice модел (stub за MVP)

Всеки домейн има public API (server actions + queries) и вътрешна логика. Cross-domain calls минават през тези interfaces.

### 2.5 Data classification (по колона, не по schema)

Един Postgres `public` schema с RLS полиси по таблица:

| Ниво | Достъп | Полета |
|---|---|---|
| **Public aggregate** | anon | брой оценки, class distribution, success_rate per period/region |
| **Public per-code** | anon + валиден code | class, depth range, expected_flow range, method, measured_at, agency.name; address_label, region_code, gps_point **закръглен на 500m grid** |
| **Email-gated** | anon + fulfilled magic token, TTL 15 min | пълен PDF: точен GPS, raw_profile крива, снимки от терен |
| **Agency read-only** | authenticated agency_user, само за своите | всичко за своите properties + assessments + drilling_outcomes |
| **Platform only** | authenticated platform_admin/operator | всичко |

---

## 3. Домейн модел и схема

### 3.1 Основни таблици

```sql
-- ─── Agencies & users ───────────────────────────────────────
create table agencies (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,          -- URL-friendly, за embed
  name text not null,
  contact_email text not null,
  billing_details jsonb,              -- ЕИК, адрес, ДДС статус
  created_at timestamptz default now(),
  archived_at timestamptz
);

create table platform_users (
  id uuid primary key,                -- = auth.users.id
  role text not null check (role in ('platform_admin','platform_operator')),
  full_name text,
  created_at timestamptz default now()
);

create table agency_users (
  id uuid primary key,                -- = auth.users.id
  agency_id uuid not null references agencies(id),
  role text not null check (role in ('agency_admin','agency_viewer')),
  full_name text,
  created_at timestamptz default now()
);
-- Забележка: platform_users и agency_users са disjoint —
-- един auth user е точно едното. Инвариантът се пази с
-- INSERT/UPDATE trigger, който проверява отсъствие в другата
-- таблица преди write (реализация: db/migrations/002_role_disjoint.sql).

-- ─── Properties (обяви на агенциите) ─────────────────────────
create table properties (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id),
  listing_ref text,                   -- вътрешен ID на агенцията (BP-12345)
  address_label text not null,        -- село, район
  cadastral_number text,              -- optional
  gps_point geography(point,4326) not null,
  gps_area geography(polygon,4326),
  region_code text,                   -- ЕКАТТЕ на населеното място
  created_at timestamptz default now(),
  archived_at timestamptz
);

create index properties_agency_idx on properties(agency_id);
create index properties_region_idx on properties(region_code);
create index properties_gps_gix on properties using gist(gps_point);

-- ─── Assessments (сърцето) ───────────────────────────────────
create table assessments (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id),
  agency_id uuid not null references agencies(id),   -- за public register агрегати
  operator_id uuid not null references platform_users(id),
  code text unique not null,          -- HMAC-truncated base32, 8 символа
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
  measured_gps geography(point,4326),
  raw_profile jsonb,                  -- [{depth:0.5, resistivity:120}, ...]
  pqwt_export_path text,              -- Storage path
  pdf_path text,                      -- Storage path
  issued_at timestamptz,
  created_at timestamptz default now()
);

create index assessments_code_idx on assessments(code);
create index assessments_property_idx on assessments(property_id);
create index assessments_agency_idx on assessments(agency_id);
create index assessments_status_idx on assessments(status)
  where status = 'issued';

-- ─── Снимки от терен (собственост на платформата) ───────────
create table assessment_photos (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references assessments(id) on delete cascade,
  storage_path text not null,
  caption text,
  taken_at timestamptz,
  gps_point geography(point,4326),
  uploaded_by uuid not null references platform_users(id),
  created_at timestamptz default now()
);

create index photos_assessment_idx on assessment_photos(assessment_id);

-- ─── Drilling outcomes (за success rate) ─────────────────────
create table drilling_outcomes (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references assessments(id),
  outcome text not null
    check (outcome in ('drilled_success','drilled_dry','drilled_partial','not_drilled','planned')),
  actual_depth_m numeric(6,2),
  actual_flow_m3h numeric(6,2),
  drilled_at date,
  notes text,
  source text not null default 'admin_verified'
    check (source in ('agency_reported','admin_verified','independent')),
  submitted_by uuid,                  -- FK към agency_users OR platform_users; validated в app layer
  submitted_at timestamptz default now()
);

create index outcomes_assessment_idx on drilling_outcomes(assessment_id);
create unique index outcomes_one_verified_per_assessment
  on drilling_outcomes(assessment_id)
  where source = 'admin_verified';

-- ─── Verification views (analytics + rate limit) ─────────────
create table verification_views (
  id bigserial primary key,
  code text not null,                 -- не FK: запазваме исторически
  ip_hash text not null,              -- HMAC(daily_salt, ip)
  user_agent_class text,
  email_verified boolean default false,
  viewed_at timestamptz default now()
);

create index vv_code_time_idx on verification_views(code, viewed_at desc);
create index vv_ip_time_idx on verification_views(ip_hash, viewed_at desc);

-- ─── Buyer email gates ───────────────────────────────────────
create table buyer_pdf_requests (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  email text not null,
  magic_token_hash text not null,     -- SHA-256 на изпратения token
  expires_at timestamptz not null,    -- default now() + interval '15 min'
  fulfilled_at timestamptz,
  ip_hash text,
  created_at timestamptz default now()
);

create index bpr_email_time_idx on buyer_pdf_requests(email, created_at desc);
create index bpr_token_idx on buyer_pdf_requests(magic_token_hash)
  where fulfilled_at is null;

-- ─── Orders (payment-ready stub) ─────────────────────────────
create table orders (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid references agencies(id),
  buyer_email text,                   -- за директни купувачски поръчки
  product_code text not null
    check (product_code in ('listing_assessment','buyer_check','desk_query')),
  quantity int not null default 1,
  unit_price_eur_cents int not null,
  amount_eur_cents int not null,
  status text not null default 'draft'
    check (status in ('draft','issued','paid','void')),
  payment_provider text,              -- 'stripe','manual', null
  external_ref text,                  -- Stripe intent ID когато дойде
  invoice_path text,
  paid_at timestamptz,
  created_at timestamptz default now()
);

create index orders_agency_idx on orders(agency_id);
create index orders_status_idx on orders(status);
```

### 3.2 RLS полиси (ключовите)

```sql
-- Helper функции
create or replace function auth.jwt_role() returns text
  language sql stable
  as $$ select coalesce(current_setting('request.jwt.claim.role', true), 'anon') $$;

create or replace function auth.is_platform() returns boolean
  language sql stable
  as $$
    select exists (
      select 1 from platform_users where id = auth.uid()
    )
  $$;

create or replace function auth.my_agency() returns uuid
  language sql stable
  as $$
    select agency_id from agency_users where id = auth.uid()
  $$;

-- ─── properties ──────────────────────────────────────────────
alter table properties enable row level security;

create policy properties_platform_all on properties
  for all to authenticated
  using (auth.is_platform())
  with check (auth.is_platform());

create policy properties_agency_read_own on properties
  for select to authenticated
  using (agency_id = auth.my_agency());

-- Aнон не вижда properties директно; достъпът е през assessment code.

-- ─── assessments ─────────────────────────────────────────────
alter table assessments enable row level security;

create policy assessments_platform_all on assessments
  for all to authenticated using (auth.is_platform()) with check (auth.is_platform());

create policy assessments_agency_read_own on assessments
  for select to authenticated
  using (agency_id = auth.my_agency());

-- Публичен достъп: server route задава app.requested_code,
-- след което SELECT намира точно този запис.
create policy assessments_anon_by_code on assessments
  for select to anon
  using (
    status = 'issued'
    and code = current_setting('app.requested_code', true)
  );

-- ─── assessment_photos ──────────────────────────────────────
alter table assessment_photos enable row level security;

create policy photos_platform_all on assessment_photos
  for all to authenticated using (auth.is_platform()) with check (auth.is_platform());

create policy photos_agency_read on assessment_photos
  for select to authenticated
  using (
    exists (
      select 1 from assessments a
      where a.id = assessment_photos.assessment_id
        and a.agency_id = auth.my_agency()
    )
  );

-- Анон: НИКОГА директно. Достъп само през signed URL от server.
create policy photos_no_anon on assessment_photos
  for select to anon using (false);

-- ─── drilling_outcomes ──────────────────────────────────────
alter table drilling_outcomes enable row level security;

create policy outcomes_platform_all on drilling_outcomes
  for all to authenticated using (auth.is_platform()) with check (auth.is_platform());

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

-- Public: агрегатите се сервират през security-definer функции,
-- не през директен SELECT на таблицата.
```

### 3.3 Публични агрегати като security-definer функции

Публичният регистър НЕ прави `SELECT * FROM assessments` от anon. Той извиква функции, чиито return тип е предварително агрегиран:

```sql
create or replace function public.registry_stats(
  p_from date default (now() - interval '12 months')::date,
  p_to date default now()::date,
  p_agency_id uuid default null
) returns table (
  total_issued int,
  class_a_count int,
  class_b_count int,
  class_c_count int,
  class_d_count int,
  outcomes_verified int,
  success_rate_pct numeric
)
language sql
security definer
set search_path = public
as $$
  select
    count(*) filter (where a.status = 'issued')::int as total_issued,
    count(*) filter (where a.class = 'A')::int as class_a_count,
    count(*) filter (where a.class = 'B')::int as class_b_count,
    count(*) filter (where a.class = 'C')::int as class_c_count,
    count(*) filter (where a.class = 'D')::int as class_d_count,
    count(distinct o.assessment_id) filter (
      where o.source = 'admin_verified'
        and o.outcome in ('drilled_success','drilled_partial')
    )::int as outcomes_verified,
    round(
      100.0 * count(distinct o.assessment_id) filter (
        where o.source = 'admin_verified'
          and o.outcome = 'drilled_success'
      )::numeric
      / nullif(count(distinct o.assessment_id) filter (
        where o.source = 'admin_verified'
          and o.outcome in ('drilled_success','drilled_dry','drilled_partial')
      ), 0)
    , 1) as success_rate_pct
  from assessments a
  left join drilling_outcomes o on o.assessment_id = a.id
  where a.issued_at::date between p_from and p_to
    and (p_agency_id is null or a.agency_id = p_agency_id);
$$;

grant execute on function public.registry_stats to anon;
```

Аналогично: `registry_heatmap(bbox, zoom)` → връща агрегирани точки per grid cell; `registry_activity(limit)` → връща последните N измервания без code, само `region, class, date`.

### 3.4 Code generation

```typescript
// src/domains/assessment/code.ts
import { createHmac } from 'crypto';
import { encode as base32 } from 'hi-base32';

const SECRET = process.env.ASSESSMENT_CODE_SECRET!; // 32+ bytes

export function generateAssessmentCode(assessmentId: string): string {
  const hmac = createHmac('sha256', SECRET);
  hmac.update(assessmentId);
  const digest = hmac.digest(); // 32 bytes
  return base32(digest.subarray(0, 5)) // 40 bits → 8 base32 chars
    .replace(/=/g, '')
    .toLowerCase();
}
```

- 40 bits = ~1 трилион възможни кодове; при 10k оценки Y3, вероятността за колизия е ~1 на 10^8 → приемливо
- Кодовете са deterministic — regen дава същия код за същото assessment_id (не e ключ, а derived value)
- Ако някога има колизия, resolver добавя суфикс `-2` при insert conflict
- Секретът се съхранява в Vercel env vars, ротира се само при breach; ротацията НЕ инвалидира съществуващи кодове (те са запазени в `assessments.code`)

---

## 4. Trust mechanics и anti-scraping

### 4.1 Anti-scraping слой (по ред на защитата)

1. **Unguessable кодове** — 40-bit HMAC output; enumeration изисква ~10^11 опити за 1000 валидни кода
2. **Rate limit per IP** — 20 verify заявки/IP/минута; 100/IP/час (Upstash Redis via `@upstash/ratelimit`)
3. **Turnstile CAPTCHA** — след 3 неуспешни (invalid или 404) заявки от една IP → задължителен challenge за следващите 24h от тази IP
4. **User-Agent класификация** — известни bot signatures → веднага CAPTCHA
5. **Email gate за пълен PDF** — координати и снимки не се сервират без magic link потвърждение
6. **Signed URLs с TTL 15 мин** за PDF/photo downloads; линкът стига до един файл, не до цялата колекция
7. **Verification views логване** — всяко посещение оставя запис; nightly job праща alert при подозрителна активност (>50 unique codes/IP/day)
8. **Robots.txt + noindex** за `/v/*` и `/app/*` — не искаме Google да индексира индивидуалните verify страници
9. **HTTP заглавия** — `X-Robots-Tag: noindex`, `Referrer-Policy: no-referrer`, `Content-Disposition` за PDF

### 4.2 Verify flow (публичен купувач)

```
1. Купувач вижда в обявата: "Водна оценка: B — код xk3f9pqr"
   с QR/линк към https://voda-check.bg/v/xk3f9pqr

2. GET /v/xk3f9pqr
   ├─ Middleware: rate limit по IP
   ├─ Ако CAPTCHA задължително → показва Turnstile challenge
   ├─ Query: SELECT * FROM assessments WHERE code = $1 AND status = 'issued'
   │   (RLS: current_setting('app.requested_code') = $1)
   ├─ Ако не намерен → 404 (log verification_view с error)
   ├─ Ако намерен → render public view:
   │   ├─ Клас B, дълбочина 28–36 м, дебит 0.8–1.5 m³/h
   │   ├─ Метод PQWT-GT150, дата 14.03.2026
   │   ├─ Агенция: BULGARIAN PROPERTIES (кредит)
   │   ├─ Приблизителна локация: с. Врабево (500m grid center)
   │   └─ Бутон "Виж пълния PDF отчет" → email gate
   └─ Log verification_view(code, ip_hash, email_verified=false)

3. Купувач клика "Виж пълния PDF"
   ├─ Форма: email + Turnstile
   ├─ POST /api/buyer/request-pdf { code, email, turnstileToken }
   │   ├─ Validate Turnstile
   │   ├─ Generate magic token (32 bytes random)
   │   ├─ INSERT buyer_pdf_requests(code, email, hash(token), expires_at=now()+15min)
   │   ├─ Send email: "Кликни за да видиш отчета: /pdf/download?t=<token>"
   │   └─ Return { sent: true }
   └─ UI: "Пратихме линк на <email>. Кликни за да отвориш отчета."

4. Купувач кликва линка от email-а
   ├─ GET /pdf/download?t=<token>
   │   ├─ Lookup buyer_pdf_requests WHERE magic_token_hash = sha256($t)
   │   ├─ Ако expired или fulfilled → грешка
   │   ├─ Ако валиден:
   │   │   ├─ Update fulfilled_at = now()
   │   │   ├─ Update verification_views set email_verified = true
   │   │   ├─ Generate Supabase signed URL за PDF (TTL 15 min)
   │   │   └─ Redirect към signed URL (браузърът сваля PDF)
   │   └─ Log fulfilled в audit
   └─ PDF се отваря в браузъра / сваля
```

### 4.3 Публичен view (маскирани координати)

Публичното view на `/v/[code]` показва:
- ✅ Клас, дълбочина, дебит, метод, дата
- ✅ Име на агенция (кредит)
- ✅ Село / населено място (адресен label)
- ✅ **Закръглена GPS точка на 500m grid** — само за bearing/район, не за навигация до имота
- ✅ Кратък edited текст от operator-а ("измерено при сух сезон, ...")
- ✅ Бутон за пълен PDF (email gate)

НЕ показва:
- ❌ Точен GPS
- ❌ Кадастрален номер
- ❌ Пълна крива на профила
- ❌ Снимки от терен
- ❌ Оператор име (само "Platform")

### 4.4 Пълен PDF (email-gated)

Съдържание:
- Първа страница: официално резюме (същото като публичния view) + подпис + verification URL
- Втора страница: пълна крива на профила (SVG chart), точен GPS с малка карта
- Трета страница: снимки от терен (2–4 бр.) с captions и координати
- Четвърта страница: методология и ограничения (стандартен текст)
- Долен колонтитул на всяка страница: код, дата на издаване, "Проверка: voda-check.bg/v/<code>"

Watermark на PDF: **не в MVP** (потребителят го отхвърли по-рано).

---

## 5. Публичен регистър

### 5.1 Секции

1. **`/registar`** — таблици и графики: общ брой оценки, разпределение A/B/C/D, verified success rate; per-agency breakdown ако агенцията има >30 verified outcomes
2. **`/karta`** — интерактивна MapLibre карта с heatmap layer, groups на населено място; клик върху район → показва broken-down stats за него
3. **`/registar/aktivnost`** — feed на последните 50 издадени оценки: `дата, село, клас, агенция` (без код)
4. **`/metodologia`** — статични страници: как работи PQWT, как се формират класовете, научна литература, ограничения на метода
5. **`/agencii`** — списък на партньорски агенции с брой оценки и per-agency success rate когато е налично

### 5.2 Успеваемост (success rate)

Формула:
```
success_rate = drilled_success / (drilled_success + drilled_dry + drilled_partial)
```

Показва се само за:
- Периоди с >30 verified outcomes (иначе "недостатъчна извадка")
- Класове с >20 verified outcomes (per-class breakdown)

Източник на outcomes в MVP: **само agency-reported + admin-verified** (без публичен form).

### 5.3 Heatmap

Агрегати per 5km grid cell, изчислени nightly в materialized view:

```sql
create materialized view registry_heatmap_5km as
select
  ST_SnapToGrid(gps_point::geometry, 0.05)::geography as cell_center,
  count(*) as assessments_count,
  avg(case when class = 'A' then 4 when class = 'B' then 3
           when class = 'C' then 2 when class = 'D' then 1 end) as avg_score,
  count(*) filter (where class in ('A','B')) as good_count
from assessments a
join properties p on p.id = a.property_id
where a.status = 'issued'
group by cell_center
having count(*) >= 3;  -- не показваме cell с <3 записа (privacy + confidence)
```

Refresh: `REFRESH MATERIALIZED VIEW CONCURRENTLY` в nightly cron.

---

## 6. Field capture PWA

### 6.1 Route: `/app/measure`

Роля-ограничена: само platform_operator и platform_admin.

### 6.2 Flow

```
1. Оператор отваря /app/measure на телефона
   ├─ Service worker гарантира shell offline
   └─ IndexedDB държи draft measurements докато online

2. "Ново измерване" → форма:
   ├─ Избор на агенция + property (search-as-you-type)
   │   ИЛИ "Нов имот" → форма за property
   ├─ GPS: автоматично взето от navigator.geolocation.watchPosition
   ├─ Дата на измерване
   ├─ Клас (A/B/C/D)
   ├─ Дълбочинен диапазон, дебит range
   ├─ Свободен текст (confidence_note)
   ├─ Upload снимки от терен:
   │   ├─ <input type="file" accept="image/*" capture="environment">
   │   ├─ Клиентски resize + WebP conversion
   │   └─ Upload към Supabase Storage /agencies/{id}/assessments/{id}/photos/
   └─ Upload PQWT export file (native формат от уреда):
       ├─ Server-side parser извлича profile крива
       └─ Съхранява raw в raw_profile jsonb + оригинала в Storage

3. Save като draft → assessment.status = 'draft'
   └─ Оператор може да продължи от desktop за финализиране

4. Финализиране (обикновено от desktop):
   ├─ Преглед на всички полета
   ├─ Генериране на PDF preview
   ├─ Бутон "Издай" → status = 'issued', issued_at = now()
   │   └─ Trigger: генерира code, prewarms PDF в Storage
   └─ Показва code + embed snippet за копиране
```

### 6.3 Offline sync

- IndexedDB (via `idb` библиотека) държи queue от pending измервания
- При online → background sync изпраща queue към API
- Снимките изпращат резюмирано (thumbnails first, full resolution async)

### 6.4 PQWT parser

- Форматът на native export от PQWT-GT150 е разкрит в документацията им (изследва се в Sprint 1)
- Parser е модул `src/domains/assessment/pqwt-parser.ts` с ясно input/output contract
- Ако форматът не е разкрит → fallback до manual copy-paste на values

---

## 7. PDF генериране

### 7.1 Технология

`@react-pdf/renderer` в Next.js API route `/api/pdf/[code]`:

- Server-side render на React компоненти → PDF buffer
- Кеш: генериран PDF се качва в Supabase Storage при `issued`, retrieve оттам за последващи downloads
- Cold start ~500ms; топъл ~50ms
- Fonts: Sora (лат) + Roboto (кир) embed-нати в bundle

### 7.2 Кога се генерира

- **При issue** — trigger в API route генерира и качва PDF в Storage; assessment.pdf_path се задава
- **При revision** (rare) — старият PDF се архивира с суфикс `-v1`, генерира се нов
- **On-demand fallback** — ако pdf_path е null (грешка при generation), routen регенерира при първи request

### 7.3 Watermark

**Не в MVP.** Ако бъде добавен по-късно: watermark с requester email/hash + timestamp в долния колонтитул.

---

## 8. Embed widget

### 8.1 Технология

`/embed/[code].js` — Next.js route който връща JavaScript file:

```javascript
// Псевдо-код на генерирания скрипт
(function() {
  var code = "xk3f9pqr";
  var script = document.currentScript;
  var wrapper = document.createElement('a');
  wrapper.href = 'https://voda-check.bg/v/' + code;
  wrapper.target = '_blank';
  wrapper.style.cssText = 'display:inline-flex;...';
  wrapper.innerHTML = `
    <svg width="20" height="20">...</svg>
    <span>Водна оценка: <strong>${data.class}</strong></span>
    <span>${data.depthMin}–${data.depthMax} м</span>
    <span style="opacity:.6">Провери</span>
  `;
  script.parentNode.insertBefore(wrapper, script);
})();
```

### 8.2 Използване от агенцията

Agency копира един ред в описанието на обявата:
```html
<script src="https://voda-check.bg/embed/xk3f9pqr.js" async></script>
```

Ако агенцията не може да добавя `<script>` (стар CMS), fallback е HTML snippet:
```html
<a href="https://voda-check.bg/v/xk3f9pqr">
  Водна оценка: <strong>B</strong> · 28–36 м · Провери
</a>
```

### 8.3 Кеширане

Widget скриптът се кешира на CDN за 5 минути + `stale-while-revalidate=3600`.

---

## 9. Payment-ready дизайн (без реални плащания)

### 9.1 Order lifecycle (готов, но неактивен)

```
draft → issued → paid → (invoice generated)
                     ↓
                  void (при cancel/refund)
```

- В MVP: всички orders са ръчно `status = 'paid'` от admin след получаване на банков превод/фактура offline
- `payment_provider = 'manual'` в MVP
- `orders.external_ref` остава null

### 9.2 Готовност за Stripe

Абстрактен interface `src/domains/billing/payment-provider.ts`:
```typescript
interface PaymentProvider {
  createIntent(order: Order): Promise<{ clientSecret: string; externalRef: string }>;
  handleWebhook(payload: unknown, signature: string): Promise<OrderStatusUpdate>;
}
```

Manual implementation в MVP; Stripe implementation се добавя без миграция на схемата.

### 9.3 Invoice PDF

Генерира се със същия `@react-pdf/renderer` — отделен template `InvoicePDF.tsx`. Съхранява се в Storage /invoices/. За MVP: manual trigger от admin.

---

## 10. Deployment, environments и backup

### 10.1 Environments

- **development** — локално, `pnpm dev`, локален Supabase (Docker)
- **staging** — Vercel Preview на всеки PR, Supabase project staging
- **production** — Vercel Production на `main` бранч, Supabase project production

### 10.2 CI/CD

GitHub Actions (или Vercel-native):
1. On push → lint + typecheck + unit tests
2. On PR → Vercel preview deploy + Supabase migration dry-run
3. On merge to `main` → Vercel production deploy + Supabase migration apply

Migration tool: **`supabase migration`** CLI + `db push` в CI.

### 10.3 Backup

- Supabase Pro plan включва daily backups с 7-day retention
- Weekly дъмп на critical таблици (assessments, drilling_outcomes) в отделен S3 bucket (Cloudflare R2) като disaster recovery
- Storage файлове (PDFs, photos) са в Supabase Storage — при disaster recovery: копие в R2 nightly

### 10.4 Secrets

- Vercel env vars: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`, `ASSESSMENT_CODE_SECRET`, `TURNSTILE_SECRET`, `UPSTASH_REDIS_URL`, `RESEND_API_KEY`
- `ASSESSMENT_CODE_SECRET` **никога** не се сменя освен при потвърдена компрометация

---

## 11. Тестова стратегия

### 11.1 Пирамида

- **Unit tests** (Vitest): domain logic — code generation, PQWT parser, RLS helper functions, class calculation
- **Integration tests** (Vitest + Testcontainers Postgres): RLS полиси (най-важно), security-definer функции, aggregate queries
- **E2E tests** (Playwright): 5 критични flow-а:
  1. Оператор въвежда ново измерване
  2. Agency admin вижда своите оценки
  3. Публична verify (валиден код)
  4. Публична verify (невалиден код + rate limit)
  5. Buyer email gate → PDF download

### 11.2 RLS test корпус

**Задължителен** — това е защитният слой на бизнеса. Test suite който:
- Създава fixtures: 2 агенции, 2 platform users, 2 agency users на всяка агенция
- За всяка таблица + всяка политика проверява:
  - Позволените access-и работят
  - Забранените access-и връщат нула редове (не грешка)
  - Cross-agency четене е блокирано
  - Anon без code не вижда нищо
  - Anon с валиден code вижда единичния запис

### 11.3 Security review

Преди production launch:
- OWASP Top 10 checklist
- Supabase security best practices audit
- Rate limit stress test (100k заявки/мин симулация)
- Manual pen-test на verify flow

---

## 12. Отворени въпроси за имплементация

Тези решения се вземат по време на имплементацията, не блокират спец:

1. **Turnstile threshold** — след колко неуспешни verify заявки да се задейства CAPTCHA? Default: 3, adjustable env var.
2. **500m grid размер** — може да излезе, че 200m е по-подходящ (по-точно) или 1km (по-privacy). Ще се провери с първите 20 оценки.
3. **PQWT export формат** — трябва да се разкрие в Sprint 1. Ако не е тривиален → fallback до manual entry.
4. **Email SMTP** — Supabase built-in или Resend? Ще се избере на база deliverability тестове.
5. **Timezone на dashboard** — Europe/Sofia hardcoded или user preference? Default: Europe/Sofia hardcoded в MVP.
6. **Retention на verification_views** — 90 дни (GDPR минимализация) или 12 месеца (analytics)? Default: 90 дни; ip_hash изтича след 30.
7. **Име и домейн на платформата** — voda-check.bg е placeholder; финално име се избира преди launch.
8. **Agency onboarding flow** — self-service signup или admin invite? Default в MVP: admin invite (тъй като target са 4 агенции Y1).

---

## 13. Критерии за успех (MVP definition of done)

MVP се счита за завършен когато:

- [ ] Оператор може да въведе ново измерване с PWA на телефон (offline shell работи)
- [ ] Agency admin може да вижда своите оценки и да копира embed snippet
- [ ] Публичен `/v/[code]` показва оценка с маскирани координати
- [ ] Rate limit + Turnstile blocking mass enumeration (тест: 100 невалидни кода → CAPTCHA required)
- [ ] Email gate работи end-to-end: request → email → click → PDF download
- [ ] PDF съдържа всички секции (резюме, крива, снимки, методология)
- [ ] Публичен `/registar` показва агрегати A/B/C/D + success rate
- [ ] `/karta` показва heatmap с реални данни
- [ ] Embed snippet работи на минимум 2 външни портала (test с BulgarianProperties + Imot.bg)
- [ ] RLS test suite минава 100%
- [ ] 5 E2E flow-а минават на Playwright
- [ ] Backup + restore процедура тествана
- [ ] 4 партньорски агенции onboard-нати с реални обяви
- [ ] Първи 30 оценки в системата (калибрационен тест от `model-izmervane-doverie-skalirane.md`)

---

## 14. Roadmap след MVP (референция, не обхват)

- Y1 Q4: Публичен follow-up form с модерация
- Y1 Q4: Stripe плащания за купувачски проверки
- Y2 Q1: Кабинетна справка (€59 продукт) — автоматизирано от база данни
- Y2 Q2: Английски UI за чужди купувачи
- Y2 Q2: White-label subdomain-и за агенции които го искат
- Y2 Q3: Cloudflare слой при трафик > 100k req/day
- Y2 Q4: ML калибровка на PQWT интерпретация върху натрупаните данни

---

## Приложение A: Референции към бизнес контекста

- `kanal-agencii-vodna-ocenka.md` — GTM канал 3, agency-first продажби, конфликт на интереси
- `model-izmervane-doverie-skalirane.md` — измерването като продукт, калибрационен тест
- `komersialni-usloviya.md` — цени, договорни условия
- `pazaren-analiz-hidrogeologia-sondazhi.md` — пазарен анализ
- `tendencii-prouchvaniya-za-voda-2026-2029.md` — тенденции
