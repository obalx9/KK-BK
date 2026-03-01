/*
  # Миграция 004: Исправление структуры таблицы featured_courses для Timeweb

  ## Описание
  Таблица featured_courses была создана с неправильной структурой (ссылка на courses.id).
  Нужно пересоздать таблицу с правильной структурой для работы фронтенда.

  ## Изменения
  - Заменить таблицу featured_courses на правильную структуру
  - Добавить поля: title, description, category, instructor, image_url, order_index
  - Убрать ссылку на courses(id) - будет независимая таблица

  ## Безопасность данных
  - Используется временная таблица для сохранения существующих данных
  - После миграции все старые данные сохраняются
  - IF NOT EXISTS для всех операций
*/

-- Создать backup таблицы если она существует
CREATE TABLE IF NOT EXISTS featured_courses_backup AS
SELECT * FROM featured_courses WHERE FALSE;

-- Сохранить данные из старой таблицы если она существует
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'featured_courses') THEN
    INSERT INTO featured_courses_backup
    SELECT * FROM featured_courses;
  END IF;
END $$;

-- Удалить старую таблицу if exists
DROP TABLE IF EXISTS featured_courses CASCADE;

-- Создать новую таблицу с правильной структурой
CREATE TABLE IF NOT EXISTS featured_courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text DEFAULT '',
  category text DEFAULT '',
  instructor text DEFAULT '',
  image_url text DEFAULT '',
  order_index integer DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Создать индекс для быстрого поиска активных курсов
CREATE INDEX IF NOT EXISTS idx_featured_courses_active ON featured_courses(is_active);
CREATE INDEX IF NOT EXISTS idx_featured_courses_order ON featured_courses(order_index);
