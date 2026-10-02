// Platform webhook handlers against a real Postgres (the behaviour is in the
// SQL). Skipped unless TEST_DATABASE_URL is set. Runs in its own throwaway
// schema, dropped afterwards, so any dev database will do:
//   TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/db npm test
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { after, before, describe, test } = require('node:test');
const { createCentralAuth } = require('../src/server/centralAuth');
const { generatePayloadSignature } = require('../src/server/platformClient');

const url = process.env.TEST_DATABASE_URL;
const KEY = 'test-key';
const ORG = 'platform-org-1';
const UID = 'fb-uid-1';

describe('platform webhooks (Postgres)', { skip: !url && 'TEST_DATABASE_URL not set' }, () => {
  const schema = `kit_test_${crypto.randomBytes(4).toString('hex')}`;
  let pool;
  let auth;

  before(async () => {
    const { Pool } = require('pg');
    const admin = new Pool({ connectionString: url, max: 1 });
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.end();
    pool = new Pool({ connectionString: url, max: 2, options: `-c search_path=${schema}` });
    await pool.query(`
      CREATE TABLE organisations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL, description TEXT,
        external_id TEXT UNIQUE, platform_entity_id TEXT
      )`);
    await pool.query(`
      CREATE TABLE users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email TEXT UNIQUE NOT NULL, name TEXT, role TEXT NOT NULL DEFAULT 'viewer',
        org_id UUID REFERENCES organisations(id), firebase_uid TEXT UNIQUE,
        image_url TEXT, phone TEXT, token_version INT NOT NULL DEFAULT 0, last_login_at TIMESTAMPTZ
      )`);
    auth = createCentralAuth({ pool, jwtSecret: 'x', payloadSignatureKey: KEY, roles: ['admin', 'staff', 'viewer'], publicAppUrl: 'https://hub.example' });
    await auth.ensureSchema();
  });

  after(async () => {
    if (!pool) return;
    await pool.query(`DROP SCHEMA ${schema} CASCADE`);
    await pool.end();
  });

  async function send(body) {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(b) { this.body = b; return this; },
      on() {},
    };
    await auth.handlers.platformEvents({ headers: { 'x-payload-signature': generatePayloadSignature(body, KEY) }, body }, res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    return res.body;
  }

  const added = (role) => ({ action: 'user.added', orgId: ORG, entityId: 'e1', payload: { role, user: { id: UID, email: 'sam@example.com', name: 'Sam' } } });
  const removed = { action: 'user.removed', orgId: ORG, entityId: 'e1', payload: { user: { id: UID } } };
  const updated = (role) => ({ action: 'user.updated', orgId: ORG, entityId: 'e1', payload: { role, user: { id: UID } } });

  async function sam() {
    const { rows } = await pool.query(
      `SELECT u.role, u.token_version AS tv, o.external_id AS org FROM users u LEFT JOIN organisations o ON o.id = u.org_id WHERE firebase_uid = $1`,
      [UID]
    );
    return rows[0];
  }

  test('a second identical user.removed after a re-add is applied', async () => {
    await send(added('staff'));
    await send(removed);
    await send(added('admin'));
    assert.equal((await sam()).org, ORG);
    await send(removed); // byte-identical to the first removal
    assert.equal((await sam()).org, null);
  });

  test('a re-add identical to the first add is applied', async () => {
    await send(added('staff'));
    await send(removed);
    await send(added('staff')); // byte-identical to the first add
    const s = await sam();
    assert.equal(s.org, ORG);
    assert.equal(s.role, 'staff');
  });

  test('a role toggled back and forth ends on the last role, ending sessions only on real changes', async () => {
    await send(updated('admin'));
    const start = (await sam()).tv;
    await send(updated('staff'));
    await send(updated('admin')); // identical to the first
    await send(updated('staff')); // identical to the second
    assert.equal((await sam()).role, 'staff');
    assert.equal((await sam()).tv, start + 3);

    await send(updated('staff')); // same role again: no logout
    assert.equal((await sam()).tv, start + 3);
  });

  test('user.added on an existing member bumps token_version only when the role changes', async () => {
    const before = (await sam()).tv;
    await send(added('staff')); // already staff in this org
    assert.equal((await sam()).tv, before);
    await send(added('admin'));
    assert.deepEqual([(await sam()).role, (await sam()).tv], ['admin', before + 1]);
  });

  test('duplicates are still recorded as such', async () => {
    const body = updated('viewer');
    await send(body);
    await send(body);
    const sig = generatePayloadSignature(body, KEY);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM processed_webhook_events WHERE signature = $1', [sig]);
    assert.equal(rows[0].n, 1);
    assert.equal((await sam()).role, 'viewer');
  });
});
