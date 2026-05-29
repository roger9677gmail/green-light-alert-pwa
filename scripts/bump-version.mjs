import { readFile, writeFile } from "node:fs/promises";

const version = process.argv[2];

if (!/^\d+\.\d+\.\d+$/.test(version || "")) {
  console.error("Usage: node scripts/bump-version.mjs 2.12.2");
  process.exit(1);
}

const cacheSuffix = version.replace(/\./g, "");

async function updateFile(path, updater) {
  const before = await readFile(path, "utf8");
  const after = updater(before);
  if (before === after) {
    throw new Error(`${path} was not changed`);
  }
  await writeFile(path, after);
  console.log(`updated ${path}`);
}

await updateFile("app.js", (text) =>
  text.replace(/const APP_VERSION = "\d+\.\d+\.\d+";/, `const APP_VERSION = "${version}";`),
);

await updateFile("index.html", (text) =>
  text
    .replace(/styles\.css\?v=\d+\.\d+\.\d+/g, `styles.css?v=${version}`)
    .replace(/app\.js\?v=\d+\.\d+\.\d+/g, `app.js?v=${version}`),
);

await updateFile("sw.js", (text) =>
  text
    .replace(/front-car-alert-v\d+/g, `front-car-alert-v${cacheSuffix}`)
    .replace(/styles\.css\?v=\d+\.\d+\.\d+/g, `styles.css?v=${version}`)
    .replace(/app\.js\?v=\d+\.\d+\.\d+/g, `app.js?v=${version}`),
);
