# 构建说明

从解压后的源码根目录执行，不需要内部Git仓库。以下是构建入口与依赖要求，不表示本轮已经在干净机器重新下载依赖并完成构建。

## 依赖

- Windows x64；Node.js 24.19.0；pnpm 10.16.1。
- .NET SDK 8.0.425，目标运行库8.0.31；WebView2 SDK 1.0.3912.50由NuGet还原。
- Inno Setup 7.1.0，提供ISCC；运行应用还需WebView2 Evergreen Runtime。

前端依赖版本以`package.json`与`pnpm-lock.yaml`为准。准备好上述工具后：

```powershell
pnpm install --frozen-lockfile --store-dir .pnpm-store
pnpm build
pnpm test --minWorkers=1 --maxWorkers=2 --no-cache
```

## 安装包

从[Node官方归档](https://nodejs.org/dist/v24.19.0/)获取`node-v24.19.0-win-x64.zip`，放到`.build/downloads/`。安装包内Node从该归档提取，必须匹配：

```text
57f71ab3652e797d84acddc79c81cc9ff1c6ddb2a1974cdb83f00fee9bff4c73
```

`.NET SDK`和ISCC可通过下列变量显式指定；不要把SDK、安装工具或缓存放入源码归档。构建示例：

```powershell
$env:DOTNET_GENERATE_ASPNET_CERTIFICATE = 'false'
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
# 如dotnet不在PATH，设置CANVAS_DOTNET为所用SDK的dotnet.exe完整路径。
# 如ISCC不在默认位置，设置CANVAS_ISCC为所用ISCC.exe完整路径。
node desktop-package/build.mjs build-001
```

每次使用新的`build-NNN`；已有目录拒绝覆盖。默认输出为`.build/build-NNN/installer`，构建报告绑定实际源码和载荷摘要。安装器创建不执行安装。

| 环境变量 | 默认值／用途 |
| --- | --- |
| CANVAS_BUILD_ROOT | `.build`；构建输出根 |
| CANVAS_NODE_ARCHIVE | `.build/downloads/node-v24.19.0-win-x64.zip` |
| CANVAS_DOTNET | PATH中的`dotnet`；须指向SDK而非仅运行库 |
| CANVAS_ISCC | 当前用户Inno Setup 7目录中的`ISCC.exe` |
| CANVAS_NUGET_CACHE | 项目内`.pnpm-store/ai-canvas-nuget` |
| CANVAS_NUGET_SOURCE | 可选明确离线NuGet包源；否则采用正常还原配置 |
| CANVAS_DEPS_ROOT | 默认当前目录的`node_modules`；可明确指定已有依赖供本地验证，但不代表干净环境复现 |

构建读取`SOURCE-INPUTS.json`的精确路径和摘要，并校验`desktop-package/accepted-source-inputs.json`中应用／宿主输入。自行修改源码后，旧清单会拒绝构建；派生版本须先验证修改并有意更新对应清单，不能通过关闭校验绕过。

正式构建默认关闭时序诊断，使用安装模式和固定43129桥接端口；隔离验收宿主不是正式安装载荷。前端构建使用专用配置，不加载开发者`.env`。旧源码中的DEV接口不应进入生产运行入口。

开发前端可运行`pnpm dev`；`pnpm canvas:start`会启动开发前端及桥接，属于主动运行开发软件。本文没有执行这些命令。许可原文、第三方声明和必要安装壳HTML均是源码组成，不应为了缩小归档而删除。
