╔══════════════════════════════════════════════════════════════════════╗
║           CHATTERBOX — REAL-TIME CHAT APPLICATION                   ║
║           Product Requirements Document v2.0                        ║
║           Status: DRAFT | Owner: Product Team | Date: 2025-07-01    ║
╚══════════════════════════════════════════════════════════════════════╝


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[01] PROJECT OVERVIEW
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  VISION      → Fastest, most expressive real-time communication app
                for mobile-first users globally.

  MISSION     → Sub-100ms message delivery, intuitive UX,
                privacy-by-default, 1M MAU within 12 months.

  PLATFORM    → Android-first (React Native), Web admin (React + Vite)

  USERS       → Gen-Z & Millennials (18–34), smartphone-native,
                value speed + privacy over feature bloat.


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[02] TECH STACK
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  MOBILE FRONTEND
  ├── Framework       : React Native 0.74+
  ├── Styling         : NativeWind 4 (Tailwind CSS for RN) (mcp is already connected to the project so we can use it)
  └── State           : Zustand 4

  WEB ADMIN PANEL
  ├── Framework       : React 18
  └── Build Tool      : Vite 5

  BACKEND / DATABASE
  ├── Provider        : Supabase (managed PostgreSQL 15)
  ├── Auth            : Supabase GoTrue (JWT, email verify, OAuth2)
  ├── Real-Time       : Supabase Realtime (Phoenix Channels / WAL)
  └── Storage         : Supabase Storage (S3-compatible CDN)

  INFRASTRUCTURE
  ├── Push Notifs     : Expo Notifications + Firebase FCM
  ├── CI/CD           : GitHub Actions + EAS Build
  ├── Crash Reports   : Sentry
  ├── Analytics       : PostHog
  └── Version Control : GitHub (main + develop branches)


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[03] ARCHITECTURE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  TIER 1 — PRESENTATION
  ├── React Native mobile app
  ├── React/Vite admin web panel
  └── Communication: HTTPS + WebSockets

  TIER 2 — APPLICATION / API
  ├── Supabase Edge Functions (Deno runtime)
  ├── Handles: random-chat matching, status cleanup,
  │           push dispatch, presigned URL generation
  └── Cannot be expressed purely in RLS policies

  TIER 3 — DATA
  ├── PostgreSQL 15 with RLS policies on all tables
  ├── Indexed views for performance-critical queries
  └── pg_cron for scheduled background jobs

  CDN LAYER
  ├── Supabase Storage serves all media assets
  ├── Avatars + chat images via S3-compatible endpoint
  └── Public / private bucket policies per asset type


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[04] DATABASE SCHEMA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  SCHEMA RULES
  ├── All PKs         : UUID v4 via gen_random_uuid()
  ├── RLS             : Enabled on every table, no exceptions
  ├── Timestamps      : TIMESTAMPTZ, default now(), timezone-aware
  ├── Soft deletes    : deleted_at column on messages table
  └── FK cascades     : ON DELETE CASCADE where orphans are unsafe

  ─────────────────────────────────────────────────────────────────────
  TABLE: users
  ─────────────────────────────────────────────────────────────────────
  ├── id                UUID          PK | mirrors auth.users.id
  ├── username          VARCHAR(30)   UNIQUE NOT NULL | a-z, 0-9, _
  ├── display_name      VARCHAR(60)   NOT NULL | emojis allowed
  ├── email             TEXT          NOT NULL
  ├── avatar_url        TEXT          NULLABLE | Supabase Storage URL
  ├── bio               VARCHAR(160)  NULLABLE | 160-char profile bio
  ├── is_private        BOOLEAN       DEFAULT false
  ├── is_online         BOOLEAN       DEFAULT false | via Presence
  ├── last_seen_at      TIMESTAMPTZ   NULLABLE | set on WS disconnect
  ├── push_token        TEXT          NULLABLE | FCM device token
  ├── theme_preference  TEXT          DEFAULT 'system' | light/dark/system
  ├── created_at        TIMESTAMPTZ   DEFAULT now() | immutable
  └── updated_at        TIMESTAMPTZ   DEFAULT now() | auto-updated

  ─────────────────────────────────────────────────────────────────────
  TABLE: conversations
  ─────────────────────────────────────────────────────────────────────
  ├── id                UUID          PK
  ├── participant_a     UUID          FK → users.id | lower UUID (CHECK)
  ├── participant_b     UUID          FK → users.id | higher UUID (CHECK)
  ├── last_message_id   UUID          FK → messages.id | denormalised
  ├── last_activity_at  TIMESTAMPTZ   DEFAULT now() | sort key for list
  ├── is_random_chat    BOOLEAN       DEFAULT false
  └── created_at        TIMESTAMPTZ   DEFAULT now()

  NOTE: UNIQUE(participant_a, participant_b) — one record per user pair

  ─────────────────────────────────────────────────────────────────────
  TABLE: messages
  ─────────────────────────────────────────────────────────────────────
  ├── id                UUID          PK
  ├── conversation_id   UUID          FK → conversations.id
  ├── sender_id         UUID          FK → users.id
  ├── content_type      TEXT          NOT NULL | text/image/emoji/system
  ├── content           TEXT          NULLABLE | NULL if image
  ├── media_url         TEXT          NULLABLE | CDN URL if image
  ├── media_mime_type   TEXT          NULLABLE | image/jpeg, image/webp…
  ├── is_read           BOOLEAN       DEFAULT false
  ├── read_at           TIMESTAMPTZ   NULLABLE
  ├── reply_to_id       UUID          FK → messages.id | self-ref, NULLABLE
  ├── deleted_at        TIMESTAMPTZ   NULLABLE | soft delete
  └── created_at        TIMESTAMPTZ   DEFAULT now() | primary sort key

  ─────────────────────────────────────────────────────────────────────
  TABLE: statuses
  ─────────────────────────────────────────────────────────────────────
  ├── id                UUID          PK
  ├── user_id           UUID          FK → users.id
  ├── text_content      VARCHAR(200)  NOT NULL
  ├── bg_color          CHAR(7)       NOT NULL | #[0-9A-Fa-f]{6} validated
  ├── font_color        CHAR(7)       DEFAULT '#FFFFFF'
  ├── font_style        TEXT          DEFAULT 'normal' | normal/bold/italic
  ├── view_count        INTEGER       DEFAULT 0 | incremented on unique view
  ├── expires_at        TIMESTAMPTZ   NOT NULL | set by DB trigger, not client
  └── created_at        TIMESTAMPTZ   DEFAULT now()

  ─────────────────────────────────────────────────────────────────────
  TABLE: blocks
  ─────────────────────────────────────────────────────────────────────
  ├── id                UUID          PK
  ├── blocker_id        UUID          FK → users.id
  ├── blocked_id        UUID          FK → users.id
  ├── reason            TEXT          NULLABLE | spam/harassment/other
  └── created_at        TIMESTAMPTZ   DEFAULT now()

  NOTE: UNIQUE(blocker_id, blocked_id) — no duplicate block records

  ─────────────────────────────────────────────────────────────────────
  TABLE: status_views
  ─────────────────────────────────────────────────────────────────────
  ├── id                UUID          PK
  ├── status_id         UUID          FK → statuses.id CASCADE DELETE
  ├── viewer_id         UUID          FK → users.id
  └── viewed_at         TIMESTAMPTZ   DEFAULT now()

  NOTE: UNIQUE(status_id, viewer_id) — ON CONFLICT DO NOTHING

  ─────────────────────────────────────────────────────────────────────
  INDEXES
  ─────────────────────────────────────────────────────────────────────
  ├── messages(conversation_id, created_at DESC)   → paginated history
  ├── messages(sender_id)                          → user deletion cleanup
  ├── statuses(user_id, expires_at)                → active status queries
  ├── statuses(expires_at) PARTIAL WHERE < now()   → pg_cron deletion job
  ├── blocks(blocker_id, blocked_id) UNIQUE        → fast RLS block checks
  ├── users(LOWER(username))                       → ILIKE search queries
  └── conversations(participant_a, participant_b)  → one-per-pair enforce


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[05] SECURITY & RLS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  AUTH LAYER
  ├── Provider          : Supabase GoTrue
  ├── Access Token      : JWT, 1-hour expiry
  ├── Refresh Token     : 90-day expiry
  ├── Storage           : Expo SecureStore (Keychain / Keystore)
  └── NEVER stored in   : AsyncStorage

  ─────────────────────────────────────────────────────────────────────
  RLS POLICY MATRIX
  ─────────────────────────────────────────────────────────────────────

  users
  ├── SELECT  → own row OR (target.is_private=false AND no mutual block)
  ├── UPDATE  → auth.uid() = id only
  └── DELETE  → auth.uid() = id only (via RPC + password re-auth)

  conversations
  ├── SELECT  → auth.uid() = participant_a OR participant_b
  └── INSERT  → caller is one participant AND no block between users

  messages
  ├── SELECT  → caller is participant in parent conversation
  ├── INSERT  → sender_id = auth.uid() AND participant AND no block
  └── UPDATE  → sender_id = auth.uid() AND only deleted_at column

  statuses
  ├── SELECT  → expires_at > now() AND author.is_private=false AND no block
  ├── INSERT  → user_id = auth.uid()
  └── DELETE  → user_id = auth.uid() (early manual deletion)

  blocks
  ├── SELECT  → blocker_id = auth.uid() (own blocks only)
  ├── INSERT  → blocker_id = auth.uid() AND blocker != blocked
  └── DELETE  → blocker_id = auth.uid() (unblock)

  ─────────────────────────────────────────────────────────────────────
  ADDITIONAL HARDENING
  ─────────────────────────────────────────────────────────────────────
  ├── CSP               : Strict Content-Security-Policy on admin panel
  ├── Rate Limits       : 60 req/min auth | 300 req/min message send
  ├── Input Sanitise    : HTML tags stripped server-side before storage
  ├── Upload URLs       : Presigned S3 URLs, 5-min TTL, via Edge Function
  ├── Vuln Scanning     : npm audit + Snyk on every PR (no critical merge)
  └── Encryption        : TLS 1.3 in-transit | AES-256 at-rest (Supabase)


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[06] FEATURE: AUTHENTICATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  SIGN-UP SCREEN
  ├── email_input
  │   ├── validation    : RFC 5322 format check
  │   └── error         : "Email already in use" on duplicate
  ├── password_input
  │   ├── rules         : min 8 chars, 1 uppercase, 1 number, 1 special
  │   ├── ui            : strength indicator below field
  │   └── error         : "Password too weak"
  ├── username_input
  │   ├── rules         : a-z, 0-9, _ only | 3–30 chars
  │   ├── realtime      : debounced 500ms ILIKE availability check
  │   ├── ui            : green ✓ / red ✗ shown inline
  │   └── error         : "Username already taken"
  ├── submit_button
  │   ├── state         : disabled until all fields valid
  │   ├── loading       : spinner during API call
  │   └── action        : calls Supabase signUp() → sends verify email
  └── error_handling
      ├── field-level inline errors
      ├── toast on network failure
      └── specific copy per error type

  EMAIL VERIFICATION GATE
  ├── screen            : "Verify Your Email" holding screen
  ├── auto-redirect     : Supabase Auth EMAIL_VERIFIED subscription
  │                       → auto-navigates to Home on confirm
  ├── resend_button     : 60-second cooldown to prevent spam
  └── deep_link         : chatterbox://auth/confirm?token=…
                          → completes verification inside app

  LOGIN SCREEN
  ├── fields            : Email + Password, inline validation
  ├── forgot_password   : calls resetPasswordForEmail()
  │                       → deep-link redirect to reset screen
  ├── session_persist   : JWT stored in SecureStore
  │                       → checked on launch, skips login if valid
  └── biometrics        : [PHASE 2] Face ID / Touch ID unlock


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[07] FEATURE: HOME — CHAT LIST
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  DATA FETCH
  ├── query             : conversations WHERE uid = participant_a OR _b
  ├── join              : last message via last_message_id
  └── sort              : last_activity_at DESC

  EACH ROW DISPLAYS
  ├── contact avatar
  ├── display name
  ├── last message preview    (truncated at 60 chars)
  ├── elapsed time            ("2 min ago", "Yesterday"…)
  └── unread badge            (COUNT messages WHERE is_read=false
                               AND sender_id != auth.uid())

  REAL-TIME
  ├── subscription      : conversations UPDATE events
  └── behavior          : row bubbles to top without full re-fetch

  UX EXTRAS
  ├── pull-to-refresh   : manual fallback full re-fetch
  └── swipe-to-archive  : [PHASE 2] left swipe → Archive / Mute


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[08] FEATURE: CHAT ROOM
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  MESSAGE LIST
  ├── component         : inverted FlatList (newest at bottom)
  ├── initial_load      : latest 40 messages
  ├── pagination        : cursor-based on created_at, 40/page
  │                       triggered on scroll-to-top
  └── auto_scroll       : scrolls to bottom on new message

  BUBBLE VARIANTS
  ├── sender            : right-aligned, blue
  ├── receiver          : left-aligned, grey
  ├── system            : centered, muted (join/leave events)
  └── image             : tappable thumbnail → full-screen lightbox

  REAL-TIME
  ├── subscription      : messages INSERT WHERE conversation_id = :id
  └── behavior          : appends instantly, no re-fetch needed

  TYPING INDICATOR
  ├── mechanism         : Supabase Presence channel
  ├── state             : is_typing boolean per user
  └── ui                : animated three-dot indicator

  READ RECEIPTS
  ├── trigger           : app in foreground + screen focused
  └── action            : batched UPDATE is_read=true for all unread

  REPLY THREADING
  ├── trigger           : long-press on any message
  ├── menu_options      : Reply | Copy | Delete (own messages only)
  ├── reply_ui          : quoted preview above input bar
  └── storage           : reply_to_id FK saved to DB

  INPUT BAR
  ├── text_input        : 2,000 char limit
  ├── emoji_picker      : button to open emoji overlay
  ├── attachment_button : image upload (DISABLED in random chats)
  └── send_button       : submit message

  SOFT DELETE
  ├── trigger           : long-press → Delete (own messages only)
  ├── action            : sets deleted_at timestamp
  ├── display           : "This message was deleted."
  └── realtime          : UPDATE event updates remote party's UI


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[09] FEATURE: SEARCH
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  SEARCH BAR
  ├── debounce          : 400ms
  └── query             : SELECT id, username, display_name, avatar_url
                          FROM users
                          WHERE LOWER(username) ILIKE '%' || $1 || '%'
                          AND is_private = false
                          AND id NOT IN (blocked_users)
                          LIMIT 20

  RESULTS LIST
  ├── each row          : avatar, display_name, username
  ├── tap action        : opens public profile card
  └── profile card      : avatar | name | username | bio | "Send Message"

  EMPTY STATE
  └── message           : "No users found. Try a different username."

  RECENT SEARCHES
  ├── storage           : AsyncStorage (last 5)
  └── display           : shown below search bar before typing


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[10] FEATURE: RANDOM CHAT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  MATCHING FLOW
  ├── step_1            : user taps "Find Someone"
  ├── step_2            : app calls Edge Function /matchmaker
  ├── step_3            : user ID + timestamp written to queue table
  ├── step_4            : matchmaker polls queue every 2 seconds
  ├── step_5            : two users present within 30s window → match
  ├── step_6            : conversation created (is_random_chat=true)
  ├── step_7            : both users notified via push_token
  └── timeout           : no match in 30s → removed from queue
                          → "No matches found right now. Try again soon."

  CHAT RESTRICTIONS
  ├── no image attachments
  ├── no reply threading
  ├── text only (2,000 char limit)
  └── "End Chat" button → soft-deletes conversation access after 24h

  MODERATION
  └── either party can block the other from within the session


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[11] FEATURE: STATUS (STORIES)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  STATUS CREATION
  ├── trigger           : tap "+" on Status tab
  ├── overlay           : full-screen creation UI
  ├── text_input
  │   ├── alignment     : centered, 28sp font
  │   ├── limit         : 200 characters
  │   └── counter       : live character count shown
  ├── bg_color_picker
  │   ├── palette       : 10 predefined hex colour swatches
  │   └── selected_ui   : white border ring on active swatch
  ├── font_style_toggle : Normal | Bold | Italic
  ├── live_preview      : renders card as user types
  └── post_button
      ├── action        : INSERT INTO statuses
      └── expires_at    : set by DB trigger (NOT client-side)
                          = created_at + INTERVAL '24 hours'

  STATUS FEED
  ├── display           : horizontal row of avatar rings
  ├── filter            : contacts with expires_at > now() only
  └── tap action        : opens viewer carousel at first unviewed card

  STATUS VIEWER
  ├── auto_advance      : 5 seconds per card
  ├── progress_bar      : shown at top of screen
  ├── long_press        : pauses timer (release to resume)
  ├── swipe_right       : go to previous card
  ├── on_view_action    : INSERT INTO status_views
  │                       ON CONFLICT (status_id, viewer_id) DO NOTHING
  └── seen_by           : author taps → sees status_views list (own only)

  STATUS EXPIRY
  ├── mechanism         : pg_cron job every 15 minutes
  ├── query             : DELETE FROM statuses WHERE expires_at < now()
  ├── cascade           : ON DELETE CASCADE cleans status_views too
  └── realtime          : DELETE event removes rings from all active UIs


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[12] FEATURE: SETTINGS & PROFILE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  PROFILE EDITOR
  ├── display_name      : max 60 chars
  ├── bio               : max 160 chars
  ├── username          : re-checks uniqueness on save
  └── avatar_upload
      ├── source        : device image picker
      ├── resize        : 256×256px on-device before upload
      ├── destination   : Supabase Storage bucket "avatars"
      └── cleanup       : old Storage object deleted after success

  THEME TOGGLE
  ├── options           : Light | Dark | System
  ├── persistence       : saved to users.theme_preference (DB)
  ├── sync              : cross-device (server-side preference)
  └── apply             : immediate via React Navigation theme context

  PRIVACY CONTROLS
  ├── toggle            : is_private (updates users table)
  ├── effect            : excluded from search + random chat pool
  └── ux                : confirmation dialog shown explaining impact

  NOTIFICATION PREFERENCES  [PHASE 2]
  ├── toggles           : New Messages | Status Updates
  └── storage           : user_notification_prefs table

  BLOCKED USERS LIST
  ├── display           : scrollable list of all blocked users
  ├── unblock_button    : DELETE from blocks table per row
  └── confirmation      : dialog required before unblocking

  ACCOUNT DELETION
  ├── step_1            : password confirmation modal
  ├── step_2            : "Delete Forever" final confirmation
  ├── action            : calls privileged Edge Function
  │   ├── deletes       : auth.users record
  │   ├── cascades      : all DB rows via FK constraints
  │   └── purges        : all Storage objects under users/{uid}/
  ├── result            : logged out → redirected to Onboarding
  └── NOTE              : non-reversible, no grace period

  APP INFO
  ├── version string    : displayed in settings footer
  └── feedback_button   : opens email client, pre-fills support address
                          + device info in body


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[13] FEATURE: MEDIA UPLOADS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  FLOW
  ├── step_1            : user taps attachment button in chat
  ├── step_2            : client checks file size (≤ 5MB enforced)
  ├── step_3            : client calls Edge Function /upload-media
  ├── step_4            : Edge Function returns presigned S3 URL (5min TTL)
  ├── step_5            : client uploads directly to S3 URL
  ├── step_6            : on success → INSERT message with media_url
  └── step_7            : thumbnail rendered in chat bubble

  ALLOWED TYPES         : image/jpeg | image/png | image/webp

  SIZE LIMITS
  ├── chat images       : 5 MB max
  └── avatars           : 2 MB max

  DISABLED IN           : Random Chat sessions


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[14] FEATURE: PUSH NOTIFICATIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  SETUP
  ├── provider          : Firebase Cloud Messaging (FCM)
  ├── sdk               : Expo Notifications
  └── token_refresh     : captured on every app foreground event
                          → stored to users.push_token

  TRIGGERS
  ├── new message       : recipient is offline (is_online = false)
  └── random chat match : both matched users notified

  DEEP LINK ON TAP
  └── notification tap  → chatterbox://chat/:conversationId


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[15] NAVIGATION STRUCTURE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ROOT STACK (React Navigation 6)
  │
  ├── UNAUTHENTICATED STACK
  │   ├── Splash
  │   ├── Onboarding
  │   ├── Sign Up
  │   ├── Email Verification
  │   ├── Login
  │   ├── Forgot Password
  │   └── Reset Password
  │
  ├── AUTHENTICATED STACK
  │   └── Bottom Tab Navigator
  │       ├── [TAB 1] Home (Chats)
  │       ├── [TAB 2] Search
  │       ├── [TAB 3] Status
  │       └── [TAB 4] Settings
  │
  └── MODAL STACK (overlays)
      ├── Chat Room
      ├── User Profile
      ├── Status Viewer
      ├── Image Lightbox
      └── Account Deletion Confirmation

  DEEP LINKS
  ├── chatterbox://auth/confirm
  ├── chatterbox://chat/:conversationId
  └── chatterbox://profile/:username


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[16] API / EDGE FUNCTION CONTRACTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  POST /functions/v1/matchmaker
  ├── auth              : Bearer JWT required
  ├── request           : { user_id: "<uuid>" }
  ├── response_200      : { matched: true, conversation_id, partner_id }
  ├── response_202      : { matched: false, queue_position, retry_after_ms }
  ├── response_408      : { matched: false, error: "timeout" }
  └── response_429      : { error: "rate_limit_exceeded" }

  POST /functions/v1/delete-account
  ├── auth              : Bearer JWT | re-authed within last 5 min
  ├── request           : { password: "<string>" }
  ├── response_200      : { deleted: true }
  ├── response_401      : { error: "password_incorrect" }
  └── response_403      : { error: "recent_auth_required" }

  POST /functions/v1/upload-media
  ├── auth              : Bearer JWT required
  ├── request           : { file_name, mime_type, context: "chat"|"avatar" }
  ├── response_200      : { upload_url, public_url, expires_in: 300 }
  └── response_400      : { error: "unsupported_mime_type" }


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[17] NON-FUNCTIONAL REQUIREMENTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  PERFORMANCE
  ├── message_latency   : P50 < 50ms | P99 < 200ms (4G, end-to-end)
  ├── cold_start        : < 3s on Snapdragon 665 / 2GB RAM
  └── chat_list_load    : < 1.5s with up to 100 conversations

  SCALABILITY
  ├── concurrent_users  : 50,000 simultaneous WebSocket connections
  └── message_throughput: 10,000 messages/second peak, no queue buildup

  RELIABILITY
  ├── uptime_sla        : 99.9% monthly | maintenance with 48h notice
  ├── offline_mode      : cached history shown | input disabled with banner
  │                       | auto-reconnect on restore
  └── data_durability   : WAL replication + PITR backups (7-day window)

  USABILITY
  ├── accessibility     : WCAG 2.1 AA | 44×44pt min touch targets
  │                       | all images have alt text | font scaling support
  └── i18n              : strings in i18n JSON | English first
                          | architecture supports new languages

  SECURITY
  ├── in_transit        : TLS 1.3 enforced
  ├── at_rest           : AES-256 (Supabase managed)
  └── vuln_scanning     : npm audit + Snyk on every PR

  COMPLIANCE
  └── gdpr              : Privacy Policy + ToS in onboarding
                          | PII purged within 72h of deletion


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[18] KPIs & SUCCESS METRICS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  METRIC                   3-MONTH TARGET    12-MONTH TARGET
  ─────────────────────────────────────────────────────────
  Daily Active Users        50,000            250,000
  Messages Sent / Day       500,000           5,000,000
  Avg. Session Duration     8 min             15 min
  P99 Delivery Latency      < 200 ms          < 100 ms
  Day-7 Retention Rate      30%               40%
  App Store Rating          ≥ 4.2             ≥ 4.5
  Uptime SLA                99.5%             99.9%


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[19] DEVELOPMENT ROADMAP
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  [P0] CRITICAL — MUST SHIP BEFORE ANYTHING ELSE
  ├── T01  Repo & project bootstrap (RN, Metro, ESLint, CI pipeline)
  ├── T02  Supabase project + all SQL migration scripts
  ├── T03  RLS policies — all 14 rules verified
  ├── T04  Sign-up screen + real-time username check
  ├── T05  Login screen + JWT session + email verify deep link
  ├── T06  Bottom tab navigation + deep link routing
  └── T25  Production APK build via GitHub Actions + EAS

  [P1] HIGH — CORE USER VALUE
  ├── T07  Chat list view + unread badges + realtime sort
  ├── T08  Chat room — text messages + realtime + typing + read receipts
  ├── T09  Cursor-based message pagination (40/page)
  ├── T11  Username search with debounce + profile card
  ├── T12  Random chat — matchmaker Edge Function + queue + match flow
  ├── T13  Avatar uploads — Storage bucket + resize + CDN URL
  ├── T15  Status creation UI — text + colour picker + font style
  ├── T16  Status viewer carousel — auto-advance + long-press + views
  ├── T17  Status expiry — pg_cron job + realtime DELETE cleanup
  ├── T20  Privacy controls + block/unblock + search exclusion
  └── T22  Account deletion — 2-step + Edge Function + full purge

  [P2] MEDIUM — POLISH & COMPLETENESS
  ├── T10  Reply-to threading — context menu + quoted preview + FK
  ├── T14  Chat image uploads — presigned URL + S3 + thumbnail
  ├── T18  Profile editor — name, bio, username, avatar update
  ├── T19  Theme toggle — light/dark/system + DB persist + live apply
  ├── T21  Push notifications — FCM token + Edge Function + deep link
  ├── T23  Soft delete messages — deleted_at + "deleted" UI + realtime
  └── T24  Sentry integration — crash reports + breadcrumbs (PII-free)


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[20] OUT OF SCOPE — v1.0
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ✗  Group chats (> 2 participants)
  ✗  Voice and video calls
  ✗  Message reactions / emoji reacts
  ✗  End-to-end encryption (E2E)
  ✗  ChatterBox Pro subscription / in-app payments
  ✗  iOS App Store submission
  ✗  Web companion app (spec only, not built)
  ✗  Desktop application
  ✗  Content moderation admin dashboard
  ✗  GDPR data export (Subject Access Request) tooling


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[21] OPEN QUESTIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Q1  Message reactions in v1.0 or Phase 2?
      Impact: new reactions table + UI → est. +3 dev days

  Q2  Random Chat history lifetime — confirm 24h archive policy
      with product stakeholder before T12 begins

  Q3  Group chats in v1.0 scope?
      Current schema is 2-participant only — schema change required

  Q4  iOS target date — when does App Store Connect submission need
      to be scheduled?

  Q5  Biometric auth (Face ID / Fingerprint) — v1.0 or Phase 2?


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[22] ASSUMPTIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  A1  Supabase Pro plan provisioned before dev start
      (free tier lacks pg_cron + adequate Realtime concurrency)

  A2  EAS paid plan available for concurrent APK build workers

  A3  All team members have GitHub repo access with correct
      branch permissions set before T01

  A4  Firebase project exists (or will be created) before T21


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[23] GLOSSARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  RLS           Row-Level Security — Postgres feature restricting
                which rows a query can touch per role

  Realtime      Supabase WebSocket service broadcasting DB changes
                to subscribed clients

  Presence      Supabase Realtime feature tracking connected clients
                and broadcasting live state (is_typing, is_online)

  pg_cron       PostgreSQL extension running SQL on a cron schedule

  WAL           Write-Ahead Log — Postgres transaction log that
                Supabase Realtime listens to for change events

  Edge Function Deno-based serverless function on Supabase edge network

  FCM           Firebase Cloud Messaging — Android push delivery

  MAU           Monthly Active Users — opened app ≥ once in 30 days

  P99 Latency   99th percentile — 99% of requests faster than this

  Soft Delete   Setting deleted_at instead of removing the row,
                preserving referential integrity

  Presigned URL Time-limited pre-authorised S3 upload URL,
                no credentials exposed to client


══════════════════════════════════════════════════════════════════════
  END OF DOCUMENT — ChatterBox PRD v2.0
  v1.0 → 2025-01-10 | Initial draft
  v2.0 → 2025-07-01 | Full expansion (security, API, NFRs, flows)
══════════════════════════════════════════════════════════════════════