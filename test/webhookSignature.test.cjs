// Webhook signature checks: a malformed x-payload-signature header must be
// refused with a 401, never throw. 64 non-ASCII chars pass a string-length
// check against a 64-char hex signature but are 128 bytes in UTF-8, which
// made timingSafeEqual throw (and the request hang) before 0.3.1.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createCentralAuth } = require('../src/server/centralAuth');
const { generatePayloadSignature, verifyWebhookSignature } = require('../src/server/platformClient');

const KEY = 'test-key';
const BODY = { action: 'org.added', orgId: 'o-1', payload: { org: { id: 'o-1', name: 'Org' } } };
const NON_ASCII = 'é'.repeat(64);

test('verifyWebhookSignature accepts the right signature', () => {
  const req = { headers: { 'x-payload-signature': generatePayloadSignature(BODY, KEY) }, body: BODY };
  assert.equal(verifyWebhookSignature(req, KEY), true);
});

test('verifyWebhookSignature refuses wrong, missing and non-ASCII signatures without throwing', () => {
  for (const signature of ['0'.repeat(64), undefined, 'short', NON_ASCII]) {
    const req = { headers: { 'x-payload-signature': signature }, body: BODY };
    assert.equal(verifyWebhookSignature(req, KEY), false, `signature ${JSON.stringify(signature)}`);
  }
});

test('platformEvents answers a non-ASCII signature with 401', async () => {
  const auth = createCentralAuth({
    pool: { query: async (sql) => { throw new Error(`unexpected query: ${sql}`); } },
    jwtSecret: 'test-secret',
    payloadSignatureKey: KEY,
    roles: ['admin', 'viewer'],
    publicAppUrl: 'https://hub.example',
  });
  let status;
  const res = {
    on() {},
    status(code) { status = code; return this; },
    json() { return this; },
  };
  await auth.handlers.platformEvents({ headers: { 'x-payload-signature': NON_ASCII }, body: BODY }, res);
  assert.equal(status, 401);
});
