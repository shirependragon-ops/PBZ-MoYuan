# 代码审查要求

默认只审查，除非用户明确要求修复。先读项目管理.md及docs/开发说明.md。

对象：
- ProjectPBZ/PBZModLoader/mods/PBZMoYuanClean/main.js
- ProjectPBZ/PBZModLoader/mods/PBZLowHPBuff/main.js
- ProjectPBZ/PBZModLoader/mods/PBZMoYuanSettings/settings.js与config.json
- dev/PBZMoYuanBirthProbe/main.js（只读探针，不分发）

检查：
1. 配置缺失/损坏、非法ID或阈值、独立开关是否安全处理，默认值是否保持既有行为。
2. 未就绪属性不能写0；Health和Shachi分别校验，不因某项失败恢复另一项已消耗资源。
3. 重试预算按尝试扣减、有次数上限；同轮去重；成功标签与单位身份状态不能错误复用。
4. 来源快照不能被移动后的最近点替换；检查同图流送、自然重生、换图及同名对象风险。
5. 炸弹人、隐藏/伏击/出场及已进战遭遇不应触发Class/Despawn/Respawn。
6. buff全部有效属性就绪后才写；不重捕含自身效果的基线；不按属性名猜伤害公式。
7. 探针回调、解绑失败保留、延迟访问及对象生命周期是否正确；未观察到回调不代表接口不可用。
8. 发布白名单不能包含日志、存档、密钥、本机路径、SDK或第三方代码。

运行node tests/config.cjs与node tests/regression.cjs。需要游戏证据时给出最小日志观察点，不自行启动游戏。

涉及API语义必须有本地SDK/游戏脚本或已记录运行时证据；缺证据写“推测”。输出按严重度给出文件行号、触发条件、影响、最小修复，并区分静态验证、模拟与实测。
