---
layout: home
titleTemplate: false

hero:
  name: "CoWatcher 使用文档"
  text: "观影、翻译与外语学习指南"
  tagline: "无需技术背景，轻松搞定双语字幕、智能观影记录与生词背诵。在这里找到你需要的设置教程与疑难排错指南。"
  image:
    src: /icons/icon128.png
    alt: CoWatcher Logo
  actions:
    - theme: brand
      text: 3分钟快速上手
      link: /zh/docs/quickstart
    - theme: alt
      text: 常用快捷键与操作
      link: /zh/docs/guide/popup
    - theme: alt
      text: 官网展示页 ↗
      link: /zh/

features:
  - icon: 🚀
    title: 快速上手与快捷键
    details: 安装扩展、使用 Alt + T 随时开关字幕、一键互换双语字幕上下层、快捷查生词。
    link: /zh/docs/quickstart
  - icon: 🎬
    title: 常用流媒体使用指引
    details: 针对 Netflix（防广告漂移）、TVer（日剧全屏置顶）、YouTube（轨道挑选）的实战技巧。
    link: /zh/docs/platforms/netflix
  - icon: 🤖
    title: 翻译方案怎么选？
    details: 开箱即用免费翻译、有独立显卡用本地零花费 Ollama、或接入 DeepSeek/Claude 顶尖大模型。
    link: /zh/docs/providers/openrouter
  - icon: 📝
    title: 观影记录与生词背诵
    details: 自动追踪看剧时长与剧集进度，跨集记住角色人名，生词一键加入 Anki 记忆库。
    link: /zh/docs/guide/popup
  - icon: ⚙️
    title: 进阶流水线调优
    details: 双模型协作机制、翻译缓冲与提前预载参数调优，专为极客与画质音画同步玩家打造。
    link: /zh/docs/advanced/dual_model
  - icon: 🌟
    title: 贡献者与赞助者榜单
    details: 查看为 CoWatcher 贡献代码、文档与赞助咖啡的荣誉名册，了解如何参与社区建设。
    link: /zh/docs/contributors
  - icon: ⚖️
    title: 第三方开源许可与免责声明
    details: 查阅分词引擎、注音转换算法库与公共词典数据源的开源协议合规署名及非背书声明。
    link: /zh/docs/credits
---

## 🧭 文档快速导航

### 1. 🌟 我该怎么选择适合我的翻译方式？

CoWatcher 提供多种翻译接入方式，不管你是追剧高中生还是技术极客，都能找到最舒适的姿势：

| 方案 | 适合人群 | 费用 | 特点 | 配置难度 |
| :--- | :--- | :--- | :--- | :--- |
| **开箱即用免费翻译** | 普通追剧党、学生党 | **完全免费** | 装好插件直接能用，无需额外设置 | ⭐ 零门槛 |
| **电脑本地显卡 (Ollama)** | 拥有独立显卡 (如 GTX 1660 / RTX 2060 以上) | **完全免费** | 保护隐私、不耗网络流量、响应速度快 | ⭐⭐ 需安装 Ollama |
| **顶尖云端模型 (OpenRouter)** | 追求极致地道翻译、人名梗句零出戏 | 按用量计费 (极便宜) | 支持 DeepSeek、Claude、Gemini 等超聪明模型 | ⭐⭐ 需填入 API Key |

* [👉 查看 Ollama 本地部署教程](/zh/docs/providers/ollama)
* [👉 查看 OpenRouter 云端 API 配置教程](/zh/docs/providers/openrouter)

---

### 2. ⚡ 最常用快捷操作速查

在播放视频时，你只需要掌握以下几个高频操作：

* **`Alt + T`**：全局开关 AI 双语字幕，随时一键唤出或隐藏。
* **双语上下层互换**：在控制面板中随时将翻译置于主字幕或副字幕，灵活适应母语理解或外语听力精读。
* **生词点击与查询**：遇到不懂的台词单词，直接点击即可查看释义，并支持一键收录进 Anki 单词本。
* **跨集人名自动记忆**：第 1 集识别出的角色名和昵称，自动继承到第 2 集，追连载剧再也不怕译名乱变！

* [👉 阅读控制面板与快捷键详细指南](/zh/docs/guide/popup)

---

### 3. 📺 平台实战指引

* [Netflix 深度使用技巧与防广告时移](/zh/docs/platforms/netflix)
* [TVer 日剧与日本综娱全屏适配](/zh/docs/platforms/tver)
* [YouTube 原生双语字幕与自动音轨提取](/zh/docs/platforms/youtube)

---

### 4. 💖 鸣谢与社区贡献

CoWatcher 是完全开源透明的项目。欢迎阅读我们的 [核心系统架构白皮书](/zh/docs/architecture)，在 [GitHub 仓库](https://github.com/cowatcher-app/cowatcher-extension) 提交 Issue 或 Pull Request，以及浏览我们的 [贡献者、赞助者与第三方致谢名册](/zh/docs/contributors)！
