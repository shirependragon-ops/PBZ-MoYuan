"use strict";

// Shared by the two mods. Read once per game session; never overwrite user settings.
const IDS = require("./monster-ids.json");
const DEFAULT_ID = "BP_Monster_MoTian_LongZhu_04_C";
function object(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
function normalizeSettings(raw, loadError) {
    const warnings = [];
    const root = object(raw);
    const replacement = object(root.replacement);
    const buff = object(root.lowHpBuff);
    function toggle(value, fallback, label) {
        if (value === undefined) return fallback;
        if (typeof value === "boolean") return value;
        warnings.push(label + " must be true/false; disabled");
        return false;
    }
    function effect(value, defaultMax, maxLimit, label) {
        const v = object(value);
        let enabled = toggle(v.enabled, true, label + ".enabled");
        if (value !== undefined && value !== v) {
            warnings.push(label + " must be an object; disabled");
            enabled = false;
        }
        const maxPercent = v.maxPercent === undefined ? defaultMax : v.maxPercent;
        const startHpPercent = v.startHpPercent === undefined ? 100 : v.startHpPercent;
        const fullHpPercent = v.fullHpPercent === undefined ? 0 : v.fullHpPercent;
        if (typeof maxPercent !== "number" || !Number.isFinite(maxPercent) || maxPercent < 0 || maxPercent > maxLimit
            || typeof startHpPercent !== "number" || !Number.isFinite(startHpPercent)
            || typeof fullHpPercent !== "number" || !Number.isFinite(fullHpPercent)
            || fullHpPercent < 0 || startHpPercent > 100 || startHpPercent <= fullHpPercent) {
            warnings.push(label + " invalid range: 0<=fullHpPercent<startHpPercent<=100; maxPercent 0.." + maxLimit + "; disabled");
            enabled = false;
        }
        return { enabled, maxPercent, startHpPercent, fullHpPercent };
    }
    let replaceEnabled = toggle(replacement.enabled, true, "replacement.enabled");
    const id = replacement.monsterId === undefined ? DEFAULT_ID : replacement.monsterId;
    let targetPath = typeof id === "string" && Object.prototype.hasOwnProperty.call(IDS, id) ? IDS[id] : null;
    if (typeof id === "string" && /^\/[A-Za-z0-9_\/]+\.[A-Za-z0-9_]+_C$/.test(id)) targetPath = id;
    if (typeof targetPath !== "string") {
        warnings.push("replacement.monsterId unknown/ambiguous; use a catalog ID or full asset class path; replacement disabled");
        replaceEnabled = false;
        targetPath = IDS[DEFAULT_ID];
    }
    const result = {
        replacement: { enabled: replaceEnabled, monsterId: id, targetPath, className: targetPath.split(".").pop() },
        lowHpBuff: {
            enabled: toggle(buff.enabled, true, "lowHpBuff.enabled"),
            damageReduction: effect(buff.damageReduction, 80, 100, "damageReduction"),
            damageBonus: effect(buff.damageBonus, 60, 1000, "damageBonus"),
        }, warnings,
    };
    if (root.replacement !== undefined && root.replacement !== replacement) {
        warnings.push("replacement must be an object; disabled");
        result.replacement.enabled = false;
    }
    if (root.lowHpBuff !== undefined && root.lowHpBuff !== buff) {
        warnings.push("lowHpBuff must be an object; disabled");
        result.lowHpBuff.enabled = false;
    }
    if (loadError || !raw || typeof raw !== "object" || Array.isArray(raw)) {
        warnings.push("config.json unavailable/invalid; both mods disabled: " + (loadError || "expected object"));
        result.replacement.enabled = false;
        result.lowHpBuff.enabled = false;
    }
    return result;
}

// Linear ramp; a 2 percentage-point step retains the prior write-frequency limit.
function effectFraction(hpRatio, spec) {
    if (!spec.enabled || !Number.isFinite(hpRatio)) return 0;
    const strength = Math.max(0, Math.min(1,
        (spec.startHpPercent - hpRatio * 100) / (spec.startHpPercent - spec.fullHpPercent)));
    const maximum = spec.maxPercent / 100;
    return Math.min(maximum, Math.max(0, Math.round(maximum * strength / 0.02) * 0.02));
}

let raw = null, loadError = "";
try { raw = require("./config.json"); } catch (e) { loadError = String(e); }
const settings = normalizeSettings(raw, loadError);
settings.normalizeSettings = normalizeSettings;
settings.effectFraction = effectFraction;
module.exports = settings;
