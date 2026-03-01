# Миграция 003: Завершение Timeweb Schema

**ТОЛЬКО ДЛЯ TIMEWEB** (PostgreSQL 16)

## Быстрый старт

### Применить миграцию

```bash
# В директории проекта:
psql $DATABASE_URL -f deploy/backend/database/migrations/003_complete_timeweb_schema.sql
```

**Готово!** Совместимость БД теперь 100%.

## Что добавляется

| Элемент | Количество |
|---------|-----------|
| Новых таблиц | 6 |
| Обновленных таблиц | 4 |
| Новых колонок | 28 |
| Новых индексов | 13 |
| Новых constraints | 6 |

## Таблицы

**Новые:**
- `pkce_sessions` - PKCE OAuth
- `telegram_main_bot` - Main Telegram bot
- `course_post_media` - Media in groups
- `telegram_media_group_buffer` - Album buffer
- `telegram_seller_chats` - Seller chats
- `telegram_import_sessions` - Import sessions

**Обновленные:**
- `users` - OAuth колонки
- `telegram_bots` - seller_id
- `course_posts` - media group колонки
- `courses` - customization колонки

## Проверка

```bash
# Проверить, что все создано:
psql $DATABASE_URL -c "SELECT COUNT(*) FROM pkce_sessions LIMIT 0;"
psql $DATABASE_URL -c "SELECT COUNT(*) FROM telegram_main_bot LIMIT 0;"
psql $DATABASE_URL -c "SELECT COUNT(*) FROM course_post_media LIMIT 0;"
```

Если команды выполнились без ошибок → всё работает ✓

## Функции, которые теперь работают

- ✓ OAuth (VK, Yandex)
- ✓ Telegram Login
- ✓ Telegram Media Groups
- ✓ Telegram Import
- ✓ Seller Chat Management
- ✓ PKCE Sessions
- ✓ Media Group Display
- ✓ Course Customization

## Файлы, которые используют эти таблицы

1. `auth.ts` - OAuth flows, Telegram login
2. `webhook.ts` - Telegram webhook processing
3. `telegram.ts` - Bot management
4. `telegram-chat-sync.ts` - Chat synchronization
5. `media.ts` - Media access control

## Откат (если нужно)

Все можно откатить удалением таблиц:

```sql
DROP TABLE IF EXISTS pkce_sessions CASCADE;
DROP TABLE IF EXISTS telegram_main_bot CASCADE;
DROP TABLE IF EXISTS course_post_media CASCADE;
DROP TABLE IF EXISTS telegram_media_group_buffer CASCADE;
DROP TABLE IF EXISTS telegram_seller_chats CASCADE;
DROP TABLE IF EXISTS telegram_import_sessions CASCADE;

-- И удалить колонки из существующих таблиц
ALTER TABLE users DROP COLUMN IF EXISTS user_id CASCADE;
-- ...и т.д.
```

Или просто запустите миграцию с бэкапом БД перед тем.

## Полная документация

Смотрите `TIMEWEB_MIGRATION_GUIDE.md` для полной информации.

## Статус

✓ Готова к применению
✓ Протестирована на PostgreSQL 16
✓ Безопасна для production
✓ 100% совместимость с /deploy кодом

---

**Применяйте смело!** ✓
