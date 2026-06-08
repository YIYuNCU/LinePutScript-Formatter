# LinePutScript VS Code 插件

![LinePutScript](Lineput.png)

这是一个用于编辑 `.lps` 文件的 VS Code 插件，提供 LinePutScript 的语法高亮、格式化、悬停说明、补全、诊断和文档符号支持。

当前实现参考了相邻 `LinePutScript` C# 仓库中的核心解析规则，但插件本身是轻量 TypeScript 实现，不依赖 C# DLL，也不实现完整运行时类型转换。

## 功能

- 识别 `.lps` 文件并注册 `lps` 语言。
- TextMate 语法高亮：
  - `:|` 子项分隔符
  - `#` 名称和信息分隔符
  - `///` 注释
  - `/stop`、`/id`、`/n`、`/tab`、`/com`、`/!`、`/|` 等转义片段
  - line name、sub name、info、数字 info
- 紧凑格式化，输出风格接近 `LinePutScript` C# `ToString()`。
- 懒加载语言服务：
  - Hover 悬停说明
  - Completion 补全
  - 局部 diagnostics 诊断
  - Document Symbols 文档符号
  - Range Formatting 局部格式化
- 大文件性能保护：
  - 语言服务按当前行、可见范围和后台分块索引工作。
  - 避免在 hover、completion、diagnostics 中一次性读取和解析整个文件。
  - 整文档格式化仍受大小阈值保护。

## LPS 基础语法

LinePutScript 由多行 line 组成，每行可以包含 line 信息、多个 sub，以及末尾文本。

```lps
lineName#lineInfo:|subName#subInfo:|anotherSub#value:|text
money#10500:|
computer:|name#MyComputer:|
```

常用符号：

| 符号 | 含义 |
| --- | --- |
| `#` | 分隔 name 和 info，只按第一个 `#` 分割 |
| `:|` | 分隔 line/sub/text |
| `///` | 注释，首个 `///` 之后作为注释 |
| `:\n|` | 文本换行，格式化时转换为 `/n` |
| `:\n:` | 续行，格式化时移除换行并拼接 |

常用转义：

| 转义 | 含义 |
| --- | --- |
| `/stop` | `:|` |
| `/id` | `#` |
| `/n` | 换行 |
| `/r` | 回车 |
| `/tab` | 制表符 |
| `/com` | `,` |
| `/!` | `/` |
| `/|` | `|` |

## 格式化

插件支持两种格式化入口：

- `LinePutScript Format` 命令
- VS Code 的 `Format Document`
- VS Code 的 `Format Selection`

格式化默认关闭，需要启用：

```json
{
  "lineputscript.formatterSwitch": true
}
```

整文档格式化会读取完整文档，因此默认只处理不超过 `lineputscript.maxFormatDocumentSize` 的文件。大文件建议使用选区格式化。

## 懒加载语言服务

为避免大文件卡顿，语言服务默认启用懒加载：

- Hover 只解析当前行。
- Completion 只读取当前行附近内容，并结合后台缓存的名称。
- Diagnostics 只检查当前可见范围及前后缓冲行。
- 后台名称索引按时间预算分块执行。
- 大文件 Document Symbols 使用可见范围或数量上限，避免无界扫描。

这只能减少插件自身造成的卡顿；VS Code 仍会管理已打开文件的 `TextDocument`。

## 配置项

| 配置 | 默认值 | 说明 |
| --- | ---: | --- |
| `lineputscript.formatterSwitch` | `false` | 是否启用格式化 |
| `lineputscript.maxFormatDocumentSize` | `1048576` | 整文档格式化最大字符数 |
| `lineputscript.lineFeedThreshold` | `64` | 旧配置，当前紧凑格式化不主动折行 |
| `lineputscript.languageServiceSwitch` | `true` | 是否启用 Hover、Completion、Diagnostics、Symbols |
| `lineputscript.lazyLanguageService` | `true` | 是否使用懒加载语言服务 |
| `lineputscript.maxLanguageServiceDocumentSize` | `1048576` | 超过后文档级语言功能使用大文件策略 |
| `lineputscript.diagnosticVisibleBufferLines` | `50` | 可见范围前后参与诊断的缓冲行数 |
| `lineputscript.backgroundIndexTimeBudgetMs` | `8` | 后台索引每个分块的最大耗时 |
| `lineputscript.maxDocumentSymbolsForLargeFile` | `2000` | 文档符号数量上限 |

## 当前限制

- 不实现完整 LPS 运行时。
- 不执行 `SetObject` 类型转换。
- 不实现 `LPSConvert` 对象序列化/反序列化。
- 不做跨文件索引。
- TextMate 高亮是正则级别，不能替代完整语义解析。
- 整文档格式化天然需要读取完整文件，仍使用阈值保护。

## 开发

安装依赖：

```powershell
npm.cmd install
```

编译：

```powershell
npm.cmd run compile
```

运行 lint：

```powershell
npm.cmd run lint
```

运行测试：

```powershell
npm.cmd test
```

`npm.cmd test` 会先执行 TypeScript 编译和 ESLint，再运行 Mocha 测试。
