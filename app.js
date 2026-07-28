"use strict";

const STORAGE_KEY = "quickrouter-image-key";
const GOOGLE_STORAGE_KEY = "google-gemini-image-key";
const PROMPT_MODEL_STORAGE_KEY = "quickrouter-prompt-optimizer-model";
const QUICK_PROMPT_STORAGE_KEY = "quickrouter-quick-prompts";
const DEFAULT_QUICK_PROMPT_MIGRATION_KEY = "quickrouter-default-cup-logo-prompt";
const DEFAULT_QUICK_PROMPT = {
  id: "default-cup-logo",
  title: "杯子贴logo",
  prompt: `请将第二张图片中的 logo 自然贴到第一张场景图里的杯子正面中央。

要求：
1. logo 必须完整清晰可见，不要改字母、图形和比例，logo改为白色。
2. 根据杯子的弧面、角度和透视进行贴合，像真实印刷/贴纸一样贴在杯子表面。
3. logo 边缘要干净，不能漂浮，不能变形过度，不能像后期硬贴。
4. 保留原场景图的构图、光线、阴影、背景和杯子材质。
5. 不要新增其他文字、图案、产品或装饰。
6. 输出一张真实商品场景图。`,
  createdAt: 0,
  updatedAt: 0
};
const GPT_IMAGE_LIMIT_BYTES = 25 * 1024 * 1024;

const state = {
  scenes: [],
  logos: [],
  results: [],
  abortController: null,
  isGenerating: false,
  quickPrompts: [],
  editingQuickPromptId: null,
  isQuickPromptMenuOpen: false,
  isOptimizingPrompt: false,
  viewModes: {
    pairs: "medium",
    results: "medium"
  }
};

const els = {
  sceneInput: document.querySelector("#sceneInput"),
  logoInput: document.querySelector("#logoInput"),
  sceneMeta: document.querySelector("#sceneMeta"),
  logoMeta: document.querySelector("#logoMeta"),
  pairGrid: document.querySelector("#pairGrid"),
  pairEmpty: document.querySelector("#pairEmpty"),
  pairTemplate: document.querySelector("#pairTemplate"),
  resultGrid: document.querySelector("#resultGrid"),
  resultEmpty: document.querySelector("#resultEmpty"),
  resultTemplate: document.querySelector("#resultTemplate"),
  previewModal: document.querySelector("#previewModal"),
  previewImage: document.querySelector("#previewImage"),
  previewTitle: document.querySelector("#previewTitle"),
  previewMeta: document.querySelector("#previewMeta"),
  previewCloseButton: document.querySelector("#previewCloseButton"),
  viewButtons: [...document.querySelectorAll("[data-view-target][data-view-mode]")],
  resultSummary: document.querySelector("#resultSummary"),
  selectAllResults: document.querySelector("#selectAllResults"),
  downloadSelectedButton: document.querySelector("#downloadSelectedButton"),
  clearResultsButton: document.querySelector("#clearResultsButton"),
  clearImagesButton: document.querySelector("#clearImagesButton"),
  addPairButton: document.querySelector("#addPairButton"),
  addPairInput: document.querySelector("#addPairInput"),
  apiKeyInput: document.querySelector("#apiKeyInput"),
  googleApiKeyInput: document.querySelector("#googleApiKeyInput"),
  quickRouterKeyField: document.querySelector("#quickRouterKeyField"),
  googleKeyField: document.querySelector("#googleKeyField"),
  rememberKeyInput: document.querySelector("#rememberKeyInput"),
  clearKeyButton: document.querySelector("#clearKeyButton"),
  modelInputs: [...document.querySelectorAll("input[name='model']")],
  gptSettings: document.querySelector("#gptSettings"),
  bananaSettings: document.querySelector("#bananaSettings"),
  officialBananaSettings: document.querySelector("#officialBananaSettings"),
  gptModelInput: document.querySelector("#gptModelInput"),
  gptCountInput: document.querySelector("#gptCountInput"),
  gptSizeInput: document.querySelector("#gptSizeInput"),
  gptQualityInput: document.querySelector("#gptQualityInput"),
  gptFormatInput: document.querySelector("#gptFormatInput"),
  bananaModelInput: document.querySelector("#bananaModelInput"),
  bananaCountInput: document.querySelector("#bananaCountInput"),
  bananaRatioInput: document.querySelector("#bananaRatioInput"),
  bananaSizeInput: document.querySelector("#bananaSizeInput"),
  officialBananaModelInput: document.querySelector("#officialBananaModelInput"),
  officialBananaCountInput: document.querySelector("#officialBananaCountInput"),
  officialBananaRatioInput: document.querySelector("#officialBananaRatioInput"),
  officialBananaSizeInput: document.querySelector("#officialBananaSizeInput"),
  concurrencyInput: document.querySelector("#concurrencyInput"),
  promptInput: document.querySelector("#promptInput"),
  quickPromptList: document.querySelector("#quickPromptList"),
  quickPromptEmpty: document.querySelector("#quickPromptEmpty"),
  quickPromptEditor: document.querySelector("#quickPromptEditor"),
  quickPromptTitleInput: document.querySelector("#quickPromptTitleInput"),
  quickPromptTextInput: document.querySelector("#quickPromptTextInput"),
  quickPromptToggleButton: null,
  quickPromptMenu: null,
  quickPromptOverlay: null,
  aiPromptModelSelect: null,
  aiPromptModelDialog: null,
  newQuickPromptButton: document.querySelector("#newQuickPromptButton"),
  saveQuickPromptButton: document.querySelector("#saveQuickPromptButton"),
  cancelQuickPromptButton: document.querySelector("#cancelQuickPromptButton"),
  generateButton: document.querySelector("#generateButton"),
  cancelButton: document.querySelector("#cancelButton"),
  queueStatus: document.querySelector("#queueStatus"),
  messageArea: document.querySelector("#messageArea")
};

const modelRegistry = {
  gpt: {
    label: "GPT",
    endpoint: "https://api.quickrouter.ai/v1/images/edits",
    buildJobs(pair, settings) {
      return [
        {
          pairIndex: pair.index,
          variationIndex: 1,
          model: settings.model,
          expectedCount: settings.count,
          request: buildGptFormData(pair, settings)
        }
      ];
    },
    async execute(job, key, signal) {
      const response = await safeFetch(this.endpoint, {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${key}`
        },
        body: job.request,
        signal,
        redirect: "follow"
      });
      const json = await parseJsonResponse(response);
      return normalizeGptResults(json, job);
    }
  },
  banana: {
    label: "Banana",
    endpoint(model) {
      return `https://api.quickrouter.ai/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    },
    buildJobs(pair, settings) {
      return Array.from({ length: settings.count }, (_, index) => {
        const generationConfig = {
          responseModalities: ["TEXT", "IMAGE"],
          imageConfig: {
            aspectRatio: settings.aspectRatio
          }
        };

        if (settings.imageSize) {
          generationConfig.imageConfig.imageSize = settings.imageSize;
        }

        return {
          pairIndex: pair.index,
          variationIndex: index + 1,
          model: settings.model,
          expectedCount: 1,
          request: {
            contents: [
              {
                role: "user",
                parts: [
                  {
                    inlineData: {
                      mimeType: pair.scene.mimeType,
                      data: pair.scene.base64
                    }
                  },
                  {
                    inlineData: {
                      mimeType: pair.logo.mimeType,
                      data: pair.logo.base64
                    }
                  },
                  {
                    text: settings.prompt
                  }
                ]
              }
            ],
            generationConfig
          }
        };
      });
    },
    async execute(job, key, signal) {
      const response = await safeFetch(this.endpoint(job.model), {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`
        },
        body: JSON.stringify(job.request),
        signal,
        redirect: "follow"
      });
      const json = await parseJsonResponse(response);
      return normalizeBananaResults(json, job);
    }
  },
  officialBanana: {
    label: "官方 Banana",
    endpoint: "https://generativelanguage.googleapis.com/v1beta/interactions",
    buildJobs(pair, settings) {
      return Array.from({ length: settings.count }, (_, index) => {
        const responseFormat = {
          type: "image",
          aspect_ratio: settings.aspectRatio
        };
        if (settings.imageSize) {
          responseFormat.image_size = settings.imageSize;
        }
        return {
          pairIndex: pair.index,
          variationIndex: index + 1,
          model: settings.model,
          expectedCount: 1,
          request: {
            model: settings.model,
            input: [
              {
                type: "image",
                mime_type: pair.scene.mimeType,
                data: pair.scene.base64
              },
              {
                type: "image",
                mime_type: pair.logo.mimeType,
                data: pair.logo.base64
              },
              {
                type: "text",
                text: settings.prompt
              }
            ],
            response_format: responseFormat
          }
        };
      });
    },
    async execute(job, key, signal) {
      const response = await safeFetch(this.endpoint, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "x-goog-api-key": key
        },
        body: JSON.stringify(job.request),
        signal,
        redirect: "follow"
      });
      const json = await parseJsonResponse(response);
      const results = normalizeOfficialBananaResults(json, job);
      if (results.length === 0) {
        throw new Error(json.error?.message || "Google Gemini 官方接口未返回图片。");
      }
      return results;
    }
  }
};

init();

function init() {
  restoreKey();
  loadQuickPrompts();
  setupQuickPromptLauncher();
  bindEvents();
  applyViewMode("pairs");
  applyViewMode("results");
  renderPairs();
  renderResults();
  renderQuickPrompts();
  updateModelPanel();
}

function bindEvents() {
  els.sceneInput.addEventListener("change", async (event) => {
    revokeImages(state.scenes);
    state.scenes = await filesToImages(event.target.files);
    renderPairs();
  });

  els.logoInput.addEventListener("change", async (event) => {
    revokeImages(state.logos);
    state.logos = await filesToImages(event.target.files);
    renderPairs();
  });

  els.addPairButton.addEventListener("click", () => {
    if (!state.isGenerating) {
      els.addPairInput.click();
    }
  });
  els.addPairInput.addEventListener("change", addPairsFromFiles);

  els.clearImagesButton.addEventListener("click", () => {
    revokeImages(state.scenes);
    revokeImages(state.logos);
    state.scenes = [];
    state.logos = [];
    els.sceneInput.value = "";
    els.logoInput.value = "";
    els.addPairInput.value = "";
    renderPairs();
  });

  els.modelInputs.forEach((input) => input.addEventListener("change", updateModelPanel));
  els.viewButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.viewModes[button.dataset.viewTarget] = button.dataset.viewMode;
      applyViewMode(button.dataset.viewTarget);
    });
  });
  els.apiKeyInput.addEventListener("input", persistKeyIfNeeded);
  els.apiKeyInput.addEventListener("input", invalidatePromptOptimizerModels);
  els.googleApiKeyInput.addEventListener("input", persistKeyIfNeeded);
  els.rememberKeyInput.addEventListener("change", persistKeyIfNeeded);
  els.clearKeyButton.addEventListener("click", clearStoredKey);
  els.generateButton.addEventListener("click", generateBatch);
  els.cancelButton.addEventListener("click", cancelBatch);
  els.clearResultsButton.addEventListener("click", clearResults);
  els.selectAllResults.addEventListener("change", toggleAllResults);
  els.downloadSelectedButton.addEventListener("click", downloadSelectedZip);
  els.quickPromptToggleButton?.addEventListener("click", toggleQuickPromptMenu);
  els.newQuickPromptButton?.addEventListener("click", () => openQuickPromptEditor());
  els.saveQuickPromptButton.addEventListener("click", saveQuickPromptFromEditor);
  els.cancelQuickPromptButton.addEventListener("click", closeQuickPromptEditor);
  els.previewCloseButton.addEventListener("click", closePreview);
  els.previewModal.addEventListener("click", (event) => {
    if (event.target.matches("[data-preview-close]")) {
      closePreview();
    }
  });
  document.addEventListener("click", closeQuickPromptMenuFromOutside);
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") {
      return;
    }
    if (!els.previewModal.classList.contains("is-hidden")) {
      closePreview();
      return;
    }
    if (els.aiPromptModelDialog && !els.aiPromptModelDialog.classList.contains("is-hidden")) {
      closePromptModelDialog();
      return;
    }
    if (isResultGalleryOpen()) {
      closeResultGallery();
      return;
    }
    if (!els.quickPromptEditor.classList.contains("is-hidden")) {
      closeQuickPromptEditor();
      return;
    }
    if (state.isQuickPromptMenuOpen) {
      closeQuickPromptMenu();
    }
  });
}

function loadQuickPrompts() {
  try {
    const stored = JSON.parse(localStorage.getItem(QUICK_PROMPT_STORAGE_KEY) || "[]");
    state.quickPrompts = Array.isArray(stored)
      ? stored.filter((item) => item && typeof item.title === "string" && typeof item.prompt === "string")
      : [];
  } catch {
    state.quickPrompts = [];
  }
  ensureDefaultQuickPrompt();
}

function ensureDefaultQuickPrompt() {
  const hasDefaultPrompt = state.quickPrompts.some((item) => item.id === DEFAULT_QUICK_PROMPT.id || item.title === DEFAULT_QUICK_PROMPT.title);
  const hasMigrated = localStorage.getItem(DEFAULT_QUICK_PROMPT_MIGRATION_KEY) === "1";
  if (hasDefaultPrompt || hasMigrated) {
    localStorage.setItem(DEFAULT_QUICK_PROMPT_MIGRATION_KEY, "1");
    return;
  }

  state.quickPrompts.unshift({ ...DEFAULT_QUICK_PROMPT });
  persistQuickPrompts();
  localStorage.setItem(DEFAULT_QUICK_PROMPT_MIGRATION_KEY, "1");
}

function persistQuickPrompts() {
  localStorage.setItem(QUICK_PROMPT_STORAGE_KEY, JSON.stringify(state.quickPrompts));
}

function setupQuickPromptLauncher() {
  if (!els.quickPromptList || !els.promptInput || els.quickPromptToggleButton) {
    return;
  }

  injectQuickPromptStyles();

  const sourcePanel = els.quickPromptList.closest(".quick-prompts");
  const launcher = document.createElement("div");
  launcher.className = "quick-prompt-launcher";

  const toggleButton = document.createElement("button");
  toggleButton.className = "quick-prompt-toggle";
  toggleButton.type = "button";
  toggleButton.title = "快捷提示词";
  toggleButton.setAttribute("aria-label", "快捷提示词");
  toggleButton.setAttribute("aria-expanded", "false");
  toggleButton.textContent = "⚡ 快捷›";

  const menu = document.createElement("div");
  menu.className = "quick-prompt-menu is-hidden";
  menu.setAttribute("role", "menu");
  menu.append(els.quickPromptList, els.quickPromptEmpty);
  launcher.append(toggleButton, menu);

  const composer = document.createElement("div");
  composer.className = "quick-prompt-composer";
  els.promptInput.insertAdjacentElement("beforebegin", composer);
  composer.append(els.promptInput);

  const toolbar = document.createElement("div");
  toolbar.className = "quick-prompt-toolbar";
  composer.append(toolbar);
  const optimizeButton = document.createElement("button");
  optimizeButton.className = "prompt-tool-button";
  optimizeButton.type = "button";
  optimizeButton.textContent = "✨ 优化提示词";
  optimizeButton.title = "根据当前所选图片模型优化贴 Logo 提示词";
  optimizeButton.addEventListener("click", () => openPromptModelDialog(optimizeButton));

  const modelPicker = document.createElement("div");
  modelPicker.className = "prompt-model-select-row";
  const modelPickerText = document.createElement("span");
  modelPickerText.textContent = "聊天模型";
  const modelSelect = document.createElement("select");
  modelSelect.setAttribute("aria-label", "提示词优化聊天模型");
  const savedPromptModel = localStorage.getItem(PROMPT_MODEL_STORAGE_KEY) || "gpt-4o-mini";
  modelSelect.append(new Option(savedPromptModel, savedPromptModel));
  modelSelect.value = savedPromptModel;
  modelSelect.addEventListener("change", () => {
    localStorage.setItem(PROMPT_MODEL_STORAGE_KEY, modelSelect.value);
  });
  modelSelect.addEventListener("focus", () => {
    if (modelSelect.options.length <= 1) {
      loadPromptOptimizerModels();
    }
  });
  const refreshModelsButton = document.createElement("button");
  refreshModelsButton.className = "prompt-model-refresh";
  refreshModelsButton.type = "button";
  refreshModelsButton.textContent = "↻";
  refreshModelsButton.title = "刷新 QuickRouter 模型列表";
  refreshModelsButton.setAttribute("aria-label", "刷新 QuickRouter 模型列表");
  refreshModelsButton.addEventListener("click", loadPromptOptimizerModels);
  modelPicker.append(modelSelect, refreshModelsButton);

  const modelDialog = document.createElement("div");
  modelDialog.className = "prompt-model-dialog is-hidden";
  modelDialog.setAttribute("role", "dialog");
  modelDialog.setAttribute("aria-modal", "true");
  modelDialog.setAttribute("aria-label", "选择提示词优化模型");
  const modelDialogPanel = document.createElement("section");
  modelDialogPanel.className = "prompt-model-dialog-panel";
  const modelDialogTitle = document.createElement("h3");
  modelDialogTitle.textContent = "选择 AI 提示词优化模型";
  const modelDialogHelp = document.createElement("p");
  modelDialogHelp.textContent = "仅显示当前 QuickRouter Key 支持的 GPT、Gemini、Claude、DeepSeek 语言模型。";
  const modelDialogField = document.createElement("label");
  modelDialogField.className = "prompt-model-dialog-field";
  modelDialogField.append(modelPickerText, modelPicker);
  const modelDialogActions = document.createElement("div");
  modelDialogActions.className = "prompt-model-dialog-actions";
  const cancelModelButton = document.createElement("button");
  cancelModelButton.type = "button";
  cancelModelButton.textContent = "取消";
  cancelModelButton.addEventListener("click", closePromptModelDialog);
  const confirmModelButton = document.createElement("button");
  confirmModelButton.type = "button";
  confirmModelButton.className = "is-primary";
  confirmModelButton.textContent = "确认并优化";
  confirmModelButton.addEventListener("click", () => {
    closePromptModelDialog();
    optimizePromptWithAi(optimizeButton);
  });
  modelDialogActions.append(cancelModelButton, confirmModelButton);
  modelDialogPanel.append(modelDialogTitle, modelDialogHelp, modelDialogField, modelDialogActions);
  modelDialog.append(modelDialogPanel);
  modelDialog.addEventListener("click", (event) => {
    if (event.target === modelDialog) {
      closePromptModelDialog();
    }
  });
  document.body.append(modelDialog);

  const spacer = document.createElement("span");
  spacer.className = "prompt-toolbar-spacer";
  spacer.setAttribute("aria-hidden", "true");

  const clearPromptButton = document.createElement("button");
  clearPromptButton.className = "prompt-tool-button prompt-clear-button";
  clearPromptButton.type = "button";
  clearPromptButton.textContent = "清空";
  clearPromptButton.addEventListener("click", clearPromptInput);

  toolbar.append(launcher, optimizeButton, spacer, clearPromptButton);

  if (sourcePanel && !sourcePanel.contains(els.promptInput)) {
    sourcePanel.classList.add("quick-prompt-source-hidden");
  }
  els.newQuickPromptButton?.classList.add("is-hidden");

  const overlay = document.createElement("div");
  overlay.className = "quick-prompt-editor-backdrop is-hidden";
  overlay.setAttribute("data-quick-prompt-editor-close", "true");
  document.body.append(overlay);
  overlay.append(els.quickPromptEditor);
  els.quickPromptEditor.classList.add("quick-prompt-editor-modal");
  overlay.addEventListener("click", (event) => {
    if (event.target.matches("[data-quick-prompt-editor-close]")) {
      closeQuickPromptEditor();
    }
  });

  els.quickPromptToggleButton = toggleButton;
  els.quickPromptMenu = menu;
  els.quickPromptOverlay = overlay;
  els.aiPromptModelSelect = modelSelect;
  els.aiPromptModelDialog = modelDialog;
}

function injectQuickPromptStyles() {
  if (document.querySelector("#quickPromptLauncherStyles")) {
    return;
  }

  const style = document.createElement("style");
  style.id = "quickPromptLauncherStyles";
  style.textContent = `
    .quick-prompt-composer {
      border: 1px solid #bfdbfe; border-radius: 26px; background: #ffffff; padding: 18px 16px 12px;
      box-shadow: 0 1px 2px rgba(15, 23, 42, .04); transition: border-color .15s ease, box-shadow .15s ease;
    }
    .quick-prompt-composer:focus-within { border-color: #93c5fd; box-shadow: 0 0 0 3px rgba(59, 130, 246, .12); }
    .quick-prompt-composer #promptInput {
      display: block; width: 100%; min-height: 74px; border: 0 !important; outline: none !important;
      background: transparent !important; box-shadow: none !important; padding: 0 8px 10px !important; resize: vertical;
    }
    .quick-prompt-toolbar { display: flex; align-items: center; justify-content: flex-start; gap: 8px; min-height: 30px; padding: 0 8px; flex-wrap: wrap; }
    .quick-prompt-source-hidden { display: none !important; }
    .quick-prompt-launcher { position: relative; z-index: 8; }
    .prompt-toolbar-spacer { flex: 1 1 auto; min-width: 16px; }
    .quick-prompt-toggle, .prompt-tool-button {
      width: auto; height: 30px; min-width: 0; border-radius: 13px; border: 0 !important;
      display: inline-flex; align-items: center; justify-content: center; gap: 5px; padding: 0 9px;
      background: #f3f4f6; color: #111827; cursor: pointer; font-size: 12px; font-weight: 600; line-height: 1;
      box-shadow: none;
    }
    .quick-prompt-toggle:hover, .quick-prompt-toggle.is-active, .prompt-tool-button:hover { background: #e5e7eb; color: #020617; }
    .prompt-model-dialog {
      position: fixed; inset: 0; z-index: 90; display: grid; place-items: center; padding: 20px;
      background: rgba(15, 23, 42, .5);
    }
    .prompt-model-dialog.is-hidden { display: none !important; }
    .prompt-model-dialog-panel {
      width: min(520px, 100%); padding: 22px; border-radius: 12px; background: #fff; color: #111827;
      box-shadow: 0 30px 90px rgba(15, 23, 42, .3);
    }
    .prompt-model-dialog-panel h3 { margin: 0 0 7px; font-size: 18px; }
    .prompt-model-dialog-panel > p { margin: 0 0 18px; color: #64748b; font-size: 13px; line-height: 1.55; }
    .prompt-model-dialog-field { display: grid; gap: 7px; color: #334155; font-size: 13px; font-weight: 700; }
    .prompt-model-select-row { display: grid; grid-template-columns: minmax(0, 1fr) 36px; gap: 8px; }
    .prompt-model-select-row select {
      width: 100%; min-width: 0; height: 42px; padding: 0 10px; border: 1px solid #cbd5e1;
      border-radius: 7px; outline: 0; background: #fff; color: #111827; font-size: 13px;
    }
    .prompt-model-select-row select:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px rgba(59, 130, 246, .12); }
    .prompt-model-refresh {
      width: 36px; height: 42px; min-height: 42px; padding: 0; border: 1px solid #cbd5e1; border-radius: 7px;
      background: #f8fafc; color: #475569; font-size: 17px; font-weight: 800; cursor: pointer;
    }
    .prompt-model-refresh:hover { background: #e2e8f0; color: #0f172a; }
    .prompt-model-refresh:disabled, .prompt-model-select-row select:disabled { cursor: wait; opacity: .55; }
    .prompt-model-dialog-actions { display: flex; justify-content: flex-end; gap: 9px; margin-top: 20px; }
    .prompt-model-dialog-actions button {
      min-height: 38px; padding: 0 15px; border: 0; border-radius: 7px; background: #e2e8f0;
      color: #334155; font-weight: 800; cursor: pointer;
    }
    .prompt-model-dialog-actions button.is-primary { background: #1f6f5b; color: #fff; }
    .prompt-model-dialog-actions button:disabled { cursor: wait; opacity: .55; }
    .prompt-clear-button { color: #64748b; }
    .prompt-clear-button:hover { background: #fee2e2; color: #b91c1c; }
    .quick-prompt-menu {
      position: absolute; top: 44px; left: 0; width: min(320px, calc(100vw - 32px)); max-height: 360px; overflow: auto;
      padding: 8px; border: 1px solid rgba(148, 163, 184, .28); border-radius: 8px; background: #ffffff;
      box-shadow: 0 24px 70px rgba(15, 23, 42, .22); color: #111827;
    }
    .quick-prompt-list { display: grid; gap: 6px; }
    .quick-prompt-add-item, .quick-prompt-title-button {
      width: 100%; min-height: 38px; border: 0; border-radius: 6px; background: transparent; color: inherit;
      display: flex; align-items: center; justify-content: flex-start; padding: 8px 10px; text-align: left; cursor: pointer;
      font: inherit;
    }
    .quick-prompt-add-item { color: #2563eb; font-weight: 700; border-bottom: 1px solid rgba(148, 163, 184, .18); }
    .quick-prompt-title-button:hover, .quick-prompt-add-item:hover { background: rgba(37, 99, 235, .08); }
    .quick-prompt-item { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 4px; }
    .quick-prompt-title-button strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .quick-prompt-item-actions { display: inline-flex; gap: 4px; }
    .quick-prompt-item-actions button { min-height: 30px; padding: 0 8px; border-radius: 6px; }
    .quick-prompt-editor-backdrop {
      position: fixed; inset: 0; z-index: 80; display: grid; place-items: center; padding: 20px; background: rgba(15, 23, 42, .48);
    }
    .quick-prompt-editor-modal {
      width: min(560px, 100%); max-height: min(720px, calc(100vh - 40px)); overflow: auto; border-radius: 8px;
      background: #ffffff; color: #111827; box-shadow: 0 30px 90px rgba(15, 23, 42, .28); padding: 20px;
    }
    .quick-prompt-menu.is-hidden, .quick-prompt-editor-backdrop.is-hidden { display: none !important; }
  `;
  document.head.append(style);
}

function renderQuickPrompts() {
  els.quickPromptList.replaceChildren();

  const addButton = document.createElement("button");
  addButton.className = "quick-prompt-add-item";
  addButton.type = "button";
  addButton.textContent = "新增";
  addButton.addEventListener("click", () => openQuickPromptEditor());
  els.quickPromptList.append(addButton);

  els.quickPromptEmpty.classList.toggle("is-hidden", state.quickPrompts.length > 0);

  state.quickPrompts.forEach((item) => {
    const row = document.createElement("article");
    row.className = "quick-prompt-item";

    const content = document.createElement("button");
    content.className = "quick-prompt-title-button";
    content.type = "button";
    content.title = "点击使用该提示词";
    content.addEventListener("click", () => useQuickPrompt(item.id));

    const title = document.createElement("strong");
    title.textContent = item.title;
    content.append(title);

    const actions = document.createElement("div");
    actions.className = "quick-prompt-item-actions";

    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.textContent = "编辑";
    editButton.addEventListener("click", () => openQuickPromptEditor(item.id));

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.textContent = "删除";
    deleteButton.addEventListener("click", () => deleteQuickPrompt(item.id));

    actions.append(editButton, deleteButton);
    row.append(content, actions);
    els.quickPromptList.append(row);
  });
}

function toggleQuickPromptMenu() {
  setQuickPromptMenuOpen(!state.isQuickPromptMenuOpen);
}

function setQuickPromptMenuOpen(isOpen) {
  state.isQuickPromptMenuOpen = isOpen;
  els.quickPromptMenu?.classList.toggle("is-hidden", !isOpen);
  els.quickPromptToggleButton?.classList.toggle("is-active", isOpen);
  els.quickPromptToggleButton?.setAttribute("aria-expanded", String(isOpen));
}

function closeQuickPromptMenu() {
  setQuickPromptMenuOpen(false);
}

function closeQuickPromptMenuFromOutside(event) {
  if (!state.isQuickPromptMenuOpen || event.target.closest(".quick-prompt-launcher")) {
    return;
  }
  closeQuickPromptMenu();
}

function openQuickPromptEditor(id = null) {
  closeQuickPromptMenu();
  const item = id ? state.quickPrompts.find((prompt) => prompt.id === id) : null;
  state.editingQuickPromptId = item ? item.id : null;
  els.quickPromptTitleInput.value = item?.title || "";
  els.quickPromptTextInput.value = item?.prompt || els.promptInput.value.trim();
  els.quickPromptOverlay?.classList.remove("is-hidden");
  els.quickPromptEditor.classList.remove("is-hidden");
  document.body.classList.add("has-modal");
  els.quickPromptTitleInput.focus();
}

function closeQuickPromptEditor() {
  state.editingQuickPromptId = null;
  els.quickPromptTitleInput.value = "";
  els.quickPromptTextInput.value = "";
  els.quickPromptEditor.classList.add("is-hidden");
  els.quickPromptOverlay?.classList.add("is-hidden");
  if (els.previewModal.classList.contains("is-hidden")) {
    document.body.classList.remove("has-modal");
  }
}

function saveQuickPromptFromEditor() {
  const title = els.quickPromptTitleInput.value.trim();
  const prompt = els.quickPromptTextInput.value.trim();
  if (!title || !prompt) {
    setMessage("快捷提示词需要填写标题和提示词。", "error");
    return;
  }

  if (state.editingQuickPromptId) {
    state.quickPrompts = state.quickPrompts.map((item) => {
      if (item.id !== state.editingQuickPromptId) {
        return item;
      }
      return { ...item, title, prompt, updatedAt: Date.now() };
    });
  } else {
    state.quickPrompts.unshift({
      id: uid(),
      title,
      prompt,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
  }

  persistQuickPrompts();
  renderQuickPrompts();
  closeQuickPromptEditor();
  setMessage("快捷提示词已保存。", "ok");
}

function clearPromptInput() {
  els.promptInput.value = "";
  closeQuickPromptMenu();
  els.promptInput.focus();
  setMessage("提示词已清空。", "ok");
}

async function optimizePromptWithAi(button) {
  if (state.isOptimizingPrompt || state.isGenerating) {
    if (state.isGenerating) {
      setMessage("图片生成期间暂不能优化提示词。", "warn");
    }
    return;
  }

  const key = els.apiKeyInput.value.trim();
  const sourcePrompt = els.promptInput.value.trim();
  if (!key) {
    setMessage("请输入 QuickRouter API Key 后再优化提示词。", "error");
    return;
  }
  if (!sourcePrompt) {
    setMessage("请先输入需要优化的提示词。", "error");
    els.promptInput.focus();
    return;
  }

  const settings = getSettings();
  const optimizerModel = els.aiPromptModelSelect?.value || "gpt-4o-mini";
  const originalText = button.textContent;
  persistKeyIfNeeded();
  state.isOptimizingPrompt = true;
  button.disabled = true;
  button.textContent = "✨ 优化中…";
  setMessage(`正在为 ${settings.model} 优化贴 Logo 提示词。`, "warn");

  try {
    const response = await safeFetch("https://api.quickrouter.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`
      },
      body: JSON.stringify({
        model: optimizerModel,
        messages: [
          {
            role: "user",
            content: buildPromptOptimizationRequest(sourcePrompt, settings)
          }
        ],
        max_tokens: 1200,
        stream: false
      }),
      redirect: "follow"
    });
    const json = await parseJsonResponse(response);
    const optimizedPrompt = cleanOptimizedPrompt(extractPromptOptimizerText(json));
    if (!optimizedPrompt) {
      throw new Error("AI 未返回可用的优化提示词。");
    }
    els.promptInput.value = optimizedPrompt;
    els.promptInput.dispatchEvent(new Event("input", { bubbles: true }));
    localStorage.setItem(PROMPT_MODEL_STORAGE_KEY, optimizerModel);
    setMessage(`已使用 ${optimizerModel} 为 ${settings.model} 完成提示词优化。`, "ok");
  } catch (error) {
    setMessage(error.message || "提示词优化失败，请检查 QuickRouter Key 和网络。", "error");
  } finally {
    state.isOptimizingPrompt = false;
    button.disabled = false;
    button.textContent = originalText;
  }
}

function openPromptModelDialog() {
  if (state.isGenerating) {
    setMessage("图片生成期间暂不能优化提示词。", "warn");
    return;
  }
  if (!els.apiKeyInput.value.trim()) {
    setMessage("请输入 QuickRouter API Key 后再优化提示词。", "error");
    return;
  }
  if (!els.promptInput.value.trim()) {
    setMessage("请先输入需要优化的提示词。", "error");
    els.promptInput.focus();
    return;
  }

  els.aiPromptModelDialog?.classList.remove("is-hidden");
  if (els.aiPromptModelSelect?.options.length <= 1) {
    loadPromptOptimizerModels();
  } else {
    els.aiPromptModelSelect.focus();
  }
}

function closePromptModelDialog() {
  els.aiPromptModelDialog?.classList.add("is-hidden");
}

function invalidatePromptOptimizerModels() {
  const select = els.aiPromptModelSelect;
  if (!select || select.options.length <= 1) {
    return;
  }
  const savedModel = localStorage.getItem(PROMPT_MODEL_STORAGE_KEY) || "gpt-4o-mini";
  select.replaceChildren(new Option(savedModel, savedModel));
}

async function loadPromptOptimizerModels() {
  const key = els.apiKeyInput.value.trim();
  const select = els.aiPromptModelSelect;
  if (!select) {
    return;
  }
  if (!key) {
    setMessage("请输入 QuickRouter API Key 后再加载聊天模型。", "error");
    return;
  }

  const refreshButton = select.parentElement?.querySelector(".prompt-model-refresh");
  const confirmButton = els.aiPromptModelDialog?.querySelector(".prompt-model-dialog-actions .is-primary");
  const previousModel = select.value;
  select.disabled = true;
  if (confirmButton) {
    confirmButton.disabled = true;
  }
  if (refreshButton) {
    refreshButton.disabled = true;
    refreshButton.textContent = "…";
  }
  setMessage("正在加载 QuickRouter 支持的模型。", "warn");

  try {
    const response = await safeFetch("https://api.quickrouter.ai/v1/models", {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${key}`
      },
      redirect: "follow"
    });
    const json = await parseJsonResponse(response);
    const modelIds = [...new Set(
      (Array.isArray(json.data) ? json.data : [])
        .map((model) => String(model?.id || "").trim())
        .filter(isSupportedPromptLanguageModel)
    )].sort((a, b) => a.localeCompare(b, "en"));

    if (modelIds.length === 0) {
      throw new Error("QuickRouter 未返回可用的 GPT、Gemini、Claude 或 DeepSeek 语言模型。");
    }
    const selectedModel = modelIds.includes(previousModel)
      ? previousModel
      : modelIds.includes("gpt-4o-mini")
        ? "gpt-4o-mini"
        : modelIds[0];
    select.replaceChildren(...modelIds.map((modelId) => new Option(modelId, modelId)));
    select.value = selectedModel;
    localStorage.setItem(PROMPT_MODEL_STORAGE_KEY, selectedModel);
    setMessage(`已加载 ${modelIds.length} 个 GPT、Gemini、Claude、DeepSeek 语言模型。`, "ok");
  } catch (error) {
    setMessage(error.message || "QuickRouter 模型列表加载失败。", "error");
  } finally {
    select.disabled = false;
    if (confirmButton) {
      confirmButton.disabled = false;
    }
    if (refreshButton) {
      refreshButton.disabled = false;
      refreshButton.textContent = "↻";
    }
  }
}

function isSupportedPromptLanguageModel(modelId) {
  const id = String(modelId || "").trim().toLowerCase();
  if (!id) {
    return false;
  }

  const supportedFamily = ["gpt", "gemini", "claude", "deepseek"]
    .some((family) => id.includes(family));
  if (!supportedFamily) {
    return false;
  }

  const nonLanguageMarkers = [
    "image",
    "imagen",
    "banana",
    "embed",
    "embedding",
    "tts",
    "speech",
    "audio",
    "realtime",
    "transcribe",
    "whisper",
    "video",
    "veo",
    "sora",
    "dall-e",
    "dalle",
    "moderation",
    "rerank",
    "ocr"
  ];
  return !nonLanguageMarkers.some((marker) => id.includes(marker));
}

function extractPromptOptimizerText(json) {
  const content = json.choices?.[0]?.message?.content;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => typeof part === "string" ? part : part?.text || "")
      .join("\n");
  }
  return json.choices?.[0]?.text || "";
}

function buildPromptOptimizationRequest(sourcePrompt, settings) {
  const family = settings.selectedModel === "gpt"
    ? "GPT Image 图片编辑模型"
    : "Gemini / Nano Banana 原生图片编辑模型";
  const modelGuidance = settings.selectedModel === "gpt"
    ? "使用清晰、紧凑、命令式的编辑指令，强调局部编辑、像素级保留未编辑区域；将负面要求写成明确的“不要/不得”指令。"
    : "使用结构清楚且语义完整的自然语言，明确第一张图是场景图、第二张图是 Logo 参考图；将负面约束写成自然语言禁令，不依赖权重语法。";

  return `你是一名商业商品图像编辑提示词专家。请把用户原始提示词改写为可直接提交给图片编辑模型的最终提示词。

任务恒定背景：
- 第一张输入图是必须保留的商品/场景图。
- 第二张输入图是需要贴到指定物体表面的 Logo 参考图。
- 目标模型：${settings.model}
- 模型类型：${family}
- 输出比例：${settings.aspectRatio || settings.size || "模型默认"}
- ${modelGuidance}

最终提示词必须做到：
1. 准确说明 Logo 应贴到用户指定物体与区域；若原文没写清具体位置，不得擅自虚构，只能要求模型依据原始意图放置。
2. Logo 尺寸必须符合承载物真实比例，不能过大、过小、拉伸、压扁或裁切；完整保留 Logo 的文字、字形、图形、比例、颜色和结构，除非原文明确要求改变。
3. 根据物体曲面、平面、折角、褶皱和拍摄角度匹配透视、弧度、形变与遮挡关系。
4. 根据承载物材质模拟真实工艺，例如印刷、丝印、烫印、贴纸、刺绣或压印；材质不明确时使用最符合场景的真实贴合效果，不得让 Logo 漂浮。
5. 匹配原图光源方向、亮度、色温、高光、反射、粗糙度、纹理、阴影、景深、噪点和清晰度。
6. 严格保持场景图其余区域不变，包括构图、背景、主体形状、产品结构、颜色、材质、文字、人物、光影、相机视角和分辨率；只允许编辑 Logo 覆盖所必需的局部像素。
7. 添加“负面约束”部分，至少包含：不得新增或删除物体，不得改变背景与构图，不得重绘产品，不得修改现有文字，不得生成重复 Logo、水印、乱码、伪文字、边框、光晕、漂浮感、错误透视、错误阴影、明显贴图边缘、低清晰度或额外装饰。
8. 保留用户原始需求中的特殊要求，不要改变其意图。

只输出优化后的最终提示词，不要解释、不要评价、不要使用 Markdown 代码块，也不要添加“以下是”等前言。

用户原始提示词：
${sourcePrompt}

优化后的最终提示词：`;
}

function cleanOptimizedPrompt(value) {
  return String(value || "")
    .trim()
    .replace(/^```(?:text|markdown)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .replace(/^(?:优化后的最终提示词|最终提示词)\s*[:：]\s*/i, "")
    .trim();
}
function useQuickPrompt(id) {
  const item = state.quickPrompts.find((prompt) => prompt.id === id);
  if (!item) {
    return;
  }
  els.promptInput.value = item.prompt;
  closeQuickPromptMenu();
  setMessage(`已使用快捷提示词：${item.title}`, "ok");
}

function deleteQuickPrompt(id) {
  const item = state.quickPrompts.find((prompt) => prompt.id === id);
  if (!item) {
    return;
  }
  const confirmed = window.confirm(`删除快捷提示词“${item.title}”？`);
  if (!confirmed) {
    return;
  }
  state.quickPrompts = state.quickPrompts.filter((prompt) => prompt.id !== id);
  if (state.editingQuickPromptId === id) {
    closeQuickPromptEditor();
  }
  persistQuickPrompts();
  renderQuickPrompts();
  setMessage("快捷提示词已删除。", "ok");
}
async function filesToImages(fileList) {
  const files = [...fileList].filter((file) => file.type.startsWith("image/"));
  return Promise.all(files.map(readImageFile));
}

function readImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const dataUrl = String(reader.result);
      const commaIndex = dataUrl.indexOf(",");
      resolve({
        id: uid(),
        name: file.name,
        file,
        mimeType: file.type || "image/png",
        size: file.size,
        base64: dataUrl.slice(commaIndex + 1),
        dataUrl,
        objectUrl: URL.createObjectURL(file)
      });
    });
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsDataURL(file);
  });
}

function renderPairs() {
  const sceneCount = state.scenes.filter(Boolean).length;
  const logoCount = state.logos.filter(Boolean).length;
  els.sceneMeta.textContent = `${sceneCount} 张场景图`;
  els.logoMeta.textContent = `${logoCount} 张 logo 图`;
  els.pairGrid.replaceChildren();

  const pairCount = Math.max(state.scenes.length, state.logos.length);
  els.pairEmpty.classList.toggle("is-hidden", pairCount > 0);

  for (let index = 0; index < pairCount; index += 1) {
    const node = els.pairTemplate.content.firstElementChild.cloneNode(true);
    const scene = state.scenes[index];
    const logo = state.logos[index];
    node.querySelector(".pair-index").textContent = String(index + 1).padStart(2, "0");
    fillPreview(node.querySelector(".scene-preview"), node.querySelectorAll("figcaption")[0], scene, "缺少场景图");
    fillPreview(node.querySelector(".logo-preview"), node.querySelectorAll("figcaption")[1], logo, "缺少 logo 图");
    bindPairActions(node, index, scene, logo);
    els.pairGrid.append(node);
  }
}

function bindPairActions(node, index, scene, logo) {
  const sceneInput = node.querySelector(".replace-scene-input");
  const logoInput = node.querySelector(".replace-logo-input");
  const actionButtons = [...node.querySelectorAll("button")];
  actionButtons.forEach((button) => {
    button.disabled = state.isGenerating;
  });
  node.querySelector(".remove-scene-button").disabled = state.isGenerating || !scene;
  node.querySelector(".remove-logo-button").disabled = state.isGenerating || !logo;

  node.querySelector(".replace-scene-button").addEventListener("click", () => sceneInput.click());
  node.querySelector(".replace-logo-button").addEventListener("click", () => logoInput.click());
  sceneInput.addEventListener("change", (event) => replacePairImage("scenes", index, event.target.files));
  logoInput.addEventListener("change", (event) => replacePairImage("logos", index, event.target.files));
  node.querySelector(".remove-scene-button").addEventListener("click", () => removePairImage("scenes", index));
  node.querySelector(".remove-logo-button").addEventListener("click", () => removePairImage("logos", index));
  node.querySelector(".pair-delete-button").addEventListener("click", () => removePair(index));
}

async function addPairsFromFiles(event) {
  if (state.isGenerating) {
    event.target.value = "";
    return;
  }
  const images = await filesToImages(event.target.files);
  event.target.value = "";
  if (images.length === 0) {
    setMessage("请选择至少一张图片。", "error");
    return;
  }

  const startIndex = Math.max(state.scenes.length, state.logos.length);
  padPairArrays(startIndex);
  images.forEach((image) => {
    state.scenes.push(image);
    state.logos.push(null);
  });
  renderPairs();
  setMessage(`已新增 ${images.length} 组，请为新组补充 Logo 图。`, "ok");
}

async function replacePairImage(collectionName, index, fileList) {
  if (state.isGenerating) {
    return;
  }
  const [image] = await filesToImages(fileList);
  if (!image) {
    return;
  }
  padPairArrays(index + 1);
  revokeImage(state[collectionName][index]);
  state[collectionName][index] = image;
  renderPairs();
  setMessage(`第 ${index + 1} 组图片已更换。`, "ok");
}

function removePairImage(collectionName, index) {
  if (state.isGenerating || !state[collectionName][index]) {
    return;
  }
  revokeImage(state[collectionName][index]);
  state[collectionName][index] = null;
  renderPairs();
  setMessage(`第 ${index + 1} 组图片已删除。`, "ok");
}

function removePair(index) {
  if (state.isGenerating) {
    return;
  }
  revokeImage(state.scenes[index]);
  revokeImage(state.logos[index]);
  state.scenes.splice(index, 1);
  state.logos.splice(index, 1);
  renderPairs();
  setMessage(`第 ${index + 1} 组已删除。`, "ok");
}

function padPairArrays(length) {
  while (state.scenes.length < length) {
    state.scenes.push(null);
  }
  while (state.logos.length < length) {
    state.logos.push(null);
  }
}

function fillPreview(img, caption, item, fallback) {
  if (item) {
    img.src = item.objectUrl;
    img.alt = item.name;
    img.classList.remove("is-missing");
    caption.textContent = item.name;
    return;
  }
  img.removeAttribute("src");
  img.alt = fallback;
  caption.textContent = fallback;
  img.classList.add("is-missing");
}

function updateModelPanel() {
  const model = getSelectedModel();
  els.gptSettings.classList.toggle("is-hidden", model !== "gpt");
  els.bananaSettings.classList.toggle("is-hidden", model !== "banana");
  els.officialBananaSettings.classList.toggle("is-hidden", model !== "officialBanana");
  els.quickRouterKeyField.classList.remove("is-hidden");
  els.googleKeyField.classList.toggle("is-hidden", model !== "officialBanana");
  els.messageArea.textContent = model === "officialBanana"
    ? "Google Key 用于官方生图；QuickRouter Key 用于 AI 提示词优化。"
    : "Key 只会用于浏览器直接请求 QuickRouter。";
}

function applyViewMode(target) {
  const grid = target === "pairs" ? els.pairGrid : els.resultGrid;
  const mode = state.viewModes[target] || "medium";
  grid.classList.remove("view-large", "view-medium", "view-small", "view-list");
  grid.classList.add(`view-${mode}`);

  els.viewButtons
    .filter((button) => button.dataset.viewTarget === target)
    .forEach((button) => {
      button.classList.toggle("is-active", button.dataset.viewMode === mode);
    });
}

function restoreKey() {
  const savedKey = localStorage.getItem(STORAGE_KEY);
  if (savedKey) {
    els.apiKeyInput.value = savedKey;
    els.rememberKeyInput.checked = true;
  }
  const savedGoogleKey = localStorage.getItem(GOOGLE_STORAGE_KEY);
  if (savedGoogleKey) {
    els.googleApiKeyInput.value = savedGoogleKey;
    els.rememberKeyInput.checked = true;
  }
}

function persistKeyIfNeeded() {
  if (els.rememberKeyInput.checked) {
    localStorage.setItem(STORAGE_KEY, els.apiKeyInput.value.trim());
    localStorage.setItem(GOOGLE_STORAGE_KEY, els.googleApiKeyInput.value.trim());
  } else {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(GOOGLE_STORAGE_KEY);
  }
}

function clearStoredKey() {
  els.apiKeyInput.value = "";
  els.googleApiKeyInput.value = "";
  els.rememberKeyInput.checked = false;
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(GOOGLE_STORAGE_KEY);
  setMessage("Key 已清除。", "ok");
}

function getSelectedModel() {
  return document.querySelector("input[name='model']:checked").value;
}

function getSettings() {
  const selectedModel = getSelectedModel();
  const base = {
    selectedModel,
    prompt: els.promptInput.value.trim(),
    concurrency: clampNumber(els.concurrencyInput.value, 1, 8, 3)
  };

  if (selectedModel === "gpt") {
    return {
      ...base,
      model: els.gptModelInput.value.trim() || "gpt-image-2",
      count: clampNumber(els.gptCountInput.value, 1, 10, 1),
      size: els.gptSizeInput.value,
      quality: els.gptQualityInput.value,
      format: els.gptFormatInput.value
    };
  }

  if (selectedModel === "officialBanana") {
    return {
      ...base,
      model: els.officialBananaModelInput.value,
      count: clampNumber(els.officialBananaCountInput.value, 1, 10, 1),
      aspectRatio: els.officialBananaRatioInput.value,
      imageSize: els.officialBananaSizeInput.value
    };
  }

  return {
    ...base,
    model: els.bananaModelInput.value.trim() || "gemini-3-pro-image-preview",
    count: clampNumber(els.bananaCountInput.value, 1, 10, 1),
    aspectRatio: els.bananaRatioInput.value,
    imageSize: els.bananaSizeInput.value
  };
}

function clampNumber(value, min, max, fallback) {
  const count = Number.parseInt(value, 10);
  if (Number.isNaN(count)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, count));
}

function buildGptFormData(pair, settings) {
  const formData = new FormData();
  formData.append("model", settings.model);
  formData.append("prompt", settings.prompt);
  formData.append("n", String(settings.count));
  formData.append("size", settings.size);
  formData.append("quality", settings.quality);
  formData.append("format", settings.format);
  formData.append("image", pair.scene.file, pair.scene.name);
  formData.append("image", pair.logo.file, pair.logo.name);
  return formData;
}

function validateGeneration(key, settings) {
  if (!key) {
    return settings.selectedModel === "officialBanana"
      ? "请输入 Google Gemini API Key。"
      : "请输入 QuickRouter API Key。";
  }
  if (!settings.prompt) {
    return "请输入提示词。";
  }
  const pairCount = Math.max(state.scenes.length, state.logos.length);
  const sceneCount = state.scenes.filter(Boolean).length;
  const logoCount = state.logos.filter(Boolean).length;
  if (pairCount === 0 || sceneCount === 0) {
    return "请至少上传 1 张场景图。";
  }
  const incompleteIndex = Array.from({ length: pairCount }, (_, index) => index)
    .find((index) => !state.scenes[index] || !state.logos[index]);
  if (incompleteIndex !== undefined) {
    return `第 ${incompleteIndex + 1} 组缺少场景图或 logo 图，请补充或删除该组。当前共 ${sceneCount} 张场景图、${logoCount} 张 logo 图。`;
  }
  if (settings.selectedModel === "gpt") {
    const oversized = [...state.scenes, ...state.logos].find((image) => image?.size > GPT_IMAGE_LIMIT_BYTES);
    if (oversized) {
      return `GPT 单张输入图需小于 25MB：${oversized.name} 当前 ${formatBytes(oversized.size)}。`;
    }
  }
  if (settings.selectedModel === "officialBanana") {
    if (settings.model === "gemini-3.1-flash-lite-image" && !["", "1K"].includes(settings.imageSize)) {
      return "Nano Banana 2 Lite 仅支持 1K 清晰度，请选择“模型默认”或“1K”。";
    }
    if (settings.imageSize === "512" && settings.model !== "gemini-3.1-flash-image") {
      return "512（0.5K）清晰度目前仅支持 Nano Banana 2。";
    }
  }
  return "";
}

async function generateBatch() {
  if (state.isGenerating) {
    return;
  }

  const settings = getSettings();
  const key = getApiKey(settings.selectedModel);
  const validationError = validateGeneration(key, settings);
  if (validationError) {
    setMessage(validationError, "error");
    return;
  }

  persistKeyIfNeeded();
  state.isGenerating = true;
  state.abortController = new AbortController();
  setControlsBusy(true);
  setMessage("正在生成，请保持页面打开。", "warn");

  const pairCount = Math.max(state.scenes.length, state.logos.length);
  const pairs = Array.from({ length: pairCount }, (_, index) => ({
    index,
    scene: state.scenes[index],
    logo: state.logos[index]
  }));
  const adapter = modelRegistry[settings.selectedModel];
  const jobs = pairs.flatMap((pair) => adapter.buildJobs(pair, settings));
  const totalExpected = pairs.length * settings.count;
  let completed = 0;
  let failed = 0;

  addPendingResults(jobs, settings.selectedModel);
  updateQueueStatus(completed, totalExpected);

  try {
    await runConcurrent(jobs, settings.concurrency, async (job) => {
      if (state.abortController.signal.aborted) {
        throw new DOMException("已停止当前批次", "AbortError");
      }

      markJobPending(job);
      try {
        const generated = await adapter.execute(job, key, state.abortController.signal);
        replacePendingWithGenerated(job, generated, settings.selectedModel);
        completed += generated.length;
      } catch (error) {
        if (error.name === "AbortError") {
          throw error;
        }
        markJobFailed(job, error);
        failed += job.expectedCount || 1;
      } finally {
        updateQueueStatus(Math.min(completed + failed, totalExpected), totalExpected);
      }
    });

    if (failed > 0) {
      setMessage(`生成结束：成功 ${completed} 张，失败 ${failed} 张，可点击失败项重试。`, "warn");
    } else {
      setMessage(`生成完成，共得到 ${completed} 张图片。`, "ok");
    }
  } catch (error) {
    if (error.name === "AbortError") {
      setMessage("已停止当前批次。", "warn");
    } else {
      markActiveJobFailed(error);
      setMessage(error.message || "生成失败，请检查 Key、模型参数或浏览器 CORS 限制。", "error");
    }
  } finally {
    state.isGenerating = false;
    state.abortController = null;
    setControlsBusy(false);
    renderResults();
  }
}

function getApiKey(selectedModel) {
  return selectedModel === "officialBanana"
    ? els.googleApiKeyInput.value.trim()
    : els.apiKeyInput.value.trim();
}

function addPendingResults(jobs, selectedModel) {
  const pending = jobs.flatMap((job) => {
    const count = job.expectedCount || 1;
    return Array.from({ length: count }, (_, index) => ({
      id: `${job.pairIndex}-${job.variationIndex}-${index}-${Date.now()}-${Math.random()}`,
      jobKey: getJobKey(job),
      job,
      selectedModel,
      pairIndex: job.pairIndex,
      variationIndex: selectedModel === "gpt" ? index + 1 : job.variationIndex,
      model: job.model,
      blob: null,
      url: "",
      filename: buildFilename(job.pairIndex, selectedModel === "gpt" ? index + 1 : job.variationIndex, job.model, "png"),
      selected: false,
      status: "pending",
      error: ""
    }));
  });
  state.results = [...pending, ...state.results];
  renderResults();
}

function markJobPending(job) {
  state.results = state.results.map((result) => {
    if (result.jobKey !== getJobKey(job) || result.status !== "pending") {
      return result;
    }
    return { ...result, status: "active" };
  });
  renderResults();
}

function replacePendingWithGenerated(job, generated, selectedModel) {
  const pendingIndexes = state.results
    .map((result, index) => ({ result, index }))
    .filter(({ result }) => result.jobKey === getJobKey(job) && (result.status === "active" || result.status === "pending"))
    .map(({ index }) => index);

  generated.forEach((item, index) => {
    const targetIndex = pendingIndexes[index];
    if (targetIndex === undefined) {
      state.results.unshift(item);
      return;
    }
    state.results[targetIndex] = {
      ...state.results[targetIndex],
      ...item,
      selected: true,
      status: "done",
      filename: item.filename || buildFilename(job.pairIndex, selectedModel === "gpt" ? index + 1 : job.variationIndex, job.model, "png")
    };
  });

  pendingIndexes.slice(generated.length).forEach((index) => {
    state.results[index] = {
      ...state.results[index],
      status: "failed",
      error: "接口没有返回图片。"
    };
  });

  renderResults();
}

function markJobFailed(job, error) {
  state.results = state.results.map((result) => {
    if (result.jobKey !== getJobKey(job) || (result.status !== "active" && result.status !== "pending")) {
      return result;
    }
    return {
      ...result,
      status: "failed",
      error: error.message || "生成失败"
    };
  });
  renderResults();
}

function markActiveJobFailed(error) {
  state.results = state.results.map((result) => {
    if (result.status !== "active") {
      return result;
    }
    return {
      ...result,
      status: "failed",
      error: error.message || "生成失败"
    };
  });
}

async function runConcurrent(items, limit, worker) {
  let nextIndex = 0;
  const workerCount = Math.min(limit, items.length);
  const runners = Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      await worker(items[currentIndex]);
    }
  });
  await Promise.all(runners);
}

async function parseJsonResponse(response) {
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }

  if (!response.ok) {
    const message = json.error?.message || json.message || response.statusText || "请求失败";
    throw new Error(`${response.status} ${message}`);
  }

  return json;
}

async function safeFetch(url, options) {
  try {
    return await fetch(url, options);
  } catch (error) {
    if (error.name === "AbortError") {
      throw error;
    }
    const originHint = location.protocol === "file:"
      ? "当前是 file:// 打开，浏览器会发送 null origin，部分接口会因此拒绝 CORS 预检；请改用静态托管或本地静态预览打开同一个 index.html。"
      : `当前页面来源是 ${location.origin}，请确认所选接口允许该来源跨域请求。`;
    throw new Error(`浏览器没有拿到接口响应：${error.message || "Failed to fetch"}。常见原因是 CORS 预检失败、网络不可达、浏览器插件拦截，或输入图片过大导致连接被断开。${originHint}`);
  }
}

function normalizeGptResults(json, job) {
  const items = Array.isArray(json.data) ? json.data : [];
  return items
    .map((item, index) => {
      const variationIndex = job.expectedCount === 1 ? job.variationIndex : index + 1;
      if (item.b64_json) {
        const format = getFormValue(job.request, "format") || "png";
        return resultFromBase64(item.b64_json, `image/${format === "jpg" ? "jpeg" : format}`, job, variationIndex, format);
      }
      if (item.url) {
        return resultFromRemoteUrl(item.url, job, variationIndex);
      }
      return null;
    })
    .filter(Boolean);
}

function normalizeBananaResults(json, job) {
  const parts = json.candidates?.flatMap((candidate) => candidate.content?.parts || []) || [];
  return parts
    .map((part, index) => {
      const inlineData = part.inlineData || part.inline_data;
      if (!inlineData?.data) {
        return null;
      }
      const mimeType = inlineData.mimeType || inlineData.mime_type || "image/png";
      return resultFromBase64(inlineData.data, mimeType, job, job.variationIndex || index + 1, mimeTypeToExt(mimeType));
    })
    .filter(Boolean);
}

function normalizeOfficialBananaResults(json, job) {
  const outputImages = (json.steps || [])
    .filter((step) => step.type === "model_output")
    .flatMap((step) => step.content || [])
    .filter((content) => content.type === "image" && content.data);

  return outputImages.map((image, index) => {
    const mimeType = image.mime_type || "image/png";
    return resultFromBase64(
      image.data,
      mimeType,
      job,
      job.variationIndex || index + 1,
      mimeTypeToExt(mimeType)
    );
  });
}

function resultFromBase64(base64, mimeType, job, variationIndex, ext) {
  const blob = base64ToBlob(base64, mimeType);
  const url = URL.createObjectURL(blob);
  return {
    id: uid(),
    jobKey: getJobKey(job),
    pairIndex: job.pairIndex,
    variationIndex,
    model: job.model,
    blob,
    url,
    filename: buildFilename(job.pairIndex, variationIndex, job.model, ext),
    selected: true,
    status: "done",
    error: ""
  };
}

function resultFromRemoteUrl(url, job, variationIndex) {
  return {
    id: uid(),
    jobKey: getJobKey(job),
    pairIndex: job.pairIndex,
    variationIndex,
    model: job.model,
    blob: null,
    url,
    filename: buildFilename(job.pairIndex, variationIndex, job.model, "png"),
    selected: true,
    status: "done",
    error: ""
  };
}

function base64ToBlob(base64, mimeType) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeType });
}

function getJobKey(job) {
  return `${job.pairIndex}:${job.variationIndex}:${job.model}`;
}

function buildFilename(pairIndex, variationIndex, model, ext) {
  const safeModel = model.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-|-$/g, "");
  return `pair-${String(pairIndex + 1).padStart(2, "0")}-v${String(variationIndex).padStart(2, "0")}-${safeModel}.${ext}`;
}

function mimeTypeToExt(mimeType) {
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) {
    return "jpg";
  }
  if (mimeType.includes("webp")) {
    return "webp";
  }
  return "png";
}

function getFormValue(formData, key) {
  if (formData instanceof FormData) {
    const value = formData.get(key);
    return typeof value === "string" ? value : "";
  }
  return formData?.[key] || "";
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) {
    return `${Math.ceil(bytes / 1024)}KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function renderResults() {
  els.resultGrid.replaceChildren();
  els.resultEmpty.classList.toggle("is-hidden", state.results.length > 0);

  groupResultsByPair(state.results).forEach((group) => {
    els.resultGrid.append(renderResultGroup(group));
  });

  updateResultControls();
}

function groupResultsByPair(results) {
  const groups = new Map();
  results.forEach((result) => {
    if (!groups.has(result.pairIndex)) {
      groups.set(result.pairIndex, {
        pairIndex: result.pairIndex,
        results: []
      });
    }
    groups.get(result.pairIndex).results.push(result);
  });

  return [...groups.values()]
    .sort((a, b) => a.pairIndex - b.pairIndex)
    .map((group) => ({
      ...group,
      results: group.results.sort((a, b) => a.variationIndex - b.variationIndex)
    }));
}

function renderResultGroup(group) {
  const doneCount = group.results.filter((result) => result.status === "done").length;
  const failedCount = group.results.filter((result) => result.status === "failed").length;
  const selectedCount = group.results.filter((result) => result.status === "done" && result.selected).length;
  const node = document.createElement("article");
  node.className = "result-group";

  const head = document.createElement("header");
  head.className = "result-group-head";
  head.innerHTML = `
    <div>
      <h3>第 ${group.pairIndex + 1} 组</h3>
      <p>${doneCount} 张完成，${selectedCount} 张已选${failedCount ? `，${failedCount} 张失败` : ""}</p>
    </div>
  `;

  const items = document.createElement("div");
  items.className = "result-group-items";
  if (group.results.length > 1) {
    items.append(renderResultStack(group));
  } else {
    group.results.forEach((result) => {
      items.append(renderResultCard(result));
    });
  }

  node.append(head, items);
  return node;
}

function renderResultStack(group) {
  const cover = group.results.find((result) => result.status === "done") || group.results[0];
  const stack = document.createElement("div");
  stack.className = "result-stack is-stacked";
  stack.addEventListener("click", (event) => {
    if (event.target.closest("button, input, label, a")) {
      return;
    }
    openResultGallery(group);
  });

  const card = renderResultCard(cover, {
    imageTitle: "点击查看本组全部图片",
    onImageClick: () => openResultGallery(group)
  });
  card.classList.add("result-stack-cover");

  const openButton = document.createElement("button");
  openButton.className = "result-stack-open";
  openButton.type = "button";
  openButton.textContent = `查看全部 ${group.results.length} 张`;
  openButton.addEventListener("click", () => openResultGallery(group));

  stack.append(card, openButton);
  return stack;
}

function renderResultCard(result, options = {}) {
  const node = els.resultTemplate.content.firstElementChild.cloneNode(true);
  node.classList.toggle("is-pending", result.status === "pending" || result.status === "active");
  node.classList.toggle("is-failed", result.status === "failed");

  const checkbox = node.querySelector(".result-select input");
  const label = node.querySelector(".result-select span");
  const media = node.querySelector(".result-media");
  const title = node.querySelector("strong");
  const meta = node.querySelector("small");
  const button = node.querySelector(".result-footer button");

  checkbox.checked = result.selected;
  checkbox.disabled = result.status !== "done";
  checkbox.addEventListener("change", () => {
    result.selected = checkbox.checked;
    renderResults();
  });

  label.textContent = statusLabel(result.status);
  title.textContent = `变体 ${result.variationIndex}`;
  meta.textContent = result.status === "failed" ? result.error : result.filename;

  if (result.status === "done") {
    const img = document.createElement("img");
    img.src = result.url;
    img.alt = result.filename;
    img.title = options.imageTitle || "点击查看大图";
    img.addEventListener("click", () => {
      if (options.onImageClick) {
        options.onImageClick(result);
      } else {
        openPreview(result);
      }
    });
    media.append(img);
    button.textContent = "下载";
    button.disabled = false;
    button.addEventListener("click", () => downloadResult(result));
  } else if (result.status === "failed") {
    media.append(createInlineRetry(result));
    button.textContent = "重试";
    button.disabled = state.isGenerating || !result.job;
    button.addEventListener("click", () => retryResult(result));
  } else {
    media.textContent = result.status === "active" ? "生成中" : "等待生成";
    button.textContent = "下载";
    button.disabled = true;
  }

  return node;
}

function createInlineRetry(result) {
  const wrap = document.createElement("div");
  wrap.className = "failed-retry";

  const text = document.createElement("p");
  text.textContent = result.error || "生成失败";

  const retryButton = document.createElement("button");
  retryButton.type = "button";
  retryButton.textContent = "重试";
  retryButton.disabled = state.isGenerating || !result.job;
  retryButton.addEventListener("click", () => retryResult(result));

  wrap.append(text, retryButton);
  return wrap;
}

function getResultGalleryModal() {
  let modal = document.querySelector("#resultGalleryModal");
  if (modal) {
    return modal;
  }

  modal = document.createElement("div");
  modal.id = "resultGalleryModal";
  modal.className = "result-gallery-modal is-hidden";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-label", "查看本组全部图片");
  modal.innerHTML = `
    <div class="result-gallery-backdrop" data-result-gallery-close></div>
    <div class="result-gallery-dialog">
      <header class="result-gallery-head">
        <div>
          <strong id="resultGalleryTitle">本组图片</strong>
          <small id="resultGalleryMeta"></small>
        </div>
        <button type="button" data-result-gallery-close>关闭</button>
      </header>
      <div class="result-gallery-grid" id="resultGalleryGrid"></div>
    </div>
  `;
  modal.addEventListener("click", (event) => {
    if (event.target.matches("[data-result-gallery-close]")) {
      closeResultGallery();
    }
  });
  document.body.append(modal);
  return modal;
}

function openResultGallery(group) {
  const modal = getResultGalleryModal();
  const title = modal.querySelector("#resultGalleryTitle");
  const meta = modal.querySelector("#resultGalleryMeta");
  const grid = modal.querySelector("#resultGalleryGrid");
  const doneCount = group.results.filter((result) => result.status === "done").length;
  const failedCount = group.results.filter((result) => result.status === "failed").length;

  title.textContent = `第 ${group.pairIndex + 1} 组`;
  meta.textContent = `${group.results.length} 张结果，${doneCount} 张完成${failedCount ? `，${failedCount} 张失败` : ""}`;
  grid.replaceChildren();
  group.results.forEach((result) => {
    grid.append(renderResultCard(result));
  });

  modal.classList.remove("is-hidden");
  document.body.classList.add("has-modal");
}

function closeResultGallery() {
  const modal = document.querySelector("#resultGalleryModal");
  if (!modal) {
    return;
  }
  modal.classList.add("is-hidden");
  if (els.previewModal.classList.contains("is-hidden")) {
    document.body.classList.remove("has-modal");
  }
}

function isResultGalleryOpen() {
  const modal = document.querySelector("#resultGalleryModal");
  return Boolean(modal && !modal.classList.contains("is-hidden"));
}

function openPreview(result) {
  els.previewImage.src = result.url;
  els.previewImage.alt = result.filename;
  els.previewTitle.textContent = `第 ${result.pairIndex + 1} 组 · 变体 ${result.variationIndex}`;
  els.previewMeta.textContent = result.filename;
  els.previewModal.classList.remove("is-hidden");
  document.body.classList.add("has-modal");
}

function closePreview() {
  els.previewModal.classList.add("is-hidden");
  els.previewImage.removeAttribute("src");
  els.previewImage.alt = "";
  if (!isResultGalleryOpen()) {
    document.body.classList.remove("has-modal");
  }
}

function statusLabel(status) {
  if (status === "done") {
    return "已生成";
  }
  if (status === "active") {
    return "生成中";
  }
  if (status === "failed") {
    return "失败";
  }
  return "排队中";
}

function updateResultControls() {
  const doneResults = state.results.filter((result) => result.status === "done");
  const selectedCount = doneResults.filter((result) => result.selected).length;
  const failedCount = state.results.filter((result) => result.status === "failed").length;
  els.downloadSelectedButton.disabled = selectedCount === 0;
  els.clearResultsButton.disabled = state.results.length === 0 || state.isGenerating;
  els.selectAllResults.disabled = doneResults.length === 0;
  els.selectAllResults.checked = doneResults.length > 0 && selectedCount === doneResults.length;
  els.selectAllResults.indeterminate = selectedCount > 0 && selectedCount < doneResults.length;
  els.resultSummary.textContent = `已生成 ${doneResults.length} 张，已选择 ${selectedCount} 张${failedCount ? `，失败 ${failedCount} 张` : ""}`;
}

function toggleAllResults() {
  const checked = els.selectAllResults.checked;
  state.results.forEach((result) => {
    if (result.status === "done") {
      result.selected = checked;
    }
  });
  renderResults();
}

async function retryResult(result) {
  if (state.isGenerating || !result.job) {
    return;
  }

  const key = getApiKey(result.selectedModel);
  if (!key) {
    setMessage(result.selectedModel === "officialBanana"
      ? "请输入 Google Gemini API Key 后再重试。"
      : "请输入 QuickRouter API Key 后再重试。", "error");
    return;
  }

  const adapter = modelRegistry[result.selectedModel];
  const retryJob = buildRetryJob(result);
  state.isGenerating = true;
  state.abortController = new AbortController();
  result.status = "active";
  result.error = "";
  setControlsBusy(true);
  result.jobKey = getJobKey(retryJob);
  renderResults();
  setMessage("正在重试当前结果。", "warn");

  try {
    result.job = retryJob;
    const generated = await adapter.execute(retryJob, key, state.abortController.signal);
    replacePendingWithGenerated(retryJob, generated.slice(0, 1), result.selectedModel);
    setMessage("重试完成。", "ok");
  } catch (error) {
    result.status = "failed";
    result.error = error.message || "重试失败";
    setMessage(result.error, "error");
  } finally {
    state.isGenerating = false;
    state.abortController = null;
    setControlsBusy(false);
    renderResults();
  }
}

function buildRetryJob(result) {
  const retryJob = {
    ...result.job,
    variationIndex: result.variationIndex,
    expectedCount: 1
  };

  if (result.selectedModel === "gpt") {
    retryJob.request = cloneGptFormDataForSingleResult(result.job.request);
  }

  return retryJob;
}

function cloneGptFormDataForSingleResult(source) {
  const formData = new FormData();
  for (const [key, value] of source.entries()) {
    if (key === "n") {
      formData.append("n", "1");
    } else {
      formData.append(key, value);
    }
  }
  return formData;
}

async function downloadResult(result) {
  const blob = result.blob || await fetchRemoteBlob(result.url);
  downloadBlob(blob, result.filename);
}

async function downloadSelectedZip() {
  const selected = state.results.filter((result) => result.status === "done" && result.selected);
  if (selected.length === 0) {
    setMessage("请先选择要下载的图片。", "error");
    return;
  }

  setMessage("正在打包 ZIP。", "warn");
  try {
    const files = [];
    for (const result of selected) {
      files.push({
        name: result.filename,
        blob: result.blob || await fetchRemoteBlob(result.url)
      });
    }
    const zipBlob = await createZip(files);
    downloadBlob(zipBlob, `quickrouter-results-${timestamp()}.zip`);
    setMessage(`已打包 ${selected.length} 张图片。`, "ok");
  } catch (error) {
    setMessage(error.message || "ZIP 打包失败。", "error");
  }
}

async function fetchRemoteBlob(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`下载远程图片失败：${response.status}`);
  }
  return response.blob();
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function createZip(files) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of files) {
    const bytes = new Uint8Array(await file.blob.arrayBuffer());
    const nameBytes = encoder.encode(file.name);
    const crc = crc32(bytes);
    const localHeader = zipLocalHeader(nameBytes, crc, bytes.length);
    const centralHeader = zipCentralHeader(nameBytes, crc, bytes.length, offset);
    localParts.push(localHeader, bytes);
    centralParts.push(centralHeader);
    offset += localHeader.length + bytes.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const endRecord = zipEndRecord(files.length, centralSize, offset);
  return new Blob([...localParts, ...centralParts, endRecord], { type: "application/zip" });
}

function zipLocalHeader(nameBytes, crc, size) {
  const header = new Uint8Array(30 + nameBytes.length);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 0x0800, true);
  view.setUint16(8, 0, true);
  view.setUint16(10, 0, true);
  view.setUint16(12, 0, true);
  view.setUint32(14, crc, true);
  view.setUint32(18, size, true);
  view.setUint32(22, size, true);
  view.setUint16(26, nameBytes.length, true);
  view.setUint16(28, 0, true);
  header.set(nameBytes, 30);
  return header;
}

function zipCentralHeader(nameBytes, crc, size, offset) {
  const header = new Uint8Array(46 + nameBytes.length);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint16(8, 0x0800, true);
  view.setUint16(10, 0, true);
  view.setUint16(12, 0, true);
  view.setUint16(14, 0, true);
  view.setUint32(16, crc, true);
  view.setUint32(20, size, true);
  view.setUint32(24, size, true);
  view.setUint16(28, nameBytes.length, true);
  view.setUint16(30, 0, true);
  view.setUint16(32, 0, true);
  view.setUint16(34, 0, true);
  view.setUint16(36, 0, true);
  view.setUint32(38, 0, true);
  view.setUint32(42, offset, true);
  header.set(nameBytes, 46);
  return header;
}

function zipEndRecord(fileCount, centralSize, centralOffset) {
  const record = new Uint8Array(22);
  const view = new DataView(record.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(4, 0, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, fileCount, true);
  view.setUint16(10, fileCount, true);
  view.setUint32(12, centralSize, true);
  view.setUint32(16, centralOffset, true);
  view.setUint16(20, 0, true);
  return record;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function cancelBatch() {
  if (state.abortController) {
    state.abortController.abort();
  }
}

function clearResults() {
  state.results.forEach((result) => {
    if (result.blob && result.url) {
      URL.revokeObjectURL(result.url);
    }
  });
  state.results = [];
  renderResults();
  setMessage("结果已清空。", "ok");
  updateQueueStatus(0, 0);
}

function revokeImages(images) {
  images.forEach(revokeImage);
}

function revokeImage(image) {
  if (image?.objectUrl) {
    URL.revokeObjectURL(image.objectUrl);
  }
}

function setControlsBusy(isBusy) {
  els.generateButton.disabled = isBusy;
  els.cancelButton.disabled = !isBusy;
  els.clearResultsButton.disabled = isBusy || state.results.length === 0;
  els.addPairButton.disabled = isBusy;
  els.clearImagesButton.disabled = isBusy;
  els.pairGrid.querySelectorAll("button, input[type='file']").forEach((control) => {
    control.disabled = isBusy;
  });
  if (!isBusy) {
    renderPairs();
  }
}

function updateQueueStatus(done, total) {
  els.queueStatus.textContent = total > 0 ? `${done}/${total}` : "未开始";
}

function setMessage(message, type) {
  els.messageArea.textContent = message;
  els.messageArea.classList.remove("is-error", "is-warn", "is-ok");
  if (type) {
    els.messageArea.classList.add(`is-${type}`);
  }
}

function timestamp() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function uid() {
  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
