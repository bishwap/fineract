'use strict';

// Builds the natural-language prompt handed to the Devin create-session API.
// It stitches together the repo context (from config) and the root-cause
// context extracted from the Dynatrace problem.

function buildPrompt(problem, target) {
  const lines = [
    'A production incident was detected by Dynatrace and relayed to you automatically.',
    '',
    `Repository: ${target.repoUrl}`,
    `Git ref/branch to start from: ${target.repoRef}`,
    `Failing endpoint: ${target.failingEndpoint}`,
    '',
    'Dynatrace problem context:',
    `- Problem ID: ${problem.problemId || 'n/a'}`,
    `- Title: ${problem.title}`,
    `- Impacted service: ${problem.impactedService || 'n/a'}`,
    `- Severity/impact: ${[problem.severity, problem.impact].filter(Boolean).join(' / ') || 'n/a'}`,
    `- State: ${problem.state || 'n/a'}`,
    `- Root-cause / exception details: ${problem.exceptionDetails || 'n/a'}`,
    problem.problemUrl ? `- Dynatrace problem URL: ${problem.problemUrl}` : null,
    '',
    'Your task:',
    '1. Reproduce and diagnose the failure on the fixed-deposit create endpoint.',
    '2. Identify the root cause in the server code.',
    '3. Implement a minimal, correct fix.',
    '4. Open a pull request with the fix. IMPORTANT: open the PR only — do NOT merge it.',
    '',
    'Keep the change scoped to the defect. Explain the root cause and the fix in the PR description.',
  ];

  return lines.filter((l) => l !== null).join('\n');
}

module.exports = { buildPrompt };
