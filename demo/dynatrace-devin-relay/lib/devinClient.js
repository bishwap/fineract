'use strict';

// Thin client for the Devin create-session API.
//
// Request shape verified against the official Devin API reference:
//   https://docs.devin.ai/api-reference/v1/sessions/create-a-new-devin-session
//
//   POST {DEVIN_API_BASE}/v1/sessions          (DEVIN_API_BASE = https://api.devin.ai)
//   Authorization: Bearer {DEVIN_API_TOKEN}
//   Content-Type: application/json
//   Body: {
//     "prompt": "<string, required>",
//     "idempotent": <boolean>,
//     "title": "<string|null>",
//     "tags": ["<string>", ...]
//   }
//   200 response: { "session_id": "<string>", "url": "<string>", "is_new_session": <boolean|null> }

const CREATE_SESSION_PATH = '/v1/sessions';

async function createDevinSession({ apiBase, apiToken }, prompt, options = {}) {
  if (!apiBase || !apiToken) {
    throw new Error('DEVIN_API_BASE and DEVIN_API_TOKEN must both be set to create a Devin session.');
  }

  const url = `${apiBase.replace(/\/+$/, '')}${CREATE_SESSION_PATH}`;

  const body = {
    prompt,
    // Idempotent so replaying the same Dynatrace problem does not spawn duplicate
    // sessions during a demo.
    idempotent: options.idempotent !== undefined ? options.idempotent : true,
  };
  if (options.title) body.title = options.title;
  if (options.tags && options.tags.length) body.tags = options.tags;

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

  // 200 response: { session_id, url, is_new_session }
  return json;
}

module.exports = { createDevinSession, CREATE_SESSION_PATH };
