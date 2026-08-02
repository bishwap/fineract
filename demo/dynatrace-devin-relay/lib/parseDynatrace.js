'use strict';

// Extracts the fields we care about from a Dynatrace Problem Notification
// payload. Dynatrace lets you shape the JSON body of a custom webhook
// notification, so field names vary between installations. To stay robust we
// probe several commonly-used shapes and fall back gracefully.
//
// Reference payload placeholders (configured in Dynatrace) typically include:
//   {ProblemID}, {ProblemTitle}, {ProblemImpact}, {ProblemSeverity},
//   {ProblemDetailsText}, {ImpactedEntityNames}, {ProblemURL}, {State}
//
// This parser accepts either those flat placeholder keys OR the raw Dynatrace
// Problems API v2 object shape.

function firstDefined(...values) {
  for (const v of values) {
    if (v !== undefined && v !== null && v !== '') {
      return v;
    }
  }
  return undefined;
}

function extractImpactedService(payload) {
  // Flat placeholder style.
  const flat = firstDefined(payload.ImpactedEntityNames, payload.impactedEntityNames, payload.impactedService);
  if (flat) {
    return Array.isArray(flat) ? flat.join(', ') : String(flat);
  }

  // Problems API v2 style: impactAnalysis / affectedEntities / entityTags.
  const entities = firstDefined(payload.impactedEntities, payload.affectedEntities);
  if (Array.isArray(entities) && entities.length > 0) {
    return entities
      .map((e) => firstDefined(e.name, e.entityId && e.entityId.id, e.entityId))
      .filter(Boolean)
      .join(', ');
  }

  return undefined;
}

function extractExceptionDetails(payload) {
  // Prefer an explicit details/description text if present.
  const details = firstDefined(
    payload.ProblemDetailsText,
    payload.problemDetailsText,
    payload.ProblemDetails,
    payload.problemDetails,
    payload.description,
  );
  if (details) {
    return typeof details === 'string' ? details : JSON.stringify(details);
  }

  // Otherwise try to synthesise from evidence details (Problems API v2).
  const evidence = payload.evidenceDetails && payload.evidenceDetails.details;
  if (Array.isArray(evidence) && evidence.length > 0) {
    return evidence
      .map((e) => firstDefined(e.displayName, e.rootCauseRelevant && 'root-cause', e.evidenceType))
      .filter(Boolean)
      .join('; ');
  }

  return undefined;
}

function parseDynatraceProblem(payload) {
  if (!payload || typeof payload !== 'object') {
    return {
      problemId: undefined,
      title: 'Unknown problem (empty or non-JSON payload)',
      impactedService: undefined,
      severity: undefined,
      state: undefined,
      exceptionDetails: undefined,
      problemUrl: undefined,
      raw: payload,
    };
  }

  return {
    problemId: firstDefined(payload.ProblemID, payload.problemId, payload.displayId, payload.id),
    title: firstDefined(payload.ProblemTitle, payload.problemTitle, payload.title) || 'Untitled Dynatrace problem',
    impactedService: extractImpactedService(payload),
    severity: firstDefined(payload.ProblemSeverity, payload.severityLevel, payload.severity),
    impact: firstDefined(payload.ProblemImpact, payload.impactLevel, payload.impact),
    state: firstDefined(payload.State, payload.state, payload.status),
    exceptionDetails: extractExceptionDetails(payload),
    problemUrl: firstDefined(payload.ProblemURL, payload.problemUrl, payload.url),
    raw: payload,
  };
}

module.exports = { parseDynatraceProblem, firstDefined };
