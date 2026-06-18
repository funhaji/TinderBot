-- Update "Like + Chat" button to "Like + Direct Message"
-- Run this if you want to update the existing button text in database
-- Or use the new Button Editor in admin panel! (easier)

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
  document->'explorer_main'->'rows'->0->1->>'fa' as persian_text,
  document->'explorer_main'->'rows'->0->1->>'en' as english_text
FROM bot_config 
WHERE id = 1;
