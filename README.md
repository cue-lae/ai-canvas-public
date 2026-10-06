# AI Canvas

AI Canvas 是面向图片、说明与局部视觉任务的桌面画布。图片、选区、快速标注和说明可以一起组织到文件夹中，通过多个标签处理不同项目，并主动将当前工作交接给 Codex。

**AI Canvas 1.0.4 · 公开署名 cue-lae · GPL-3.0-only。** 项目自有代码与自有资产许可见 LICENSE/NOTICE。 第三方材料仍按各自许可使用。当前安装包仅携带 Assistant 字体文件；Liberation 保留底座的上游加载路径。依赖存在不等于随包分发。未来离线携带或嵌入字体输出需按实际情况另行核对，不能宣称所有授权情形都已经完备。

## 使用

- 桌面目标为 Windows x64，依赖 Microsoft Edge WebView2 Evergreen Runtime。
- 可将图片导入画布，使用选区和快速标注指出需要处理的位置，用说明卡补充要求，并用 Folder 整理内容。
- 标签支持保存、另存为、重命名、关闭，以及拆分窗口和合并。
- 复制图片时保留其选区和快速标注；复制完整 Folder 时保留内部内容。带关联的说明卡需要一并选择关联内容，以免遗漏关系。
- Canvas 中的内容不会因普通编辑自动交给 Codex；通过 Codex Read 主动交接。MCP/插件是可选能力，普通画布使用不依赖它。

详细步骤见 [使用说明](docs/USAGE.md)，开发和安装包构建见 [构建说明](docs/BUILD.md)。

## 技术与源码

React 18.3.1、TypeScript 5.7.3、Vite 6.1.0；画布底座固定为 Excalidraw 0.18.1。桌面宿主使用 WPF 与 WebView2。安装器由 Inno Setup 引擎及 WPF 外壳组成。

目录包含前端、Windows 宿主、桥接/MCP、插件、安装器和必要测试；不包含个人画布、内部讨论和治理记录、内部 Git 历史、已安装环境、工具缓存或依赖目录。

当前已验收版本的运行功能源码保持原字节。本修订正式更新五个测试文件和相应校验记录，保持原 548 项用例；候选另调整公开构建入口、资源位置及说明；构建校验清单用于识别冻结版本，修改功能后需要重新验证并显式更新该清单。

## 验证与限制

r2源码已在独立虚拟机目录中，使用重新下载的准确版本工具和依赖完成构建；349个包下载、复用0，类型检查与548项测试通过，完整安装包构建及977个载荷文件校验通过。本许可修订仅更改文档和元数据，运行源码保持。详情见 [验证记录](docs/VERIFICATION.md)。

用户已反馈本次从源码重建的1.0.4“正常安装并保持原有体验”。这是已有Windows环境中的用户安装体验，不能扩大为全新系统、其他硬件或每项功能均已自动实测。

## 许可与反馈

项目自有部分采用 [GPL第3版](LICENSE)（GPL-3.0-only），版权与公开署名见 [NOTICE](NOTICE)。第三方材料保留原许可，见 [第三方声明](THIRD_PARTY_NOTICES.md)。许可范围说明见 [许可说明](docs/LICENSE_DECISION.md)。

公开仓库：[cue-lae/ai-canvas-public](https://github.com/cue-lae/ai-canvas-public)。安装包与对应源码下载：[v1.0.4](https://github.com/cue-lae/ai-canvas-public/releases/tag/v1.0.4)。问题反馈：[Issues](https://github.com/cue-lae/ai-canvas-public/issues)。请提供版本、操作步骤、预期/实际结果和可公开截图，并移除个人内容与凭据。

`SOURCE_MANIFEST.json` 中的文件摘要对应 Release 内的原始 r3 源码 ZIP；Git 按原属性规范部分文本换行，发布后的首页链接另行维护。运行输入及构建校验仍见 `desktop-package/accepted-source-inputs.json`，其 201 项已由 Git 暂存区导出逐字节复核。
