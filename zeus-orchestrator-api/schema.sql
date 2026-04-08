CREATE TABLE IF NOT EXISTS workflows (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  metadata_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  client_key TEXT NOT NULL,
  description TEXT NOT NULL,
  agent_role TEXT,
  status TEXT NOT NULL,
  payload_json TEXT,
  result_json TEXT,
  failure_json TEXT,
  claimed_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  claimed_at INTEGER,
  completed_at INTEGER,
  failed_at INTEGER,
  blocked_at INTEGER,
  UNIQUE(workflow_id, client_key)
);

CREATE TABLE IF NOT EXISTS task_dependencies (
  workflow_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  depends_on_task_id TEXT NOT NULL,
  PRIMARY KEY(workflow_id, task_id, depends_on_task_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  sender TEXT NOT NULL,
  type TEXT NOT NULL,
  payload_json TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS task_events (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  task_id TEXT,
  event_type TEXT NOT NULL,
  actor TEXT,
  payload_json TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_workflow_status
  ON tasks(workflow_id, status);

CREATE INDEX IF NOT EXISTS idx_messages_workflow_created_at
  ON messages(workflow_id, created_at);

CREATE INDEX IF NOT EXISTS idx_task_events_workflow_created_at
  ON task_events(workflow_id, created_at);
