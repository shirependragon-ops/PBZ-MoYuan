# PBZ 魔渊换怪

《影之刃零》换怪与低血量增益 mod，当前版本 **3.13.1**。

默认将普通小怪替换成金面具，沿用源怪血量和杀气。炸弹人不替换；Boss场地及隐藏、特殊出场、已进战遭遇继续受保护。

## 安装与卸载

1. 自行安装适用的UE4SS和PBZModLoader前置，本包不包含第三方加载器。
2. 退出游戏，备份已有模组和配置。
3. 将 `ProjectPBZ` 文件夹合并到游戏根目录，覆盖同名脚本，再启动游戏。

升级前备份自己的配置。卸载时退出游戏，恢复备份或移除本项目的 `PBZMoYuanClean`、`PBZLowHPBuff`、`PBZMoYuanSettings` 三个目录。

## 配置

编辑 [`ProjectPBZ/PBZModLoader/mods/PBZMoYuanSettings/config.json`](ProjectPBZ/PBZModLoader/mods/PBZMoYuanSettings/config.json)，保存后**完全退出并重启游戏**。开关用 `true` / `false`；JSON使用英文双引号和逗号，不添加注释。

### 换怪

- `replacement.enabled`：换怪开关。
- `replacement.monsterId`：目标类ID或完整蓝图类路径。默认 `BP_Monster_MoTian_LongZhu_04_C`（金面具）；例如 `BP_Monster_AHua_GuiTouDao_C` 为新娘阿花。

可在[怪物ID表](ProjectPBZ/PBZModLoader/mods/PBZMoYuanSettings/monster-ids.json)查找388个ID及完整路径。同名多路径的ID需填写其中一条完整路径；索引未包含的目标也可填写实际完整路径。

### 低血量增益

`lowHpBuff.enabled` 为总开关；`damageReduction`（减伤）与 `damageBonus`（增伤）各自包含：

| 字段 | 含义 |
|---|---|
| `enabled` | 独立开关；关闭时不写该项属性 |
| `maxPercent` | 最大百分比；80表示80%。减伤0—100，增伤0—1000；0关闭该项写入 |
| `startHpPercent` | 血量达到或高于此百分比时，额外效果为0 |
| `fullHpPercent` | 血量达到或低于此百分比时，达到最大效果 |

须满足 `0 <= fullHpPercent < startHpPercent <= 100`。两阈值之间线性变化，按2个百分点量化且不超过上限。

默认两项均开启：减伤上限80%、增伤上限60%，开始血量100%、满效果血量0%。例如将减伤设为80 / 60 / 20，即60%血开始生效、20%血达到80%减伤，40%血时约40%减伤。两项可用不同阈值。

配置缺失或JSON损坏会停用两个功能；错误ID只停用换怪，错误效果参数只停用对应项。可在 `ProjectPBZ/Content/Paks/~mods/` 下的 `MoYuanClean.log`、`LowHPBuff.log` 查看版本、加载配置及 `config warning`。

## 已知限制

3.12跑图测试未复现当轮退战或炸弹人问题，但特殊隐藏和尚场景尚未完整验证。3.13配置接入通过静态和模拟检查，尚未游戏内验证。默认以外的目标未逐一实测；装备、原生增益和修改器可能影响实际效果。

## 使用许可

原创代码和文档采用[项目自定义非商业、禁止收费分发许可](LICENSE)。原版、修改版均不得商用、收费下载、付费群/会员分发或进入收费整合包，收取成本费也未获授权。无偿再分发须保留署名、许可及[NOTICE](NOTICE)，标明修改并保留相同限制。旧版本仍依其发布时许可处理，完整条款以LICENSE为准。

[开发与打包说明](https://github.com/shirependragon-ops/PBZ-MoYuan/blob/main/docs/开发说明.md)
