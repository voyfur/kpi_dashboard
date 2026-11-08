# LNG Holding KPI Dashboards

Самостоятельное приложение для KPI-дашбордов со своим React UI, FastAPI API и отдельной PostgreSQL базой.

## Границы приложения

- Вход проверяется через API авторизации существующего Dashboard. Этот сервис не подключается к auth базе и не хранит пароли.
- API приложения выдаёт собственную HttpOnly cookie kpi_session и проверяет корпоративную сессию через Dashboard на защищённых запросах.
- KPI-данные хранятся в отдельной базе kpi_dashboard; frontend и backend запускаются отдельно от Dashboard.
- Администраторы меняют департаменты, дашборды и конфигурацию графиков. Все авторизованные сотрудники видят данные и записывают значения с комментариями.
- Миграции запускаются отдельной ролью kpi_migrator; API использует ограниченную роль kpi_app.
- Этот репозиторий не развёрнут в production.

## Требования

- Python 3.12–3.14 и uv
- Node.js 22+ и npm
- PostgreSQL 15+
- Доступный корпоративный Dashboard auth API

## Локальный запуск

### 1. Создать отдельную базу и роли

Создайте базу и роли в своём локальном PostgreSQL. Используйте отдельные пароли и храните их только в локальной конфигурации:

~~~sql
CREATE ROLE kpi_migrator LOGIN PASSWORD 'replace-this-migration-password';
CREATE ROLE kpi_app LOGIN PASSWORD 'replace-this-runtime-password';
CREATE DATABASE kpi_dashboard OWNER kpi_migrator;
~~~

Подключившись к базе kpi_dashboard, выдайте миграционной роли право создавать таблицы:

~~~sql
GRANT CREATE ON SCHEMA public TO kpi_migrator;
~~~

Запустите миграцию и настройте доступ runtime-роли. Вторую команду выполните от имени администратора PostgreSQL, подключённого именно к базе kpi_dashboard:

~~~sh
cd Back-end
KPI_DATABASE_URL='postgresql+psycopg://kpi_migrator:replace-this-migration-password@127.0.0.1:5432/kpi_dashboard' uv run alembic upgrade head
psql 'postgresql://postgres@127.0.0.1:5432/kpi_dashboard' -v ON_ERROR_STOP=1 -f sql/kpi_app_grants.sql
~~~

Скрипт прав выдаёт kpi_app только доступ к KPI-таблицам и запрещает общие права на будущие таблицы в схеме public.

### 2. Настроить и запустить API

Скопируйте Back-end/.env.example в Back-end/.env, задайте локальные значения и загрузите их в окружение. Пароли и рабочие секреты не добавляйте в Git.

~~~sh
cd Back-end
cp .env.example .env
set -a
source .env
set +a
uv sync --extra dev
uv run uvicorn kpi_dashboard.app:app --reload --host 127.0.0.1 --port 8000
~~~

DASHBOARD_AUTH_API_URL — базовый адрес upstream API, без суффикса /api/v1/auth. DASHBOARD_PUBLIC_URL — публичный origin корпоративного Dashboard, который upstream проверяет в заголовке Origin. KPI_PUBLIC_URL должен совпадать с origin frontend, чтобы same-origin проверка работала.

Health check: http://127.0.0.1:8000/healthz.

### 3. Запустить UI

В отдельном терминале скопируйте Front-end/app/.env.example в Front-end/app/.env.local и при необходимости поменяйте адрес API:

~~~sh
cd Front-end/app
cp .env.example .env.local
npm ci
npm run dev
~~~

Откройте http://127.0.0.1:5173. Vite проксирует /api/v1 на KPI_API_TARGET из локального env-файла.

## Проверки

Из каталога Back-end:

~~~sh
uv run pytest -q
~~~

Из каталога Front-end/app:

~~~sh
npm run test:domain
npm run typecheck
npm run build
~~~

Для ручной browser-проверки нужны локальные API и UI, отдельная disposable KPI база и тестовая auth-сессия. Не направляйте эти команды на production.

## Структура

- Back-end/src/kpi_dashboard/ — FastAPI, auth bridge, KPI API и модели
- Back-end/migrations/ — отдельная цепочка Alembic миграций
- Back-end/sql/kpi_app_grants.sql — минимальные права runtime-роли
- Front-end/app/src/ — самостоятельный React/TypeScript интерфейс
