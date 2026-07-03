/*
  # Athena GYAN Phase 1 - Complete Database Schema

  ## Summary
  This migration sets up the full database for the GYAN AI assistant platform.

  ## Changes

  ### Extensions
  - Enables `vector` (pgvector) for semantic memory search using embeddings

  ### New Tables

  1. `profiles`
     - Stores extended user profile data linked to Supabase Auth users
     - Fields: full_name, gender, age, country, avatar_url, created_at, updated_at

  2. `conversation_sessions`
     - Groups individual messages into logical conversation sessions per user
     - Fields: user_id, title, created_at, updated_at, message_count

  3. `conversations`
     - Stores every message exchanged between user and Gyan
     - Includes a vector(1536) embedding column for semantic similarity search
     - Fields: session_id, user_id, role, content, embedding, step, created_at

  4. `match_conversations` function
     - PostgreSQL function that performs cosine similarity search on conversation embeddings
     - Used by Gyan to recall relevant past conversations as memory context

  ### Security
  - RLS enabled on all tables
  - Users can only read/write their own data
  - All policies check auth.uid() === user_id or id
*/

-- Enable pgvector extension for semantic memory
CREATE EXTENSION IF NOT EXISTS vector;

-- Profiles table: extends Supabase Auth users with GYAN-specific fields
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL DEFAULT '',
  gender text NOT NULL DEFAULT '',
  age integer NOT NULL DEFAULT 0,
  country text NOT NULL DEFAULT '',
  avatar_url text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile"
  ON profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
  ON profiles FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Conversation sessions: groups of messages per user
CREATE TABLE IF NOT EXISTS conversation_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'New Conversation',
  message_count integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE conversation_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own sessions"
  ON conversation_sessions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own sessions"
  ON conversation_sessions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own sessions"
  ON conversation_sessions FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own sessions"
  ON conversation_sessions FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Conversations: individual messages with vector embeddings for memory
CREATE TABLE IF NOT EXISTS conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES conversation_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'user',
  content text NOT NULL DEFAULT '',
  step integer NOT NULL DEFAULT 0,
  embedding vector(1536),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own conversations"
  ON conversations FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own conversations"
  ON conversations FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Index for fast vector similarity searches on conversations
CREATE INDEX IF NOT EXISTS conversations_embedding_idx
  ON conversations
  USING hnsw (embedding vector_cosine_ops);

-- Index for fast session lookups
CREATE INDEX IF NOT EXISTS conversations_session_id_idx
  ON conversations (session_id);

CREATE INDEX IF NOT EXISTS conversations_user_id_idx
  ON conversations (user_id);

-- Function: match_conversations
-- Performs semantic similarity search to find relevant past conversations
-- Used by Gyan to inject long-term memory into AI context
CREATE OR REPLACE FUNCTION match_conversations(
  query_embedding vector(1536),
  match_user_id uuid,
  match_threshold float DEFAULT 0.7,
  match_count int DEFAULT 5
)
RETURNS TABLE (
  id uuid,
  content text,
  role text,
  similarity float,
  created_at timestamptz
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id,
    c.content,
    c.role,
    1 - (c.embedding <=> query_embedding) AS similarity,
    c.created_at
  FROM conversations c
  WHERE
    c.user_id = match_user_id
    AND c.embedding IS NOT NULL
    AND 1 - (c.embedding <=> query_embedding) > match_threshold
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Trigger: auto-update updated_at on profiles
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_sessions_updated_at
  BEFORE UPDATE ON conversation_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
