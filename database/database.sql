-- ============================================================================
-- KeyKurs Platform - Complete Database Schema
-- ============================================================================
-- This file contains the complete database schema consolidated from all
-- Supabase migrations, organized in dependency order.
--
-- Database: PostgreSQL 14+
-- Tables: 25
-- Functions: 10
-- Extensions: pgcrypto, uuid-ossp
-- ============================================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- CORE TABLES
-- ============================================================================

-- Users table (base for all authentication)
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  telegram_id bigint UNIQUE,
  telegram_username text,
  first_name text,
  last_name text,
  photo_url text,
  email text,
  oauth_provider text,
  oauth_id text,
  created_at timestamptz DEFAULT now()
);

-- User roles
CREATE TABLE IF NOT EXISTS user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  role text NOT NULL CHECK (role IN ('super_admin', 'seller', 'student')),
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, role)
);

-- Sellers (course creators)
CREATE TABLE IF NOT EXISTS sellers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE UNIQUE NOT NULL,
  business_name text NOT NULL,
  description text DEFAULT '',
  is_approved boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- ============================================================================
-- COURSE STRUCTURE TABLES
-- ============================================================================

-- Courses
CREATE TABLE IF NOT EXISTS courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid REFERENCES sellers(id) ON DELETE CASCADE NOT NULL,
  title text NOT NULL,
  description text DEFAULT '',
  price numeric DEFAULT 0,
  thumbnail_url text,
  telegram_chat_id bigint,
  is_published boolean DEFAULT false,
  is_active boolean DEFAULT true,
  display_settings jsonb DEFAULT '{}',
  theme_config jsonb DEFAULT '{"mode": "light"}',
  watermark_enabled boolean DEFAULT false,
  watermark_text text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Course modules
CREATE TABLE IF NOT EXISTS course_modules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid REFERENCES courses(id) ON DELETE CASCADE NOT NULL,
  title text NOT NULL,
  description text DEFAULT '',
  order_index integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Course lessons
CREATE TABLE IF NOT EXISTS course_lessons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id uuid REFERENCES course_modules(id) ON DELETE CASCADE NOT NULL,
  title text NOT NULL,
  description text DEFAULT '',
  order_index integer NOT NULL DEFAULT 0,
  duration_minutes integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Lesson content
CREATE TABLE IF NOT EXISTS lesson_content (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id uuid REFERENCES course_lessons(id) ON DELETE CASCADE NOT NULL,
  content_type text NOT NULL CHECK (content_type IN ('video', 'text', 'file', 'image')),
  video_url text,
  text_content text,
  file_url text,
  file_name text,
  order_index integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- ============================================================================
-- ENROLLMENT TABLES
-- ============================================================================

-- Course enrollments
CREATE TABLE IF NOT EXISTS course_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid REFERENCES courses(id) ON DELETE CASCADE NOT NULL,
  student_id uuid REFERENCES users(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  granted_by uuid REFERENCES users(id),
  enrolled_at timestamptz DEFAULT now(),
  expires_at timestamptz,
  UNIQUE(course_id, student_id)
);

-- Pending enrollments (approval queue)
CREATE TABLE IF NOT EXISTS pending_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid REFERENCES courses(id) ON DELETE CASCADE NOT NULL,
  student_id uuid REFERENCES users(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at timestamptz DEFAULT now(),
  UNIQUE(course_id, student_id)
);

-- Lesson progress tracking
CREATE TABLE IF NOT EXISTS lesson_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id uuid REFERENCES course_enrollments(id) ON DELETE CASCADE NOT NULL,
  lesson_id uuid REFERENCES course_lessons(id) ON DELETE CASCADE NOT NULL,
  completed boolean DEFAULT false,
  last_position_seconds integer DEFAULT 0,
  updated_at timestamptz DEFAULT now(),
  UNIQUE(enrollment_id, lesson_id)
);

-- ============================================================================
-- COURSE POSTS & MEDIA TABLES
-- ============================================================================

-- Course posts (unified Telegram messages + manual posts)
CREATE TABLE IF NOT EXISTS course_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid REFERENCES courses(id) ON DELETE CASCADE NOT NULL,
  message_text text,
  telegram_message_id bigint,
  is_pinned boolean DEFAULT false,
  has_error boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Course post media (photos, videos, documents, voice)
CREATE TABLE IF NOT EXISTS course_post_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid REFERENCES course_posts(id) ON DELETE CASCADE NOT NULL,
  media_type text NOT NULL CHECK (media_type IN ('photo', 'video', 'document', 'voice', 'media_group')),
  s3_url text,
  telegram_file_id text,
  file_name text,
  file_size bigint,
  mime_type text,
  thumbnail_s3_url text,
  media_group_id text,
  duration_seconds integer,
  migration_error text,
  created_at timestamptz DEFAULT now()
);

-- Student pinned posts
CREATE TABLE IF NOT EXISTS student_pinned_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  post_id uuid REFERENCES course_posts(id) ON DELETE CASCADE NOT NULL,
  course_id uuid REFERENCES courses(id) ON DELETE CASCADE NOT NULL,
  pinned_at timestamptz DEFAULT now(),
  UNIQUE(user_id, post_id)
);

-- ============================================================================
-- TELEGRAM BOT TABLES
-- ============================================================================

-- Telegram bots
CREATE TABLE IF NOT EXISTS telegram_bots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid REFERENCES sellers(id) ON DELETE CASCADE NOT NULL,
  bot_token text NOT NULL,
  bot_username text NOT NULL,
  webhook_url text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Telegram main bot (platform-wide)
CREATE TABLE IF NOT EXISTS telegram_main_bot (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_token text NOT NULL,
  bot_username text NOT NULL,
  webhook_url text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Telegram linked chats
CREATE TABLE IF NOT EXISTS telegram_linked_chats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid REFERENCES courses(id) ON DELETE CASCADE NOT NULL,
  chat_id bigint NOT NULL UNIQUE,
  chat_type text NOT NULL,
  chat_title text,
  linked_at timestamptz DEFAULT now()
);

-- Telegram media group buffer (temporary storage)
CREATE TABLE IF NOT EXISTS telegram_media_group_buffer (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  media_group_id text NOT NULL,
  telegram_message_id bigint NOT NULL,
  file_id text NOT NULL,
  media_type text NOT NULL,
  file_name text,
  file_size bigint,
  mime_type text,
  message_text text,
  created_at timestamptz DEFAULT now()
);

-- Telegram import sessions
CREATE TABLE IF NOT EXISTS telegram_import_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid REFERENCES courses(id) ON DELETE CASCADE NOT NULL,
  bot_id uuid REFERENCES telegram_bots(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'failed')),
  total_messages integer DEFAULT 0,
  processed_messages integer DEFAULT 0,
  failed_messages integer DEFAULT 0,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- ============================================================================
-- MEDIA & STORAGE TABLES
-- ============================================================================

-- Media access tokens (temporary signed URLs)
CREATE TABLE IF NOT EXISTS media_access_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  media_path text NOT NULL,
  token text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- ============================================================================
-- OAUTH & SESSION TABLES
-- ============================================================================

-- PKCE sessions (OAuth flow)
CREATE TABLE IF NOT EXISTS pkce_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_verifier text NOT NULL,
  code_challenge text NOT NULL,
  state text NOT NULL UNIQUE,
  provider text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- ============================================================================
-- ADMIN FEATURE TABLES
-- ============================================================================

-- Premium courses
CREATE TABLE IF NOT EXISTS premium_courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid REFERENCES courses(id) ON DELETE CASCADE UNIQUE NOT NULL,
  enabled boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Featured courses
CREATE TABLE IF NOT EXISTS featured_courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid REFERENCES courses(id) ON DELETE CASCADE UNIQUE NOT NULL,
  order_index integer DEFAULT 0,
  enabled boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Advertisement posts
CREATE TABLE IF NOT EXISTS ads_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  image_url text,
  target_url text,
  impressions integer DEFAULT 0,
  clicks integer DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id);
CREATE INDEX IF NOT EXISTS idx_users_user_id ON users(user_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_sellers_user_id ON sellers(user_id);
CREATE INDEX IF NOT EXISTS idx_courses_seller_id ON courses(seller_id);
CREATE INDEX IF NOT EXISTS idx_courses_telegram_chat_id ON courses(telegram_chat_id);
CREATE INDEX IF NOT EXISTS idx_course_modules_course_id ON course_modules(course_id);
CREATE INDEX IF NOT EXISTS idx_course_lessons_module_id ON course_lessons(module_id);
CREATE INDEX IF NOT EXISTS idx_lesson_content_lesson_id ON lesson_content(lesson_id);
CREATE INDEX IF NOT EXISTS idx_course_enrollments_student_id ON course_enrollments(student_id);
CREATE INDEX IF NOT EXISTS idx_course_enrollments_user_id ON course_enrollments(user_id);
CREATE INDEX IF NOT EXISTS idx_course_enrollments_course_id ON course_enrollments(course_id);
CREATE INDEX IF NOT EXISTS idx_pending_enrollments_course_id ON pending_enrollments(course_id);
CREATE INDEX IF NOT EXISTS idx_pending_enrollments_student_id ON pending_enrollments(student_id);
CREATE INDEX IF NOT EXISTS idx_pending_enrollments_user_id ON pending_enrollments(user_id);
CREATE INDEX IF NOT EXISTS idx_lesson_progress_enrollment_id ON lesson_progress(enrollment_id);
CREATE INDEX IF NOT EXISTS idx_course_posts_course_id ON course_posts(course_id);
CREATE INDEX IF NOT EXISTS idx_course_posts_is_pinned ON course_posts(is_pinned);
CREATE INDEX IF NOT EXISTS idx_course_post_media_post_id ON course_post_media(post_id);
CREATE INDEX IF NOT EXISTS idx_course_post_media_media_group_id ON course_post_media(media_group_id);
CREATE INDEX IF NOT EXISTS idx_student_pinned_posts_user_id ON student_pinned_posts(user_id);
CREATE INDEX IF NOT EXISTS idx_student_pinned_posts_course_id ON student_pinned_posts(course_id);
CREATE INDEX IF NOT EXISTS idx_telegram_bots_seller_id ON telegram_bots(seller_id);
CREATE INDEX IF NOT EXISTS idx_telegram_linked_chats_course_id ON telegram_linked_chats(course_id);
CREATE INDEX IF NOT EXISTS idx_telegram_linked_chats_chat_id ON telegram_linked_chats(chat_id);
CREATE INDEX IF NOT EXISTS idx_media_access_tokens_user_id ON media_access_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_media_access_tokens_token ON media_access_tokens(token);
CREATE INDEX IF NOT EXISTS idx_pkce_sessions_state ON pkce_sessions(state);
CREATE INDEX IF NOT EXISTS idx_premium_courses_course_id ON premium_courses(course_id);
CREATE INDEX IF NOT EXISTS idx_featured_courses_course_id ON featured_courses(course_id);

-- ============================================================================
-- FUNCTIONS
-- ============================================================================

-- Function: Get current user ID
CREATE OR REPLACE FUNCTION get_current_user_id()
RETURNS uuid AS $$
DECLARE
  current_user_id uuid;
BEGIN
  SELECT id INTO current_user_id
  FROM users
  WHERE user_id = auth.uid() OR id = auth.uid()
  LIMIT 1;

  RETURN current_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Check if user is super admin
CREATE OR REPLACE FUNCTION is_super_admin(user_uuid uuid)
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = user_uuid AND role = 'super_admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Check if user is seller
CREATE OR REPLACE FUNCTION is_seller(user_uuid uuid)
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = user_uuid AND role = 'seller'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Get seller ID for user
CREATE OR REPLACE FUNCTION get_seller_id(user_uuid uuid)
RETURNS uuid AS $$
BEGIN
  RETURN (SELECT id FROM sellers WHERE user_id = user_uuid);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Check if user is enrolled in course
CREATE OR REPLACE FUNCTION is_enrolled_in_course(user_uuid uuid, course_uuid uuid)
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM course_enrollments
    WHERE course_id = course_uuid
    AND (student_id = user_uuid OR user_id = user_uuid)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Check if user owns course
CREATE OR REPLACE FUNCTION owns_course(user_uuid uuid, course_uuid uuid)
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM courses
    WHERE id = course_uuid
    AND seller_id = get_seller_id(user_uuid)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Get vault secret (for secure storage)
CREATE OR REPLACE FUNCTION get_vault_secret(secret_name text)
RETURNS text AS $$
BEGIN
  -- This function would integrate with Vault in production
  -- For now, return NULL (secrets managed via environment variables)
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Trigger: Update courses.updated_at on update
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_courses_updated_at
  BEFORE UPDATE ON courses
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_course_posts_updated_at
  BEFORE UPDATE ON course_posts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Trigger: Update lesson_progress.updated_at on update
CREATE OR REPLACE FUNCTION update_lesson_progress_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER lesson_progress_update_timestamp
  BEFORE UPDATE ON lesson_progress
  FOR EACH ROW
  EXECUTE FUNCTION update_lesson_progress_updated_at();

-- ============================================================================
-- ROW LEVEL SECURITY (RLS) - DISABLED FOR STANDALONE BACKEND
-- ============================================================================
-- Note: RLS is disabled because authentication is handled by backend JWT middleware
-- The backend enforces access control at the application layer

ALTER TABLE users DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles DISABLE ROW LEVEL SECURITY;
ALTER TABLE sellers DISABLE ROW LEVEL SECURITY;
ALTER TABLE courses DISABLE ROW LEVEL SECURITY;
ALTER TABLE course_modules DISABLE ROW LEVEL SECURITY;
ALTER TABLE course_lessons DISABLE ROW LEVEL SECURITY;
ALTER TABLE lesson_content DISABLE ROW LEVEL SECURITY;
ALTER TABLE course_enrollments DISABLE ROW LEVEL SECURITY;
ALTER TABLE pending_enrollments DISABLE ROW LEVEL SECURITY;
ALTER TABLE lesson_progress DISABLE ROW LEVEL SECURITY;
ALTER TABLE course_posts DISABLE ROW LEVEL SECURITY;
ALTER TABLE course_post_media DISABLE ROW LEVEL SECURITY;
ALTER TABLE student_pinned_posts DISABLE ROW LEVEL SECURITY;
ALTER TABLE telegram_bots DISABLE ROW LEVEL SECURITY;
ALTER TABLE telegram_main_bot DISABLE ROW LEVEL SECURITY;
ALTER TABLE telegram_linked_chats DISABLE ROW LEVEL SECURITY;
ALTER TABLE telegram_media_group_buffer DISABLE ROW LEVEL SECURITY;
ALTER TABLE telegram_import_sessions DISABLE ROW LEVEL SECURITY;
ALTER TABLE media_access_tokens DISABLE ROW LEVEL SECURITY;
ALTER TABLE pkce_sessions DISABLE ROW LEVEL SECURITY;
ALTER TABLE premium_courses DISABLE ROW LEVEL SECURITY;
ALTER TABLE featured_courses DISABLE ROW LEVEL SECURITY;
ALTER TABLE ads_posts DISABLE ROW LEVEL SECURITY;

-- ============================================================================
-- REPLICA IDENTITY (for real-time subscriptions)
-- ============================================================================

ALTER TABLE student_pinned_posts REPLICA IDENTITY FULL;
ALTER TABLE course_posts REPLICA IDENTITY FULL;
ALTER TABLE course_post_media REPLICA IDENTITY FULL;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE users IS 'Platform users with Telegram and OAuth authentication';
COMMENT ON TABLE user_roles IS 'User role assignments (super_admin, seller, student)';
COMMENT ON TABLE sellers IS 'Seller/course creator profiles';
COMMENT ON TABLE courses IS 'Courses created by sellers';
COMMENT ON TABLE course_modules IS 'Course modules/sections';
COMMENT ON TABLE course_lessons IS 'Individual lessons within modules';
COMMENT ON TABLE lesson_content IS 'Lesson content (video, text, files)';
COMMENT ON TABLE course_enrollments IS 'Student enrollments in courses';
COMMENT ON TABLE pending_enrollments IS 'Pending enrollment requests awaiting approval';
COMMENT ON TABLE lesson_progress IS 'Student progress tracking for lessons';
COMMENT ON TABLE course_posts IS 'Course posts from Telegram or manual creation';
COMMENT ON TABLE course_post_media IS 'Media attachments for course posts (stored in S3)';
COMMENT ON TABLE student_pinned_posts IS 'Posts pinned by individual students';
COMMENT ON TABLE telegram_bots IS 'Telegram bot configurations per seller';
COMMENT ON TABLE telegram_main_bot IS 'Main platform Telegram bot';
COMMENT ON TABLE telegram_linked_chats IS 'Telegram chats linked to courses';
COMMENT ON TABLE telegram_media_group_buffer IS 'Temporary buffer for Telegram media groups';
COMMENT ON TABLE telegram_import_sessions IS 'Telegram message import session tracking';
COMMENT ON TABLE media_access_tokens IS 'Temporary access tokens for media files';
COMMENT ON TABLE pkce_sessions IS 'OAuth PKCE flow sessions';
COMMENT ON TABLE premium_courses IS 'Premium course designations';
COMMENT ON TABLE featured_courses IS 'Featured courses on platform';
COMMENT ON TABLE ads_posts IS 'Advertisement posts';

COMMENT ON COLUMN course_post_media.s3_url IS 'S3 URL for media file (primary storage)';
COMMENT ON COLUMN course_post_media.telegram_file_id IS 'Legacy Telegram file ID (deprecated, migrated to S3)';
COMMENT ON COLUMN users.user_id IS 'UUID from auth.users (for OAuth users)';
COMMENT ON COLUMN users.telegram_id IS 'Telegram user ID (for Telegram users)';
