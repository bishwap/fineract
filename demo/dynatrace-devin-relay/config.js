'use strict';

// Central configuration, read entirely from environment variables so that no
// secrets are ever committed to the repo.
//
// Required:
//   DEVIN_API_BASE   Base URL of the Devin API (e.g. https://api.devin.ai)
//   DEVIN_API_TOKEN  Bearer token for the Devin API
//
// Optional (have sensible demo defaults):
//   PORT             Port to listen on (default 3000)
//   TARGET_REPO_URL  Repo the triggered Devin session should work in
//   TARGET_REPO_REF  Git ref/branch the session should start from
//   FAILING_ENDPOINT Human-readable description of the failing endpoint

module.exports = {
  port: parseInt(process.env.PORT || '3000', 10),

  devin: {
    apiBase: process.env.DEVIN_API_BASE || '',
    apiToken: process.env.DEVIN_API_TOKEN || '',
  },

  target: {
    repoUrl: process.env.TARGET_REPO_URL || 'https://github.com/bishwap/fineract',
    repoRef: process.env.TARGET_REPO_REF || 'demo/java11-baseline',
    failingEndpoint:
      process.env.FAILING_ENDPOINT ||
      'POST /fineract-provider/api/v1/savingsaccounts (Fixed Deposit create: submitFDApplication)',
  },
};
