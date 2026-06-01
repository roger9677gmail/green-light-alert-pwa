const repo = "roger9677gmail/green-light-alert-pwa";
const liveBase = "https://9677.fun";
const stamp = Date.now();

function extractVersion(label, text) {
  const appVersion = text.match(/APP_VERSION\s*=\s*"([^"]+)"/)?.[1];
  const appQuery = text.match(/app\.js\?v=([0-9.]+)/)?.[1];
  const cssQuery = text.match(/styles\.css\?v=([0-9.]+)/)?.[1];
  const cacheName = text.match(/front-car-alert-v(\d+)/)?.[1];
  return { label, appVersion, appQuery, cssQuery, cacheName };
}

async function fetchText(label, url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`${label}: HTTP ${response.status}`);
  }
  return extractVersion(label, await response.text());
}

async function fetchMainSha() {
  const response = await fetch(`https://api.github.com/repos/${repo}/commits/main?nocache=${stamp}`, {
    cache: "no-store",
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!response.ok) {
    throw new Error(`GitHub commits API: HTTP ${response.status}`);
  }
  const data = await response.json();
  return data.sha;
}

const mainSha = await fetchMainSha();
const rawBase = `https://raw.githubusercontent.com/${repo}/${mainSha}`;
const targets = [
  ["GitHub main app.js", `${rawBase}/app.js`],
  ["GitHub main index.html", `${rawBase}/index.html`],
  ["GitHub main sw.js", `${rawBase}/sw.js`],
  ["Live app.js", `${liveBase}/app.js?nocache=${stamp}`],
  ["Live index.html", `${liveBase}/index.html?nocache=${stamp}`],
  ["Live sw.js", `${liveBase}/sw.js?nocache=${stamp}`],
];

const rows = [];
for (const [label, url] of targets) {
  try {
    rows.push(await fetchText(label, url));
  } catch (error) {
    rows.push({ label, error: error.message });
  }
}

console.table(rows);
console.log(`GitHub main SHA: ${mainSha.slice(0, 7)}`);

const githubApp = rows.find((row) => row.label === "GitHub main app.js")?.appVersion;
const liveApp = rows.find((row) => row.label === "Live app.js")?.appVersion;
const liveIndex = rows.find((row) => row.label === "Live index.html")?.appQuery;

if (githubApp && liveApp && githubApp !== liveApp) {
  console.warn(`Live app.js is not on GitHub main yet: GitHub=${githubApp}, Live=${liveApp}`);
}

if (liveApp && liveIndex && liveApp !== liveIndex) {
  console.warn(`Live index/app mismatch: index loads ${liveIndex}, app.js says ${liveApp}`);
}
