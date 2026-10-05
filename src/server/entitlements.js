const { alphalakeGetOrgSubscriptions } = require('./platformClient');

// Which of this app's hubs an org subscribes to, read from the platform's
// subscriptions API and cached in memory per org.
//
// `hubs` maps the app's own hub names to platform masterEntityIds, e.g.
// { repeats: 'rp-hub', cardex: 'meds-reader' }. An org has a hub when any of
// its subscriptions is for that masterEntityId; paused/expiry are not looked
// at. Lookup failures are thrown, never cached, so the caller decides.
function createEntitlements({ hubs, alphalakeInternalApiUrl, alphalakeInternalApiKey, ttlMs = 5 * 60 * 1000 }) {
  if (!hubs || typeof hubs !== 'object' || Object.keys(hubs).length === 0) {
    throw new Error('createEntitlements: hubs must map hub names to platform masterEntityIds');
  }
  const config = { alphalakeInternalApiUrl, alphalakeInternalApiKey };
  const hubByMaster = new Map(Object.entries(hubs).map(([hub, master]) => [master, hub]));
  const cache = new Map(); // externalOrgId -> { at, entityIds: Map<hub, entityId> }
  const inFlight = new Map(); // externalOrgId -> Promise

  async function load(externalOrgId) {
    const subscriptions = await alphalakeGetOrgSubscriptions(externalOrgId, config);
    const entityIds = new Map();
    for (const s of subscriptions) {
      const hub = hubByMaster.get(s?.entity?.masterEntityId);
      if (hub && !entityIds.has(hub)) entityIds.set(hub, s.entityId);
    }
    cache.set(externalOrgId, { at: Date.now(), entityIds });
    return entityIds;
  }

  // Map<hub, the org's entityId for it>, only for hubs the org subscribes to.
  async function subscribedHubs(externalOrgId) {
    if (!externalOrgId) return new Map();
    const hit = cache.get(externalOrgId);
    if (hit && Date.now() - hit.at < ttlMs) return hit.entityIds;
    if (!inFlight.has(externalOrgId)) {
      inFlight.set(externalOrgId, load(externalOrgId).finally(() => inFlight.delete(externalOrgId)));
    }
    return inFlight.get(externalOrgId);
  }

  return {
    hubs: Object.keys(hubs),
    /** Set of this app's hub names the org subscribes to. */
    orgHubs: async (externalOrgId) => new Set((await subscribedHubs(externalOrgId)).keys()),
    /** The org's own platform entityId for a hub, or null when it doesn't subscribe. */
    hubEntityId: async (externalOrgId, hub) => (await subscribedHubs(externalOrgId)).get(hub) ?? null,
    /** Forget cached answers for one org, or for every org when called without one. */
    invalidate: (externalOrgId) => (externalOrgId ? cache.delete(externalOrgId) : cache.clear()),
  };
}

module.exports = { createEntitlements };
