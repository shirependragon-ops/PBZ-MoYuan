const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '../ProjectPBZ/PBZModLoader/mods');
const settings = require(path.join(root, 'PBZMoYuanSettings/settings'));
const {normalizeSettings: normalize, effectFraction: effect} = settings;
assert.equal(settings.warnings.length, 0);
assert.equal(settings.replacement.className, 'BP_Monster_MoTian_LongZhu_04_C');
const ahua = normalize({replacement: {monsterId: 'BP_Monster_AHua_GuiTouDao_C'}});
assert(ahua.replacement.targetPath.includes('BP_Monster_AHua_GuiTouDao.'));
const full = '/PBZCombatAsset/ActorData/Mobs/Test/BP_Monster_Test.BP_Monster_Test_C';
assert.equal(normalize({replacement: {monsterId: full}}).replacement.targetPath, full);
assert.equal(normalize({replacement: {monsterId: 'not-an-id'}}).replacement.enabled, false);
assert.equal(normalize({replacement: {monsterId: 'BP_Monster_WuLengShuang_C'}}).replacement.enabled, false);
assert.equal(normalize({replacement: {enabled: 'false'}}).replacement.enabled, false);
assert.equal(normalize({replacement: false}).replacement.enabled, false);
assert.equal(normalize({lowHpBuff: false}).lowHpBuff.enabled, false);
assert.equal(normalize(null, 'bad JSON').replacement.enabled, false);
assert.equal(normalize(null, 'bad JSON').lowHpBuff.enabled, false);
for (const bad of [
  {maxPercent: -1}, {maxPercent: 101}, {maxPercent: '80'},
  {startHpPercent: 20, fullHpPercent: 30}, {startHpPercent: 20, fullHpPercent: 20},
  {startHpPercent: 101}, {fullHpPercent: -1}, {maxPercent: NaN},
]) assert.equal(normalize({lowHpBuff: {damageReduction: bad}}).lowHpBuff.damageReduction.enabled, false);
const ramp = {enabled: true, maxPercent: 80, startHpPercent: 60, fullHpPercent: 20};
assert.equal(effect(.8, ramp), 0);
assert.equal(effect(.6, ramp), 0);
assert.equal(effect(.4, ramp), .4);
assert.equal(effect(.2, ramp), .8);
assert.equal(effect(.05, ramp), .8);
assert.equal(effect(.4, {...ramp, enabled: false}), 0);
assert.equal(effect(0, {...ramp, maxPercent: 3}), .03);
assert.equal(effect(.5, settings.lowHpBuff.damageReduction), .4);
assert.equal(effect(.5, settings.lowHpBuff.damageBonus), .3);

function runMod(name, config, pawn = {}, failReads = false) {
  const writes = [], timers = [];
  const UE = {
    BasicAttributeSet: {StaticClass: () => ({})}, EGameplayModOp: {Override: 3},
    GameplayStatics: {GetPlayerCharacter: () => pawn},
    PBZBlueprintFunctionLibrary: {
      MakeAttribute: n => n,
      GetAttributeFromCharacter: (p, n) => p[n] === undefined ? NaN : p[n],
    },
    AttributeUtils: {ModifyCharacterAttributeValue: (p, n, _op, v) => {writes.push(n); p[n] = v;}},
  };
  const source = fs.readFileSync(path.join(root, name, 'main.js'), 'utf8');
  const c = vm.createContext({
    require: n => n === 'ue' ? UE : n === '../PBZMoYuanSettings/settings'
      ? {...config, effectFraction: effect} : {argv: {getByName: () => ({})}},
    setInterval: f => timers.push(f),
  });
  vm.runInContext(source + ';globalThis.testTick=tick;', c);
  c.testTick();
  return {writes, timers, c};
}
const disabled = normalize({replacement: {enabled: false}, lowHpBuff: {enabled: false}});
assert.equal(runMod('PBZMoYuanClean', disabled).timers.length, 0);
assert.equal(runMod('PBZLowHPBuff', disabled).timers.length, 0);
assert.equal(runMod('PBZLowHPBuff', disabled).writes.length, 0);
function pawn() {return {Health: 50, Health_Max: 100,
  TakenReductionMultiplier_Physical: 1, TakenReductionMultiplier_Elemental: 1,
  TakenVulnerabilityMultiplier_Physical: 1, TakenVulnerabilityMultiplier_Elemental: 1,
  Amplification_Physical: 0, Amplification_Elemental: 0};}
const bonusOnly = normalize({lowHpBuff: {damageReduction: {enabled: false}}});
const p1 = pawn(), r1 = runMod('PBZLowHPBuff', bonusOnly, p1);
assert.deepEqual(r1.writes.sort(), ['Amplification_Elemental', 'Amplification_Physical']);
assert.equal(p1.Amplification_Physical, .3);
const drOnly = normalize({lowHpBuff: {damageBonus: {enabled: false}}});
const p2 = pawn(), r2 = runMod('PBZLowHPBuff', drOnly, p2);
assert.deepEqual(r2.writes.sort(), ['TakenReductionMultiplier_Elemental', 'TakenReductionMultiplier_Physical']);
assert.equal(p2.TakenReductionMultiplier_Physical, .6);
const custom = normalize({lowHpBuff: {damageReduction: ramp, damageBonus: {enabled: false}}});
const p3 = pawn(); p3.Health = 40;
runMod('PBZLowHPBuff', custom, p3);
assert.equal(p3.TakenReductionMultiplier_Physical, .6);
const source = fs.readFileSync(path.join(root, 'PBZMoYuanSettings/settings.js'), 'utf8');
const broken = vm.createContext({module: {exports: {}}, require: n => {
  if (n === './config.json') throw new SyntaxError('malformed JSON');
  return require(path.join(root, 'PBZMoYuanSettings', n));
}});
vm.runInContext(source, broken);
assert.equal(broken.module.exports.replacement.enabled, false);
assert.equal(broken.module.exports.lowHpBuff.enabled, false);
for (const name of ['PBZMoYuanClean', 'PBZLowHPBuff', 'PBZMoYuanSettings']) {
  const file = name === 'PBZMoYuanSettings' ? 'settings.js' : 'main.js';
  new vm.Script(fs.readFileSync(path.join(root, name, file), 'utf8'));
}
console.log('PASS: monster ID/full path, ambiguous/invalid config, malformed JSON, ranges, thresholds, independent toggles, disabled mods, default behavior and syntax.');
