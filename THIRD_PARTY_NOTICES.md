# 第三方材料与声明

本文件索引第三方原许可。项目自有代码和已授权自有资产采用GPL-3.0-only，署名cue-lae；本声明不修改第三方条款，也不代表所有未来分发情形均已核对。

## 代码、运行库和工具

- 画布底座：[Excalidraw 0.18.1 MIT 原文](https://raw.githubusercontent.com/excalidraw/excalidraw/v0.18.1/LICENSE)，本地文件 third-party-licenses/Excalidraw-0.18.1-LICENSE.txt。
- JavaScript 依赖：third-party-licenses/INDEX.json 与相邻许可原文。该集合包含开发依赖，不能作为仅生产依赖的 SBOM。存在 MIT、Apache、BSD、ISC、Zlib、0BSD、CC0 等不同条款。
- [Node.js 24.19.0](https://raw.githubusercontent.com/nodejs/node/v24.19.0/LICENSE)：主许可与其内含第三方声明一并保留。
- [.NET 8.0.31](https://raw.githubusercontent.com/dotnet/runtime/v8.0.31/LICENSE.TXT)：保留 MIT 与运行库第三方声明。
- [WebView2 SDK](https://www.nuget.org/packages/Microsoft.Web.WebView2/1.0.3912.50)：本地 NuGet LICENSE/NOTICE 原文保留；SDK、已安装浏览器 Runtime 是不同组成。
- [Inno Setup](https://jrsoftware.org/files/is/license.txt)：保留原声明并遵守修改/分发条件。上游另有商业使用购买请求，见其[购买说明](https://jrsoftware.org/ishelp/topic_purchase.htm)，本候选不宣称已经购买。

dompurify 的双许可条目保留两份原文；若按 Apache 选项分发需遵守该选项条件，不能自行把双许可整体称为 MIT。

## 字体

third-party-licenses/fonts/INDEX.json 记录当前依赖的九个字体族、代表文件摘要、版本与证据。已保留字体内嵌版权信息以及可核实的许可正文。

Assistant、Cascadia Code、Excalifont、Lilita、Nunito、Virgil、Xiaolai 有 OFL-1.1 证据；Comic Shanns 有 MIT 原文。OFL 字体须保留其版权、许可及适用的保留字体名称要求，不能改称项目自有许可，参见[OFL 正文](https://openfontlicense.org/open-font-license-official-text/)。

**依赖中的 Liberation Sans 是 Version 1.05，不能套用新版 OFL。** [官方维护者说明](https://github.com/liberationfonts/liberation-1.7-fonts)区分旧系列 GPL v2 加例外与新版 OFL；本地保留旧系列 COPYING 与 License.txt。实际安装载荷不含该字体文件，底座通过精确版本的上游资源路径按需获取，见 [ExcalidrawFontFace 源码](https://raw.githubusercontent.com/excalidraw/excalidraw/v0.18.1/packages/excalidraw/fonts/ExcalidrawFontFace.ts)。不将依赖存在直接当作随包分发。未来自行携带、转换或嵌入该字体的输出仍须匹配准确源文件和相关义务；本说明不对这些情形作放行。

数学排版依赖 KaTeX 的许可原文单独保留；上述九个字体族清单不是对所有其他依赖资产的替代。

## 自有资产

项目用户已授权所询自有代码、AC标志、文件图标和安装界面素材公开，统一公开署名cue-lae；适用项目GPL-3.0-only许可，其他第三方作品仍按原文。用户图片、画布、参考素材没有纳入候选。
