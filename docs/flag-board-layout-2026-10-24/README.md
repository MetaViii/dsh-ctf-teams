# Flag 看板窄屏修复：0.1.34

原布局把 Flag 正文、固定宽度 ID/提交者和不可收缩的备注放在同一条 flex 行，正文允许 `overflow-wrap:anywhere`。窗口窄或备注很长时，正文可被压到一个字符宽，从而逐字换行。

修复后，每条候选使用独立卡片。ID、提交者和备注在元信息区换行；登记原文和平台接受值各占整行，并在自己的区域横向滚动。值的文字、大小写、符号、空白及对应关系均不修改，也不改变候选或平台裁决状态。

## 验证方法

`scripts/client-verify.mjs` 仍从真实编译后的 ModuleLoader 单元注册并渲染会话面板。可用 `--layout-fixture <path> --layout-only` 导出其中实际 Flag 区域的 HTML；序列化器只转写真实 React 树和样式，不另写一份 Flag 布局。

`scripts/dashboard-layout-verify.mjs --fixture <path> --report <path>` 用原生无界面 Chrome/Edge 和独立临时 profile 测量 DOM。没有访问用户浏览器 profile、登录态、DSH 会话或远程页面，也没有新增项目依赖。它检查首尾字符是否同高、值区域是否占足宽度并限制在面板内、溢出内容能否横向滚动，以及是否能用键盘聚焦。

使用 0.1.33 的原始编译客户端作失败对照：8 组均失败，24 个值检查中有 22 个被排为多行。相同数据在修复后的客户端上，8 组、24 个值检查均通过。测试宽度为 160/240/320/640 CSS 像素，缩放为 1/1.5；测试数据均为合成内容。

这证明浏览器中的布局修复，不等于用户当前 DSH 窗口已经完成验证。交互式 DSH GUI 仍保留未验证。安装、宿主 smoke 和最终产物哈希记录于 `validation.json` 与 `evidence/`。

## 本机交付

0.1.33 独立包未安装；其功能已包含于本次 0.1.34。本机已保存并完全退出后完成备份，由 Desktop 自带 CLI 离线安装同一验收包，152 个包文件完全一致。配置、模型路由、权限、其他插件版本及既有会话/战队内容与元数据保持；预设及工具宿主加载通过，无跳过 bundle。DSH 已重新打开，主窗口出现且响应正常；重开后原战队文件没有变化。未恢复暂停战队，未更新 Desktop，未发布 npm。交互式 Flag 面板仍未验证，参见[安装记录](./evidence/local-install.json)。

## 已完成验收

客户端交互、面板路由、README/版本元数据、编译产物一致性通过；同一 tarball 在 Desktop 0.2.1-rc.2 的真实 Web 批准、队员执行和回报场景通过。最终 tarball 中的客户端通过上述 24 项原生布局检查。只重跑与本次客户端修复有关的验证，没有把上一轮完整回归误记为本轮新执行。

产物 SHA-256：`42464d6ffc40770dc5506ea71374a106b57d1a5a03a6b0d4c9f1cc44d324e11b`。参见 [validation.json](./validation.json)、[修复前测量](./evidence/layout-before.json)、[修复后测量](./evidence/layout-after.json) 和 [240 像素预览](./evidence/narrow-240.png)。
