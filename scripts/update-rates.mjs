// Fetches the latest Optimal Blue mortgage indices from FRED and writes rates.json.
// Runs on a schedule in GitHub Actions. Needs the FRED_API_KEY secret.
import { writeFileSync } from 'node:fs';

const KEY = process.env.FRED_API_KEY;
if (!KEY) { console.error('FRED_API_KEY is not set'); process.exit(1); }
const BASE = 'https://api.stlouisfed.org/fred/series/observations';

async function observations(id, extra) {
  const url = `${BASE}?series_id=${id}&api_key=${KEY}&file_type=json${extra}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${id}: HTTP ${res.status}`);
  const json = await res.json();
  return json.observations.filter(o => o.value !== '.' && o.value !== '');
}

async function latest(id) {
  const obs = await observations(id, '&sort_order=desc&limit=10');
  if (!obs.length) throw new Error(`${id}: no data`);
  return { rate: Number(obs[0].value), date: obs[0].date };
}

const now = new Date();
const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 24, 1)).toISOString().slice(0, 10);
const thisMonth = now.toISOString().slice(0, 7);

const [conv, fha, va, monthlyRaw] = await Promise.all([
  latest('OBMMIC30YF'),
  latest('OBMMIFHA30YF'),
  latest('OBMMIVA30YF'),
  observations('OBMMIC30YF', `&frequency=m&aggregation_method=avg&observation_start=${start}`)
]);

// Completed months only; the current month is still in progress.
const monthly = monthlyRaw
  .map(o => [o.date.slice(0, 7), Math.round(Number(o.value) * 1000) / 1000])
  .filter(([ym, r]) => ym < thisMonth && r > 0);

for (const [name, v] of Object.entries({ conv, fha, va })) {
  if (!(v.rate > 1 && v.rate < 20)) throw new Error(`${name}: implausible rate ${v.rate}`);
}
if (monthly.length < 12) throw new Error(`only ${monthly.length} monthly values`);

const data = {
  updated: now.toISOString(),
  source: 'Optimal Blue Mortgage Market Indices, retrieved from FRED, Federal Reserve Bank of St. Louis',
  today: { conv, fha, va },
  monthly
};
writeFileSync('rates.json', JSON.stringify(data, null, 2) + '\n');
console.log(`conv ${conv.rate} (${conv.date}), fha ${fha.rate}, va ${va.rate}, ${monthly.length} months`);
