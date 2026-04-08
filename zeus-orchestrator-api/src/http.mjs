export function json(data, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers,
  });
}

export function errorResponse(status, code, message, details = null) {
  return json(
    {
      error: {
        code,
        message,
        details,
      },
    },
    { status },
  );
}

export async function readJson(request) {
  const body = await request.text();
  if (!body) {
    return {};
  }

  try {
    return JSON.parse(body);
  } catch (error) {
    throw new HttpError(400, "invalid_json", "Request body must be valid JSON.", {
      cause: error.message,
    });
  }
}

export function parsePositiveInt(rawValue, defaultValue, maxValue) {
  if (rawValue == null || rawValue === "") {
    return defaultValue;
  }

  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return defaultValue;
  }

  return Math.min(parsed, maxValue);
}

export class HttpError extends Error {
  constructor(status, code, message, details = null) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function toErrorResponse(error) {
  if (error instanceof HttpError) {
    return errorResponse(error.status, error.code, error.message, error.details);
  }

  if (error && typeof error === "object" && "status" in error && "code" in error) {
    return errorResponse(error.status, error.code, error.message, error.details ?? null);
  }

  return errorResponse(500, "internal_error", "An unexpected error occurred.", {
    message: error instanceof Error ? error.message : String(error),
  });
}
