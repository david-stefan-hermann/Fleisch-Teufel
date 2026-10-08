/**
 * Which diary groups (`groupId`) are expanded. Lives in `sessionStorage` so it survives a visit to an
 * entry page and back, while a fresh app start begins collapsed. Group ids are globally unique, so no
 * date is needed.
 */
const KEY = 'ft.diary.expanded';

export function readExpanded(): Set<string> {
  try {
    const raw: unknown = JSON.parse(sessionStorage.getItem(KEY) ?? '[]');
    return new Set(Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : []);
  } catch {
    return new Set();
  }
}

export function writeExpanded(set: ReadonlySet<string>): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify([...set]));
  } catch {
    // Storage full or blocked (private mode): the state just does not survive navigation.
  }
}

/** Remembers one group as expanded or collapsed. */
export function setGroupExpanded(groupId: string, expanded: boolean): void {
  const set = readExpanded();
  if (expanded) set.add(groupId);
  else set.delete(groupId);
  writeExpanded(set);
}
