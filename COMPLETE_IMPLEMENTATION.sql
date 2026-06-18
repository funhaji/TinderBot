-- Complete Implementation SQL Script
-- Run this to update the Like + Chat button immediately

-- Update explorer button from "لایک + چت" to "لایک + دایرکت"
UPDATE bot_config 
SET document = jsonb_set(
  jsonb_set(
    document,
    '{explorer_main,rows,0,1,fa}',
    '"لایک + دایرکت 💌"'
  ),
  '{explorer_main,rows,0,1,en}',
  '"Like + Direct Message 💌"'
),
updated_at = now()
WHERE id = 1;

-- Verify the change
SELECT 
  'Explorer Button Updated:' as status,
  document->'explorer_main'->'rows'->0->1->>'fa' as persian_text,
  document->'explorer_main'->'rows'->0->1->>'en' as english_text
FROM bot_config 
WHERE id = 1;
