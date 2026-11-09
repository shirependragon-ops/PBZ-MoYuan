# PBZ 魔渊换怪

《影之刃零》换怪与低血量增益 mod，当前版本 **3.13.1**（许可修订，功能与3.13相同）。

- 将普通小怪替换成配置指定的怪物，默认金面具。
- 沿用源小怪血量、杀气数值；保留 Boss 场地过滤。
- 炸弹人不替换；隐藏、特殊出场、已进战的遭遇保留原怪。
- 低血量减伤和增伤可以分别开启，调整最大效果和生效血量阈值。

## 安装

1. 自行安装游戏适用的 UE4SS 和 PBZModLoader 前置；本项目不分发第三方加载器。
2. 退出游戏，备份原模组和已有配置。
3. 将本项目的 `ProjectPBZ` 文件夹合并到游戏根目录，覆盖同名脚本。
4. 启动游戏。配置变更也需完全退出后重启。

`dev`、`tests`、`scripts` 和 `docs` 不需要复制进游戏。

## 配置

编辑 [`config.json`](ProjectPBZ/PBZModLoader/mods/PBZMoYuanSettings/config.json)。

- `replacement.monsterId`：目标怪物 ID 或完整蓝图类路径。
- `replacement.enabled`：换怪开关。
- `lowHpBuff.enabled`：低血量机制总开关。
- `damageReduction` / `damageBonus`：减伤与增伤的独立开关、最大百分比、开始与满效果血量阈值。

默认金面具，减伤最高80%、增伤最高60%，随血量降低线性增加。参阅[配置说明](ProjectPBZ/PBZModLoader/mods/PBZMoYuanSettings/配置说明.md)与[怪物 ID 表](ProjectPBZ/PBZModLoader/mods/PBZMoYuanSettings/monster-ids.json)。

## 卸载与回滚

退出游戏后恢复备份；或移除本项目的 `PBZMoYuanClean`、`PBZLowHPBuff`、`PBZMoYuanSettings` 三个目录。不要移除其他模组。

## 验证状态

3.12做过跑图测试，未复现当轮报告的退战或炸弹人问题；特殊隐藏和尚场景尚未完整验证。3.13配置接入通过静态和模拟检查，尚未游戏内验证。其他替换目标未逐一实测；装备、原生增益和修改器可能影响实际效果。

[开发与打包说明](docs/开发说明.md)

## 使用许可

本版本采用[项目自定义非商业、禁止收费分发许可](LICENSE)。原版和修改版均仅允许非商业使用、无偿分享，必须保留署名、许可及[NOTICE](NOTICE)，修改版需标明修改并继续保留这些条件。

**禁止改名或修改后商用、收费下载、付费群/会员分发，以及收费整合包；以回收成本为由收费分发也未获授权。** 商业或收费分发用途须另行取得明确授权。具体以LICENSE全文为准。

本次许可修订不追溯撤回旧版本已经有效授予的权利；3.13及此前已按其他许可发布的版本仍依当时许可处理。
