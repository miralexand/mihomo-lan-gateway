"use strict";

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

let appInfo = null;
let currentSettings = null;
let coreStatus = "stopped";
let lastStats = {};
let logBuffer = [];

/* ---------------- formatting ---------------- */

function formatBytes(n) {
  if (!n || n < 1) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatSpeed(n) {
  return `${formatBytes(n)}/s`;
}

function formatDuration(ms) {
  if (!ms || ms < 0) return "00:00:00";
  const s = Math.floor(ms / 1000);
  const h = String(Math.floor(s / 3600)).padStart(2, "0");
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${h}:${m}:${ss}`;
}

function formatTime(iso) {
  const d = iso ? new Date(iso) : new Date();
  return d.toLocaleTimeString("zh-CN", { hour12: false });
}

function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/* ---------------- toast ---------------- */

let toastTimer = null;
function toast(msg, type = "") {
  const el = $("#toast");
  el.textContent = msg;
  el.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = "toast"), 2600);
}

/* ---------------- clipboard ---------------- */

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {}
    document.body.removeChild(ta);
    return ok;
  }
}

/* ---------------- navigation ---------------- */

function setupNav() {
  $$(".nav-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      $$(".nav-item").forEach((b) => b.classList.remove("active"));
      $$(".view").forEach((v) => v.classList.remove("active"));
      btn.classList.add("active");
      $(`#view-${btn.dataset.view}`).classList.add("active");
    });
  });
}

/* ---------------- status ---------------- */

function applyStatus(s) {
  coreStatus = s.status;
  const running = s.status === "running";
  const busy = s.status === "starting" || s.status === "stopping";

  $("#powerToggle").checked = running;
  $("#powerToggle").disabled = busy;
  $("#btnRestart").disabled = busy;

  $("#statusDot").className = `dot ${s.status}`;
  $("#sideStatusDot").className = `dot ${s.status}`;

  const titles = {
    running: "代理服务器运行中",
    stopped: "代理服务器已停止",
    starting: "正在启动...",
    stopping: "正在停止...",
  };
  $("#statusTitle").textContent = titles[s.status] || s.status;

  let sub = "";
  if (running) sub = `PID ${s.pid ?? "-"} · 已运行 ${formatDuration(Date.now() - (s.startedAt || Date.now()))}`;
  else if (s.error) sub = s.error;
  else if (s.status === "stopped") sub = "点击右侧开关启动内核";
  $("#statusSub").textContent = sub;

  $("#sideStatusText").textContent = running ? "运行中" : busy ? "处理中" : "已停止";
  $("#sidePid").textContent = running ? `PID ${s.pid ?? "-"}` : s.error ? "启动异常" : "--";
}

/* ---------------- stats ---------------- */

function renderStats(st) {
  lastStats = st || {};
  $("#statDown").textContent = formatSpeed(st.down || 0);
  $("#statUp").textContent = formatSpeed(st.up || 0);
  $("#statConns").textContent = st.conns || 0;
  $("#statMem").textContent = formatBytes(st.memory || 0);
  $("#statDownTotal").textContent = `累计 ${formatBytes(st.downTotal || 0)}`;
  $("#statUpTotal").textContent = `累计 ${formatBytes(st.upTotal || 0)}`;
  if (st.memoryOS) {
    $("#statMemPct").textContent = `系统 ${((st.memory / st.memoryOS) * 100).toFixed(1)}%`;
  }
  $("#connCount").textContent = st.conns || 0;
  if (st.mode) $("#modeCell").textContent = st.mode;
  renderConnections(st.connections || []);
}

let connSearchTerm = "";
function renderConnections(list) {
  const filter = connSearchTerm.toLowerCase();
  const rows = list
    .filter((c) => {
      if (!filter) return true;
      return (
        (c.host || "").toLowerCase().includes(filter) ||
        (c.rule || "").toLowerCase().includes(filter) ||
        (c.chains || []).join(" ").toLowerCase().includes(filter)
      );
    })
    .map(
      (c) => `<tr>
        <td title="${escapeHtml(c.host)}">${escapeHtml(c.host) || "-"}</td>
        <td title="${escapeHtml(c.dest)}">${escapeHtml(c.dest) || "-"}</td>
        <td>${escapeHtml(c.source) || "-"}</td>
        <td>${escapeHtml(c.network) || "-"}</td>
        <td>${escapeHtml(c.rule)}${c.rulePayload ? "(" + escapeHtml(c.rulePayload) + ")" : ""}</td>
        <td title="${escapeHtml((c.chains || []).join(" ⇐ "))}">${escapeHtml((c.chains || []).reverse().join(" ⇐ "))}</td>
        <td>${formatBytes(c.upload)}</td>
        <td>${formatBytes(c.download)}</td>
      </tr>`
    );
  const tbody = $("#connTable tbody");
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty">暂无活动连接</td></tr>`;
  } else {
    tbody.innerHTML = rows.join("");
  }
}

function updateEndpoints() {
  const s = currentSettings;
  if (!s) return;
  const lan = appInfo && appInfo.lanAddresses && appInfo.lanAddresses[0];
  const host = lan ? lan.address : "127.0.0.1";
  const map = {
    mixed: `${host}:${s.mixedPort}`,
    socks: `${host}:${s.socksPort}`,
    controller: `${host}:${s.controllerPort}`,
  };
  for (const key of Object.keys(map)) {
    const el = document.querySelector(`.endpoint[data-copy="${key}"]`);
    if (el) el.textContent = map[key];
  }
  $("#secretCell").textContent = s.secret ? "••••••••" : "(未设置)";
}

/* ---------------- logs ---------------- */

function logMatches(entry) {
  const level = $("#logLevel").value;
  const term = $("#logSearch").value.trim().toLowerCase();
  if (level !== "all" && entry.level !== level) return false;
  if (term && !entry.message.toLowerCase().includes(term)) return false;
  return true;
}

function appendLog(entry) {
  logBuffer.push(entry);
  if (logBuffer.length > 3000) logBuffer = logBuffer.slice(-2000);
  if (!logMatches(entry)) return;
  const list = $("#logList");
  const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 60;
  const row = document.createElement("div");
  row.className = "log-line";
  row.dataset.level = entry.level;
  row.innerHTML = `<span class="t">${formatTime(entry.time)}</span>
    <span class="lv ${entry.level}">${entry.level.toUpperCase()}</span>
    <span class="msg">${escapeHtml(entry.message)}</span>`;
  list.appendChild(row);
  while (list.childElementCount > 2000) list.removeChild(list.firstChild);
  if ($("#logAuto").checked && nearBottom) list.scrollTop = list.scrollHeight;
}

function rerenderLogs() {
  const list = $("#logList");
  list.innerHTML = "";
  for (const entry of logBuffer) {
    if (!logMatches(entry)) continue;
    const row = document.createElement("div");
    row.className = "log-line";
    row.innerHTML = `<span class="t">${formatTime(entry.time)}</span>
      <span class="lv ${entry.level}">${entry.level.toUpperCase()}</span>
      <span class="msg">${escapeHtml(entry.message)}</span>`;
    list.appendChild(row);
  }
  list.scrollTop = list.scrollHeight;
}

/* ---------------- settings ---------------- */

function fillSettings(s) {
  currentSettings = s;
  $("#cfgMixed").value = s.mixedPort;
  $("#cfgSocks").value = s.socksPort;
  $("#cfgController").value = s.controllerPort;
  $("#cfgSecret").value = s.secret;
  $("#cfgBind").value = s.bindAddress;
  $("#cfgAllowLan").checked = s.allowLan;
  $("#cfgIpv6").checked = s.ipv6;
  $("#cfgMode").value = s.mode;
  $("#cfgLogLevel").value = s.logLevel;
  updateEndpoints();
}

function collectSettings() {
  return {
    mixedPort: Number($("#cfgMixed").value) || 7890,
    socksPort: Number($("#cfgSocks").value) || 7891,
    controllerPort: Number($("#cfgController").value) || 9090,
    secret: $("#cfgSecret").value,
    bindAddress: $("#cfgBind").value || "*",
    allowLan: $("#cfgAllowLan").checked,
    ipv6: $("#cfgIpv6").checked,
    mode: $("#cfgMode").value,
    logLevel: $("#cfgLogLevel").value,
  };
}

async function saveSettings(restart) {
  const saved = await window.gateway.saveConfig(collectSettings(), restart);
  fillSettings(saved);
  $("#saveHint").textContent = `已保存 ${new Date().toLocaleTimeString("zh-CN", { hour12: false })}`;
  toast(restart ? "已保存并重启内核" : "设置已保存", "success");
}

/* ---------------- power / actions ---------------- */

async function togglePower(on) {
  const toggle = $("#powerToggle");
  toggle.disabled = true;
  try {
    const res = on ? await window.gateway.start() : await window.gateway.stop();
    if (res && res.ok === false) {
      toast(res.error || "操作失败", "error");
      applyStatus(await window.gateway.status());
    }
    const v = await window.gateway.getVersion();
    if (v && v.version) appInfo && setCoreVersion(v.version);
  } catch (e) {
    toast(String(e.message || e), "error");
  } finally {
    toggle.disabled = false;
  }
}

function setCoreVersion(v) {
  $("#sysCore").textContent = v || "-";
}

/* ---------------- init ---------------- */

async function init() {
  setupNav();

  appInfo = await window.gateway.appInfo();
  currentSettings = await window.gateway.getConfig();

  $("#panelLink").addEventListener("click", (e) => {
    e.preventDefault();
    window.gateway.openPanel();
  });

  $("#sysApp").textContent = `v${appInfo.appVersion} (Electron ${appInfo.electron})`;
  $("#sysHost").textContent = appInfo.hostname;
  $("#sysUser").textContent = appInfo.username;
  $("#sysOs").textContent = appInfo.platform;
  $("#sysHw").textContent = `${appInfo.cpus} 核 / ${formatBytes(appInfo.totalMem)}`;
  if (appInfo.lanAddresses.length) {
    $("#sysHost").textContent = `${appInfo.hostname} (${appInfo.lanAddresses[0].address})`;
  }

  fillSettings(currentSettings);
  applyStatus(await window.gateway.status());

  const autostart = await window.gateway.getAutostart();
  $("#cfgAutostart").checked = !!autostart;

  const version = await window.gateway.getVersion();
  if (version && version.version) setCoreVersion(version.version);
  renderStats(await window.gateway.getStats());

  window.gateway.onStatus(applyStatus);
  window.gateway.onStats(renderStats);
  window.gateway.onLog(appendLog);

  /* nav-independent wiring */
  $("#powerToggle").addEventListener("change", (e) => togglePower(e.target.checked));
  $("#btnRestart").addEventListener("click", async () => {
    $("#btnRestart").disabled = true;
    toast("正在重启内核...");
    const r = await window.gateway.restart();
    if (r && r.ok === false) toast(r.error || "重启失败", "error");
    else toast("内核已重启", "success");
  });

  document.addEventListener("click", async (e) => {
    const btn = e.target.closest(".mini.copy");
    if (!btn) return;
    const key = btn.dataset.copy;
    const el = document.querySelector(`.endpoint[data-copy="${key}"]`);
    if (el && (await copyText(el.textContent))) toast(`已复制 ${el.textContent}`, "success");
  });

  $("#connSearch").addEventListener("input", (e) => {
    connSearchTerm = e.target.value;
    renderConnections(lastStats.connections || []);
  });

  $("#logLevel").addEventListener("change", rerenderLogs);
  $("#logSearch").addEventListener("input", rerenderLogs);
  $("#logClear").addEventListener("click", () => {
    logBuffer = [];
    $("#logList").innerHTML = "";
  });

  $("#btnSave").addEventListener("click", () => saveSettings(false));
  $("#btnSaveRestart").addEventListener("click", () => saveSettings(true));
  $("#btnImport").addEventListener("click", async () => {
    const s = await window.gateway.importConfig();
    if (s) {
      fillSettings(s);
      toast("配置已导入，建议保存并重启", "success");
    }
  });
  $("#btnOpenCfg").addEventListener("click", () => window.gateway.openConfig());
  $("#btnOpenDir").addEventListener("click", () => window.gateway.openConfigDir());
  $("#cfgAutostart").addEventListener("change", async (e) => {
    await window.gateway.setAutostart(e.target.checked);
    toast(e.target.checked ? "已开启开机自启" : "已关闭开机自启", "success");
  });

  setInterval(async () => {
    if (coreStatus === "running") {
      const s = await window.gateway.status();
      if (s.status === "running" && s.startedAt) {
        $("#statusSub").textContent = `PID ${s.pid ?? "-"} · 已运行 ${formatDuration(Date.now() - s.startedAt)}`;
        $("#sysUptime").textContent = formatDuration(Date.now() - s.startedAt);
      }
    } else {
      $("#sysUptime").textContent = "--";
    }
  }, 1000);

  $("#sysUptime").textContent = "--";
}

window.addEventListener("DOMContentLoaded", init);
