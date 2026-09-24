const { createCentralAuth } = require('./centralAuth');
const { createReviewLink } = require('./reviewLink');
const { getFirebaseAuth, buildFirebaseCredential } = require('./firebase');
const {
  generatePayloadSignature,
  verifyWebhookSignature,
  postModuleEvent,
  alphalakeGetPasswordResetToken,
  alphalakeResetPassword,
} = require('./platformClient');

// Generic role-gate middleware — not central-auth specific, just bundled here
// since every route that uses createCentralAuth also needs it.
const requireRole = (...allowed) => (req, res, next) => {
  if (!allowed.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
  next();
};

module.exports = {
  createCentralAuth,
  createReviewLink,
  requireRole,
  getFirebaseAuth,
  buildFirebaseCredential,
  generatePayloadSignature,
  verifyWebhookSignature,
  postModuleEvent,
  alphalakeGetPasswordResetToken,
  alphalakeResetPassword,
};
