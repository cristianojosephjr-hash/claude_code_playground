import { buildSnapshot } from "./workflow-state.mjs";

export async function loadWorkflowSnapshot(db, workflowId) {
  const workflowRow = await db
    .prepare(
      `SELECT id, name, status, metadata_json, created_at, updated_at
       FROM workflows
       WHERE id = ?`,
    )
    .bind(workflowId)
    .first();

  if (!workflowRow) {
    return null;
  }

  const taskResult = await db
    .prepare(
      `SELECT id, workflow_id, client_key, description, agent_role, status, payload_json,
              result_json, failure_json, claimed_by, created_at, updated_at, claimed_at,
              completed_at, failed_at, blocked_at
       FROM tasks
       WHERE workflow_id = ?
       ORDER BY created_at ASC, id ASC`,
    )
    .bind(workflowId)
    .all();

  const dependencyResult = await db
    .prepare(
      `SELECT workflow_id, task_id, depends_on_task_id
       FROM task_dependencies
       WHERE workflow_id = ?`,
    )
    .bind(workflowId)
    .all();

  return buildSnapshot({
    workflow: workflowFromRow(workflowRow),
    tasks: (taskResult.results ?? []).map(taskFromRow),
    dependencyRows: (dependencyResult.results ?? []).map((row) => ({
      workflowId: row.workflow_id,
      taskId: row.task_id,
      dependsOnTaskId: row.depends_on_task_id,
    })),
  });
}

export function workflowInsertStatement(db, workflow) {
  return db
    .prepare(
      `INSERT INTO workflows (id, name, status, metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      workflow.id,
      workflow.name,
      workflow.status,
      toJsonColumn(workflow.metadata),
      workflow.createdAt,
      workflow.updatedAt,
    );
}

export function workflowUpdateStatement(db, workflow) {
  return db
    .prepare(
      `UPDATE workflows
       SET name = ?, status = ?, metadata_json = ?, updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      workflow.name,
      workflow.status,
      toJsonColumn(workflow.metadata),
      workflow.updatedAt,
      workflow.id,
    );
}

export function taskInsertStatement(db, task) {
  return db
    .prepare(
      `INSERT INTO tasks (
        id, workflow_id, client_key, description, agent_role, status, payload_json,
        result_json, failure_json, claimed_by, created_at, updated_at, claimed_at,
        completed_at, failed_at, blocked_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      task.id,
      task.workflowId,
      task.clientKey,
      task.description,
      task.agentRole,
      task.status,
      toJsonColumn(task.payload),
      toJsonColumn(task.result),
      toJsonColumn(task.failure),
      task.claimedBy,
      task.createdAt,
      task.updatedAt,
      task.claimedAt,
      task.completedAt,
      task.failedAt,
      task.blockedAt,
    );
}

export function taskUpdateStatement(db, task) {
  return db
    .prepare(
      `UPDATE tasks
       SET agent_role = ?, status = ?, payload_json = ?, result_json = ?, failure_json = ?,
           claimed_by = ?, updated_at = ?, claimed_at = ?, completed_at = ?, failed_at = ?,
           blocked_at = ?
       WHERE id = ? AND workflow_id = ?`,
    )
    .bind(
      task.agentRole,
      task.status,
      toJsonColumn(task.payload),
      toJsonColumn(task.result),
      toJsonColumn(task.failure),
      task.claimedBy,
      task.updatedAt,
      task.claimedAt,
      task.completedAt,
      task.failedAt,
      task.blockedAt,
      task.id,
      task.workflowId,
    );
}

export function dependencyInsertStatement(db, dependencyRow) {
  return db
    .prepare(
      `INSERT INTO task_dependencies (workflow_id, task_id, depends_on_task_id)
       VALUES (?, ?, ?)`,
    )
    .bind(dependencyRow.workflowId, dependencyRow.taskId, dependencyRow.dependsOnTaskId);
}

export function taskEventInsertStatement(db, event) {
  return db
    .prepare(
      `INSERT INTO task_events (id, workflow_id, task_id, event_type, actor, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      event.id,
      event.workflowId,
      event.taskId,
      event.eventType,
      event.actor,
      toJsonColumn(event.payload),
      event.createdAt,
    );
}

export function messageInsertStatement(db, message) {
  return db
    .prepare(
      `INSERT INTO messages (id, workflow_id, sender, type, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      message.id,
      message.workflowId,
      message.sender,
      message.type,
      toJsonColumn(message.payload),
      message.createdAt,
    );
}

export async function readMessages(db, workflowId, limit) {
  const result = await db
    .prepare(
      `SELECT id, workflow_id, sender, type, payload_json, created_at
       FROM messages
       WHERE workflow_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
    )
    .bind(workflowId, limit)
    .all();

  return (result.results ?? [])
    .map((row) => ({
      id: row.id,
      workflowId: row.workflow_id,
      sender: row.sender,
      type: row.type,
      payload: fromJsonColumn(row.payload_json),
      createdAt: row.created_at,
    }))
    .reverse();
}

function workflowFromRow(row) {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    metadata: fromJsonColumn(row.metadata_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function taskFromRow(row) {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    clientKey: row.client_key,
    description: row.description,
    agentRole: row.agent_role,
    status: row.status,
    payload: fromJsonColumn(row.payload_json),
    result: fromJsonColumn(row.result_json),
    failure: fromJsonColumn(row.failure_json),
    claimedBy: row.claimed_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    claimedAt: row.claimed_at,
    completedAt: row.completed_at,
    failedAt: row.failed_at,
    blockedAt: row.blocked_at,
  };
}

function toJsonColumn(value) {
  return value == null ? null : JSON.stringify(value);
}

function fromJsonColumn(value) {
  if (value == null || value === "") {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
