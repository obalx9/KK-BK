# Database Migrations

Миграции для базы данных PostgreSQL на ТаймВеб.

## Применение миграций

### Вариант 1: Через psql (рекомендуется)

```bash
psql $DATABASE_URL -f migrations/002_add_telegram_linked_chats.sql
```

### Вариант 2: Через pgAdmin

1. Откройте pgAdmin
2. Подключитесь к вашей базе данных
3. Откройте Query Tool
4. Скопируйте содержимое файла миграции
5. Выполните запрос

### Вариант 3: Полная пересборка схемы

Если нужно применить всю схему с нуля или обновить:

```bash
psql $DATABASE_URL -f schema.sql
```

## Список миграций

- `001_add_webhook_tracking.sql` - Добавляет отслеживание webhook запросов
- `002_add_telegram_linked_chats.sql` - Добавляет таблицу для связывания Telegram чатов с ботами
- `003_complete_timeweb_schema.sql` - Завершение schema для Timeweb (100% совместимость с кодом)
- `004_fix_featured_courses_table.sql` - Исправление структуры таблицы featured_courses
- `005_sync_schema_with_backend_usage.sql` - Синхронизация schema с использованием в бэкенде (добавляет недостающие поля и индексы)

## Порядок применения миграций

Если нужно начать с нуля:

```bash
# 1. Применить основную схему
psql $DATABASE_URL -f schema.sql

# 2. Применить миграции по порядку (если schema.sql не выполнил)
psql $DATABASE_URL -f migrations/001_add_webhook_tracking.sql
psql $DATABASE_URL -f migrations/002_add_telegram_linked_chats.sql
psql $DATABASE_URL -f migrations/003_complete_timeweb_schema.sql
psql $DATABASE_URL -f migrations/004_fix_featured_courses_table.sql
psql $DATABASE_URL -f migrations/005_sync_schema_with_backend_usage.sql
```

## Что делает каждая миграция

### 001_add_webhook_tracking.sql
Добавляет таблицу для отслеживания webhook запросов (legacy, может быть не нужна).

### 002_add_telegram_linked_chats.sql
Добавляет таблицу `telegram_linked_chats` для связывания Telegram чатов с курсами.

### 003_complete_timeweb_schema.sql
Добавляет недостающие таблицы и колонки для полной совместимости с бэкенд кодом.
Примерно 12KB SQL, добавляет ~6 таблиц и ~13 индексов.

### 004_fix_featured_courses_table.sql
Пересоздает таблицу `featured_courses` с правильной структурой для фронтенда.
Сохраняет старые данные в backup.

### 005_sync_schema_with_backend_usage.sql
**КРИТИЧЕСКАЯ МИГРАЦИЯ**: Добавляет недостающие поля и индексы которые используются бэкендом:
- Добавляет `webhook_status`, `webhook_registered_at`, `webhook_error` в `telegram_bots`
- Добавляет индексы для оптимизации часто используемых полей
- Без этой миграции webhook регистрация в бэкенде будет падать

## Важно

Все миграции используют `IF NOT EXISTS` и `IF EXISTS`, поэтому их можно применять повторно без риска потери данных.
