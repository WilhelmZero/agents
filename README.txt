
```md
# 多通道批量商品场景生图工具文档

## 项目简介

这是一个纯静态批量生图网页工具，不依赖后端服务器。支持 QuickRouter 中转站与 Google Gemini 官方通道；用户上传多张商品场景图和相同数量的 logo 图，系统按下标一一配对，并使用同一段提示词批量生成图片。

生成逻辑：

```text
场景图[0] + logo图[0] + 提示词 -> 生成 n 张
场景图[1] + logo图[1] + 提示词 -> 生成 n 张
```

最终数量：

```text
场景图数量 * 每组生成张数
```

## 文件结构

```text
index.html   页面结构
styles.css   页面样式
app.js       前端交互、模型请求、本地缓存、ZIP 下载逻辑
```

## 核心功能

- 纯静态运行，无后端依赖。
- 支持 QuickRouter 与 Google Gemini API Key 输入、记住和清除。
- 支持多张场景图、多张 logo 图上传，并按下标配对。
- 配对画布支持单独更换或删除场景图、Logo 图，以及删除整组。
- “新增一组”支持多选场景图；选择多张时会自动创建对应数量的新组，再逐组补充 Logo。
- 支持中转站 GPT、Banana，以及官方通道 Nano Banana 系列模型。
- 支持每组生成多张图。
- 支持并发请求。
- 支持失败结果重试。
- 结果按组展示，方便对比同一组多张变体。
- 支持点击图片查看大图。
- 支持单张下载和批量 ZIP 下载。
- 支持快速提示词 CRUD，并缓存在 localStorage。
- 支持通过 QuickRouter Completions API，根据当前图片模型自动优化贴 Logo 提示词，并补充尺寸、材质、透视、光影、局部保留和负面约束。

## 模型说明

### 中转站：GPT

接口：

```text
POST https://api.quickrouter.ai/v1/images/edits
```

请求格式：

```text
multipart/form-data
```

可选模型：

```text
gpt-image-2
gpt-image-1.5
gpt-image-1
```

### 中转站：Banana

接口：

```text
POST https://api.quickrouter.ai/v1beta/models/{model}:generateContent
```

请求格式：

```text
application/json
```

可选模型：

```text
gemini-3-pro-image-preview
gemini-2.5-flash-image
```

### 官方通道：Nano Banana

接口：

```text
POST https://generativelanguage.googleapis.com/v1beta/interactions
```

使用 `x-goog-api-key` 请求头，支持选择 Nano Banana 2 Lite、Nano Banana 2、Nano Banana Pro 和旧版 Nano Banana，并可配置生成张数、宽高比与清晰度。

### AI 提示词优化

接口：

```text
GET  https://api.quickrouter.ai/v1/models
POST https://api.quickrouter.ai/v1/chat/completions
```

点击“✨ 优化提示词”后通过弹窗选择聊天模型。应用使用 QuickRouter API Key 动态读取当前令牌支持的模型，并仅保留 GPT、Gemini、Claude、DeepSeek 四个系列的语言模型，排除图片、Embedding、TTS、音频、视频、OCR 等非语言模型。用户的选择会保存在本地；优化结果从聊天完成对象的 `choices[0].message.content` 读取。

## 快速提示词

快速提示词包含：

```text
标题
提示词
```

支持：

- 新增
- 点击使用
- 编辑
- 删除
- 本地缓存

缓存键：

```text
localStorage["quickrouter-quick-prompts"]
```

## 本地缓存

```text
quickrouter-image-key       QuickRouter API Key
google-gemini-image-key     Google Gemini API Key
quickrouter-quick-prompts   快速提示词列表
```

## 常见问题

### Failed to fetch

常见原因：

- CORS 预检失败
- 使用 file:// 直接打开页面
- 网络不可达
- 浏览器插件拦截
- 图片过大导致连接中断

建议使用静态托管或本地静态预览方式访问页面。

### Content-Type isn't multipart/form-data

GPT 图片编辑接口必须使用 multipart/form-data。项目中 GPT 请求应使用 FormData，并且不要手动设置 Content-Type。

## 推荐提示词示例

```text
请将第二张图片中的 logo 自然贴到第一张场景图里的杯子正面中央。

要求：
1. logo 必须完整清晰可见，不要改字母、图形、颜色和比例。
2. 根据杯子的弧面、角度和透视进行贴合，像真实印刷或贴纸一样贴在杯子表面。
3. 保留原场景图的构图、光线、阴影、背景和杯子材质。
4. 不要新增其他文字、图案、产品或装饰。
```
```
