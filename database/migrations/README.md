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

## Важно

Все миграции используют `IF NOT EXISTS` и `IF EXISTS`, поэтому их можно применять повторно без риска потери данных.
