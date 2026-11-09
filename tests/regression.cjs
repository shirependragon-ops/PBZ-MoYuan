const fs = require('fs');
const vm = require('vm');
const assert = require('assert/strict');
const path = require('path');
const settings = require('../ProjectPBZ/PBZModLoader/mods/PBZMoYuanSettings/settings');

function load(name, extra, UE = {}) {
  const source = fs.readFileSync(path.join(name === 'PBZMoYuanBirthProbe' ? path.join(__dirname, '../dev') : path.join(__dirname, '../ProjectPBZ/PBZModLoader/mods'), name, 'main.js'), 'utf8');
  new vm.Script(source);
  const context = vm.createContext({
    require: n => n === 'ue' ? UE : n === '../PBZMoYuanSettings/settings' ? settings : { argv: { getByName: () => ({}) } },
    setInterval: () => 0,
  });
  vm.runInContext(source + extra, context);
  return context;
}
const ctx = load('PBZMoYuanClean', `
globalThis.api = {state, applyStatsByPosition, reportUnmatched, replacementSafetyReason, isCommonMob, tick};
readAttr = (p,n) => p[n] === undefined ? NaN : p[n];
writeAttr = (p,n,v) => { if (p.fail) return false; p[n]=v; return true; };
`);
const {state, applyStatsByPosition, reportUnmatched} = ctx.api;
const source = {max: 100, hp: 80, shMax: 50, sh: 40};
state.convStats = [
  {x: 0, y: 0, z: 0, stats: source, sourceClass: 'original100', spawner: 's1'},
  {x: 3000, y: 0, z: 0, stats: {...source, max: 300}, sourceClass: 'original300', spawner: 's2'},
];
function unit(name) {
  const tags = new Set();
  return {
    x: 0, Health_Max: 999, Health: 20, Shachi_Max: 999, Shachi: 10,
    GetName: () => name, GetClass: () => ({GetName: () => 'gold'}),
    K2_GetActorLocation() {return {X: this.x, Y: 0, Z: 0};},
    ActorHasTag: tag => tags.has(tag), Tags: {Add: tag => tags.add(tag)},
  };
}
const g = unit('mover');
applyStatsByPosition([g], 'test');
assert.equal(g.Health, 20);
assert.equal(g.Shachi, 10);
assert.equal(state.syncedSources.mover.max, 100);
assert.equal(state.syncedSources.mover.sourceClass, 'original100');
g.x = 3000;
reportUnmatched([g], 'test');
assert(!state.diagLines.some(x => x.includes('synced-max-drift: mover')));
g.Health_Max = 500;
reportUnmatched([g], 'test');
assert(state.diagLines.some(x => x.includes('synced-max-drift: mover') && x.includes('expected=100')));
const badSh = unit('badSh'); badSh.Shachi = NaN;
applyStatsByPosition([badSh], 'test');
assert.equal(badSh.Health, 20); assert.equal(badSh.Shachi, 40);
const fail = unit('fail'); fail.fail = true;
for (let i=0; i<35; i++) applyStatsByPosition([fail, fail], 'test');
assert.equal(state.stats.applyFail, 30);
assert.equal(state.syncGiveUp.fail, true);
assert(state.diagLines.some(x => x.includes('apply-fail: fail')));

function delegate() {
  return { handlers: [], Add(h) {this.handlers.push(h);}, Remove(h) {
    this.handlers = this.handlers.filter(x => x !== h);
  }};
}
let spawners = Array.from({length: 210}, (_, i) => ({
  GetName: () => 'sp' + i, GetClass: () => ({GetName: () => 'spawner'}),
  CompleteSpawnAI: delegate(), OnSpawnFinish: delegate(),
}));
const UE = {GameplayStatics: {
  GetPlayerCharacter: () => ({}), GetCurrentLevelName: () => 'test',
  GetAllActorsOfClass: (_ctx, _cls, out) => {
    const actors = spawners.slice();
    out.push({Num: () => actors.length, Get: i => actors[i]});
  },
}};
const probe = load('PBZMoYuanBirthProbe', ';globalThis.api={state,tick};', UE).api;
Object.assign(probe.state, {level: 'test', levelAt: Date.now(), targetClass: {}, spawnerClass: {}});
probe.tick();
assert.equal(probe.state.bindings.length, 420);
const last = spawners[209];
last.CompleteSpawnAI.handlers[0](g);
assert.equal(probe.state.fired, 1);
assert(probe.state.lines.some(x => x.includes('CompleteSpawnAI #1 spawner=sp209')));
probe.tick();
assert.equal(last.CompleteSpawnAI.handlers.length, 1);
spawners = spawners.slice(0, 209);
probe.tick();
assert.equal(last.CompleteSpawnAI.handlers.length, 0);
assert.equal(probe.state.bindings.length, 418);
console.log('PASS: source snapshot, movement/drift, independent resources, retry limit, nested UArray, 210-spawner coverage, callback, deduplication and unbinding.');

const safety = ctx.api.replacementSafetyReason;
const monk = 'BP_Monster_HuoTieRen_Fist_C';
const ordinary = {SpawnInfo: {bHiddenByDefault: false, IdleStateData: null, DefaultBehaviorTree: null}, MobGroup: {IsCombating: false}};
assert.equal(safety(ordinary, {}, monk), '');
assert.equal(safety({...ordinary, SpawnInfo: {...ordinary.SpawnInfo, bHiddenByDefault: true}}, {}, monk), 'hidden-by-default');
assert.equal(safety(ordinary, {bHidden: true}, monk), 'hidden-actor');
assert.equal(safety({...ordinary, MobGroup: {IsCombating: true}}, {}, monk), 'active-encounter');
assert.equal(safety({...ordinary, SpawnInfo: {...ordinary.SpawnInfo, DefaultBehaviorTree: {GetName: () => 'BT_Monster_HuoTongen_Iron_JiuHuanDao_Intro'}}}, {}, monk), 'special-behavior:BT_Monster_HuoTongen_Iron_JiuHuanDao_Intro');
assert.equal(safety({...ordinary, IsSpawning: true}, {}, monk), 'defer:spawn-pending');
for (const n of ['BombMan', 'BombManRespawn', 'BombMan_Ice', 'BombMan_Poison']) assert.equal(ctx.api.isCommonMob('BP_Monster_' + n + '_C'), false);
assert.equal(ctx.api.isCommonMob(monk), true);
assert.equal(safety(ordinary, {bHidden: true}, 'BP_Monster_MaleThug_Sword_Blue_C'), 'hidden-actor');
console.log('PASS: bomb variants excluded; ordinary monk allowed; hidden, intro, active-encounter and spawn-pending guards.');

// End-to-end tick: guarded sources must never reach Class/Despawn/Respawn.
function spawnerCase(name, klass, props = {}, pawnProps = {}) {
  const pawn = Object.assign(unit(name + '-pawn'), {_class: klass}, pawnProps);
  const s = Object.assign({GetName: () => name, SpawnedAI: pawn,
    SpawnInfo: ordinary.SpawnInfo, MobGroup: {IsCombating: false},
    ActorHasTag: () => false, Tags: {Add() {}},
    K2_GetActorLocation: () => ({X: 0, Y: 0, Z: 0}), mutations: 0,
    Despawn() {this.mutations++;}, Respawn() {this.mutations++;},
  }, props);
  Object.defineProperty(s, 'Class', {set() {this.mutations++;}});
  return s;
}
const guardedBomb = spawnerCase('bomb', 'BP_Monster_BombManRespawn_C');
const guardedMonk = spawnerCase('hidden-monk', monk, {}, {bHidden: true});
const guardedRoof = spawnerCase('roof', 'BP_Monster_MaleThug_Sword_Blue_C', {
  SpawnInfo: {...ordinary.SpawnInfo, bHiddenByDefault: true},
});
const normalMonk = spawnerCase('ordinary-monk', monk);
ctx.cases = [guardedBomb, guardedMonk, guardedRoof, normalMonk];
Object.assign(state, {convStats: [], protectedSpawners: {}, readyAt: 0,
  targetClass: 'target', spawnerClass: 'spawners', softBoss: {}});
vm.runInContext(`UE.GameplayStatics={GetPlayerCharacter:()=>({})};
ensureClasses=()=>{}; currentLevel=()=> 'test';
className=o=>typeof o==='string'?o:(o._class||'');
enumerate=(_ctx,cls)=>cls==='spawners'?globalThis.cases:[];`, ctx);
ctx.api.tick();
assert.equal(guardedBomb.mutations, 0);
assert.equal(guardedMonk.mutations, 0);
assert.equal(guardedRoof.mutations, 0);
assert.equal(normalMonk.mutations, 3);
guardedMonk.SpawnedAI.bHidden = false;
ctx.cases = [guardedMonk];
ctx.api.tick();
assert.equal(guardedMonk.mutations, 0, 'preservation survives reveal/activation');
console.log('PASS: tick performs no Class/Despawn/Respawn on guarded actors, preserves revealed monk, still converts ordinary monk.');

assert.equal(safety({...ordinary, MobGroup: {IsCombating: true}}, {}, 'BP_Monster_MaleThug_Sword_Blue_C'), 'active-encounter');
