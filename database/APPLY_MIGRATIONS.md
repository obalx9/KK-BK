# Инструкция по применению всех миграций на Timeweb

**ВАЖНО:** Применяйте миграции в указанном порядке!

---

## Вариант 1: Полная пересборка (рекомендуется для нового Timeweb)

Если вы начинаете с чистой базы данных:

```bash
# 1. Применить полную схему
psql $DATABASE_URL -f deploy/backend/database/schema.sql

# (Все таблицы уже созданы в schema.sql, дополнительные миграции не нужны)
```

---

## Вариант 2: Обновление существующей БД (рекомендуется для production)

Если у вас уже есть данные в БД, применяйте миграции по порядку:

```bash
# Перейти в директорию с миграциями
cd deploy/backend/database/migrations

# Применить миграции по порядку
psql $DATABASE_URL -f 001_add_webhook_tracking.sql
psql $DATABASE_URL -f 002_add_telegram_linked_chats.sql
psql $DATABASE_URL -f 003_complete_timeweb_schema.sql

# КРИТИЧЕСКИЕ миграции (ОБЯЗАТЕЛЬНО!)
psql $DATABASE_URL -f 004_fix_featured_courses_table.sql
psql $DATABASE_URL -f 005_sync_schema_with_backend_usage.sql
```

---

## Вариант 3: Только критические миграции (если у вас уже есть все таблицы)

Если у вас уже полная БД и нужны только последние исправления:

```bash
# Только если у вас есть старая версия featured_courses
psql $DATABASE_URL -f deploy/backend/database/migrations/004_fix_featured_courses_table.sql

# Это ОБЯЗАТЕЛЬНО для webhook функциональности
psql $DATABASE_URL -f deploy/backend/database/migrations/005_sync_schema_with_backend_usage.sql
```

---

## Проверка каждого шага

### После применения каждой миграции проверьте:

```bash
# Проверить что миграция применилась без ошибок
# (Вывод должен быть пустым или содержать "CREATE TABLE IF NOT EXISTS")

# Проверить структуру таблицы
psql $DATABASE_URL -c "\d featured_courses"

# Проверить webhook поля
psql $DATABASE_URL -c "\d telegram_bots" | grep -i webhook

# Проверить индексы
psql $DATABASE_URL -c "SELECT indexname FROM pg_indexes WHERE tablename = 'telegram_bots' ORDER BY indexname"
```

---

## Краткая справка: Что делает каждая миграция

| # | Файл | Что добавляет | Критичность |
|---|------|---------------|-------------|
| 1 | 001_add_webhook_tracking.sql | Таблица webhook tracking | Низкая |
| 2 | 002_add_telegram_linked_chats.sql | Таблица telegram_linked_chats | Средняя |
| 3 | 003_complete_timeweb_schema.sql | Полная schema Timeweb | Высокая |
| 4 | 004_fix_featured_courses_table.sql | Исправляет featured_courses | КРИТИЧНА |
| 5 | 005_sync_schema_with_backend_usage.sql | webhook поля + индексы | КРИТИЧНА |

---

## Если что-то пошло не так

### Откатить миграцию 005

```bash
# Удалить добавленные индексы (опционально, они не вредят)
psql $DATABASE_URL -c "DROP INDEX IF EXISTS idx_telegram_bots_bot_token;"

# Удалить добавленные колонки (опционально)
psql $DATABASE_URL -c "ALTER TABLE telegram_bots DROP COLUMN IF EXISTS webhook_status, DROP COLUMN IF EXISTS webhook_registered_at, DROP COLUMN IF EXISTS webhook_error;"
```

### Откатить миграцию 004

```bash
# Восстановить из backup (если создался backup)
psql $DATABASE_URL -c "DROP TABLE IF EXISTS featured_courses; ALTER TABLE featured_courses_backup RENAME TO featured_courses;"
```

---

## Требования

- PostgreSQL 14+ (на Timeweb это 16, что отлично)
- psql клиент установлен
- Переменная окружения `$DATABASE_URL` установлена

---

## Безопасность

✅ Все миграции:
- Используют `IF NOT EXISTS` и `IF EXISTS` для безопасности
- Не содержат `DROP TABLE` (кроме featured_courses backup)
- Не удаляют данные
- Полностью идемпотентны

✅ Данные:
- Защищены foreign keys
- Сохраняются в backup перед переструктурированием
- Могут быть восстановлены в случае ошибки

---

## После применения миграций

1. ✅ Перезагрузить бэкенд приложение
2. ✅ Пересобрать фронтенд если нужно
3. ✅ Проверить API endpoints в браузере
4. ✅ Проверить логи на ошибки

```bash
# Проверить что API отвечает
curl "https://api.keykurs.ru/api/db/public/featured_courses"

# Должен вернуть JSON (может быть пустой массив)
# Если возвращает 404 или 500 - есть проблема
```
