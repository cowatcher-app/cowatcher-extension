import { defineConfig } from "vitepress";

const base = process.env.VITEPRESS_BASE || "/cowatcher-extension/";

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: "CoWatcher",
  description:
    "Smart Watch History, AI Dual Subtitles, Real-Time Translation, Language Immersion & More",
  base,
  appearance: "dark",
  ignoreDeadLinks: true,
  sitemap: {
    hostname: "https://cowatcher-app.github.io/cowatcher-extension/",
  },
  head: [
    [
      "link",
      {
        rel: "icon",
        type: "image/png",
        sizes: "32x32",
        href: `${base}icons/icon48.png`,
      },
    ],
    [
      "link",
      {
        rel: "icon",
        type: "image/png",
        sizes: "16x16",
        href: `${base}icons/icon16.png`,
      },
    ],
    [
      "link",
      {
        rel: "apple-touch-icon",
        href: `${base}icons/icon128.png`,
      },
    ],
    [
      "meta",
      {
        name: "msvalidate.01",
        content: "74D1D82251CCD15C73F83C9A3298381E",
      },
    ],
    [
      "script",
      {},
      `
      (function() {
        try {
          var path = window.location.pathname;
          if (path.indexOf('/zh/') !== -1) {
            localStorage.setItem('ncw_page_lang', 'zh');
          } else if (path.indexOf('/en/') !== -1) {
            localStorage.setItem('ncw_page_lang', 'en');
          }
        } catch (e) {}
      })();
      `,
    ],
  ],
  locales: {
    en: {
      label: "English",
      lang: "en",
      link: "/en/docs/",
      title:
        "CoWatcher - Smart Watch History · AI Dual Subtitles · Language Immersion & Streaming Companion",
      titleTemplate: ":title | CoWatcher",
      description:
        "Smart Watch History · AI Dual Subtitles · Language Immersion & Streaming Companion",
      themeConfig: {
        siteTitle: "CoWatcher",
        nav: [
          { text: "Docs Home", link: "/en/docs/" },
          { text: "Official Site", link: "/en/" },
          { text: "Quickstart", link: "/en/docs/quickstart" },
          {
            text: "AI Providers",
            items: [
              {
                text: "Ollama (Local / GPU)",
                link: "/en/docs/providers/ollama",
              },
              {
                text: "OpenRouter (Cloud)",
                link: "/en/docs/providers/openrouter",
              },
            ],
          },
          {
            text: "Platforms",
            items: [
              { text: "Netflix", link: "/en/docs/platforms/netflix" },
              { text: "TVer (Japan)", link: "/en/docs/platforms/tver" },
              { text: "YouTube", link: "/en/docs/platforms/youtube" },
            ],
          },
          { text: "Architecture", link: "/en/docs/architecture" },
          {
            text: "Community",
            items: [
              { text: "🌟 Contributors & Sponsors", link: "/en/docs/contributors" },
              { text: "⚖️ Third-Party Credits & Notices", link: "/en/docs/credits" },
            ],
          },
        ],
        sidebar: [
          {
            text: "Getting Started",
            items: [
              { text: "Quickstart", link: "/en/docs/quickstart" },
              { text: "Popup Interface Guide", link: "/en/docs/guide/popup" },
            ],
          },
          {
            text: "AI Providers Setup",
            items: [
              {
                text: "Ollama (Local Inference)",
                link: "/en/docs/providers/ollama",
              },
              {
                text: "OpenRouter (Cloud Models)",
                link: "/en/docs/providers/openrouter",
              },
            ],
          },
          {
            text: "Supported Platforms",
            items: [
              { text: "Netflix", link: "/en/docs/platforms/netflix" },
              { text: "TVer", link: "/en/docs/platforms/tver" },
              { text: "YouTube", link: "/en/docs/platforms/youtube" },
            ],
          },
          {
            text: "Advanced Configuration",
            items: [
              {
                text: "Dual-Model Pipeline",
                link: "/en/docs/advanced/dual_model",
              },
            ],
          },
          {
            text: "Developer & Architecture",
            items: [
              { text: "System Architecture", link: "/en/docs/architecture" },
            ],
          },
          {
            text: "Community & Acknowledgements",
            items: [
              {
                text: "🌟 Contributors & Sponsors",
                link: "/en/docs/contributors",
              },
              {
                text: "⚖️ Third-Party Credits & Notices",
                link: "/en/docs/credits",
              },
            ],
          },
        ],
      },
    },
    zh: {
      label: "简体中文",
      lang: "zh-CN",
      link: "/zh/docs/",
      title:
        "CoWatcher - 智能观影记录 · 双语字幕 · AI实时翻译 · 沉浸式外语学习助手",
      titleTemplate: ":title | CoWatcher",
      description:
        "智能观影记录 · 双语字幕 · AI实时翻译 · 沉浸式外语学习助手",
      themeConfig: {
        siteTitle: "CoWatcher",
        nav: [
          { text: "文档首页", link: "/zh/docs/" },
          { text: "产品官网", link: "/zh/" },
          { text: "快速开始", link: "/zh/docs/quickstart" },
          {
            text: "AI 服务商配置",
            items: [
              {
                text: "Ollama 本地显卡部署",
                link: "/zh/docs/providers/ollama",
              },
              {
                text: "OpenRouter 云端模型",
                link: "/zh/docs/providers/openrouter",
              },
            ],
          },
          {
            text: "平台使用指南",
            items: [
              { text: "Netflix (网飞)", link: "/zh/docs/platforms/netflix" },
              { text: "TVer (日剧/日本电视)", link: "/zh/docs/platforms/tver" },
              { text: "YouTube", link: "/zh/docs/platforms/youtube" },
            ],
          },
          { text: "系统架构", link: "/zh/docs/architecture" },
          {
            text: "社区与致谢",
            items: [
              { text: "🌟 贡献者与赞助者榜单", link: "/zh/docs/contributors" },
              { text: "⚖️ 第三方开源与数据致谢", link: "/zh/docs/credits" },
            ],
          },
        ],
        sidebar: [
          {
            text: "入门指南",
            items: [
              { text: "快速开始", link: "/zh/docs/quickstart" },
              { text: "弹窗面板与快捷键指南", link: "/zh/docs/guide/popup" },
            ],
          },
          {
            text: "AI 服务商配置",
            items: [
              {
                text: "Ollama 本地模型配置",
                link: "/zh/docs/providers/ollama",
              },
              {
                text: "OpenRouter 云端 API 配置",
                link: "/zh/docs/providers/openrouter",
              },
            ],
          },
          {
            text: "流媒体平台指南",
            items: [
              { text: "Netflix 使用技巧", link: "/zh/docs/platforms/netflix" },
              { text: "TVer 播放器全屏适配", link: "/zh/docs/platforms/tver" },
              { text: "YouTube 双语字幕", link: "/zh/docs/platforms/youtube" },
            ],
          },
          {
            text: "进阶调优",
            items: [
              {
                text: "双模型流水线调优",
                link: "/zh/docs/advanced/dual_model",
              },
            ],
          },
          {
            text: "架构与开发",
            items: [
              { text: "核心架构白皮书", link: "/zh/docs/architecture" },
            ],
          },
          {
            text: "社区与致谢",
            items: [
              {
                text: "🌟 贡献者与赞助者榜单",
                link: "/zh/docs/contributors",
              },
              {
                text: "⚖️ 第三方开源与数据致谢",
                link: "/zh/docs/credits",
              },
            ],
          },
        ],
      },
    },
  },
  themeConfig: {
    logo: "/icons/icon48.png",
    socialLinks: [
      { icon: "github", link: "https://github.com/SFBB/NetflixCoWatcher" },
    ],
    search: {
      provider: "local",
    },
    footer: {
      message: "Released under the MIT License.",
      copyright: "Copyright © 2026 CoWatcher Contributors",
    },
  },
});
