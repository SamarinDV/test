import test from "node:test";
import assert from "node:assert/strict";
import { createTriageServer } from "./server.mjs";

async function startServer(t) {
  const server = createTriageServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  const { port } = server.address();
  return `http://127.0.0.1:${port}`;
}

async function post(baseUrl, body) {
  return fetch(`${baseUrl}/api/triage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

test("returns a validated topic and draft for every supported topic", async (t) => {
  const baseUrl = await startServer(t);
  const validRequests = [
    { text: "Когда будет доставка?", topic: "delivery" },
    { text: "Какая стоимость услуги?", topic: "pricing" },
    { text: "Есть вопрос", topic: "other" },
  ];

  for (const { text, topic } of validRequests) {
    const response = await post(baseUrl, { text });
    assert.equal(response.status, 200, text);
    assert.deepEqual(await response.json(), {
      status: "ready",
      topic,
      draft: "Спасибо за обращение. Уточним детали заявки.",
    }, text);
  }
});

test("rejects malformed JSON and invalid text values", async (t) => {
  const baseUrl = await startServer(t);
  const invalidBodies = [
    "",
    "{}",
    JSON.stringify({ text: "" }),
    JSON.stringify({ text: "   " }),
    JSON.stringify({ text: null }),
    JSON.stringify({ text: 42 }),
    JSON.stringify({ text: [] }),
    JSON.stringify({ text: {} }),
    "null",
    "[]",
    "\"ordinary\"",
    "42",
    "true",
    "{",
  ];

  for (const body of invalidBodies) {
    const response = await post(baseUrl, body);
    assert.equal(response.status, 400, `body: ${body}`);
    assert.deepEqual(await response.json(), { status: "invalid_input" }, `body: ${body}`);
  }
});

test("returns manual_review for every invalid model response", async (t) => {
  const baseUrl = await startServer(t);

  for (const marker of ["[error]", "[bad-json]", "[bad-topic]", "[empty-draft]"]) {
    const response = await post(baseUrl, { text: marker });
    assert.equal(response.status, 200, marker);
    assert.deepEqual(await response.json(), {
      status: "manual_review",
      topic: null,
      draft: null,
    }, marker);
  }
});

test("uses a 300 ms timeout and stops waiting for the model", async (t) => {
  const timeout = t.mock.method(AbortSignal, "timeout");
  const baseUrl = await startServer(t);
  const startedAt = performance.now();
  const response = await post(baseUrl, { text: "[timeout]" });
  const elapsed = performance.now() - startedAt;

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: "manual_review",
    topic: null,
    draft: null,
  });
  assert.equal(timeout.mock.callCount(), 1);
  assert.deepEqual(timeout.mock.calls[0].arguments, [300]);
  assert.ok(elapsed < 1000, `model timeout took ${elapsed} ms`);
});

test("keeps the not_found contract for unsupported routes", async (t) => {
  const baseUrl = await startServer(t);
  const response = await fetch(`${baseUrl}/api/triage`);

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { status: "not_found" });
});
