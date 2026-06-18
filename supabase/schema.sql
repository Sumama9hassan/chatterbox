-- ChatterBox Database Schema

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Drop existing tables first with CASCADE (this automatically drops triggers on these tables)
DROP TABLE IF EXISTS public.status_views CASCADE;
DROP TABLE IF EXISTS public.statuses CASCADE;
DROP TABLE IF EXISTS public.messages CASCADE;
DROP TABLE IF EXISTS public.conversations CASCADE;
DROP TABLE IF EXISTS public.blocks CASCADE;
DROP TABLE IF EXISTS public.matchmaking_queue CASCADE;
DROP TABLE IF EXISTS public.users CASCADE;

-- Drop functions
DROP FUNCTION IF EXISTS public.handle_new_user CASCADE;
DROP FUNCTION IF EXISTS public.set_status_expiry CASCADE;
DROP FUNCTION IF EXISTS public.update_updated_at_column CASCADE;
DROP FUNCTION IF EXISTS public.check_message_update CASCADE;
DROP FUNCTION IF EXISTS public.update_conversation_last_message CASCADE;
DROP FUNCTION IF EXISTS public.check_username_available CASCADE;
DROP FUNCTION IF EXISTS public.delete_user_account CASCADE;
DROP FUNCTION IF EXISTS public.mark_messages_read CASCADE;
DROP FUNCTION IF EXISTS public.join_matchmaking CASCADE;

-- Drop triggers on non-public tables
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users CASCADE;

-- ====================================================================
-- TABLES
-- ====================================================================

-- 1. users table (mirrors auth.users)
CREATE TABLE public.users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username VARCHAR(30) UNIQUE NOT NULL CONSTRAINT username_format CHECK (username ~* '^[a-z0-9_]{3,30}$'),
  display_name VARCHAR(60) NOT NULL,
  email TEXT NOT NULL,
  avatar_url TEXT,
  bio VARCHAR(160),
  is_private BOOLEAN DEFAULT false,
  is_online BOOLEAN DEFAULT false,
  last_seen_at TIMESTAMPTZ,
  push_token TEXT,
  theme_preference TEXT DEFAULT 'system',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. conversations table
CREATE TABLE public.conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_a UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  participant_b UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  last_message_id UUID, -- self reference added later to avoid cyclic dependency on create
  last_activity_at TIMESTAMPTZ DEFAULT now(),
  is_random_chat BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT check_participants_order CHECK (participant_a < participant_b),
  CONSTRAINT unique_participants UNIQUE (participant_a, participant_b)
);

-- 3. messages table
CREATE TABLE public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL CHECK (content_type IN ('text', 'image', 'emoji', 'system')),
  content TEXT,
  media_url TEXT,
  media_mime_type TEXT,
  is_read BOOLEAN DEFAULT false,
  read_at TIMESTAMPTZ,
  reply_to_id UUID REFERENCES public.messages(id) ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Add last_message_id foreign key constraint to conversations
ALTER TABLE public.conversations
  ADD CONSTRAINT fk_conversations_last_message
  FOREIGN KEY (last_message_id) REFERENCES public.messages(id) ON DELETE SET NULL;

-- 4. statuses table (stories)
CREATE TABLE public.statuses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  text_content VARCHAR(200) NOT NULL,
  bg_color CHAR(7) NOT NULL CHECK (bg_color ~* '^#[0-9A-Fa-f]{6}$'),
  font_color CHAR(7) DEFAULT '#FFFFFF' CHECK (font_color ~* '^#[0-9A-Fa-f]{6}$'),
  font_style TEXT DEFAULT 'normal' CHECK (font_style IN ('normal', 'bold', 'italic')),
  view_count INTEGER DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 5. blocks table
CREATE TABLE public.blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT unique_blocks UNIQUE (blocker_id, blocked_id),
  CONSTRAINT check_not_self_block CHECK (blocker_id <> blocked_id)
);

-- 6. status_views table
CREATE TABLE public.status_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status_id UUID NOT NULL REFERENCES public.statuses(id) ON DELETE CASCADE,
  viewer_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  viewed_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT unique_status_views UNIQUE (status_id, viewer_id)
);

-- 7. matchmaking_queue table
CREATE TABLE public.matchmaking_queue (
  user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ====================================================================
-- INDEXES
-- ====================================================================
CREATE INDEX idx_messages_conversation_created_at ON public.messages(conversation_id, created_at DESC);
CREATE INDEX idx_messages_sender_id ON public.messages(sender_id);
CREATE INDEX idx_statuses_user_expires ON public.statuses(user_id, expires_at);
CREATE INDEX idx_statuses_expires ON public.statuses(expires_at);
CREATE INDEX idx_blocks_lookup ON public.blocks(blocker_id, blocked_id);

-- ====================================================================
-- TRIGGERS & FUNCTIONS
-- ====================================================================

-- Trigger to sync auth.users with public.users
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
  new_username text;
  new_display_name text;
BEGIN
  new_username := COALESCE(
    new.raw_user_meta_data->>'username',
    'user_' || substring(new.id::text from 1 for 8)
  );
  new_display_name := COALESCE(
    new.raw_user_meta_data->>'display_name',
    'User ' || substring(new.id::text from 1 for 8)
  );

  -- Clean username: only lowercase letters, digits, and underscores
  new_username := lower(regexp_replace(new_username, '[^a-zA-Z0-9_]', '', 'g'));
  
  -- Ensure username meets 3-30 character limit
  IF length(new_username) < 3 THEN
    new_username := new_username || substring(new.id::text from 1 for (3 - length(new_username)));
  ELSIF length(new_username) > 30 THEN
    new_username := substring(new_username from 1 for 30);
  END IF;

  -- De-duplicate username if needed
  WHILE EXISTS (SELECT 1 FROM public.users WHERE username = new_username) LOOP
    new_username := substring(new_username from 1 for 25) || substring(md5(random()::text) from 1 for 5);
  END LOOP;

  INSERT INTO public.users (id, email, username, display_name, avatar_url, bio, theme_preference, is_private)
  VALUES (
    new.id,
    new.email,
    new_username,
    new_display_name,
    new.raw_user_meta_data->>'avatar_url',
    new.raw_user_meta_data->>'bio',
    COALESCE(new.raw_user_meta_data->>'theme_preference', 'system'),
    COALESCE((new.raw_user_meta_data->>'is_private')::boolean, false)
  );
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Trigger to set status expires_at
CREATE OR REPLACE FUNCTION public.set_status_expiry()
RETURNS trigger AS $$
BEGIN
  NEW.expires_at := NEW.created_at + INTERVAL '24 hours';
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER on_status_created
  BEFORE INSERT ON public.statuses
  FOR EACH ROW EXECUTE FUNCTION public.set_status_expiry();

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER on_user_updated
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Trigger to validate message updates
CREATE OR REPLACE FUNCTION public.check_message_update()
RETURNS trigger AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF auth.uid() = OLD.sender_id THEN
    -- Sender updating: only deleted_at can change
    IF NEW.id IS DISTINCT FROM OLD.id OR
       NEW.conversation_id IS DISTINCT FROM OLD.conversation_id OR
       NEW.sender_id IS DISTINCT FROM OLD.sender_id OR
       NEW.content_type IS DISTINCT FROM OLD.content_type OR
       NEW.content IS DISTINCT FROM OLD.content OR
       NEW.media_url IS DISTINCT FROM OLD.media_url OR
       NEW.media_mime_type IS DISTINCT FROM OLD.media_mime_type OR
       NEW.is_read IS DISTINCT FROM OLD.is_read OR
       NEW.read_at IS DISTINCT FROM OLD.read_at OR
       NEW.reply_to_id IS DISTINCT FROM OLD.reply_to_id OR
       NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Sender can only update deleted_at.';
    END IF;
  ELSE
    -- Receiver updating: only is_read/read_at can change
    IF NOT EXISTS (
      SELECT 1 FROM public.conversations
      WHERE id = OLD.conversation_id AND (participant_a = auth.uid() OR participant_b = auth.uid())
    ) THEN
      RAISE EXCEPTION 'Not a participant in this conversation.';
    END IF;
    IF NEW.id IS DISTINCT FROM OLD.id OR
       NEW.conversation_id IS DISTINCT FROM OLD.conversation_id OR
       NEW.sender_id IS DISTINCT FROM OLD.sender_id OR
       NEW.content_type IS DISTINCT FROM OLD.content_type OR
       NEW.content IS DISTINCT FROM OLD.content OR
       NEW.media_url IS DISTINCT FROM OLD.media_url OR
       NEW.media_mime_type IS DISTINCT FROM OLD.media_mime_type OR
       NEW.reply_to_id IS DISTINCT FROM OLD.reply_to_id OR
       NEW.deleted_at IS DISTINCT FROM OLD.deleted_at OR
       NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Receiver can only update read status.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_message_update
  BEFORE UPDATE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.check_message_update();

-- Trigger to automatically update conversation last_message_id and last_activity_at
CREATE OR REPLACE FUNCTION public.update_conversation_last_message()
RETURNS trigger AS $$
BEGIN
  UPDATE public.conversations
  SET last_message_id = NEW.id,
      last_activity_at = NEW.created_at
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_message_inserted
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.update_conversation_last_message();

-- ====================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ====================================================================

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.statuses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.status_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matchmaking_queue ENABLE ROW LEVEL SECURITY;

-- users policies
CREATE POLICY "Select Users" ON public.users
  FOR SELECT TO authenticated
  USING (
    id = auth.uid() OR (
      is_private = false AND NOT EXISTS (
        SELECT 1 FROM public.blocks
        WHERE (blocker_id = auth.uid() AND blocked_id = users.id)
           OR (blocker_id = users.id AND blocked_id = auth.uid())
      )
    )
  );

CREATE POLICY "Update Users" ON public.users
  FOR UPDATE TO authenticated
  USING (id = auth.uid());

CREATE POLICY "Delete Users" ON public.users
  FOR DELETE TO authenticated
  USING (id = auth.uid());

-- conversations policies
CREATE POLICY "Select Conversations" ON public.conversations
  FOR SELECT TO authenticated
  USING (auth.uid() = participant_a OR auth.uid() = participant_b);

CREATE POLICY "Insert Conversations" ON public.conversations
  FOR INSERT TO authenticated
  WITH CHECK (
    (auth.uid() = participant_a OR auth.uid() = participant_b) AND NOT EXISTS (
      SELECT 1 FROM public.blocks
      WHERE (blocker_id = participant_a AND blocked_id = participant_b)
         OR (blocker_id = participant_b AND blocked_id = participant_a)
    )
  );

-- messages policies
CREATE POLICY "Select Messages" ON public.messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.conversations
      WHERE id = conversation_id AND (participant_a = auth.uid() OR participant_b = auth.uid())
    )
  );

CREATE POLICY "Insert Messages" ON public.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid() AND EXISTS (
      SELECT 1 FROM public.conversations
      WHERE id = conversation_id AND (participant_a = auth.uid() OR participant_b = auth.uid())
    ) AND NOT EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_id AND EXISTS (
        SELECT 1 FROM public.blocks
        WHERE (blocker_id = c.participant_a AND blocked_id = c.participant_b)
           OR (blocker_id = c.participant_b AND blocked_id = c.participant_a)
      )
    )
  );

CREATE POLICY "Update Messages" ON public.messages
  FOR UPDATE TO authenticated
  USING (
    sender_id = auth.uid() OR EXISTS (
      SELECT 1 FROM public.conversations
      WHERE id = conversation_id AND (participant_a = auth.uid() OR participant_b = auth.uid())
    )
  );

-- statuses policies
CREATE POLICY "Select Statuses" ON public.statuses
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid() OR (
      expires_at > now() AND EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.id = user_id AND u.is_private = false
      ) AND NOT EXISTS (
        SELECT 1 FROM public.blocks
        WHERE (blocker_id = auth.uid() AND blocked_id = user_id)
           OR (blocker_id = user_id AND blocked_id = auth.uid())
      )
    )
  );

CREATE POLICY "Insert Statuses" ON public.statuses
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Delete Statuses" ON public.statuses
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- blocks policies
CREATE POLICY "Select Blocks" ON public.blocks
  FOR SELECT TO authenticated
  USING (blocker_id = auth.uid());

CREATE POLICY "Insert Blocks" ON public.blocks
  FOR INSERT TO authenticated
  WITH CHECK (blocker_id = auth.uid());

CREATE POLICY "Delete Blocks" ON public.blocks
  FOR DELETE TO authenticated
  USING (blocker_id = auth.uid());

-- status_views policies
CREATE POLICY "Select Status Views" ON public.status_views
  FOR SELECT TO authenticated
  USING (
    viewer_id = auth.uid() OR EXISTS (
      SELECT 1 FROM public.statuses s
      WHERE s.id = status_id AND s.user_id = auth.uid()
    )
  );

CREATE POLICY "Insert Status Views" ON public.status_views
  FOR INSERT TO authenticated
  WITH CHECK (viewer_id = auth.uid());

-- matchmaking_queue policies
CREATE POLICY "Queue Policies" ON public.matchmaking_queue
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ====================================================================
-- RPC FUNCTIONS
-- ====================================================================

-- 1. Check if a username is available
CREATE OR REPLACE FUNCTION public.check_username_available(username_to_check text)
RETURNS boolean AS $$
BEGIN
  RETURN NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE lower(username) = lower(username_to_check)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Delete user account
CREATE OR REPLACE FUNCTION public.delete_user_account()
RETURNS void AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  DELETE FROM auth.users WHERE id = auth.uid();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Mark messages as read in a conversation
CREATE OR REPLACE FUNCTION public.mark_messages_read(conv_id uuid)
RETURNS void AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  
  UPDATE public.messages
  SET is_read = true,
      read_at = now()
  WHERE conversation_id = conv_id
    AND sender_id <> auth.uid()
    AND is_read = false;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Matchmaking logic
CREATE OR REPLACE FUNCTION public.join_matchmaking(caller_id uuid)
RETURNS jsonb AS $$
DECLARE
  matched_user_id uuid;
  new_conversation_id uuid;
BEGIN
  -- 1. Check if caller_id is already in an active random conversation created in the last 30 seconds
  SELECT id, 
         CASE WHEN participant_a = caller_id THEN participant_b ELSE participant_a END INTO new_conversation_id, matched_user_id
  FROM public.conversations
  WHERE is_random_chat = true
    AND (participant_a = caller_id OR participant_b = caller_id)
    AND created_at > now() - INTERVAL '30 seconds'
  LIMIT 1;

  IF new_conversation_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'matched', true,
      'conversation_id', new_conversation_id,
      'partner_id', matched_user_id
    );
  END IF;

  -- 2. Try to find a partner from the queue
  SELECT mq.user_id INTO matched_user_id
  FROM public.matchmaking_queue mq
  WHERE mq.user_id <> caller_id
    AND mq.created_at > now() - INTERVAL '30 seconds'
    AND NOT EXISTS (
      SELECT 1 FROM public.blocks b
      WHERE (b.blocker_id = caller_id AND b.blocked_id = mq.user_id)
         OR (b.blocker_id = mq.user_id AND b.blocked_id = caller_id)
    )
  ORDER BY mq.created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF matched_user_id IS NOT NULL THEN
    -- Match found! Remove partner from queue
    DELETE FROM public.matchmaking_queue WHERE user_id = matched_user_id;
    -- Remove caller from queue if they were in it
    DELETE FROM public.matchmaking_queue WHERE user_id = caller_id;

    -- Create new conversation (Lower UUID = participant_a)
    IF caller_id < matched_user_id THEN
      INSERT INTO public.conversations (participant_a, participant_b, is_random_chat)
      VALUES (caller_id, matched_user_id, true)
      RETURNING id INTO new_conversation_id;
    ELSE
      INSERT INTO public.conversations (participant_a, participant_b, is_random_chat)
      VALUES (matched_user_id, caller_id, true)
      RETURNING id INTO new_conversation_id;
    END IF;

    -- Insert system join message
    INSERT INTO public.messages (conversation_id, sender_id, content_type, content)
    VALUES (new_conversation_id, caller_id, 'system', 'Random chat started! Say hello.');

    RETURN jsonb_build_object(
      'matched', true,
      'conversation_id', new_conversation_id,
      'partner_id', matched_user_id
    );
  ELSE
    -- No match found. Add caller to queue if not already there
    INSERT INTO public.matchmaking_queue (user_id, created_at)
    VALUES (caller_id, now())
    ON CONFLICT (user_id) DO UPDATE SET created_at = now();

    RETURN jsonb_build_object(
      'matched', false,
      'queue_position', (SELECT count(*) FROM public.matchmaking_queue WHERE created_at <= now()),
      'retry_after_ms', 2000
    );
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
