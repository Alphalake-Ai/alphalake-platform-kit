const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { getFirebaseAuth } = require('./firebase');
const { generatePayloadSignature } = require('./platformClient');

// Builds the Alphalake central-auth backend integration: session JWTs, the
// Firebase login callback, the inbound platform-events webhook (org/user
// lifecycle), and the auth/role middleware that goes with them.
//
// Requires the host app's Postgres schema to have (see README for full DDL):
//   users: id, email UNIQUE NOT NULL, name, role, org_id, firebase_uid,
//          image_url, phone, token_version INT DEFAULT 0, last_login_at
//   organisations: id, name, description, external_id UNIQUE, platform_entity_id
//   processed_webhook_events: signature TEXT PRIMARY KEY, created_at (see ensureSchema)
function createCentralAuth(opts) {
  const {
    pool,
    jwtSecret,
    payloadSignatureKey,
    // Ordered most- to least-privileged, e.g. ['admin', 'editor', 'viewer'].
    // Only used to validate/normalise inbound platform roles — has no bearing
    // on what any route actually permits (that's requireRole at the call site).
    roles,
    defaultRole = roles[roles.length - 1],
    publicAppUrl,
    // (user) => tab name appended to `${publicAppUrl}/#/<tab>` after login.
    landingPath = () => 'overview',
    // (localOrgId) => Promise<void> — app-specific hook for anything that needs
    // to react to a user being (re)provisioned or losing access, e.g. resyncing
    // a derived permissions table. Fired after user.added/user.updated/user.removed.
    // Defaults to a no-op so this module has no opinion on app-specific access models.
    onUserAccessChanged = async () => {},
    fileLog = () => {},
  } = opts;

  if (!jwtSecret) throw new Error('createCentralAuth: jwtSecret is required');
  // If unset, generatePayloadSignature() would sign/verify with an empty-string
  // key — a well-known constant any caller could reproduce, letting an attacker
  // forge platform webhooks. Fail closed rather than start with a forgeable endpoint.
  if (!payloadSignatureKey) throw new Error('createCentralAuth: payloadSignatureKey is required — refusing to start with a forgeable webhook endpoint');
  if (!Array.isArray(roles) || roles.length === 0) throw new Error('createCentralAuth: roles must be a non-empty array, most- to least-privileged');

  // Inbound: normalise a platform role onto ours. Unrecognised values fall back
  // to defaultRole, so an unknown role can never grant elevated access.
  const mapPlatformRole = (role) => {
    const normalised = String(role ?? '').trim().toLowerCase();
    return roles.includes(normalised) ? normalised : defaultRole;
  };

  // Mints a session JWT carrying the user's token_version (`tv`) at issue time.
  const signSession = (user) => jwt.sign(
    { id: user.id, email: user.email, role: user.role, org_id: user.org_id, tv: user.token_version || 0 },
    jwtSecret,
    { expiresIn: '7d' }
  );

  // Auth middleware: verifies JWT, attaches req.user, and rejects tokens whose
  // token_version no longer matches the DB — i.e. the user was demoted or
  // removed since this token was issued.
  const authenticate = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'No token provided' });
    try {
      const decoded = jwt.verify(token, jwtSecret);
      const { rows } = await pool.query('SELECT token_version FROM users WHERE id = $1', [decoded.id]);
      if (rows.length === 0 || rows[0].token_version !== (decoded.tv || 0)) {
        return res.status(401).json({ error: 'Invalid or expired token' });
      }
      req.user = decoded; // { id, email, role, org_id, tv }
      next();
    } catch (err) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
  };

  // Resolves the platform's orgId to this app's local organisations.id, or null
  // if no local org is mapped yet (e.g. org.added hasn't arrived).
  async function resolveLocalOrgId(externalOrgId) {
    if (!externalOrgId) return null;
    const { rows } = await pool.query('SELECT id FROM organisations WHERE external_id = $1', [externalOrgId]);
    return rows[0]?.id || null;
  }

  // Replay-guard schema for the webhook handler below — call once at startup.
  // 90-day retention comfortably covers realistic redelivery windows without
  // the table growing unbounded (webhook volume is low).
  async function ensureSchema() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS processed_webhook_events (
        signature TEXT PRIMARY KEY,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await pool.query(`DELETE FROM processed_webhook_events WHERE created_at < NOW() - INTERVAL '90 days'`);
  }

  // Central-auth login callback. The platform redirects the browser here with a
  // Firebase ID token in the URL (?token=...). Verify it, refresh the user's
  // profile from Firebase, mint our own session JWT, and hand it to the SPA via
  // the `_t` hash mechanism (see consumeTokenFromHash in the client package).
  const callback = async (req, res) => {
    const token = req.query.token;
    if (!token || typeof token !== 'string') {
      return res.redirect(`${publicAppUrl}/#/?auth_error=missing_token`);
    }
    try {
      const decoded = await getFirebaseAuth().verifyIdToken(token);
      const uid = decoded.uid;

      const { rows } = await pool.query('SELECT id, email, name, role, org_id FROM users WHERE firebase_uid = $1', [uid]);
      if (rows.length === 0 || !rows[0].org_id) {
        // Either not provisioned into this app yet (that happens via the
        // user.added webhook), or detached from their org by user.removed.
        return res.redirect(`${publicAppUrl}/#/?auth_error=not_provisioned`);
      }

      const fbUser = await getFirebaseAuth().getUser(uid);
      const { rows: updated } = await pool.query(
        `UPDATE users
           SET name = COALESCE($1, name),
               email = COALESCE($2, email),
               image_url = $3,
               phone = $4,
               last_login_at = NOW()
         WHERE firebase_uid = $5
         RETURNING id, email, name, role, org_id, token_version`,
        [fbUser.displayName || null, fbUser.email || null, fbUser.photoURL || null, fbUser.phoneNumber || null, uid]
      );
      const user = updated[0];

      const sessionToken = signSession(user);
      fileLog('user-actions', { event: 'login', userId: user.id, email: user.email, role: user.role, orgId: user.org_id });
      return res.redirect(`${publicAppUrl}/#/${landingPath(user)}?_t=${encodeURIComponent(sessionToken)}`);
    } catch (err) {
      console.error('[CentralAuth] callback failed:', err?.message);
      fileLog('user-actions', { event: 'login_failed', reason: err?.message });
      return res.redirect(`${publicAppUrl}/#/?auth_error=invalid_token`);
    }
  };

  // Re-pulls a user's profile fields from Firebase without a fresh login. Needed
  // because myaccount's /manage page just redirects back to `continue` rather
  // than round-tripping through the callback with a new ID token — without
  // this, a name/photo change made there wouldn't show up until the JWT expired.
  // Mount behind `authenticate`.
  const refreshProfile = async (req, res) => {
    try {
      const { rows } = await pool.query('SELECT firebase_uid FROM users WHERE id = $1', [req.user.id]);
      const uid = rows[0]?.firebase_uid;
      if (!uid) return res.status(404).json({ error: 'User not found' });

      const fbUser = await getFirebaseAuth().getUser(uid);
      await pool.query(
        `UPDATE users
           SET name = COALESCE($1, name),
               email = COALESCE($2, email),
               image_url = $3,
               phone = $4
         WHERE firebase_uid = $5`,
        [fbUser.displayName || null, fbUser.email || null, fbUser.photoURL || null, fbUser.phoneNumber || null, uid]
      );
      res.json({ ok: true });
    } catch (err) {
      console.error('[CentralAuth] refresh-profile failed:', err?.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  // Inbound platform webhooks. The platform pushes user/org/subscription lifecycle
  // events here to keep this app's DB in sync. All handlers are idempotent so
  // redelivered events are safe. Body: { action, entityId, orgId, payload }.
  const platformEvents = async (req, res) => {
    // Verify the HMAC signature (x-payload-signature) against the shared key.
    const signature = req.headers['x-payload-signature'];
    const expected = generatePayloadSignature(req.body, payloadSignatureKey);
    const sigOk =
      typeof signature === 'string' &&
      signature.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));

    const { action, orgId, entityId, payload } = req.body || {};

    // Replay guard: an identical byte-for-byte redelivery always hashes to the
    // same signature. Recording it lets a genuine platform retry still get its
    // expected idempotent-success response without re-running the write.
    let duplicate = false;
    if (sigOk) {
      const { rows: dedupRows } = await pool.query(
        `INSERT INTO processed_webhook_events (signature) VALUES ($1) ON CONFLICT DO NOTHING RETURNING signature`,
        [expected]
      );
      duplicate = dedupRows.length === 0;
    }

    fileLog('webhooks', { direction: 'in', action, orgId, entityId, sigOk, duplicate, payload });
    res.on('finish', () => fileLog('webhooks', { direction: 'in', action, orgId, phase: 'result', status: res.statusCode }));

    if (!sigOk) return res.status(401).json({ error: 'Invalid signature' });
    if (duplicate) return res.json({ ok: true, duplicate: true });
    if (!action || !payload) return res.status(400).json({ error: 'action and payload are required' });

    try {
      switch (action) {
        case 'org.added':
        case 'org.updated': {
          const org = payload.org || {};
          if (!org.id) return res.status(400).json({ error: 'org payload requires an id' });
          await pool.query(
            `INSERT INTO organisations (name, description, external_id, platform_entity_id)
               VALUES ($1, $2, $3, $4)
             ON CONFLICT (external_id) DO UPDATE
               SET name = EXCLUDED.name,
                   description = EXCLUDED.description,
                   platform_entity_id = COALESCE(EXCLUDED.platform_entity_id, organisations.platform_entity_id)`,
            [org.name || 'Organisation', org.description || null, org.id, entityId || null]
          );
          break;
        }

        case 'user.added': {
          const u = payload.user || {};
          if (!orgId) return res.status(400).json({ error: 'user.added requires an orgId' });
          // Provision the org on demand — org.added is NOT guaranteed to arrive
          // first. Upsert a stub keyed by orgId; a later org.added/org.updated
          // fills in the real name/description.
          const { rows: orgRows } = await pool.query(
            `INSERT INTO organisations (name, external_id, platform_entity_id)
               VALUES ($1, $2, $3)
             ON CONFLICT (external_id) DO UPDATE
               SET platform_entity_id = COALESCE(EXCLUDED.platform_entity_id, organisations.platform_entity_id)
             RETURNING id`,
            [orgId, orgId, entityId || null]
          );
          const localOrgId = orgRows[0].id;
          if (!u.email) return res.status(400).json({ error: 'user.added payload requires an email' });

          // Guard against one org's event silently reassigning a user who is
          // currently an active member of a DIFFERENT org. A legitimate transfer
          // is expected to arrive as user.removed before the new org's user.added.
          const { rows: existingRows } = await pool.query(
            `SELECT org_id FROM users WHERE firebase_uid = $1 OR email = $2`,
            [u.id, u.email]
          );
          const conflict = existingRows.find(r => r.org_id && r.org_id !== localOrgId);
          if (conflict) {
            console.warn(`[CentralAuth] user.added: refusing to move ${u.email} into org ${localOrgId} — already active in a different org. Send user.removed first if this is an intentional transfer.`);
            return res.json({ ok: true, skipped: 'user already active in a different org' });
          }

          const fields = [u.id, u.email, u.name || null, u.image || null, u.phone || null, mapPlatformRole(payload.role), localOrgId];
          try {
            await pool.query(
              `INSERT INTO users (firebase_uid, email, name, image_url, phone, role, org_id)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)
               ON CONFLICT (firebase_uid) DO UPDATE
                 SET email = EXCLUDED.email,
                     name = EXCLUDED.name,
                     image_url = EXCLUDED.image_url,
                     phone = EXCLUDED.phone,
                     role = EXCLUDED.role,
                     org_id = EXCLUDED.org_id`,
              fields
            );
          } catch (err) {
            // ON CONFLICT only covers firebase_uid. If the email is already taken
            // by another row, adopt that row and link this firebase_uid to it
            // rather than failing the webhook into a retry loop.
            if (err?.code !== '23505') throw err;
            const { rowCount } = await pool.query(
              `UPDATE users
                  SET firebase_uid = $1, name = $3, image_url = $4, phone = $5, role = $6, org_id = $7
                WHERE email = $2`,
              fields
            );
            if (rowCount === 0) throw err;
            console.warn(`[CentralAuth] user.added: linked existing account ${u.email} to uid ${u.id}`);
          }
          await onUserAccessChanged(localOrgId);
          break;
        }

        case 'user.updated': {
          const u = payload.user || {};
          // role/isOrgAdmin are optional — absent means "leave unchanged".
          let role = payload.role != null
            ? mapPlatformRole(payload.role)
            : (payload.isOrgAdmin === true ? roles[0] : null);
          let email = u.email || null;

          // A role or email change is only applied if the target user is still
          // recorded as belonging to the org issuing this event — otherwise a
          // stale or cross-org event could reach into an org this user has
          // already left. Profile-only fields (name/image/phone) are harmless
          // and always applied regardless of org.
          let updatedOrgId = null;
          if (role !== null || email !== null) {
            updatedOrgId = await resolveLocalOrgId(orgId);
            const { rows: targetRows } = await pool.query('SELECT org_id FROM users WHERE firebase_uid = $1', [u.id]);
            if (!targetRows[0] || targetRows[0].org_id !== updatedOrgId) {
              console.warn(`[CentralAuth] user.updated: ignoring role/email change for uid ${u.id} — event's org doesn't match the user's current org.`);
              role = null;
              email = null;
              updatedOrgId = null;
            }
          }
          // Bump token_version only when the role actually changed, invalidating
          // any outstanding JWT for this user.
          const updateFields = (withEmail) => pool.query(
            `UPDATE users
               SET name = COALESCE($1, name),
                   image_url = COALESCE($2, image_url),
                   phone = COALESCE($3, phone),
                   role = COALESCE($4, role),
                   email = CASE WHEN $6 THEN COALESCE($5, email) ELSE email END,
                   token_version = CASE WHEN $4 IS NOT NULL THEN token_version + 1 ELSE token_version END
             WHERE firebase_uid = $7`,
            [u.name || null, u.image || null, u.phone || null, role, email, withEmail, u.id]
          );
          try {
            await updateFields(true);
          } catch (err) {
            // users.email is globally UNIQUE — a stale local row (or two orgs'
            // events racing) can collide. Retry without email so the rest of
            // the update still lands instead of failing forever on redelivery.
            if (err?.code !== '23505' || !email) throw err;
            console.warn(`[CentralAuth] user.updated: email ${email} already in use by another account, applying other fields only for uid ${u.id}`);
            await updateFields(false);
            email = null;
          }
          if (updatedOrgId) await onUserAccessChanged(updatedOrgId);
          break;
        }

        case 'user.removed': {
          // Soft-detach: keeps the row (and firebase_uid, so a re-add revives
          // it), preserving any FK attribution on historical records. Idempotent,
          // so the echo of this app's own outbound user.removed is a no-op.
          // token_version bump invalidates any outstanding JWT immediately.
          //
          // Scoped to the issuing org's local id — without this, any org's
          // user.removed for a given firebase_uid would detach that user from
          // whatever org they're ACTUALLY in, even an unrelated one.
          const u = payload.user || {};
          const localOrgId = await resolveLocalOrgId(orgId);
          const { rows: detached } = await pool.query(
            `UPDATE users SET org_id = NULL, role = $3, token_version = token_version + 1
              WHERE firebase_uid = $1 AND org_id = $2 RETURNING id`,
            [u.id, localOrgId, defaultRole]
          );
          if (detached.length > 0) {
            await onUserAccessChanged(localOrgId);
          } else {
            console.warn(`[CentralAuth] user.removed: no-op for uid ${u.id} — not currently a member of the issuing org.`);
          }
          break;
        }

        case 'org.removed': {
          const org = payload.org || {};
          // Detach mapping so the org can no longer be addressed; keep the row/data.
          await pool.query(
            'UPDATE organisations SET external_id = NULL, platform_entity_id = NULL WHERE external_id = $1',
            [org.id || orgId]
          );
          break;
        }

        case 'subscription.added':
        case 'subscription.updated':
        case 'subscription.removed':
          // Subscription enforcement is left to the host app — acknowledge and drop.
          break;

        default:
          return res.status(400).json({ error: `Unknown action: ${action}` });
      }

      return res.json({ ok: true });
    } catch (err) {
      console.error(`[CentralAuth] webhook ${action} failed:`, err?.message);
      return res.status(500).json({ error: 'Internal server error' });
    }
  };

  return {
    authenticate,
    signSession,
    mapPlatformRole,
    resolveLocalOrgId,
    ensureSchema,
    handlers: { callback, refreshProfile, platformEvents },
  };
}

module.exports = { createCentralAuth };
