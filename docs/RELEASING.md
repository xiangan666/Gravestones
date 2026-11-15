# GitHub发布与版本维护

项目仓库：[xiangan666/Gravestones](https://github.com/xiangan666/Gravestones)，默认分支为`main`。正式下载入口：[GitHub Releases](https://github.com/xiangan666/Gravestones/releases)。本流程同时适用于代码、依赖、构建和文档改动，每轮实际修改统一升级并发布一个版本。

## 版本事实源与准备

版本事实源为`package.json`。当前工程版本2.0.14；稳定Script API依赖固定为2.0.0，最低基岩引擎1.21.90。不要修改现有包UUID、物品/实体标识或原作者记录。

在项目根目录使用PowerShell：

```powershell
npm ci
# 下一轮按实际影响选择新版本；例如2.0.14之后的兼容修正：
npm run version:sync -- 2.0.15
npm run check
npm test
npm run build
npm run build:verify
```

版本工具同步package与锁文件版本、两个manifest的展示/模块/互相依赖版本和`core.js`常量；先复制被改文件到系统临时目录，再原子替换。它不重新生成图片或实体，不修改稳定API依赖。同步README、NOTICE、设计/验收当前版本、CHANGELOG及`docs/RELEASE-<版本>.md`。实施期间写入Unreleased；验收后归档到本轮版本节。已有历史版本和正式发布内容不就地修改。

## 构建与资产约定

每个版本生成：

- `dist/Gravestones-lanshiyi-v<版本>.mcaddon`：合并两包的标准安装包。
- `dist/Gravestones-lanshiyi-v<版本>.mcaddon.sha256`：两空格分隔的SHA-256与文件名。

安装包仅包含`Grave_B/`、`Grave_R/`、根`NOTICE.md`与映射为`INSTALL.md`的安装说明。固定时间戳、排序和Git文本LF约定使同一源码可重复构建；源码核对检查每个条目和字节。缺少文件、重复/多余条目或摘要不匹配时必须失败。原始2.0.8归档不作为构建输入，也不随源码上传。

新版本构建保留旧安装包、校验文件与其他资料；只更新当前版本的两个产物。已发布版本禁止更改，产生新修改必须递增版本。SHA-256说明内容一致性，不是发布者身份签名。

```powershell
Get-FileHash -Algorithm SHA256 dist/Gravestones-lanshiyi-v2.0.14.mcaddon
Get-Content dist/Gravestones-lanshiyi-v2.0.14.mcaddon.sha256
```

## 提交、标签与自动发布

先审阅`git status --short`、`git diff`和暂存差异，再显式暂存本任务文件。沿用已有分支流程和真实保护规则，不使用强推或移动已发布标签；只有实际远程仓库可作为发布目的地。

以下是当前2.0.14的发布示例；后续版本按事实源替换。提交步骤应在测试通过、发布说明和暂存范围已核对后执行。

```powershell
git diff --cached --check
git commit -m "build: 完善版本验证和发布流程"
git push origin main
git tag -a v2.0.14 -m "墓碑模组 2.0.14"
git push origin v2.0.14
```

`validate.yml`在分支push/PR或手动触发时，在Windows和Linux运行`npm ci`、check、test、build和build:verify。检查job只有读取权限，过期检查可取消，当前版本资产保留14天。远程Actions固定完整提交SHA，更新时核实上游并审阅差异。

`release.yml`在`v*`标签触发，检出该标签、核对清单版本，再执行同样的检查与构建。仅发布job赋予`contents: write`。`tools/release.py`随后核实远程标签确实指向检出的提交、工作区干净及本地资产与源码一致，创建或恢复同名草稿，上传两个当前版本资产，下载比对名称、大小、字节和摘要。核对成功才正式发布并设置latest，之后再次读取Release、标签和下载文件，输出核验报告。

发布流程不会把`dist/`内保留的其他历史资产混入本版本。发布说明中的相对文档链接会转换为当前标签下的明确URL。正式发布时GitHub会创建源码归档，它们不代替已构建的安装包。

## 跟进与中断恢复

推送后必须跟进检查和发布结果，不能只等待用户发现草稿。已安装并登录GitHub CLI时，可在PowerShell执行：

```powershell
gh run list --repo xiangan666/Gravestones --limit 10
gh release view v2.0.14 --repo xiangan666/Gravestones --json url,isDraft,isPrerelease,tagName,assets
# 中断且需要恢复时，重用同一标签和发布流程：
gh workflow run release.yml --repo xiangan666/Gravestones -f tag=v2.0.14
```

手动入口从已推送标签检出对应源码；失败的草稿可以继续更新本版资产，已正式发布的内容只读取核对，不替换。仓库启用不可变发布时，也必须在草稿阶段准备全部资产再发布。权限、配额、评审或网络失败时读取Actions日志，修复原因并继续相同发布流程，不创建重复版本或绕过保护。

需要在本地继续同一流程时，使用GitHub CLI登录并确保标签已在远程、HEAD与之相同、工作区干净、产物构建核对通过：

```powershell
python tools/release.py --repository xiangan666/Gravestones --tag v2.0.14
# 只核对已正式发布的内容：
python tools/release.py --repository xiangan666/Gravestones --tag v2.0.14 --verify-only
```

CI和本地调用相同工具，不能另开一套绕过标签/资产检查的发布路径。GitHub CLI不在PATH时可通过当前进程环境变量`GRAVESTONES_GH`提供其可执行文件路径；凭证由GitHub CLI管理，不写入项目文件。发布核对报告为`dist/release-v<版本>.json`，CI另保留30天工件。

## 发布前确认

- 明确上游素材权利状态并保留[原作归属](../NOTICE.md)，不擅自新增覆盖素材的开源许可证。
- 自动化检查和构建通过，文档明确真实玩家与BDS未验证范围。
- 标签、版本、候选提交、安装包、SHA-256和发布说明一致。
- 从远程下载资产后比对摘要和内容；确认Release已正式发布而非草稿，核实latest状态。
- 发布失败时报告“修改已完成，发布未完成”及具体环节和最小缺失输入；不把本地产物当作线上交付。
