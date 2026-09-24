const jwt = require('jsonwebtoken');
const { alphalakeGetPasswordResetToken, alphalakeResetPassword } = require('./platformClient');

// Passwordless "magic link" flow: a signed link is emailed to a user for a
// specific resource (e.g. a record awaiting their review). Visiting it either
// sends an already-onboarded user straight to the resource, or — the first
// time — to a password-creation screen so they can set a platform password
// before ever visiting the Alphalake account portal directly.
//
// Requires `users.password_set BOOLEAN` in addition to the columns createCentralAuth needs.
function createReviewLink(opts) {
  const {
    pool,
    jwtSecret,
    publicAppUrl,
    alphalakeInternalApiUrl,
    alphalakeInternalApiKey,
    // (resourceId) => in-app hash route once a password is already set, e.g. '/review/123'.
    resourcePath = (resourceId) => `/review/${resourceId}`,
    // In-app hash route for first-time password creation.
    setPasswordPath = '/set-password',
    fileLog = () => {},
  } = opts;

  // Deliberately excludes `id` so it can never be accepted by a session-JWT
  // `authenticate` middleware — callers must verify it with verifyReviewLinkToken
  // instead. `tv` snapshots the recipient's token_version at send time so a
  // subsequent removal/demotion (which bumps it) also invalidates any
  // outstanding link, without needing a separate revocation list.
  const signReviewLinkToken = ({ email, resourceId, tv }) => jwt.sign(
    { email, resourceId, tv: tv || 0, purpose: 'review_link' },
    jwtSecret,
    { expiresIn: '7d' }
  );

  const verifyReviewLinkToken = (token) => {
    const decoded = jwt.verify(token, jwtSecret);
    if (decoded.purpose !== 'review_link') throw new Error('Invalid token purpose');
    return decoded;
  };

  // Entry point for the emailed link. GET so it works as a plain <a href>.
  const check = async (req, res) => {
    const token = req.query.token;
    if (!token || typeof token !== 'string') {
      return res.redirect(`${publicAppUrl}/#/?auth_error=invalid_link`);
    }
    try {
      const { email, resourceId, tv } = verifyReviewLinkToken(token);
      const { rows } = await pool.query('SELECT password_set, token_version FROM users WHERE email = $1', [email]);
      if (rows.length === 0 || rows[0].token_version !== (tv || 0)) {
        return res.redirect(`${publicAppUrl}/#/?auth_error=invalid_link`);
      }
      if (rows[0].password_set) {
        return res.redirect(`${publicAppUrl}/#${resourcePath(resourceId)}`);
      }
      return res.redirect(`${publicAppUrl}/#${setPasswordPath}?token=${encodeURIComponent(token)}`);
    } catch (err) {
      return res.redirect(`${publicAppUrl}/#/?auth_error=invalid_link`);
    }
  };

  // Validate-on-mount for the password-creation page.
  const validate = async (req, res) => {
    try {
      const { email, tv } = verifyReviewLinkToken(req.params.token);
      const { rows } = await pool.query('SELECT password_set, token_version FROM users WHERE email = $1', [email]);
      if (rows.length === 0 || rows[0].token_version !== (tv || 0)) return res.status(404).json({ error: 'Link not found or expired' });
      res.json({ email, alreadySet: rows[0].password_set });
    } catch (err) {
      res.status(404).json({ error: 'Link not found or expired' });
    }
  };

  // Creates the user's platform password via the Alphalake internal password-reset
  // API, then marks them as set up. Single-use: the atomic UPDATE only succeeds
  // while password_set is still false, so a replayed link can't silently
  // overwrite a password already in place.
  const setPassword = async (req, res) => {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'token and password are required' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

    let email;
    try {
      let tv;
      ({ email, tv } = verifyReviewLinkToken(token));
      const { rows } = await pool.query('SELECT password_set, token_version FROM users WHERE email = $1', [email]);
      if (rows.length === 0 || rows[0].token_version !== (tv || 0)) return res.status(404).json({ error: 'Link not found or expired' });
      if (rows[0].password_set) {
        return res.status(409).json({ error: 'A password has already been set for this account. Please sign in instead.' });
      }

      const apiOpts = { alphalakeInternalApiUrl, alphalakeInternalApiKey };
      const resetToken = await alphalakeGetPasswordResetToken(email, apiOpts);
      await alphalakeResetPassword(resetToken, password, apiOpts);
    } catch (err) {
      console.error('[ReviewLink] set-password failed:', err?.message);
      return res.status(502).json({ error: 'Failed to set password. Please try again or contact support.' });
    }

    // The platform password change above already succeeded — everything past
    // this point is bookkeeping, not something the user can fix by retrying.
    // Retry a few times to ride out transient DB blips; if it still won't
    // stick, tell the user the truth (their password works) and log loudly so
    // the password_set flag can be fixed manually.
    const MAX_ATTEMPTS = 3;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const { rows: updated } = await pool.query(
          `UPDATE users SET password_set = true, updated_at = NOW() WHERE email = $1 AND password_set = false RETURNING id`,
          [email]
        );
        if (updated.length > 0) fileLog('user-actions', { event: 'review_link_password_set', email });
        break;
      } catch (err) {
        if (attempt < MAX_ATTEMPTS) {
          await new Promise(r => setTimeout(r, 200 * attempt));
          continue;
        }
        console.error(`[ReviewLink] CRITICAL: platform password reset succeeded for ${email} but password_set failed to update after ${MAX_ATTEMPTS} attempts:`, err?.message);
        fileLog('user-actions', { event: 'review_link_password_set_flag_failed', email, error: err?.message });
      }
    }
    res.json({ success: true });
  };

  return {
    signReviewLinkToken,
    verifyReviewLinkToken,
    handlers: { check, validate, setPassword },
  };
}

module.exports = { createReviewLink };
