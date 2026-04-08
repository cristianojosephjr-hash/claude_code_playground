import { DurableObject } from "cloudflare:workers";

import { HttpError, errorResponse, json, parsePositiveInt, readJson, toErrorResponse } from "./src/http.mjs";
import {
  WorkflowStateError,
  claimTask,
  completeTask,
  createMessageRecord,
  createWorkflowRecord,
  failTask,
  normalizeBulkTasks,
  serializeSnapshot,
} from "./src/workflow-state.mjs";
import {
  dependencyInsertStatement,
  loadWorkflowSnapshot,
  messageInsertStatement,
  readMessages,
  taskEventInsertStatement,
  taskInsertStatement,
  taskUpdateStatement,
  workflowInsertStatement,
  workflowUpdateStatement,
} from "./src/d1.mjs";

const INTERNAL_ORIGIN = "https://workflow.internal";

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);

      if (url.pathname === "/") {
        return json({
          service: "zeus-orchestrator-api",
          status: "ok",
          workersAiEnabled: env.ENABLE_AI_SUMMARY === "true",
        });
      }

      if (!url.pathname.startsWith("/v1/")) {
        return errorResponse(404, "not_found", "Route not found.");
      }

      authorizeRequest(request, env.API_TOKEN);
      return await routeRequest(request, env, url);
    } catch (error) {
      return toErrorResponse(error);
    }
  },
};

export class WorkflowCoordinator extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.workflowId = null;
    this.snapshot = null;
    this.loadPromise = null;
    this.mutationQueue = Promise.resolve();
  }

  async fetch(request) {
    try {
      const workflowId = request.headers.get("x-workflow-id") ?? this.workflowId;
      if (!workflowId) {
        throw new HttpError(400, "missing_workflow_id", "Missing x-workflow-id header.");
      }

      if (this.workflowId && this.workflowId !== workflowId) {
        throw new HttpError(
          409,
          "workflow_mismatch",
          "This Durable Object instance is already bound to another workflow.",
        );
      }

      this.workflowId = workflowId;
      await this.ensureLoaded();

      const url = new URL(request.url);
      const path = url.pathname;

      if (request.method === "POST" && path === "/init") {
        return await this.handleInit(request);
      }
      if (request.method === "GET" && path === "/workflow") {
        return this.handleGetWorkflow();
      }
      if (request.method === "POST" && path === "/tasks/bulk") {
        return await this.handleBulkTasks(request);
      }
      if (request.method === "POST" && path.startsWith("/tasks/") && path.endsWith("/claim")) {
        return await this.handleClaim(request, path.split("/")[2]);
      }
      if (request.method === "POST" && path.startsWith("/tasks/") && path.endsWith("/complete")) {
        return await this.handleComplete(request, path.split("/")[2]);
      }
      if (request.method === "POST" && path.startsWith("/tasks/") && path.endsWith("/fail")) {
        return await this.handleFail(request, path.split("/")[2]);
      }
      if (request.method === "POST" && path === "/messages") {
        return await this.handleCreateMessage(request);
      }
      if (request.method === "GET" && path === "/messages") {
        return await this.handleListMessages(url);
      }
      if (request.method === "POST" && path === "/ai/summary") {
        return await this.handleAiSummary(request);
      }

      return errorResponse(404, "not_found", "Workflow route not found.");
    } catch (error) {
      return toErrorResponse(error);
    }
  }

  async ensureLoaded() {
    if (this.snapshot) {
      return;
    }

    if (!this.loadPromise) {
      this.loadPromise = this.ctx.blockConcurrencyWhile(async () => {
        this.snapshot = await loadWorkflowSnapshot(this.env.DB, this.workflowId);
      });
    }

    await this.loadPromise;
    this.loadPromise = null;
  }

  async handleInit(request) {
    const body = await readJson(request);
    return this.withMutationLock(async () => {
      if (this.snapshot) {
        throw new HttpError(409, "workflow_exists", `Workflow '${this.workflowId}' already exists.`);
      }

      const now = Date.now();
      const workflow = createWorkflowRecord({
        workflowId: this.workflowId,
        name: body.name,
        metadata: body.metadata,
        now,
      });

      await this.env.DB.batch([workflowInsertStatement(this.env.DB, workflow)]);
      this.snapshot = {
        workflow,
        tasks: [],
        dependencyRows: [],
        dependenciesByTaskId: {},
        dependentsByTaskId: {},
        readyTaskIds: [],
      };

      return json({ workflow: serializeSnapshot(this.snapshot).workflow }, { status: 201 });
    });
  }

  handleGetWorkflow() {
    this.assertWorkflowLoaded();
    return json(serializeSnapshot(this.snapshot));
  }

  async handleBulkTasks(request) {
    const body = await readJson(request);
    return this.withMutationLock(async () => {
      this.assertWorkflowLoaded();
      const now = Date.now();
      const result = normalizeBulkTasks(this.snapshot, body.tasks, {
        now,
        idFactory: () => crypto.randomUUID(),
      });

      await this.env.DB.batch([
        workflowUpdateStatement(this.env.DB, result.snapshot.workflow),
        ...result.createdTasks.map((task) => taskInsertStatement(this.env.DB, task)),
        ...result.dependencyRows.map((row) => dependencyInsertStatement(this.env.DB, row)),
        ...result.taskEvents.map((event) => taskEventInsertStatement(this.env.DB, event)),
      ]);
      this.snapshot = result.snapshot;

      return json(
        {
          tasks: serializeSnapshot(this.snapshot).tasks.filter((task) =>
            result.createdTasks.some((createdTask) => createdTask.id === task.id),
          ),
          readyTaskIds: result.snapshot.readyTaskIds,
          dependencyGraph: result.createdTasks.map((task) => ({
            taskId: task.id,
            clientKey: task.clientKey,
            dependencies: result.snapshot.dependenciesByTaskId[task.id] ?? [],
          })),
        },
        { status: 201 },
      );
    });
  }

  async handleClaim(request, taskId) {
    const body = await readJson(request);
    return this.withMutationLock(async () => {
      this.assertWorkflowLoaded();
      const now = Date.now();
      const result = claimTask(this.snapshot, taskId, body, {
        now,
        idFactory: () => crypto.randomUUID(),
      });

      await this.persistTransition(result);
      this.snapshot = result.snapshot;

      return json({
        task: serializeSnapshot(this.snapshot).tasks.find((task) => task.id === taskId),
        readyTaskIds: this.snapshot.readyTaskIds,
      });
    });
  }

  async handleComplete(request, taskId) {
    const body = await readJson(request);
    return this.withMutationLock(async () => {
      this.assertWorkflowLoaded();
      const now = Date.now();
      const result = completeTask(this.snapshot, taskId, body, {
        now,
        idFactory: () => crypto.randomUUID(),
      });

      await this.persistTransition(result);
      this.snapshot = result.snapshot;

      return json({
        task: serializeSnapshot(this.snapshot).tasks.find((task) => task.id === taskId),
        readyTaskIds: this.snapshot.readyTaskIds,
      });
    });
  }

  async handleFail(request, taskId) {
    const body = await readJson(request);
    return this.withMutationLock(async () => {
      this.assertWorkflowLoaded();
      const now = Date.now();
      const result = failTask(this.snapshot, taskId, body, {
        now,
        idFactory: () => crypto.randomUUID(),
      });

      await this.persistTransition(result);
      this.snapshot = result.snapshot;

      return json({
        task: serializeSnapshot(this.snapshot).tasks.find((task) => task.id === taskId),
        readyTaskIds: this.snapshot.readyTaskIds,
        workflow: serializeSnapshot(this.snapshot).workflow,
      });
    });
  }

  async handleCreateMessage(request) {
    const body = await readJson(request);
    return this.withMutationLock(async () => {
      this.assertWorkflowLoaded();
      const message = createMessageRecord({
        workflowId: this.workflowId,
        from: body.from,
        type: body.type,
        payload: body.payload,
        now: Date.now(),
        idFactory: () => crypto.randomUUID(),
      });

      await this.env.DB.batch([messageInsertStatement(this.env.DB, message)]);
      return json({ message }, { status: 201 });
    });
  }

  async handleListMessages(url) {
    this.assertWorkflowLoaded();
    const limit = parsePositiveInt(url.searchParams.get("limit"), 100, 200);
    const messages = await readMessages(this.env.DB, this.workflowId, limit);
    return json({ messages });
  }

  async handleAiSummary(request) {
    this.assertWorkflowLoaded();
    if (this.env.ENABLE_AI_SUMMARY !== "true") {
      return errorResponse(404, "ai_summary_disabled", "AI summaries are disabled.");
    }
    if (!this.env.AI || typeof this.env.AI.run !== "function") {
      return errorResponse(503, "ai_unavailable", "Workers AI binding is unavailable.");
    }

    const body = await readJson(request);
    const messages = await readMessages(this.env.DB, this.workflowId, 20);
    const prompt = buildSummaryPrompt(serializeSnapshot(this.snapshot), messages, body.focus);
    const result = await this.env.AI.run(this.env.AI_SUMMARY_MODEL, {
      messages: [
        {
          role: "system",
          content:
            "You summarize deterministic workflow execution state for developers. Be concise and factual.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    return json({
      model: this.env.AI_SUMMARY_MODEL,
      summary: extractAiText(result),
    });
  }

  async persistTransition(result) {
    const updatedTasks = collectUpdatedTasks(this.snapshot.tasks, result.snapshot.tasks);
    await this.env.DB.batch([
      workflowUpdateStatement(this.env.DB, result.snapshot.workflow),
      ...updatedTasks.map((task) => taskUpdateStatement(this.env.DB, task)),
      ...result.taskEvents.map((event) => taskEventInsertStatement(this.env.DB, event)),
    ]);
  }

  assertWorkflowLoaded() {
    if (!this.snapshot) {
      throw new HttpError(404, "workflow_not_found", `Workflow '${this.workflowId}' was not found.`);
    }
  }

  async withMutationLock(handler) {
    const prior = this.mutationQueue;
    let releaseQueue;
    const gate = new Promise((resolve) => {
      releaseQueue = resolve;
    });
    this.mutationQueue = prior.then(
      () => gate,
      () => gate,
    );

    await prior;
    try {
      return await handler();
    } finally {
      releaseQueue();
    }
  }
}

async function routeRequest(request, env, url) {
  const parts = url.pathname.split("/").filter(Boolean);

  if (parts.length === 2 && parts[0] === "v1" && parts[1] === "workflows" && request.method === "POST") {
    return createWorkflow(request, env);
  }

  if (parts[0] !== "v1" || parts[1] !== "workflows" || parts.length < 3) {
    return errorResponse(404, "not_found", "Route not found.");
  }

  const workflowId = parts[2];

  if (parts.length === 3 && request.method === "GET") {
    return forwardToWorkflow(env, workflowId, "/workflow", request);
  }

  if (parts.length === 5 && parts[3] === "tasks" && parts[4] === "bulk" && request.method === "POST") {
    return forwardToWorkflow(env, workflowId, "/tasks/bulk", request);
  }

  if (parts.length === 6 && parts[3] === "tasks" && request.method === "POST") {
    const taskId = parts[4];
    const action = parts[5];
    if (action === "claim" || action === "complete" || action === "fail") {
      return forwardToWorkflow(env, workflowId, `/tasks/${taskId}/${action}`, request);
    }
  }

  if (parts.length === 4 && parts[3] === "messages" && (request.method === "POST" || request.method === "GET")) {
    return forwardToWorkflow(env, workflowId, "/messages", request);
  }

  if (parts.length === 5 && parts[3] === "ai" && parts[4] === "summary" && request.method === "POST") {
    return forwardToWorkflow(env, workflowId, "/ai/summary", request);
  }

  return errorResponse(404, "not_found", "Route not found.");
}

async function createWorkflow(request, env) {
  const body = await readJson(request);
  const workflowId = crypto.randomUUID();
  const stub = env.WORKFLOW_COORDINATOR.getByName(workflowId);

  return stub.fetch(
    new Request(`${INTERNAL_ORIGIN}/init`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-workflow-id": workflowId,
      },
      body: JSON.stringify({
        name: body.name,
        metadata: body.metadata ?? null,
      }),
    }),
  );
}

async function forwardToWorkflow(env, workflowId, path, request) {
  const incomingUrl = new URL(request.url);
  const targetUrl = new URL(`${INTERNAL_ORIGIN}${path}`);
  targetUrl.search = incomingUrl.search;

  const headers = new Headers({
    "x-workflow-id": workflowId,
  });

  const contentType = request.headers.get("content-type");
  if (contentType) {
    headers.set("content-type", contentType);
  }

  const init = {
    method: request.method,
    headers,
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = await request.text();
  }

  const stub = env.WORKFLOW_COORDINATOR.getByName(workflowId);
  return stub.fetch(new Request(targetUrl, init));
}

function authorizeRequest(request, apiToken) {
  if (!apiToken) {
    throw new HttpError(500, "missing_api_token", "API_TOKEN is not configured.");
  }

  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) {
    throw new HttpError(401, "unauthorized", "Missing bearer token.");
  }

  const providedToken = authorization.slice("Bearer ".length);
  if (!timingSafeEqual(providedToken, apiToken)) {
    throw new HttpError(401, "unauthorized", "Invalid bearer token.");
  }
}

function timingSafeEqual(left, right) {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  let mismatch = leftBytes.length ^ rightBytes.length;
  const maxLength = Math.max(leftBytes.length, rightBytes.length);

  for (let index = 0; index < maxLength; index += 1) {
    mismatch |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }

  return mismatch === 0;
}

function collectUpdatedTasks(previousTasks, nextTasks) {
  const previousById = new Map(previousTasks.map((task) => [task.id, task]));
  return nextTasks.filter((task) => JSON.stringify(previousById.get(task.id)) !== JSON.stringify(task));
}

function buildSummaryPrompt(snapshot, messages, focus) {
  const summaryFocus = typeof focus === "string" && focus.trim() ? focus.trim() : "workflow";
  return [
    `Focus: ${summaryFocus}`,
    "Workflow:",
    JSON.stringify(snapshot.workflow, null, 2),
    "Counts:",
    JSON.stringify(snapshot.counts, null, 2),
    "Ready tasks:",
    JSON.stringify(snapshot.readyTaskIds, null, 2),
    "Tasks:",
    JSON.stringify(snapshot.tasks, null, 2),
    "Recent messages:",
    JSON.stringify(messages, null, 2),
  ].join("\n\n");
}

function extractAiText(result) {
  if (typeof result === "string") {
    return result;
  }
  if (result && typeof result.response === "string") {
    return result.response;
  }
  return JSON.stringify(result, null, 2);
}
