/** Strategy version tag this app's own manual/on-demand analysis and
 * manual paper orders are attributed to (CLAUDE.md section 63). Distinct
 * from whatever version string a real automated background strategy run
 * would use -- there is no `strategy_versions` row required for a
 * server-config default like this one, just a stable, greppable label. */
export const API_STRATEGY_VERSION = "grokpulse-api@0.1.0";
