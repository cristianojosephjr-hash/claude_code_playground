const STATUS = Object.freeze({
  PENDING: "pending",
  READY: "ready",
  CLAIMED: "claimed",
  COMPLETED: "completed",
  FAILED: "failed",
  BLOCKED: "blocked",
});

export { STATUS as TASK_STATUS };

export class WorkflowStateError extends Error {
  constructor(status, code, message, details = null) {
    super(message);
    this.name = "WorkflowStateError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function createWorkflowRecord({ workflowId, name, metadata = null, now }) {
  const trimmedName = typeof name === "string" ? name.trim() : "";
  if (!trimmedName) {
    throw new WorkflowStateError(400, "invalid_workflow_name", "Workflow name is required.");
  }

  return {
    id: workflowId,
    name: trimmedName,
    status: "active",
    metadata: cloneJson(metadata),
    createdAt: now,
    updatedAt: now,
  };
}

export function buildSnapshot({ workflow, tasks = [], dependencyRows = [] }) {
  const clonedTasks = tasks.map((task) => ({ ...task }));
  const dependenciesByTaskId = {};
  const dependentsByTaskId = {};

  for (const task of clonedTasks) {
    dependenciesByTaskId[task.id] = [];
    dependentsByTaskId[task.id] = [];
  }

  for (const row of dependencyRows) {
    if (!dependenciesByTaskId[row.taskId]) {
      dependenciesByTaskId[row.taskId] = [];
    }
    if (!dependentsByTaskId[row.dependsOnTaskId]) {
      dependentsByTaskId[row.dependsOnTaskId] = [];
    }
    dependenciesByTaskId[row.taskId].push(row.dependsOnTaskId);
    dependentsByTaskId[row.dependsOnTaskId].push(row.taskId);
  }

  const readyTaskIds = clonedTasks
    .filter((task) => task.status === STATUS.READY)
    .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
    .map((task) => task.id);

  return {
    workflow: { ...workflow },
    tasks: clonedTasks,
    dependencyRows: dependencyRows.map((row) => ({ ...row })),
    dependenciesByTaskId,
    dependentsByTaskId,
    readyTaskIds,
  };
}

export function normalizeBulkTasks(snapshot, rawTasks, { now, idFactory }) {
  const inputTasks = validateRawTasks(rawTasks);
  const existingByClientKey = buildTaskMap(snapshot.tasks, "clientKey");
  const existingById = buildTaskMap(snapshot.tasks, "id");
  const dependencyGraph = buildDependencyGraph(snapshot, existingById);
  const seenInputKeys = new Set();

  for (const task of inputTasks) {
    if (existingByClientKey.has(task.clientKey) || seenInputKeys.has(task.clientKey)) {
      throw new WorkflowStateError(
        409,
        "duplicate_client_key",
        `Task clientKey '${task.clientKey}' is duplicated.`,
      );
    }
    seenInputKeys.add(task.clientKey);
  }

  const futureTasksByClientKey = new Map(existingByClientKey);
  const createdTasks = inputTasks.map((task) => {
    const createdTask = {
      id: idFactory(),
      workflowId: snapshot.workflow.id,
      clientKey: task.clientKey,
      description: task.description,
      agentRole: task.agentRole,
      status: STATUS.PENDING,
      payload: cloneJson(task.payload),
      result: null,
      failure: null,
      claimedBy: null,
      createdAt: now,
      updatedAt: now,
      claimedAt: null,
      completedAt: null,
      failedAt: null,
      blockedAt: null,
    };
    futureTasksByClientKey.set(task.clientKey, createdTask);
    return createdTask;
  });

  for (const task of inputTasks) {
    dependencyGraph.set(task.clientKey, [...task.dependencies]);
  }

  validateDependencyKeys(dependencyGraph, futureTasksByClientKey);
  detectCycles(dependencyGraph);

  const dependencyRows = [];
  for (const inputTask of inputTasks) {
    const createdTask = futureTasksByClientKey.get(inputTask.clientKey);
    const dependencyIds = inputTask.dependencies.map(
      (dependencyKey) => futureTasksByClientKey.get(dependencyKey).id,
    );

    for (const dependencyId of dependencyIds) {
      dependencyRows.push({
        workflowId: snapshot.workflow.id,
        taskId: createdTask.id,
        dependsOnTaskId: dependencyId,
      });
    }

    const isReady = dependencyIds.every((dependencyId) => {
      const dependencyTask = futureTasksByClientKey.get(findClientKeyByTaskId(futureTasksByClientKey, dependencyId));
      return dependencyTask.status === STATUS.COMPLETED;
    });
    createdTask.status = isReady ? STATUS.READY : STATUS.PENDING;
  }

  const nextTasks = [...snapshot.tasks, ...createdTasks];
  const nextDependencyRows = [...snapshot.dependencyRows, ...dependencyRows];
  const workflow = withWorkflowStatus(snapshot.workflow, nextTasks, now);
  const nextSnapshot = buildSnapshot({
    workflow,
    tasks: nextTasks,
    dependencyRows: nextDependencyRows,
  });

  return {
    snapshot: nextSnapshot,
    createdTasks,
    dependencyRows,
    taskEvents: createdTasks.map((task) =>
      createTaskEvent({
        workflowId: snapshot.workflow.id,
        taskId: task.id,
        eventType: "task.created",
        actor: task.agentRole,
        payload: {
          clientKey: task.clientKey,
          dependencies: nextSnapshot.dependenciesByTaskId[task.id] ?? [],
        },
        now,
        idFactory,
      }),
    ),
  };
}

export function claimTask(snapshot, taskId, payload, { now, idFactory }) {
  const task = findTaskById(snapshot, taskId);
  if (task.status !== STATUS.READY) {
    throw new WorkflowStateError(
      409,
      "task_not_ready",
      `Task '${taskId}' must be ready before it can be claimed.`,
      { currentStatus: task.status },
    );
  }

  const agentRole = typeof payload.agentRole === "string" ? payload.agentRole.trim() : "";
  if (!agentRole) {
    throw new WorkflowStateError(400, "invalid_agent_role", "agentRole is required.");
  }

  const claimedBy = typeof payload.agentId === "string" && payload.agentId.trim()
    ? payload.agentId.trim()
    : agentRole;

  const updatedTask = {
    ...task,
    agentRole,
    claimedBy,
    status: STATUS.CLAIMED,
    claimedAt: now,
    updatedAt: now,
  };

  return finalizeTransition(snapshot, replaceTask(snapshot.tasks, updatedTask), now, [
    createTaskEvent({
      workflowId: snapshot.workflow.id,
      taskId,
      eventType: "task.claimed",
      actor: claimedBy,
      payload: { agentRole },
      now,
      idFactory,
    }),
  ]);
}

export function completeTask(snapshot, taskId, payload, { now, idFactory }) {
  const task = findTaskById(snapshot, taskId);
  if (task.status !== STATUS.CLAIMED) {
    throw new WorkflowStateError(
      409,
      "task_not_claimed",
      `Task '${taskId}' must be claimed before it can be completed.`,
      { currentStatus: task.status },
    );
  }

  const completedTask = {
    ...task,
    status: STATUS.COMPLETED,
    result: cloneJson(payload.result),
    completedAt: now,
    updatedAt: now,
  };

  let nextTasks = replaceTask(snapshot.tasks, completedTask);
  const taskMap = buildTaskMap(nextTasks, "id");
  const unlockedEvents = [];

  for (const candidate of nextTasks) {
    if (candidate.status !== STATUS.PENDING) {
      continue;
    }
    const dependencyIds = snapshot.dependenciesByTaskId[candidate.id] ?? [];
    if (dependencyIds.length === 0 || dependencyIds.every((dependencyId) => taskMap.get(dependencyId)?.status === STATUS.COMPLETED)) {
      const readyTask = {
        ...candidate,
        status: STATUS.READY,
        updatedAt: now,
      };
      nextTasks = replaceTask(nextTasks, readyTask);
      taskMap.set(readyTask.id, readyTask);
      unlockedEvents.push(
        createTaskEvent({
          workflowId: snapshot.workflow.id,
          taskId: readyTask.id,
          eventType: "task.ready",
          actor: "system",
          payload: { unlockedByTaskId: taskId },
          now,
          idFactory,
        }),
      );
    }
  }

  return finalizeTransition(snapshot, nextTasks, now, [
    createTaskEvent({
      workflowId: snapshot.workflow.id,
      taskId,
      eventType: "task.completed",
      actor: completedTask.claimedBy,
      payload: { result: completedTask.result },
      now,
      idFactory,
    }),
    ...unlockedEvents,
  ]);
}

export function failTask(snapshot, taskId, payload, { now, idFactory }) {
  const task = findTaskById(snapshot, taskId);
  if (task.status !== STATUS.CLAIMED) {
    throw new WorkflowStateError(
      409,
      "task_not_claimed",
      `Task '${taskId}' must be claimed before it can fail.`,
      { currentStatus: task.status },
    );
  }

  const failure = normalizeFailure(payload.error);
  let nextTasks = replaceTask(snapshot.tasks, {
    ...task,
    status: STATUS.FAILED,
    failure,
    failedAt: now,
    updatedAt: now,
  });
  const taskMap = buildTaskMap(nextTasks, "id");
  const queue = [...(snapshot.dependentsByTaskId[taskId] ?? [])];
  const taskEvents = [
    createTaskEvent({
      workflowId: snapshot.workflow.id,
      taskId,
      eventType: "task.failed",
      actor: task.claimedBy,
      payload: { error: failure },
      now,
      idFactory,
    }),
  ];

  while (queue.length > 0) {
    const currentId = queue.shift();
    const currentTask = taskMap.get(currentId);
    if (!currentTask) {
      continue;
    }
    if (
      currentTask.status === STATUS.COMPLETED ||
      currentTask.status === STATUS.FAILED ||
      currentTask.status === STATUS.BLOCKED
    ) {
      continue;
    }

    const blockedTask = {
      ...currentTask,
      status: STATUS.BLOCKED,
      blockedAt: now,
      updatedAt: now,
    };
    nextTasks = replaceTask(nextTasks, blockedTask);
    taskMap.set(blockedTask.id, blockedTask);
    taskEvents.push(
      createTaskEvent({
        workflowId: snapshot.workflow.id,
        taskId: blockedTask.id,
        eventType: "task.blocked",
        actor: "system",
        payload: { blockedByTaskId: taskId },
        now,
        idFactory,
      }),
    );

    for (const dependentId of snapshot.dependentsByTaskId[currentId] ?? []) {
      queue.push(dependentId);
    }
  }

  return finalizeTransition(snapshot, nextTasks, now, taskEvents);
}

export function createMessageRecord({ workflowId, from, type, payload = null, now, idFactory }) {
  const sender = typeof from === "string" ? from.trim() : "";
  const messageType = typeof type === "string" ? type.trim() : "";
  if (!sender) {
    throw new WorkflowStateError(400, "invalid_message_sender", "Message 'from' is required.");
  }
  if (!messageType) {
    throw new WorkflowStateError(400, "invalid_message_type", "Message 'type' is required.");
  }

  return {
    id: idFactory(),
    workflowId,
    sender,
    type: messageType,
    payload: cloneJson(payload),
    createdAt: now,
  };
}

export function serializeSnapshot(snapshot) {
  return {
    workflow: {
      id: snapshot.workflow.id,
      name: snapshot.workflow.name,
      status: snapshot.workflow.status,
      metadata: snapshot.workflow.metadata,
      createdAt: snapshot.workflow.createdAt,
      updatedAt: snapshot.workflow.updatedAt,
    },
    tasks: snapshot.tasks
      .slice()
      .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
      .map((task) => ({
        id: task.id,
        workflowId: task.workflowId,
        clientKey: task.clientKey,
        description: task.description,
        agentRole: task.agentRole,
        status: task.status,
        payload: task.payload,
        result: task.result,
        failure: task.failure,
        claimedBy: task.claimedBy,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
        claimedAt: task.claimedAt,
        completedAt: task.completedAt,
        failedAt: task.failedAt,
        blockedAt: task.blockedAt,
        dependencies: [...(snapshot.dependenciesByTaskId[task.id] ?? [])],
      })),
    readyTaskIds: [...snapshot.readyTaskIds],
    counts: computeCounts(snapshot),
  };
}

export function computeCounts(snapshot) {
  const counts = {
    total: snapshot.tasks.length,
    pending: 0,
    ready: 0,
    claimed: 0,
    completed: 0,
    failed: 0,
    blocked: 0,
  };

  for (const task of snapshot.tasks) {
    counts[task.status] += 1;
  }

  return counts;
}

function finalizeTransition(snapshot, nextTasks, now, taskEvents) {
  const workflow = withWorkflowStatus(snapshot.workflow, nextTasks, now);
  return {
    snapshot: buildSnapshot({
      workflow,
      tasks: nextTasks,
      dependencyRows: snapshot.dependencyRows,
    }),
    taskEvents,
  };
}

function validateRawTasks(rawTasks) {
  if (!Array.isArray(rawTasks) || rawTasks.length === 0) {
    throw new WorkflowStateError(400, "invalid_tasks", "tasks must be a non-empty array.");
  }

  return rawTasks.map((task, index) => {
    if (!task || typeof task !== "object") {
      throw new WorkflowStateError(400, "invalid_task", `Task at index ${index} must be an object.`);
    }

    const clientKey = typeof task.clientKey === "string" ? task.clientKey.trim() : "";
    const description = typeof task.description === "string" ? task.description.trim() : "";
    if (!clientKey) {
      throw new WorkflowStateError(400, "invalid_client_key", `Task at index ${index} is missing clientKey.`);
    }
    if (!description) {
      throw new WorkflowStateError(400, "invalid_description", `Task '${clientKey}' is missing description.`);
    }

    return {
      clientKey,
      description,
      dependencies: Array.isArray(task.dependencies)
        ? task.dependencies.map((value) => String(value).trim()).filter(Boolean)
        : [],
      agentRole: typeof task.agentRole === "string" && task.agentRole.trim()
        ? task.agentRole.trim()
        : null,
      payload: cloneJson(task.payload),
    };
  });
}

function validateDependencyKeys(graph, tasksByClientKey) {
  for (const [clientKey, dependencyKeys] of graph.entries()) {
    for (const dependencyKey of dependencyKeys) {
      if (!tasksByClientKey.has(dependencyKey)) {
        throw new WorkflowStateError(
          400,
          "unknown_dependency",
          `Task '${clientKey}' depends on unknown clientKey '${dependencyKey}'.`,
        );
      }
    }
  }
}

function detectCycles(graph) {
  const visiting = new Set();
  const visited = new Set();

  function visit(node, trail) {
    if (visited.has(node)) {
      return;
    }
    if (visiting.has(node)) {
      throw new WorkflowStateError(400, "cyclic_dependency", "Task graph contains a dependency cycle.", {
        cycle: [...trail, node],
      });
    }

    visiting.add(node);
    for (const dependency of graph.get(node) ?? []) {
      visit(dependency, [...trail, node]);
    }
    visiting.delete(node);
    visited.add(node);
  }

  for (const node of graph.keys()) {
    visit(node, []);
  }
}

function buildTaskMap(tasks, field) {
  return new Map(tasks.map((task) => [task[field], task]));
}

function buildDependencyGraph(snapshot, tasksById) {
  const graph = new Map();
  for (const task of snapshot.tasks) {
    const dependencyIds = snapshot.dependenciesByTaskId[task.id] ?? [];
    graph.set(
      task.clientKey,
      dependencyIds.map((dependencyId) => tasksById.get(dependencyId)?.clientKey).filter(Boolean),
    );
  }
  return graph;
}

function findClientKeyByTaskId(tasksByClientKey, taskId) {
  for (const [clientKey, task] of tasksByClientKey.entries()) {
    if (task.id === taskId) {
      return clientKey;
    }
  }
  return null;
}

function findTaskById(snapshot, taskId) {
  const task = snapshot.tasks.find((candidate) => candidate.id === taskId);
  if (!task) {
    throw new WorkflowStateError(404, "task_not_found", `Task '${taskId}' was not found.`);
  }
  return task;
}

function replaceTask(tasks, updatedTask) {
  return tasks.map((task) => (task.id === updatedTask.id ? updatedTask : task));
}

function withWorkflowStatus(workflow, tasks, now) {
  return {
    ...workflow,
    status: deriveWorkflowStatus(tasks),
    updatedAt: now,
  };
}

function deriveWorkflowStatus(tasks) {
  if (tasks.some((task) => task.status === STATUS.FAILED)) {
    return "failed";
  }
  if (tasks.length > 0 && tasks.every((task) => task.status === STATUS.COMPLETED)) {
    return "completed";
  }
  return "active";
}

function createTaskEvent({ workflowId, taskId, eventType, actor, payload, now, idFactory }) {
  return {
    id: idFactory(),
    workflowId,
    taskId,
    eventType,
    actor: actor ?? null,
    payload: cloneJson(payload),
    createdAt: now,
  };
}

function cloneJson(value) {
  if (value == null) {
    return null;
  }
  return JSON.parse(JSON.stringify(value));
}

function normalizeFailure(value) {
  if (!value || typeof value !== "object") {
    throw new WorkflowStateError(400, "invalid_error", "error.message is required.");
  }

  const message = typeof value.message === "string" ? value.message.trim() : "";
  if (!message) {
    throw new WorkflowStateError(400, "invalid_error", "error.message is required.");
  }

  return {
    message,
    code: typeof value.code === "string" && value.code.trim() ? value.code.trim() : null,
    details: cloneJson(value.details),
  };
}
