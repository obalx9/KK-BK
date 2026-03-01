# Миграция 004: Исправление таблицы featured_courses на Timeweb

## Проблема

На Timeweb таблица `featured_courses` была создана с неправильной структурой:
- Имела ссылку на `courses(id)`
- Не содержала полей для отображения данных на фронтенде (title, description, etc.)

Фронтенд ожидает таблицу с полями:
- `title` - заголовок курса
- `description` - описание
- `category` - категория
- `instructor` - инструктор
- `image_url` - URL изображения
- `order_index` - порядок отображения

## Решение

Миграция 004 пересоздаёт таблицу с правильной структурой, совместимой с фронтенд кодом.

## Применение миграции

### Способ 1: Через psql (рекомендуется)

```bash
psql $DATABASE_URL -f /deploy/backend/database/migrations/004_fix_featured_courses_table.sql
```

### Способ 2: Через pgAdmin Timeweb

1. Откройте pgAdmin в Timeweb
2. Подключитесь к своей базе данных
3. Откройте Query Tool
4. Откройте файл `/deploy/backend/database/migrations/004_fix_featured_courses_table.sql`
5. Скопируйте содержимое в Query Tool
6. Выполните запрос (F5 или нажмите Execute)

### Способ 3: Через консоль Timeweb

```bash
# Подключиться к PostgreSQL напрямую
psql "postgresql://user:password@host:port/database" -f migrations/004_fix_featured_courses_table.sql
```

## Что произойдёт

1. Старые данные из `featured_courses` сохранятся в `featured_courses_backup`
2. Таблица `featured_courses` будет пересоздана с новой структурой
3. Будут добавлены два индекса для оптимизации поиска

## Безопасность

- **Безопасно для повторного применения** - содержит `IF NOT EXISTS`
- **Сохраняет данные** - создает backup перед изменениями
- **Нет потери данных** - используется временная таблица для сохранения

## Проверка

После применения миграции проверьте структуру таблицы:

```sql
\d featured_courses
```

Должны быть эти колонки:
```
id            | uuid
title         | text
description   | text
category      | text
instructor    | text
image_url     | text
order_index   | integer
is_active     | boolean
created_at    | timestamptz
updated_at    | timestamptz
```

## Откат (если что-то пошло не так)

Если миграция вызвала проблемы, можно восстановить данные:

```sql
DROP TABLE IF EXISTS featured_courses;
ALTER TABLE featured_courses_backup RENAME TO featured_courses;
```

## После миграции

1. API эндпойнт `/api/db/public/featured_courses` начнёт работать корректно
2. Фронтенд сможет загружать рекомендуемые курсы
3. Таблица будет совместима с кодом в `/deploy/backend/src/routes/database.ts`
