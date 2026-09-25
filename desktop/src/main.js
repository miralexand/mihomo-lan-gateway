"use strict";

const { app, BrowserWindow, Tray, Menu, ipcMain, shell, dialog, nativeImage } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const http = require("http");
const { spawn, execFile } = require("child_process");

const isDev = process.argv.includes("--dev") || !app.isPackaged;
const APP_NAME = "Mihomo Gateway";

let mainWindow = null;
let tray = null;
let core = null;
let pollTimer = null;
let quitting = false;

function repoRoot() {
  return path.resolve(__dirname, "..", "..");
}

function resolveCoreExe() {
  const candidates = [];
  if (app.isPackaged) {
    candidates.push(path.join(process.resourcesPath, "core", "mihomo.exe"));
  } else {
    candidates.push(path.join(repoRoot(), "bin", "mihomo.exe"));
  }
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[0];
}

function seedDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "seed")
    : path.join(repoRoot(), "config");
}

function dataDir() {
  const dir = path.join(app.getPath("userData"), "data");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function configPath() {
  return path.join(dataDir(), "config.yaml");
}

function seedIfNeeded() {
  const dir = dataDir();
  const seed = seedDir();
  const target = configPath();
  if (!fs.existsSync(target)) {
    const seedCfg = path.join(seed, "config.yaml");
    if (fs.existsSync(seedCfg)) {
      fs.copyFileSync(seedCfg, target);
    } else {
      fs.writeFileSync(target, DEFAULT_CONFIG, "utf8");
    }
  }
  const uiTarget = path.join(dir, "ui");
  const uiSeed = path.join(seed, "ui");
  if (!fs.existsSync(uiTarget) && fs.existsSync(uiSeed)) {
    copyDir(uiSeed, uiTarget);
  }
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

const DEFAULT_CONFIG = [
  "mixed-port: 7890",
  "socks-port: 7891",
  "allow-lan: true",
  "bind-address: '*'",
  "mode: rule",
  "log-level: info",
  "ipv6: false",
  "external-controller: 0.0.0.0:9090",
  "external-ui: ui",
  'secret: "change-me-please"',
  "unified-delay: true",
  "tcp-concurrent: true",
  "profile:",
  "  store-selected: true",
  "  store-fake-ip: true",
  "dns:",
  "  enable: true",
  "  listen: 0.0.0.0:1053",
  "  ipv6: false",
  "  enhanced-mode: fake-ip",
  "  fake-ip-range: 198.18.0.1/16",
  "  default-nameserver:",
  "    - 223.5.5.5",
  "  nameserver:",
  "    - 223.5.5.5",
  "    - 119.29.29.29",
  "proxies: []",
  "proxy-groups: []",
  "rules:",
  "  - MATCH,DIRECT",
  "",
].join("\n");

/* ---------------- config read / write (top-level scalars) ---------------- */

function readConfigText() {
  try {
    return fs.readFileSync(configPath(), "utf8");
  } catch {
    return DEFAULT_CONFIG;
  }
}

function getScalar(text, key) {
  const re = new RegExp(`^${key}\\s*:\\s*(.*)$`, "m");
  const m = text.match(re);
  if (!m) return undefined;
  let v = m[1].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  return v;
}

function setScalar(text, key, value) {
  const re = new RegExp(`^${key}\\s*:.*$`, "m");
  const line = `${key}: ${value}`;
  if (re.test(text)) return text.replace(re, line);
  return text.replace(/\s*$/, "\n") + line + "\n";
}

function parseSettings() {
  const text = readConfigText();
  const controller = getScalar(text, "external-controller") || "0.0.0.0:9090";
  const controllerPort = controller.split(":").pop();
  return {
    mixedPort: parseInt(getScalar(text, "mixed-port") || "7890", 10),
    socksPort: parseInt(getScalar(text, "socks-port") || "7891", 10),
    controllerPort: parseInt(controllerPort || "9090", 10),
    secret: getScalar(text, "secret") || "",
    allowLan: (getScalar(text, "allow-lan") || "true") === "true",
    mode: getScalar(text, "mode") || "rule",
    logLevel: getScalar(text, "log-level") || "info",
    ipv6: (getScalar(text, "ipv6") || "false") === "true",
    bindAddress: getScalar(text, "bind-address") || "*",
  };
}

function saveSettings(s) {
  let text = readConfigText();
  text = setScalar(text, "mixed-port", Number(s.mixedPort) || 7890);
  text = setScalar(text, "socks-port", Number(s.socksPort) || 7891);
  text = setScalar(text, "external-controller", `0.0.0.0:${Number(s.controllerPort) || 9090}`);
  text = setScalar(text, "secret", `"${String(s.secret || "").replace(/"/g, '\\"')}"`);
  text = setScalar(text, "allow-lan", s.allowLan ? "true" : "false");
  text = setScalar(text, "bind-address", `'${s.bindAddress || "*"}'`);
  text = setScalar(text, "mode", s.mode || "rule");
  text = setScalar(text, "log-level", s.logLevel || "info");
  text = setScalar(text, "ipv6", s.ipv6 ? "true" : "false");
  fs.writeFileSync(configPath(), text, "utf8");
  return parseSettings();
}

/* ---------------- mihomo process manager ---------------- */

class MihomoCore {
  constructor() {
    this.proc = null;
    this.status = "stopped";
    this.startedAt = null;
    this.lastError = "";
  }

  emitStatus(extra = {}) {
    const payload = {
      status: this.status,
      pid: this.proc ? this.proc.pid : null,
      startedAt: this.startedAt,
      error: this.lastError,
      ...extra,
    };
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("core:status-changed", payload);
    }
    updateTray();
  }

  log(level, message) {
    const entry = { time: new Date().toISOString(), level, message };
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("core:log", entry);
    }
  }

  isRunning() {
    return this.proc !== null && this.proc.exitCode === null;
  }

  async start() {
    if (this.isRunning()) return { ok: true, status: this.status };
    seedIfNeeded();
    settings = parseSettings();

    const exe = resolveCoreExe();
    if (!fs.existsSync(exe)) {
      this.lastError = `未找到内核: ${exe}`;
      this.log("error", this.lastError);
      this.status = "stopped";
      this.emitStatus();
      return { ok: false, error: this.lastError };
    }

    this.status = "starting";
    this.lastError = "";
    this.emitStatus();
    this.log("info", `启动内核: ${exe}`);

    const args = ["-d", dataDir()];
    try {
      this.proc = spawn(exe, args, {
        cwd: dataDir(),
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (e) {
      this.status = "stopped";
      this.lastError = String(e && e.message ? e.message : e);
      this.emitStatus();
      return { ok: false, error: this.lastError };
    }

    const handleData = (buf) => {
      const text = buf.toString("utf8");
      for (const line of text.split(/\r?\n/)) {
        const t = line.trim();
        if (!t) continue;
        this.log(parseLogLevel(t), t);
      }
    };
    this.proc.stdout.on("data", handleData);
    this.proc.stderr.on("data", handleData);

    this.proc.on("error", (err) => {
      this.lastError = err.message;
      this.log("error", `进程错误: ${err.message}`);
    });

    this.proc.on("exit", (code, signal) => {
      this.log("info", `内核已退出 (code=${code}, signal=${signal})`);
      this.proc = null;
      this.startedAt = null;
      this.status = "stopped";
      if (code && code !== 0) this.lastError = `内核异常退出，退出码 ${code}`;
      this.emitStatus();
      stopPolling();
    });

    await delay(900);
    if (this.isRunning()) {
      this.status = "running";
      this.startedAt = Date.now();
      this.emitStatus();
      startPolling();
      return { ok: true, status: this.status };
    }
    this.status = "stopped";
    this.emitStatus();
    return { ok: false, error: this.lastError || "启动失败" };
  }

  async stop() {
    if (!this.proc) {
      this.status = "stopped";
      this.startedAt = null;
      this.emitStatus();
      return { ok: true };
    }
    this.status = "stopping";
    this.emitStatus();
    const pid = this.proc.pid;
    await new Promise((resolve) => {
      const done = () => resolve();
      this.proc.once("exit", done);
      if (process.platform === "win32") {
        execFile("taskkill", ["/pid", String(pid), "/T", "/F"], () => {});
      } else {
        try {
          process.kill(pid, "SIGTERM");
        } catch {}
      }
      setTimeout(resolve, 4000);
    });
    this.proc = null;
    this.status = "stopped";
    this.startedAt = null;
    stopPolling();
    this.emitStatus();
    return { ok: true };
  }

  async restart() {
    await this.stop();
    return this.start();
  }
}

function parseLogLevel(line) {
  const m = line.match(/level=([a-z]+)/i);
  if (m) return m[1].toLowerCase();
  if (/\berror\b/i.test(line)) return "error";
  if (/\bwarn/i.test(line)) return "warning";
  if (/\bdebug\b/i.test(line)) return "debug";
  return "info";
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/* ---------------- mihomo REST API ---------------- */

function apiRequest(pathname, { stream = false } = {}) {
  return new Promise((resolve, reject) => {
    const s = settings;
    const token = s.secret || "";
    const req = http.request(
      {
        host: "127.0.0.1",
        port: s.controllerPort || 9090,
        path: pathname,
        method: "GET",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        timeout: 4000,
      },
      (res) => {
        if (res.statusCode === 401 || res.statusCode === 403) {
          reject(new Error("API 认证失败 (secret 不正确)"));
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        let data = "";
        res.on("data", (c) => {
          data += c;
          if (stream) {
            try {
              resolve(JSON.parse(data));
              req.destroy();
            } catch {}
          }
        });
        res.on("end", () => {
          if (stream) {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              reject(e);
            }
            return;
          }
          try {
            resolve(data ? JSON.parse(data) : {});
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error("请求超时")));
    req.on("error", reject);
    req.end();
  });
}

let settings = null;
let statsCache = { up: 0, down: 0, conns: 0, memory: 0, version: "", connections: [], rules: [] };
let prevTotals = { up: 0, down: 0, ts: 0 };

async function pollOnce() {
  if (!core.isRunning()) return;
  try {
    const s = settings;
    const conns = await apiRequest("/connections");
    const now = Date.now();
    const upTotal = conns.uploadTotal || 0;
    const downTotal = conns.downloadTotal || 0;
    let upSpeed = 0;
    let downSpeed = 0;
    if (prevTotals.ts) {
      const dt = (now - prevTotals.ts) / 1000;
      if (dt > 0) {
        upSpeed = Math.max(0, (upTotal - prevTotals.up) / dt);
        downSpeed = Math.max(0, (downTotal - prevTotals.down) / dt);
      }
    }
    prevTotals = { up: upTotal, down: downTotal, ts: now };

    let memory = statsCache.memory;
    try {
      const mem = await apiRequest("/memory", { stream: true });
      memory = mem.inuse || 0;
    } catch {}

    const list = (conns.connections || []).map((c) => ({
      id: c.id,
      host: (c.metadata && (c.metadata.host || c.metadata.destinationIP)) || "",
      dest: c.metadata ? `${c.metadata.destinationIP}:${c.metadata.destinationPort}` : "",
      source: c.metadata ? `${c.metadata.sourceIP}:${c.metadata.sourcePort}` : "",
      network: c.metadata ? c.metadata.network : "",
      rule: c.rule || "",
      rulePayload: c.rulePayload || "",
      chains: c.chains || [],
      upload: c.upload || 0,
      download: c.download || 0,
      start: c.start || "",
    }));

    const snapshot = {
      up: upSpeed,
      down: downSpeed,
      upTotal,
      downTotal,
      conns: list.length,
      memory,
      connections: list,
      memoryOS: os.totalmem(),
      uptime: core.startedAt ? now - core.startedAt : 0,
    };

    if (core.status === "running") {
      const cfgs = await apiRequest("/configs").catch(() => null);
      if (cfgs) {
        snapshot.mode = cfgs.mode;
        snapshot.allowLan = cfgs["allow-lan"];
      }
    }

    statsCache = { ...statsCache, ...snapshot };
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("stats:update", statsCache);
    }
  } catch (e) {
    // transient API errors while starting/stopping
  }
}

function startPolling() {
  stopPolling();
  pollOnce();
  pollTimer = setInterval(pollOnce, 1000);
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

async function fetchVersionOnce() {
  try {
    const v = await apiRequest("/version");
    statsCache.version = v.version || "";
    statsCache.meta = v.meta;
    return v;
  } catch {
    return null;
  }
}

/* ---------------- system info ---------------- */

function lanAddresses() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const info of ifaces[name] || []) {
      if (info.family === "IPv4" && !info.internal) {
        out.push({ iface: name, address: info.address, mac: info.mac });
      }
    }
  }
  return out;
}

/* ---------------- window / tray ---------------- */

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 960,
    minHeight: 620,
    backgroundColor: "#0f1115",
    title: APP_NAME,
    icon: iconPath(),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.webContents.on("did-fail-load", (_e, code, desc, url) => {
    console.error(`[main] renderer failed to load (${code} ${desc}) ${url}`);
  });
  mainWindow.webContents.on("render-process-gone", (_e, details) => {
    console.error(`[main] renderer process gone: ${details.reason}`);
  });
  mainWindow.webContents.on("did-finish-load", () => {
    console.log("[main] renderer loaded");
  });
  mainWindow.on("close", (e) => {
    if (!quitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
  if (isDev) mainWindow.webContents.openDevTools({ mode: "detach" });
}

function iconPath() {
  const ico = path.join(__dirname, "..", "build", "icon.ico");
  if (fs.existsSync(ico)) return ico;
  const png = path.join(__dirname, "..", "build", "icon.png");
  return fs.existsSync(png) ? png : undefined;
}

function updateTray() {
  if (!tray) return;
  const running = core && core.status === "running";
  tray.setToolTip(`${APP_NAME} - ${running ? "运行中" : "已停止"}`);
  const menu = Menu.buildFromTemplate([
    { label: running ? "停止代理" : "启动代理", click: () => (running ? core.stop() : core.start()) },
    { label: "打开面板", click: () => shell.openExternal(panelUrl()) },
    { type: "separator" },
    {
      label: "显示主界面",
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    {
      label: "退出",
      click: async () => {
        quitting = true;
        await core.stop();
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
}

function createTray() {
  const p = iconPath();
  const img = p ? nativeImage.createFromPath(p) : nativeImage.createEmpty();
  tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img.resize({ width: 16, height: 16 }));
  updateTray();
  tray.on("click", () => {
    if (mainWindow) {
      mainWindow.isVisible() ? mainWindow.hide() : (mainWindow.show(), mainWindow.focus());
    }
  });
}

function panelUrl() {
  const s = settings || parseSettings();
  return `http://127.0.0.1:${s.controllerPort || 9090}/ui/`;
}

/* ---------------- IPC ---------------- */

function registerIpc() {
  ipcMain.handle("app:info", () => ({
    appVersion: app.getVersion(),
    electron: process.versions.electron,
    platform: `${os.type()} ${os.release()} (${os.arch()})`,
    hostname: os.hostname(),
    username: os.userInfo().username,
    cpus: os.cpus().length,
    totalMem: os.totalmem(),
    lanAddresses: lanAddresses(),
    dataDir: dataDir(),
    configPath: configPath(),
    coreExe: resolveCoreExe(),
    panelUrl: panelUrl(),
  }));

  ipcMain.handle("core:status", () => ({
    status: core.status,
    pid: core.proc ? core.proc.pid : null,
    startedAt: core.startedAt,
    error: core.lastError,
  }));

  ipcMain.handle("core:start", () => core.start());
  ipcMain.handle("core:stop", () => core.stop());
  ipcMain.handle("core:restart", async () => {
    const r = await core.restart();
    fetchVersionOnce();
    return r;
  });

  ipcMain.handle("config:get", () => parseSettings());
  ipcMain.handle("config:save", async (_e, newSettings, restart) => {
    const wasRunning = core.isRunning();
    const saved = saveSettings(newSettings);
    settings = saved;
    if (restart && wasRunning) {
      await core.restart();
      fetchVersionOnce();
    }
    return saved;
  });
  ipcMain.handle("config:open", () => shell.openPath(configPath()));
  ipcMain.handle("config:openDir", () => shell.openPath(dataDir()));
  ipcMain.handle("panel:open", () => shell.openExternal(panelUrl()));

  ipcMain.handle("autostart:get", () => {
    try {
      return app.getLoginItemSettings().openAtLogin;
    } catch {
      return false;
    }
  });
  ipcMain.handle("autostart:set", (_e, enabled) => {
    app.setLoginItemSettings({ openAtLogin: !!enabled, args: [] });
    return !!enabled;
  });

  ipcMain.handle("stats:get", () => statsCache);
  ipcMain.handle("version:get", () => fetchVersionOnce());

  ipcMain.handle("dialog:openConfig", async () => {
    const r = await dialog.showOpenDialog(mainWindow, {
      title: "选择 config.yaml",
      filters: [{ name: "YAML", extensions: ["yaml", "yml"] }],
      properties: ["openFile"],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    fs.copyFileSync(r.filePaths[0], configPath());
    return parseSettings();
  });
}

/* ---------------- lifecycle ---------------- */

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    app.setAppUserModelId("com.mihomo.lan.gateway");
    core = new MihomoCore();
    seedIfNeeded();
    settings = parseSettings();
    registerIpc();
    createWindow();
    createTray();

    if (process.argv.includes("--start")) {
      core.start().then(fetchVersionOnce);
    }

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
      else if (mainWindow) mainWindow.show();
    });
  });

  app.on("before-quit", async (e) => {
    quitting = true;
    if (core && core.isRunning()) {
      e.preventDefault();
      await core.stop();
      app.quit();
    }
  });

  app.on("window-all-closed", () => {
    // keep running in tray
  });
}
