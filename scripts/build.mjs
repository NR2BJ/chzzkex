import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  copyFile,
  cp,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(rootDir, "dist");
const stageDir = path.join(distDir, ".stage");
const runtimeEntries = ["NOTICE.md", "popup", "rules", "src"];
const contentBundleSources = ["src/content.js"];
const mainBundleSources = [
  "src/settings.js",
  "src/rewrite-core.js",
  "src/injected.js",
  "src/feature-core.js",
  "src/features.js"
];
const manifest = JSON.parse(
  await readFile(path.join(rootDir, "manifest.json"), "utf8")
);
const version = manifest.version;

if (!/^\d+\.\d+\.\d+$/.test(version)) {
  throw new Error(`Unsupported manifest version: ${version}`);
}

await mkdir(distDir, { recursive: true });
await rm(stageDir, { recursive: true, force: true });
await mkdir(stageDir, { recursive: true });

async function stageRuntime(browser) {
  const browserDir = path.join(stageDir, browser);
  await mkdir(browserDir, { recursive: true });

  for (const entry of runtimeEntries) {
    const source = path.join(rootDir, entry);
    const destination = path.join(browserDir, entry);
    const sourceStat = await stat(source);

    if (sourceStat.isDirectory()) {
      await cp(source, destination, { recursive: true });
    } else {
      await copyFile(source, destination);
    }
  }

  const bundle = async (fileName, sources) => {
    const contents = await Promise.all(
      sources.map((source) => readFile(path.join(rootDir, source), "utf8"))
    );
    await writeFile(
      path.join(browserDir, "src", fileName),
      `${contents.join("\n")}\n`,
      "utf8"
    );
  };

  await Promise.all([
    bundle("content-bundle.js", contentBundleSources),
    bundle("main-bundle.js", mainBundleSources)
  ]);

  const browserManifest = JSON.parse(JSON.stringify(manifest));
  for (const contentScript of browserManifest.content_scripts || []) {
    if (contentScript.world === "MAIN") {
      contentScript.js = ["src/main-bundle.js"];
    } else if (contentScript.js?.includes("src/content.js")) {
      contentScript.js = ["src/content-bundle.js"];
    }
  }
  if (browser === "chrome") {
    delete browserManifest.browser_specific_settings;
  }

  await writeFile(
    path.join(browserDir, "manifest.json"),
    `${JSON.stringify(browserManifest, null, 2)}\n`,
    "utf8"
  );

  return browserDir;
}

async function makeArchive(sourceDir, archivePath) {
  const entries = ["manifest.json", ...runtimeEntries];
  const windowsArchivePath = archivePath.endsWith(".zip")
    ? archivePath
    : `${archivePath}.zip`;
  const command = process.platform === "win32" ? "tar.exe" : "zip";
  const args =
    process.platform === "win32"
      ? ["-a", "-cf", windowsArchivePath, ...entries]
      : ["-X", "-q", "-r", archivePath, ...entries];
  if (process.platform === "win32") {
    await rm(windowsArchivePath, { force: true });
  }
  const result = spawnSync(command, args, {
    cwd: sourceDir,
    encoding: "utf8"
  });

  if (result.status !== 0) {
    if (process.platform === "win32") {
      await rm(windowsArchivePath, { force: true });
    }
    throw new Error(
      result.error?.message || result.stderr || result.stdout || "zip failed"
    );
  }

  if (process.platform === "win32" && windowsArchivePath !== archivePath) {
    await rename(windowsArchivePath, archivePath);
  }
}

async function sha256(filePath) {
  const hash = createHash("sha256");
  hash.update(await readFile(filePath));
  return hash.digest("hex");
}

const chromeName = `chzzk-ex-chrome-v${version}.zip`;
const firefoxName = `chzzk-ex-firefox-v${version}.xpi`;
const chromePath = path.join(distDir, chromeName);
const firefoxPath = path.join(distDir, firefoxName);

await Promise.all([
  rm(chromePath, { force: true }),
  rm(firefoxPath, { force: true })
]);
await makeArchive(await stageRuntime("chrome"), chromePath);
await makeArchive(await stageRuntime("firefox"), firefoxPath);

const checksums = [
  `${await sha256(chromePath)}  ${chromeName}`,
  `${await sha256(firefoxPath)}  ${firefoxName}`
];
await writeFile(
  path.join(distDir, "SHA256SUMS.txt"),
  `${checksums.join("\n")}\n`,
  "utf8"
);

await rm(stageDir, { recursive: true, force: true });

for (const fileName of [chromeName, firefoxName, "SHA256SUMS.txt"]) {
  console.log(path.join("dist", fileName));
}
