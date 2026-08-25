import type { NodeDefinition } from "./types";

/** Cartesian product of each parent's state list, in declared-parent order,
 * with the last parent cycling fastest — matches the backend's column
 * convention (row-major reshape of [card, ...parent_cards]). */
export function parentStateCombinations(
  parents: NodeDefinition[],
): string[][] {
  if (parents.length === 0) return [[]];
  return parents.reduce<string[][]>(
    (acc, parent) =>
      acc.flatMap((combo) => parent.states.map((state) => [...combo, state])),
    [[]],
  );
}

export interface HeaderTierCell {
  label: string;
  span: number;
}

/** One header row per parent, each grouping its state across the columns it
 * spans -- e.g. for parents A(2 states) x B(3 states), the A tier has two
 * cells each spanning 3 columns, and the B tier has six single-column
 * cells. Relies on `parentStateCombinations`' documented column order
 * (row-major, last parent fastest), so spans can be computed directly from
 * cardinalities rather than re-deriving them from the flat combination
 * list. */
export function buildHeaderTiers(parents: NodeDefinition[]): HeaderTierCell[][] {
  const cardinalities = parents.map((p) => p.states.length);
  return parents.map((parent, i) => {
    const innerSpan = cardinalities.slice(i + 1).reduce((a, b) => a * b, 1);
    const outerRepeat = cardinalities.slice(0, i).reduce((a, b) => a * b, 1);
    const row: HeaderTierCell[] = [];
    for (let outer = 0; outer < outerRepeat; outer++) {
      for (const state of parent.states) {
        row.push({ label: state, span: innerSpan });
      }
    }
    return row;
  });
}

export function emptyCpt(stateCount: number, columnCount: number): number[][] {
  const uniform = 1 / stateCount;
  return Array.from({ length: stateCount }, () =>
    Array.from({ length: columnCount }, () => uniform),
  );
}

export function uniformCpt(cpt: number[][]): number[][] {
  const rows = cpt.length;
  const cols = cpt[0]?.length ?? 0;
  const value = rows === 0 ? 0 : 1 / rows;
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => value));
}

export function randomizeCpt(cpt: number[][]): number[][] {
  const rows = cpt.length;
  const cols = cpt[0]?.length ?? 0;
  const raw = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => Math.random() + 1e-6),
  );
  return normalizeCptColumns(raw);
}

export function normalizeCptColumns(cpt: number[][]): number[][] {
  const rows = cpt.length;
  const cols = cpt[0]?.length ?? 0;
  const sums = Array.from({ length: cols }, (_, c) =>
    cpt.reduce((acc, row) => acc + (row[c] ?? 0), 0),
  );
  return cpt.map((row) =>
    row.map((value, c) => (sums[c] > 0 ? value / sums[c] : 1 / rows)),
  );
}

export function columnSums(cpt: number[][]): number[] {
  const cols = cpt[0]?.length ?? 0;
  return Array.from({ length: cols }, (_, c) =>
    cpt.reduce((acc, row) => acc + (row[c] ?? 0), 0),
  );
}

export function isColumnStochastic(cpt: number[][], tolerance = 1e-3): boolean {
  return columnSums(cpt).every((sum) => Math.abs(sum - 1.0) <= tolerance);
}

/** Per-column validity, for coloring individual cells red/green live instead
 * of showing a separate sum readout. */
export function columnValidity(cpt: number[][], tolerance = 1e-3): boolean[] {
  return columnSums(cpt).map((sum) => Math.abs(sum - 1.0) <= tolerance);
}

export function resizeCptForParents(
  currentCpt: number[][],
  stateCount: number,
  parents: NodeDefinition[],
): number[][] {
  const columnCount = parentStateCombinations(parents).length;
  if (currentCpt.length === stateCount && (currentCpt[0]?.length ?? 0) === columnCount) {
    return currentCpt;
  }
  return emptyCpt(stateCount, columnCount);
}
