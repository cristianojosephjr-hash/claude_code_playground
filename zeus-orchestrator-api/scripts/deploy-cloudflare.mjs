import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SMOKE_MODE = process.argv.includes("--smoke");
const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID ?? "892897b63066abdd897d63d050555ff0";
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const ZEUS_API_TOKEN = process.env.ZEUS_API_TOKEN ?? crypto.randomBytes(32).toString("hex");
const ENABLE_AI_SUMMARY = process.env.ENABLE_AI_SUMMARY ?? "false";
const AI_SUMMARY_MODEL = process.env.AI_SUMMARY_MODEL ?? "@cf/zai-org/glm-4.7-flash";

const API_BASE = "https://api.cloudflare.com/client/v4";
const WORKER_NAME = "zeus-orchestrator-api";
const DATABASE_NAME = "zeus-orchestrator";

const authHeaders = {
  Authorization: `Bearer ${API_TOKEN}`,
};

main().catch((error) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exitCode = 1;
});

async function main() {
  if (!SMOKE_MODE && !API_TOKEN) {
    throw new Error("CLOUDFLARE_API_TOKEN is required.");
  }

  if (SMOKE_MODE) {
    await runSmokeCheck();
    return;
  }

  const database = await ensureDatabase();
  await applySchema(database.uuid ?? database.id);
  await uploadWorker(database.uuid ?? database.id);
  await putSecret();

  console.log(
    JSON.stringify(
      {
        accountId: ACCOUNT_ID,
        database: DATABASE_NAME,
        databaseId: database.uuid ?? database.id,
        worker: WORKER_NAME,
        generatedApiToken: process.env.ZEUS_API_TOKEN ? null : ZEUS_API_TOKEN,
      },
      null,
      2,
    ),
  );
}

async function ensureDatabase() {
  await verifyToken();
  const existing = await apiRequest("GET", `/accounts/${ACCOUNT_ID}/d1/database`);
  const database = (existing.result ?? []).find((candidate) => candidate.name === DATABASE_NAME);
  if (database) {
    return database;
  }

  const created = await apiRequest("POST", `/accounts/${ACCOUNT_ID}/d1/database`, {
    name: DATABASE_NAME,
  });
  return created.result;
}

async function applySchema(databaseId) {
  const schema = await fs.readFile(path.join(APP_ROOT, "schema.sql"), "utf8");
  await apiRequest("POST", `/accounts/${ACCOUNT_ID}/d1/database/${databaseId}/query`, {
    sql: schema,
  });
}

async function uploadWorker(databaseId) {
  const form = new FormData();
  const modulePaths = await listWorkerModules();

  for (const modulePath of modulePaths) {
    const source = await fs.readFile(path.join(APP_ROOT, modulePath), "utf8");
    form.append("files", new Blob([source], { type: "application/javascript+module" }), modulePath);
  }

  form.append(
    "metadata",
    JSON.stringify({
      main_module: "main.mjs",
      compatibility_date: "2026-04-03",
      bindings: [
        {
          name: "WORKFLOW_COORDINATOR",
          type: "durable_object_namespace",
          class_name: "WorkflowCoordinator",
        },
        {
          name: "DB",
          type: "d1",
          id: databaseId,
        },
        {
          name: "AI",
          type: "ai",
        },
        {
          name: "ENABLE_AI_SUMMARY",
          type: "plain_text",
          text: ENABLE_AI_SUMMARY,
        },
        {
          name: "AI_SUMMARY_MODEL",
          type: "plain_text",
          text: AI_SUMMARY_MODEL,
        },
      ],
      migrations: {
        new_tag: "v1",
        new_sqlite_classes: ["WorkflowCoordinator"],
      },
      observability: {
        enabled: true,
        logs: {
          enabled: true,
          invocation_logs: true,
        },
        traces: {
          enabled: true,
        },
      },
    }),
  );

  const response = await fetch(`${API_BASE}/accounts/${ACCOUNT_ID}/workers/scripts/${WORKER_NAME}`, {
    method: "PUT",
    headers: authHeaders,
    body: form,
  });
  await parseApiResponse(response);
}

async function putSecret() {
  await apiRequest("PUT", `/accounts/${ACCOUNT_ID}/workers/scripts/${WORKER_NAME}/secrets`, {
    name: "API_TOKEN",
    type: "secret_text",
    text: ZEUS_API_TOKEN,
  });
}

async function verifyToken() {
  await apiRequest("GET", "/user/tokens/verify");
}

async function listWorkerModules() {
  const files = ["main.mjs"];
  const srcDir = path.join(APP_ROOT, "src");
  const entries = await fs.readdir(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(".mjs")) {
      files.push(`src/${entry.name}`);
    }
  }
  return files;
}

async function runSmokeCheck() {
  const modulePaths = await listWorkerModules();
  const schemaPath = path.join(APP_ROOT, "schema.sql");
  const schema = await fs.readFile(schemaPath, "utf8");

  for (const modulePath of modulePaths) {
    await fs.readFile(path.join(APP_ROOT, modulePath), "utf8");
  }

  console.log(
    JSON.stringify(
      {
        appRoot: APP_ROOT,
        schemaPath,
        schemaBytes: Buffer.byteLength(schema, "utf8"),
        modulePaths,
      },
      null,
      2,
    ),
  );
}

async function apiRequest(method, resourcePath, body = null) {
  const response = await fetch(`${API_BASE}${resourcePath}`, {
    method,
    headers: {
      ...authHeaders,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return parseApiResponse(response);
}

async function parseApiResponse(response) {
  const payload = await response.json();
  if (!response.ok || payload.success === false) {
    throw new Error(
      `Cloudflare API request failed (${response.status}): ${JSON.stringify(payload.errors ?? payload, null, 2)}`,
    );
  }
  return payload;
}
