"use strict";
// PBZMoYuanBirthProbe v8 — 只读探针：出生事件绑定生命周期（解绑/失败保留/去重）、回调 Pawn 身份、延迟复查。
// 只写 ProjectPBZ/Content/Paks/~mods/BirthProbe.log，不改任何单位/刷怪器状态。
const UE = require("ue");
const puerts = require("puerts");

const TARGET_PATH = "/PBZCombatAsset/ActorData/Mobs/067_MoTian/BP_Monster_MoTian_LongZhu_04.BP_Monster_MoTian_LongZhu_04_C";
const SPAWNER_PATH = "/SGameAI/Tools/Spawner/BP_AISpawner.BP_AISpawner_C";
const POLL_MS = 3000;
const MAX_BIND = 256; // Cover the observed 210 spawners, including the actual conversion points.
const DELAYED_MS = 1500;

const state = globalThis.__pbzBirthProbe = globalThis.__pbzBirthProbe || {
    lines: [], bindings: [], pending: [], fired: 0, level: "", levelAt: 0,
    targetClass: null, spawnerClass: null, noFireLogged: false, lastCompare: ""
};

function flush() {
    try {
        const rel = UE.BlueprintPathsLibrary.ProjectContentDir() + "Paks/~mods/BirthProbe-v8.log";
        const path = UE.BlueprintPathsLibrary.ConvertRelativePathToFull(rel, "");
        UE.EasyCsv.SaveStringToFileWithFullPath(state.lines.join("\r\n") + "\r\n", path);
    } catch (e) { }
}
function log(msg) {
    if (state.lines.length >= 2000) state.lines.shift();
    state.lines.push(new Date().toISOString().substring(11, 23) + " " + String(msg).replace(/[^\x00-\x7f]/g, "?"));
    flush();
}
function className(o) { try { return String(o.GetClass().GetName()); } catch (e) { return ""; } }
function nameOf(o) {
    if (!o) return "nil";
    try { if (typeof o.GetPathName === "function") return String(o.GetPathName()); } catch (e) { }
    try { return String(o.GetName()); } catch (e) { return "?"; }
}
function enumerate(ctx, cls) {
    const out = [];
    try { UE.GameplayStatics.GetAllActorsOfClass(ctx, cls, out); } catch (e) { return []; }
    const toArr = (w) => {
        const r = [];
        const n = typeof w.Num === "function" ? w.Num() : (w.length || 0);
        for (let i = 0; i < n; i++) r.push(typeof w.Get === "function" ? w.Get(i) : w[i]);
        return r;
    };
    if (out && typeof out.Num === "function") return toArr(out);
    if (Array.isArray(out)) {
        if (out.length === 1 && out[0] && typeof out[0].Num === "function") return toArr(out[0]);
        return out;
    }
    return [];
}
function fieldPawn(s) { try { return s.SpawnedAI || null; } catch (e) { return null; } }
function getterPawn(s) {
    try { if (typeof s.GetSpawnedAI === "function") return s.GetSpawnedAI() || null; } catch (e) { }
    return null;
}

// 解绑：成功才移除记录；失败则保留并标记 stuck，防止重复 Add
function unbindBinding(b, reason) {
    let ok = false;
    try {
        if (b.delegate && typeof b.delegate.Remove === "function") {
            b.delegate.Remove(b.handler);
            ok = true;
        }
    } catch (e) { log("unbind threw: " + b.name + " : " + e); }
    if (ok) {
        const i = state.bindings.indexOf(b);
        if (i >= 0) state.bindings.splice(i, 1);
        log("unbound ok (" + reason + "): " + b.name);
    } else {
        b.stuck = true;
        log("unbind failed, keep binding to block duplicate Add (" + reason + "): " + b.name);
    }
}

function record(where, spawner, cbPawn) {
    const f = fieldPawn(spawner);
    const g = getterPawn(spawner);
    log(where + " spawner=" + nameOf(spawner)
        + " | cb=" + nameOf(cbPawn) + " (" + className(cbPawn) + ")"
        + " | field=" + nameOf(f) + " (" + className(f) + ")"
        + " | getter=" + nameOf(g) + " (" + className(g) + ")"
        + " | eq cb==field " + (cbPawn && f ? (cbPawn === f) : "n/a")
        + " cb==getter " + (cbPawn && g ? (cbPawn === g) : "n/a")
        + " cbName==fieldName " + (nameOf(cbPawn) === nameOf(f))
        + " cbName==getterName " + (nameOf(cbPawn) === nameOf(g))
        + " isTarget=" + (className(cbPawn).indexOf("LongZhu_04") >= 0));
}
function onFired(tag, spawner, pawn) {
    state.fired++;
    try { record(tag + " #" + state.fired, spawner, pawn); } catch (e) { log(tag + " record failed: " + e); }
    try {
        state.pending.push({ at: Date.now() + DELAYED_MS, where: "delayed", spawner: spawner, cbName: nameOf(pawn) });
    } catch (e) { }
}

function bindOne(s, idx) {
    const nm = nameOf(s);
    if (state.bindings.some(b => b.name === nm)) { log("skip bind (already bound): " + nm); return; }
    const label = "spawner#" + idx + " " + nm;
    let complete = null, base = null;
    try { complete = s.CompleteSpawnAI || null; } catch (e) { }
    try { base = s.OnSpawnFinish || null; } catch (e) { }
    log(label + " delegates: CompleteSpawnAI=" + (complete ? "yes" : "no")
        + " OnSpawnFinish=" + (base ? "yes" : "no")
        + " GetSpawnedAI=" + (typeof s.GetSpawnedAI === "function" ? "method" : "no")
        + " SetClassToSpawn=" + (typeof s.SetClassToSpawn === "function" ? "method" : "no"));
    if (complete && typeof complete.Add === "function") {
        const h = (pawn) => onFired("CompleteSpawnAI", s, pawn);
        try {
            complete.Add(h);
            state.bindings.push({ spawner: s, name: nm, delegate: complete, handler: h, stuck: false });
            log(label + " bound CompleteSpawnAI");
        } catch (e) { log(label + " bind CompleteSpawnAI failed: " + e); }
    }
    if (base && typeof base.Add === "function") {
        const h = (sp, pawn) => onFired("OnSpawnFinish", sp || s, pawn);
        try {
            base.Add(h);
            state.bindings.push({ spawner: s, name: nm, delegate: base, handler: h, stuck: false });
            log(label + " bound OnSpawnFinish");
        } catch (e) { log(label + " bind OnSpawnFinish failed: " + e); }
    }
}

function currentLevel(ctx) {
    const now = Date.now();
    if (state.level && now - state.levelAt < 3000) return state.level;
    let lvl = "";
    try { lvl = String(UE.GameplayStatics.GetCurrentLevelName(ctx, true)); } catch (e) { }
    state.levelAt = now;
    if (lvl && lvl !== state.level) {
        state.level = lvl;
        for (const b of state.bindings.slice()) unbindBinding(b, "level change");
        state.pending = [];
        state.fired = 0; state.noFireLogged = false; state.loggedCount = false;
        log("level: " + lvl + " (rebind), stuck bindings=" + state.bindings.filter(b => b.stuck).length);
    }
    return state.level;
}

function tick() {
    const gi = puerts.argv.getByName("GameInstance");
    if (!gi) return;
    const ctx = UE.GameplayStatics.GetPlayerCharacter(gi, 0) || gi;

    if (!state.targetClass) { try { state.targetClass = UE.Class.Load(TARGET_PATH) || null; } catch (e) { } }
    if (!state.spawnerClass) {
        try { state.spawnerClass = UE.Class.Load(SPAWNER_PATH) || null; } catch (e) { }
        log("classes: target=" + (state.targetClass ? "ok" : "nil") + " spawner=" + (state.spawnerClass ? "ok" : "nil"));
    }
    if (!state.spawnerClass) return;

    currentLevel(ctx);
    const spawners = enumerate(ctx, state.spawnerClass);
    if (!state.loggedCount) {
        state.loggedCount = true;
        log("spawners=" + spawners.length + " sample=" + nameOf(spawners[0])
            + " type=" + (spawners[0] ? className(spawners[0]) : "nil"));
    }
    const cur = spawners.slice(0, MAX_BIND);
    const curByName = new Map();
    for (const s of cur) { const n = nameOf(s); if (!curByName.has(n)) curByName.set(n, s); }

    // 逐个检查全部 binding：离开本轮枚举 / 同名对象被替换 / IsValid 为 false
    for (const b of state.bindings.slice()) {
        if (b.stuck) continue;
        const same = curByName.get(b.name);
        let invalid = false;
        if (!same) invalid = true;
        else if (same !== b.spawner) invalid = true;
        else {
            try {
                if (typeof b.spawner.IsValid === "function" && !b.spawner.IsValid()) invalid = true;
            } catch (e) { invalid = true; }
        }
        if (invalid) unbindBinding(b, "left/replaced/invalid");
    }

    // 重新绑定：只为当前枚举里尚未绑定（名字不存在于 bindings，含 stuck）的对象
    const boundNames = new Set(state.bindings.map(b => b.name));
    cur.forEach((s, i) => { if (!boundNames.has(nameOf(s))) bindOne(s, i); });

    const now = Date.now();
    const remain = [];
    for (const p of state.pending) {
        if (now < p.at) { remain.push(p); continue; }
        try {
            const curObj = curByName.get(nameOf(p.spawner));
            const stuck = state.bindings.some(b => b.spawner === p.spawner && b.stuck);
            let ok = !!curObj && curObj === p.spawner;
            if (ok) {
                try { if (typeof p.spawner.IsValid === "function" && !p.spawner.IsValid()) ok = false; }
                catch (e) { ok = false; }
            }
            if (!ok || stuck) {
                log(p.where + " skip (left/replaced/stuck/invalid): " + nameOf(p.spawner));
                continue;
            }
            const f = fieldPawn(p.spawner);
            const g = getterPawn(p.spawner);
            log(p.where + " cbName=" + p.cbName
                + " | field=" + nameOf(f) + " (" + className(f) + ")"
                + " | getter=" + nameOf(g) + " (" + className(g) + ")"
                + " | cbName==fieldName " + (p.cbName === nameOf(f))
                + " | cbName==getterName " + (p.cbName === nameOf(g)));
        } catch (e) { log(p.where + " check failed: " + e); }
    }
    state.pending = remain;

    if (state.bindings.length > 0 && state.fired === 0 && !state.noFireLogged) {
        state.noFireLogged = true;
        log("note: bindings=" + state.bindings.length + " fired=0 — 没观察到回调不等于事件不可用");
    }

    const sampleBind = state.bindings.find(b => !b.stuck);
    if (sampleBind && now % 9000 < POLL_MS) {
        const s = sampleBind.spawner;
        const key = nameOf(fieldPawn(s)) + "|" + nameOf(getterPawn(s));
        if (key !== state.lastCompare) {
            state.lastCompare = key;
            log("compare samples field=" + nameOf(fieldPawn(s)) + " getter=" + nameOf(getterPawn(s)));
        }
    }
}

log("started birth probe v8 (poll " + POLL_MS + " ms), read-only, log=BirthProbe-v8.log");
setInterval(tick, POLL_MS);
