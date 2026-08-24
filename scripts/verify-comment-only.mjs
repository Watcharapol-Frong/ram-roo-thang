// Checks that the uncommitted diff touches comments only.
//
// Used while translating the Thai comments to English. The risk is editing a Thai string that is
// actually shown to users (Flex text, toasts, error messages) — those look identical to comments at
// a glance because both are Thai.
//
// Two shapes count as safe:
//   1. The whole line is a comment (starts with //, #, --, * or /*).
//   2. The line is code followed by a trailing comment, and everything before the comment marker is
//      byte-identical between the removed and added version.
//
// Anything else is reported. Must print "PASS" before committing.
import { execSync } from 'node:child_process';

const FULL_LINE_COMMENT = /^\s*(\/\/|#|--|\*|\/\*)/;

// Strips a trailing comment, ignoring markers that sit inside a quoted string. Good enough for this
// codebase: it is only used to compare two versions of the same line against each other.
function codePart(line) {
  let quote = null;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (quote) {
      if (c === '\\') { i += 1; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '/' && line[i + 1] === '/') return line.slice(0, i);
    if (c === '-' && line[i + 1] === '-') return line.slice(0, i);
    if (c === '#') return line.slice(0, i);
  }
  return line;
}

const diff = execSync('git diff -U0', { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });

// Group changed lines per file so a removed line can be matched with its added counterpart.
const perFile = new Map();
let file = null;
for (const line of diff.split('\n')) {
  if (line.startsWith('+++ b/')) { file = line.slice(6); perFile.set(file, { minus: [], plus: [] }); continue; }
  if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@') || line.startsWith('diff ')) continue;
  if (!file) continue;
  if (line.startsWith('-')) perFile.get(file).minus.push(line.slice(1));
  else if (line.startsWith('+')) perFile.get(file).plus.push(line.slice(1));
}

const offenders = [];
for (const [name, { minus, plus }] of perFile) {
  // Lines that are entirely comments (or blank) need no pairing at all.
  const rest = (arr) => arr.filter((l) => l.trim() !== '' && !FULL_LINE_COMMENT.test(l));
  const m = rest(minus);
  const p = rest(plus);

  // What is left must pair up one-to-one with an identical code prefix.
  const usedPlus = new Set();
  for (const removed of m) {
    const target = codePart(removed);
    const idx = p.findIndex((added, i) => !usedPlus.has(i) && codePart(added) === target);
    if (idx === -1) {
      offenders.push(`${name}: ${removed.trim().slice(0, 100)}`);
      continue;
    }
    usedPlus.add(idx);
  }
  p.forEach((added, i) => {
    if (!usedPlus.has(i)) offenders.push(`${name}: (added) ${added.trim().slice(0, 100)}`);
  });
}

if (offenders.length) {
  console.log(`FAIL — ${offenders.length} change(s) touched something other than a comment:`);
  offenders.slice(0, 30).forEach((o) => console.log('  ' + o));
  process.exit(1);
}
console.log('PASS — the diff only changes comments');
