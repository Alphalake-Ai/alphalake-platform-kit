const { createCentralAuth } = require('./centralAuth');
const { createReviewLink } = require('./reviewLink');
const { createEntitlements } = require('./entitlements');
const { createWorkspaces } = require('./workspaces');
const { getFirebaseAuth, buildFirebaseCredential } = require('./firebase');
const {
  generatePayloadSignature,
  verifyWebhookSignature,
  postModuleEvent,
  alphalakeGetPasswordResetToken,
  alphalakeResetPassword,
  alphalakeGetOrgSubscriptions,
  alphalakeGetUserEntities,
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
  createEntitlements,
  createWorkspaces,
  requireRole,
  getFirebaseAuth,
  buildFirebaseCredential,
  generatePayloadSignature,
  verifyWebhookSignature,
  postModuleEvent,
  alphalakeGetPasswordResetToken,
  alphalakeResetPassword,
  alphalakeGetOrgSubscriptions,
  alphalakeGetUserEntities,
};
