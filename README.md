# 四号船坞

四号船坞是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 Web 界面主题。它把首页变成干船坞工作台，在同一页查看工作区活动、待处理会话和最近进度，再从对话里取用草稿、便签和开发工具。

## 安装

在终端执行对应的命令，然后重启 DeepSeek Harness。桌面版首次安装前需启动应用一次以初始化 profile，再完全退出应用并使用自带的 CLI。

```sh
# Web 版
dsh plugin --profile web add dsh-afterwave-style
# 桌面版（使用应用自带的 dsh CLI）
dsh plugin --profile desktop add dsh-afterwave-style
```

卸载时将对应命令的 `add` 改为 `remove`，再重启 DeepSeek Harness。插件面向使用 Web 界面的 profile，依赖宿主提供会话、对话和主题模块。

## 功能

- **外观与工作区概览**。浅色采用暖灰面板和工作蓝，深色采用枪灰面板和琥珀指示灯。首页可查看会话统计、活动趋势和待处理任务，并跳回最近会话。主题跟随宿主明暗外观，动画响应系统的减少动态效果设置。
- **会话挂件**。鲸鱼娘随思考、输出、调用工具、等待操作及错误切换。可拖动挂件、打开待处理会话或收起挂件，声音与桌面通知默认关闭。
- **输入与长对话**。支持常用短语、选区格式化、草稿恢复、代码块清单、对话跳转和已加载消息的 Markdown 导出。
- **工作台工具**。从首页或 `Ctrl+K` / `⌘K` 指令台打开堆叠便签、番茄钟和专注模式。工装设置可替换本地立绘、调节透明度及关闭装饰。

偏好、自定义立绘、模板、便签与插件保存的草稿留在当前客户端的本地存储。安装后可直接使用内置功能。

## 开发与预览

```sh
npm ci
npm test
npm run preview
```

`npm test` 先构建插件，再运行测试。`npm run preview` 生成 `dist/preview.html`，可离线体验主题和模拟会话。`npm pack` 可生成包含预构建客户端的安装包。

欢迎在 [GitHub Issues](https://github.com/xiaomao361/dsh-afterwave-style/issues) 报告问题，请附上 DSH 版本、使用的 profile 与复现步骤。

## 许可证

[CC0 1.0 Universal](LICENSE)
