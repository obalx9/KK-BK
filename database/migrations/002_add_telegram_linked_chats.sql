/*
  ============================================================
  Add Telegram Linked Chats Support
  ============================================================

  Миграция для добавления поддержки связывания Telegram чатов с ботами и курсами.

  Что добавляется:
  - Таблица telegram_linked_chats для хранения информации о связанных чатах
  - Связь между ботом и Telegram чатом (группа/канал)
  - Возможность привязать чат к конкретному курсу

  ВНИМАНИЕ: Без RLS (проверки прав выполняются в backend API)
  ============================================================
*/

CREATE TABLE IF NOT EXISTS telegram_linked_chats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id uuid NOT NULL REFERENCES telegram_bots(id) ON DELETE CASCADE,
  chat_id bigint NOT NULL,
  chat_title text NOT NULL,
  chat_type text NOT NULL,
  course_id uuid REFERENCES courses(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(bot_id, chat_id)
);

CREATE INDEX IF NOT EXISTS idx_telegram_linked_chats_bot_id ON telegram_linked_chats(bot_id);
CREATE INDEX IF NOT EXISTS idx_telegram_linked_chats_course_id ON telegram_linked_chats(course_id);
CREATE INDEX IF NOT EXISTS idx_telegram_linked_chats_chat_id ON telegram_linked_chats(chat_id);

-- Добавим комментарии для документации
COMMENT ON TABLE telegram_linked_chats IS 'Связанные Telegram чаты (группы/каналы) с ботами и курсами';
COMMENT ON COLUMN telegram_linked_chats.bot_id IS 'ID бота из таблицы telegram_bots';
COMMENT ON COLUMN telegram_linked_chats.chat_id IS 'Telegram Chat ID (группа/канал)';
COMMENT ON COLUMN telegram_linked_chats.chat_title IS 'Название чата';
COMMENT ON COLUMN telegram_linked_chats.chat_type IS 'Тип: group, supergroup, channel';
COMMENT ON COLUMN telegram_linked_chats.course_id IS 'Опциональная привязка к курсу';
