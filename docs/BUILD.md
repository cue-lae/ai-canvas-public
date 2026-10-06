# 构建说明（本地候选）

以下从本目录根执行；不需要内部 Git 历史。独立虚拟机中的工具/依赖重新获取与完整构建已通过；不是全新Windows系统的首次安装验收。工具版本和步骤基于本轮实际验证。

## 所需工具

| 工具 | 固定或本轮验证版本 | 官方来源 |
| --- | --- | --- |
| Node.js Windows x64 | 24.19.0 | [官方归档](https://nodejs.org/dist/v24.19.0/) |
| pnpm | 10.16.1（packageManager 声明，当前未重新安装） | [安装说明](https://pnpm.io/installation) |
| .NET SDK Windows x64 | 8.0.425，运行库 8.0.31 | [官方 .NET 8 下载](https://dotnet.microsoft.com/en-us/download/dotnet/8.0) |
| Inno Setup | 7.1.0（ISCC） | [官方页面](https://jrsoftware.org/isinfo.php) |
| WebView2 SDK | 1.0.3912.50，NuGet 自动还原 | [包页面](https://www.nuget.org/packages/Microsoft.Web.WebView2/1.0.3912.50) |

Node 和 .NET 可使用本目录 .build/tools 下解压的官方工具，ISCC 路径可显式指定。不要把 .build、runtime、node_modules、.pnpm-store、bin 或 obj 纳入对外源码。

## 前端依赖与检查

先准备上述 Node；使用本地目录获取准确版本的 pnpm（需要网络）：

```powershell
npm install --prefix .build/tools pnpm@10.16.1 --cache .build/npm-cache
.\.build\tools\node_modules\.bin\pnpm.cmd --version
.\.build\tools\node_modules\.bin\pnpm.cmd install --frozen-lockfile --store-dir .pnpm-store
.\.build\tools\node_modules\.bin\pnpm.cmd build
.\.build\tools\node_modules\.bin\pnpm.cmd test --minWorkers=1 --maxWorkers=2 --no-cache
```

本修订保留原548项用例；根项目、源码副本及独立虚拟机中的全量测试与类型检查均通过。这不等于已验证所有Windows硬件或首次安装情形。Windows 宿主模型测试需要 .NET；真实 WPF/WebView2 测试需要对应桌面环境，不是跨平台单元测试。

## 安装包

获取官方 node-v24.19.0-win-x64.zip，放在 .build/downloads。构建脚本要求 SHA256：

```text
57f71ab3652e797d84acddc79c81cc9ff1c6ddb2a1974cdb83f00fee9bff4c73
```

脚本从此归档提取安装包中的 Node，校验失败会停止，不接受临时替代可执行文件。实际执行构建的 Node 也应为上述版本。

```powershell
$env:DOTNET_GENERATE_ASPNET_CERTIFICATE = 'false'
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
# dotnet 在 PATH 时无需 CANVAS_DOTNET；否则填入本机工具的绝对路径。
# $env:CANVAS_DOTNET = (Resolve-Path '.build/tools/dotnet/dotnet.exe').Path
# $env:CANVAS_ISCC = '工具所在目录/ISCC.exe'
node desktop-package/build.mjs build-001
```

每次使用新的 build-NNN，已有目录会拒绝覆盖。输出位于 .build/build-NNN/installer，含安装器和 SHA256；BUILD-REPORT.json 保存源码及载荷校验。本次公开前仍需确认实际上传清单和仓库目标；构建成功不等于已经对外发布。

| 可选变量 | 用途与默认值 |
| --- | --- |
| CANVAS_BUILD_ROOT | 构建输出根，默认 .build |
| CANVAS_NODE_ARCHIVE | Node ZIP 绝对路径，默认 .build/downloads 中固定文件 |
| CANVAS_DOTNET | .NET 可执行文件，默认 PATH 中 dotnet |
| CANVAS_ISCC | 编译器路径，默认当前用户 Inno Setup 7 安装位置 |
| CANVAS_NUGET_CACHE | NuGet 缓存，默认 .build/nuget |
| CANVAS_NUGET_SOURCE | 可选离线包源，未指定时使用正常 NuGet 源 |
| CANVAS_DEPS_ROOT | 可选已有 node_modules 的明确路径，仅供已有依赖构建；不代表干净环境复现 |

独立虚拟机验证使用本机新下载的工具及349个重新下载的依赖，采用独立.pnpm-store和NuGet目录，没有复制宿主依赖或共享宿主源目录；未初始化公共Git仓库。之前已有工具缓存上的构建仅作为历史记录。

## 开发预览

依赖安装完后运行 pnpm dev 可启动前端开发服务器。pnpm canvas:start 会启动开发前端及桥接并打开浏览器；这不是安装版入口。桥接的端口与能力文件由开发脚本管理。

Windows 开发宿主可先运行 node scripts/prepare-runtime.mjs，校验并准备 runtime/node.exe，再运行 pnpm host:publish。安装版打包由 package:build 的专门流程处理，不把开发宿主当成正式安装载荷。

开发和安装模式不能混用。这里列出启动命令供开发者选择，本轮没有启动服务、应用或运行安装器。
