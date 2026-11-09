"use strict";
// PBZLowHPBuff v3.13 — 开关、最大效果和血量阈值见共享 config.json。
//   * 默认减伤：满血 0%，0 血 80%（线性）
//   * 默认增伤：满血 0%，0 血 +60%（线性）
//
// 实现方式：每 250ms 读一次玩家 Health / Health_Max，算出缺失血量比例，
// 然后用游戏自己的 UAttributeUtils.ModifyCharacterAttributeValue(..., Override, v)
// 把两个属性写到目标值。属性语义在运行时自动判定（见 detectMode）：
//   - TakenReductionMultiplier_* 基线 ≈1.0 → 直接乘数（写 1-减伤）
//   - 基线 ≈0.0 → 减伤比例（写 减伤）
//   - Amplification_* 基线 ≈0.0 → 加法系数（写 基线+增伤）
//
// 日志：ProjectPBZ/Content/Paks/~mods/LowHPBuff.log
const UE = require("ue");
const puerts = require("puerts");
const SETTINGS = require("../PBZMoYuanSettings/settings");
const BUFF = SETTINGS.lowHpBuff;

const ENABLED = BUFF.enabled;
const POLL_MS = 250;
// Percentages and HP thresholds come from the shared config.json.
const WRITE_EPSILON = 0.005;  // 值变化小于这个就不写，避免刷 GE

// 覆盖所有主要伤害类型；缺失的属性和会直接跳过（写失败不会崩，游戏侧返回空）
// 游戏自己的饰品（GE_Accessory_Attack / HealthResistance）只改这两个，说明它们覆盖物理/元素两类伤害
const DR_ATTRS = !BUFF.damageReduction.enabled || BUFF.damageReduction.maxPercent === 0 ? [] : [
    "TakenReductionMultiplier_Physical",
    "TakenReductionMultiplier_Elemental",
];
const DMG_ATTRS = !BUFF.damageBonus.enabled || BUFF.damageBonus.maxPercent === 0 ? [] : [
    "Amplification_Physical",
    "Amplification_Elemental",
];

const state = globalThis.__pbzLowHpBuff = globalThis.__pbzLowHpBuff || {
    lines: [], pawn: null, cls: null,
    drAttrs: null, dmgAttrs: null,
    drBase: {}, dmgBase: {},           // 每属性的基线
    drMode: null, dmgMode: null,       // "multiplier" | "fraction"
    last: {}, applied: 0, err: "",
    detectTries: 0, lastDetectAt: 0, verifyFail: 0, lastWriteAttempt: {}, lastFailAt: {}
};

function flush() {
    try {
        const rel = UE.BlueprintPathsLibrary.ProjectContentDir() + "Paks/~mods/LowHPBuff.log";
        const path = UE.BlueprintPathsLibrary.ConvertRelativePathToFull(rel, "");
        UE.EasyCsv.SaveStringToFileWithFullPath(state.lines.join("\r\n") + "\r\n", path);
    } catch (e) { }
}

function log(msg) {
    if (state.lines.length >= 120) return;
    state.lines.push(new Date().toISOString().substring(11, 23) + " " + String(msg).replace(/[^\x00-\x7f]/g, "?"));
    flush();
}

function makeAttr(name, cls) {
    try { return UE.PBZBlueprintFunctionLibrary.MakeAttribute(name, cls); } catch (e) { return null; }
}

function readAttr(pawn, attr) {
    try { return UE.PBZBlueprintFunctionLibrary.GetAttributeFromCharacter(pawn, attr); } catch (e) { return NaN; }
}

function writeAttr(pawn, attr, value) {
    try {
        UE.AttributeUtils.ModifyCharacterAttributeValue(pawn, attr, UE.EGameplayModOp.Override, value);
        return true;
    } catch (e) {
        if (!state.err) { state.err = String(e); log("write failed: " + e); }
        return false;
    }
}

function setup(pawn) {
    state.cls = UE.BasicAttributeSet.StaticClass();
    state.drAttrs = DR_ATTRS.map(n => makeAttr(n, state.cls)).filter(Boolean);
    state.dmgAttrs = DMG_ATTRS.map(n => makeAttr(n, state.cls)).filter(Boolean);
    state.drBase = {}; state.dmgBase = {};
    state.last = {};
    state.drMode = null; state.dmgMode = null;
    // 换 pawn 必须重置新增的初始化/节流状态，否则旧计数会永久压制重试
    state.detectTries = 0; state.lastDetectAt = 0;
    state.verifyFail = 0; state.lastWriteAttempt = {}; state.lastFailAt = {};
    // 属性列表为空的分组直接视为“无需处理”，不要让它永远 null 挡住写入
    if (state.drAttrs.length === 0) state.drMode = "none";
    if (state.dmgAttrs.length === 0) state.dmgMode = "none";
    log("attrs: dr=" + state.drAttrs.length + " dmg=" + state.dmgAttrs.length);
}

// 读基线推断属性语义。每组必须“所有有效句柄都读到有限值”才算就绪；
// 零是合法基线，不能用均值把未就绪项掩盖掉。
function detectModes(pawn) {
    function readGroup(attrs) {
        if (attrs.length === 0) return { ok: true, none: true, vals: [] };
        const vals = [];
        for (let i = 0; i < attrs.length; i++) {
            const v = readAttr(pawn, attrs[i]);
            if (!isFinite(v)) return { ok: false, none: false, vals: null };
            vals.push(v);
        }
        return { ok: true, none: false, vals: vals };
    }

    if (state.drAttrs.length === 0) state.drMode = "none";
    if (state.dmgAttrs.length === 0) state.dmgMode = "none";

    const dr = readGroup(state.drAttrs);
    if (dr.ok && !dr.none && state.drMode === null) {
        state.drBase = {};
        let sum = 0;
        for (let i = 0; i < dr.vals.length; i++) { state.drBase[i] = dr.vals[i]; sum += dr.vals[i]; }
        // 交叉验证：易伤乘数基线为 1，可区分“乘数类”和“比例类”
        let vuln = 0, vulnN = 0;
        for (const n of ["TakenVulnerabilityMultiplier_Physical", "TakenVulnerabilityMultiplier_Elemental"]) {
            const a = makeAttr(n, state.cls);
            if (!a) continue;
            const v = readAttr(pawn, a);
            if (isFinite(v)) { vuln += v; vulnN++; }
        }
        const vulnAvg = vulnN > 0 ? vuln / vulnN : NaN;
        const allZero = dr.vals.every(v => v === 0);
        if (allZero && !(isFinite(vulnAvg) && vulnAvg > 0.5)) {
            // 全零且没有易伤交叉证据：不能确定是“比例类基线 0”还是“还没初始化”，
            // 猜成比例类会在满血时写 0 → 可能满血无敌，因此维持未就绪并继续重试。
            log("DR baseline all zero and no vuln cross-check; mode undecided (needs probe)");
        } else {
            if (isFinite(vulnAvg) && vulnAvg > 0.5) state.drMode = "multiplier";
            else state.drMode = (sum / dr.vals.length) > 0.5 ? "multiplier" : "fraction";
            log("DR baseline=[" + dr.vals.join(",") + "] vulnAvg="
                + (isFinite(vulnAvg) ? vulnAvg.toFixed(3) : "n/a") + " mode=" + state.drMode);
        }
    } else if (!dr.ok) {
        log("DR not ready (some attr unreadable)");
    }

    const dmg = readGroup(state.dmgAttrs);
    if (dmg.ok && !dmg.none && state.dmgMode === null) {
        state.dmgBase = {};
        let sum = 0;
        for (let i = 0; i < dmg.vals.length; i++) { state.dmgBase[i] = dmg.vals[i]; sum += dmg.vals[i]; }
        state.dmgMode = (sum / dmg.vals.length) > 0.5 ? "multiplier" : "fraction";
        log("DMG baseline=[" + dmg.vals.join(",") + "] mode=" + state.dmgMode);
    } else if (!dmg.ok) {
        log("DMG not ready (some attr unreadable)");
    }
}

function modesReady() {
    return (state.drAttrs.length === 0 || state.drMode !== null)
        && (state.dmgAttrs.length === 0 || state.dmgMode !== null);
}

function tick() {
    if (!ENABLED) return;
    const gi = puerts.argv.getByName("GameInstance");
    if (!gi) return;
    let pawn = null;
    try { pawn = UE.GameplayStatics.GetPlayerCharacter(gi, 0); } catch (e) { }
    if (!pawn) return;

    if (state.pawn !== pawn) {
        state.pawn = pawn;
        setup(pawn);
        detectModes(pawn);
    }

    const healthAttr = makeAttr("Health", state.cls);
    const maxAttr = makeAttr("Health_Max", state.cls);
    const health = readAttr(pawn, healthAttr);
    const maxHealth = readAttr(pawn, maxAttr);
    if (!isFinite(health) || !isFinite(maxHealth) || maxHealth <= 0) return;

    // 初始化未完成前不写任何属性：避免“增伤先成功→减伤永不重测”的半初始化状态
    if (!modesReady()) {
        const now = Date.now();
        if (now - state.lastDetectAt > 1000) {
            state.detectTries++;
            state.lastDetectAt = now;
            if (state.detectTries === 1 || state.detectTries % 10 === 0) {
                log("modes not ready yet (try " + state.detectTries + "), writes paused");
            }
            detectModes(pawn);
        }
        if (!modesReady()) return;
    }

    let missing = 1 - health / maxHealth;
    if (missing < 0) missing = 0;
    if (missing > 1) missing = 1;

    // 量化到 2% 步进：既保留手感，又避免每次血量抖动都写一次属性
    const dr = SETTINGS.effectFraction(health / maxHealth, BUFF.damageReduction);
    const dmg = SETTINGS.effectFraction(health / maxHealth, BUFF.damageBonus);

    // 减伤
    if (state.drMode === "multiplier") {
        const v = 1 - dr;
        for (let i = 0; i < state.drAttrs.length; i++) writeIfChanged("dr" + i, pawn, state.drAttrs[i], v);
    } else if (state.drMode === "fraction") {
        for (let i = 0; i < state.drAttrs.length; i++) writeIfChanged("dr" + i, pawn, state.drAttrs[i], dr);
    }

    // 增伤
    for (let i = 0; i < state.dmgAttrs.length; i++) {
        const base = isFinite(state.dmgBase[i]) ? state.dmgBase[i] : 0;
        let v;
        if (state.dmgMode === "multiplier") v = 1 + dmg;        // 基线 1 的乘法系数
        else v = base + dmg;                                    // 基线 0 的加法系数
        writeIfChanged("dmg" + i, pawn, state.dmgAttrs[i], v);
    }

    state.applied++;
    if (state.applied % 40 === 1) {
        // 回读校验：确认 Override 真的落到属性上了（游戏侧可能静默失败，必须读回来）
        let drActual = NaN, dmgActual = NaN;
        if (state.drAttrs.length > 0) drActual = readAttr(pawn, state.drAttrs[0]);
        if (state.dmgAttrs.length > 0) dmgActual = readAttr(pawn, state.dmgAttrs[0]);
        log("hp=" + health.toFixed(0) + "/" + maxHealth.toFixed(0) + " missing=" + missing.toFixed(2)
            + " dr=" + (dr * 100).toFixed(1) + "% dmg=+" + (dmg * 100).toFixed(1) + "%"
            + " | actualDr=" + (isFinite(drActual) ? drActual.toFixed(3) : "n/a")
            + " actualDmg=" + (isFinite(dmgActual) ? dmgActual.toFixed(3) : "n/a")
            + " mode=" + state.drMode + "/" + state.dmgMode);
    }
}

function writeIfChanged(key, pawn, attr, value) {
    const prev = state.last[key];
    if (prev !== undefined && Math.abs(prev - value) < WRITE_EPSILON) return;
    const now = Date.now();
    const lastTry = state.lastWriteAttempt[key] || 0;
    const failAt = state.lastFailAt[key] || 0;
    if (failAt && now - lastTry < 1000) return;  // 失败后限速 1 秒
    state.lastWriteAttempt[key] = now;
    if (!writeAttr(pawn, attr, value)) {
        state.lastFailAt[key] = now;   // 抛异常/拿不到 ASC 也要节流，不能静默重试
        return;
    }
    const back = readAttr(pawn, attr);
    const tol = Math.max(0.01, Math.abs(value) * 0.02);
    if (isFinite(back) && Math.abs(back - value) <= tol) {
        state.last[key] = value;
        delete state.lastFailAt[key];
    } else {
        state.verifyFail++;
        state.lastFailAt[key] = now;
        if (state.verifyFail <= 5) log("write not verified: " + key + " want=" + value.toFixed(3) + " got=" + back);
    }
}

log("started v3.13-configurable (enabled=" + ENABLED + ", poll " + POLL_MS + " ms)");
log("config lowHpBuff=" + JSON.stringify(BUFF));
for (const warning of SETTINGS.warnings) log("config warning: " + warning);
if (ENABLED) setInterval(tick, POLL_MS);
