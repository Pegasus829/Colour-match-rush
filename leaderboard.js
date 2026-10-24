// Stored scores are untrusted. Callers must render the returned plain data as text.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.CMRLeaderboard = api;
})(globalThis, function () {
  const MAX_ENTRIES = 8;
  const MIN_WHEN = Date.UTC(2020, 0, 1);
  const MAX_WHEN = Date.UTC(2100, 0, 1);

  function isValidEntry(entry) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return false;
    if (!Number.isSafeInteger(entry.score) || entry.score < 0) return false;
    if (!Number.isSafeInteger(entry.when)) return false;
    if (entry.when < MIN_WHEN || entry.when > MAX_WHEN) return false;
    return true;
  }

  function topEntries(entries) {
    if (!Array.isArray(entries)) return [];
    const clean = [];
    for (const entry of entries) {
      if (!isValidEntry(entry)) continue;
      clean.push({ score: entry.score, when: entry.when });
    }
    clean.sort((a, b) => b.score - a.score);
    return clean.slice(0, MAX_ENTRIES);
  }

  return { MAX_ENTRIES, MIN_WHEN, MAX_WHEN, isValidEntry, topEntries };
});
