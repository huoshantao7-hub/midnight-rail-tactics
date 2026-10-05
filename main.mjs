import {WIDTH,HEIGHT,TRACK_Y,WALLS,ROLES,createGame,legalTargets,applyAction,endTurn,chooseAIAction,unitAt,terminalAt,living,trainWarning,trainThisRound} from './engine.mjs';

const $=id=>document.getElementById(id);
const canvas=$('board'),ctx=canvas.getContext('2d');
const CELL=70,OX=38,OY=34;
const names=['蓝队','红队'];
const skillDesc={scout:'远距冲刺 + 护盾',guard:'邻近队友 +2 护盾',engineer:'修复队友 / 遥控占台'};
let game=createGame(),selected='0-scout',activeAction=null,autoBusy=false,modalMode='start',muted=false,audio=null,hover=null;
let eventCursor=0,effects=[],moves=new Map(),lastPaint=0;
const reduced=matchMedia('(prefers-reduced-motion:reduce)').matches;

function sound(kind){
  if(muted||game.mode==='demo')return;
  try{audio??=new (window.AudioContext||window.webkitAudioContext)();if(audio.state==='suspended')audio.resume();
    const o=audio.createOscillator(),g=audio.createGain(),now=audio.currentTime;
    const map={select:[440,560,.07],move:[240,360,.09],hit:[140,85,.18],capture:[590,850,.23],heal:[450,710,.18],turn:[340,510,.13],win:[520,1040,.5]};
    const [a,b,d]=map[kind]||map.select;o.type=kind==='hit'?'sawtooth':'square';o.frequency.setValueAtTime(a,now);o.frequency.exponentialRampToValueAtTime(b,now+d);g.gain.setValueAtTime(.0001,now);g.gain.exponentialRampToValueAtTime(.047,now+.01);g.gain.exponentialRampToValueAtTime(.0001,now+d);o.connect(g);g.connect(audio.destination);o.start(now);o.stop(now+d+.02);
  }catch{}
}

function modal(show,title,copy){
  $('modal').classList.toggle('hidden',!show);
  if(title)$('modal-title').textContent=title;
  if(copy)$('modal-copy').textContent=copy;
  if(show){$('start-ai').style.display='';$('start-duel').style.display='';$('close-modal').style.display=modalMode==='start'?'none':'';}
}
function reset(mode){
  game=createGame(mode);selected='0-scout';activeAction=null;autoBusy=false;eventCursor=0;effects=[];moves.clear();
  modal(false);updateUI();sound('turn');
  if(mode==='demo')setTimeout(runAuto,900);
}

function currentUnit(){return game.units.find(u=>u.id===selected&&u.hp>0&&u.team===game.turn)||living(game,game.turn)[0]||null}
function legal(){const u=currentUnit();return u&&activeAction?legalTargets(game,u.id,activeAction):[]}

function updateUI(){
  $('score-blue').textContent=game.score[0];$('score-red').textContent=game.score[1];
  $('round-label').textContent=`ROUND ${String(game.round).padStart(2,'0')}`;
  $('mode-label').textContent=game.mode==='duel'?'同屏双人':game.mode==='demo'?'真实规则 · 自动演示':'电脑对战';
  $('current-team').textContent=`${names[game.turn]}回合`;$('ap-count').textContent=game.ap;
  $('team-tag').textContent=`${names[game.turn]}行动`;
  $('turn-banner').textContent=game.winner===null?`${names[game.turn]} · ${game.mode==='ai'&&game.turn===1?'电脑思考中':activeAction?'选择高亮目标':'选择角色与指令'}`:game.winner==='draw'?'双方平局':`${names[game.winner]}获胜！`;
  const warning=game.winner===null?(trainThisRound(game)?'本回合末列车经过中路':trainWarning(game)?'下一回合轨道危险':'轨道暂时安全'):'对局结束';
  $('danger-label').textContent=warning;$('danger-label').classList.toggle('danger',trainThisRound(game)||trainWarning(game));
  $('turn-hint').textContent=trainThisRound(game)?'危险：回合末轨道上的角色受 2 点伤害。':trainWarning(game)?'预警：下一回合末列车将扫过中路。':'每个角色可移动一次、行动一次。';
  $('turn-pips').innerHTML=Array.from({length:4},(_,i)=>`<i class="${i>=game.ap?'empty':''}"></i>`).join('');
  for(const t of game.terminals){const el=$(`signal-${t.id}`);el.className=t.owner===null?'':t.owner===0?'blue':'red'}
  const current=living(game,game.turn);
  if(!current.some(u=>u.id===selected))selected=current[0]?.id??null;
  $('roster').innerHTML=game.units.filter(u=>u.team===game.turn).map(u=>{
    const icon={scout:'➤',guard:'▣',engineer:'⚙'}[u.role];
    return `<button class="unit-row ${u.id===selected?'selected':''} ${u.hp===0?'dead':''}" data-unit="${u.id}" ${u.hp===0?'disabled':''}><span class="unit-avatar ${u.team?'red':''}">${icon}</span><span><b>${ROLES[u.role].name}</b><small>${u.didMove?'已移动':'可移动'} · ${u.didAct?'已行动':'可行动'}</small></span><span class="hp">♥ ${u.hp}/${u.maxHp}</span></button>`;
  }).join('');
  for(const button of document.querySelectorAll('[data-unit]'))button.onclick=()=>{selected=button.dataset.unit;activeAction=null;updateUI();sound('select')};
  const u=currentUnit();$('selected-team').textContent=game.turn?'RED':'BLUE';$('selected-team').classList.toggle('red',game.turn===1);
  if(u){const role=ROLES[u.role];$('selected-card').innerHTML=`<h3>${role.name}<small>${u.role.toUpperCase()}</small></h3><p>${u.role==='scout'?'敏捷抢台，贴身突袭。':u.role==='guard'?'守住要道，为队友撑起护盾。':'用远距直线攻击与重连技能改变战局。'}</p><div class="stat-line"><span>♥ ${u.hp}/${u.maxHp}</span><span>移动 ${role.move}</span><span>射程 ${role.range}</span><span>护盾 ${u.shield}</span></div>`;
    $('skill-name').textContent=role.skill;$('skill-desc').textContent=skillDesc[u.role];
  }else $('selected-card').innerHTML='<p>没有可行动角色。</p>';
  for(const b of document.querySelectorAll('[data-action]')){
    const type=b.dataset.action;b.disabled=!u||game.winner!==null||autoBusy||legalTargets(game,u.id,type).length===0;
    b.classList.toggle('active',activeAction===type);
  }
  $('end-turn').disabled=game.winner!==null||autoBusy;
  $('battle-log').innerHTML=game.log.slice(0,5).map(v=>`<div>${v}</div>`).join('');
}

function consumeEvents(){
  const list=game.events.slice(eventCursor);eventCursor=game.events.length;
  const now=performance.now();
  for(const e of list){
    if(e.type==='move'||e.type==='dash'){moves.set(e.id,{...e,at:now,duration:e.type==='dash'?320:270});sound('move')}
    if(['hit','ko','capture','heal','shield','train','win'].includes(e.type))effects.push({...e,at:now,duration:e.type==='train'?900:e.type==='win'?1400:600});
    if(e.type==='hit')sound('hit');if(e.type==='capture')sound('capture');if(e.type==='heal')sound('heal');if(e.type==='turn')sound('turn');if(e.type==='win')sound('win');
  }
}

function perform(action){
  const result=applyAction(game,action);if(!result.ok)return false;
  activeAction=null;consumeEvents();updateUI();
  return true;
}
function finishTurn(){
  if(game.winner!==null||autoBusy)return;
  endTurn(game);selected=living(game,game.turn)[0]?.id??null;activeAction=null;consumeEvents();updateUI();
  if(game.winner!==null){modalMode='result';setTimeout(()=>showResult(),1100);return}
  if(game.mode==='demo'||game.mode==='ai'&&game.turn===1)setTimeout(runAuto,650);
}
function showResult(){
  if(game.winner===null)return;
  const msg=game.winner==='draw'?'两队旗鼓相当，再来一局？':`${names[game.winner]}在第 ${game.round} 回合赢得信号争夺！比分 ${game.score[0]} : ${game.score[1]}。`;
  modal(true,game.winner==='draw'?'平局 · 再战一局':`${names[game.winner]}获胜`,msg);
}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function runAuto(){
  if(autoBusy||game.winner!==null||!(game.mode==='demo'||game.mode==='ai'&&game.turn===1))return;
  autoBusy=true;updateUI();
  let count=0;
  while(game.winner===null&&game.ap>0&&count<8){
    const action=chooseAIAction(game);if(!action)break;
    await sleep(game.mode==='demo'?680:520);
    while(!$('modal').classList.contains('hidden')&&game.winner===null)await sleep(200);
    if(game.winner!==null)break;
    perform(action);count++;
  }
  await sleep(game.mode==='demo'?620:420);
  autoBusy=false;updateUI();finishTurn();
}

function setAction(type){
  const u=currentUnit();if(!u||autoBusy||game.winner!==null)return;
  const options=legalTargets(game,u.id,type);if(!options.length)return;
  if(type==='guard'){perform({type:'guard',unitId:u.id,x:u.x,y:u.y});return}
  activeAction=activeAction===type?null:type;updateUI();sound('select');
}

canvas.addEventListener('mousemove',ev=>{const p=cellFromEvent(ev);hover=p});
canvas.addEventListener('mouseleave',()=>hover=null);
canvas.addEventListener('click',ev=>{
  if(game.winner!==null||autoBusy||game.mode==='ai'&&game.turn===1||game.mode==='demo'||!$('modal').classList.contains('hidden'))return;
  const p=cellFromEvent(ev);if(!p)return;
  const u=currentUnit(),target=unitAt(game,p.x,p.y);
  if(u&&activeAction){
    const match=legalTargets(game,u.id,activeAction).find(v=>v.x===p.x&&v.y===p.y);
    if(match){perform({type:activeAction,unitId:u.id,x:p.x,y:p.y,kind:match.kind});return}
  }
  if(target&&target.team===game.turn){selected=target.id;activeAction=null;updateUI();sound('select');return}
  if(u&&target&&target.team!==game.turn){const attack=legalTargets(game,u.id,'attack').find(v=>v.x===p.x&&v.y===p.y);if(attack){perform({type:'attack',unitId:u.id,x:p.x,y:p.y});return}}
  if(u&&!target){const move=legalTargets(game,u.id,'move').find(v=>v.x===p.x&&v.y===p.y);if(move){perform({type:'move',unitId:u.id,x:p.x,y:p.y});return}}
});
function cellFromEvent(ev){const r=canvas.getBoundingClientRect(),px=(ev.clientX-r.left)*canvas.width/r.width,py=(ev.clientY-r.top)*canvas.height/r.height,x=Math.floor((px-OX)/CELL),y=Math.floor((py-OY)/CELL);return x>=0&&x<WIDTH&&y>=0&&y<HEIGHT?{x,y}:null}

for(const button of document.querySelectorAll('[data-action]'))button.onclick=()=>setAction(button.dataset.action);
$('end-turn').onclick=finishTurn;
$('start-ai').onclick=()=>reset('ai');$('start-duel').onclick=()=>reset('duel');
$('new-btn').onclick=()=>{modalMode='new';modal(true,'零点列车','选择模式，开启一场全新的信号争夺战。')};
$('help-btn').onclick=()=>{modalMode='help';modal(true,'玩法说明','两队各有 4 行动点。角色每回合最多移动一次、行动一次；职业技消耗 2 点。占领中央信号台可持续得分，轨道每第三回合会造成 2 点伤害。');};
$('close-modal').onclick=()=>modal(false);
$('sound-toggle').onclick=()=>{muted=!muted;$('sound-toggle').textContent=muted?'♪̸':'♫';$('sound-toggle').setAttribute('aria-label',muted?'开启音效':'关闭音效')};
document.addEventListener('keydown',ev=>{
  if(!$('modal').classList.contains('hidden')){if(ev.key==='Escape'&&modalMode!=='start')modal(false);return}
  const map={'1':'move','2':'attack','3':'skill','4':'guard'};
  if(map[ev.key]){ev.preventDefault();setAction(map[ev.key])}
  if(ev.key.toLowerCase()==='e'){ev.preventDefault();finishTurn()}
  if(ev.key==='Escape'){activeAction=null;updateUI()}
});

function tileCenter(x,y){return {x:OX+x*CELL+CELL/2,y:OY+y*CELL+CELL/2}}
function pixelRect(x,y,w,h,color){ctx.fillStyle=color;ctx.fillRect(Math.round(x),Math.round(y),Math.round(w),Math.round(h))}
function rrect(x,y,w,h,r,color){ctx.fillStyle=color;ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fill()}
function drawBoard(t){
  const g=ctx.createLinearGradient(0,0,0,558);g.addColorStop(0,'#102f3d');g.addColorStop(1,'#09202c');ctx.fillStyle=g;ctx.fillRect(0,0,706,558);
  for(let y=0;y<HEIGHT;y++)for(let x=0;x<WIDTH;x++){
    const px=OX+x*CELL,py=OY+y*CELL,check=(x+y)%2;
    pixelRect(px,py,CELL,CELL,check?'#183c48':'#1c4550');
    pixelRect(px+3,py+3,CELL-6,CELL-6,check?'#1a414c':'#1d4852');
    pixelRect(px+7,py+8,3,3,'#66818a33');pixelRect(px+51,py+46,2,2,'#8ca2a822');
    if(y===TRACK_Y){pixelRect(px,py,CELL,CELL,'#3b3f3d');for(let a=9;a<CELL;a+=18)pixelRect(px+a,py,6,CELL,'#514943');pixelRect(px,py+16,CELL,5,'#9d8562');pixelRect(px,py+48,CELL,5,'#9d8562');if(trainWarning(game)||trainThisRound(game)){ctx.fillStyle=trainThisRound(game)?'#f2873948':'#e7bd5650';ctx.fillRect(px,py,CELL,CELL)}}
    ctx.strokeStyle='#45647266';ctx.lineWidth=1;ctx.strokeRect(px+.5,py+.5,CELL-1,CELL-1);
  }
  // Bricks and platform hardware are original geometry drawn into the board.
  for(const [x,y] of WALLS){const px=OX+x*CELL,py=OY+y*CELL;pixelRect(px+12,py+14,46,45,'#081a23');pixelRect(px+8,py+10,48,44,'#947550');pixelRect(px+12,py+12,40,11,'#b89260');pixelRect(px+10,py+31,44,3,'#6e543c');pixelRect(px+32,py+11,3,42,'#6e543c');for(const [dx,dy] of [[15,18],[47,18],[15,49],[47,49]])pixelRect(px+dx,py+dy,3,3,'#dbc593')}
  for(const p of game.terminals)drawTerminal(p,t);
  const opts=legal();for(const p of opts){const c=tileCenter(p.x,p.y);ctx.fillStyle=activeAction==='attack'?'#f8826370':activeAction==='skill'?'#ecc77367':'#56e0cb53';ctx.fillRect(c.x-CELL/2+5,c.y-CELL/2+5,CELL-10,CELL-10);ctx.strokeStyle=activeAction==='attack'?'#ff9b79':activeAction==='skill'?'#f2d383':'#78e8d7';ctx.lineWidth=2;ctx.strokeRect(c.x-CELL/2+7,c.y-CELL/2+7,CELL-14,CELL-14)}
  if(hover){const p=tileCenter(hover.x,hover.y);ctx.strokeStyle='#f3dfafaa';ctx.lineWidth=2;ctx.strokeRect(p.x-CELL/2+3,p.y-CELL/2+3,CELL-6,CELL-6)}
  for(const u of game.units.filter(v=>v.hp>0))drawUnit(u,t);
  drawEffects(t);
  ctx.strokeStyle='#8baaaa';ctx.lineWidth=3;ctx.strokeRect(OX-2,OY-2,WIDTH*CELL+4,HEIGHT*CELL+4);
  pixelRect(16,14,100,16,'#0a2532');ctx.fillStyle='#a9c8c9';ctx.font='10px Consolas,monospace';ctx.fillText('PLATFORM 09',23,26);
  pixelRect(590,14,101,16,'#0a2532');ctx.fillText('00:00 SIGNAL',598,26);
}

function drawTerminal(p,t){
  const c=tileCenter(p.x,p.y),color=p.owner===0?'#73dce7':p.owner===1?'#ff9a85':'#ecc779';
  ctx.fillStyle='#081a21aa';ctx.beginPath();ctx.arc(c.x,c.y,26,0,Math.PI*2);ctx.fill();
  ctx.strokeStyle=color;ctx.lineWidth=2;ctx.beginPath();ctx.arc(c.x,c.y,23+Math.sin(t/400+p.id)*1.5,0,Math.PI*2);ctx.stroke();
  pixelRect(c.x-13,c.y-13,26,26,'#112f38');pixelRect(c.x-9,c.y-9,18,18,color);pixelRect(c.x-4,c.y-4,8,8,'#09222e');
  ctx.font='700 10px Consolas,monospace';ctx.textAlign='center';ctx.fillStyle='#e8e3bd';ctx.fillText(['N','C','S'][p.id],c.x,c.y+27);ctx.textAlign='left';
}

function drawUnit(u,t){
  const center=tileCenter(u.x,u.y),move=moves.get(u.id);let cx=center.x,cy=center.y;
  if(move){const k=Math.min(1,(t-move.at)/move.duration);if(k>=1)moves.delete(u.id);else{const ease=1-(1-k)**3,c0=tileCenter(move.from.x,move.from.y);cx=c0.x+(center.x-c0.x)*ease;cy=c0.y+(center.y-c0.y)*ease-6*Math.sin(k*Math.PI)}}
  const bob=reduced?0:Math.sin(t/330+u.x*2)*1.2;
  ctx.fillStyle='#020d13aa';ctx.beginPath();ctx.ellipse(cx,cy+23,21,6,0,0,Math.PI*2);ctx.fill();
  if(u.id===selected&&u.team===game.turn&&game.winner===null){ctx.strokeStyle='#ffdb84';ctx.lineWidth=3;ctx.beginPath();ctx.ellipse(cx,cy+22,27,10,0,0,Math.PI*2);ctx.stroke()}
  const x=Math.round(cx),y=Math.round(cy+bob),body=u.team?'#d46662':'#59c7cb',light=u.team?'#ff9b83':'#9ee7d9',dark=u.team?'#7c3d4d':'#276f79';
  pixelRect(x-17,y+8,13,13,dark);pixelRect(x+4,y+8,13,13,dark);pixelRect(x-15,y-8,30,26,'#071b22');pixelRect(x-12,y-6,24,22,body);
  pixelRect(x-21,y-4,8,15,dark);pixelRect(x+13,y-4,8,15,dark);
  pixelRect(x-10,y-22,20,18,'#f1bd8c');pixelRect(x-7,y-17,5,4,'#13313a');pixelRect(x+3,y-17,5,4,'#13313a');
  if(u.role==='scout'){pixelRect(x-13,y-29,25,9,body);pixelRect(x-17,y-22,30,5,dark);pixelRect(x+11,y-22,9,3,light);pixelRect(x-3,y+1,6,6,'#f8dc8f')}
  if(u.role==='guard'){pixelRect(x-14,y-30,28,10,dark);pixelRect(x-12,y-27,24,8,light);pixelRect(x-20,y-22,6,17,dark);pixelRect(x+14,y-22,6,17,dark);pixelRect(x-6,y+1,12,10,'#f0d090')}
  if(u.role==='engineer'){pixelRect(x-12,y-27,24,8,'#b58755');pixelRect(x-10,y-19,20,8,'#244c5c');pixelRect(x-8,y-17,6,4,light);pixelRect(x+2,y-17,6,4,light);pixelRect(x-4,y+1,8,8,'#ffda84')}
  const hpWidth=37;pixelRect(x-hpWidth/2,y-37,hpWidth,5,'#061924');pixelRect(x-hpWidth/2+1,y-36,(hpWidth-2)*u.hp/u.maxHp,3,u.team?'#ff927d':'#7cdeca');
  if(u.shield>0){rrect(x+15,y-30,15,13,2,'#e1c479');ctx.fillStyle='#123039';ctx.font='700 10px Consolas';ctx.fillText(String(u.shield),x+19,y-20)}
  if(u.didAct&&u.didMove){ctx.fillStyle='#05182399';ctx.fillRect(x-24,y-31,48,55)}
}

function drawEffects(t){
  effects=effects.filter(e=>t-e.at<e.duration);
  for(const e of effects){const p=(t-e.at)/e.duration;
    if(e.type==='train'){const yy=tileCenter(0,TRACK_Y).y,cx=OX-140+(WIDTH*CELL+280)*Math.min(1,p);pixelRect(cx-72,yy-18,145,37,'#e9c275');pixelRect(cx-60,yy-29,100,14,'#f5d992');pixelRect(cx-42,yy-23,18,11,'#244856');pixelRect(cx-12,yy-23,18,11,'#244856');pixelRect(cx+18,yy-23,18,11,'#244856');continue}
    if(e.x===undefined||e.y===undefined)continue;
    const c=tileCenter(e.x,e.y),a=Math.max(0,1-p);ctx.save();ctx.globalAlpha=a;
    if(e.type==='hit'||e.type==='ko'){ctx.strokeStyle=e.type==='ko'?'#ffdd8b':'#ff9278';ctx.lineWidth=4;ctx.beginPath();ctx.arc(c.x,c.y,14+p*32,0,Math.PI*2);ctx.stroke();ctx.fillStyle='#fff0c5';ctx.font='700 21px Consolas';ctx.textAlign='center';ctx.fillText(e.value?`-${e.value}`:'✦',c.x,c.y-38-p*15)}
    if(e.type==='capture'||e.type==='heal'||e.type==='shield'){ctx.strokeStyle=e.type==='capture'?'#f6d57b':'#8ce5d3';ctx.lineWidth=4;ctx.beginPath();ctx.arc(c.x,c.y,12+p*35,0,Math.PI*2);ctx.stroke()}
    ctx.restore();ctx.textAlign='left';
  }
}
function tick(t){lastPaint=t;drawBoard(t);requestAnimationFrame(tick)}
requestAnimationFrame(tick);

updateUI();
if(new URLSearchParams(location.search).has('demo'))reset('demo');
// Read-only hooks for browser QA. All demo actions still run through the normal game engine.
window.__gameQA={getState:()=>structuredClone(game),select:id=>{selected=id;updateUI()},action:perform,end:finishTurn,start:reset};
