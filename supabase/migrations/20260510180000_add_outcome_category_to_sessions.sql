/*
  # Add desired_outcome and category columns to conversation_sessions

  1. Changes
    - `conversation_sessions`: add `desired_outcome` (text, nullable) — stores what the user wants from the conversation
    - `conversation_sessions`: add `category` (text, nullable) — AI-assigned category tag (e.g., Business, Health)
    - `message_notes` table: stores per-message user annotations
    - `message_likes` table: stores per-message likes

  2. Security
    - RLS enabled on both new tables
    - Users can only access their own notes and likes
*/

-- Add columns to existing conversation_sessions
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'conversation_sessions' AND column_name = 'desired_outcome'
  ) THEN
    ALTER TABLE conversation_sessions ADD COLUMN desired_outcome text;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'conversation_sessions' AND column_name = 'category'
  ) THEN
    ALTER TABLE conversation_sessions ADD COLUMN category text;
  END IF;
END $$;

-- Message notes table
CREATE TABLE IF NOT EXISTS message_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES conversation_sessions(id) ON DELETE CASCADE,
  message_hash text NOT NULL,
  note_text text NOT NULL DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE message_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select own notes"
  ON message_notes FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own notes"
  ON message_notes FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own notes"
  ON message_notes FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own notes"
  ON message_notes FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Message likes table
CREATE TABLE IF NOT EXISTS message_likes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES conversation_sessions(id) ON DELETE CASCADE,
  message_hash text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, message_hash)
);

ALTER TABLE message_likes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select own likes"
  ON message_likes FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own likes"
  ON message_likes FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own likes"
  ON message_likes FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
