# ![](./icons/icon48.png) CoWatcher (Smart Watch History, AI Dual Subtitles, Real-Time Translation, Language Immersion & More)

English Documentation | [简体中文文档](README_zh.md) | [📖 Detailed Popup UI Guide](docs/popup_guide.md) | [🌟 Contributors & Sponsors](CONTRIBUTORS.md) | [⚖️ Third-Party Credits & Notices](CREDITS.md)

[![Ko-fi](https://img.shields.io/badge/Ko--fi-Buy%20me%20a%20coffee-ff5e5b?logo=ko-fi&logoColor=white)](https://ko-fi.com/sfbb49898)
[![Discord](https://img.shields.io/badge/Discord-Join%20Community-5865F2?logo=discord&logoColor=white)](https://discord.gg/kXdPU4vh9K)

We support:

- [x] Subtitle translation for Netflix & TVer & YouTube
- [x] Official bilingual subtitle display from supported platforms
- [x] Support YouTube ASR(automatically generated) subtitles merging into ordinary subtitles.
- [x] Background vocabulary detection with seamless Anki learning workflow integration
- [x] Character name consistency enforcement and manual glossary editing
- [x] Subtitle translation caching so your tokens are never wasted on rewatches
- [x] Native-grade subtitle typography: horizontal, vertical, and pixel-perfect native rendering
- [x] Multi-tab support: stream across multiple tabs and platforms simultaneously without conflict
- [x] Free traditional translation services (Google Translate), local Ollama models, and cloud OpenRouter models
- [x] One-click vocabulary saving for effortless language acquisition
- [x] Instant hover/click word definitions without leaving the player
- [x] Track your watching, to know how much time you spent on it
- [x] Support for both Chrome and Firefox

Your CoWatcher!

---

## 🌟 Key Features

### 1. 🚀 Dual-Model Collaborative Pipeline

- **⚡ Fast Translation Model**:
  - Compatible with lightweight, efficient models such as `translategemma:4b`. Delivers smooth, real-time local subtitle translation on mainstream GPUs (e.g., RTX 2070 or equivalent).
- **🧐 Supervisor Model**:
  - Compatible with high-reasoning models such as `gemma4:e2b` / `gemma4:e4b`.
  - **Character & Alias Consistency Audit**: Inspects translations in micro-batches, dynamically extracting new character names, nicknames, honorifics, and aliases (e.g., `Shou-chan` -> `Shoko Nishimiya`), rectifying naming discrepancies, and maintaining a unified glossary.

### 2. 🎬 Show Context & Character Glossary

- **Cross-Episode Memory Inheritance**: Character names and terminology established in Episode 1 automatically carry over to Episode 2, Episode 3, and beyond without manual setup.
- **Language-Scoped Context Isolation**: Stored independently per `showName_targetLanguage` (e.g., English context vs. Chinese context never cross-contaminate), allowing seamless target language switching with dedicated show memories.
- **Visual Glossary Management**: View and edit character aliases in the extension popup. Manually add, edit, delete entries, or reset show memory at any time (also supports AI-driven character name extraction from Wikipedia and multilingual background synopses).

### 3. 🌐 Extensive Target Languages & Multilingual UI

- **15 Target Translation Languages**: English, 简体中文 (Simplified Chinese), 繁體中文 (Traditional Chinese), 日本語 (Japanese), 한국어 (Korean), Español (Spanish), Français (French), Deutsch (German), Italiano (Italian), Português (Portuguese), Русский (Russian), Tiếng Việt (Vietnamese), Bahasa Indonesia, ภาษาไทย (Thai), and العربية (Arabic).
- **4 UI Languages**: Full interface localization for **English (default)**, **中文 (Chinese)**, **日本語 (Japanese)**, and **한국어 (Korean)**.

### 4. ⚡ Shortcuts & In-Player Controls

- **Global Toggle Shortcut (`Alt + T`)**: Instantly toggle AI subtitle translation on or off while watching Netflix or TVer.
- **Native Player Control Bar Button**: Embedded directly into the native player control bar (`AI Sub ON` / `AI Sub OFF`) with single-click toggling and live status indication.
- **Zero-Friction Native-Style Embedding**: Hides default raw subtitles while rendering subtitles in the platform's native typography and layout (including vertical subtitles), creating an experience that feels completely built-in.

### 5. 📺 Seamless Episode Switching & Autoplay

- Smoothly handles episode transitions, autoplay recommendations, and next-episode binging without losing the subtitle translation flow.
- Operates automatically in the background with zero need for manual page refreshes.

### 6. 🛡️ Ad Break Guard & Timeline Protection

- **Deep Netflix Ad-Supported Plan Support**: Intelligently monitors commercial breaks and synchronizes timeline offsets, ensuring subtitles stay perfectly aligned after ad breaks without drifting.

### 7. ☁️ Cloud AI via OpenRouter (Zero Local GPU Required)

- **Cloud Platform Access**: Connect directly with your personal [OpenRouter API Key](https://openrouter.ai/keys) to leverage state-of-the-art models worldwide without local hardware constraints.

### 8. 🌐 Free Traditional Translation Services

- Out-of-the-box support for free Google Translate, requiring zero model setup or API configuration.

### 9. 🎓 Designed for Language Learners

- **Automated Vocabulary Detection**: LLM identifies unfamiliar words and key terminology in real time; save words with one click for effortless Anki deck export.
- **Primary / Secondary Subtitle Swap**: Swap original and translated subtitles with a single click to tailor for intensive reading or active listening.

### 10. 💾 Subtitle Translation Caching

- Your tokens are never wasted: translations are cached based on the active LLM. When rewatching episodes or jumping back, previous translations load instantly.

---

## ⌨️ Controls & Keyboard Shortcuts

| Action               | Shortcut / Control            | Description                                                          |
| :------------------- | :---------------------------- | :------------------------------------------------------------------- |
| **Toggle Subtitles** | <kbd>Alt</kbd> + <kbd>T</kbd> | Toggle AI subtitle translation on/off with on-screen toast feedback. |

---

## 🚀 Installation & Setup

### 1. Load the Extension in Chrome

1. Download the `cowatcher-extension.zip` from the latest release in github.
2. Extract the zip file and it will generate a new folder/dir called `cowatcher-extension`.
3. Open Google Chrome and navigate to: `chrome://extensions/`.
4. Enable **Developer mode** in the top-right corner.
5. Click **Load unpacked** in the top-left corner.
6. Select the project directory `cowatcher-extension` produced under step `2`.
7. Confirm that `CoWatcher` is loaded and active.

> ☕ Love this project? [Buy me a coffee on Ko-fi](https://ko-fi.com/sfbb49898) to help us cover developer fees and bring CoWatcher to the official Chrome Web Store!

### 2. Choose Your AI Service Provider

#### Option A: Local Ollama (100% Free & Private)

Ensure [Ollama](https://ollama.ai/) is installed and running locally:

```bash
ollama serve
```

Pull the recommended translation and supervisor models:

```bash
# 1. Fast Translation Model (Recommended)
ollama pull translategemma:4b

# 2. Supervisor Model (Recommended)
ollama pull gemma4:e2b
```

#### Option B: Cloud OpenRouter (No Local GPU Required)

1. Obtain an API key from [openrouter.ai/keys](https://openrouter.ai/keys).
2. Open the extension popup, and select **OpenRouter** in the **AI Service Provider** dropdown.
3. Paste your API key and click **Connect**.
4. Select your preferred models:
   - **Translation Model**: Recommended `deepseek/deepseek-chat` (cost-effective with exceptional cinematic quality) or `google/gemini-2.5-flash` (lightning-fast).
   - **Supervisor Model**: Recommended `google/gemini-2.5-flash`.
   - Or enter any custom OpenRouter model ID!

### 3. Start Watching on Netflix / TVer

1. Navigate to any Netflix or TVer video playback page.
2. In the native audio/subtitles menu, **ensure an original subtitle track is selected** (e.g. English [CC] or the video's original language).
3. Click the extension icon in the Chrome toolbar:
   - Confirm that the status indicator shows 🟢 **Connected**.
   - Review or fine-tune models, target language, and display preferences.
   - For a comprehensive breakdown, consult the **[Detailed Popup UI Guide](docs/popup_guide.md)**.
4. As playback begins, bilingual subtitles will appear seamlessly at the bottom; toggle anytime with **`Alt + T`**.

---

## 🗺️ Roadmap

- [ ] Support additional streaming platforms.
- [ ] Watch history & data synchronization: integrate with our companion tracking app to curate personal viewing archives and social sharing.
- [ ] Multi-user synchronized co-watching (Watch Party / Co-Watching): watch together with friends remotely with synchronized playback and shared bilingual subtitles.
- [ ] Audio-based translation fallback: audio-to-text (STT) for videos without native subtitles, with graceful fallback to real-time interpretation.

---

## ☕ Community, Contribution & Support

[![Discord Server](https://discord.com/api/guilds/1564996489673973960/widget.png?style=banner2)](https://discord.gg/kXdPU4vh9K)

👉 **[Join Discord Community (https://discord.gg/kXdPU4vh9K)](https://discord.gg/kXdPU4vh9K)**

This project welcomes any pull requests, forks, or issues(bugs or feature requests)!
Read [contributing](/CONTRIBUTING.md) and [architecture](/Architecture.md) for more information!

> [!IMPORTANT]
> All code contributors, documentation writers, bug reporters, and sponsors will be **permanently acknowledged** in our [Contributors & Sponsors Roll](/CONTRIBUTORS.md) and across official documentation!

If this project enhances your streaming and language learning experience, consider buying the author a coffee! Every bit of support fuels continued development and maintenance.

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/sfbb49898)

👉 **[Support on Ko-fi (https://ko-fi.com/sfbb49898)](https://ko-fi.com/sfbb49898)**

---

## 💖 Acknowledgements & Inspirations

This project was inspired by:

- [Language Reactor](https://www.languagereactor.com/)
- [Immersive Translation](https://immersivetranslate.com/)
- [LiveCaption](https://github.com/begin0808/LiveCaption)

---

## ⚖️ Third-Party Credits & Open Source Notices

CoWatcher incorporates open-source NLP toolkits and free dictionary public data sources. All external trademarks and libraries belong to their respective copyright holders.

> [!NOTE]
> Reference to third-party APIs and libraries is strictly for open-source license compliance (Attribution) and technical interoperability; it does **not** imply any endorsement, sponsorship, or affiliation with CoWatcher by the respective authors or organizations.
>
> 👉 Please see **[CREDITS.md](CREDITS.md)** for our complete third-party credits, open-source notices, and full non-endorsement disclaimer.

---

## 📄 License

This project is licensed under the MIT License.
