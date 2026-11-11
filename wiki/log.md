# Журнал проекта

## [2026-11-11] session-log | Локальный стек и фиксация требований KPI

- Создана проектная Wiki после проверки: Wiki в репозитории не было, доступный Atlassian-сайт не предоставил Confluence; релевантная страница Notion не найдена.
- Зафиксированы требования к цвету каждой серии, сбросу и ожидаемому порядку; правила перемещения виджетов, сохранения координат и отмены.
- Записан локальный запуск React/FastAPI/PostgreSQL в Compose с постоянным volume `kpi-dashboards-local-data`. Пароли намеренно не включены.
- Источники: текущая переписка, `AGENTS.md`, README, compose-файл, спецификация и план реализации.
- Из ранее выполненной проверки: Compose-конфигурация прошла `docker-compose --env-file .env config --quiet`, `git diff --check` прошёл, API health check ответил успешно, UI открывался с локальной dev-учётной записью.
- Автоматические тестовые наборы не запускались. Требуется ручная приёмка цветов и полного drag-поведения; список находится в `backlog.md`.

## [2026-11-11] session-log | Уменьшение толщины линий и handoff

- По просьбе пользователя в `Front-end/app/src/styles/kpi.css` вдвое уменьшена толщина линий графиков и предпросмотра. Новые значения: основная линия 1.5 px, тренд 1.15 px, скользящее среднее 1.4 px, предпросмотр 1.2 px. Размер маркеров не менялся.
- Пересобран frontend командой `docker-compose up --build -d frontend`; API и PostgreSQL остались на прежнем постоянном volume. `docker-compose ps` показал API и БД `healthy`, frontend `Up`; открытая страница загрузила два виджета.
- `git diff --check` прошёл. Проверка shell `curl` до localhost из изолированной среды не прошла; автоматические тесты не запускались.
- Обновлены `progress.md`, `decisions.md`, `backlog.md`, `local-development.md` и индекс. Следующий шаг: пользователь визуально оценивает тонкие линии; затем пройти оставшиеся ручные проверки из backlog.

## [2026-11-11] session-log | Подсказки комментариев, копия виджета и moving average

- В активном checkout подтверждено отображение сохранённого комментария в tooltip точки.
- Добавлены `Cmd/Ctrl+C` и `Cmd/Ctrl+V` для выбранного виджета; копия сохраняет настройки и ставится в свободную ячейку.
- Подпись moving average вынесена из потока легенды в абсолютную строку осей, чтобы не уменьшать flex-область графика.
- Проверки: frontend `npm run typecheck` и `npm run build`, Python `py_compile` для схемы/API и `git diff --check` прошли. Автоматические тесты не запускались.
- Docker Compose пересобрал frontend и API из активного checkout. PostgreSQL контейнер и именованный volume остались на месте; после пересборки локальная сессия браузера завершилась.
- GitHub `voyfur/kpi_dashboard` проверен: репозиторий пустой, веток и коммитов пока нет. Пользователь поручил опубликовать изменения после завершения работы.

## [2026-11-11] session-log | Публикация изменений и сведение веток

- В `main` опубликованы подсказки комментариев точек, копирование/вставка виджетов и размещение подписи moving average вне потока легенды; исходный tooltip комментария уже присутствовал в активной реализации.
- Push в `https://github.com/voyfur/kpi_dashboard`: коммит `c209285`. Проверка GitHub подтвердила SHA и единственную удалённую ветку `main`; локальные feature-ветки удалены после проверки ancestry.
- Старая и временная рабочие копии оставлены detached, чтобы сохранить их содержимое. Старая копия сравнивалась с опубликованной: большинство файлов совпадает; различия находятся в более ранних вариантах семи source/docs файлов и остаются сохранёнными локально.
- Проверки: `npm run typecheck`, `npm run build`, Python `py_compile` для изменённых API-файлов и `git diff --check` прошли. Автоматические тестовые наборы не запускались.
- Ручной UI-check не завершён: после пересборки API браузер разлогинился; среда браузера также не передала буфер для проверки Cmd/Ctrl+C/V. В `backlog.md` оставлены проверки после повторного входа.

## [2026-11-11] session | Implement and publish KPI chart comments, widget copy/paste, and moving-average label layout; consolidate branches

- Raw: `raw/sessions/2026-11-11-implement-and-publish-kpi-chart-comments-widget-.md`
- Tags: `activity:implementation`, `task:kpi-widget-copy-paste`, `file:Front-end/app/src/pages/KpiPage.tsx`, `file:Front-end/app/src/styles/kpi.css`, `file:wiki/progress.md`
- Status: `completed`
