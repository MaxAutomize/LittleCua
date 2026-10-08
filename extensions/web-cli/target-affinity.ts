// Remember only explicitly resolved URL targets, never "active", titles, or
// indexes. An application redirect changes its URL, not its exact tab identity.
// A closed/rejected pinned tab must fail; this cache never chooses another tab.
export function createUrlTargetAffinity(limit = 32) {
  const targets = new Map<string, string>();
  return {
    async pin(target: string, resolve: (target: string) => Promise<string>): Promise<string> {
      if (!/^https?:\/\//i.test(target)) return target;
      const known = targets.get(target);
      if (known) return known;
      const pinned = await resolve(target);
      if (!/^tab:[1-9]\d*$/.test(pinned)) throw new Error('URL target did not resolve to an exact Chrome tab; no action dispatched.');
      targets.set(target, pinned);
      if (targets.size > limit) targets.delete(targets.keys().next().value!);
      return pinned;
    },
  };
}
