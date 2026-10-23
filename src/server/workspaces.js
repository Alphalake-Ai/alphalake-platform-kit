const { alphalakeGetOrgSubscriptions, alphalakeGetUserEntities } = require('./platformClient');

// The workspaces a user can switch to from this app's top bar, read from the
// platform's subscriptions and user-entities APIs and cached in memory per
// org + user.
//
// `workspaceMasterEntityId` is this app's own workspace (e.g. 'meds-workspace').
// A workspace is listed when it sits in the same cloud as this app's, the org
// subscribes to it, and the user is assigned to at least one hub in it. This
// app's workspace is always listed (first, marked current), even with no hubs.
// Lookup failures are thrown, never cached, so the caller decides.
function createWorkspaces({ workspaceMasterEntityId, alphalakeInternalApiUrl, alphalakeInternalApiKey, ttlMs = 60 * 1000 }) {
  if (!workspaceMasterEntityId) throw new Error('createWorkspaces: workspaceMasterEntityId is required');
  const config = { alphalakeInternalApiUrl, alphalakeInternalApiKey };
  const cache = new Map(); // `${org}:${uid}` -> { at, result }
  const inFlight = new Map(); // same key -> Promise

  async function load(key, externalOrgId, firebaseUid) {
    const [subscriptions, userEntities] = await Promise.all([
      alphalakeGetOrgSubscriptions(externalOrgId, config),
      alphalakeGetUserEntities(firebaseUid, config),
    ]);

    const orgEntities = subscriptions.map(s => s?.entity).filter(e => e && e.orgId === externalOrgId);
    const current = orgEntities.find(e => e.type === 'workspace' && e.masterEntityId === workspaceMasterEntityId);
    const cloud = current?.parentId ? orgEntities.find(e => e.id === current.parentId) : undefined;

    // Workspaces holding a hub the user is assigned to, in their own org.
    const userWorkspaceIds = new Set(
      userEntities
        .filter(e => e?.type === 'hub' && e.orgId === externalOrgId && e.parentId)
        .map(e => e.parentId)
    );

    const workspaces = orgEntities
      .filter(e => e.type === 'workspace')
      .filter(e => (cloud ? e.parentId === cloud.id : e === current))
      .filter(e => e === current || userWorkspaceIds.has(e.id))
      .map(e => ({
        id: e.id,
        masterEntityId: e.masterEntityId,
        name: e.name,
        description: e.description ?? null,
        subType: e.subType ?? null,
        current: e === current,
      }))
      .sort((a, b) => Number(b.current) - Number(a.current) || String(a.name).localeCompare(String(b.name)));

    const result = { cloud: cloud ? { id: cloud.id, name: cloud.name } : null, workspaces };
    cache.set(key, { at: Date.now(), result });
    return result;
  }

  return {
    /** { cloud: { id, name } | null, workspaces: [{ id, masterEntityId, name, description, subType, current }] } */
    listForUser: async (externalOrgId, firebaseUid) => {
      if (!externalOrgId || !firebaseUid) return { cloud: null, workspaces: [] };
      const key = `${externalOrgId}:${firebaseUid}`;
      const hit = cache.get(key);
      if (hit && Date.now() - hit.at < ttlMs) return hit.result;
      if (!inFlight.has(key)) {
        inFlight.set(key, load(key, externalOrgId, firebaseUid).finally(() => inFlight.delete(key)));
      }
      return inFlight.get(key);
    },
    /** Forget every cached answer. */
    invalidate: () => cache.clear(),
  };
}

module.exports = { createWorkspaces };
