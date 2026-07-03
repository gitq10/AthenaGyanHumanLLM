/*
  # Add phase column to conversations

  ## Summary
  Adds a `phase` text column to the `conversations` table to track which
  phase of the GYAN guided flow each message belongs to.

  ## Changes
  - `conversations`: new `phase` column (text, default 'intake')
    - Stores one of: intake, outcome, context, report, followup, companion
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'conversations' AND column_name = 'phase'
  ) THEN
    ALTER TABLE conversations ADD COLUMN phase text NOT NULL DEFAULT 'intake';
  END IF;
END $$;
