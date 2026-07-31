'use strict';

// Thin client for the Devin create-session API.
//
// ============================ TODO / VERIFY ================================
// The exact request shape below (path, HTTP method, JSON body field names, and
// auth header) is a BEST-GUESS placeholder and MUST be confirmed against the
// official Devin API reference before relying on it in a live demo:
//   https://docs.devin.ai/api-reference/overview
//
// As of writing, the documented shape is approximately:
//   POST {DEVIN_API_BASE}/v1/sessions
//   Authorization: Bearer {DEVIN_API_TOKEN}
//   Content-Type: application/json
//   Body: { "prompt": "<string>", "idempotent": true }
// and the response includes a `session_id` and a `url`.
//
// Adjust CREATE_SESSION_PATH, the body, and the response parsing here once the
// reference is confirmed.
// ===========================================================================

const CREATE_SESSION_PATH = '/v1/sessions';

async function createDevinSession({ apiBase, apiToken }, prompt) {
  if (!apiBase || !apiToken) {
    throw new Error('DEVIN_API_BASE and DEVIN_API_TOKEN must both be set to create a Devin session.');
  }

  const url = `${apiBase.replace(/\/+$/, '')}${CREATE_SESSION_PATH}`;

  // TODO: confirm body field names against the Devin API reference.
  const body = {
    prompt,
    idempotent: true,
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch (_e) {
    json = { raw: text };
  }

  if (!res.ok) {
    const err = new Error(`Devin API returned ${res.status}: ${text}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }

  return json;
}

module.exports = { createDevinSession, CREATE_SESSION_PATH };
