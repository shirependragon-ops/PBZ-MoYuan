"use strict";
// PBZMoYuanClean v3.13 — 可配置替换目标，保留源小怪血量与特殊遭遇保护。
//
// v14 修复 v13 的两个问题：
//   1) Despawn+Respawn 之后 spawner.SpawnedAI 不会刷新（读到的是旧小兵）→ 不再依赖它找新单位
//   2) 同一个刷怪器被反复转换 → 给刷怪器打 PBZMoYuanSpawnerDone 标签，只转换一次
//
// 新的配对方式（全部在 JS 侧，不跨运行时）：
//   * 转换时记录刷怪器位置 + 原小兵数值（convStats）
//   * 每轮枚举目标类单位，找“没打过 PBZMoYuanDone 标签、且离某个 convStats 位置最近”的金面具
//   * 给它覆写血量/杀气，成功后打 PBZMoYuanDone 标签（之后不再处理）
//   * 这样刷怪器以后自然重生出来的金面具也能套用同一份数值
//
// 日志：ProjectPBZ/Content/Paks/~mods/MoYuanClean.log
const UE = require("ue");
const puerts = require("puerts");
const SETTINGS = require("../PBZMoYuanSettings/settings");
const REPLACE_ENABLED = SETTINGS.replacement.enabled;

const TARGET_PATH = SETTINGS.replacement.targetPath;
const SPAWNER_PATH = "/SGameAI/Tools/Spawner/BP_AISpawner.BP_AISpawner_C";
const POLL_MS = 2000;
const READY_DELAY_MS = 10000;
const ARENA_RADIUS = 4000;
const BOSS_TAG = "CharacterType.AI.Boss";
const STRIP_TAGS = [
    "CharacterType.AI.Boss",
    "CharacterType.Difficulty.UltimateBoss",
    "CharacterType.Difficulty.GreatBoss",
];
const MITI_NAMES = [];   // 3.3：防御/减伤复制语义未验证，先关闭（曾导致“人均血牛”）
const SPAWNER_DONE_TAG = "PBZMoYuanSpawnerDone";
const UNIT_DONE_TAG = "PBZMoYuanDone";
const PAIR_RADIUS = 1200;
const MAX_CONVERT_PER_TICK = 3;
const MAX_APPLY_PER_TICK = 3;
const APPLY_MAX_TRIES = 30;
const SYNC_TOL_RATIO = 0.02;        // 回读容差（相对值）
const GIVEUP_MAX = 512;             // 放弃记录上限（按时间淘汰，不整体清空）

const SKIP_KEYWORDS = [
    "MoTian", "NPC", "Helper", "Horse", "Mount",
    "Teaching", "Tutorial", "Dummy", "Training",
    "Story", "Quest", "Cutscene", "Sequence", "Seq_",
    "Elite", "Boss", "Leader", "Chief", "Captain", "Commander",
    "General", "Guard", "Special", "Exclusive", "Unique", "Deputy",
    "JiangJun", "MiniBoss", "Mini_Boss",
];
const ARENAS = {
  "PBZ_DengDingShanDao_WP": [[-61888,-59929,19302], [-60732,-94289,29424], [-60718,-99075,29540], [-69486,-44023,15012], [-61588,-75427,25275]],
  "PBZ_Duanhun_WP": [[-196177,-99771,33274], [-194192,-106504,62105], [-193004,-115938,4499909]],
  "PBZ_Fujizhilin_WP": [[-131325,171254,-1489], [-42652,161879,-193], [-78625,171477,8], [16584,153856,-2015], [14346,155077,-2093]],
  "PBZ_Houjie_WP": [[-256637,48041,-6179], [-273349,43333,-3391], [-211213,123844,-3296], [-243371,97425,-4042], [-269230,60976,-6673], [-250775,102236,-3325], [-267802,87264,-7180]],
  "PBZ_Pangzhen_WP": [[-167311,133622,-6082], [-176687,79322,3011362], [-180995,125153,-5990], [-162567,96537,1002], [-8087,-3942,920], [-107821,1727,1042], [-51239,15828,2529], [-71322,74821,847], [-76873,27433,775], [-126092,72649,749], [-150692,-21731,814], [-178557,-366,2001160]],
  "PBZ_Xigu_WP": [[-24781,290334,-26449], [-50452,260352,-24594], [-69652,210061,-19430], [-65078,194414,-17785], [4440,290020,1999301], [-84995,204668,2015851], [-39465,235172,-21480], [-39465,235172,-21480]],
  "PBZ_Ximeng_WP": [[-202109,87088,5416], [-184959,98209,3269], [-211260,73822,6824]],
  "PBZ_Zhengdaodaying_WP": [[-56589,83529,-6447], [-66945,79681,915], [-45388,126270,-2752], [-55847,103130,-1853], [-47997,104908,990], [-48526,96486,1496], [-27179,116580,-9508], [18507,75902,6634], [28585,73690,7018], [64718,67095,12084], [29210,56320,6224], [22329,79333,8562], [-7082,68983,5317]],
};
const BOSS_CLASSES = new Set(["BP_Monster_AHua_GuiTouDao_C", "BP_Monster_BiYuan_C", "BP_Monster_CanQu_BiHai_C", "BP_Monster_ChangHong_P2_C", "BP_Monster_ChangHong_Spear_C", "BP_Monster_ChiLian_P2_C", "BP_Monster_Danghui_C", "BP_Monster_DuYanBoss_C", "BP_Monster_EMei_Sword_Top_C", "BP_Monster_FemaleVessel_YuDing_C", "BP_Monster_FemaleVessel_YuZan_C", "BP_Monster_FengXueDaoKe_C", "BP_Monster_GreatBladeMan_C", "BP_Monster_GuWanYue_C", "BP_Monster_GuiChai_Cyan_ShuangYue_C", "BP_Monster_GuiChai_Red_P2_C", "BP_Monster_GuiChai_Yellow_MoDao_C", "BP_Monster_GuiChai_Yellow_ShuangGou_C", "BP_Monster_HookMan_P2_C", "BP_Monster_HuaQianXIao_C", "BP_Monster_HuaShan_JianOu_C", "BP_Monster_HuaShan_RedTroop_BigBro_C", "BP_Monster_HuoDaoDuiZhang_C", "BP_Monster_JadeMaskMan_C", "BP_Monster_JingYe_C", "BP_Monster_LeiDang_P2_C", "BP_Monster_LionDancer_P2_C", "BP_Monster_LuanShi_C", "BP_Monster_MBossVariants_C", "BP_Monster_Maddoctor_Elite_C", "BP_Monster_MengHua_C", "BP_Monster_MoTian_C", "BP_Monster_MoTian_LongZhu_01_C", "BP_Monster_MobMan_Elite_C", "BP_Monster_MobMan_Elite_Sword_C", "BP_Monster_MuXiaoKui_C", "BP_Monster_MuXiaoKui_P2_C", "BP_Monster_PengMeng_Axe_C", "BP_Monster_PowerMan_P2_C", "BP_Monster_QiShu_Bing_C", "BP_Monster_QiShu_Du_C", "BP_Monster_QiShu_Huo_C", "BP_Monster_QiShu_Lei_C", "BP_Monster_RenTuZi_C", "BP_Monster_Scavenger_C", "BP_Monster_SnowKiller_Sickle_C", "BP_Monster_TieGui_C", "BP_Monster_WuLengShuang_C", "BP_Monster_WuXuan_C", "BP_Monster_XiaoXue_C", "BP_Monster_YanQianSui_C", "BP_Monster_Yuu_C", "BP_Monster_Zhuobi_C", "BP_Monster_ZuoShang_C", "BP_Monster_ZuoShang_P2_C"]);

const state = globalThis.__pbzMoYuanClean = globalThis.__pbzMoYuanClean || {
    lines: [], targetClass: null, spawnerClass: null, softBoss: null,
    converted: 0, copied: 0, stripped: 0, err: "",
    level: null, levelAt: 0, readyAt: 0,
    convStats: [], attrCache: {}, lastScan: "",
    tickNo: 0, syncTries: {}, syncGiveUp: {}, syncGiveUpAt: {}, synced: {}, syncedSources: {}, resInitHp: {}, resInitSh: {}, protectedSpawners: {},
    stats: { convertFail: 0, applyFail: 0, tagFail: 0, lateMatch: 0 }
};

function flush() {
    try {
        const rel = UE.BlueprintPathsLibrary.ProjectContentDir() + "Paks/~mods/MoYuanClean.log";
        const path = UE.BlueprintPathsLibrary.ConvertRelativePathToFull(rel, "");
        UE.EasyCsv.SaveStringToFileWithFullPath(state.lines.join("\r\n") + "\r\n", path);
    } catch (e) { }
}
function diagLog(msg) {
    try {
        if (!state.diagLines) state.diagLines = [];
        if (state.diagLines.length >= 2000) return;
        state.diagLines.push(new Date().toISOString().substring(11, 23) + " " + String(msg).replace(/[^\x00-\x7f]/g, "?"));
        const rel = UE.BlueprintPathsLibrary.ProjectContentDir() + "Paks/~mods/MoYuanDiag.log";
        const path = UE.BlueprintPathsLibrary.ConvertRelativePathToFull(rel, "");
        UE.EasyCsv.SaveStringToFileWithFullPath(state.diagLines.join("\r\n") + "\r\n", path);
    } catch (e) { }
}
function log(msg) {
    if (state.lines.length >= 2000) return;
    state.lines.push(new Date().toISOString().substring(11, 23) + " " + String(msg).replace(/[^\x00-\x7f]/g, "?"));
    flush();
}
function toArray(w) {
    const out = [];
    try {
        const n = typeof w.Num === "function" ? w.Num() : (w.length || 0);
        for (let i = 0; i < n; i++) out.push(typeof w.Get === "function" ? w.Get(i) : w[i]);
    } catch (e) { }
    return out;
}
function enumerate(ctx, cls) {
    if (!cls) return [];
    const out = [];
    try { UE.GameplayStatics.GetAllActorsOfClass(ctx, cls, out); } catch (e) { return []; }
    if (out && typeof out.Num === "function") return toArray(out);
    if (Array.isArray(out)) {
        if (out.length === 1 && out[0] && typeof out[0].Num === "function") return toArray(out[0]);
        return out;
    }
    return [];
}
function locOf(a) {
    try { return a.K2_GetActorLocation(); } catch (e) { return null; }
}
function className(o) {
    try { return String(o.GetClass().GetName()); } catch (e) { return ""; }
}
function hasTag(a, tag) {
    try { return !!a.ActorHasTag(tag); } catch (e) { return false; }
}
function addTag(a, tag) {
    try { if (!a.ActorHasTag(tag)) a.Tags.Add(tag); return true; } catch (e) { return false; }
}
function unitKey(a) {
    try { return String(a.GetName()); } catch (e) { return ""; }
}
function pruneGiveUp() {
    const keys = Object.keys(state.syncGiveUp);
    if (keys.length <= GIVEUP_MAX) return;
    keys.sort((a, b) => (state.syncGiveUpAt[a] || 0) - (state.syncGiveUpAt[b] || 0));
    for (const k of keys.slice(0, keys.length - GIVEUP_MAX)) {
        delete state.syncGiveUp[k];
        delete state.syncGiveUpAt[k];
    }
}
function currentLevel(ctx) {
    const now = Date.now();
    if (state.level && now - state.levelAt < 3000) return state.level;
    let lvl = null;
    try { lvl = String(UE.GameplayStatics.GetCurrentLevelName(ctx, true)); } catch (e) { }
    state.levelAt = now;
    if (lvl && lvl !== state.level) {
        state.level = lvl;
        state.readyAt = now + READY_DELAY_MS;
        state.convStats = [];
        state.syncTries = {};
        state.syncGiveUp = {};
        state.syncGiveUpAt = {};
        state.synced = {};
        state.syncedSources = {};
        state.diagSeen = {};
        state.protectedSpawners = {};
        state.resInitHp = {};
        state.resInitSh = {};
        log("level: " + lvl);
    }
    return state.level;
}
function nearArena(level, loc) {
    if (!level || !loc) return false;
    const list = ARENAS[level];
    if (!list) return false;
    for (const p of list) {
        const dx = loc.X - p[0], dy = loc.Y - p[1], dz = loc.Z - p[2];
        if (dx * dx + dy * dy + dz * dz < ARENA_RADIUS * ARENA_RADIUS) return true;
    }
    return false;
}
function isSkipped(name) {
    for (const kw of SKIP_KEYWORDS) if (name.includes(kw)) return true;
    return false;
}
function isBombMob(name) {
    // Asset catalog: BombMan, BombManRespawn, BombMan_Ice, BombMan_Poison.
    return name.startsWith("BP_Monster_BombMan");
}
function isCommonMob(name) {
    if (!name.includes("Monster")) return false;
    if (isBombMob(name)) return false;
    if (isSkipped(name)) return false;
    if (BOSS_CLASSES.has(name)) return false;
    return true;
}
// Never tear down an encounter-bound actor to repair a stuck combat group.
// These checks preserve the original actor, spawner class and death/clear chain.
function replacementSafetyReason(spawner, pawn, name) {
    const monk = /^BP_Monster_Huo(?:Tong|Tie|Jin)Ren(?:_|$)/.test(name);
    try {
        if (spawner.IsSpawning === true || spawner.IsSpawning === 1) return "defer:spawn-pending";
        const info = spawner.SpawnInfo;
        if (info && (info.bHiddenByDefault === true || info.bHiddenByDefault === 1)) return "hidden-by-default";
        if (pawn.bHidden === true || pawn.bHidden === 1) return "hidden-actor";
        if (info) {
            for (const field of ["IdleStateData", "DefaultBehaviorTree"]) {
                const obj = info[field];
                const configName = obj ? String(obj.GetName()) : "";
                // Existing catalog has AST_Ambush, *WithHidePoint and monk Intro trees.
                if (/Ambush|HidePoint|Intro/i.test(configName)) return "special-behavior:" + configName;
            }
        } else if (monk) {
            return "monk-config-unavailable";
        }
        // A rooftop/monk ambush may reveal its actor only on combat activation.
        // Never tear down any actor whose encounter has already entered combat.
        const group = spawner.MobGroup;
        if (group && (group.IsCombating === true || group.IsCombating === 1)) return "active-encounter";
    } catch (e) {
        // Unknown safety state is not permission to despawn a potentially scripted actor.
        return "safety-read-failed";
    }
    return "";
}
function preserveSpawner(spawner, name, reason) {
    const key = unitKey(spawner);
    if (key) state.protectedSpawners[key] = reason;
    diagLog("preserved original: spawner=" + key + " source=" + name + " reason=" + reason);
}
function tagOf(name) {
    const t = new UE.GameplayTag();
    t.TagName = name;
    return t;
}
function attr(name) {
    if (state.attrCache[name]) return state.attrCache[name];
    let a = null;
    try { a = UE.PBZBlueprintFunctionLibrary.MakeAttribute(name, UE.BasicAttributeSet.StaticClass()); } catch (e) { }
    state.attrCache[name] = a;
    return a;
}
function readAttr(a, name) {
    const at = attr(name);
    if (!at) return NaN;
    try { return UE.PBZBlueprintFunctionLibrary.GetAttributeFromCharacter(a, at); } catch (e) { return NaN; }
}
function writeAttr(a, name, v) {
    const at = attr(name);
    if (!at) return false;
    try { UE.AttributeUtils.ModifyCharacterAttributeValue(a, at, UE.EGameplayModOp.Override, v); return true; }
    catch (e) { if (!state.err) { state.err = String(e); log("write failed: " + e); } return false; }
}
function captureStats(pawn) {
    const max = readAttr(pawn, "Health_Max");
    if (!isFinite(max) || max <= 0) return null;
    const hp = readAttr(pawn, "Health");
    const shMax = readAttr(pawn, "Shachi_Max");
    const sh = readAttr(pawn, "Shachi");
    const miti = {};
    for (const n of MITI_NAMES) {
        const v = readAttr(pawn, n);
        if (isFinite(v)) miti[n] = v;
    }
    return {
        max: max,
        hp: isFinite(hp) && hp >= 0 ? Math.min(hp, max) : max,
        shMax: isFinite(shMax) && shMax > 0 ? shMax : 0,
        sh: isFinite(sh) && sh >= 0 ? sh : 0,
        miti: miti
    };
}
function isAlivePawn(p) {
    try {
        if (typeof p.IsAlive === "function") return !!p.IsAlive();
    } catch (e) { }
    try {
        if (typeof p.IsAlive === "boolean") return p.IsAlive;
    } catch (e) { }
    try {
        const h = readAttr(p, "Health");
        if (isFinite(h)) return h > 0;
    } catch (e) { }
    return true;
}
function tolOf(v) { return Math.max(1, v * SYNC_TOL_RATIO); }
// flags: { writeHp, strictHp, writeSh, strictSh }；只写请求的资源，分别校验
function applyStats(pawn, s, f) {
    const maxNow = readAttr(pawn, "Health_Max");
    if (!isFinite(maxNow) || maxNow <= 0) return { ok: false, reason: "max-unready" };
    writeAttr(pawn, "Health_Max", s.max);

    const wantHp = Math.min(s.hp, s.max);
    if (f.writeHp) writeAttr(pawn, "Health", wantHp);
    const hpBack = readAttr(pawn, "Health");

    let shOk = true;
    if (s.shMax > 0) {
        writeAttr(pawn, "Shachi_Max", s.shMax);
        const wantSh = Math.min(s.sh, s.shMax);
        if (f.writeSh) writeAttr(pawn, "Shachi", wantSh);
        const shBack = readAttr(pawn, "Shachi");
        const shMaxBack = readAttr(pawn, "Shachi_Max");
        const shTol = tolOf(s.shMax);
        const shRangeOk = isFinite(shBack) && shBack >= 0 && shBack <= s.shMax * 1.02;
        shOk = isFinite(shMaxBack) && Math.abs(shMaxBack - s.shMax) <= shTol
            && (f.strictSh
                ? (isFinite(shBack) && Math.abs(shBack - wantSh) <= shTol)
                : shRangeOk);
    }

    const back = readAttr(pawn, "Health_Max");
    const maxOk = isFinite(back) && Math.abs(back - s.max) <= tolOf(s.max);
    const hpRangeOk = isFinite(hpBack) && hpBack >= 0 && hpBack <= s.max * 1.02;
    const hpOk = f.strictHp
        ? (isFinite(hpBack) && Math.abs(hpBack - wantHp) <= tolOf(wantHp))
        : hpRangeOk;
    const ok = maxOk && hpOk && shOk;
    return { ok: ok, maxOk: maxOk, hpOk: hpOk, shOk: shOk,
             reason: ok ? "" : ("max=" + maxOk + " hp=" + hpOk + " sh=" + shOk) };
}
function stripBossTag(a) {
    try {
        for (const t of STRIP_TAGS) UE.PBZAbilityBlueprintLibrary.RemoveLooseGameplayTag(a, tagOf(t));
        state.stripped++;
    } catch (e) {
        if (!state.err) { state.err = String(e); log("strip failed: " + e); }
    }
}
function ensureClasses() {
    if (state.targetClass === null) {
        try { state.targetClass = UE.Class.Load(TARGET_PATH) || null; } catch (e) { state.targetClass = null; }
        log("target class: " + (state.targetClass ? "ok" : "nil"));
    }
    if (!state.spawnerClass) {
        try { state.spawnerClass = UE.Class.Load(SPAWNER_PATH) || null; } catch (e) { state.spawnerClass = null; }
        log("spawner class: " + (state.spawnerClass ? "ok" : "nil"));
    }
    if (!state.softBoss) {
        try {
            const scp = UE.KismetSystemLibrary.MakeSoftClassPath(TARGET_PATH);
            state.softBoss = UE.KismetSystemLibrary.Conv_SoftClassPathToSoftClassRef(scp) || null;
        } catch (e) { log("soft class ref threw: " + e); state.softBoss = null; }
        log("soft boss class: " + (state.softBoss ? "ok" : "nil"));
    }
}

// 按最近 convStats 位置套数值。
// hp / sh 的初始化分开记录（resInitHp / resInitSh）：一项越界只写那一项，
// 另一项合法资源不会被恢复；所有尝试分支统一计数/放弃。
function applyStatsByPosition(golds, level) {
    if (state.convStats.length === 0) return 0;
    let applied = 0;
    let attemptsLeft = MAX_APPLY_PER_TICK;
    const seen = new Set();
    for (const g of golds) {
        if (!g) continue;
        if (hasTag(g, UNIT_DONE_TAG)) continue;
        if (nearArena(level, locOf(g))) continue;
        const key = unitKey(g);
        if (!key || state.syncGiveUp[key]) continue;
        if (seen.has(key)) continue;
        seen.add(key);
        const gl = locOf(g);
        if (!gl) continue;
        let best = null, bestD = PAIR_RADIUS * PAIR_RADIUS;
        for (const c of state.convStats) {
            const dx = gl.X - c.x, dy = gl.Y - c.y, dz = gl.Z - c.z;
            const d = dx * dx + dy * dy + dz * dz;
            if (d < bestD) { bestD = d; best = c; }
        }
        if (!best) continue;
        if (attemptsLeft <= 0) break;

        const wants = best.stats;
        const shApplicable = wants.shMax > 0;
        const maxNow = readAttr(g, "Health_Max");
        const hpNow = readAttr(g, "Health");
        const shMaxNow = readAttr(g, "Shachi_Max");
        const shNow = readAttr(g, "Shachi");
        const maxOk = isFinite(maxNow) && Math.abs(maxNow - wants.max) <= tolOf(wants.max);
        const shMaxOk = !shApplicable
            || (isFinite(shMaxNow) && Math.abs(shMaxNow - wants.shMax) <= tolOf(wants.shMax));
        const hpOut = !isFinite(hpNow) || hpNow < 0 || hpNow > wants.max * 1.02;
        const shOut = shApplicable && (!isFinite(shNow) || shNow < 0 || shNow > wants.shMax * 1.02);
        const initHp = !!state.resInitHp[key];
        const initSh = !shApplicable || !!state.resInitSh[key];

        // 已稳定：Max/杀气上限正确，资源在范围内
        if (initHp && initSh && maxOk && shMaxOk && !hpOut && !shOut) continue;

        attemptsLeft--;
        const tries = state.syncTries[key] || 0;
        // 越界就允许写（含已初始化后上限漂移导致 hp>max）；只有“未初始化且越界”才要求精确命中
        const writeHp = hpOut;
        const writeSh = shApplicable && shOut;
        const flags = {
            writeHp: writeHp, strictHp: writeHp && !initHp,
            writeSh: writeSh, strictSh: writeSh && !initSh
        };
        const res = applyStats(g, wants, flags);
        state.syncTries[key] = tries + 1;

        if (res.ok) {
            if (!addTag(g, UNIT_DONE_TAG)) state.stats.tagFail++;
            if (!shApplicable && !best.shNaLogged) {
                best.shNaLogged = true;
                log("shachi n/a (source Shachi_Max=0); only max+health verified: " + key);
            }
            state.resInitHp[key] = true;
            if (shApplicable) state.resInitSh[key] = true;
            state.synced[key] = true;
            // Snapshot the record actually used, not whichever spawner is nearest after movement.
            state.syncedSources[key] = {
                max: wants.max, shMax: wants.shMax,
                sourceClass: best.sourceClass || "unknown",
                spawner: best.spawner || "unknown"
            };
            delete state.syncTries[key];
            if (!writeHp && !writeSh) {
                state.stats.lateMatch++;
                log("late match accepted (damaged): " + key);
            }
            best.applied = (best.applied || 0) + 1;
            state.copied++;
            applied++;
            log("hp copied: " + wants.max.toFixed(0) + " unit=" + key
                + " source=" + (best.sourceClass || "unknown")
                + " spawner=" + (best.spawner || "unknown")
                + " actualMax=" + readAttr(g, "Health_Max") + " actualHp=" + readAttr(g, "Health")
                + " actualShMax=" + readAttr(g, "Shachi_Max") + " actualSh=" + readAttr(g, "Shachi")
                + " (dist2=" + Math.round(bestD) + ")");
        } else {
            state.stats.applyFail++;
            if (state.stats.applyFail <= 10) {
                state.stats.lastReason = res.reason || "";
                diagLog("apply-fail: " + key + " reason=" + (res.reason || "")
                    + " strictHp=" + flags.strictHp + " strictSh=" + flags.strictSh);
            }
            if (state.syncTries[key] >= APPLY_MAX_TRIES) {
                state.syncGiveUp[key] = true;
                state.syncGiveUpAt[key] = Date.now();
                delete state.syncTries[key];
                log("hp sync gave up: " + key + " (" + (res.reason || "") + ")");
                pruneGiveUp();
            }
        }
    }
    return applied;
}

// 诊断（写 MoYuanDiag.log，不动主日志）：
//   1) convStats 为空时，仍报告目标单位的 Max，避免“完全漏报”；
//   2) 非 Done 单位：报告“不在任何 convStats 半径内”的距离与 Max；
//   3) Done 单位只与成功同步时保存的源数值比较；不再以移动后的最近点判漂移。
function nearestStat(g) {
    const gl = locOf(g);
    if (!gl) return null;
    let best = null, bestD = Infinity;
    for (const c of state.convStats) {
        const dx = gl.X - c.x, dy = gl.Y - c.y, dz = gl.Z - c.z;
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bestD) { bestD = d; best = c; }
    }
    return { best: best, d: bestD };
}
function reportUnmatched(golds, level) {
    if (!state.diagSeen) state.diagSeen = {};
    if (Object.keys(state.diagSeen).length > 4096) state.diagSeen = {};
    const seen = state.diagSeen;
    for (const g of golds) {
        if (!g) continue;
        if (nearArena(level, locOf(g))) continue;
        const key = unitKey(g);
        if (!key) continue;
        const done = hasTag(g, UNIT_DONE_TAG);

        if (state.convStats.length === 0) {
            const kNo = "no-records:" + key;
            if (seen[kNo]) continue;
            seen[kNo] = true;
            const mx = readAttr(g, "Health_Max");
            diagLog("no-records: " + key + " done=" + done + " class=" + className(g)
                + " max=" + (isFinite(mx) ? mx.toFixed(0) : "n/a"));
            continue;
        }
        const n = nearestStat(g);
        if (!n) continue;
        if (!done) {
            if (n.d <= PAIR_RADIUS * PAIR_RADIUS) continue;
            const kUn = "unmatched:" + key;
            if (seen[kUn]) continue;
            seen[kUn] = true;
            const mx = readAttr(g, "Health_Max");
            diagLog("unmatched: " + key + " class=" + className(g)
                + " dist=" + Math.round(Math.sqrt(n.d))
                + " max=" + (isFinite(mx) ? mx.toFixed(0) : "n/a")
                + " nearest=" + (n.best ? n.best.stats.max.toFixed(0) : "n/a"));
        } else {
            const origin = state.syncedSources[key];
            // Only the successful sync snapshot can establish a subsequent max change.
            // An untracked Done actor is evidence of missing provenance, not confirmed drift.
            if (!origin) {
                const k = "done-untracked:" + key;
                if (!seen[k]) { seen[k] = true; diagLog("done-untracked: " + key); }
                continue;
            }
            const mx = readAttr(g, "Health_Max");
            if (!isFinite(mx) || Math.abs(mx - origin.max) > tolOf(origin.max)) {
                const k = "synced-max-drift:" + key;
                if (seen[k]) continue;
                seen[k] = true;
                diagLog("synced-max-drift: " + key + " max=" + mx + " expected=" + origin.max
                    + " source=" + origin.sourceClass + " spawner=" + origin.spawner);
            }
        }
    }
}

function tick() {
    if (!REPLACE_ENABLED) return;
    state.tickNo = (state.tickNo || 0) + 1;
    const gi = puerts.argv.getByName("GameInstance");
    if (!gi) return;
    const ctx = UE.GameplayStatics.GetPlayerCharacter(gi, 0) || gi;
    ensureClasses();
    if (!state.targetClass || !state.softBoss || !state.spawnerClass) return;

    const level = currentLevel(ctx);
    const targetName = SETTINGS.replacement.className;

    // 目标类单位：摘 Boss 血条 + 找未处理的补数值
    const golds = enumerate(ctx, state.targetClass);
    let n = 0;
    for (const a of golds) {
        if (!a) continue;
        if (nearArena(level, locOf(a))) continue;
        stripBossTag(a);
        n++;
    }
    if (n && state.stripped === n) log("stripped " + n + " boss tag(s)");

    if (Date.now() >= state.readyAt) {
        applyStatsByPosition(golds, level);
        reportUnmatched(golds, level);

        const spawners = enumerate(ctx, state.spawnerClass);
        let convertsLeft = MAX_CONVERT_PER_TICK;
        let scanCommon = 0;
        for (const s of spawners) {
            if (!s) continue;
            if (hasTag(s, SPAWNER_DONE_TAG)) continue;
            if (state.protectedSpawners[unitKey(s)]) continue;
            let pawn = null;
            try { pawn = s.SpawnedAI; } catch (e) { continue; }
            if (!pawn) continue;
            if (!isAlivePawn(pawn)) continue;   // 已死/尸体不上：否则等于把打死的小怪又刷出来
            const pcls = className(pawn);
            if (pcls === targetName) continue;
            if (isBombMob(pcls)) { preserveSpawner(s, pcls, "bomb-family-excluded"); continue; }
            if (!isCommonMob(pcls)) continue;
            const safety = replacementSafetyReason(s, pawn, pcls);
            if (safety.startsWith("defer:")) continue;
            if (safety) { preserveSpawner(s, pcls, safety); continue; }
            scanCommon++;
            const sl = locOf(s);
            if (nearArena(level, sl)) continue;
            if (convertsLeft <= 0) continue;
            const stats = captureStats(pawn);
            if (!stats) continue;
            try { s.Class = state.softBoss; } catch (e) { state.stats.convertFail++; if (!state.err) { state.err = String(e); log("class write failed: " + e); } continue; }
            try { s.Despawn(); } catch (e) { state.stats.convertFail++; if (!state.err) log("despawn failed: " + e); }
            try {
                s.Respawn();
                if (!addTag(s, SPAWNER_DONE_TAG)) state.stats.tagFail++;
                state.convStats.push({ x: sl.X, y: sl.Y, z: sl.Z, stats: stats, applied: 0,
                    sourceClass: pcls, spawner: unitKey(s) });
                convertsLeft--;
                state.converted++;
                log("converted " + pcls + " -> " + SETTINGS.replacement.className + " (hp " + stats.max.toFixed(0) + ")");
            } catch (e) { state.stats.convertFail++; log("respawn failed: " + e); }
        }

        if (state.tickNo % 60 === 0) {
            log("summary conv=" + state.convStats.length + " copied=" + state.copied
                + " applyFail=" + state.stats.applyFail + " tagFail=" + state.stats.tagFail
                + " convertFail=" + state.stats.convertFail + " lateMatch=" + state.stats.lateMatch + " giveUp=" + Object.keys(state.syncGiveUp).length);
        }
        const scanKey = "spawners=" + spawners.length + " common=" + scanCommon + " conv=" + state.convStats.length;
        if (scanKey !== state.lastScan) {
            state.lastScan = scanKey;
            log("scan: " + scanKey);
        }
    }
}

log("started v3.13-configurable (spawner class rewrite + hp copy + diag log), poll " + POLL_MS + " ms)");
diagLog("session start v3.13-configurable at " + new Date().toISOString());
log("config replacement enabled=" + REPLACE_ENABLED + " target=" + TARGET_PATH);
for (const warning of SETTINGS.warnings) log("config warning: " + warning);
if (REPLACE_ENABLED) setInterval(tick, POLL_MS);
