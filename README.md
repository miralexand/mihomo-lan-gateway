# mihomo-lan-gateway

使用 Docker 部署 [mihomo](https://github.com/MetaCubeX/mihomo) 内核，把宿主机（可访问外网）变成局域网的代理网关。内网设备只需把系统/浏览器代理设置为 `宿主机IP:7890`，即可通过宿主机的网络访问外网。

> 不想碰 Docker / 命令行？直接用 [`desktop/` 桌面版](#桌面版推荐)：一个 exe，打开就是开关、日志、流量与连接统计，内核和面板都已内置。

## 原理

```
┌──────────────┐      设置代理         ┌────────────────────────────┐
│ 内网设备      │ ───────────────────▶ │ 宿主机 (可直连外网)          │
│ 手机/PC/NAS  │   HTTP / SOCKS5      │  :7890  :7891  :9090       │
└──────────────┘  192.168.x.x:7890    │  ┌──────────────────────┐  │
                                       │  │ Docker 容器: mihomo   │  │
                                       │  │ allow-lan: true       │  │
                                       │  │ rules: MATCH,DIRECT ──┼──┼──▶ 互联网
                                       │  └──────────────────────┘  │
                                       └────────────────────────────┘
```

- 容器使用默认 bridge 网络，出站流量经宿主机 NAT 转发，因此走的就是宿主机的网络。
- `allow-lan: true` + `bind-address: '*'` 让 mihomo 监听 `0.0.0.0`，局域网设备才能连上。
- 默认 `rules: MATCH,DIRECT`，即纯转发。后续可在 `config/config.yaml` 中加入节点/订阅实现分流。

## 目录结构

```
.
├── docker-compose.yml   # 编排文件
├── .env.example         # 端口等环境变量示例
├── config/
│   ├── config.yaml      # mihomo 配置（已开启 LAN 监听）
│   └── ui/              # 面板静态文件（由脚本拉取，不入库）
├── scripts/
│   ├── fetch-ui.sh           # 拉取 metacubexd 面板（Linux/macOS）
│   ├── fetch-ui.ps1          # 拉取 metacubexd 面板（Windows）
│   ├── fetch-mihomo.ps1      # 下载 mihomo 内核（Windows 原生）
│   ├── run-native.ps1        # 原生运行（Windows）
│   ├── install-service.ps1   # 注册开机自启（Windows）
│   ├── uninstall-service.ps1 # 卸载开机自启（Windows）
│   ├── build-desktop.ps1     # 一键构建桌面版 exe（Windows）
│   └── run-desktop.ps1       # 开发模式启动桌面版（Windows）
├── desktop/             # 桌面控制台（Electron 源码）
│   ├── src/             # 主进程 / 预加载 / 渲染界面
│   ├── build/icon.png   # 应用图标
│   ├── electron-builder.yml
│   ├── package.json
│   └── dist/            # 打包产物（不入库）
├── bin/                 # 原生内核存放处（不入库）
├── .gitignore
└── README.md
```

## 桌面版（推荐）

`desktop/` 是一个基于 Electron 的图形控制台，把「开关代理服务器 / 看日志 / 看流量与连接 / 改设置」全部收进一个 exe。内核（`mihomo.exe`）、默认配置与面板都已内置，**双击即用，无需 Docker、无需命令行**。

### 功能

- **一键开关**：顶部大开关启动 / 停止内核，实时显示运行状态、PID、运行时长；托盘图标右键也能启停。
- **实时数据**：下载 / 上传速度、累计流量、活动连接数、内核内存占用。
- **连接列表**：每条连接的主机、目标、来源、命中规则、代理链路与流量，支持筛选。
- **运行日志**：内核日志实时滚动，可按级别（info/warning/error/debug）过滤、搜索、清空。
- **接入信息**：自动列出本机局域网 IP 对应的 HTTP+SOCKS5 混合端口，一键复制；一键打开内置 metacubexd 面板。
- **设置页**：端口、Secret、allow-lan、IPv6、运行模式、日志级别、开机自启，保存后可选择立即重启内核；支持导入 / 编辑配置文件。
- **系统信息**：主机名、当前用户、操作系统、CPU 核心数、物理内存、内核版本。

### 直接使用（不需要自己构建）

运行构建产出即可（见下节），或直接双击：

- `MihomoGateway-<版本>-portable.exe`：单文件便携版，双击运行，适合放 U 盘。
- `MihomoGateway-<版本>-setup.exe`：安装版，自动创建开始菜单与桌面快捷方式。

首次启动会把内置配置与面板释放到 `%APPDATA%\mihomo-gateway-desktop\data\`，之后所有修改都保存在该目录，升级 exe 不影响配置。

> 便携版 / 安装版默认以管理员权限运行，以便内核绑定 7890/7891/9090 并自动放行 Windows 防火墙。

### 自己构建

```powershell
# 一键构建（自动准备内核与面板、安装依赖、打包 exe）
.\scripts\build-desktop.ps1
```

产物在 `desktop\dist\`。开发调试（热启动，不打包）：

```powershell
.\scripts\run-desktop.ps1              # 只开界面
.\scripts\run-desktop.ps1 -StartCore   # 开界面并自动启动代理
```

> 打包默认使用 npmmirror 镜像下载 Electron 二进制。若在可直连 GitHub 的网络，可删除 `scripts\build-desktop.ps1` 中的 `ELECTRON_MIRROR` / `ELECTRON_BUILDER_BINARIES_MIRROR`。

## 前置要求

- 已安装 Docker 与 Docker Compose v2（`docker compose version`）。
- 镜像 `metacubex/mihomo` 为多架构镜像，`amd64` / `arm64` 均自动匹配，无需自行构建。

## 快速开始

1. 克隆仓库并进入目录：

   ```bash
   git clone https://github.com/<你的用户名>/mihomo-lan-gateway.git
   cd mihomo-lan-gateway
   ```

2. （可选）复制环境变量文件并按需修改端口：

   ```bash
   cp .env.example .env
   ```

3. **修改控制面板密码**，编辑 `config/config.yaml` 中的 `secret`：

   ```yaml
   secret: "改成你自己的强密码"
   ```

4. 启动：

   ```bash
   docker compose up -d
   ```

5. 查看日志确认启动成功：

   ```bash
   docker compose logs -f
   ```

## 局域网设备设置代理

先查到宿主机内网 IP（`ip addr` / `ipconfig`），例如 `192.168.1.10`，然后：

| 平台 | 设置路径 |
| --- | --- |
| Windows | 设置 → 网络和 Internet → 代理 → 手动设置代理 → 地址 `192.168.1.10` 端口 `7890` |
| macOS | 系统设置 → 网络 → 详细信息 → 代理 → Web/安全网页代理 `192.168.1.10:7890` |
| Android | WLAN → 长按已连接网络 → 修改 → 高级 → 代理 → 手动 |
| iOS | WLAN → 点击网络右侧 ⓘ → 配置代理 → 手动 |
| Linux | `export http_proxy=http://192.168.1.10:7890 https_proxy=http://192.168.1.10:7890` |

> 仅需 HTTP/SOCKS5 代理时填 `7890`（mixed 端口同时支持两种协议）；需要纯 SOCKS5 时用 `7891`。

## 验证

在任一内网设备上执行：

```bash
curl -x http://192.168.1.10:7890 https://www.google.com -I
```

能返回 HTTP 状态码即成功。

## 端口说明

| 端口 | 用途 | 是否暴露到局域网 |
| --- | --- | --- |
| 7890 | mixed（HTTP + SOCKS5） | 是，内网设备填这个 |
| 7891 | 纯 SOCKS5 | 是 |
| 9090 | 控制面板 API（RESTful） | 是，建议仅内网/加密码 |
| 1053 | 内置 DNS | 否（仅容器内使用） |

### 访问控制面板

`9090` 是 mihomo 的 **API 端口，本身不是网页**，直接访问会返回 `401`。面板已由 mihomo 内置托管（`external-ui: ui`），浏览器打开：

```
http://<宿主机IP>:9090/ui/
```

密码填 `config/config.yaml` 中的 `secret`。

面板默认使用亮色主题 `nord`（在 `config/ui/config.js` 中预设，仅对未设置过主题的浏览器生效）。想换主题可在面板 **设置 → 外观** 里切换，或点顶部主题按钮；改完按 `Ctrl+F5` 强刷。

首次启动时 mihomo 会自动从 `external-ui-url` 下载面板（已指向可用的 GitHub 代理），一般无需手动操作。若自动下载失败，可运行拉取脚本：

```bash
./scripts/fetch-ui.sh          # Linux / macOS
```
```powershell
.\scripts\fetch-ui.ps1         # Windows
```

自定义代理地址可设置环境变量 `MIHOMO_UI_URL`。也可以用在线面板 [metacubexd](https://metacubexd.pages.dev)，控制器地址填 `http://<宿主机IP>:9090`，但注意 HTTPS 页面连 HTTP 控制器会被浏览器拦截（`127.0.0.1` 除外）。

## 裸跑（Windows 原生，可选）

Docker Desktop（Windows/WSL2）在端口转发时会把连接源 IP 改写为容器网关 `172.x.x.1`，导致面板看不到真实客户端 IP、也无法按设备分流。若需要真实 IP，可改为在 Windows 上直接运行 `mihomo.exe`，不经过 Docker。

> 裸跑与 Docker **不能同时运行**（端口冲突）。切换前先执行 `docker compose down`。

### 首次运行

```powershell
# 1. 下载内核（自动经 GitHub 代理获取最新版）
.\scripts\fetch-mihomo.ps1

# 2. 启动（复用同一份 config/config.yaml）
.\scripts\run-native.ps1
```

`run-native.ps1` 会先检查 7890 是否被占用；建议**以管理员身份**运行一次，以便自动添加防火墙入站规则。

### 开机自启

```powershell
# 管理员 PowerShell
.\scripts\install-service.ps1     # 注册为开机启动的计划任务（SYSTEM）
.\scripts\uninstall-service.ps1   # 卸载
```

### 与 Docker 的差异

| 项目 | Docker（bridge） | Windows 原生 |
| --- | --- | --- |
| 客户端真实 IP | 显示为 `172.x.x.1` | 真实局域网 IP |
| 出站网络 | 宿主 NAT | 宿主直连 |
| 配置文件 / 面板 | 共用 `config/` | 共用 `config/` |

配置文件、面板地址（`http://<宿主机IP>:9090/ui/`）、内网设备代理设置（`宿主机IP:7890`）完全一致，两者只能二选一运行。

## （可选）接入订阅 / 节点

默认 `MATCH,DIRECT` 是纯转发。若要使用机场订阅或自建节点，把 `config/config.yaml` 的对应部分替换为：

```yaml
proxy-providers:
  airport:
    type: http
    url: "你的订阅链接"
    interval: 3600
    path: ./providers/airport.yaml
    health-check:
      enable: true
      url: https://www.gstatic.com/generate_204
      interval: 300

proxy-groups:
  - name: PROXY
    type: select
    use:
      - airport

rules:
  - GEOIP,CN,DIRECT
  - MATCH,PROXY
```

> 订阅链接包含账号信息，请勿把它提交到公开仓库。可改为本地单独维护或在 `.gitignore` 中排除该文件。

## 防火墙放行

- Linux（ufw）：`sudo ufw allow 7890/tcp && sudo ufw allow 7891/tcp && sudo ufw allow 9090/tcp`
- Linux（firewalld）：`sudo firewall-cmd --permanent --add-port=7890/tcp --add-port=7891/tcp --add-port=9090/tcp && sudo firewall-cmd --reload`
- Windows：入站规则放行 TCP `7890/7891/9090`（仅限专用网络）；`scripts/run-native.ps1` 在管理员权限下会自动创建名为 `mihomo proxy` 的规则。
- 若宿主机位于云服务器，还需在安全组放行对应端口。

## 安全建议

- **务必修改** `config/config.yaml` 中的 `secret`，避免控制面板被任意访问。
- 如果仅在家庭内网使用，不要把 `7890/7891/9090` 映射到公网。
- 需要认证的代理，可为 mihomo 配置 `authentication` 字段限制用户。

## 常见问题

- **内网设备连不上**：确认 `allow-lan: true`、宿主机防火墙已放行、设备与宿主机在同一网段。
- **能连代理但打不开网页**：确认宿主机本身能访问外网；查看 `docker compose logs -f` 报错。
- **ARM 设备启动失败**：确认 Docker 能拉取多架构镜像，或先 `docker pull metacubex/mihomo:latest`。
- **想固定版本**：把 `docker-compose.yml` 中 `metacubex/mihomo:latest` 换成具体 tag，例如 `metacubex/mihomo:v1.18.8`。
- **面板里所有设备都显示 `172.x.x.1`**：这是 Docker Desktop 的源 IP 改写，改用「裸跑（Windows 原生）」即可看到真实 IP。

## 推送到 GitHub

```bash
git init
git add .
git commit -m "feat: dockerized mihomo LAN proxy gateway"
git branch -M main
git remote add origin https://github.com/<你的用户名>/mihomo-lan-gateway.git
git push -u origin main
```

## 许可证

MIT
