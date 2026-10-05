export const WIDTH=9, HEIGHT=7, TRACK_Y=3, WIN_SCORE=8;
export const WALLS=[[3,2],[5,2],[3,4],[5,4]];
export const ROLES={
  scout:{name:'信使',hp:4,move:3,range:1,damage:2,skill:'闪袭'},
  guard:{name:'守卫',hp:6,move:2,range:1,damage:2,skill:'盾墙'},
  engineer:{name:'机修师',hp:4,move:2,range:3,damage:1,skill:'重连'}
};
const starts=[['scout',1],['guard',3],['engineer',5]];
const key=(x,y)=>`${x},${y}`;
const within=(x,y)=>x>=0&&x<WIDTH&&y>=0&&y<HEIGHT;
const manhattan=(a,b)=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y);

export function createGame(mode='ai'){
  const units=[];
  for(let team=0;team<2;team++)for(const [role,y] of starts){
    const r=ROLES[role];units.push({id:`${team}-${role}`,team,role,x:team?7:1,y,hp:r.hp,maxHp:r.hp,shield:0,guarding:false,didMove:false,didAct:false});
  }
  return {mode,round:1,turn:0,ap:4,score:[0,0],units,
    terminals:[1,3,5].map((y,i)=>({id:i,x:4,y,owner:null})),
    winner:null,log:['夺取中央三座信号台，先得 8 分。'],events:[],lastAction:null};
}

export const wallAt=(x,y)=>WALLS.some(([wx,wy])=>wx===x&&wy===y);
export const unitAt=(s,x,y)=>s.units.find(u=>u.hp>0&&u.x===x&&u.y===y)||null;
export const terminalAt=(s,x,y)=>s.terminals.find(t=>t.x===x&&t.y===y)||null;
export const living=(s,team)=>s.units.filter(u=>u.hp>0&&u.team===team);
export const currentTeamName=s=>s.turn===0?'蓝队':'红队';
export const trainWarning=s=>s.round%3===2;
export const trainThisRound=s=>s.round%3===0;

function push(s,message,event){
  s.log.unshift(message);s.log=s.log.slice(0,8);
  if(event){s.events.push({...event,time:Date.now()});s.events=s.events.slice(-80)}
}

function reach(s,u,max){
  const seen=new Map([[key(u.x,u.y),0]]),queue=[{x:u.x,y:u.y,d:0}],out=[];
  for(let i=0;i<queue.length;i++){
    const p=queue[i];if(p.d>=max)continue;
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const x=p.x+dx,y=p.y+dy,k=key(x,y);
      if(!within(x,y)||wallAt(x,y)||unitAt(s,x,y)||seen.has(k))continue;
      seen.set(k,p.d+1);queue.push({x,y,d:p.d+1});out.push({x,y,d:p.d+1});
    }
  }
  return out;
}

function clearLine(s,a,b){
  if(a.x!==b.x&&a.y!==b.y)return false;
  const dx=Math.sign(b.x-a.x),dy=Math.sign(b.y-a.y);
  let x=a.x+dx,y=a.y+dy;
  while(x!==b.x||y!==b.y){if(wallAt(x,y)||unitAt(s,x,y))return false;x+=dx;y+=dy}
  return true;
}

export function legalTargets(s,id,type){
  const u=s.units.find(v=>v.id===id);
  if(!u||u.hp<=0||u.team!==s.turn||s.winner!==null)return[];
  const r=ROLES[u.role];
  if(type==='move')return s.ap>=1&&!u.didMove?reach(s,u,r.move):[];
  if(type==='attack')return s.ap>=1&&!u.didAct?s.units.filter(v=>v.hp>0&&v.team!==u.team&&manhattan(u,v)<=r.range&&(u.role!=='engineer'||clearLine(s,u,v))).map(v=>({x:v.x,y:v.y,id:v.id})):[];
  if(type==='skill'){
    if(s.ap<2||u.didAct)return[];
    if(u.role==='scout')return u.didMove?[]:reach(s,u,4).map(p=>({...p,kind:'dash'}));
    if(u.role==='guard')return living(s,u.team).filter(v=>manhattan(u,v)<=1&&v.shield<3).map(v=>({x:v.x,y:v.y,id:v.id,kind:'shield'}));
    const heal=living(s,u.team).filter(v=>manhattan(u,v)<=2&&v.hp<v.maxHp).map(v=>({x:v.x,y:v.y,id:v.id,kind:'heal'}));
    const hack=s.terminals.filter(t=>t.owner!==u.team&&manhattan(u,t)<=2&&(!unitAt(s,t.x,t.y)||unitAt(s,t.x,t.y).team===u.team)).map(t=>({x:t.x,y:t.y,id:t.id,kind:'hack'}));
    return [...heal,...hack];
  }
  if(type==='guard')return s.ap>=1&&!u.didAct?[{x:u.x,y:u.y,id:u.id}]:[];
  return[];
}

function damage(s,target,amount,label,source){
  const blocked=Math.min(target.shield,amount);target.shield-=blocked;
  const dealt=amount-blocked;target.hp=Math.max(0,target.hp-dealt);
  push(s,`${label}命中${ROLES[target.role].name}：-${dealt}${blocked?`（护盾挡 ${blocked}）`:''}`,
    {type:'hit',x:target.x,y:target.y,value:dealt,blocked,source});
  if(target.hp===0){target.guarding=false;push(s,`${target.team?'红':'蓝'}队${ROLES[target.role].name}退场。`,{type:'ko',x:target.x,y:target.y});}
  return dealt;
}

function capture(s,u){
  const t=terminalAt(s,u.x,u.y);
  if(t&&t.owner!==u.team){t.owner=u.team;push(s,`${u.team?'红':'蓝'}队占领 ${['北','中','南'][t.id]}信号台。`,{type:'capture',x:t.x,y:t.y,team:u.team})}
}

export function applyAction(s,{type,unitId,x,y,kind}){
  const u=s.units.find(v=>v.id===unitId),opts=legalTargets(s,unitId,type);
  const target=opts.find(v=>v.x===x&&v.y===y&&(!kind||v.kind===kind));
  if(!u||!target)return {ok:false,reason:'无效目标或行动点不足'};
  const from={x:u.x,y:u.y};
  if(type==='move'){
    u.x=x;u.y=y;u.didMove=true;s.ap-=1;
    push(s,`${u.team?'红':'蓝'}队${ROLES[u.role].name}移动。`,{type:'move',id:u.id,from,to:{x,y}});capture(s,u);
  }else if(type==='attack'){
    const enemy=unitAt(s,x,y);if(!enemy)return {ok:false,reason:'目标已离开'};
    u.didAct=true;s.ap-=1;damage(s,enemy,ROLES[u.role].damage,'攻击',{x:u.x,y:u.y});
    if(enemy.hp>0&&enemy.guarding&&manhattan(u,enemy)===1&&u.hp>0){enemy.guarding=false;damage(s,u,1,'警戒反击',{x:enemy.x,y:enemy.y})}
  }else if(type==='guard'){
    u.didAct=true;u.guarding=true;u.shield=Math.min(3,u.shield+1);s.ap-=1;
    push(s,`${u.team?'红':'蓝'}队${ROLES[u.role].name}进入警戒。`,{type:'shield',x:u.x,y:u.y});
  }else if(type==='skill'){
    u.didAct=true;s.ap-=2;
    if(u.role==='scout'){
      u.didMove=true;u.x=x;u.y=y;u.shield=Math.min(3,u.shield+1);
      push(s,'信使闪袭！', {type:'dash',id:u.id,from,to:{x,y}});capture(s,u);
    }else if(u.role==='guard'){
      const ally=unitAt(s,x,y);ally.shield=Math.min(3,ally.shield+2);
      push(s,'守卫撑起盾墙。',{type:'shield',x,y});
    }else if(target.kind==='heal'){
      const ally=unitAt(s,x,y);const amount=Math.min(2,ally.maxHp-ally.hp);ally.hp+=amount;
      push(s,`机修师修复 ${amount} 点生命。`,{type:'heal',x,y,value:amount});
    }else{
      const terminal=terminalAt(s,x,y);terminal.owner=u.team;
      push(s,`机修师遥控接管 ${['北','中','南'][terminal.id]}信号台。`,{type:'capture',x,y,team:u.team});
    }
  }
  s.lastAction={type,unitId,x,y,kind,round:s.round,team:u.team};
  return {ok:true};
}

function evaluateWinner(s){
  const alive=[living(s,0).length,living(s,1).length];
  if(alive[0]===0&&alive[1]===0)s.winner='draw';
  else if(alive[0]===0)s.winner=1;
  else if(alive[1]===0)s.winner=0;
  else if((s.score[0]>=WIN_SCORE||s.score[1]>=WIN_SCORE)&&s.score[0]!==s.score[1])s.winner=s.score[0]>s.score[1]?0:1;
  if(s.winner!==null)push(s,s.winner==='draw'?'双方平局。':`${s.winner?'红':'蓝'}队获胜！`,{type:'win',team:s.winner});
}

export function endTurn(s){
  if(s.winner!==null)return false;
  const team=s.turn,gain=s.terminals.filter(t=>t.owner===team).length;
  s.score[team]+=gain;
  push(s,`${team?'红':'蓝'}队回合结束，信号 +${gain}。`,{type:'score',team,value:gain});
  if(team===1){
    if(trainThisRound(s)){
      push(s,'零点列车驶过中央铁轨！',{type:'train',row:TRACK_Y});
      for(const u of s.units.filter(v=>v.hp>0&&v.y===TRACK_Y))damage(s,u,2,'列车冲击',null);
    }
    evaluateWinner(s);
    if(s.winner!==null)return true;
    s.round+=1;s.turn=0;
  }else s.turn=1;
  s.ap=4;
  for(const u of living(s,s.turn)){u.didMove=false;u.didAct=false;u.guarding=false;u.shield=0;}
  push(s,`第 ${s.round} 回合 · ${currentTeamName(s)}行动。`,{type:'turn',team:s.turn,round:s.round});
  return true;
}

function nearestEnemy(s,u){return Math.min(...living(s,1-u.team).map(v=>manhattan(u,v)),99)}
function moveValue(s,u,p){
  const target=s.terminals.filter(t=>t.owner!==u.team).sort((a,b)=>manhattan(u,a)-manhattan(u,b))[0];
  if(!target)return nearestEnemy(s,u)-Math.min(...living(s,1-u.team).map(v=>manhattan(p,v)),99);
  const oldDist=manhattan(u,target),newDist=manhattan(p,target);
  let value=(oldDist-newDist)*1.2;
  if(p.x===target.x&&p.y===target.y)value+=7;
  if(terminalAt(s,u.x,u.y)?.owner===u.team)value-=3;
  if(p.y===TRACK_Y&&trainThisRound(s))value-=4;
  if(nearestEnemy(s,{...u,...p})===1&&!u.didAct)value+=.7;
  return value;
}

export function chooseAIAction(s){
  if(s.winner!==null)return null;
  const candidates=[];
  for(const u of living(s,s.turn)){
    for(const p of legalTargets(s,u.id,'attack')){
      const enemy=unitAt(s,p.x,p.y),dealt=Math.max(0,ROLES[u.role].damage-enemy.shield);
      candidates.push({score:3+dealt*1.8+(enemy.hp<=dealt?4:0)+(terminalAt(s,p.x,p.y)?1.5:0),action:{type:'attack',unitId:u.id,x:p.x,y:p.y}});
    }
    for(const p of legalTargets(s,u.id,'skill')){
      let score=0;
      if(p.kind==='hack')score=7.5;
      if(p.kind==='heal')score=2.5+Math.min(2,unitAt(s,p.x,p.y).maxHp-unitAt(s,p.x,p.y).hp)*1.2;
      if(p.kind==='shield')score=1.1+(terminalAt(s,p.x,p.y)?.owner===u.team?1:0)+(p.id===u.id?-.3:0);
      if(p.kind==='dash')score=moveValue(s,u,p)+.5;
      candidates.push({score,action:{type:'skill',unitId:u.id,x:p.x,y:p.y,kind:p.kind}});
    }
    for(const p of legalTargets(s,u.id,'move'))candidates.push({score:moveValue(s,u,p),action:{type:'move',unitId:u.id,x:p.x,y:p.y}});
    if(legalTargets(s,u.id,'guard').length)candidates.push({score:.5+(terminalAt(s,u.x,u.y)?.owner===u.team?1:0),action:{type:'guard',unitId:u.id,x:u.x,y:u.y}});
  }
  candidates.sort((a,b)=>b.score-a.score||a.action.unitId.localeCompare(b.action.unitId));
  return candidates[0]?.score>.3?candidates[0].action:null;
}
