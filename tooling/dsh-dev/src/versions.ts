/**
 * Orders two semantic versions (`major.minor.patch[-prerelease]`), as SemVer 2.0 does:
 * a prerelease comes before its release, and prerelease identifiers compare numerically
 * when both are numbers, as text otherwise.
 * @returns a negative number, zero, or a positive number, as `a` is lower, equal, or higher.
 */
export function compareVersions(a: string, b: string): number {
  const [coreA = '', preA] = splitVersion(a);
  const [coreB = '', preB] = splitVersion(b);
  const core = compareIdentifiers(coreA.split('.'), coreB.split('.'), true);
  if (core !== 0) return core;
  if (preA === undefined || preB === undefined) {
    return preA === preB ? 0 : preA === undefined ? 1 : -1;
  }
  return compareIdentifiers(preA.split('.'), preB.split('.'), false);
}

/** The version's core and its prerelease, without build metadata. */
function splitVersion(version: string): [string, string | undefined] {
  const withoutBuild = version.split('+', 1)[0] ?? '';
  const dash = withoutBuild.indexOf('-');
  return dash === -1
    ? [withoutBuild, undefined]
    : [withoutBuild.slice(0, dash), withoutBuild.slice(dash + 1)];
}

function compareIdentifiers(a: readonly string[], b: readonly string[], numeric: boolean): number {
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const left = a[index];
    const right = b[index];
    // A shorter prerelease comes first; a missing core part counts as zero.
    if (left === undefined || right === undefined) {
      if (numeric) return Number(left ?? 0) - Number(right ?? 0) || 0;
      return left === undefined ? -1 : 1;
    }
    const order = compareIdentifier(left, right);
    if (order !== 0) return order;
  }
  return 0;
}

function compareIdentifier(a: string, b: string): number {
  const numberA = /^\d+$/.test(a) ? Number(a) : undefined;
  const numberB = /^\d+$/.test(b) ? Number(b) : undefined;
  if (numberA !== undefined && numberB !== undefined) return numberA - numberB;
  // Numeric identifiers come before alphanumeric ones.
  if (numberA !== undefined) return -1;
  if (numberB !== undefined) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}
