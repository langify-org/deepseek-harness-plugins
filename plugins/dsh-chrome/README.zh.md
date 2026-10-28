# dsh-chrome

[English](README.md) | [日本語](README.ja.md) | 简体中文

在 DeepSeek Harness（DSH）的右侧边栏中，让你与 agent 共用一个真正的 Chrome。

dsh-chrome 在 DSH 运行的机器上运行一台属于它自己的 Chrome，使用它自己的用户资料，也占一块自己的屏幕。每个 DSH 会话在那里都有自己的 Chrome 窗口：会话的侧边栏显示这个窗口，连同其中的标签页、地址栏、菜单和扩展弹窗，并把你的指针、按键和文字发送过去；会话的 agent 则用工具读取和操作其中的页面。并排打开的会话各自显示自己的窗口。用户资料会保留你在其中设置好的内容，或你从自己的 Chrome 复制进来的内容：你登录过的网站、Chrome 的同步、1Password 之类的扩展。无论是从 DSH Desktop，还是在别处（例如 tailnet 上的一部手机）用浏览器打开的 DSH，用起来都一样。

工作原理与如此设计的理由见 [docs/design.md](docs/design.md)。

## 需求

- DSH 0.2（`>=0.2.1-rc.2 <0.3`），以及它的 Web 客户端。
- Linux，并且 DSH 运行的机器上装有：
  - Google Chrome。已在 Chrome 154 上测试。
  - TigerVNC 的 `Xvnc`，即 Chrome 在其上绘制的 X 服务器；它把屏幕保存在内存中，并通过 VNC 提供（Nix 中为 `tigervnc`，Debian 和 Ubuntu 上为 `tigervnc-standalone-server`）。
  - Openbox，即让 Chrome 的窗口铺满这块屏幕的窗口管理器。
  - 如需 WebGL，还需要适用于该机器 GPU 的 Vulkan 驱动（NVIDIA 或 Mesa 的）。
- 不支持 macOS 和 Windows：这里的屏幕是一个 X 服务器。

## 安装

1. 构建插件：在本仓库中运行 `nix build .#dsh-chrome`，会得到 `result/langify-org-dsh-chrome-<version>.tgz`。把这个 tarball 复制到一个固定的位置。
2. 在 DSH 中打开**插件 → Add plugin**，填入该 tarball 的绝对路径。然后彻底重启 DSH（在 Desktop 上：退出，而不是只关掉窗口）。

就这些：打开 Chrome 标签页时、或 agent 第一次打开页面时，Chrome 就会启动。它的设置就在**插件**页里它自己的那一页上。如果想改为从本仓库试用这个插件，可以在仓库根目录运行 `pnpm dev`，它会提供一个装好该插件的开发版 DSH。

dsh-chrome 把自己的文件放在 DSH home 中，与 DSH 的其他数据放在一起：`dsh` 使用 `~/.dsh`，DSH Desktop 使用它自己的 home，或者由 `DSH_HOME` 指向的位置。用户资料位于其中的 `dsh-chrome/chrome-profile`。每个 home 都有自己的 Chrome 和屏幕，因此 home 不同的多个 DSH 安装可以同时运行。

### 从 0.4 起

Chrome 现在按你所使用显示器的像素比绘制（`deviceScaleFactor` 为 `auto`）：在多数显示器上，这是 0.4 所绘制并发送的像素数的四分之一，CPU 开销也随之降低（见[设计](docs/design.md#how-the-screen-reaches-the-sidebar)）。你自行设置的 `deviceScaleFactor` 保持不变。Chrome 在 CPU 上合成它的页面，这比从 GPU 读回每一帧的开销更小；WebGL 仍然在 GPU 上绘制。复制用户资料时会报告进展。更新后请重新加载 DSH 的页面：侧边栏和设置页只按本版本的约定与插件通信。

### 从 0.3 起

每个会话现在都有自己的窗口，因此会话之间不再互相占用视图；Chrome 不再自己打开窗口，并且在所有窗口关闭后仍然运行。DSH 运行期间可以修改的设置现在位于 DSH 的**插件**页（见[配置](#配置)）；在 `cordis.patch.yml` 中设置的内容仍然有效。在装有 Vulkan GPU 驱动的机器上，WebGL 现在可以正常工作。

### 从 0.2 或 0.1 起

0.3 显示整个 Chrome 窗口，而不是单个页面，并且只运行自己的 Chrome：

- 0.2 使用的用户资料（`dsh-chrome/profiles/dedicated`）会迁移到 `dsh-chrome/chrome-profile`，其中的登录状态和扩展一并保留。连接器扩展及其中继会从 DSH home 中删除；用户资料中以及你自己的 Chrome 中（`NativeMessagingHosts/io.github.langify_org.dsh_chrome.json`）指向本 DSH home 中继的注册项也会被删除。之后 Chrome 会自行从用户资料中移除该连接器。
- 不再共用你自己的 Chrome。如果你在 0.1 中把连接器加载到了自己的 Chrome 里，请在 `chrome://extensions` 中移除它。
- 0.2 的设置项（`dedicatedProfile`、`dailyProfile`、`defaultProfile`、`viewer`、`connectorSocketPath`、`nodeExecutable`）会被忽略；见[配置](#配置)。

## 初次设置

如果想沿用你自己 Chrome 的登录状态、密码、书签和扩展，可以复制它的某个用户资料：在 DSH 中打开**插件**页里 dsh-chrome 那一页，在 **Copy a profile of your Chrome** 下选择用户资料，点击 **Copy…**，然后确认。复制会替换 dsh-chrome 的用户资料（被替换的那份会以 `Default.before-copy` 的名字保留在旁边，直到下一次复制），复制期间 Chrome 会关闭，所有会话中的窗口一并关闭。页面会显示复制的进度：先复制文件，再检查数据库，然后关闭 Chrome，由副本接替原来的用户资料。在复制过程中或复制之后打开、重新加载的页面也会显示复制的进度或结果；与 DSH 的连接断开或失去响应的页面会重新连接，再显示它们。若要得到完全一致的副本，请先关闭你自己的 Chrome；正在运行的 Chrome 可能还没有写入最后的更改。复制出的用户资料会作为一台独立设备加入 Chrome Sync。

或者从侧边栏的新标签页引导中打开 **Chrome**，像设置一台新的 Chrome 那样在其中完成设置：

- 登录 agent 需要使用的网站；登录状态会保留；
- 如果愿意，也可以登录 Chrome 本身，这样同步会带来你的书签、保存的密码和扩展；
- 从 Chrome 应用商店安装 1Password 并登录。dsh-chrome 会让该用户资料中的扩展可以触达你自己的 Chrome 所能触达的原生应用，因此 1Password 的扩展能像在你自己的 Chrome 中一样，找到运行在那台机器上的桌面应用（`shareNativeHosts`）。

## 使用

| 侧边栏中 | |
| --- | --- |
| 点击、拖动、滚动、输入 | 会发送到 Chrome，就像在它自己的屏幕上操作一样。日语及其他输入法在 DSH 中组合，组合完成的文字再发送到 Chrome。 |
| 键盘快捷键 | 按按键的字母发送到 Chrome；在没有拉丁字母的键盘布局上，按美式键盘对应的键发送，因此在俄语键盘上 Ctrl+C 也能复制。在 macOS 上，⌘ 等同于 Ctrl。用 AltGr 或 Option 输入的字符会按其本身输入。显示 DSH 的浏览器会自己保留一些快捷键（在 Chrome 中：Ctrl+T、Ctrl+W、Ctrl+N）：这些请改用 Chrome 自己的 ＋ 和 ✕。 |
| 复制和粘贴 | 你在 Chrome 中执行的复制（快捷键、菜单、页面上的按钮）也会进入你自己的剪贴板，前提是浏览器允许：DSH 通过 HTTPS 提供，或在 `localhost` 上。agent 复制的内容只留在 Chrome 中。Ctrl+V（⌘V）粘贴的是你自己的剪贴板；如果上次在 Chrome 中复制的内容没能进入你的剪贴板，则粘贴 Chrome 的剪贴板。 |
| 📷 / 📄 | 把 Chrome 的截图，或你正在查看的页面的文字，添加到你的下一条消息中。 |
| ⌨ | 显示触摸屏的键盘。在触摸屏上，轻点即点击，两指拖动即滚动。 |

Chrome 自己的界面和页面一样出现在屏幕上：菜单、权限提示、扩展弹窗、它保存的下载文件（保存在 DSH 运行的机器的下载文件夹中），以及页面打开的对话框。页面打开的窗口（例如登录弹窗）会一直位于打开它的窗口之上，直到关闭；它的标题栏上有一个关闭按钮。

每个会话的 Chrome 标签页显示该会话自己的窗口。打开标签页就会打开窗口，并在需要时启动 Chrome，这些都在标签页显示之后进行；窗口大小取标签页的大小，Chrome 按该标签页所在显示器的像素比绘制，因此清晰度与该显示器所能显示的一致，也不会绘制多余的像素。同一会话的两个标签页（位于两个浏览器窗口中，或在手机上）显示同一个窗口，大小取你最后查看或操作的那一个；另一个则以缩放适应的大小显示。你在某个会话的标签页中输入的按键会发送到该会话的窗口，即使另一个会话的 agent 正在自己的窗口中操作。当你在 Chrome 中关闭该会话的最后一个标签页后，Chrome 标签页会提供 **Open a window**。Chrome 本身会一直运行，直到 DSH 停止，或者你从它的菜单中退出；之后标签页会提供 **Open Chrome**，用同一个用户资料重新启动它。

agent 可以使用这些工具：`chrome_pages`、`chrome_open`、`chrome_navigate`、`chrome_snapshot`、`chrome_screenshot`、`chrome_click`、`chrome_type`、`chrome_press`、`chrome_scroll`、`chrome_answer_dialog`、`chrome_close` 和 `chrome_ask_user`。它可以使用本会话的页面：它自己打开的页面、你在该会话窗口中打开的页面，以及这些页面打开的页面；其他会话的页面不属于它。`chrome_open` 会在该会话窗口的前台打开一个新标签页；执行操作时，会先把所操作的页面带到该窗口的前台，就像你自己操作时一样。用 `chrome_ask_user` 时，agent 会请你亲自做某件事，例如登录或输入一次性验证码；请求会显示在 Chrome 上方，带有 **Done** 和 **I can’t**。它的操作会报告由此到达的对话框和页面。每轮开始时，如果 agent 可以使用的页面或你正在查看的页面发生了变化，agent 会被告知它现在可以使用哪些页面、你正在查看哪一个。

## 配置

DSH 运行期间可以修改的设置，在 DSH **插件**页里 dsh-chrome 的那一页上：`executable`、`deviceScaleFactor`、`announceAutomation`、`webgl` 和 `shareNativeHosts`。页面根据插件的配置 schema 生成这些项，并显示各自的说明。Chrome 会在再次启动时采用它们：Chrome 标签页会提示这一点，并提供 **Restart Chrome**，它会关闭所有会话中的 Chrome 窗口。

每个设置也都可以写在 DSH profile 的 `cordis.patch.yml` 中该插件那一行之下；其余设置只能写在那里，修改其中一项会重新启动插件：

```yaml
- id: dsh-chrome
  config:
    deviceScaleFactor: 1
```

| 设置 | 默认值 | 含义 |
| --- | --- | --- |
| `executable` | `google-chrome-stable` | 要运行的 Chrome。 |
| `xvncExecutable` | `Xvnc` | TigerVNC 的 Xvnc。 |
| `windowManagerExecutable` | `openbox` | Openbox。 |
| `deviceScaleFactor` | `auto` | Chrome 的一个 CSS 像素占用屏幕上的多少像素：`auto` 表示在 Chrome 启动时取最后一个请求 Chrome 的标签页所在显示器的像素比（取整到四分之一，范围 1 到 4；在多次启动之间保留，在还没有标签页请求过之前为 1）；也可以是不论显示器如何，取 1 到 4 之间以四分之一为步长的数字。2 在高密度显示器上很清晰，发送的像素是 1 的四倍。 |
| `announceAutomation` | `false` | 告知页面 Chrome 处于自动化控制之下（`navigator.webdriver`）：dsh-chrome 通过管道控制 Chrome，Chrome 本来就会这样告知。告知后 Google 会拒绝登录，其他网站也可能把你当作机器人；见[安全](#安全)。 |
| `webgl` | `gpu` | Chrome 如何绘制 WebGL：`gpu` 表示在你的 GPU 上通过 Vulkan 绘制（没有 Vulkan 驱动时则无法绘制）；`gpu-or-cpu` 表示优先在你的 GPU 上绘制，否则在 CPU 上绘制，速度更慢，也更容易成为恶意页面的攻击目标，这也是 Chrome 自己会拒绝这种方式的原因；`off` 表示由 Chrome 决定，在这块屏幕上就是不使用 WebGL。 |
| `profileDir` | DSH home 中的 `dsh-chrome/chrome-profile` | Chrome 的用户资料，即它的用户数据目录。 |
| `shareNativeHosts` | `true` | 让该用户资料中的扩展可以触达你自己的 Chrome 所能触达的原生应用：把这些应用的原生消息清单文件链接进去。 |
| `userChromeDir` | `~/.config/google-chrome` | 你自己的 Chrome 的用户数据目录：共享哪些原生应用、可以复制哪些用户资料，都由它决定。 |
| `dataDir` | DSH home 中的 `dsh-chrome` | dsh-chrome 存放它在多次启动之间需要记录的内容的位置。 |
| `runtimeDir` | `$XDG_RUNTIME_DIR/dsh-chrome/<digest of the DSH home>`，没有 `XDG_RUNTIME_DIR` 时位于临时目录中 | 屏幕的 VNC socket 和 X cookie 所在的位置。它以及它所在的目录都必须属于你：dsh-chrome 会把它设为私有，并拒绝属于其他用户的目录。 |

工具和每轮开始时提供的信息是两个独立的行，可以分别关闭：

```yaml
- id: dsh-chrome-tools
  disabled: true
- id: dsh-chrome-context
  disabled: true
```

## 限制

- Chrome 对自己不绘制的内容，会请求 DSH 运行的机器的桌面：页面的文件选择器在那里打开（在 GNOME 和 KDE 上通过桌面门户），而不在侧边栏中；网站通知也是如此。目前还无法从另一台设备上传文件。
- 输入法组合出的文字如果含有 ASCII 以外的字符（日语、带音调的字母、emoji），就会以粘贴的方式到达 Chrome，因此它也会成为 Chrome 屏幕的剪贴板内容。按键、ASCII 字符和单个字符则按输入处理。超过 256 KiB（Xvnc 的上限）的粘贴内容不会到达。
- 会话的窗口没有任务栏：请只使用标签页，因为会话的第二个窗口会盖住第一个。
- 同时显示的会话窗口并排放在一块屏幕上，X 让这块屏幕最宽 16384 像素：按默认大小大约能放五个会话，窗口为侧边栏大小时能放更多。超出这个数量的会话会提示没有空间。没有标签页显示的会话（包括 subagent 的会话）会把各自的窗口一起放在旁边，直到有标签页显示它们。
- 某个会话的窗口改变大小时，另一个会话的窗口可能会在其标签页中闪现一瞬。
- WebGL 需要适用于 GPU 的 Vulkan 驱动；没有驱动时页面得不到 WebGL，除非 `webgl` 为 `gpu-or-cpu`。
- agent 的操作和你的按键轮流占用键盘：如果某个页面在其窗口失去键盘时关闭菜单，那么当你在另一个会话中打字时，这个菜单就会关闭。
- 这块屏幕不传输声音。
- subagent 打开的页面属于 subagent 的会话，而不属于你的会话，并且在自己的窗口中打开。
- 在 DSH 中修改的设置会在 Chrome 再次启动时生效，而重启会关闭所有会话的窗口。
- Chrome 对所有会话都以同一比例绘制。使用 `auto` 时，该比例取自 Chrome 启动时最后一个请求 Chrome 的标签页所在显示器的像素比（打开一个标签页、你打开一个页面、重启都算），并在 DSH 的多次启动之间保留；位于另一种像素比显示器上的标签页会以缩放方式显示 Chrome，并提供 **Restart Chrome**，让 Chrome 以该标签页的像素比启动。

## 安全

- 能使用你的 DSH Web UI 的人，就能使用这台 Chrome，以及其中用户资料里的所有登录状态，正如他们也能使用 DSH 的终端一样。
- 不开放任何 TCP 端口。dsh-chrome 通过启动 Chrome 时使用的管道（`--remote-debugging-pipe`）控制它，这条管道只有它持有。Xvnc 只通过 Unix socket 提供屏幕（`-rfbport -1`、`-nolisten tcp`），没有密码，所在的目录只有你的操作系统用户能进入。作为 X 服务器，它只允许获得其 cookie 的程序接入（cookie 在该目录下的 `Xauthority` 中）：Openbox 和 Chrome。你的用户的其他进程被视为可信，因为它们本来就能读取用户资料。
- 侧边栏通过 DSH 自己的、经过认证的 WebSocket 访问屏幕，其准入方式与 DSH 的 `/api` 相同。
- dsh-chrome 只向 Chrome 发送它用到的 CDP 命令，而 agent 的工具只读取和操作网页：不涉及 Chrome 自己的页面（设置、保存的密码）、扩展的页面或本地文件，即使这些是你打开的；也不涉及 cookie 存储、网络流量或页面中其他扩展的代码（例如你的密码管理器的）。
- 不会告知页面 Chrome 处于自动化控制之下：`navigator.webdriver` 为 false，与你手动使用的 Chrome 相同。Chrome 会针对控制它的管道设置该值，而 Google 的登录随即会拒绝这个浏览器（“This browser or app may not be secure”），其他网站的机器人检查也是如此，即使操作的人是你。因此网站也无法分辨 agent 何时在操作；它按人的节奏，在你的会话中、代表你操作。如果你使用的网站要求，可以设置 `announceAutomation` 来告知它们。为此需要启用的参数 `--disable-blink-features=AutomationControlled` 会触发 Chrome 的警告：它会在自己启动时打开的窗口里显示一个提示栏（“unsupported command-line flag”）；但它不会为 dsh-chrome 打开任何窗口，因为每个会话的窗口由 dsh-chrome 自己打开，所以提示栏不会出现。这个参数除了 `navigator.webdriver` 之外不改变任何东西。
- 启用 `shareNativeHosts` 时，该用户资料中的扩展可以启动你自己的 Chrome 所能启动的原生应用。每个应用的清单文件仍然规定它只接受哪些扩展。
- 复制用户资料时只读取你自己 Chrome 的用户资料，只写入 dsh-chrome 的用户资料；dsh-chrome 的 Chrome 会用你的密钥环为 Chrome 保存的密钥来读取其中的登录状态和密码。
- 会话不是人与人之间的边界：能使用 DSH 的人就能使用每个会话的 Chrome 窗口。
- agent 不能通过 Chrome 打开 DSH 自己的 Web UI，也不能操作显示它的页面，包括嵌在框架（frame）里的页面：否则在已登录 DSH 的用户资料中，它就能批准自己的操作。DSH 通过它提供服务的地址来识别；经其他本地端口上的代理访问的 DSH 则不会被识别。
- 页面是 Web 内容：快照、页面文字、对话框和截图都会以不可信内容的标记传给 agent，标题会被加上引号并截短。agent 会被告知绝不要输入密码、验证码或卡号，而应向你询问；但插件无法强制模型在某个输入框中做什么。

## 故障排查

| 现象 | 检查 |
| --- | --- |
| “Xvnc (Xvnc) was not found” | 在 DSH 的环境能找到的位置安装 TigerVNC，或设置 `xvncExecutable`。 |
| “the window manager (openbox) was not found” | 安装 Openbox，或设置 `windowManagerExecutable`。 |
| “Chrome (google-chrome-stable) was not found” | 安装 Google Chrome，或设置 `executable`。 |
| Google：“This browser or app may not be secure” | `announceAutomation` 处于关闭状态，默认就是关闭的。 |
| Chrome 启动后立即关闭 | 可能有另一个 Chrome 在使用该用户资料：dsh-chrome 只运行一个。查找 `--user-data-dir` 为 `profileDir` 的 `chrome` 进程。 |
| 页面得不到 WebGL | 在 DSH 的环境能找到的位置安装了适用于 GPU 的 Vulkan 驱动（用 `vulkaninfo` 检查），或者 `webgl` 为 `gpu-or-cpu`。Chrome 会在再次启动时采用该设置。 |
| “the screen has no room for another session's Chrome” | 关闭你不再查看的会话的 Chrome 标签页，或缩窄侧边栏。 |
| 复制后的用户资料没有登录状态 | 保存 Chrome 密钥（“Chrome Safe Storage”）的密钥环已解锁，且复制的正是你想要的那个用户资料；被替换的用户资料在 `profileDir` 中，名为 `Default.before-copy`。 |
| 1Password 的扩展无法连接桌面应用 | 桌面应用运行在 DSH 运行的机器上，已在其中为 Chrome 开启浏览器集成，并且 `~/.config/google-chrome/NativeMessagingHosts/com.1password.1password.json` 存在。 |

## 开发

在仓库根目录执行 `pnpm install`，然后运行 `pnpm dev`，在开发版 DSH 中试用该插件。在本目录中有 `pnpm build`、`pnpm test`（单元测试）、`pnpm test:compat`（构建之后，针对 DSH 的包运行）和 `pnpm test:integration`。集成测试会在 Openbox 下的 Xvnc 上以临时用户资料启动 Chrome，覆盖：agent 的工具，由 DSH 自己的 schema 校验器检查；屏幕上的 Chrome，像 VNC 客户端那样查看和操作它；以及从构建出的侧边栏模块出发，经 noVNC、无头 Chrome、DSH 的 Web 服务器直到 Chrome 的完整路径，并同时使用两个会话的标签页；此外还有设置页。每个测试进程都有自己的 DSH home。测试文件逐个运行：每个文件都会运行一台 Chrome 及其屏幕，一起运行时会争抢 CPU，而它们等待页面获得焦点和输入的过程无法容忍这种争用。

`src/` 按代码运行的位置划分，Host 内部再按各部分是什么来划分；哪部分可以 import 哪部分，在 [test/unit/dependencies.test.ts](test/unit/dependencies.test.ts) 中定义并检查。

侧边栏打包了 [noVNC](https://github.com/novnc/noVNC) 1.7.0（MPL-2.0），其许可证随包放在 `dist/licenses/` 中。仓库根目录 `patches/` 中的补丁去掉了 noVNC 唯一一处顶层 `await`（DSH 的模块加载器无法运行它），并增加了只查看屏幕某一区域的视图（`viewRegion`），标签页借它显示本会话所属的那部分屏幕。
