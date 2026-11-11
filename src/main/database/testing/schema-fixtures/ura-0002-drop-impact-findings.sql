-- A beuve database at migration ura-0002-drop-impact-findings, with representative rows in every table.
-- Written by `node scripts/write-schema-fixture.ts`. Never edit it: it stands for databases
-- that exist, and app-migrations.test.ts upgrades it (ADR 0006 amendment 2026-11-11).
BEGIN;
CREATE TABLE schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL) STRICT;
CREATE TABLE sessions (
        id TEXT PRIMARY KEY CHECK (length(id) = 36),
        kind TEXT NOT NULL CHECK (kind IN ('local', 'github-pull-request', 'remote-branch')),
        repo_path TEXT NOT NULL CHECK (repo_path <> ''),
        base_ref TEXT NOT NULL CHECK (trim(base_ref) <> ''),
        head_ref TEXT,
        owner TEXT,
        repo TEXT,
        pr_number INTEGER,
        head_sha TEXT NOT NULL CHECK (length(head_sha) IN (40, 64) AND head_sha NOT GLOB '*[^0-9a-f]*'),
        created_at TEXT NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
        updated_at TEXT NOT NULL CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
        host TEXT CHECK (
          host IS NULL OR (
            kind IN ('github-pull-request', 'remote-branch')
            AND length(host) BETWEEN 1 AND 253
            AND host NOT GLOB '*[^a-z0-9.-]*'
            AND host NOT GLOB '[.-]*'
          )
        ),
        forge TEXT CHECK (forge IS NULL OR (kind = 'remote-branch' AND forge IN ('github'))),
        branch TEXT,
        CHECK (
          (kind = 'local'
            AND head_ref IS NOT NULL AND trim(head_ref) <> ''
            AND owner IS NULL AND repo IS NULL AND pr_number IS NULL
            AND forge IS NULL AND branch IS NULL)
          OR
          (kind = 'github-pull-request'
            AND head_ref IS NULL
            AND owner IS NOT NULL AND trim(owner) <> ''
            AND repo IS NOT NULL AND trim(repo) <> ''
            AND pr_number IS NOT NULL AND pr_number > 0
            AND forge IS NULL AND branch IS NULL)
          OR
          (kind = 'remote-branch'
            AND head_ref IS NULL AND pr_number IS NULL
            AND forge IS NOT NULL
            AND host IS NOT NULL
            AND owner IS NOT NULL AND trim(owner) <> ''
            AND repo IS NOT NULL AND trim(repo) <> ''
            AND branch IS NOT NULL AND trim(branch) <> '')
        )
      ) STRICT;
CREATE UNIQUE INDEX sessions_local_change
        ON sessions (repo_path, base_ref, head_ref) WHERE kind = 'local';
CREATE UNIQUE INDEX sessions_pull_request
        ON sessions (repo_path, host, owner, repo, pr_number) WHERE kind = 'github-pull-request';
CREATE UNIQUE INDEX sessions_remote_branch
        ON sessions (repo_path, forge, host, owner, repo, branch) WHERE kind = 'remote-branch';
CREATE INDEX sessions_by_recency ON sessions (updated_at DESC);
CREATE TABLE checkpoints (
        id TEXT PRIMARY KEY CHECK (length(id) = 36),
        session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
        base_sha TEXT NOT NULL CHECK (length(base_sha) IN (40, 64) AND base_sha NOT GLOB '*[^0-9a-f]*'),
        head_sha TEXT NOT NULL CHECK (length(head_sha) IN (40, 64) AND head_sha NOT GLOB '*[^0-9a-f]*'),
        created_at TEXT NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z')
      ) STRICT;
CREATE INDEX checkpoints_by_session ON checkpoints (session_id, created_at);
CREATE TABLE file_marks (
        session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
        path TEXT NOT NULL CHECK (path <> ''),
        diff_id TEXT NOT NULL CHECK (length(diff_id) = 64 AND diff_id NOT GLOB '*[^0-9a-f]*'),
        head_sha TEXT NOT NULL CHECK (length(head_sha) IN (40, 64) AND head_sha NOT GLOB '*[^0-9a-f]*'),
        marked_at TEXT NOT NULL CHECK (marked_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
        PRIMARY KEY (session_id, path)
      ) STRICT;
CREATE TABLE ura_items (
        id TEXT PRIMARY KEY CHECK (length(id) = 36),
        session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
        position INTEGER NOT NULL CHECK (position >= 0),
        head_sha TEXT NOT NULL CHECK (length(head_sha) IN (40, 64) AND head_sha NOT GLOB '*[^0-9a-f]*'),
        anchor_kind TEXT NOT NULL CHECK (anchor_kind IN ('lines', 'file', 'change')),
        path TEXT,
        line_start INTEGER,
        line_end INTEGER,
        severity TEXT NOT NULL CHECK (severity IN ('issue', 'suggestion', 'question', 'nitpick', 'thought', 'smell', 'praise', 'note', 'todo', 'chore')),
        blocking INTEGER NOT NULL CHECK (blocking IN (0, 1)),
        origin_kind TEXT NOT NULL
          CHECK (origin_kind IN ('human', 'chat-answer')),
        chat_message_id TEXT,
        chat_finding INTEGER CHECK (chat_finding IS NULL OR chat_finding >= 0),
        chat_proposal INTEGER CHECK (chat_proposal IS NULL OR chat_proposal >= 0),
        title TEXT NOT NULL CHECK (title = trim(title) AND length(title) <= 200),
        body TEXT NOT NULL,
        patch TEXT CHECK (patch IS NULL OR (patch <> '' AND anchor_kind <> 'change')),
        status TEXT NOT NULL CHECK (status IN ('staged', 'withdrawn', 'addressed')),
        addressed_sha TEXT CHECK (addressed_sha IS NULL OR length(addressed_sha) IN (40, 64) AND addressed_sha NOT GLOB '*[^0-9a-f]*'),
        addressed_by TEXT CHECK (addressed_by IS NULL OR addressed_by IN ('reviewer', 'agent')),
        created_at TEXT NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
        updated_at TEXT NOT NULL CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
        -- A note says something: a title is optional, but not all of title, body and patch.
        CHECK (title <> '' OR trim(body) <> '' OR patch IS NOT NULL),
        -- Every branch tests IS NOT NULL first: a NULL comparison would make a CHECK pass.
        CHECK (
          (anchor_kind = 'lines' AND path IS NOT NULL AND path <> ''
            AND line_start IS NOT NULL AND line_end IS NOT NULL
            AND line_start >= 1 AND line_end >= line_start)
          OR (anchor_kind = 'file' AND path IS NOT NULL AND path <> ''
            AND line_start IS NULL AND line_end IS NULL)
          OR (anchor_kind = 'change' AND path IS NULL AND line_start IS NULL AND line_end IS NULL)
        ),
        CHECK (
          (origin_kind = 'human' AND chat_message_id IS NULL AND chat_finding IS NULL
            AND chat_proposal IS NULL)
          OR (origin_kind = 'chat-answer' AND chat_message_id IS NOT NULL
            AND trim(chat_message_id) <> ''
            AND (chat_finding IS NULL) <> (chat_proposal IS NULL)
            AND anchor_kind = 'lines')
        ),
        CHECK (
          (status = 'addressed') = (addressed_sha IS NOT NULL)
          AND (status = 'addressed') = (addressed_by IS NOT NULL)
          AND (addressed_sha IS NULL OR addressed_sha <> head_sha)
        )
      ) STRICT;
CREATE INDEX ura_items_by_session ON ura_items (session_id, position);
CREATE UNIQUE INDEX ura_items_by_chat_finding ON ura_items (chat_message_id, chat_finding)
        WHERE chat_finding IS NOT NULL;
CREATE UNIQUE INDEX ura_items_by_chat_proposal ON ura_items (chat_message_id, chat_proposal)
        WHERE chat_proposal IS NOT NULL;
CREATE TABLE ura_verdict_choices (
        session_id TEXT PRIMARY KEY REFERENCES sessions (id) ON DELETE CASCADE,
        verdict TEXT CHECK (verdict IS NULL OR verdict IN ('approve', 'request-changes', 'comment')),
        cleared_reason TEXT
          CHECK (cleared_reason IS NULL OR cleared_reason IN ('blocking-staged', 'head-moved')),
        head_sha TEXT CHECK (head_sha IS NULL OR (length(head_sha) IN (40, 64) AND head_sha NOT GLOB '*[^0-9a-f]*')),
        updated_at TEXT NOT NULL CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
        CHECK (verdict IS NULL OR cleared_reason IS NULL),
        CHECK ((verdict IS NULL) = (head_sha IS NULL))
      ) STRICT;
CREATE TABLE ura_item_postings (
        item_id TEXT NOT NULL REFERENCES ura_items (id) ON DELETE CASCADE,
        target TEXT NOT NULL CHECK (target IN ('github')),
        session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
        url TEXT NOT NULL CHECK (url GLOB 'http*://*'),
        head_sha TEXT NOT NULL CHECK (length(head_sha) IN (40, 64) AND head_sha NOT GLOB '*[^0-9a-f]*'),
        placement TEXT NOT NULL CHECK (placement IN ('inline', 'body')),
        posted_at TEXT NOT NULL CHECK (posted_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
        PRIMARY KEY (item_id, target)
      ) STRICT;
CREATE INDEX ura_item_postings_by_session ON ura_item_postings (session_id, posted_at);
CREATE TABLE "chat_messages" (
      id TEXT PRIMARY KEY CHECK (length(id) = 36),
      session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
      head_sha TEXT NOT NULL
        CHECK (length(head_sha) IN (40, 64) AND head_sha NOT GLOB '*[^0-9a-f]*'),
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system-notice', 'summary')),
      parts TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(parts) AND json_type(parts) = 'array'),
      citations TEXT NOT NULL DEFAULT '[]'
        CHECK (json_valid(citations) AND json_type(citations) = 'array'),
      status TEXT NOT NULL DEFAULT 'done' CHECK (
        status IN ('queued', 'submitted', 'streaming', 'done', 'error', 'cancelled')
      ),
      kind TEXT NOT NULL DEFAULT 'answer' CHECK (kind IN ('answer', 'review', 'abstract')),
      review TEXT CHECK (review IS NULL OR (json_valid(review) AND json_type(review) = 'object')),
      created_at TEXT NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
      CHECK (role = 'assistant' OR status = 'done'),
      CHECK (role NOT IN ('user', 'summary') OR json_array_length(parts) > 0),
      CHECK (role = 'assistant' OR kind = 'answer'),
      CHECK (review IS NULL OR (kind = 'review' AND status = 'done'))
    ) STRICT;
CREATE INDEX chat_messages_by_session ON chat_messages (session_id, created_at);
CREATE TABLE github_pull_requests (
        host TEXT NOT NULL CHECK (host <> '' AND host NOT GLOB '*[^a-z0-9.-]*'),
        owner TEXT NOT NULL CHECK (owner <> ''),
        repo TEXT NOT NULL CHECK (repo <> ''),
        number INTEGER NOT NULL CHECK (number > 0),
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        author TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('open', 'closed', 'merged')),
        is_draft INTEGER NOT NULL CHECK (is_draft IN (0, 1)),
        html_url TEXT NOT NULL CHECK (html_url GLOB 'https://*'),
        base_branch TEXT NOT NULL CHECK (base_branch <> ''),
        base_sha TEXT NOT NULL CHECK (length(base_sha) IN (40, 64) AND base_sha NOT GLOB '*[^0-9a-f]*'),
        head_branch TEXT NOT NULL,
        head_sha TEXT NOT NULL CHECK (length(head_sha) IN (40, 64) AND head_sha NOT GLOB '*[^0-9a-f]*'),
        is_cross_repository INTEGER NOT NULL CHECK (is_cross_repository IN (0, 1)),
        github_updated_at TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        PRIMARY KEY (host, owner, repo, number)
      ) STRICT;
CREATE TABLE github_branches (
        host TEXT NOT NULL CHECK (host <> '' AND host NOT GLOB '*[^a-z0-9.-]*'),
        owner TEXT NOT NULL CHECK (owner <> ''),
        repo TEXT NOT NULL CHECK (repo <> ''),
        branch TEXT NOT NULL CHECK (branch <> ''),
        default_branch TEXT NOT NULL CHECK (default_branch <> ''),
        html_url TEXT NOT NULL CHECK (html_url GLOB 'https://*'),
        parent_owner TEXT CHECK (parent_owner <> ''),
        parent_repo TEXT CHECK (parent_repo <> ''),
        source_owner TEXT CHECK (source_owner <> ''),
        source_repo TEXT CHECK (source_repo <> ''),
        head_sha TEXT NOT NULL CHECK (length(head_sha) IN (40, 64) AND head_sha NOT GLOB '*[^0-9a-f]*'),
        state TEXT NOT NULL CHECK (state IN ('present', 'gone')),
        pull_owner TEXT CHECK (pull_owner <> ''),
        pull_repo TEXT CHECK (pull_repo <> ''),
        pull_number INTEGER CHECK (pull_number IS NULL OR pull_number > 0),
        fetched_at TEXT NOT NULL,
        PRIMARY KEY (host, owner, repo, branch),
        CHECK ((parent_owner IS NULL) = (parent_repo IS NULL)),
        CHECK ((source_owner IS NULL) = (source_repo IS NULL)),
        CHECK ((pull_owner IS NULL) = (pull_number IS NULL)
          AND (pull_repo IS NULL) = (pull_number IS NULL))
      ) STRICT;
CREATE TABLE review_edit_branches (
        session_id TEXT PRIMARY KEY REFERENCES sessions (id) ON DELETE CASCADE,
        repo_path TEXT NOT NULL CHECK (repo_path <> ''),
        branch TEXT NOT NULL CHECK (branch <> '' AND branch NOT GLOB '-*'),
        base_sha TEXT NOT NULL CHECK (length(base_sha) IN (40, 64) AND base_sha NOT GLOB '*[^0-9a-f]*'),
        created_at TEXT NOT NULL CHECK (created_at <> ''),
        UNIQUE (repo_path, branch)
      ) STRICT;
CREATE TABLE review_edit_suggestions (
        session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
        head_sha TEXT NOT NULL CHECK (length(head_sha) IN (40, 64) AND head_sha NOT GLOB '*[^0-9a-f]*'),
        target TEXT NOT NULL CHECK (target <> ''),
        item_id TEXT NOT NULL REFERENCES ura_items (id) ON DELETE CASCADE,
        fingerprint TEXT NOT NULL CHECK (fingerprint <> ''),
        PRIMARY KEY (session_id, head_sha, target)
      ) STRICT;
CREATE TABLE setup_commands (
        repository TEXT PRIMARY KEY CHECK (repository <> '' AND repository = lower(repository)),
        command TEXT NOT NULL CHECK (command <> ''),
        updated_at TEXT NOT NULL CHECK (updated_at <> '')
      ) STRICT;
CREATE TABLE setup_runs (
        session_id TEXT PRIMARY KEY REFERENCES sessions (id) ON DELETE CASCADE,
        head_sha TEXT NOT NULL CHECK (length(head_sha) IN (40, 64) AND head_sha NOT GLOB '*[^0-9a-f]*'),
        checkout TEXT NOT NULL CHECK (checkout <> ''),
        finished_at TEXT NOT NULL CHECK (finished_at <> '')
      ) STRICT;
CREATE INDEX setup_runs_checkout ON setup_runs (checkout);
INSERT INTO "schema_migrations" ("id", "applied_at") VALUES ('session-0001-initial', '2026-11-11T12:00:00.000Z');
INSERT INTO "schema_migrations" ("id", "applied_at") VALUES ('ura-0001-initial', '2026-11-11T12:00:00.000Z');
INSERT INTO "schema_migrations" ("id", "applied_at") VALUES ('chat-0001-initial', '2026-11-11T12:00:00.000Z');
INSERT INTO "schema_migrations" ("id", "applied_at") VALUES ('chat-0002-message-parts', '2026-11-11T12:00:00.000Z');
INSERT INTO "schema_migrations" ("id", "applied_at") VALUES ('github-0001-initial', '2026-11-11T12:00:00.000Z');
INSERT INTO "schema_migrations" ("id", "applied_at") VALUES ('review-edits-0001-initial', '2026-11-11T12:00:00.000Z');
INSERT INTO "schema_migrations" ("id", "applied_at") VALUES ('setup-0001-initial', '2026-11-11T12:00:00.000Z');
INSERT INTO "schema_migrations" ("id", "applied_at") VALUES ('trust-0002-drop-grants', '2026-11-11T12:00:00.000Z');
INSERT INTO "schema_migrations" ("id", "applied_at") VALUES ('ura-0002-drop-impact-findings', '2026-11-11T12:00:00.000Z');
INSERT INTO "sessions" ("id", "kind", "repo_path", "base_ref", "head_ref", "owner", "repo", "pr_number", "head_sha", "created_at", "updated_at", "host", "forge", "branch") VALUES ('00000000-0000-4000-8000-000000000001', 'local', '/Users/reviewer/src/café app', 'main', 'feature/notes', NULL, NULL, NULL, '1111111111111111111111111111111111111111', '2026-11-11T12:01:00.000Z', '2026-11-11T12:09:00.000Z', NULL, NULL, NULL);
INSERT INTO "sessions" ("id", "kind", "repo_path", "base_ref", "head_ref", "owner", "repo", "pr_number", "head_sha", "created_at", "updated_at", "host", "forge", "branch") VALUES ('00000000-0000-4000-8000-000000000002', 'github-pull-request', '/Users/reviewer/src/beuve', 'main', NULL, 'octo', 'beuve', 42, '2222222222222222222222222222222222222222', '2026-11-11T12:02:00.000Z', '2026-11-11T12:08:00.000Z', 'github.com', NULL, NULL);
INSERT INTO "sessions" ("id", "kind", "repo_path", "base_ref", "head_ref", "owner", "repo", "pr_number", "head_sha", "created_at", "updated_at", "host", "forge", "branch") VALUES ('00000000-0000-4000-8000-000000000003', 'remote-branch', '/Users/reviewer/src/other', 'origin/main', NULL, 'octo', 'other', NULL, '3333333333333333333333333333333333333333333333333333333333333333', '2026-11-11T12:03:00.000Z', '2026-11-11T12:07:00.000Z', 'github.com', 'github', 'topic/fix');
INSERT INTO "checkpoints" ("id", "session_id", "base_sha", "head_sha", "created_at") VALUES ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000001', '9999999999999999999999999999999999999999', '1111111111111111111111111111111111111111', '2026-11-11T12:01:00.000Z');
INSERT INTO "checkpoints" ("id", "session_id", "base_sha", "head_sha", "created_at") VALUES ('00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000002', '9999999999999999999999999999999999999999', '4444444444444444444444444444444444444444', '2026-11-11T12:02:00.000Z');
INSERT INTO "checkpoints" ("id", "session_id", "base_sha", "head_sha", "created_at") VALUES ('00000000-0000-4000-8000-000000000013', '00000000-0000-4000-8000-000000000002', '9999999999999999999999999999999999999999', '2222222222222222222222222222222222222222', '2026-11-11T12:06:00.000Z');
INSERT INTO "checkpoints" ("id", "session_id", "base_sha", "head_sha", "created_at") VALUES ('00000000-0000-4000-8000-000000000014', '00000000-0000-4000-8000-000000000003', '9999999999999999999999999999999999999999999999999999999999999999', '3333333333333333333333333333333333333333333333333333333333333333', '2026-11-11T12:03:00.000Z');
INSERT INTO "file_marks" ("session_id", "path", "diff_id", "head_sha", "marked_at") VALUES ('00000000-0000-4000-8000-000000000001', 'src/a.ts', '5555555555555555555555555555555555555555555555555555555555555555', '1111111111111111111111111111111111111111', '2026-11-11T12:04:00.000Z');
INSERT INTO "file_marks" ("session_id", "path", "diff_id", "head_sha", "marked_at") VALUES ('00000000-0000-4000-8000-000000000002', 'docs/read me.md', '6666666666666666666666666666666666666666666666666666666666666666', '2222222222222222222222222222222222222222', '2026-11-11T12:06:00.000Z');
INSERT INTO "ura_items" ("id", "session_id", "position", "head_sha", "anchor_kind", "path", "line_start", "line_end", "severity", "blocking", "origin_kind", "chat_message_id", "chat_finding", "chat_proposal", "title", "body", "patch", "status", "addressed_sha", "addressed_by", "created_at", "updated_at") VALUES ('00000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-000000000001', 0, '1111111111111111111111111111111111111111', 'lines', 'src/a.ts', 3, 3, 'issue', 1, 'human', NULL, NULL, NULL, 'Off by one', 'The loop stops one short.', '--- a/src/a.ts
+++ b/src/a.ts
@@ -3,1 +3,1 @@
-  for (let i = 0; i < n - 1; i++) {
+  for (let i = 0; i < n; i++) {
', 'staged', NULL, NULL, '2026-11-11T12:04:00.000Z', '2026-11-11T12:04:00.000Z');
INSERT INTO "ura_items" ("id", "session_id", "position", "head_sha", "anchor_kind", "path", "line_start", "line_end", "severity", "blocking", "origin_kind", "chat_message_id", "chat_finding", "chat_proposal", "title", "body", "patch", "status", "addressed_sha", "addressed_by", "created_at", "updated_at") VALUES ('00000000-0000-4000-8000-000000000022', '00000000-0000-4000-8000-000000000001', 1, '1111111111111111111111111111111111111111', 'file', 'README.md', NULL, NULL, 'suggestion', 0, 'human', NULL, NULL, NULL, '', 'Mention the --verbose flag.', NULL, 'staged', NULL, NULL, '2026-11-11T12:04:00.000Z', '2026-11-11T12:05:00.000Z');
INSERT INTO "ura_items" ("id", "session_id", "position", "head_sha", "anchor_kind", "path", "line_start", "line_end", "severity", "blocking", "origin_kind", "chat_message_id", "chat_finding", "chat_proposal", "title", "body", "patch", "status", "addressed_sha", "addressed_by", "created_at", "updated_at") VALUES ('00000000-0000-4000-8000-000000000023', '00000000-0000-4000-8000-000000000001', 2, '1111111111111111111111111111111111111111', 'change', NULL, NULL, NULL, 'praise', 0, 'human', NULL, NULL, NULL, 'Clear tests', '', NULL, 'withdrawn', NULL, NULL, '2026-11-11T12:04:00.000Z', '2026-11-11T12:06:00.000Z');
INSERT INTO "ura_items" ("id", "session_id", "position", "head_sha", "anchor_kind", "path", "line_start", "line_end", "severity", "blocking", "origin_kind", "chat_message_id", "chat_finding", "chat_proposal", "title", "body", "patch", "status", "addressed_sha", "addressed_by", "created_at", "updated_at") VALUES ('00000000-0000-4000-8000-000000000024', '00000000-0000-4000-8000-000000000001', 3, '1111111111111111111111111111111111111111', 'lines', 'src/b.ts', 10, 14, 'todo', 1, 'human', NULL, NULL, NULL, 'Handle the empty list', '', NULL, 'staged', NULL, NULL, '2026-11-11T12:05:00.000Z', '2026-11-11T12:05:00.000Z');
INSERT INTO "ura_items" ("id", "session_id", "position", "head_sha", "anchor_kind", "path", "line_start", "line_end", "severity", "blocking", "origin_kind", "chat_message_id", "chat_finding", "chat_proposal", "title", "body", "patch", "status", "addressed_sha", "addressed_by", "created_at", "updated_at") VALUES ('00000000-0000-4000-8000-000000000025', '00000000-0000-4000-8000-000000000002', 0, '4444444444444444444444444444444444444444', 'lines', 'src/a.ts', 3, 5, 'question', 0, 'chat-answer', '00000000-0000-4000-8000-000000000034', 0, NULL, 'Can n be zero?', 'An empty input skips the loop.', NULL, 'addressed', '2222222222222222222222222222222222222222', 'agent', '2026-11-11T12:03:00.000Z', '2026-11-11T12:06:00.000Z');
INSERT INTO "ura_items" ("id", "session_id", "position", "head_sha", "anchor_kind", "path", "line_start", "line_end", "severity", "blocking", "origin_kind", "chat_message_id", "chat_finding", "chat_proposal", "title", "body", "patch", "status", "addressed_sha", "addressed_by", "created_at", "updated_at") VALUES ('00000000-0000-4000-8000-000000000026', '00000000-0000-4000-8000-000000000002', 1, '4444444444444444444444444444444444444444', 'lines', 'src/c.ts', 1, 2, 'nitpick', 0, 'chat-answer', '00000000-0000-4000-8000-000000000032', NULL, 0, 'Name the constant', 'magic number', NULL, 'addressed', '2222222222222222222222222222222222222222', 'reviewer', '2026-11-11T12:03:00.000Z', '2026-11-11T12:06:00.000Z');
INSERT INTO "ura_items" ("id", "session_id", "position", "head_sha", "anchor_kind", "path", "line_start", "line_end", "severity", "blocking", "origin_kind", "chat_message_id", "chat_finding", "chat_proposal", "title", "body", "patch", "status", "addressed_sha", "addressed_by", "created_at", "updated_at") VALUES ('00000000-0000-4000-8000-000000000027', '00000000-0000-4000-8000-000000000002', 2, '2222222222222222222222222222222222222222', 'lines', 'src/c.ts', 8, 8, 'smell', 0, 'chat-answer', '00000000-0000-4000-8000-000000000034', 1, NULL, '', 'This retries forever.', NULL, 'staged', NULL, NULL, '2026-11-11T12:06:00.000Z', '2026-11-11T12:06:00.000Z');
INSERT INTO "ura_items" ("id", "session_id", "position", "head_sha", "anchor_kind", "path", "line_start", "line_end", "severity", "blocking", "origin_kind", "chat_message_id", "chat_finding", "chat_proposal", "title", "body", "patch", "status", "addressed_sha", "addressed_by", "created_at", "updated_at") VALUES ('00000000-0000-4000-8000-000000000028', '00000000-0000-4000-8000-000000000002', 3, '2222222222222222222222222222222222222222', 'change', NULL, NULL, NULL, 'chore', 1, 'human', NULL, NULL, NULL, 'Update the changelog', '', NULL, 'staged', NULL, NULL, '2026-11-11T12:07:00.000Z', '2026-11-11T12:07:00.000Z');
INSERT INTO "ura_items" ("id", "session_id", "position", "head_sha", "anchor_kind", "path", "line_start", "line_end", "severity", "blocking", "origin_kind", "chat_message_id", "chat_finding", "chat_proposal", "title", "body", "patch", "status", "addressed_sha", "addressed_by", "created_at", "updated_at") VALUES ('00000000-0000-4000-8000-000000000029', '00000000-0000-4000-8000-000000000003', 0, '3333333333333333333333333333333333333333333333333333333333333333', 'file', 'Makefile', NULL, NULL, 'thought', 0, 'human', NULL, NULL, NULL, '', 'Could this target be phony?', NULL, 'staged', NULL, NULL, '2026-11-11T12:07:00.000Z', '2026-11-11T12:07:00.000Z');
INSERT INTO "ura_items" ("id", "session_id", "position", "head_sha", "anchor_kind", "path", "line_start", "line_end", "severity", "blocking", "origin_kind", "chat_message_id", "chat_finding", "chat_proposal", "title", "body", "patch", "status", "addressed_sha", "addressed_by", "created_at", "updated_at") VALUES ('00000000-0000-4000-8000-000000000030', '00000000-0000-4000-8000-000000000003', 1, '3333333333333333333333333333333333333333333333333333333333333333', 'lines', 'lib/ünï.c', 2, 4, 'note', 0, 'human', NULL, NULL, NULL, 'Mind the locale', '', NULL, 'withdrawn', NULL, NULL, '2026-11-11T12:07:00.000Z', '2026-11-11T12:08:00.000Z');
INSERT INTO "ura_verdict_choices" ("session_id", "verdict", "cleared_reason", "head_sha", "updated_at") VALUES ('00000000-0000-4000-8000-000000000001', 'request-changes', NULL, '1111111111111111111111111111111111111111', '2026-11-11T12:05:00.000Z');
INSERT INTO "ura_verdict_choices" ("session_id", "verdict", "cleared_reason", "head_sha", "updated_at") VALUES ('00000000-0000-4000-8000-000000000002', NULL, 'head-moved', NULL, '2026-11-11T12:06:00.000Z');
INSERT INTO "ura_verdict_choices" ("session_id", "verdict", "cleared_reason", "head_sha", "updated_at") VALUES ('00000000-0000-4000-8000-000000000003', NULL, 'blocking-staged', NULL, '2026-11-11T12:07:00.000Z');
INSERT INTO "ura_item_postings" ("item_id", "target", "session_id", "url", "head_sha", "placement", "posted_at") VALUES ('00000000-0000-4000-8000-000000000025', 'github', '00000000-0000-4000-8000-000000000002', 'https://github.com/octo/beuve/pull/42#discussion_r1', '4444444444444444444444444444444444444444', 'inline', '2026-11-11T12:05:00.000Z');
INSERT INTO "ura_item_postings" ("item_id", "target", "session_id", "url", "head_sha", "placement", "posted_at") VALUES ('00000000-0000-4000-8000-000000000026', 'github', '00000000-0000-4000-8000-000000000002', 'https://github.com/octo/beuve/pull/42#pullrequestreview-2', '4444444444444444444444444444444444444444', 'body', '2026-11-11T12:05:00.000Z');
INSERT INTO "chat_messages" ("id", "session_id", "head_sha", "role", "parts", "citations", "status", "kind", "review", "created_at") VALUES ('00000000-0000-4000-8000-000000000031', '00000000-0000-4000-8000-000000000002', '4444444444444444444444444444444444444444', 'user', '[{"kind":"text","id":"p1","text":"Why does "},{"kind":"mention","id":"p2","mention":{"path":"src/a.ts","side":"head","startLine":3,"endLine":5,"sha":"4444444444444444444444444444444444444444"}},{"kind":"text","id":"p3","text":" stop early? It''s odd."}]', '[]', 'done', 'answer', NULL, '2026-11-11T12:03:00.000Z');
INSERT INTO "chat_messages" ("id", "session_id", "head_sha", "role", "parts", "citations", "status", "kind", "review", "created_at") VALUES ('00000000-0000-4000-8000-000000000032', '00000000-0000-4000-8000-000000000002', '4444444444444444444444444444444444444444', 'assistant', '[{"kind":"reasoning","id":"p1","state":"done","summary":"Reading the loop"},{"kind":"tool-call","id":"p2","tool":"Read","description":"read src/a.ts","state":"done"},{"kind":"text","id":"p3","text":"It stops at n - 1 [[src/a.ts:3-5]]."},{"kind":"proposal","id":"p4","proposal":0,"note":{"path":"src/c.ts","startLine":1,"endLine":2,"label":"nitpick","blocking":false,"title":"Name the constant","body":"magic number"}},{"kind":"dropped-proposal","id":"p5","reason":"outside-diff"}]', '[{"path":"src/a.ts","startLine":3,"endLine":5,"side":"head"}]', 'done', 'answer', NULL, '2026-11-11T12:03:00.000Z');
INSERT INTO "chat_messages" ("id", "session_id", "head_sha", "role", "parts", "citations", "status", "kind", "review", "created_at") VALUES ('00000000-0000-4000-8000-000000000033', '00000000-0000-4000-8000-000000000002', '4444444444444444444444444444444444444444', 'user', '[{"kind":"text","id":"p1","text":"/review src/"}]', '[]', 'done', 'answer', NULL, '2026-11-11T12:03:00.000Z');
INSERT INTO "chat_messages" ("id", "session_id", "head_sha", "role", "parts", "citations", "status", "kind", "review", "created_at") VALUES ('00000000-0000-4000-8000-000000000034', '00000000-0000-4000-8000-000000000002', '4444444444444444444444444444444444444444', 'assistant', '[{"kind":"tool-call","id":"p1","tool":"Grep","description":"search for n","state":"failed"},{"kind":"finding","id":"p2","finding":0},{"kind":"finding","id":"p3","finding":1}]', '[]', 'done', 'review', '{"findings":[{"path":"src/a.ts","startLine":3,"endLine":5,"severity":"risk","category":"edge-case","title":"Can n be zero?","body":"An empty input skips the loop.","confidence":0.9,"check":"confirmed"},{"path":"src/a.ts","startLine":8,"endLine":8,"severity":"info","category":"other","title":"Can n be zero?","body":"An empty input skips the loop.","confidence":0.9,"check":"unchecked"}],"dropped":{"unknownFile":0,"outsideDiff":1,"lowConfidence":2,"duplicate":0,"overLimit":0,"unconfirmed":1},"pathScope":["src/"],"fileCount":3,"verification":"verified"}', '2026-11-11T12:03:00.000Z');
INSERT INTO "chat_messages" ("id", "session_id", "head_sha", "role", "parts", "citations", "status", "kind", "review", "created_at") VALUES ('00000000-0000-4000-8000-000000000035', '00000000-0000-4000-8000-000000000002', '2222222222222222222222222222222222222222', 'system-notice', '[{"kind":"text","id":"p1","text":"The head moved to a new commit."}]', '[]', 'done', 'answer', NULL, '2026-11-11T12:06:00.000Z');
INSERT INTO "chat_messages" ("id", "session_id", "head_sha", "role", "parts", "citations", "status", "kind", "review", "created_at") VALUES ('00000000-0000-4000-8000-000000000036', '00000000-0000-4000-8000-000000000002', '2222222222222222222222222222222222222222', 'summary', '[{"kind":"text","id":"p1","text":"Earlier: the loop bound and the constant."}]', '[]', 'done', 'answer', NULL, '2026-11-11T12:06:00.000Z');
INSERT INTO "chat_messages" ("id", "session_id", "head_sha", "role", "parts", "citations", "status", "kind", "review", "created_at") VALUES ('00000000-0000-4000-8000-000000000037', '00000000-0000-4000-8000-000000000002', '2222222222222222222222222222222222222222', 'assistant', '[{"kind":"text","id":"p1","text":"Looking"},{"kind":"error","id":"p2","code":"timeout"}]', '[]', 'error', 'answer', NULL, '2026-11-11T12:07:00.000Z');
INSERT INTO "chat_messages" ("id", "session_id", "head_sha", "role", "parts", "citations", "status", "kind", "review", "created_at") VALUES ('00000000-0000-4000-8000-000000000038', '00000000-0000-4000-8000-000000000001', '1111111111111111111111111111111111111111', 'assistant', '[{"kind":"tool-call","id":"p1","tool":"Read","description":"read b.ts","state":"stopped"}]', '[]', 'cancelled', 'answer', NULL, '2026-11-11T12:05:00.000Z');
INSERT INTO "chat_messages" ("id", "session_id", "head_sha", "role", "parts", "citations", "status", "kind", "review", "created_at") VALUES ('00000000-0000-4000-8000-000000000039', '00000000-0000-4000-8000-000000000001', '1111111111111111111111111111111111111111', 'assistant', '[{"kind":"text","id":"p1","text":"Adds notes to the review sheet."}]', '[]', 'done', 'abstract', NULL, '2026-11-11T12:05:00.000Z');
INSERT INTO "chat_messages" ("id", "session_id", "head_sha", "role", "parts", "citations", "status", "kind", "review", "created_at") VALUES ('00000000-0000-4000-8000-000000000040', '00000000-0000-4000-8000-000000000001', '1111111111111111111111111111111111111111', 'assistant', '[{"kind":"reasoning","id":"p1","state":"running"}]', '[]', 'streaming', 'answer', NULL, '2026-11-11T12:06:00.000Z');
INSERT INTO "chat_messages" ("id", "session_id", "head_sha", "role", "parts", "citations", "status", "kind", "review", "created_at") VALUES ('00000000-0000-4000-8000-000000000041', '00000000-0000-4000-8000-000000000001', '1111111111111111111111111111111111111111', 'assistant', '[]', '[]', 'submitted', 'answer', NULL, '2026-11-11T12:06:00.000Z');
INSERT INTO "chat_messages" ("id", "session_id", "head_sha", "role", "parts", "citations", "status", "kind", "review", "created_at") VALUES ('00000000-0000-4000-8000-000000000042', '00000000-0000-4000-8000-000000000001', '1111111111111111111111111111111111111111', 'assistant', '[]', '[]', 'queued', 'review', NULL, '2026-11-11T12:06:00.000Z');
INSERT INTO "github_pull_requests" ("host", "owner", "repo", "number", "title", "body", "author", "state", "is_draft", "html_url", "base_branch", "base_sha", "head_branch", "head_sha", "is_cross_repository", "github_updated_at", "fetched_at") VALUES ('github.com', 'octo', 'beuve', 42, 'Add notes', 'Closes #7.', 'mona', 'open', 0, 'https://github.com/octo/beuve/pull/42', 'main', '9999999999999999999999999999999999999999', 'feature/notes', '2222222222222222222222222222222222222222', 0, '2026-11-10T09:00:00Z', '2026-11-11T12:02:00.000Z');
INSERT INTO "github_pull_requests" ("host", "owner", "repo", "number", "title", "body", "author", "state", "is_draft", "html_url", "base_branch", "base_sha", "head_branch", "head_sha", "is_cross_repository", "github_updated_at", "fetched_at") VALUES ('github.example.com', 'team', 'tool', 7, 'Draft: fork fix', '', 'fork-user', 'merged', 1, 'https://github.example.com/team/tool/pull/7', 'trunk', '8888888888888888888888888888888888888888', 'fix', '7777777777777777777777777777777777777777', 1, '2026-11-09T09:00:00Z', '2026-11-11T12:02:00.000Z');
INSERT INTO "github_branches" ("host", "owner", "repo", "branch", "default_branch", "html_url", "parent_owner", "parent_repo", "source_owner", "source_repo", "head_sha", "state", "pull_owner", "pull_repo", "pull_number", "fetched_at") VALUES ('github.com', 'octo', 'other', 'topic/fix', 'main', 'https://github.com/octo/other/tree/topic/fix', 'upstream', 'other', 'upstream', 'other', '3333333333333333333333333333333333333333333333333333333333333333', 'present', 'upstream', 'other', 12, '2026-11-11T12:03:00.000Z');
INSERT INTO "github_branches" ("host", "owner", "repo", "branch", "default_branch", "html_url", "parent_owner", "parent_repo", "source_owner", "source_repo", "head_sha", "state", "pull_owner", "pull_repo", "pull_number", "fetched_at") VALUES ('github.com', 'octo', 'other', 'old', 'main', 'https://github.com/octo/other/tree/old', NULL, NULL, NULL, NULL, '6666666666666666666666666666666666666666', 'gone', NULL, NULL, NULL, '2026-11-11T12:03:00.000Z');
INSERT INTO "review_edit_branches" ("session_id", "repo_path", "branch", "base_sha", "created_at") VALUES ('00000000-0000-4000-8000-000000000001', '/Users/reviewer/src/café app', 'review/feature-notes', '1111111111111111111111111111111111111111', '2026-11-11T12:05:00.000Z');
INSERT INTO "review_edit_suggestions" ("session_id", "head_sha", "target", "item_id", "fingerprint") VALUES ('00000000-0000-4000-8000-000000000001', '1111111111111111111111111111111111111111', 'lines:src/a.ts:3-3', '00000000-0000-4000-8000-000000000021', '4444444444444444444444444444444444444444444444444444444444444444');
INSERT INTO "setup_commands" ("repository", "command", "updated_at") VALUES ('github.com/octo/beuve', 'npm ci && npm run build', '2026-11-11T12:02:00.000Z');
INSERT INTO "setup_runs" ("session_id", "head_sha", "checkout", "finished_at") VALUES ('00000000-0000-4000-8000-000000000002', '2222222222222222222222222222222222222222', '/Users/reviewer/Library/beuve/checkouts/2222222222222222222222222222222222222222', '2026-11-11T12:04:00.000Z');
COMMIT;
