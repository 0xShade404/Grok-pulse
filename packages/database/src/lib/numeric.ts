/**
 * Helpers for converting between JS `number` (used throughout
 * `@grokpulse/types`) and the Postgres `numeric` string representation
 * Drizzle returns for `numeric` columns.
 *
 * `numeric` columns are read back as strings (not `number`/`double`) so that
 * repositories never lose precision to IEEE-754 float rounding on money,
 * prices, sizes, or PnL -- see CLAUDE.md section 24/86. Conversion to a JS
 * `number` happens explicitly, at the repository boundary, once.
 */

/** Convert a JS number to the string form expected by a `numeric` column. */
export function toDbNumeric(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(`toDbNumeric: value must be finite, got ${value}`);
  }
  return value.toString();
}

/** Convert a `numeric` column's string value back to a JS number. */
export function fromDbNumeric(value: string): number {
  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`fromDbNumeric: could not parse "${value}" as a number`);
  }
  return parsed;
}

/** Same as {@link fromDbNumeric}, but passes through `null`/`undefined`. */
export function fromDbNumericNullable(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return fromDbNumeric(value);
}
