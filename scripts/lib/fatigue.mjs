// Standard hours checks for a solo driver of a fatigue-regulated heavy vehicle.
// Source: Heavy Vehicle (Fatigue Management) National Regulation, Schedule 1, Table 1
// (standard hours, solo drivers). NHVR guide: https://www.nhvr.gov.au/work-and-rest
//
// What this checks: recorded work periods against the work limits and the long
// stationary rest each period needs. What it does not: night rest breaks in the
// 14-day rule, BFM or AFM hours, two-up driving, the personal use exemption, or
// the 15-minute rounding a work diary applies. Those are listed as review items.
// A clear result is never a fitness-to-drive decision.

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

// Each rule: in any window of `window` ms, no more than `maxWork` ms of work,
// and (where set) at least one continuous rest of `minRest` ms.
export const STANDARD_HOURS = [
  { id: 'SH-5.5H', window: 5.5 * HOUR, maxWork: 5.25 * HOUR, label: 'more than 5h15m work in 5h30m (needs 15 continuous minutes rest)' },
  { id: 'SH-8H', window: 8 * HOUR, maxWork: 7.5 * HOUR, label: 'more than 7h30m work in 8h' },
  { id: 'SH-11H', window: 11 * HOUR, maxWork: 10 * HOUR, label: 'more than 10h work in 11h' },
  { id: 'SH-24H', window: 24 * HOUR, maxWork: 12 * HOUR, minRest: 7 * HOUR, label: 'more than 12h work in 24h, or no 7 continuous hours stationary rest' },
  { id: 'SH-7D', window: 7 * 24 * HOUR, maxWork: 72 * HOUR, minRest: 24 * HOUR, label: 'more than 72h work in 7 days, or no 24 continuous hours stationary rest' },
  { id: 'SH-14D', window: 14 * 24 * HOUR, maxWork: 144 * HOUR, label: 'more than 144h work in 14 days' },
];

// Rest shorter than 15 continuous minutes does not count as rest: merge it into work.
export function normalise(periods) {
  const sorted = periods
    .map((p) => ({ start: new Date(p.starts_at).getTime(), end: new Date(p.ends_at).getTime() }))
    .sort((a, b) => a.start - b.start);
  const out = [];
  for (const p of sorted) {
    const last = out[out.length - 1];
    if (last && p.start - last.end < 15 * MIN) last.end = Math.max(last.end, p.end);
    else out.push({ ...p });
  }
  return out;
}

function workIn(blocks, from, to) {
  let total = 0;
  for (const b of blocks) {
    const s = Math.max(b.start, from), e = Math.min(b.end, to);
    if (e > s) total += e - s;
  }
  return total;
}

function longestRestIn(blocks, from, to) {
  let longest = 0, cursor = from;
  for (const b of blocks) {
    if (b.end <= from) continue;
    if (b.start >= to) break;
    longest = Math.max(longest, Math.max(b.start, from) - cursor);
    cursor = Math.max(cursor, b.end);
  }
  return Math.max(longest, to - cursor);
}

const fmt = (ms) => `${Math.floor(ms / HOUR)}h${String(Math.round((ms % HOUR) / MIN)).padStart(2, '0')}m`;

// Returns one finding per rule per driver: the first window that breaks it.
// Only windows that end on or before the driver's last recorded work end are judged,
// so a week still in progress is not called short of rest.
export function checkDriver(periods) {
  const blocks = normalise(periods);
  if (!blocks.length) return [];
  const lastEnd = blocks[blocks.length - 1].end;
  const findings = [];
  for (const rule of STANDARD_HOURS) {
    for (const b of blocks) {
      const from = b.start, to = b.start + rule.window;
      const work = workIn(blocks, from, to);
      if (work > rule.maxWork) {
        findings.push({ rule: rule.id, window_start: new Date(from).toISOString().slice(0, 16).replace('T', ' ') + 'Z', finding: `${fmt(work)} work: ${rule.label}` });
        break;
      }
      if (rule.minRest && to <= lastEnd) {
        const rest = longestRestIn(blocks, from, to);
        if (rest < rule.minRest) {
          findings.push({ rule: rule.id, window_start: new Date(from).toISOString().slice(0, 16).replace('T', ' ') + 'Z', finding: `longest rest ${fmt(rest)}: ${rule.label}` });
          break;
        }
      }
    }
  }
  return findings;
}
