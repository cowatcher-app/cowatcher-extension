/**
 * Internationalization (i18n) module for CoWatcher AI Subtitle Translator
 * Supported UI languages: English (en), Chinese (zh), Japanese (ja), Korean (ko)
 */
const NCW_I18N = {
    LANGUAGES: {
        en: 'English',
        zh: '中文 (Chinese)',
        ja: '日本語 (Japanese)',
        ko: '한국어 (Korean)',
    },
    DEFAULT_LANG: 'en',

    STRINGS: {
        en: {
            extName: 'CoWatcher - AI Subtitle Translator',
            enableAi: 'Enable AI Translation',
            statusOllama: 'Ollama Local Service',
            aiProvider: '🤖 AI Service Provider',
            providerGoogle: 'Google Translate (Free / Out of the Box)',
            providerOllama: 'Ollama (Local / Privacy-first)',
            providerOpenRouter: 'OpenRouter (Cloud / Multi-model)',
            statusGoogle: 'Google Translate (Ready)',
            statusOpenRouter: 'OpenRouter Cloud API',
            openrouterApiKey: '🔑 OpenRouter API Key',
            openrouterApiKeyHint:
                'Stored locally in browser. Get key at openrouter.ai/keys',
            openrouterKeyPlaceholder: 'sk-or-v1-...',
            checkingOpenRouter: 'Validating OpenRouter Key & Models...',
            openrouterConnected: 'Connected ({count} models available)',
            openrouterFailed: 'OpenRouter connection failed',
            openrouterTranslationModel: '🚀 OpenRouter Translation Model',
            openrouterSupervisorModel: '🧐 OpenRouter Supervisor Model',
            groupRecommended: '⭐ Recommended (High Speed & Value)',
            groupAllModels: '🌐 All Available Models ({count})',
            customModelOption: '✏️ Enter custom model ID...',
            customModelPlaceholder:
                'Enter model ID (e.g. deepseek/deepseek-chat)',
            ollamaApiUrl: '🔗 Ollama API URL',
            btnConnect: 'Connect',
            loadingModels: 'Loading available models...',
            noModelsFound: 'No models found on server',
            connFailed: 'Connection failed (Check API URL)',
            checkingConn: 'Checking Ollama connection...',
            connected: 'Connected ({count} models available)',
            disconnected: 'Cannot connect to local Ollama',
            disconnectedHint: 'Please make sure ollama serve is running',
            refreshModels: 'Refresh model list',
            uiLanguage: '🗣️ UI Language',
            translationModel: '🚀 Translation Model (50-cue batch ahead)',
            supervisorModel: '🧐 Supervisor Model (audit & maintain Context)',
            targetLanguage: '🌐 Target Translation Language',
            displayMode: 'Subtitle Display Mode',
            displayBilingual: 'Bilingual (Translation + Original)',
            displayTransOnly: 'Translation Only',
            displayOrigOnly: 'Original Only',
            hideNativeSubtitles: 'Hide Platform Native Subtitles',
            hideNativeSubtitlesHint:
                'Prevents duplicate overlapping subtitles (recommended)',
            enableSubtitleLearning:
                'Interactive Subtitle Learning (Click Word)',
            enableSubtitleLearningHint:
                'Click words to pause video & view definitions; right-click to quick-save to vocabulary bank',
            chinesePhoneticSystem: 'Phonetic System (Pinyin / Zhuyin)',
            chinesePhoneticSystemHint:
                'Select whether to annotate subtitles with Pinyin or Zhuyin (Bopomofo)',
            chinesePhoneticPinyin: 'Pinyin (e.g. kàn le)',
            chinesePhoneticZhuyin:
                'Zhuyin / Bopomofo (e.g. ㄎㄢˋ ˙ㄌㄜ)',
            koreanPhoneticSystem: 'Korean Phonetic System',
            koreanPhoneticSystemHint:
                'Select whether to format Korean Romanization continuously or with syllable hyphens',
            koreanPhoneticDefault:
                'Standard / Continuous (e.g. beoreojyeotseumnida)',
            koreanPhoneticHyphenated:
                'Syllable Hyphenated (e.g. beo-reo-jyeot-seum-ni-da)',
            recordVocabAsLemma: 'Record Vocabulary as Base Form (Lemma)',
            recordVocabAsLemmaHint:
                'If checked, records base dictionary form (e.g. schedule); if unchecked, preserves original word with lemma attached',
            preferNativeSubtitles: 'Prefer Official Subtitles (0-Latency)',
            preferNativeSubtitlesHint:
                'Use platform official target track if available; fall back to AI translation if missing',
            extractNativeTerms: 'Extract Glossary from Official Subtitles',
            extractNativeTermsHint:
                'When using official subtitles, let supervisor model extract character glossary (Default: Off)',
            contextCardTitle: '🎬 Show Context & Supervisor Memory',
            resetBtn: 'Reset',
            waitingPlayback: 'Waiting for playback...',
            pendingBadge: 'Pending',
            identifiedBadge: '✓ Identified by Supervisor',
            recordingBadge: '○ Dynamically Recording',
            contextEmptyHint:
                'Will be built and updated by supervisor model during playback...',
            glossaryHeader: 'Characters & Glossary',
            glossaryEmptyHint: 'No characters or terms recorded yet',
            aliasesLabel: ' (Aliases: {aliases})',
            deleteItem: 'Delete this item',
            promoteItem: 'Confirm this item',
            inputOrigPlaceholder: 'Original (e.g. Shoko)',
            inputTransPlaceholder: 'Translation (e.g. Shoko Nishimiya)',
            typeTerm: 'Term',
            typeCharacter: 'Character',
            btnAddTerm: 'Save',
            btnEditGlossary: 'Edit / Add Glossary ↗',
            editGlossaryTitle: 'Manage Glossary & Terminology',
            resetConfirm:
                'Are you sure you want to clear the current show memory and character dictionary?',
            enableSupervisor:
                'Enable Supervisor Model (Audit & Character Glossary)',
            enableSupervisorHint:
                'Audits terminology consistency & maintains character memory (Turn off to save GPU VRAM)',
            pipelineSettingsTitle: 'Dual-Model Pipeline Settings',
            pipelineGroupTranslation: '⚡ Dynamic Cue Batch & Buffer',
            minCues: 'Min Batch Cues (min_cue)',
            minCuesHint:
                'Minimum dialogue cues accumulated before sending a call to the model (Default: 1)',
            minCuesVal: '{count} cue',
            maxCues: 'Max Batch Cues (max_cue)',
            maxCuesHint:
                'Maximum dialogues sent in a single request (Ollama preset: 30, OpenRouter: 100)',
            maxCuesVal: '{count} cues',
            batchSize: 'Translate Ahead Buffer (Queue Size)',
            cuesUnit: 'cues',
            batchSizeHint:
                'Total dialogues translated in advance ahead of playback',
            refillThreshold: 'Auto-Refill Threshold (Min Buffer)',
            refillHint: 'Remaining < {count} cues',
            refillSubHint:
                'Automatically requests next batch when remaining unplayed cues fall below this',
            subChunkSize: 'Translation Request Chunk Size',
            subChunkSizeHint:
                'Divides batch into smaller chunks to deliver first subtitles faster (4~6 for low VRAM, 8~12 for fast GPUs)',
            subChunkVal: '{count} cues/req',
            pipelineGroupSupervisor: '🧐 Supervisor Consistency Audit',
            reviewBatchSize: 'Supervisor Review Batch Size',
            reviewBatchSizeHint:
                'Number of translated dialogues audited in a single prompt (Ollama: 8, OpenRouter: 20)',
            reviewBatchVal: '{count} cues',
            pipelineGroupAsr: '🎙️ ASR Subtitle Auto-Merging',
            enableAutomaticAsrMerging: 'Auto-Merge ASR Word Fragments',
            enableAutomaticAsrMergingHint:
                'Combines fragmented word-by-word ASR cues (e.g. YouTube auto-captions) into grammatically complete sentences before translation',
            asrMergeBatchSize: 'ASR Merge Window Size',
            asrMergeBatchSizeHint:
                'Number of raw fragments processed per merge stage (Default: 15)',
            asrMergeBatchVal: '{count} fragments',
            asrSilenceThreshold: 'Silence Gap Threshold',
            asrSilenceThresholdHint:
                'Threshold in milliseconds to detect natural sentence pause (Default: 600ms)',
            asrSilenceThresholdVal: '{count} ms',
            pipelineGroupStyle: '🎨 Subtitle Appearance & Timing',
            fontSize: 'Subtitle Font Size',
            bgOpacity: 'Subtitle Background Opacity',
            bgOpacityHint:
                'Adjust background plate darkness behind subtitles (Default: 0% transparent)',
            translationOpacity: 'Translation Subtitle Opacity',
            translationOpacityHint:
                'Adjust translated text transparency. Hover over translation line to reveal 100% opacity (Default: 100%)',
            enableGlassEffect: 'Glass Style Box (Blur & Border Highlight)',
            enableGlassEffectHint:
                'Adds backdrop blur, border highlight and shadow behind subtitles (Default: OFF)',
            enableAnimation: 'Enable Subtitle Fade Animation',
            enableAnimationHint:
                'Fades subtitles in and out (Turn off for instant crisp subtitle switching without flicker; Default: OFF)',
            showOriginalSmaller: 'Smaller Original Subtitle (75%)',
            showOriginalSmallerHint:
                'In bilingual mode, displays original dialogue at 75% font size to emphasize translation',
            swapSubtitleOrder: 'Swap Subtitle Order (Original on Top)',
            swapSubtitleOrderHint:
                'Displays original dialogue on the top line and translated dialogue on the bottom',
            bottomMargin: 'Bottom Margin',
            testTitle: 'Quick Test',
            testPlaceholder: 'Enter test dialogue...',
            btnTest: 'Test',
            testHint: 'Click test button to verify local model response...',
            testDrafting: 'Calling translation model for initial draft...',
            testTransDone: '✓ Translation Model ({time}ms):',
            testReviewing: 'Reviewing with supervisor model ({model})...',
            testSupervisorDone: '🧐 Supervisor Review ({time}ms):',
            testSupervisorDisabled: '(Supervisor review disabled in settings)',
            testNoCorrection:
                'No correction needed. Output matches context & character consistency.',
            testFailed: '✗ Translation failed: {error}',
            footerText:
                'Local AI Inference · Ultra Low Latency · Privacy First',
            toastEnabled: '✓ AI Subtitles Enabled',
            toastDisabled: '✕ AI Subtitles Disabled (Alt+T)',
            toastSyncOffset: '⏱ Subtitle Offset: {offset}s',
            btnPlayerTitle:
                'CoWatcher AI Subtitles (Click to toggle / Shortcut: Alt+T)',
            btnPlayerOn: 'Sub ON',
            btnPlayerOff: 'Sub OFF',
            syncOffsetTitle: '⏱ Subtitle Sync Offset',
            syncOffsetHint:
                'Fine-tune timeline when ad breaks occur (Hotkeys: [ / ] or Alt+[ / Alt+])',
            btnSyncEarlier: 'Earlier (+0.5s)',
            btnSyncLater: 'Later (-0.5s)',
            btnSyncReset: 'Reset',
            enableDomSync: 'DOM Subtitle Text Auto-Calibration',
            enableDomSyncHint:
                'Compares visible on-screen native subtitles to auto-correct drift (Default: OFF; player API already syncs timeline)',
            btnDonate: 'Buy me a coffee on Ko-fi',
            tabSubtitles: 'Subtitles',
            tabVocab: 'Vocabulary',
            tabAi: 'AI Services',
            vocabCardTitle: '📚 Episode Vocabulary Collector',
            vocabEnabled: 'Enable Vocab Collector',
            vocabEnabledHint:
                'Silently extracts difficult words, idioms, and context sentences in background',
            vocabProvider: '🤖 AI Service Provider',
            vocabModel: '🧠 Vocab Extraction Model (Dedicated)',
            vocabDifficulty: '🎯 Difficulty Level',
            diffEasy: '🟢 Easy (Phrasal verbs & Slang)',
            diffMedium: '🟡 Medium (B2/C1, Academic & Idioms)',
            diffHard: '🔴 Hard (C2+, Jargon & GRE)',
            btnDownloadCsv: '📥 Download Vocab (.CSV)',
            btnResetVocab: '🗑️ Reset Episode Vocab',
            vocabCount: '{count} words collected',
            vocabEmpty:
                'No vocabulary collected yet. Turn ON the feature and play an episode to collect automatically.',
            vocabResetConfirm:
                'Are you sure you want to clear all vocabulary collected for this episode?',
            vocabStatusProcessing: 'Analyzing cues in background...',
            vocabStatusIdle: 'Ready / Idle',
            vocabSourceLang: '🗣️ Subtitle Source Language',
            langAuto: '✨ Auto Detect (Japanese/English/etc.)',
            vocabCustomPrompt: '✨ Custom Extraction Prompt / Focus (Optional)',
            vocabCustomPromptPlaceholder:
                'e.g. Focus on JLPT N1 idioms, medical terms, business slang, ignore character names...',
            vocabCustomPromptHint:
                'Injected directly into LLM system prompt to guide vocabulary extraction',
        },
        zh: {
            extName: 'CoWatcher AI 字幕翻译',
            enableAi: '全局启用 AI 翻译',
            statusOllama: 'Ollama 本地服务',
            aiProvider: '🤖 AI 服务提供商',
            providerGoogle: 'Google 翻译 (免费 / 开箱即用)',
            providerOllama: 'Ollama (本地私有部署)',
            providerOpenRouter: 'OpenRouter (云端多模型平台)',
            statusGoogle: 'Google 翻译 (就绪)',
            statusOpenRouter: 'OpenRouter 云端服务',
            openrouterApiKey: '🔑 OpenRouter API 密钥',
            openrouterApiKeyHint:
                '安全存储于本地浏览器。获取 Key: openrouter.ai/keys',
            openrouterKeyPlaceholder: 'sk-or-v1-...',
            checkingOpenRouter: '正在验证 OpenRouter Key 与获取模型...',
            openrouterConnected: '已连接 ({count} 个云端模型可用)',
            openrouterFailed: 'OpenRouter 连接失败',
            openrouterTranslationModel: '🚀 OpenRouter 翻译模型',
            openrouterSupervisorModel: '🧐 OpenRouter 监督模型',
            groupRecommended: '⭐ 推荐精选 (高速高性价比)',
            groupAllModels: '🌐 所有可用模型 ({count})',
            customModelOption: '✏️ 手动输入自定义 Model ID...',
            customModelPlaceholder: '输入模型 ID (如 deepseek/deepseek-chat)',
            ollamaApiUrl: '🔗 Ollama API 接口地址',
            btnConnect: '连接',
            loadingModels: '正在从 API 获取可用模型...',
            noModelsFound: '当前服务未检测到已安装模型',
            connFailed: '连接失败 (请检查 API 地址)',
            checkingConn: '检查 Ollama 连接中...',
            connected: '已连接 ({count} 个模型可用)',
            disconnected: '无法连接本地 Ollama',
            disconnectedHint: '请确认已运行 ollama serve',
            refreshModels: '刷新模型列表',
            uiLanguage: '🗣️ 界面语言 (UI Language)',
            translationModel: '🚀 翻译模型 (负责先翻译 50 句)',
            supervisorModel: '🧐 监督模型 (负责审阅、修正与维护 Context)',
            targetLanguage: '🌐 目标翻译语言',
            displayMode: '字幕显示模式',
            displayBilingual: '双语显示 (译文 + 原文)',
            displayTransOnly: '仅译文',
            displayOrigOnly: '仅原文',
            hideNativeSubtitles: '隐藏平台原生字幕',
            hideNativeSubtitlesHint: '防止原生单语字幕与 AI 字幕重叠（推荐）',
            enableSubtitleLearning: '字幕分词与交互学习（点击查词）',
            enableSubtitleLearningHint:
                '鼠标左键点击单词暂停并查词/发音，右键快速加入生词本（保留上下文例句）',
            chinesePhoneticSystem: '拼音 / 注音标注系统',
            chinesePhoneticSystemHint:
                '选择字幕注音使用汉语拼音还是注音符号（ㄅㄆㄇㄈ）',
            chinesePhoneticPinyin: '汉语拼音（Pinyin，如 kàn le）',
            chinesePhoneticZhuyin:
                '注音符号（Bopomofo，如 ㄎㄢˋ ˙ㄌㄜ）',
            koreanPhoneticSystem: '韩文注音系统',
            koreanPhoneticSystemHint:
                '选择韩文罗马字注音采用标准连续书写还是音节短横线辅助',
            koreanPhoneticDefault:
                '标准连写（如 beoreojyeotseumnida）',
            koreanPhoneticHyphenated:
                '音节短横线辅助（如 beo-reo-jyeot-seum-ni-da）',
            recordVocabAsLemma: '生词记录为原型',
            recordVocabAsLemmaHint:
                '勾选时词汇字段直接使用原型记录（如 schedule）；未勾选则保留原句中的变体形式，在原型字段记录原型并通过原型查询音标',
            preferNativeSubtitles: '优先使用平台官方双语字幕 (零延迟)',
            preferNativeSubtitlesHint:
                '若剧集包含目标语言官方字幕则直接对齐采用；无官方字幕时自动回退为 AI 翻译',
            extractNativeTerms: '从官方字幕提取术语与人物表',
            extractNativeTermsHint:
                '在使用官方字幕时，由监督模型提取专有名词与人物对照表（默认关闭）',
            contextCardTitle: '🎬 影集上下文与监督记忆',
            resetBtn: '重置',
            waitingPlayback: '等待播放中...',
            pendingBadge: '待识别',
            identifiedBadge: '✓ 监督模型已识别背景',
            recordingBadge: '○ 动态收录中',
            contextEmptyHint: '开始播放后由监督模型建立并更新...',
            glossaryHeader: '角色与专有名词对照表',
            glossaryEmptyHint: '暂无已收录角色或术语',
            aliasesLabel: ' (别名: {aliases})',
            deleteItem: '删除此项',
            promoteItem: '认证此项',
            inputOrigPlaceholder: '原文 (如 Shoko)',
            inputTransPlaceholder: '译文 (如 西宫硝子)',
            typeTerm: '术语',
            typeCharacter: '角色',
            btnAddTerm: '保存',
            btnEditGlossary: '编辑 / 扩充对照表 ↗',
            editGlossaryTitle: '管理角色与译名对照表',
            resetConfirm: '确定要清空当前的影视记忆与角色对照表吗？',
            enableSupervisor: '启用监督模型（上下文审查与人物表）',
            enableSupervisorHint:
                '自动审查术语统一并构建人物记忆（显存较小如 4G/6G 时可关闭以提升流畅度）',
            pipelineSettingsTitle: '双模型流水线参数配置',
            pipelineGroupTranslation: '⚡ 动态 Cue 批量与缓冲参数',
            minCues: '单次最小下发句数 (min_cue)',
            minCuesHint:
                '达到警戒线时，待处理台词达到此数量即可发起请求 (默认: 1)',
            minCuesVal: '{count} 句',
            maxCues: '单次最大截断句数 (max_cue)',
            maxCuesHint:
                '单次请求截取上限，防止超长失控 (Ollama 预设: 30，OpenRouter 预设: 100)',
            maxCuesVal: '{count} 句',
            batchSize: '提前预翻译缓冲句数 (队列容量)',
            cuesUnit: '句',
            batchSizeHint: '翻译模型领先当前播放进度提前翻译的对话总量',
            refillThreshold: '触发补充阈值 (最低安全缓冲)',
            refillHint: '剩余 < {count} 句',
            refillSubHint:
                '未播放的已译对话不足该数量时，后台自动触发下一批次翻译',
            subChunkSize: '单次网络请求分块句数',
            subChunkSizeHint:
                '将大批次切分为小块并发请求，使首批字幕极速出词（低显存推荐 4~6，高显存推荐 8~12）',
            subChunkVal: '{count} 句/次',
            pipelineGroupSupervisor: '🧐 监督模型审阅参数',
            reviewBatchSize: '监督模型单次审查句数',
            reviewBatchSizeHint:
                '监督模型单次 Prompt 集中比对审阅的对话句数 (Ollama 预设: 8, OpenRouter 预设: 20)',
            reviewBatchVal: '{count} 句',
            pipelineGroupAsr: '🎙️ ASR 语音识别字幕自动重组',
            enableAutomaticAsrMerging: '自动合并 ASR 逐词碎片字幕',
            enableAutomaticAsrMergingHint:
                '在翻译前将 YouTube 等平台逐词滚动的 ASR 碎片字幕自动重组成语法完整的句子',
            asrMergeBatchSize: 'ASR 碎片合并窗口大小',
            asrMergeBatchSizeHint:
                '每次送入重组算法或大模型的碎片字幕句数（默认：15）',
            asrMergeBatchVal: '{count} 个碎片',
            asrSilenceThreshold: '断句静音停顿阈值',
            asrSilenceThresholdHint:
                '说话人自然停顿超过此毫秒数时切断句子（默认：600ms）',
            asrSilenceThresholdVal: '{count} 毫秒',
            pipelineGroupStyle: '🎨 字幕样式与时间轴',
            fontSize: '字幕字体大小',
            bgOpacity: '字幕背景不透明度',
            bgOpacityHint: '调整字幕半透明背景板深浅（默认 0% 全透明无黑底）',
            translationOpacity: '翻译字幕不透明度',
            translationOpacityHint:
                '调整译文字幕深浅。调低可减少对母语依赖，鼠标悬停时自动浮现完整译文（默认 100%）',
            enableGlassEffect: '毛玻璃质感底框（模糊滤镜与边框光晕）',
            enableGlassEffectHint:
                '为字幕卡片增加背景高斯模糊、白色高光微边框与悬浮投影（默认关闭）',
            enableAnimation: '启用字幕淡入淡出动画',
            enableAnimationHint:
                '字幕进出添加平滑渐变（关闭后为硬切瞬时切换，彻底杜绝闪烁；默认关闭）',
            showOriginalSmaller: '双语模式原文较小显示 (75%)',
            showOriginalSmallerHint:
                '双语字幕下将原文缩小为 75% 字号以突出译文',
            swapSubtitleOrder: '交换原文与译文位置 (原文在上)',
            swapSubtitleOrderHint:
                '双语模式下将原文显示在第一行，译文显示在第二行',
            bottomMargin: '底部间距',
            testTitle: '快捷测试',
            testPlaceholder: '输入测试对话...',
            btnTest: '测试',
            testHint: '点击测试按钮验证本地模型响应...',
            testDrafting: '正在调用翻译模型生成初步翻译...',
            testTransDone: '✓ 翻译模型 ({time}ms):',
            testReviewing: '正在由监督模型 ({model}) 审阅...',
            testSupervisorDone: '🧐 监督模型审阅 ({time}ms):',
            testSupervisorDisabled: '(监督模型已在设置中关闭)',
            testNoCorrection: '无须修正，译文符合语境与角色一致性。',
            testFailed: '✗ 翻译失败: {error}',
            footerText: '本地 AI 推理 · 极低延迟 · 隐私安全',
            toastEnabled: '✓ AI 双语字幕已开启',
            toastDisabled: '✕ AI 双语字幕已关闭 (Alt+T)',
            toastSyncOffset: '⏱ 字幕时间轴偏移: {offset}s',
            btnPlayerTitle:
                'CoWatcher AI 双语字幕翻译 (点击切换 / 快捷键: Alt+T)',
            btnPlayerOn: '字幕 开',
            btnPlayerOff: '字幕 关',
            syncOffsetTitle: '⏱ 字幕时间轴微调',
            syncOffsetHint:
                '当广告或音画不同步时微调时间轴 (快捷键: [ / ] 或 Alt+[ / Alt+])',
            btnSyncEarlier: '提前 (+0.5秒)',
            btnSyncLater: '延后 (-0.5秒)',
            btnSyncReset: '重置',
            enableDomSync: 'DOM 原生字幕文本对比校准',
            enableDomSyncHint:
                '比对屏幕原生字幕文本自动校正微小漂移（默认关闭；播放器 API 已自动对齐）',
            btnDonate: '请作者喝杯咖啡 (Ko-fi)',
            tabSubtitles: '字幕翻译',
            tabVocab: '剧集生词本',
            tabAi: 'AI 服务',
            vocabCardTitle: '📚 剧集生词与例句收集器',
            vocabEnabled: '启用生词本提取',
            vocabEnabledHint:
                '在后台静默提取难词、地道俚语及原声例句，不干扰屏幕字幕',
            vocabProvider: '🤖 AI 服务提供商',
            vocabModel: '🧠 生词提取模型 (独立指定)',
            vocabDifficulty: '🎯 词汇难度分级',
            diffEasy: '🟢 基础 (口语短语/高频俚语)',
            diffMedium: '🟡 进阶 (大学/雅思托福/职场)',
            diffHard: '🔴 高难 (行业术语/GRE生僻)',
            btnDownloadCsv: '📥 导出下载生词本 (.CSV)',
            btnResetVocab: '🗑️ 清空重置本集词库',
            vocabCount: '已累积 {count} 个生词',
            vocabEmpty:
                '暂无收集到的词汇。开启功能并在播放视频时将自动在后台收集。',
            vocabResetConfirm: '确定要清空当前剧集已累积的生词吗？',
            vocabStatusProcessing: '后台正在分析剧集对白...',
            vocabStatusIdle: '就绪 / 空闲',
            vocabSourceLang: '🗣️ 原始字幕语言',
            langAuto: '✨ 自动识别 (日文/英文/韩文等)',
            vocabCustomPrompt: '✨ 自定义提取提示词 / 偏好 (可选)',
            vocabCustomPromptPlaceholder:
                '例如：重点提取 JLPT N1/N2 词汇与惯用句、忽略人名、专攻商务英语或医学术语...',
            vocabCustomPromptHint:
                '直接注入到大模型系统提示词中，精准控制生词提取偏好',
        },
        ja: {
            extName: 'CoWatcher AI 字幕翻訳',
            enableAi: 'AI 翻訳を有効化',
            statusOllama: 'Ollama ローカルサービス',
            aiProvider: '🤖 AI サービスプロバイダー',
            providerGoogle: 'Google 翻訳 (無料 / 設定不要)',
            providerOllama: 'Ollama (ローカル / プライバシー重視)',
            providerOpenRouter: 'OpenRouter (クラウド / マルチモデル)',
            statusGoogle: 'Google 翻訳 (準備完了)',
            statusOpenRouter: 'OpenRouter クラウド API',
            openrouterApiKey: '🔑 OpenRouter API キー',
            openrouterApiKeyHint:
                'ブラウザに安全に保存されます。キーの取得: openrouter.ai/keys',
            openrouterKeyPlaceholder: 'sk-or-v1-...',
            checkingOpenRouter: 'OpenRouter キーとモデルを確認中...',
            openrouterConnected: '接続完了 ({count} 個のモデルが利用可能)',
            openrouterFailed: 'OpenRouter への接続に失敗しました',
            openrouterTranslationModel: '🚀 OpenRouter 翻訳モデル',
            openrouterSupervisorModel: '🧐 OpenRouter 監督モデル',
            groupRecommended: '⭐ おすすめ (高速・高コスパ)',
            groupAllModels: '🌐 すべての利用可能モデル ({count})',
            customModelOption: '✏️ カスタムモデル ID を入力...',
            customModelPlaceholder:
                'モデル ID を入力 (例: deepseek/deepseek-chat)',
            ollamaApiUrl: '🔗 Ollama API URL',
            btnConnect: '接続',
            loadingModels: '利用可能なモデルを取得中...',
            noModelsFound: 'モデルが見つかりませんでした',
            connFailed: '接続失敗 (URL を確認してください)',
            checkingConn: 'Ollama 接続を確認中...',
            connected: '接続完了 ({count} 個のモデルが利用可能)',
            disconnected: 'ローカルの Ollama に接続できません',
            disconnectedHint: 'ollama serve が実行されているかご確認ください',
            refreshModels: 'モデル一覧を更新',
            uiLanguage: '🗣️ UI 言語 (UI Language)',
            translationModel: '🚀 翻訳モデル (先行 50 行を翻訳)',
            supervisorModel: '🧐 監督モデル (校正・修正およびコンテキスト維持)',
            targetLanguage: '🌐 翻訳先言語',
            displayMode: '字幕表示モード',
            displayBilingual: '二言語表示 (訳文 + 原文)',
            displayTransOnly: '訳文のみ',
            displayOrigOnly: '原文のみ',
            hideNativeSubtitles: '配信元の標準字幕を非表示',
            hideNativeSubtitlesHint:
                '標準字幕と AI 字幕の重複表示を防止（推奨）',
            enableSubtitleLearning: '字幕の単語分割・学習（クリック辞書）',
            enableSubtitleLearningHint:
                '左クリックで動画を一時停止して単語を辞書検索、右クリックで単語帳に登録（例文付き）',
            chinesePhoneticSystem: '発音表記システム（ピンイン / 注音）',
            chinesePhoneticSystemHint:
                '字幕のルビ表記にピンインまたは注音符号（ボポモフォ）を選択します',
            chinesePhoneticPinyin: 'ピンイン（Pinyin、例: kàn le）',
            chinesePhoneticZhuyin:
                '注音符号（Bopomofo、例: ㄎㄢˋ ˙ㄌㄜ）',
            koreanPhoneticSystem: '韓国語発音表記システム',
            koreanPhoneticSystemHint:
                '韓国語ローマ字表記で連続表記か音節ハイフン区切りかを選択します',
            koreanPhoneticDefault:
                '標準連続表記（例: beoreojyeotseumnida）',
            koreanPhoneticHyphenated:
                '音節ハイフン区切り（例: beo-reo-jyeot-seum-ni-da）',
            recordVocabAsLemma: '単語を辞書形（原形）で登録',
            recordVocabAsLemmaHint:
                '有効にすると活用形（例: scheduled）を辞書原形（例: schedule）に変換して登録します。無効の場合は原文のまま保存し原形フィールドに記録します',
            preferNativeSubtitles: '公式字幕を優先 (ゼロ遅延)',
            preferNativeSubtitlesHint:
                '配信元の公式字幕が存在する場合は優先して時間同期採用し、ない場合は AI 翻訳へ自動フォールバック',
            extractNativeTerms: '公式字幕から用語・登場人物を抽出',
            extractNativeTermsHint:
                '公式字幕利用時に、監督モデルで固有名詞・登場人物対照表を自動抽出（デフォルト: 無効）',
            contextCardTitle: '🎬 作品コンテキストと監督記憶',
            resetBtn: 'リセット',
            waitingPlayback: '再生待機中...',
            pendingBadge: '未識別',
            identifiedBadge: '✓ 監督モデルが作品背景を識別済み',
            recordingBadge: '○ 動的記録中',
            contextEmptyHint: '再生開始後に監督モデルが生成・更新します...',
            glossaryHeader: '登場人物と用語対照表',
            glossaryEmptyHint: '登録済みの登場人物や用語はありません',
            aliasesLabel: ' (別名: {aliases})',
            deleteItem: '削除',
            promoteItem: 'Confirm this item',
            inputOrigPlaceholder: '元の名前 (例: Shoko)',
            inputTransPlaceholder: '翻訳先での呼称 (例: 西宫硝子)',
            typeTerm: '用語',
            typeCharacter: '人物',
            btnAddTerm: '保存',
            resetConfirm:
                '現在の作品情報と用語集をリセットしてもよろしいですか？',
            enableSupervisor: '監督モデルを有効化（文脈校正・用語集）',
            enableSupervisorHint:
                '用語の統一と登場人物の記憶を維持します（VRAMが少ない場合はOFF推奨）',
            pipelineSettingsTitle: 'デュアルモデルパイプライン設定',
            pipelineGroupTranslation: '⚡ 動的 Cue バッチとバッファ設定',
            minCues: '最小バッチ行数 (min_cue)',
            minCuesHint: 'モデルへの送信に必要な最小行数 (デフォルト: 1)',
            minCuesVal: '{count} 行',
            maxCues: '最大バッチ行数 (max_cue)',
            maxCuesHint:
                '1回のリクエストで送信する最大行数 (Ollama: 30, OpenRouter: 100)',
            maxCuesVal: '{count} 行',
            batchSize: '先行翻訳バッファサイズ (キュー容量)',
            cuesUnit: '行',
            batchSizeHint: '翻訳モデルが再生位置より先行して翻訳する台詞の総数',
            refillThreshold: '自動補充しきい値 (最小安全バッファ)',
            refillHint: '残り < {count} 行',
            refillSubHint:
                '未再生の翻訳済み台詞がこの数を下回ると、後続を自動補充します',
            subChunkSize: '1回あたりの翻訳リクエスト行数',
            subChunkSizeHint:
                'バッチを小分けにして最初の字幕を高速表示します（低VRAM: 4〜6、高VRAM: 8〜12）',
            subChunkVal: '{count} 行/回',
            pipelineGroupSupervisor: '🧐 監督モデル校正設定',
            reviewBatchSize: '監督モデル校正バッチサイズ',
            reviewBatchSizeHint:
                '1回のプロンプトで監督モデルが校正する台詞の数 (Ollama: 8, OpenRouter: 20)',
            reviewBatchVal: '{count} 行',
            pipelineGroupAsr: '🎙️ ASR 音声認識字幕の自動結合',
            enableAutomaticAsrMerging: 'ASR 逐語断片字幕を自動結合',
            enableAutomaticAsrMergingHint:
                'YouTubeなどの自動生成字幕（ASR）の単語断片を翻訳前に自然な文に結合します',
            asrMergeBatchSize: 'ASR 結合ウィンドウサイズ',
            asrMergeBatchSizeHint:
                '1回の結合処理で処理する断片字幕の行数（デフォルト: 15）',
            asrMergeBatchVal: '{count} 断片',
            asrSilenceThreshold: '無音ポーズ閾値',
            asrSilenceThresholdHint:
                '文の区切りを検出する無音時間（ミリ秒、デフォルト: 600ms）',
            asrSilenceThresholdVal: '{count} ms',
            pipelineGroupStyle: '🎨 字幕スタイルと同期',
            fontSize: '字幕フォントサイズ',
            bgOpacity: '字幕背景の不透明度',
            bgOpacityHint:
                '字幕背景の透明度を調整します（デフォルト: 0% 完全透明）',
            translationOpacity: '翻訳字幕の不透明度',
            translationOpacityHint:
                '翻訳字幕の濃さを調整します。低く設定してもマウスホバーで100%表示されます（デフォルト: 100%）',
            enableGlassEffect: 'すりガラス風フレーム（ぼかし・光沢枠線）',
            enableGlassEffectHint:
                '字幕に背景ぼかし・光沢枠線・ドロップシャドウを適用（デフォルト: 無効）',
            enableAnimation: '字幕のフェードアニメーションを有効化',
            enableAnimationHint:
                '字幕の表示・非表示にフェード効果を付加（無効時は瞬時切替でちらつき防止；デフォルト: 無効）',
            showOriginalSmaller: '二言語表示で原文を小さく表示 (75%)',
            showOriginalSmallerHint:
                '二言語モードで原文を75%のサイズで表示し、訳文を際立たせます',
            swapSubtitleOrder: '原文と訳文の順序を入れ替え (原文を上に表示)',
            swapSubtitleOrderHint:
                '二言語モードで原文を上行、訳文を下行に表示します',
            bottomMargin: '下部マージン',
            testTitle: 'クイックテスト',
            testPlaceholder: 'テスト用の台詞を入力...',
            btnTest: 'テスト',
            testHint: 'テストボタンを押してローカルモデルの応答を確認...',
            testDrafting: '翻訳モデルで初期訳を生成中...',
            testTransDone: '✓ 翻訳モデル ({time}ms):',
            testReviewing: '監督モデル ({model}) が校正中...',
            testSupervisorDone: '🧐 監督モデル校正 ({time}ms):',
            testSupervisorDisabled: '(設定で監督モデルが無効化されています)',
            testNoCorrection:
                '修正不要。文脈および登場人物の一貫性を確認しました。',
            testFailed: '✗ 翻訳失敗: {error}',
            footerText: 'ローカル AI 推論 · 超低遅延 · プライバシー保護',
            toastEnabled: '✓ AI 字幕を有効にしました',
            toastDisabled: '✕ AI 字幕を無効にしました (Alt+T)',
            toastSyncOffset: '⏱ 字幕オフセット: {offset}秒',
            btnPlayerTitle:
                'CoWatcher AI 字幕翻訳 (クリックで切替 / ショートカット: Alt+T)',
            btnPlayerOn: '字幕 ON',
            btnPlayerOff: '字幕 OFF',
            syncOffsetTitle: '⏱ 字幕同期オフセット',
            syncOffsetHint:
                '広告などで字幕がズレる場合に微調整 (ショートカット: [ / ] または Alt+[ / Alt+])',
            btnSyncEarlier: '早める (+0.5秒)',
            btnSyncLater: '遅らせる (-0.5秒)',
            btnSyncReset: 'リセット',
            enableDomSync: 'DOM 字幕テキスト自動同期',
            enableDomSyncHint:
                '画面上の標準字幕テキストと比較してズレを自動補正（デフォルト: 無効；API で自動同期済み）',
            btnDonate: 'Ko-fi で応援する',
            tabSubtitles: '字幕翻訳',
            tabVocab: '単語帳',
            tabAi: 'AI サービス',
            vocabCardTitle: '📚 エピソード単語帳コレクター',
            vocabEnabled: '単語帳の自動抽出を有効化',
            vocabEnabledHint:
                '字幕表示を邪魔することなく、バックグラウンドで重要単語や例文を自動収集します',
            vocabProvider: '🤖 AI サービスプロバイダー',
            vocabModel: '🧠 単語抽出モデル (独立指定)',
            vocabDifficulty: '🎯 難易度レベル',
            diffEasy: '🟢 初級 (口語表現・スラング)',
            diffMedium: '🟡 中級 (TOEFL/IELTS・実用)',
            diffHard: '🔴 上級 (専門用語・GRE)',
            btnDownloadCsv: '📥 単語帳をダウンロード (.CSV)',
            btnResetVocab: '🗑️ このエピソードの単語帳をリセット',
            vocabCount: '{count} 個の単語を収集済み',
            vocabEmpty:
                '収集された単語はまだありません。機能をオンにして動画を再生すると自動収集されます。',
            vocabResetConfirm:
                'このエピソードで収集した単語をすべて消去してもよろしいですか？',
            vocabStatusProcessing: 'バックグラウンドで字幕を解析中...',
            vocabStatusIdle: '準備完了 / 待機中',
            vocabSourceLang: '🗣️ 元の字幕言語',
            langAuto: '✨ 自動検出 (日本語/英語/韓国語など)',
            vocabCustomPrompt: '✨ カスタム抽出プロンプト (任意)',
            vocabCustomPromptPlaceholder:
                '例: JLPT N1の慣用句やビジネス表現に集中、固有名詞は除外...',
            vocabCustomPromptHint:
                'プロンプトに直接反映され、単語の抽出傾向をカスタマイズできます',
        },
        ko: {
            extName: 'CoWatcher AI 자막 번역기',
            enableAi: 'AI 번역 활성화',
            statusOllama: 'Ollama 로컬 서비스',
            aiProvider: '🤖 AI 서비스 제공업체',
            providerGoogle: 'Google 번역 (무료 / 즉시 사용)',
            providerOllama: 'Ollama (로컬 / 개인정보 보호)',
            providerOpenRouter: 'OpenRouter (클라우드 / 멀티 모델)',
            statusGoogle: 'Google 번역 (준비 완료)',
            statusOpenRouter: 'OpenRouter 클라우드 API',
            openrouterApiKey: '🔑 OpenRouter API 키',
            openrouterApiKeyHint:
                '브라우저에 안전하게 저장됩니다. 키 발급: openrouter.ai/keys',
            openrouterKeyPlaceholder: 'sk-or-v1-...',
            checkingOpenRouter: 'OpenRouter 키 및 모델 확인 중...',
            openrouterConnected: '연결됨 ({count}개 모델 사용 가능)',
            openrouterFailed: 'OpenRouter 연결 실패',
            openrouterTranslationModel: '🚀 OpenRouter 번역 모델',
            openrouterSupervisorModel: '🧐 OpenRouter 감수 모델',
            groupRecommended: '⭐ 추천 (고속 및 고가성비)',
            groupAllModels: '🌐 사용 가능한 모든 모델 ({count})',
            customModelOption: '✏️ 사용자 지정 모델 ID 입력...',
            customModelPlaceholder: '모델 ID 입력 (예: deepseek/deepseek-chat)',
            ollamaApiUrl: '🔗 Ollama API URL',
            btnConnect: '연결',
            loadingModels: '사용 가능한 모델 불러오는 중...',
            noModelsFound: '서버에서 모델을 찾을 수 없습니다',
            connFailed: '연결 실패 (API URL 확인)',
            checkingConn: 'Ollama 연결 확인 중...',
            connected: '연결됨 ({count}개 모델 사용 가능)',
            disconnected: '로컬 Ollama에 연결할 수 없습니다',
            disconnectedHint: 'ollama serve가 실행 중인지 확인하세요',
            refreshModels: '모델 목록 새로고침',
            uiLanguage: '🗣️ UI 언어 (UI Language)',
            translationModel: '🚀 번역 모델 (앞서 50줄 번역 담당)',
            supervisorModel: '🧐 감수 모델 (검토, 수정 및 컨텍스트 관리)',
            targetLanguage: '🌐 번역 대상 언어',
            displayMode: '자막 표시 모드',
            displayBilingual: '이중 자막 (번역문 + 원문)',
            displayTransOnly: '번역문만 표시',
            displayOrigOnly: '원문만 표시',
            hideNativeSubtitles: '플랫폼 기본 자막 숨기기',
            hideNativeSubtitlesHint:
                '기본 자막과 AI 자막의 중복 표시 방지 (권장)',
            enableSubtitleLearning: '자막 단어 분절 및 학습 (단어 클릭)',
            enableSubtitleLearningHint:
                '단어를 클릭하여 영상 일시정지 및 사전 검색, 우클릭으로 단어장에 빠른 저장 (예문 포함)',
            chinesePhoneticSystem: '발음 표기 체계 (병음 / 주음)',
            chinesePhoneticSystemHint:
                '자막의 발음 표기에 한어병음 또는 주음부호(보포모포)를 선택합니다',
            chinesePhoneticPinyin: '한어병음 (Pinyin, 예: kàn le)',
            chinesePhoneticZhuyin:
                '주음부호 (Bopomofo, 예: ㄎㄢˋ ˙ㄌㄜ)',
            koreanPhoneticSystem: '한국어 발음 표기 체계',
            koreanPhoneticSystemHint:
                '한국어 로마자 표기 시 표준 연속 표기 또는 음절 붙임표(-) 구분을 선택합니다',
            koreanPhoneticDefault:
                '표준 연속 표기 (예: beoreojyeotseumnida)',
            koreanPhoneticHyphenated:
                '음절 붙임표 구분 (예: beo-reo-jyeot-seum-ni-da)',
            recordVocabAsLemma: '단어를 사전 원형(기본형)으로 기록',
            recordVocabAsLemmaHint:
                '선택 시 활용형(예: scheduled)을 원형(예: schedule)으로 기록합니다. 미선택 시 원문 표기를 유지하고 원형 필드에 별도 기록합니다',
            preferNativeSubtitles: '플랫폼 공식 자막 우선 (0 지연)',
            preferNativeSubtitlesHint:
                '타겟 언어의 공식 자막이 있을 경우 우선 적용하며, 없을 시 AI 번역으로 자동 폴백',
            extractNativeTerms: '공식 자막에서 용어 및 인물 사전 추출',
            extractNativeTermsHint:
                '공식 자막을 사용할 때 감수 모델이 고유명사 및 인물 사전을 추출하도록 허용 (기본값: 꺼짐)',
            contextCardTitle: '🎬 작품 컨텍스트 및 감수 메모리',
            resetBtn: '초기화',
            waitingPlayback: '재생 대기 중...',
            pendingBadge: '식별 대기',
            identifiedBadge: '✓ 감수 모델이 배경 정보 식별 완료',
            recordingBadge: '○ 동적 기록 중',
            contextEmptyHint:
                '재생 시작 후 감수 모델이 구축 및 업데이트합니다...',
            glossaryHeader: '등장인물 및 고유명사 대조표',
            glossaryEmptyHint: '기록된 등장인물이나 용어가 없습니다',
            aliasesLabel: ' (별칭: {aliases})',
            deleteItem: '삭제',
            promoteItem: 'Confirm this item',
            inputOrigPlaceholder: '원문 (예: Shoko)',
            inputTransPlaceholder: '번역 (예: 니시미야 쇼코)',
            typeTerm: '용어',
            typeCharacter: '인물',
            btnAddTerm: '저장',
            resetConfirm:
                '현재 작품 컨텍스트와 인물 사전을 초기화하시겠습니까?',
            enableSupervisor: '감수 모델 활성화 (문맥 검토 및 인물 사전)',
            enableSupervisorHint:
                '용어 일관성 및 인물 사전을 관리합니다 (VRAM이 부족할 경우 끄기 권장)',
            pipelineSettingsTitle: '듀얼 모델 파이프라인 설정',
            pipelineGroupTranslation: '⚡ 동적 Cue 일괄 처리 및 버퍼 설정',
            minCues: '최소 배치 자막 수 (min_cue)',
            minCuesHint: '모델 호출에 필요한 최소 자막 수 (기본값: 1)',
            minCuesVal: '{count} 줄',
            maxCues: '최대 배치 자막 수 (max_cue)',
            maxCuesHint: '요청당 최대 자막 수 (Ollama: 30, OpenRouter: 100)',
            maxCuesVal: '{count} 줄',
            batchSize: '사전 번역 버퍼 크기 (대기열 용량)',
            cuesUnit: '줄',
            batchSizeHint:
                '번역 모델이 영상 진행보다 앞서 미리 번역할 대사 총수',
            refillThreshold: '자동 보충 임계값 (최소 안전 버퍼)',
            refillHint: '남은 수 < {count} 줄',
            refillSubHint:
                '재생되지 않은 번역 대사가 이 수치 미만일 때 다음 배치를 자동 보충합니다',
            subChunkSize: '1회당 번역 요청 대사 수',
            subChunkSizeHint:
                '배치를 작은 단위로 나누어 첫 자막을 빠르게 표시합니다 (낮은 VRAM: 4~6, 높은 VRAM: 8~12)',
            subChunkVal: '{count} 줄/회',
            pipelineGroupSupervisor: '🧐 감수 모델 검토 설정',
            reviewBatchSize: '감수 모델 검토 대사 수',
            reviewBatchSizeHint:
                '한 번의 프롬프트로 감수 모델이 검토할 대사 수 (Ollama: 8, OpenRouter: 20)',
            reviewBatchVal: '{count} 줄',
            pipelineGroupAsr: '🎙️ ASR 음성 인식 자막 자동 병합',
            enableAutomaticAsrMerging: 'ASR 단어 조각 자막 자동 병합',
            enableAutomaticAsrMergingHint:
                'YouTube 등의 ASR 자동 생성 자막 조각을 번역 전에 완전한 문장으로 자동 병합합니다',
            asrMergeBatchSize: 'ASR 병합 윈도우 크기',
            asrMergeBatchSizeHint:
                '1회 병합 처리 시 처리할 자막 조각 수 (기본값: 15)',
            asrMergeBatchVal: '{count} 조각',
            asrSilenceThreshold: '무음 일시정지 임계값',
            asrSilenceThresholdHint:
                '문장 구분을 감지할 무음 시간(밀리초, 기본값: 600ms)',
            asrSilenceThresholdVal: '{count} ms',
            pipelineGroupStyle: '🎨 자막 스타일 및 싱크',
            fontSize: '자막 글꼴 크기',
            bgOpacity: '자막 배경 불투명도',
            bgOpacityHint:
                '자막 배경의 투명도를 조절합니다 (기본값: 0% 완전 투명)',
            translationOpacity: '번역 자막 불투명도',
            translationOpacityHint:
                '번역 자막의 투명도를 조절합니다. 마우스 호버 시 100%로 표시됩니다 (기본값: 100%)',
            enableGlassEffect: '반투명 유리 질감 프레임 (블러 및 테두리 광택)',
            enableGlassEffectHint:
                '자막에 배경 블러, 테두리 광택 및 그림자 효과 적용 (기본값: 꺼짐)',
            enableAnimation: '자막 페이드 인/아웃 애니메이션 활성화',
            enableAnimationHint:
                '자막 전환 시 부드러운 페이드 효과 적용 (끄면 깜빡임 없이 즉시 전환됨; 기본값: 꺼짐)',
            showOriginalSmaller: '이중 자막 모드에서 원문 작게 표시 (75%)',
            showOriginalSmallerHint:
                '이중 자막 모드에서 원문을 75% 크기로 표시하여 번역문을 강조합니다',
            swapSubtitleOrder: '원문과 번역문 순서 바꾸기 (원문 상단 표시)',
            swapSubtitleOrderHint:
                '이중 자막 모드에서 원문을 첫 번째 줄, 번역문을 두 번째 줄에 표시합니다',
            bottomMargin: '하단 여백',
            testTitle: '빠른 테스트',
            testPlaceholder: '테스트할 대사를 입력하세요...',
            btnTest: '테스트',
            testHint: '테스트 버튼을 눌러 로컬 모델 응답을 확인하세요...',
            testDrafting: '번역 모델로 초벌 번역 생성 중...',
            testTransDone: '✓ 번역 모델 ({time}ms):',
            testReviewing: '감수 모델 ({model}) 검토 중...',
            testSupervisorDone: '🧐 감수 모델 검토 ({time}ms):',
            testSupervisorDisabled: '(설정에서 감수 모델이 비활성화됨)',
            testNoCorrection:
                '수정 불필요. 문맥 및 등장인물 일관성에 부합합니다.',
            testFailed: '✗ 번역 실패: {error}',
            footerText: '로컬 AI 추론 · 초저지연 · 개인정보 보호',
            toastEnabled: '✓ AI 자막 활성화됨',
            toastDisabled: '✕ AI 자막 비활성화됨 (Alt+T)',
            toastSyncOffset: '⏱ 자막 오프셋: {offset}초',
            btnPlayerTitle:
                'CoWatcher AI 자막 번역 (클릭하여 전환 / 단축키: Alt+T)',
            btnPlayerOn: '자막 ON',
            btnPlayerOff: '자막 OFF',
            syncOffsetTitle: '⏱ 자막 동기화 오프셋',
            syncOffsetHint:
                '광고 등으로 자막 싱크가 맞지 않을 때 미세 조정 (단축키: [ / ] 또는 Alt+[ / Alt+])',
            btnSyncEarlier: '빠르게 (+0.5초)',
            btnSyncLater: '느리게 (-0.5초)',
            btnSyncReset: '초기화',
            enableDomSync: 'DOM 자막 텍스트 자동 동기화',
            enableDomSyncHint:
                '화면의 기본 자막 텍스트와 비교하여 시간차를 자동 보정 (기본값: 꺼짐; API로 이미 자동 동기화됨)',
            btnDonate: 'Ko-fi로 커피 한 잔 후원하기',
            tabSubtitles: '자막 번역',
            tabVocab: '단어장',
            tabAi: 'AI 서비스',
            vocabCardTitle: '📚 에피소드 단어장 수집기',
            vocabEnabled: '단어장 자동 수집 활성화',
            vocabEnabledHint:
                '자막 재생을 방해하지 않고 백그라운드에서 난이도 있는 단어와 문맥 예문을 자동 수집합니다',
            vocabProvider: '🤖 AI 서비스 제공업체',
            vocabModel: '🧠 단어 추출 모델 (독립 지정)',
            vocabDifficulty: '🎯 난이도 수준',
            diffEasy: '🟢 초급 (구동사 및 일상 속어)',
            diffMedium: '🟡 중급 (대학/토플/아이엘츠)',
            diffHard: '🔴 고급 (전문 용어/GRE)',
            btnDownloadCsv: '📥 단어장 다운로드 (.CSV)',
            btnResetVocab: '🗑️ 이 에피소드 단어장 초기화',
            vocabCount: '{count}개 단어 수집됨',
            vocabEmpty:
                '수집된 단어가 아직 없습니다. 기능을 켜고 에피소드를 재생하면 백그라운드에서 자동 수집됩니다.',
            vocabResetConfirm:
                '이 에피소드에서 수집된 모든 단어를 삭제하시겠습니까?',
            vocabStatusProcessing: '백그라운드에서 자막 대사를 분석 중...',
            vocabStatusIdle: '준비 완료 / 대기 중',
            vocabSourceLang: '🗣️ 원본 자막 언어',
            langAuto: '✨ 자동 감지 (일본어/영어/한국어 등)',
            vocabCustomPrompt: '✨ 사용자 지정 추출 프롬프트 (선택)',
            vocabCustomPromptPlaceholder:
                '예: JLPT N1 관용구, 비즈니스 전문 용어 집중, 인명 제외...',
            vocabCustomPromptHint:
                '프롬프트에 직접 반영되어 원하는 단어 추출 경향을 맞춤 설정합니다',
        },
    },

    normalizeLang(lang?: string): string {
        if (!lang) return 'en';
        const lower = String(lang).toLowerCase();
        if (lower.startsWith('zh')) return 'zh';
        if (lower.startsWith('ja')) return 'ja';
        if (lower.startsWith('ko')) return 'ko';
        return 'en';
    },

    getText(
        key: string,
        lang: string = 'en',
        params: Record<string, string | number> = {},
    ): string {
        const l = this.normalizeLang(lang);
        const table =
            (this.STRINGS as Record<string, Record<string, string>>)[l] ||
            this.STRINGS.en;
        let text =
            table[key] !== undefined
                ? table[key]
                : (this.STRINGS.en as Record<string, string>)[key] !== undefined
                  ? (this.STRINGS.en as Record<string, string>)[key]
                  : key;
        if (params && typeof params === 'object') {
            for (const [k, v] of Object.entries(params)) {
                text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
            }
        }
        return text;
    },
};

export default NCW_I18N;
