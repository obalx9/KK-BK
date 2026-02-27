/*
  ============================================================
  KeyKurs Platform — Complete Database Schema
  ============================================================

  Target: PostgreSQL (Timeweb DBaaS или любой PostgreSQL 14+)

  Применение:
    psql $DATABASE_URL -f schema.sql

  ВНИМАНИЕ: Скрипт использует IF NOT EXISTS / IF EXISTS везде,
  поэтому его можно запускать повторно — он не удалит данные.

  Отличия от Supabase-версии:
  - Нет Supabase auth (auth.users, auth.uid() и т.д.)
  - Нет RLS (не нужен, т.к. бэкенд проверяет права сам)
  - Добавлены поля oauth_id, user_id для OAuth
  - Добавлена таблица pkce_sessions для VK OAuth PKCE
  - В course_posts/course_post_media используется storage_path
    (telegram_file_id сохранён для обратной совместимости)
  - Добавлено поле thumbnail_storage_path для хранения миниатюр
  ============================================================
*/

-- ============================================================
-- EXTENSIONS
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- USERS & ROLES
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text UNIQUE,
  telegram_id bigint UNIQUE,
  telegram_username text,
  first_name text,
  last_name text,
  photo_url text,
  email text,
  oauth_provider text,
  oauth_id text,
  created_at timestamptz DEFAULT now(),
  UNIQUE (oauth_provider, oauth_id)
);

CREATE TABLE IF NOT EXISTS user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  role text NOT NULL CHECK (role IN ('super_admin', 'seller', 'student')),
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, role)
);

-- ============================================================
-- SELLERS & COURSES
-- ============================================================

CREATE TABLE IF NOT EXISTS sellers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE UNIQUE NOT NULL,
  business_name text NOT NULL,
  description text DEFAULT '',
  is_approved boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid REFERENCES sellers(id) ON DELETE CASCADE NOT NULL,
  title text NOT NULL,
  description text DEFAULT '',
  thumbnail_url text,
  is_published boolean DEFAULT false,
  watermark text,
  display_settings jsonb DEFAULT '{}',
  theme_config jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS course_modules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid REFERENCES courses(id) ON DELETE CASCADE NOT NULL,
  title text NOT NULL,
  description text DEFAULT '',
  order_index integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS course_lessons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id uuid REFERENCES course_modules(id) ON DELETE CASCADE NOT NULL,
  title text NOT NULL,
  description text DEFAULT '',
  order_index integer NOT NULL DEFAULT 0,
  duration_minutes integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lesson_content (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id uuid REFERENCES course_lessons(id) ON DELETE CASCADE NOT NULL,
  content_type text NOT NULL CHECK (content_type IN ('video', 'text', 'file', 'image')),
  video_url text,
  text_content text,
  file_url text,
  file_name text,
  storage_path text,
  order_index integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS course_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid REFERENCES courses(id) ON DELETE CASCADE NOT NULL,
  student_id uuid REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  granted_by uuid REFERENCES users(id) NOT NULL,
  enrolled_at timestamptz DEFAULT now(),
  expires_at timestamptz,
  UNIQUE(course_id, student_id)
);

CREATE TABLE IF NOT EXISTS lesson_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id uuid REFERENCES course_enrollments(id) ON DELETE CASCADE NOT NULL,
  lesson_id uuid REFERENCES course_lessons(id) ON DELETE CASCADE NOT NULL,
  completed boolean DEFAULT false,
  last_position_seconds integer DEFAULT 0,
  updated_at timestamptz DEFAULT now(),
  UNIQUE(enrollment_id, lesson_id)
);

-- ============================================================
-- PENDING ENROLLMENTS
-- ============================================================

CREATE TABLE IF NOT EXISTS pending_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid REFERENCES courses(id) ON DELETE CASCADE NOT NULL,
  telegram_id bigint,
  telegram_username text,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  granted_by uuid REFERENCES users(id) NOT NULL,
  expires_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- ============================================================
-- TELEGRAM BOTS
-- ============================================================

CREATE TABLE IF NOT EXISTS telegram_bots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid REFERENCES sellers(id) ON DELETE CASCADE,
  course_id uuid REFERENCES courses(id) ON DELETE SET NULL,
  bot_token text NOT NULL,
  bot_username text,
  channel_id text,
  channel_username text,
  is_active boolean DEFAULT true,
  last_sync_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS telegram_main_bot (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_token text NOT NULL,
  bot_username text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS telegram_seller_chats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_bot_id uuid REFERENCES telegram_bots(id) ON DELETE CASCADE,
  course_id uuid REFERENCES courses(id) ON DELETE CASCADE,
  telegram_chat_id bigint NOT NULL,
  telegram_chat_title text,
  is_active boolean DEFAULT true,
  last_sync_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS telegram_import_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_user_id bigint NOT NULL,
  platform_user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  course_id uuid REFERENCES courses(id) ON DELETE CASCADE NOT NULL,
  message_count integer DEFAULT 0,
  is_active boolean DEFAULT true,
  completed_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- ============================================================
-- COURSE POSTS (unified feed system)
-- ============================================================

CREATE TABLE IF NOT EXISTS course_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid REFERENCES courses(id) ON DELETE CASCADE NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('telegram', 'manual')) DEFAULT 'manual',
  title text DEFAULT '',
  text_content text DEFAULT '',
  media_type text CHECK (media_type IN ('image', 'video', 'document', 'audio', 'animation', 'voice', 'media_group', NULL)),
  media_group_id text,
  media_count integer DEFAULT 1,
  storage_path text,
  thumbnail_storage_path text,
  file_name text,
  file_size bigint,
  mime_type text,
  telegram_file_id text,
  telegram_thumbnail_file_id text,
  telegram_message_id bigint,
  telegram_media_width integer,
  telegram_media_height integer,
  telegram_media_duration integer,
  has_error boolean DEFAULT false,
  error_message text,
  order_index integer DEFAULT 0,
  published_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS course_post_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid REFERENCES course_posts(id) ON DELETE CASCADE NOT NULL,
  media_type text CHECK (media_type IN ('image', 'video', 'document', 'audio', 'animation', 'voice', NULL)),
  storage_path text,
  thumbnail_storage_path text,
  telegram_file_id text,
  thumbnail_file_id text,
  file_name text,
  file_size bigint,
  mime_type text,
  telegram_media_width integer,
  telegram_media_height integer,
  telegram_media_duration integer,
  has_error boolean DEFAULT false,
  error_message text,
  order_index integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Media group buffer (for collecting album parts before processing)
CREATE TABLE IF NOT EXISTS telegram_media_group_buffer (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL,
  media_group_id text NOT NULL,
  telegram_message_id bigint NOT NULL,
  media_data jsonb NOT NULL,
  caption text,
  message_date timestamptz NOT NULL,
  received_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

-- ============================================================
-- STUDENT PINNED POSTS
-- ============================================================

CREATE TABLE IF NOT EXISTS student_pinned_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  post_id uuid REFERENCES course_posts(id) ON DELETE CASCADE NOT NULL,
  course_id uuid REFERENCES courses(id) ON DELETE CASCADE NOT NULL,
  pinned_at timestamptz DEFAULT now(),
  UNIQUE(student_id, post_id)
);

-- ============================================================
-- MEDIA ACCESS TOKENS
-- ============================================================

CREATE TABLE IF NOT EXISTS media_access_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  course_id uuid REFERENCES courses(id) ON DELETE CASCADE NOT NULL,
  file_id text NOT NULL,
  token text UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'base64'),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '1 hour'),
  created_at timestamptz DEFAULT now()
);

-- ============================================================
-- ADS & FEATURED (premium system)
-- ============================================================

CREATE TABLE IF NOT EXISTS ad_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL DEFAULT '',
  text_content text DEFAULT '',
  media_type text,
  storage_path text,
  file_name text,
  link_url text,
  link_label text DEFAULT 'Подробнее',
  is_active boolean DEFAULT true,
  display_frequency integer DEFAULT 5,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS featured_courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid REFERENCES courses(id) ON DELETE CASCADE NOT NULL UNIQUE,
  position integer DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS premium_sellers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid REFERENCES sellers(id) ON DELETE CASCADE NOT NULL UNIQUE,
  premium_until timestamptz,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- ============================================================
-- OAUTH / PKCE
-- ============================================================

CREATE TABLE IF NOT EXISTS pkce_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state text UNIQUE NOT NULL,
  code_verifier text NOT NULL,
  redirect_url text,
  expires_at timestamptz DEFAULT (now() + interval '10 minutes'),
  created_at timestamptz DEFAULT now()
);

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id);
CREATE INDEX IF NOT EXISTS idx_users_oauth ON users(oauth_provider, oauth_id);
CREATE INDEX IF NOT EXISTS idx_users_user_id ON users(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_courses_seller_id ON courses(seller_id);
CREATE INDEX IF NOT EXISTS idx_course_modules_course_id ON course_modules(course_id);
CREATE INDEX IF NOT EXISTS idx_course_lessons_module_id ON course_lessons(module_id);
CREATE INDEX IF NOT EXISTS idx_lesson_content_lesson_id ON lesson_content(lesson_id);
CREATE INDEX IF NOT EXISTS idx_course_enrollments_student_id ON course_enrollments(student_id);
CREATE INDEX IF NOT EXISTS idx_course_enrollments_course_id ON course_enrollments(course_id);
CREATE INDEX IF NOT EXISTS idx_lesson_progress_enrollment_id ON lesson_progress(enrollment_id);
CREATE INDEX IF NOT EXISTS idx_course_posts_course_id ON course_posts(course_id);
CREATE INDEX IF NOT EXISTS idx_course_posts_published_at ON course_posts(published_at);
CREATE INDEX IF NOT EXISTS idx_course_post_media_post_id ON course_post_media(post_id);
CREATE INDEX IF NOT EXISTS idx_media_group_buffer_group_id ON telegram_media_group_buffer(media_group_id);
CREATE INDEX IF NOT EXISTS idx_media_group_buffer_received_at ON telegram_media_group_buffer(received_at);
CREATE INDEX IF NOT EXISTS idx_telegram_import_sessions_user ON telegram_import_sessions(telegram_user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_media_access_tokens_token ON media_access_tokens(token);
CREATE INDEX IF NOT EXISTS idx_media_access_tokens_expires ON media_access_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_student_pinned_posts_student ON student_pinned_posts(student_id, course_id);
CREATE INDEX IF NOT EXISTS idx_pkce_sessions_state ON pkce_sessions(state);

-- ============================================================
-- CLEANUP FUNCTIONS
-- ============================================================

CREATE OR REPLACE FUNCTION cleanup_expired_tokens()
RETURNS void AS $$
BEGIN
  DELETE FROM media_access_tokens WHERE expires_at < now();
  DELETE FROM pkce_sessions WHERE expires_at < now();
  DELETE FROM telegram_media_group_buffer WHERE received_at < now() - interval '10 minutes';
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- PROCESS MEDIA GROUP FUNCTION
-- Called by backend after buffer delay
-- ============================================================

CREATE OR REPLACE FUNCTION process_media_group(p_media_group_id text, p_course_id uuid)
RETURNS uuid AS $$
DECLARE
  v_post_id uuid;
  v_caption text;
  v_message_date timestamptz;
  v_media_count integer;
BEGIN
  SELECT caption, message_date INTO v_caption, v_message_date
  FROM telegram_media_group_buffer
  WHERE media_group_id = p_media_group_id AND course_id = p_course_id
  ORDER BY created_at
  LIMIT 1;

  SELECT COUNT(*) INTO v_media_count
  FROM telegram_media_group_buffer
  WHERE media_group_id = p_media_group_id AND course_id = p_course_id;

  INSERT INTO course_posts (
    course_id, source_type, media_type, media_group_id, media_count, published_at
  )
  VALUES (
    p_course_id, 'telegram', 'media_group', p_media_group_id, v_media_count, v_message_date
  )
  RETURNING id INTO v_post_id;

  RETURN v_post_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- DONE
-- ============================================================
-- После применения схемы:
-- 1. Создайте суперадмина через INSERT в users + user_roles
-- 2. Настройте Telegram main bot через INSERT в telegram_main_bot
-- 3. Запустите бэкенд и проверьте /health endpoint
