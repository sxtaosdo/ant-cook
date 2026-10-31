import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { ASYNC_PROFILES, checkAsyncReference, checkAsyncFailureReference, findAsyncWinningTrace, findAsyncFailureTrace } from './asyncDifficultyReplay.mjs';
import { compileThemeCsv, csvRows } from './compileThemeCsv.mjs';
import { blockingClosure, certifyBlockingPrefixes, createSolver, proveNormalizedMinimum } from './levelDifficultySolver.mjs';

const symbolColors = ['berry', 'citrus', 'leaf', 'plum', 'blue', 'cocoa', 'gold', 'orange', 'yellow', 'white', 'cream', 'charcoal'];
const firstTheme = {
  2: { kind: 'S', capacity: 2 },
  3: { kind: 'S', capacity: 2, colors: ['gold', 'cocoa', 'yellow'] },
  4: { kind: 'H', capacity: 3, colors: ['gold', 'cream', 'leaf'] },
  5: { kind: 'E', capacity: 1 },
  6: { kind: 'E', capacity: 1 },
  7: { kind: 'H', capacity: 3 },
  8: { kind: 'E', capacity: 1 },
  9: { kind: 'S', capacity: 2, colors: ['yellow', 'cream', 'leaf'] },
  10: { kind: 'H', capacity: 3, colors: ['orange', 'berry', 'gold'] },
  11: { kind: 'E', capacity: 1 },
  12: { kind: 'S', capacity: 2, colors: ['charcoal', 'berry'] },
};

export function difficultyTarget(level) {
  if (level <= 12) return firstTheme[level] ?? { kind: 'E', capacity: 1 };
  const local = (level - 1) % 12 + 1, theme = Math.floor((level - 1) / 12);
  const kind = [2, 5, 8, 11].includes(local) ? 'E' : [4, 7, 10].includes(local) ? 'H' : 'S';
  return { kind, capacity: kind === 'E' ? 1 : kind === 'H' ? (theme < 2 ? 3 : 4) : (theme < 2 ? 2 : 3),
    ...(level === 33 ? { maximumDepth: 9 } : [28, 34, 51].includes(level) ? { maximumDepth: 12 } : {}),
    ...(level === 37 ? { colors: ['leaf', 'charcoal', 'orange', 'white', 'cocoa'], minimumGroups: 18, productionPiles: 1 } : {}),
    ...(level === 51 ? { colors: ['charcoal', 'cocoa', 'gold', 'yellow'], minimumGroups: 24, productionPiles: 1 } : {}) };
}

function randomSource(seed) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
}

// Extend a one-cell accent to its nearest common-colored neighbor so its
// delivery can contain two cells. Preserve the palette, silhouette and geometry.
export function prepareContent(level) {
  if (level.level === 1) return level;
  const counts = Object.fromEntries(symbolColors.map(color => [color, level.cells.filter(cell => cell.color === color).length]));
  const cells = level.cells.map(cell => ({ ...cell }));
  for (const cell of level.cells.filter(cell => counts[cell.color] === 1)) {
    const neighbor = cells.filter(other => counts[other.color] > 2).sort((a, b) =>
      Math.abs(a.row - cell.row) + Math.abs(a.column - cell.column) - Math.abs(b.row - cell.row) - Math.abs(b.column - cell.column)
      || counts[b.color] - counts[a.color])[0];
    if (!neighbor) throw new Error(`Level ${level.level}: no common-colored neighbor for singleton accent`);
    counts[neighbor.color] -= 1; counts[cell.color] += 1; neighbor.color = cell.color;
  }
  const groups = level.groups.map(group => ({ ...group }));
  for (const color of symbolColors) {
    const total = cells.filter(cell => cell.color === color).length;
    const same = groups.filter(group => group.color === color);
    if (!total) { for (const group of same) groups.splice(groups.indexOf(group), 1); continue; }
    const oldTotal = same.reduce((sum, group) => sum + group.count, 0);
    if (oldTotal !== total) {
      const retained = Math.min(same.length, Math.floor(total / 2));
      if (!retained) throw new Error(`Level ${level.level}: missing delivery color ${color}`);
      same.forEach((group, index) => {
        if (index >= retained) groups.splice(groups.indexOf(group), 1);
        else group.count = Math.floor(total / retained) + (index < total % retained ? 1 : 0);
      });
    }
    for (const group of same.filter(group => group.count === 1)) {
      if (!groups.includes(group) || group.count !== 1) continue;
      const donor = same.find(other => other !== group && groups.includes(other) && other.count > 2);
      if (donor) { donor.count -= 1; group.count = 2; }
      else {
        const destination = same.find(other => other !== group && groups.includes(other) && other.count < 50);
        if (!destination) throw new Error(`Level ${level.level}: cannot merge singleton group`);
        destination.count += 1; groups.splice(groups.indexOf(group), 1);
      }
    }
  }
  for (const group of [...groups]) {
    while (group.count > 50) {
      const amount = group.count === 51 ? 2 : 50;
      group.count -= amount;
      groups.push({ ...group, count: amount, depth: Infinity });
    }
  }
  for (let pile = 0; pile < 5; pile += 1) groups.filter(group => group.pile === pile).sort((a, b) => a.depth - b.depth).forEach((group, depth) => { group.depth = depth; });
  groups.forEach((group, index) => { group.id = `delivery-${index}`; });
  assert.ok(groups.every(group => group.count >= 2 && group.count <= 50), `Level ${level.level}: initial group range`);
  for (const color of symbolColors) assert.equal(groups.filter(group => group.color === color).reduce((sum, group) => sum + group.count, 0), counts[color]);
  return { ...level, cells, groups };
}

export function resizeContent(level, rows, columns) {
  if (level.level === 1) throw new Error('The tutorial board cannot be resized');
  if (![rows, columns].every(size => Number.isInteger(size) && size >= 32 && size <= 48)) throw new Error('Expanded boards must use 32–48 rows/columns');
  const source = new Map(level.cells.map((cell, index) => [`${cell.row}.${cell.column}`, index]));
  const buckets = level.cells.map(() => []);
  for (let row = 0; row < rows; row += 1) for (let column = 0; column < columns; column += 1) {
    const index = source.get(`${Math.floor((row + .5) * level.rows / rows)}.${Math.floor((column + .5) * level.columns / columns)}`);
    if (index !== undefined) buckets[index].push({ row, column, id: `cell-${row}-${column}`, color: level.cells[index].color });
  }
  const cells = buckets.flat(), groups = [];
  for (const color of symbolColors) {
    let left = cells.filter(cell => cell.color === color).length;
    while (left > 0) {
      const count = left === 51 ? 49 : Math.min(50, left), index = groups.length;
      groups.push({ id: `delivery-${index}`, color, count, pile: index % 5, depth: Math.floor(index / 5) }); left -= count;
    }
  }
  return prepareContent({ ...level, rows, columns, cells, groups });
}

function prefixBundle(counts, reached, capacity, maximumLength, random, minimumKeyCount = 2) {
  const options = [];
  for (const color of Object.keys(counts)) {
    for (let debt = 1; debt < capacity; debt += 1) {
      for (let length = debt; length <= maximumLength; length += 1) {
        const count = Math.max(minimumKeyCount, Math.floor(reached[color] / (length - debt + 1)) + 1);
        if (count <= 50 && length * count <= counts[color]) options.push({ color, count, length, debt });
      }
    }
  }
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const available = { ...counts }, groups = [];
    let debt = 0;
    while (debt < capacity - 1) {
      const choices = options.filter(option => option.debt <= capacity - 1 - debt
        && groups.length + option.length <= maximumLength && option.length * option.count <= available[option.color]);
      if (!choices.length) break;
      const choice = choices[Math.floor(random() * choices.length)];
      groups.push(...Array.from({ length: choice.length }, () => ({ color: choice.color, count: choice.count })));
      available[choice.color] -= choice.length * choice.count; debt += choice.debt;
    }
    if (debt === capacity - 1) return groups;
  }
  return null;
}

export function findBlockingCandidates(level, capacity, maximumDepth = 6) {
  const colors = [...new Set(level.cells.map(cell => cell.color))], random = randomSource(level.level * 997);
  const candidates = [];
  for (let subset = 1; subset < (1 << colors.length) - 1; subset += 1) {
    const blocking = colors.filter((_, index) => subset & (1 << index));
    const counts = Object.fromEntries(blocking.map(color => [color, level.cells.filter(cell => cell.color === color).length]));
    const reached = blockingClosure(level, blocking), prefix = prefixBundle(counts, reached, capacity, maximumDepth - 1, random);
    if (!prefix) continue;
    const productionGroups = colors.filter(color => !blocking.includes(color)).reduce((sum, color) => sum + Math.ceil(level.cells.filter(cell => cell.color === color).length / 50), 0);
    candidates.push({ colors: blocking, reached, prefix, productionGroups, score: productionGroups * 2 + prefix.length });
  }
  return candidates.sort((a, b) => a.score - b.score);
}

function candidate(level, spec, random) {
  const blocking = new Set(spec.colors), counts = Object.fromEntries(spec.colors.map(color => [color, level.cells.filter(cell => cell.color === color).length]));
  const reached = blockingClosure(level, spec.colors), queues = Array.from({ length: 5 }, () => []);
  const maximumDepth = spec.maximumDepth ?? 6;
  const productionPiles = [];
  const productive = [];
  for (const color of symbolColors.filter(color => !blocking.has(color))) {
    const total = level.cells.filter(cell => cell.color === color).length, length = Math.ceil(total / 50);
    for (let index = 0; index < length; index += 1) {
      productive.push({ color, count: Math.floor(total / length) + (index < total % length ? 1 : 0) });
    }
  }
  const wantedPiles = spec.productionPiles ?? (1 + Math.floor(random() * 5));
  for (let pile = 0; pile < wantedPiles; pile += 1) {
    const bundle = prefixBundle(counts, reached, spec.capacity, maximumDepth - 1, random, spec.minimumKeyCount ?? 2);
    if (!bundle) return null;
    queues[pile] = bundle;
    for (const group of bundle) counts[group.color] -= group.count;
    productionPiles.push(pile);
  }
  const tails = [];
  for (const color of spec.colors) {
    let count = counts[color];
    while (count > 0) {
      const amount = count === 51 ? 49 : Math.min(50, count);
      if (amount === 1) return null;
      tails.push({ color, count: amount }); count -= amount;
    }
  }
  while (tails.length < 5 - wantedPiles) {
    const donor = tails.filter(group => group.count >= 4).sort((a, b) => b.count - a.count)[0];
    if (!donor) return null;
    const amount = Math.floor(donor.count / 2);
    donor.count -= amount; tails.push({ color: donor.color, count: amount });
  }
  for (let pile = wantedPiles; pile < 5; pile += 1) {
    const tail = tails.shift();
    queues[pile].push(tail);
  }
  for (const group of productive) {
    const available = productionPiles.filter(pile => queues[pile].length < maximumDepth);
    if (!available.length) return null;
    const pile = available[Math.floor(random() * available.length)];
    queues[pile].push(group);
  }
  for (const group of tails) {
    const available = queues.map((queue, pile) => ({ queue, pile })).filter(({ queue }) => queue.length < maximumDepth);
    if (!available.length) return null;
    available[Math.floor(random() * available.length)].queue.push(group);
  }
  const minimumGroups = spec.minimumGroups ?? (spec.kind === 'H' ? 18 : 12);
  while (queues.flat().length < minimumGroups) {
    const choices = queues.flatMap((queue, pile) => queue.map((group, depth) => ({ group, depth, pile })))
      .filter(({ group, pile }) => group.count >= 4 && queues[pile].length < maximumDepth);
    if (!choices.length) return null;
    const { group, depth, pile } = choices[Math.floor(random() * choices.length)];
    const first = Math.floor(group.count / 2);
    queues[pile].splice(depth, 1, { color: group.color, count: first }, { color: group.color, count: group.count - first });
  }
  const groups = queues.flatMap((queue, pile) => queue.map((group, depth) => ({ ...group, id: '', pile, depth })));
  if (groups.length > (spec.maximumGroups ?? (spec.kind === 'H' ? 30 : 24)) || groups.some(group => group.count < 2 || group.count > 50)) return null;
  groups.forEach((group, index) => { group.id = `delivery-${index}`; });
  const result = { ...level, groups };
  const certificate = certifyBlockingPrefixes(result, spec.colors);
  return certificate.lowerBound === spec.capacity ? { level: result, certificate } : null;
}

export function generate(level, spec, mode = 'main') {
  if (spec.kind === 'E') {
    const upper = createSolver(level, spec.capacity, { requireExternalPaths: true }).search({ limit: 20000 });
    if (!upper.trace) throw new Error(`Level ${level.level}: no external-path upper trace`);
    let trace = upper.trace;
    try { checkAsyncReference(level, trace, mode, spec.capacity); }
    catch { trace = findAsyncWinningTrace(level, spec.capacity, mode).trace; }
    if (!trace) throw new Error(`Level ${level.level}: UNKNOWN asynchronous reference`);
    const groups = trace.map((index, order) => ({ ...level.groups[index], id: `delivery-${order}` }));
    const ordered = { ...level, groups };
    return { level: ordered, proof: proveNormalizedMinimum(ordered, spec.capacity), upperTrace: groups.map((_, index) => index), certificate: null };
  }
  if (!spec.colors) {
    const candidates = findBlockingCandidates(level, spec.capacity, spec.maximumDepth ?? 6);
    for (const candidate of candidates.slice(0, spec.maximumColorSets ?? 40)) {
      try { return generate(level, { ...spec, colors: candidate.colors, maximumAttempts: spec.maximumAttempts ?? 100 }, mode); }
      catch (error) { if (!String(error.message).includes('finite generation budget')) throw error; }
    }
    throw new Error(`Level ${level.level}: no candidate validated within the finite generation budget (${candidates.length} coarse B sets)`);
  }
  const random = randomSource(level.level * 31337);
  let asyncSearches = 0;
  for (let attempt = 0; attempt < (spec.maximumAttempts ?? 5000); attempt += 1) {
    const proposed = candidate(level, spec, random);
    if (!proposed) continue;
    const upper = createSolver(proposed.level, spec.capacity, { requireExternalPaths: true }).search({ limit: spec.stateLimit ?? 20000 });
    if (!upper.trace) continue;
    let trace = upper.trace;
    try { checkAsyncReference(proposed.level, trace, mode, spec.capacity); }
    catch {
      if (asyncSearches >= 2) continue;
      asyncSearches += 1;
      trace = findAsyncWinningTrace(proposed.level, spec.capacity, mode, 100).trace;
    }
    if (!trace) continue;
    const groups = trace.map(index => proposed.level.groups[index]);
    groups.forEach((group, index) => { group.id = `delivery-${index}`; });
    const finalLevel = { ...proposed.level, groups };
    const proof = proveNormalizedMinimum(finalLevel, spec.capacity);
    if (proof.normalizedMinimum !== spec.capacity) throw new Error('Certificate and normalized search disagree');
    const bad = createSolver(finalLevel, 5).search({ failure: true, limit: 20000 });
    if (!bad.trace) continue;
    const asyncBad = asyncFailureEvidence(finalLevel, bad.trace, mode);
    if (!asyncBad) continue;
    return { level: finalLevel, proof, upperTrace: groups.map((_, index) => index), certificate: certifyBlockingPrefixes(finalLevel, spec.colors), badTrace: bad.trace, ...asyncBad, attempt };
  }
  throw new Error(`Level ${level.level}: no certified candidate within the finite generation budget`);
}

export function asyncFailureEvidence(level, batchTrace, mode) {
  try {
    checkAsyncFailureReference(level, batchTrace, mode);
    return { asyncBadTrace: batchTrace };
  } catch {
    for (const profile of ASYNC_PROFILES) {
      try { checkAsyncFailureReference(level, batchTrace, mode, profile); return { asyncBadTrace: batchTrace, asyncBadProfile: profile.name }; }
      catch { /* A different arrival order may remain playable. */ }
    }
    const profile = ASYNC_PROFILES[6], bad = findAsyncFailureTrace(level, mode, 100, profile);
    return bad.trace ? { asyncBadTrace: bad.trace, asyncBadProfile: profile.name } : null;
  }
}

export function writeMainOutcomes(outcomes) {
  const escape = value => /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
  for (const theme of compileThemeCsv().themes) {
    if (!outcomes.some(outcome => outcome.level.themeId === theme.id)) continue;
    const path = `assets/Colony/config/themes/${theme.id}/levels.csv`;
    const rows = csvRows(readFileSync(path, 'utf8')), groupsIndex = rows[0].indexOf('groups'), levelIndex = rows[0].indexOf('level');
    for (const row of rows.slice(1)) {
      const outcome = outcomes.find(outcome => outcome.level.level === Number(row[levelIndex]));
      if (outcome) {
        row[groupsIndex] = outcome.level.groups.map(group => `${String.fromCharCode(65 + symbolColors.indexOf(group.color))}:${group.count}:${group.pile}:${group.depth}`).join('|');
        const matrix = Array.from({ length: outcome.level.rows }, () => Array(outcome.level.columns).fill('.'));
        for (const cell of outcome.level.cells) matrix[cell.row][cell.column] = String.fromCharCode(65 + symbolColors.indexOf(cell.color));
        row[rows[0].indexOf('boardCells')] = matrix.map(line => line.join('')).join('/');
        row[rows[0].indexOf('rows')] = String(outcome.level.rows);
        row[rows[0].indexOf('columns')] = String(outcome.level.columns);
        row[rows[0].indexOf('cellOrder')] = outcome.level.cells.map(cell => `${cell.row}.${cell.column}`).join('|');
      }
    }
    writeFileSync(path, `${rows.map(row => row.map(escape).join(',')).join('\n')}\n`);
  }
  const path = 'scripts/levelDifficultyEvidence.json';
  const previous = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : [];
  const updated = outcomes.map(({ level, attempt: _attempt, ...evidence }) => ({ level: level.level, sourceId: level.sourceId, minimumSlots: evidence.spec.capacity, groups: level.groups, ...evidence }));
  writeFileSync(path, `${JSON.stringify([...previous.filter(entry => !updated.some(next => next.level === entry.level)), ...updated].sort((a, b) => a.level - b.level), null, 2)}\n`);
}

function writeAllMain(selected) {
  const existing = existsSync('scripts/levelDifficultyEvidence.json') ? JSON.parse(readFileSync('scripts/levelDifficultyEvidence.json', 'utf8')) : [], outcomes = [];
  for (const original of compileThemeCsv().levels.slice(1)) {
    const level = prepareContent(original);
    if (selected && !selected.includes(level.level)) continue;
    const target = difficultyTarget(level.level);
    let retained = existing.find(entry => entry.level === level.level && entry.sourceId === level.sourceId
      && entry.minimumSlots === target.capacity && entry.spec.kind === target.kind
      && (target.kind === 'E' || entry.badTrace && entry.asyncBadTrace));
    if (retained) {
      try {
        assert.deepEqual(level.groups, retained.groups);
        assert.deepEqual(proveNormalizedMinimum(level, target.capacity), retained.proof);
        assert.equal(retained.proof.normalizedMinimum, target.capacity);
        if (retained.certificate) {
          assert.deepEqual(certifyBlockingPrefixes(level, retained.certificate.blockingColors), retained.certificate);
          assert.equal(retained.certificate.lowerBound, target.capacity);
        } else assert.equal(target.capacity, 1);
        if (target.kind !== 'E') {
          const profile = retained.asyncBadProfile ? ASYNC_PROFILES.find(profile => profile.name === retained.asyncBadProfile) : undefined;
          assert.ok(!retained.asyncBadProfile || profile);
          checkAsyncFailureReference(level, retained.asyncBadTrace, 'main', profile);
        }
      } catch { retained = undefined; }
    }
    if (retained) {
      try { checkAsyncReference(level, retained.upperTrace, 'main', target.capacity); }
      catch {
        const trace = findAsyncWinningTrace(level, target.capacity, 'main').trace;
        if (!trace) throw new Error(`Level ${level.level}: UNKNOWN asynchronous reference`);
        const groups = trace.map((index, order) => ({ ...level.groups[index], id: `delivery-${order}` }));
        const ordered = { ...level, groups };
        const badTrace = target.kind !== 'E' ? createSolver(ordered, 5).search({ failure: true, limit: 20000 }).trace : undefined;
        const asyncBad = badTrace ? asyncFailureEvidence(ordered, badTrace, 'main') : null;
        if (target.kind !== 'E' && !asyncBad) throw new Error(`Level ${level.level}: UNKNOWN asynchronous wrong-choice reference`);
        retained = { ...retained, groups, proof: proveNormalizedMinimum(ordered, target.capacity),
          upperTrace: groups.map((_, index) => index),
          certificate: retained.certificate ? certifyBlockingPrefixes(ordered, retained.certificate.blockingColors) : null,
          ...(badTrace ? { badTrace, ...asyncBad, asyncBadProfile: asyncBad.asyncBadProfile } : {}) };
        level.groups = groups;
      }
      const { level: _number, sourceId: _sourceId, groups: _groups, minimumSlots: _minimum, ...evidence } = retained;
      outcomes.push({ level, ...evidence });
    } else {
      const spec = target, generated = generate(level, spec);
      console.log(level.level, spec.kind, generated.proof.normalizedMinimum, generated.level.groups.length);
      outcomes.push({ ...generated, spec });
    }
  }
  writeMainOutcomes(outcomes);
}

export function checkDifficultyEvidence() {
  const levels = compileThemeCsv().levels, evidence = JSON.parse(readFileSync('scripts/levelDifficultyEvidence.json', 'utf8'));
  assert.deepEqual(evidence.map(entry => entry.level), Array.from({ length: 59 }, (_, index) => index + 2));
  assert.equal(proveNormalizedMinimum(levels[0], 1).normalizedMinimum, 1);
  assert.ok(createSolver(levels[0], 1, { requireExternalPaths: true }).search({ limit: 20000 }).trace);
  for (const entry of evidence) {
    const level = levels[entry.level - 1];
    const target = difficultyTarget(entry.level);
    assert.equal(entry.minimumSlots, target.capacity);
    assert.equal(entry.spec.kind, target.kind);
    assert.equal(entry.proof.normalizedMinimum, entry.minimumSlots);
    if (target.kind !== 'E') assert.ok(entry.badTrace, `Level ${entry.level}: missing wrong-choice FAIL trace`);
    assert.equal(level.sourceId, entry.sourceId);
    assert.deepEqual(level.groups, entry.groups);
    assert.deepEqual(proveNormalizedMinimum(level, entry.minimumSlots), entry.proof);
    checkAsyncReference(level, entry.upperTrace, 'main', entry.minimumSlots);
    if (target.kind !== 'E') {
      assert.ok(entry.asyncBadTrace?.length, `Level ${entry.level}: missing asynchronous wrong-choice trace`);
      const profile = entry.asyncBadProfile ? ASYNC_PROFILES.find(profile => profile.name === entry.asyncBadProfile) : undefined;
      assert.ok(!entry.asyncBadProfile || profile, 'Unknown wrong-choice timing profile');
      checkAsyncFailureReference(level, entry.asyncBadTrace, 'main', profile);
    }
    if (entry.certificate) {
      assert.deepEqual(certifyBlockingPrefixes(level, entry.certificate.blockingColors), entry.certificate);
      assert.equal(entry.certificate.lowerBound, entry.minimumSlots);
    } else assert.equal(entry.minimumSlots, 1);
  }
  return evidence;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const selection = process.argv.find(arg => arg.startsWith('--levels='))?.slice(9);
  const selected = selection?.split(',').map(Number);
  if (selected && (!selected.length || new Set(selected).size !== selected.length || selected.some(level => !Number.isInteger(level) || level < 2 || level > 60))) throw new Error('--levels must list distinct main levels between 2 and 60');
  if (process.argv.includes('--write')) writeAllMain(selected);
  else if (process.argv.includes('--check')) console.log(`Difficulty evidence checked: ${checkDifficultyEvidence().length} levels`);
  else { console.error('Use --write to generate or --check for read-only proof verification'); process.exitCode = 1; }
}
