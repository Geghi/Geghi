// Renders the "last 12 months" stats card and the static impact card, light + dark.
// Needs GITHUB_TOKEN with access to private repos so private work is counted.
import { writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const USER = 'Geghi';
const token = process.env.GITHUB_TOKEN;
if (!token) throw new Error('GITHUB_TOKEN is required');
const headers = { Authorization: `bearer ${token}`, 'User-Agent': USER };

async function gh(path, body) {
  const res = await fetch(`https://api.github.com${path}`, { method: body ? 'POST' : 'GET', headers, body: body && JSON.stringify(body) });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

const cal = await gh('/graphql', { query: `{user(login:"${USER}"){contributionsCollection{contributionCalendar{totalContributions weeks{contributionDays{date contributionCount}}}}}}` });
const { totalContributions, weeks } = cal.data.user.contributionsCollection.contributionCalendar;
const days = weeks.flatMap(w => w.contributionDays).map(d => d.contributionCount);

function streaks(counts) {
  let longest = 0, run = 0;
  for (const c of counts) { run = c ? run + 1 : 0; longest = Math.max(longest, run); }
  // Today with no contributions yet doesn't break the current streak.
  const tail = counts.at(-1) === 0 ? counts.slice(0, -1) : counts;
  let current = 0;
  for (let i = tail.length - 1; i >= 0 && tail[i]; i--) current++;
  return { current, longest };
}

assert.deepEqual(streaks([1, 1, 0, 1, 1, 1, 0]), { current: 3, longest: 3 });
assert.deepEqual(streaks([3, 0, 0]), { current: 0, longest: 1 });

const since = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
const prs = async q => (await gh(`/search/issues?per_page=1&q=${encodeURIComponent(`author:${USER} type:pr ${q} created:>=${since}`)}`)).total_count;
const [opened, merged] = await Promise.all([prs(''), prs('is:merged')]);
const { current, longest } = streaks(days);
const fmt = n => n.toLocaleString('en-US');

const THEMES = {
  light: { bg: '#ffffff', border: '#d0d7de', text: '#1f2328', muted: '#656d76', accent: '#7B61FF', hot: '#E8590C', levels: ['#ebedf0', '#d9d1ff', '#b3a3ff', '#7B61FF', '#4c2fd6'] },
  dark: { bg: '#0d1117', border: '#30363d', text: '#e6edf3', muted: '#8d96a0', accent: '#9D8BFF', hot: '#FF8A4C', levels: ['#161b22', '#2e2566', '#4b3aa8', '#7B61FF', '#b7a8ff'] },
};

// tiles: [{ value, label: [line1, line2?], hot? }]
function card({ title, tiles, cols }, t) {
  const W = 840, pad = 20, head = title ? 44 : 0, tileH = 104, gap = 12;
  const rows = Math.ceil(tiles.length / cols);
  const tileW = (W - pad * 2 - gap * (cols - 1)) / cols;
  const H = pad * 2 + head + rows * tileH + (rows - 1) * gap;
  const body = tiles.map((tile, i) => {
    const x = pad + (i % cols) * (tileW + gap), y = pad + head + Math.floor(i / cols) * (tileH + gap), cx = x + tileW / 2;
    const label = tile.label.map((l, j) => `<text x="${cx}" y="${y + 72 + j * 17}" class="l">${l}</text>`).join('');
    return `<rect x="${x}" y="${y}" width="${tileW}" height="${tileH}" rx="10" fill="none" stroke="${t.border}"/>`
      + `<text x="${cx}" y="${y + 48}" class="v" fill="${tile.hot ? t.hot : t.accent}">${tile.value}</text>${label}`;
  }).join('');
  const header = title ? `<text x="${pad}" y="${pad + 20}" class="t">${title}</text>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${title || 'Impact'}">
<style>text{font-family:-apple-system,'Segoe UI',Ubuntu,Helvetica,Arial,sans-serif;text-anchor:middle}.v{font-size:30px;font-weight:700}.l{font-size:13px;fill:${t.muted}}.t{font-size:15px;font-weight:600;fill:${t.text};text-anchor:start}</style>
<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="12" fill="${t.bg}" stroke="${t.border}"/>${header}${body}</svg>\n`;
}

// Contribution grid: one column per week, colour level from quartiles of active days.
function heatmap(t) {
  const W = 840, pad = 20, head = 44, cell = 12, step = 15, legendH = 26;
  const active = days.filter(Boolean).sort((a, b) => a - b);
  const q = [0.25, 0.5, 0.75].map(f => active[Math.floor(f * (active.length - 1))] ?? 0);
  const level = c => (c === 0 ? 0 : 1 + q.filter(v => c > v).length);
  const gridW = weeks.length * step - (step - cell), x0 = (W - gridW) / 2;
  const H = pad * 2 + head + 7 * step + legendH;
  const cells = weeks.flatMap((w, i) => w.contributionDays.map(d => {
    const y = pad + head + new Date(d.date).getUTCDay() * step;
    return `<rect x="${x0 + i * step}" y="${y}" width="${cell}" height="${cell}" rx="2.5" fill="${t.levels[level(d.contributionCount)]}"><title>${d.date}: ${d.contributionCount}</title></rect>`;
  })).join('');
  const ly = pad + head + 7 * step + 10, lx = W - pad - 5 * step - 40;
  const legend = `<text x="${lx - 8}" y="${ly + 10}" class="l" style="text-anchor:end">Less</text>`
    + t.levels.map((c, i) => `<rect x="${lx + i * step}" y="${ly}" width="${cell}" height="${cell}" rx="2.5" fill="${c}"/>`).join('')
    + `<text x="${lx + 5 * step + 4}" y="${ly + 10}" class="l" style="text-anchor:start">More</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Contribution calendar">
<style>text{font-family:-apple-system,'Segoe UI',Ubuntu,Helvetica,Arial,sans-serif}.l{font-size:12px;fill:${t.muted}}.t{font-size:15px;font-weight:600;fill:${t.text}}</style>
<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="12" fill="${t.bg}" stroke="${t.border}"/>
<text x="${pad}" y="${pad + 20}" class="t">${fmt(totalContributions)} contributions in the last year</text>${cells}${legend}</svg>\n`;
}

const stats = {
  title: 'Last 12 months on GitHub · private work included',
  cols: 3,
  tiles: [
    { value: fmt(totalContributions), label: ['contributions'] },
    { value: `🔥 ${current}`, label: ['day current streak'], hot: true },
    { value: longest, label: ['day longest streak'] },
    { value: fmt(opened), label: ['pull requests opened'] },
    { value: fmt(merged), label: ['pull requests merged'] },
    { value: `${days.filter(Boolean).length}/${days.length}`, label: ['days with contributions'] },
  ],
};

const impact = {
  cols: 5,
  tiles: [
    { value: '1M+', label: ['tickets/year routed', 'by an LLM agent'] },
    { value: '2,500', label: ['documents/day', 'extracted and validated'] },
    { value: '−84%', label: ['manual work on', 'financial statements'], hot: true },
    { value: '−45%', label: ['AI cost per', 'generated article'], hot: true },
    { value: '90%+', label: ['fully correct answers', 'over 2M+ products'] },
  ],
};

for (const [name, t] of Object.entries(THEMES)) {
  const suffix = name === 'dark' ? '-dark' : '';
  writeFileSync(`metrics/stats${suffix}.svg`, card(stats, t));
  writeFileSync(`metrics/impact${suffix}.svg`, card(impact, t));
  writeFileSync(`metrics/calendar${suffix}.svg`, heatmap(t));
}
console.log({ totalContributions, current, longest, opened, merged });
