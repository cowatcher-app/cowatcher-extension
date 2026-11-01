---
layout: home
titleTemplate: false

hero:
    name: 'CoWatcher Documentation'
    text: 'User Guides & Language Immersion Knowledge Base'
    tagline: 'No deep technical background required. Master bilingual subtitles, watch history tracking, and vocabulary flashcards with ease.'
    image:
        src: /icons/icon128.png
        alt: CoWatcher Logo
    actions:
        - theme: brand
          text: 3-Minute Quickstart
          link: /en/docs/quickstart
        - theme: alt
          text: Shortcuts & Controls
          link: /en/docs/guide/popup
        - theme: alt
          text: Official Showcase ↗
          link: /en/

features:
    - icon: 🚀
      title: Quickstart & Hotkeys
      details: Install the extension, toggle subtitles anytime with Alt + T, swap primary/secondary layers, and inspect words.
      link: /en/docs/quickstart
    - icon: 🎬
      title: Supported Platforms
      details: Practical guides for Netflix (ad drift guard), TVer Japan (fullscreen mounting), and YouTube dual tracks.
      link: /en/docs/platforms/netflix
    - icon: 🤖
      title: Choosing Your AI Provider
      details: Free built-in translation, zero-cost private local Ollama (GPU), or cutting-edge cloud models (DeepSeek, Claude, Gemini).
      link: /en/docs/providers/openrouter
    - icon: 📝
      title: Watch History & Flashcards
      details: Automatically record viewing history and duration, retain character names across episodes, and export to Anki.
      link: /en/docs/guide/popup
    - icon: ⚙️
      title: Advanced Pipeline Tuning
      details: Dual-model collaborative flow, refill thresholds, lookahead windows, and synchronization offsets for power users.
      link: /en/docs/advanced/dual_model
    - icon: 🌟
      title: Contributors & Sponsors
      details: Browse our honor roll of code contributors, translators, and coffee sponsors, and learn how to contribute.
      link: /en/docs/contributors
    - icon: ⚖️
      title: Third-Party Credits & Notices
      details: Review licenses and non-endorsement disclaimers for open-source NLP engines, phonetic converters, and public dictionary APIs.
      link: /en/docs/credits
---

## 🧭 Documentation Hub

### 1. 🌟 Which Translation Provider Should I Choose?

CoWatcher supports multiple translation providers to suit high school language learners and seasoned developers alike:

| Option                            | Best For                                            | Cost                              | Key Highlights                                     | Setup Effort          |
| :-------------------------------- | :-------------------------------------------------- | :-------------------------------- | :------------------------------------------------- | :-------------------- |
| **Free Built-in Translation**     | Casual viewers & language learners                  | **100% Free**                     | Ready out of the box with zero extra configuration | ⭐ Zero setup         |
| **Local GPU (Ollama)**            | Users with dedicated GPUs (GTX 1660 / RTX 2060+)    | **100% Free**                     | 100% private, no internet bandwidth, low latency   | ⭐⭐ Requires Ollama  |
| **Top Cloud Models (OpenRouter)** | High-accuracy movie translation & slang consistency | Pay-per-use (fractions of a cent) | Connects DeepSeek, Claude, Gemini, etc.            | ⭐⭐ Requires API Key |

- [👉 Ollama Local Deployment Guide](/en/docs/providers/ollama)
- [👉 OpenRouter Cloud API Guide](/en/docs/providers/openrouter)

---

### 2. ⚡ Common Shortcuts & Quick Actions

While watching your favorite shows, you only need to know a few essential controls:

- **`Alt + T`**: Global hotkey to toggle AI bilingual subtitles on or off instantly.
- **Swap Primary/Secondary Subtitles**: Toggle in the popup to place translated text on top or bottom according to your learning preferences.
- **Instant Word Definition**: Click or hover any unfamiliar term to view meanings and save directly to your Anki study deck.
- **Cross-Episode Character Memory**: Character aliases discovered in Episode 1 persist into Episode 2 and beyond automatically.

- [👉 Read Full Popup & Shortcuts Guide](/en/docs/guide/popup)

---

### 3. 📺 Platform Playbooks

- [Netflix Deep Integration & Ad Drift Guard](/en/docs/platforms/netflix)
- [TVer Japan Player Fullscreen Mounting](/en/docs/platforms/tver)
- [YouTube Bilingual Subtitles & Audio Track Ingestion](/en/docs/platforms/youtube)

---

### 4. 💖 Acknowledgements & Community

CoWatcher is 100% open-source. Check out our [System Architecture Whitepaper](/en/docs/architecture), submit an issue or PR on [GitHub](https://github.com/cowatcher-app/cowatcher-extension), and view our [Contributors, Sponsors & Data Credits Roll](/en/docs/contributors)!
