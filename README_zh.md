# ![](./icons/icon48.png) CoWatcher (智能观影记录 · 双语字幕 · AI实时字幕翻译 · 沉浸式影视外语学习助手)

[English Documentation](README.md) | 简体中文文档 | [📖 控制面板详细使用指南](docs/popup_guide_zh.md) | [🌟 贡献者与赞助者榜单](CONTRIBUTORS.md) | [⚖️ 第三方开源与数据致谢](CREDITS.md)

[![Ko-fi](https://img.shields.io/badge/Ko--fi-请作者喝杯咖啡-ff5e5b?logo=ko-fi&logoColor=white)](https://ko-fi.com/sfbb49898)
[![Discord](https://img.shields.io/badge/Discord-加入交流社区-5865F2?logo=discord&logoColor=white)](https://discord.gg/kXdPU4vh9K)

我们支持:

- [x] Netflix, TVer，YouTube字幕翻译
- [x] 平台提供的双语字幕展示
- [x] YouTube自动生成字幕自动合并为正常字幕
- [x] 后台生词识别，与你的Anki学习流水线无缝衔接
- [x] 角色名一致性约束与手动校正
- [x] 翻译字幕缓存，下次观看时，你的Token不会浪费
- [x] 原生级字幕排版：完美支持横排与竖排字幕渲染，排版与平台原生质感浑然一体。
- [x] 多tab支持，即使同时观看多平台的串流也不会乱
- [x] 免费的传统翻译服务，本地Ollama小型模型，OpenRouter云端大型模型，任你选择
- [x] 生词一键记录，让你的学习过程压力更小
- [x] 点击即可立刻查看解释，不必跳转到另一个页面
- [x] 观看活动追踪，精美的表格让你知道自己花了(~浪费~)多少时间在观影上
- [x] Chrome, Firefox，在你喜欢的浏览器上使用

你的CoWatcher！

---

## 🌟 核心特性

### 1. 🚀 双模型协同架构 (Dual-Model Pipeline)

- **⚡ 快速翻译模型 (Fast Translation Model)**：
  - 可以使用 `translategemma:4b` 等高效轻量模型。在 RTX 2070等主流显卡上即可实现流畅的本地实时字幕翻译。
- **🧐 监督审校模型 (Supervisor Model)**：
  - 可以使用 `gemma4:e2b` 等推理能力出色的模型。
  - **角色名与简称一致性监督**：小步微批审阅翻译结果，动态提取对话中的新角色全名、简称、昵称及尊称（如 `Shou-chan` -> `西宫硝子` / `Shoko Nishimiya`），修正翻译偏差并写入统一词表。

### 2. 🎬 影视上下文与角色表 (Show Context & Glossary)

- **跨分集记忆继承**：在第 1 集建立并认可的角色表与专有名词，在自动连播到第 2、3 集时自动继承，无需重复建立。
- **语言隔离 Context 缓存**：按 `作品名_目标语言` 独立存储（如英文记忆与中文记忆互不污染），支持随时切换目标语言并自动载入对应语种的影视记忆。
- **可视化词表管理**：在控制面板可直观查看已收录的角色别名映射，支持手动增删改查词条或一键重置剧集记忆（支持基于 AI 自动对比维基百科等不同语种的词条简介，跨语言提取并校正角色中外译名）。

### 3. 🌐 广泛的目标语言与 UI 国际化支持

- **15 种翻译目标语言**：支持简体中文、繁體中文、English、日本語、한국어、Español、Français、Deutsch、Italiano、Português、Русский、Tiếng Việt、Bahasa Indonesia、ภาษาไทย、العربية。
- **4 种 UI 界面语言**：Popup 弹窗与播放器内交互全面支持 **English (默认)**、**中文**、**日本語**、**한국어**。

### 4. ⚡ 快捷键与原生播放器控件

- **全局快捷键 `Alt + T`**：在 Netflix 播放页面随时按下 `Alt + T`，秒级开启或关闭 AI 双语字幕翻译。
- **播放器内置控件按钮**：无缝内嵌至 Netflix 原生控制栏右下角，状态指示直观（`AI Sub ON` / `AI Sub OFF`），支持单次点击切换。
- 默认采用Netflix-style字幕嵌入，自动隐藏原始字幕，与播放器原生界面高度融合，几乎无插件感；完美兼容多语种及不同版式的字幕排版。

### 5. 📺 无感切集与自动连播 (Seamless Autoplay)

- 自动切集、剧集轮换或插播广告时，翻译流始终稳定衔接。无需刷新页面或任何多余操作，真正做到全自动、零感知的观影陪伴。

### 6. 🛡️ 广告拦截与时间轴保护 (Ad Break Guard)

- 深度适配 Netflix 广告版：智能同步时间轴偏移，即使在插播广告后字幕也能精准同步，绝不漂移。

### 7. ☁️ 云端大模型直连：OpenRouter (无需本地显卡)

- **云端平台支持**：支持配置个人 [OpenRouter API 密钥](https://openrouter.ai/keys)，开箱即用全球顶尖大模型。

### 8. 🌐 免费的传统翻译服务

- 我们支持使用Google Translate，开箱即用。

### 9. 🎓 专为语言学习者打造 (For Language Learners)）

- Netflix自带目标语言字幕作为翻译字幕，双语显示，让你的Netflix订阅费用物有所值。
- LLM自动识别生词，用户一键点击添加到生词本，与Anki的使用无缝衔接。
- 支持原语言字幕与翻译字幕一键互换主副位置（Swap），满足精读与泛听等不同学习场景。

### 10. 💾 翻译字幕持久化缓存

- 你的Token不会浪费，我们会基于当前使用的LLM对翻译字幕进行缓存，当你重看时，之前的成果不会丢失。

---

## ⌨️ 快捷操作与交互指南

| 操作方式         | 快捷键 / 交互                 | 说明                                             |
| :--------------- | :---------------------------- | :----------------------------------------------- |
| **快捷开关字幕** | <kbd>Alt</kbd> + <kbd>T</kbd> | 随时开启 / 关闭 AI 字幕翻译，屏幕显示 Toast 状态 |

---

## 🚀 安装与配置指南

### 1. 加载 Chrome 扩展

1. 在github的release中下载最新的release中的`cowatcher-extension.zip`。
2. 解压缩，会产生一个叫做`cowatcher-extension`的文件夹。
3. 打开 Chrome 浏览器，在地址栏访问：`chrome://extensions/`。
4. 打开右上角的 **「开发者模式」 (Developer mode)**。
5. 点击左上角的 **「加载已解压的扩展程序」 (Load unpacked)**。
6. 选择本项目所在根目录 `cowatcher-extension`。
7. 看到 `CoWatcher` 已加载成功。

   欢迎 请作者喝杯咖啡 ☕ <https://ko-fi.com/sfbb49898，支持我们支付> Chrome 开发者账号费用，让这个扩展早日上架 Chrome Web Store！

### 2. 选择您的 AI 服务提供商

#### 方案 A：本地 Ollama (完全免费 & 100% 隐私)

确保本地已安装 [Ollama](https://ollama.ai/) 并已运行：

```bash
ollama serve
```

推荐拉取翻译模型与监督模型：

```bash
# 1. 快速翻译模型 (推荐)
ollama pull translategemma:4b

# 2. 监督审校模型 (推荐)
ollama pull gemma4:e2b
```

#### 方案 B：云端 OpenRouter (无需本地显卡)

1. 访问 [openrouter.ai/keys](https://openrouter.ai/keys) 获取专属 API Key。
2. 打开插件弹窗，在 **AI Service Provider** 下拉菜单中选择 **OpenRouter**。
3. 填入 API Key 并点击 **Connect** 连接。
4. 选择推荐的云端顶尖模型：
   - **翻译模型**：推荐 `deepseek/deepseek-chat`（极低成本、影视神翻译）或 `google/gemini-2.5-flash`（秒级响应）。
   - **监督模型**：推荐 `google/gemini-2.5-flash`。
   - 亦可选择自定义输入任意 OpenRouter 模型 ID！

### 3. 打开 Netflix/TVer 观影

1. 访问任意 Netflix/TVer 播放页面。
2. 在 Netflix/TVer 原生播放器音频/字幕菜单中，**确保选中了英文字幕（或影片原语言字幕）**。
3. 点击扩展图标打开控制面板：
   - 确认状态指示灯为 🟢 **Connected**。
   - 检查或微调模型、翻译目标语言与显示偏好。
   - 完整功能与滑块调优请参阅 **[控制面板详细使用指南](docs/popup_guide_zh.md)**。
4. 视频播放时，双语字幕将实时流畅呈现在画面底部；可随时使用快捷键 **`Alt + T`** 控制开关。

---

## Roadmap

- [ ] 支持更多的串流平台。
- [ ] 观影历程与数据同步：联动专属观影记录App，打造个人影视档案库，并拓展好友社交分享。
- [ ] 多人协同同步观影 (Co-Watching / Watch Party)：支持异地好友连线同步看片、跨语言字幕互动与生词共享。
- [ ] 探索无字幕视频翻译方案：支持基于预加载音频的语音转文字（STT）；当音频不足时优雅降级为同声传译。

---

## ☕ 社区交流、贡献与赞助 (Community, Contribution & Support)

[![Discord 交流社区](https://discord.com/api/guilds/1564996489673973960/widget.png?style=banner2)](https://discord.gg/kXdPU4vh9K)

👉 **[加入 Discord 交流社区 (https://discord.gg/kXdPU4vh9K)](https://discord.gg/kXdPU4vh9K)**

本项目热烈欢迎任何 pull request, fork, 或者 issue(bugs or feature requests)！
详见 [贡献规范](/CONTRIBUTING.md) 与 [架构设计](/Architecture.md)。

> [!IMPORTANT]
> 所有代码贡献者、文档编写者、关键 Bug 报告者以及赞助者，都将被**永久列入**我们的 [贡献者与赞助者榜单](/CONTRIBUTORS.md) 以及官方文档主页！

如果这个项目对您有所帮助，让您的 Netflix 观影与双语体验更加流畅愉悦，欢迎请作者喝杯咖啡！您的每一份认可都是我持续优化与维护项目的最大动力。

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/sfbb49898)

👉 **[前往 Ko-fi 支持作者 (https://ko-fi.com/sfbb49898)](https://ko-fi.com/sfbb49898)**

---

## 💖 鸣谢与灵感来源

本项目受启发于：

- [Language Reactor](https://www.languagereactor.com/)
- [Immersive Translation](https://immersivetranslate.com/)
- [LiveCaption](https://github.com/begin0808/LiveCaption)

---

## ⚖️ 第三方开源许可与免责声明

CoWatcher 客户端集成了开源语言学算法库与公开词典数据源。所有第三方商标与组件归原版权方所有。

> [!NOTE]
> 引用第三方 API 与开源库仅用于开源协议合规署名（Attribution）及技术互操作性；**绝不构成或暗示原作者、机构对 CoWatcher 项目有任何官方背书或合作关系**。
>
> 👉 完整第三方开源许可署名与非背书免责声明，请参阅 **[CREDITS.md](CREDITS.md)**。

---

## 📄 开源许可证

本项目采用 MIT 许可证。
