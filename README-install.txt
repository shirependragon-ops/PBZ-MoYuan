PBZ 魔渊换怪 + 低血量增益 3.13

安装
1. 先按 PBZModLoader 官方说明安装好前置；已有可运行版本可跳过。
2. 关闭游戏，备份已有模组及 PBZMoYuanSettings/config.json（如有）。
3. 将压缩包里的 ProjectPBZ 文件夹合并到游戏根目录，覆盖同名脚本。
4. 启动游戏。修改配置后也需要完全退出并重启游戏。

配置位置
ProjectPBZ/PBZModLoader/mods/PBZMoYuanSettings/config.json
可设置替换目标怪物ID；低血量增益总开关；减伤/增伤独立开关、最大数值及各自血量阈值。
具体字段、示例及目标ID查找方式见同目录“配置说明.md”。
默认：金面具；减伤最高80%、增伤最高60%，从满血到0血线性增加，与上一版配置相同。

卸载/回滚
退出游戏后恢复备份。移除本包时一并移除 PBZMoYuanClean、PBZLowHPBuff、PBZMoYuanSettings 三个目录，或恢复它们的旧版本。

本包只有本项目代码、配置、怪物路径索引与说明；不包含 UE4SS、PBZModLoader 前置、游戏资产、探针或测试日志。

使用许可
本项目原创代码和文档仅授权非商业用途，采用 PolyForm Noncommercial License 1.0.0。
免费分享或修改版再分发时，保留 LICENSE 和 NOTICE。商业使用需另行取得授权；具体以 LICENSE 全文为准。
