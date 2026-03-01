/*
  # Миграция 005: Синхронизация Schema с использованием в бэкенде

  ## Описание
  Анализ бэкенда показал что несколько таблиц имеют недостающие поля,
  которые используются в коде но не определены в schema.sql

  ## Что добавляется

  ### 1. telegram_bots - добавить webhook tracking поля (3 поля)
    - webhook_status (text) - статус регистрации webhook
    - webhook_registered_at (timestamptz) - когда был зарегистрирован
    - webhook_error (text) - текст ошибки если есть

  ### 2. Добавить индексы для оптимизации часто используемых полей
    - telegram_bots: bot_token, is_active
    - course_posts: course_id (уже есть)
    - telegram_import_sessions: user_id, course_id

  ## Безопасность данных
  - Все операции используют IF NOT EXISTS
  - Нет DELETE / DROP операций
  - Безопасно для повторного применения
  - Нет потери данных
*/

-- ============================================================
-- PHASE 1: telegram_bots - добавить webhook tracking
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'telegram_bots' AND column_name = 'webhook_status'
  ) THEN
    ALTER TABLE telegram_bots
    ADD COLUMN webhook_status text DEFAULT 'unregistered',
    ADD COLUMN webhook_registered_at timestamptz,
    ADD COLUMN webhook_error text;
  END IF;
END $$;

-- ============================================================
-- PHASE 2: Добавить оптимизирующие индексы
-- ============================================================

-- Индексы для telegram_bots
CREATE INDEX IF NOT EXISTS idx_telegram_bots_bot_token ON telegram_bots(bot_token);
CREATE INDEX IF NOT EXISTS idx_telegram_bots_is_active ON telegram_bots(is_active);
CREATE INDEX IF NOT EXISTS idx_telegram_bots_seller_id ON telegram_bots(seller_id);
CREATE INDEX IF NOT EXISTS idx_telegram_bots_course_id ON telegram_bots(course_id);

-- Индексы для часто запрашиваемых полей в других таблицах
CREATE INDEX IF NOT EXISTS idx_telegram_main_bot_token ON telegram_main_bot(bot_token);
CREATE INDEX IF NOT EXISTS idx_telegram_import_sessions_user_id ON telegram_import_sessions(telegram_user_id);
CREATE INDEX IF NOT EXISTS idx_telegram_import_sessions_course_id ON telegram_import_sessions(course_id);
CREATE INDEX IF NOT EXISTS idx_course_enrollments_student_id_course_id ON course_enrollments(student_id, course_id);
CREATE INDEX IF NOT EXISTS idx_ad_posts_seller_id ON ad_posts(seller_id);
CREATE INDEX IF NOT EXISTS idx_ad_posts_is_featured ON ad_posts(is_featured);

-- ============================================================
-- PHASE 3: Проверить что все используемые поля существуют
-- ============================================================

-- Проверка: course_posts должна иметь поля которые использует бэкенд
-- (title, text_content, media_type, storage_path, etc.) - все уже есть в schema

-- Проверка: users должна иметь все поля для OAuth
-- (user_id, oauth_provider, oauth_id, email) - все уже есть

-- Проверка: telegram_import_sessions должна иметь message_count
-- (используется в telegram-download.ts)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'telegram_import_sessions' AND column_name = 'message_count'
  ) THEN
    ALTER TABLE telegram_import_sessions
    ADD COLUMN message_count integer DEFAULT 0;
  END IF;
END $$;

-- Проверка: course_posts должна иметь title (используется для вывода в коде)
-- (уже есть в schema)

-- ============================================================
-- PHASE 4: Добавить комментарии на новые поля для документации
-- ============================================================

COMMENT ON COLUMN telegram_bots.webhook_status IS 'Статус webhook: unregistered, registered, failed';
COMMENT ON COLUMN telegram_bots.webhook_registered_at IS 'Время регистрации webhook в Telegram';
COMMENT ON COLUMN telegram_bots.webhook_error IS 'Текст ошибки если webhook регистрация не удалась';
