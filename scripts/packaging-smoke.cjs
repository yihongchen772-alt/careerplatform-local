const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const net = require("node:net");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { spawn, spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const { verifyDirectory } = require("./packaging-prepare.cjs");

const projectRoot = path.resolve(__dirname, "..");
const stageRoot = path.join(projectRoot, ".local-run", "packaging");

async function freePort() {
  const listener = net.createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const { port } = listener.address();
  await new Promise((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
  return port;
}

async function smoke() {
  // Outside the checkout: a missing bundled dependency must not silently
  // resolve from the developer's source node_modules and pass this test.
  const tempParent = fs.realpathSync(os.tmpdir());
  const scratch = fs.mkdtempSync(path.join(tempParent, "jobcompass-runtime-"));
  const runtime = path.join(scratch, "runtime");
  const shell = path.join(scratch, "shell");
  let server;
  let output = "";
  try {
    for (const name of ["runtime", "shell"]) {
      verifyDirectory(path.join(stageRoot, name));
      fs.cpSync(path.join(stageRoot, name), path.join(scratch, name), { recursive: true });
    }
    const dataDir = path.join(scratch, "data");
    fs.mkdirSync(path.join(dataDir, "uploads"), { recursive: true });
    const databaseFile = path.join(dataDir, "empty.db");
    const database = new DatabaseSync(databaseFile);
    database.exec("PRAGMA user_version = 0;");
    database.close();
    const port = await freePort();
    const env = {
      ...process.env,
      NODE_ENV: "production",
      NODE_PATH: "",
      NODE_OPTIONS: "",
      DATABASE_URL: `file:${databaseFile.replaceAll("\\", "/")}`,
      LOCAL_UPLOADS_DIR: path.join(dataDir, "uploads"),
      NEXTAUTH_SECRET: crypto.randomBytes(32).toString("hex"),
      NEXTAUTH_URL: `http://127.0.0.1:${port}`,
      HOSTNAME: "127.0.0.1",
      PORT: String(port),
      NEXT_TELEMETRY_DISABLED: "1",
      CHECKPOINT_DISABLE: "1",
      PRISMA_HIDE_UPDATE_MESSAGE: "1",
    };
    function run(args, cwd) {
      const result = spawnSync(process.execPath, args, {
        cwd, env, encoding: "utf8", windowsHide: true, timeout: 60000,
      });
      if (result.error) throw result.error;
      if (result.status !== 0) {
        throw new Error(`Isolated runtime command failed: ${(result.stderr || result.stdout || "").slice(-8000)}`);
      }
    }
    run(["node_modules/prisma/build/index.js", "migrate", "deploy", "--schema", "prisma/schema.prisma"], runtime);
    run(["-e", "require('electron-updater'); require('./electron/data-backup.cjs');"], shell);
    server = spawn(process.execPath, ["server.js"], { cwd: runtime, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let startupError;
    server.on("error", error => { startupError = error; });
    for (const stream of [server.stdout, server.stderr]) {
      stream.on("data", chunk => { output = (output + chunk.toString()).slice(-12000); });
    }
    const origin = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + 60000;
    let dashboard;
    while (Date.now() < deadline) {
      if (startupError) throw startupError;
      if (server.exitCode !== null) throw new Error("Isolated Next server exited before it was ready.");
      try { dashboard = await fetch(`${origin}/dashboard`, { signal: AbortSignal.timeout(3000) }); }
      catch { /* Waiting for the local listener only. */ }
      if (dashboard) break;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.ok(dashboard, "Isolated Next server did not become ready.");
    assert.equal(dashboard.status, 200, "Dashboard must load with the bundled Prisma client and native engine.");
    const html = await dashboard.text();
    assert.match(html, /求职罗盘/, "Dashboard HTML is missing the application title.");
    const staticAssets = [...html.matchAll(/(?:src|href)="([^" ]*\/_next\/static\/[^" ]+)"/g)].map(match => match[1]);
    assert.ok(staticAssets.length, "Dashboard must reference its packaged static assets.");
    for (const asset of [...new Set(staticAssets)].slice(0, 4)) {
      const url = new URL(asset.replaceAll("&amp;", "&"), origin);
      assert.equal(url.origin, origin, "The smoke test must only request local resources.");
      const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
      assert.equal(response.status, 200, "A packaged static asset is missing.");
      await response.arrayBuffer();
    }
    const settings = await fetch(`${origin}/settings`, { signal: AbortSignal.timeout(15000) });
    assert.equal(settings.status, 200);
    assert.match(await settings.text(), /设置/);
    // This read-only API exercises database access without sending mail,
    // contacting an AI service, or invoking a reminder-delivery endpoint.
    const reminders = await fetch(`${origin}/api/reminders/due`, { signal: AbortSignal.timeout(15000) });
    assert.equal(reminders.status, 200);
    assert.deepEqual(await reminders.json(), { urgent: [] });
    const checked = new DatabaseSync(databaseFile, { readOnly: true });
    try {
      for (const table of ["JobLead", "Position", "Application", "AiKey"]) {
        assert.equal(checked.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get().count, 0, `Smoke database ${table} must be empty.`);
      }
    } finally { checked.close(); }
    console.log(`Isolated ${process.platform}/${process.arch} runtime smoke passed: migrations, updater dependencies, dashboard, settings, static assets and read-only API.`);
  } catch (error) {
    if (output) process.stderr.write(output);
    throw error;
  } finally {
    if (server?.pid && server.exitCode === null && server.signalCode === null && !server.killed) {
      const exited = once(server, "exit");
      server.kill();
      await exited;
    }
    const resolved = fs.realpathSync(scratch);
    if (path.dirname(resolved) !== tempParent || fs.lstatSync(scratch).isSymbolicLink()) {
      throw new Error("Refusing to remove a smoke directory outside the temporary root.");
    }
    fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}

smoke().catch(error => { console.error(error.message); process.exitCode = 1; });
