import assert from "node:assert/strict";
import test from "node:test";

import {
  TASK_STATUS,
  buildSnapshot,
  claimTask,
  completeTask,
  createWorkflowRecord,
  failTask,
  normalizeBulkTasks,
} from "../src/workflow-state.mjs";

function createIdFactory(prefix = "id") {
  let counter = 0;
  return () => `${prefix}-${++counter}`;
}

test("bulk insert creates ready and pending tasks from dependency state", () => {
  const now = 1_700_000_000_000;
  const workflow = createWorkflowRecord({
    workflowId: "workflow-1",
    name: "demo",
    now,
  });

  const snapshot = buildSnapshot({
    workflow,
    tasks: [
      {
        id: "task-existing",
        workflowId: workflow.id,
        clientKey: "existing",
        description: "Existing task",
        agentRole: "planner",
        status: TASK_STATUS.COMPLETED,
        payload: null,
        result: { ok: true },
        failure: null,
        claimedBy: "planner-1",
        createdAt: now - 100,
        updatedAt: now - 10,
        claimedAt: now - 90,
        completedAt: now - 10,
        failedAt: null,
        blockedAt: null,
      },
    ],
    dependencyRows: [],
  });

  const result = normalizeBulkTasks(
    snapshot,
    [
      {
        clientKey: "ready-child",
        description: "Ready child",
        dependencies: ["existing"],
      },
      {
        clientKey: "pending-grandchild",
        description: "Pending grandchild",
        dependencies: ["ready-child"],
      },
    ],
    { now, idFactory: createIdFactory("task") },
  );

  const readyChild = result.createdTasks.find((task) => task.clientKey === "ready-child");
  const pendingGrandchild = result.createdTasks.find((task) => task.clientKey === "pending-grandchild");

  assert.equal(readyChild.status, TASK_STATUS.READY);
  assert.equal(pendingGrandchild.status, TASK_STATUS.PENDING);
  assert.deepEqual(result.snapshot.readyTaskIds, ["task-1"]);
});

test("bulk insert rejects cyclic dependencies", () => {
  const now = 1_700_000_000_000;
  const workflow = createWorkflowRecord({
    workflowId: "workflow-2",
    name: "cycle",
    now,
  });
  const snapshot = buildSnapshot({ workflow, tasks: [], dependencyRows: [] });

  assert.throws(
    () =>
      normalizeBulkTasks(
        snapshot,
        [
          { clientKey: "a", description: "A", dependencies: ["b"] },
          { clientKey: "b", description: "B", dependencies: ["a"] },
        ],
        { now, idFactory: createIdFactory("cycle") },
      ),
    /dependency cycle/i,
  );
});

test("claim moves a ready task to claimed", () => {
  const now = 1_700_000_000_000;
  const workflow = createWorkflowRecord({
    workflowId: "workflow-3",
    name: "claim",
    now,
  });

  const snapshot = buildSnapshot({
    workflow,
    tasks: [
      {
        id: "task-1",
        workflowId: workflow.id,
        clientKey: "one",
        description: "One",
        agentRole: null,
        status: TASK_STATUS.READY,
        payload: null,
        result: null,
        failure: null,
        claimedBy: null,
        createdAt: now,
        updatedAt: now,
        claimedAt: null,
        completedAt: null,
        failedAt: null,
        blockedAt: null,
      },
    ],
    dependencyRows: [],
  });

  const result = claimTask(snapshot, "task-1", { agentRole: "planner", agentId: "planner-1" }, {
    now: now + 1,
    idFactory: createIdFactory("event"),
  });

  assert.equal(result.snapshot.tasks[0].status, TASK_STATUS.CLAIMED);
  assert.equal(result.snapshot.tasks[0].claimedBy, "planner-1");
  assert.deepEqual(result.snapshot.readyTaskIds, []);
});

test("complete promotes newly unblocked dependents", () => {
  const now = 1_700_000_000_000;
  const workflow = createWorkflowRecord({
    workflowId: "workflow-4",
    name: "complete",
    now,
  });

  const snapshot = buildSnapshot({
    workflow,
    tasks: [
      {
        id: "task-a",
        workflowId: workflow.id,
        clientKey: "a",
        description: "A",
        agentRole: "planner",
        status: TASK_STATUS.CLAIMED,
        payload: null,
        result: null,
        failure: null,
        claimedBy: "planner-1",
        createdAt: now,
        updatedAt: now,
        claimedAt: now,
        completedAt: null,
        failedAt: null,
        blockedAt: null,
      },
      {
        id: "task-b",
        workflowId: workflow.id,
        clientKey: "b",
        description: "B",
        agentRole: "worker",
        status: TASK_STATUS.PENDING,
        payload: null,
        result: null,
        failure: null,
        claimedBy: null,
        createdAt: now + 1,
        updatedAt: now + 1,
        claimedAt: null,
        completedAt: null,
        failedAt: null,
        blockedAt: null,
      },
    ],
    dependencyRows: [
      {
        workflowId: workflow.id,
        taskId: "task-b",
        dependsOnTaskId: "task-a",
      },
    ],
  });

  const result = completeTask(snapshot, "task-a", { result: { ok: true } }, {
    now: now + 10,
    idFactory: createIdFactory("event"),
  });

  assert.equal(result.snapshot.tasks.find((task) => task.id === "task-a").status, TASK_STATUS.COMPLETED);
  assert.equal(result.snapshot.tasks.find((task) => task.id === "task-b").status, TASK_STATUS.READY);
  assert.deepEqual(result.snapshot.readyTaskIds, ["task-b"]);
});

test("fail blocks unresolved descendants", () => {
  const now = 1_700_000_000_000;
  const workflow = createWorkflowRecord({
    workflowId: "workflow-5",
    name: "fail",
    now,
  });

  const snapshot = buildSnapshot({
    workflow,
    tasks: [
      {
        id: "task-root",
        workflowId: workflow.id,
        clientKey: "root",
        description: "Root",
        agentRole: "planner",
        status: TASK_STATUS.CLAIMED,
        payload: null,
        result: null,
        failure: null,
        claimedBy: "planner-1",
        createdAt: now,
        updatedAt: now,
        claimedAt: now,
        completedAt: null,
        failedAt: null,
        blockedAt: null,
      },
      {
        id: "task-child",
        workflowId: workflow.id,
        clientKey: "child",
        description: "Child",
        agentRole: "worker",
        status: TASK_STATUS.PENDING,
        payload: null,
        result: null,
        failure: null,
        claimedBy: null,
        createdAt: now + 1,
        updatedAt: now + 1,
        claimedAt: null,
        completedAt: null,
        failedAt: null,
        blockedAt: null,
      },
      {
        id: "task-grandchild",
        workflowId: workflow.id,
        clientKey: "grandchild",
        description: "Grandchild",
        agentRole: "worker",
        status: TASK_STATUS.PENDING,
        payload: null,
        result: null,
        failure: null,
        claimedBy: null,
        createdAt: now + 2,
        updatedAt: now + 2,
        claimedAt: null,
        completedAt: null,
        failedAt: null,
        blockedAt: null,
      },
    ],
    dependencyRows: [
      {
        workflowId: workflow.id,
        taskId: "task-child",
        dependsOnTaskId: "task-root",
      },
      {
        workflowId: workflow.id,
        taskId: "task-grandchild",
        dependsOnTaskId: "task-child",
      },
    ],
  });

  const result = failTask(snapshot, "task-root", { error: { message: "boom" } }, {
    now: now + 20,
    idFactory: createIdFactory("event"),
  });

  assert.equal(result.snapshot.tasks.find((task) => task.id === "task-root").status, TASK_STATUS.FAILED);
  assert.equal(result.snapshot.tasks.find((task) => task.id === "task-child").status, TASK_STATUS.BLOCKED);
  assert.equal(
    result.snapshot.tasks.find((task) => task.id === "task-grandchild").status,
    TASK_STATUS.BLOCKED,
  );
});
