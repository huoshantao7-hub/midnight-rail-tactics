import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame,legalTargets,applyAction,endTurn,chooseAIAction,unitAt,trainWarning,trainThisRound} from '../engine.mjs';

test('move obeys AP, movement limit and occupied walls',()=>{
  const s=createGame();
  const targets=legalTargets(s,'0-scout','move');
  assert(targets.some(p=>p.x===4&&p.y===1));
  assert(!targets.some(p=>p.x===3&&p.y===2));
  assert(!targets.some(p=>p.x===7&&p.y===1));
  assert.equal(applyAction(s,{type:'move',unitId:'0-scout',x:4,y:1}).ok,true);
  assert.equal(s.ap,3);assert.equal(s.terminals[0].owner,0);
  assert.equal(applyAction(s,{type:'move',unitId:'0-scout',x:4,y:2}).ok,false);
});

test('turn order, scoring and rail warning resolve after both teams',()=>{
  const s=createGame();
  applyAction(s,{type:'move',unitId:'0-scout',x:4,y:1});
  endTurn(s);assert.deepEqual(s.score,[1,0]);assert.equal(s.turn,1);
  endTurn(s);assert.equal(s.round,2);assert.equal(trainWarning(s),true);
  endTurn(s);endTurn(s);assert.equal(s.round,3);assert.equal(trainThisRound(s),true);
  const blueGuard=unitAt(s,1,3);const redGuard=unitAt(s,7,3);
  endTurn(s);endTurn(s);
  assert.equal(blueGuard.hp,4);assert.equal(redGuard.hp,4);assert.equal(s.round,4);
});

test('guard shields damage and counters adjacent attack',()=>{
  const s=createGame();const b=s.units.find(u=>u.id==='0-guard'),r=s.units.find(u=>u.id==='1-scout');
  r.x=2;r.y=3;
  assert.equal(applyAction(s,{type:'guard',unitId:b.id,x:1,y:3}).ok,true);
  endTurn(s);
  assert.equal(applyAction(s,{type:'attack',unitId:r.id,x:1,y:3}).ok,true);
  assert.equal(b.hp,5);assert.equal(b.shield,0);assert.equal(r.hp,3);assert.equal(b.guarding,false);
});

test('engineer cannot shoot diagonally or through obstacles, but can hack',()=>{
  const s=createGame();const e=s.units.find(u=>u.id==='0-engineer');
  e.x=2;e.y=2;
  const red=s.units.find(u=>u.id==='1-engineer');red.x=4;red.y=2;
  assert(!legalTargets(s,e.id,'attack').some(p=>p.id===red.id));
  e.x=3;e.y=1;
  const targets=legalTargets(s,e.id,'skill');
  assert(targets.some(p=>p.kind==='hack'&&p.x===4&&p.y===1));
  assert.equal(applyAction(s,{type:'skill',unitId:e.id,x:4,y:1,kind:'hack'}).ok,true);
  assert.equal(s.terminals[0].owner,0);assert.equal(s.ap,2);
});

test('scout dash uses both action slots and engineer repair restores at most two HP',()=>{
  const s=createGame();const scout=s.units.find(u=>u.id==='0-scout');
  const dash=legalTargets(s,scout.id,'skill').find(p=>p.x===4&&p.y===1);
  assert(dash);
  assert.equal(applyAction(s,{type:'skill',unitId:scout.id,x:4,y:1,kind:'dash'}).ok,true);
  assert.equal(s.ap,2);assert.equal(scout.shield,1);assert.equal(scout.didMove,true);assert.equal(scout.didAct,true);
  assert.equal(s.terminals[0].owner,0);
  const engineer=s.units.find(u=>u.id==='0-engineer');engineer.hp=1;
  assert.equal(applyAction(s,{type:'skill',unitId:engineer.id,x:engineer.x,y:engineer.y,kind:'heal'}).ok,true);
  assert.equal(engineer.hp,3);assert.equal(s.ap,0);
});

test('tied threshold does not award a first-mover win',()=>{
  const s=createGame();s.score=[8,8];
  endTurn(s);assert.equal(s.winner,null);
  endTurn(s);assert.equal(s.winner,null);
  s.terminals[0].owner=0;
  endTurn(s);endTurn(s);
  assert.equal(s.winner,0);
});

test('AI chooses legal actions and reaches a result',()=>{
  const s=createGame('demo');let actions=0;
  for(let turns=0;turns<50&&s.winner===null;turns++){
    for(let i=0;i<8&&s.ap>0;i++){
      const action=chooseAIAction(s);if(!action)break;
      assert.equal(applyAction(s,action).ok,true);actions++;
    }
    endTurn(s);
  }
  assert(actions>20);assert(s.round>2);assert.notEqual(s.winner,null);
});

test('blue victory is terminal and cannot accept another action or turn',()=>{
  const s=createGame();s.score=[8,1];
  endTurn(s);endTurn(s);
  assert.equal(s.winner,0);
  const before={round:s.round,score:[...s.score]};
  assert.equal(chooseAIAction(s),null);
  assert.equal(legalTargets(s,'0-scout','move').length,0);
  assert.equal(endTurn(s),false);
  assert.equal(applyAction(s,{type:'move',unitId:'0-scout',x:2,y:1}).ok,false);
  assert.deepEqual({round:s.round,score:s.score},before);
});
