# AI Canvas

AI Canvas 是面向图片、说明与局部视觉任务的桌面画布，支持多文档标签、图片与说明关联、快速标注和文件夹组织。

**AI Canvas 1.0.6 · cue-lae · GPL-3.0-only。**

## 下载

[下载 AI Canvas 1.0.6（Windows x64）](https://github.com/cue-lae/ai-canvas-public/releases/download/v1.0.6/AI-Canvas-1.0.6-Windows-x64.zip) · [版本说明及源码](https://github.com/cue-lae/ai-canvas-public/releases/tag/v1.0.6)

Windows ZIP 包含安装器、许可与第三方声明、对应源码 ZIP。安装由用户操作；请先保存并关闭画布，按安装程序的安全检查继续。旧版本在 [Releases](https://github.com/cue-lae/ai-canvas-public/releases) 保留。

## 1.0.6 更新

- 椭圆选区支持 Shift 正圆约束，包含新建和锚点调整。
- 文件夹预览中的选区、编号和快速标注跟随图片展开、收起。
- 图片专注模式下可直接使用选区工具。
- 编号保持可点击，重叠选区选中时临时置顶，取消后恢复原顺序。
- 正式构建不再注册开发测试接口或渲染旧隐藏测试面板。
- 保持已有图标、项目格式及日常工作流程；发布验证见本版 Release 与下载包内的 RELEASE-VERIFICATION.json。

## 1.0.5 更新

- 应用图标：炭黑背景、暖白 AC。
- 项目文件图标：暖白纸面、炭黑 AC／边框／CANVAS 文字，保留纸张形状和排列。
- 启动动画：透明背景、纯黑 AC，保留动画尺寸和时序。
- 本轮没有新增画布功能或修改项目数据格式。

## 使用与开发

支持保存、另存为、重命名、多标签及窗口拆合；图片、选区、标注与说明可组织到 Folder。Codex Read 为主动交接，MCP／插件可选，普通画布不依赖它。详细步骤见 [使用说明](docs/USAGE.md)，源码构建见 [构建说明](docs/BUILD.md)，本轮边界见 [验证记录](docs/VERIFICATION.md)。

前端为 React／TypeScript，Canvas 固定使用 Excalidraw 0.18.1；Windows 宿主为 WPF／WebView2，安装器为 Inno Setup 引擎及 WPF 外壳。桌面目标为 Windows x64，依赖 WebView2 Evergreen Runtime。

## 许可与反馈

项目自有代码与资产采用 [GPL-3.0-only](LICENSE)，公开署名与范围见 [NOTICE](NOTICE)、[许可说明](docs/LICENSE_DECISION.md) 和 [第三方声明](THIRD_PARTY_NOTICES.md)。第三方材料保留原许可。

[提交问题](https://github.com/cue-lae/ai-canvas-public/issues)时请提供版本、操作步骤和可公开截图，移除个人内容与凭据。本仓库不包含内部 Git 历史、治理记录、个人画布或本机凭据。

SOURCE_MANIFEST.json 记录对应源码 ZIP 的文件摘要（自身除外）；正式下载以 Release 附件及 SHA256SUMS.txt 为准。
