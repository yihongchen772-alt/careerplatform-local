// Where a tab's last 网申 ended in its history (`mark`), and the pages since.
// Pages up to the mark belong to that 网申: a job title read from them would
// name it, not the next one in the same tab (「上一个」).

/** The mark for the page now showing. `recorded`: the 网申 was recorded, not only seen succeed. */
function historyMarkAt(entries, index, recorded, now = Date.now()) {
  return { index, url: entries[index]?.url || "", at: now, recorded };
}

/**
 * The history entries after the mark. A success seen but not recorded still
 * counts until the next send: the dialog may yet record that one, from the
 * pages that led to it.
 */
function historySinceMark(mark, lastSendAt, entries) {
  if (!mark || (!mark.recorded && !(lastSendAt > mark.at))) return entries;
  // The entry the mark points at, or the same address found again if the list shifted.
  let at = entries[mark.index]?.url === mark.url ? mark.index : entries.map((entry) => entry.url).lastIndexOf(mark.url);
  if (at < 0) at = Math.min(mark.index, entries.length - 1);
  return entries.slice(at + 1);
}

module.exports = { historyMarkAt, historySinceMark };
