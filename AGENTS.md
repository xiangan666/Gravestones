# 项目工作约定

## 入口与命令

- 面向玩家的行为和安装步骤见 [README](README.md)，架构见 [docs/DESIGN.md](docs/DESIGN.md)。
- Windows 11 + PowerShell；Node.js 24+、npm 11+、Python 3.10+。CI 使用 `.node-version` 与 `.python-version`。
- 安装：`npm ci`；校验：`npm run check`；测试：`npm test`；构建：`npm run build`；产物核对：`npm run build:verify`。
- 原生引擎验收入口和历史证据见 [docs/TESTING.md](docs/TESTING.md)，不能用模拟测试代替真实玩家验收。

## 实施与数据边界

- 基于真实代码和验证结果自主完成最佳可行实现，普通技术决策直接落实；保留无关改动、原始归档、旧版安装包和原作者署名。
- 保留 `Grave_B/`、`Grave_R/`、`tests/`、`tools/`、`docs/` 结构；按模块职责修改，避免无关重构。
- 包 UUID、实体/物品标识和动态属性归属不能随意修改；既有墓碑、钥匙与库存需要兼容。
- 原生 ItemStack 不降级为仅类型/数量的 JSON；未加载不等于已丢失，不创建空库存掩盖失败。
- `everMoved` 只从 false 变 true；经验只结算一次；异步操作共用墓碑锁，扣费前重查钥匙和材料。
- 稳定 Script API 2.0.0：`isValid` 是属性，没有 `Block.isSolid`；保护实体伤害枚举使用 `"no"`。
- 修改行为时覆盖正常、取消、失败和兼容路径；用户提示与新增文档使用中文，保留既有代码风格。

## 版本与正式发布

- 每轮实际修改（含文档、构建和CI）统一递增一个版本并完成提交、推送、远程标签和 GitHub Release；纯只读任务不创建空版本。
- 版本事实源是 `package.json`；使用 `npm run version:sync -- <新版本>` 同步锁文件、两包及运行时常量，手工同步当前文档、Unreleased和本轮发布说明。
- 审阅差异后显式暂存本任务文件；不要默认 `git add -A`，不要重置、强推、移动已发布标签或修改全局 Git 身份。
- 发布只使用已确认的 `origin`，流程见 [docs/RELEASING.md](docs/RELEASING.md)。先校验、构建、核对，再提交并推送标签，由同一流程上传草稿资产、下载核对并正式发布。
- 每版交付一个标准名称 `.mcaddon` 和相应 `.sha256`；原始素材权利状态见 [NOTICE](NOTICE.md)。
- 远程权限、必要评审或网络受阻时，继续完成可独立执行的部分，准确报告“修改已完成，发布未完成”及具体阻塞；不把本地包或草稿称为正式发布。
