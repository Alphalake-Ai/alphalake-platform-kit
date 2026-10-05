const crypto = require('crypto');

// HMAC signature over the event body, shared by inbound verification and
// outbound signing. Must mirror the platform's own generatePayloadSignature
// exactly (HMAC-SHA256 hex over JSON.stringify of the payload), so signatures
// round-trip through JSON parsing in both directions.
function generatePayloadSignature(payload, key) {
  return crypto
    .createHmac('sha256', key || '')
    .update(JSON.stringify(payload))
    .digest('hex');
}

// Verifies the x-payload-signature header on an inbound platform webhook
// against the shared key, using a timing-safe comparison.
function verifyWebhookSignature(req, key) {
  const signature = req.headers['x-payload-signature'];
  const expected = generatePayloadSignature(req.body, key);
  return (
    typeof signature === 'string' &&
    signature.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  );
}

// Drop null/undefined keys so the platform only receives fields we actually set.
const stripNullish = (obj) =>
  Object.fromEntries(Object.entries(obj || {}).filter(([, v]) => v !== null && v !== undefined));

// Outbound: notify the platform of a member change originating in this module.
// `org` must carry the platform's external_id and platform_entity_id (as stored
// by the org.added/org.updated webhook handler).
async function postModuleEvent({ org, action, payload, platformBackendUrl, internalApiKey, payloadSignatureKey, fileLog }) {
  if (!org?.external_id || !org?.platform_entity_id) {
    throw new Error('Organisation is not linked to the platform (missing external_id/entity_id)');
  }
  const dto = {
    action,
    orgId: org.external_id,
    entityId: org.platform_entity_id,
    payload: stripNullish(payload),
  };
  // Serialize once so the exact bytes signed, sent, and logged are identical.
  const requestBody = JSON.stringify(dto);
  const signature = generatePayloadSignature(dto, payloadSignatureKey);
  const res = await fetch(`${platformBackendUrl}/api/internal/module-events`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': internalApiKey || '',
      'x-payload-signature': signature,
    },
    body: requestBody,
  });
  const responseText = await res.text().catch(() => '');
  fileLog?.('webhooks', { direction: 'out', action, status: res.status, ok: res.ok, signature, sentBody: requestBody, response: responseText });
  if (!res.ok) {
    throw new Error(`Platform event ${action} failed (${res.status}): ${responseText}`);
  }
  let json = {};
  try { json = JSON.parse(responseText); } catch { /* non-JSON success body */ }
  return json?.data ?? json;
}

// Outbound calls to the Alphalake platform's internal password-reset API, used
// to let a user set their platform password from inside a module (e.g. a
// passwordless "review this" magic-link flow — see createReviewLink). Distinct
// host/auth from postModuleEvent above: plain x-api-key, no HMAC signing.
async function alphalakeGetPasswordResetToken(email, { alphalakeInternalApiUrl, alphalakeInternalApiKey }) {
  const res = await fetch(`${alphalakeInternalApiUrl}/platform/api/internal/get-password-reset-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': alphalakeInternalApiKey || '' },
    body: JSON.stringify({ email }),
  });
  // Envelope shape: { success, message, data: { token } }.
  const body = await res.json().catch(() => ({}));
  const resetToken = body?.data?.token;
  if (!res.ok || !body.success || !resetToken) throw new Error(`get-password-reset-token failed (${res.status})`);
  return resetToken;
}

async function alphalakeResetPassword(resetToken, newPassword, { alphalakeInternalApiUrl, alphalakeInternalApiKey }) {
  const res = await fetch(`${alphalakeInternalApiUrl}/platform/api/internal/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': alphalakeInternalApiKey || '' },
    body: JSON.stringify({ token: resetToken, newPassword }),
  });
  // Envelope shape: { success, message, data: true }.
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.success) throw new Error(`reset-password failed (${res.status})`);
}

// Read-only lookups on the platform's internal API (same host/auth as the
// password-reset calls above). Both return the envelope's `data` array and
// throw on anything else. Note the platform answers an unknown org/user with
// 200 and an empty list, so callers must treat [] as "nothing", not "unknown".
async function alphalakeInternalGet(path, { alphalakeInternalApiUrl, alphalakeInternalApiKey, timeoutMs = 10000 }) {
  if (!alphalakeInternalApiUrl) throw new Error('alphalakeInternalApiUrl is not configured');
  const res = await fetch(`${alphalakeInternalApiUrl.replace(/\/$/, '')}/platform/api/internal/${path}`, {
    headers: { 'x-api-key': alphalakeInternalApiKey || '' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.success || !Array.isArray(body.data)) {
    throw new Error(`Platform GET ${path} failed (${res.status})`);
  }
  return body.data;
}

// The org's subscriptions, one per entity it holds at any level (cloud,
// workspace, hub): [{ entityId, paused, expiresAt, entity: { masterEntityId, type, … } }].
const alphalakeGetOrgSubscriptions = (externalOrgId, config) =>
  alphalakeInternalGet(`org/${encodeURIComponent(externalOrgId)}/subscriptions`, config);

// The entities (hubs) a user is assigned to: [{ id, masterEntityId, type, orgId, … }].
const alphalakeGetUserEntities = (firebaseUid, config) =>
  alphalakeInternalGet(`user/${encodeURIComponent(firebaseUid)}/entities`, config);

module.exports = {
  generatePayloadSignature,
  verifyWebhookSignature,
  postModuleEvent,
  alphalakeGetPasswordResetToken,
  alphalakeResetPassword,
  alphalakeGetOrgSubscriptions,
  alphalakeGetUserEntities,
};
