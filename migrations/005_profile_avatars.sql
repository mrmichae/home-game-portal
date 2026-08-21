ALTER TABLE player_profiles ADD COLUMN avatar_key TEXT NOT NULL DEFAULT 'space-pilot';

UPDATE player_profiles
SET avatar_key = 'cheerful-robot', avatar_color = '#f59e0b'
WHERE profile_key <> 'household' AND avatar_key = 'space-pilot';
