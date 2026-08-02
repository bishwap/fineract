'use strict';

// Posts an incident card to Slack via an Incoming Webhook so the
// Dynatrace -> Devin flow is visible in Slack as well as in Devin.
//
// Configuration (all optional — if SLACK_WEBHOOK_URL is unset this is a no-op,
// so the relay runs unchanged when Slack is not wired up):
//   SLACK_WEBHOOK_URL  Slack Incoming Webhook URL for the target channel
//
// The message fires when the relay creates a Devin session for a Dynatrace
// problem: it names the incident (from the parsed problem) and links straight
// to the Devin session that is already remediating it.

function buildBlocks(problem, session) {
  const title = (problem && problem.title) || 'Production incident';
  const service = problem && problem.impactedService;
  const severity = problem && problem.severity;
  const problemUrl = problem && problem.problemUrl;
  const sessionUrl = session && session.url;

  const fields = [];
  if (service) fields.push(`*Impacted:*\n${service}`);
  if (severity) fields.push(`*Severity:*\n${severity}`);
  if (problem && problem.problemId) fields.push(`*Problem:*\n${problem.problemId}`);

  const blocks = [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `:red_circle: *Dynatrace detected an incident*\n${title}` },
    },
  ];
  if (fields.length) {
    blocks.push({ type: 'section', fields: fields.map((t) => ({ type: 'mrkdwn', text: t })) });
  }

  const links = [];
  if (sessionUrl) links.push(`:robot_face: <${sessionUrl}|Devin is remediating \u2192 open session>`);
  if (problemUrl) links.push(`:bar_chart: <${problemUrl}|View in Dynatrace>`);
  if (links.length) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: links.join('\n') } });
  }

  return blocks;
}

async function notifySlack(problem, session) {
  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (!webhook) return { ok: false, skipped: true, detail: 'SLACK_WEBHOOK_URL not set' };

  const blocks = buildBlocks(problem, session);
  const fallback = `Dynatrace: ${(problem && problem.title) || 'incident'}` +
    (session && session.url ? ` \u2014 Devin session: ${session.url}` : '');

  try {
    const res = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: fallback, blocks }),
    });
    const body = await res.text();
    return { ok: res.ok, status: res.status, detail: res.ok ? '' : body.slice(0, 200) };
  } catch (err) {
    return { ok: false, detail: err.message };
  }
}

module.exports = { notifySlack, buildBlocks };
