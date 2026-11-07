'use strict';
/*
 * Локальна версія гри: не потребує сервера та працює без інтернету.
 * Команди/партія/історія колод зберігаються в localStorage цього браузера.
 */
const ROSTER_KEY = 'bunker_economy_roster_v1';
const GAME_KEY = 'bunker_economy_game_v1';
const DECK_KEY = 'bunker_economy_decks_v1';
const app = document.getElementById('app');
const overlay = document.getElementById('overlay');

function uid() { return (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : 'id' + Date.now().toString(36) + Math.random().toString(36).slice(2); }
function readStored(key, fallback) { try { const parsed = JSON.parse(localStorage.getItem(key)); return parsed ?? fallback; } catch { return fallback; } }
function saveStored(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { toast('Не вдалося зберегти: перевірте налаштування браузера.'); } }
function esc(value) { return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }
function shuffle(array) { const out = array.slice(); for(let i=out.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [out[i],out[j]]=[out[j],out[i]]; } return out; }
function allPlayers(roster) { return roster.teams.flatMap(team => team.players.map(player => ({id:player.id, name:player.name, teamId:team.id}))); }
function clampInt(value, min, max) { const v = Number(value); return Number.isFinite(v) ? Math.max(min, Math.min(max, Math.round(v))) : max; }
const defaultRoster = () => ({ teams:[{id:uid(),name:'Команда 1',players:[]}], cardCount:8 });
let roster = readStored(ROSTER_KEY, null);
if (!roster || !Array.isArray(roster.teams) || !roster.teams.length) roster = defaultRoster();
roster.cardCount = clampInt(roster.cardCount, 1, 8);
let game = readStored(GAME_KEY, null);
if (!game || !Array.isArray(game.players) || !Array.isArray(game.teams)) game = null;
let decks = readStored(DECK_KEY, {});
if (!decks || typeof decks !== 'object') decks = {};
let view = game ? 'game' : 'setup';
let dialog = null; // {type:'private', playerId, unlocked} | {type:'rules'} | {type:'summary'}
let toastTimer;
function persistRoster(){saveStored(ROSTER_KEY,roster);}
function persistGame(){saveStored(GAME_KEY,game);}
function persistDecks(){saveStored(DECK_KEY,decks);}
function toast(message){ let node=document.getElementById('toast'); if(!node){node=document.createElement('div');node.className='toast';node.id='toast';document.body.appendChild(node);}node.textContent=message;node.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>node.remove(),2900); }
function drawCard(cat, matchUsed, usedTexts){
  let d=decks[cat.id];
  if (!d || !Array.isArray(d.remaining) || !Array.isArray(d.recent) || d.remaining.some(n => !Number.isInteger(n) || n<0 || n>=cat.cards.length)) {
    d={remaining:[],recent:[]};decks[cat.id]=d;
  }
  const createCycle = () => {
    const recentSet = new Set(d.recent.slice(-Math.min(6,Math.floor(cat.cards.length/3))));
    // Недавні картки розміщуємо на початку: добираємо з кінця, тому вони з'являться пізніше.
    d.remaining = [...shuffle([...recentSet]), ...shuffle(cat.cards.map((_,i)=>i).filter(i=>!recentSet.has(i)))];
  };
  if (!d.remaining.length) createCycle();
  const textOf = (i) => { const value=cat.cards[i]; return Array.isArray(value)?value[0]:value; };
  let options=d.remaining.map((id, idx)=>({id,idx})).filter(item=>!matchUsed.has(item.id) && !usedTexts.has(textOf(item.id)));
  if(!options.length && matchUsed.size<cat.cards.length){
    // Можливий перехід межі циклу: підбираємо не використані ще в цій партії картки.
    createCycle();
    options=d.remaining.map((id,idx)=>({id,idx})).filter(item=>!matchUsed.has(item.id) && !usedTexts.has(textOf(item.id)));
  }
  if(!options.length) options=d.remaining.map((id,idx)=>({id,idx})).filter(item=>!usedTexts.has(textOf(item.id)));
  if(!options.length) options=d.remaining.map((id,idx)=>({id,idx}));
  const selected = options[options.length-1];
  const id=d.remaining.splice(selected.idx,1)[0];
  d.recent.push(id);
  d.recent=d.recent.slice(-8);
  matchUsed.add(id);
  return {categoryId:cat.id, cardId:id, used:false};
}
function materializeCard(card){
  const category = CATEGORIES.find(c=>c.id===card.categoryId);
  const raw=category?.cards?.[card.cardId];
  return {category, title:Array.isArray(raw)?raw[0]:(raw??'Невідома карта'), description:Array.isArray(raw)?raw[1]:''};
}
function dealCards(){
  const players=allPlayers(roster);
  if(players.length<2){toast('Додайте щонайменше двох гравців.');return;}
  if(players.length>80){toast('Максимум 80 гравців у партії.');return;}
  if(game && !confirm('Почати нову партію? Поточна роздача буде замінена, але історія карт збережеться.'))return;
  const usedByCategory=Object.fromEntries(CATEGORIES.map(c=>[c.id,new Set()]));
  const allocation=new Map();
  for(const player of shuffle(players)){
    const cards=shuffle(CATEGORIES).slice(0,roster.cardCount).sort((a,b)=>a.number-b.number);
    const usedTexts=new Set();
    const dealt=cards.map(cat=>{
      const card=drawCard(cat,usedByCategory[cat.id],usedTexts);
      const mat=materializeCard(card);
      usedTexts.add(mat.title);
      return card;
    });
    allocation.set(player.id,dealt);
  }
  game={id:uid(),startedAt:new Date().toISOString(),round:1,cardCount:roster.cardCount,
    teams:roster.teams.map(t=>({id:t.id,name:t.name})),
    players:players.map(p=>({...p,cards:allocation.get(p.id),revealed:[],eliminated:false})),
    activeTeamId:roster.teams[0].id,activePlayerId:players[0].id};
  persistDecks();persistGame();view='game';dialog=null;render();window.scrollTo({top:0,behavior:'smooth'});
  toast('Карти роздано. Успішної гри!');
}
function getTeamPlayers(teamId){return (game?.players||[]).filter(p=>p.teamId===teamId);}
function selectedPlayer(){return game?.players.find(p=>p.id===game.activePlayerId)||getTeamPlayers(game?.activeTeamId)[0]||game?.players[0];}
function render(){app.innerHTML=view==='game'&&game?renderGame():renderSetup();renderDialog();}
function metric(value,label){return `<div class="metric"><strong>${esc(value)}</strong><span>${esc(label)}</span></div>`;}
function renderSetup(){
  const players=allPlayers(roster), total=players.length;
  return `<section class="hero"><div><div class="eyebrow">Інтерактивна гра · Економіка</div><h1>Виживуть <em>не всі.</em></h1><p class="subtext">Зберіть команди, роздайте кожному випадкові карти та доведіть, чому саме ви маєте місце в бункері.</p></div><div class="hero-art" aria-hidden="true"><span class="art-corner">SYS / 001</span><span class="art-symbol">✳</span><span class="art-text">SURVIVAL PROTOCOL</span></div></section>
  <div class="metrics">${metric(TOTAL_CARDS,'Карт у колоді')}${metric('08','Категорій')}${metric(roster.teams.length,'Команд')}${metric(total,'Гравців')}</div>
  <div class="setup-grid"><section class="panel"><div class="panel-head"><h2>Ваші команди</h2><span class="count">${roster.teams.length} / 8</span></div>
  ${roster.teams.map((team,i)=>`<div class="team-editor"><div class="team-edit-top"><span class="team-glyph">${String(i+1).padStart(2,'0')}</span><input class="team-name-field" aria-label="Назва команди" data-action="rename-team" data-team="${esc(team.id)}" maxlength="40" value="${esc(team.name)}"><button class="delete-btn" title="Видалити команду" aria-label="Видалити команду" data-action="remove-team" data-team="${esc(team.id)}" ${roster.teams.length===1?'disabled':''}>×</button></div><div class="player-list-edit">${team.players.length?team.players.map((p,n)=>`<div class="player-edit-row"><span class="mini-number">${String(n+1).padStart(2,'0')}</span><span class="name">${esc(p.name)}</span><button class="remove-player" title="Прибрати гравця" aria-label="Прибрати ${esc(p.name)}" data-action="remove-player" data-team="${esc(team.id)}" data-player="${esc(p.id)}">×</button></div>`).join(''):'<div class="empty-team">Тут поки немає гравців.</div>'}</div><div class="add-row"><input id="add-${esc(team.id)}" class="text-input" maxlength="36" placeholder="Ім’я учасника" aria-label="Ім’я нового гравця"><button class="add-mini" data-action="add-player" data-team="${esc(team.id)}">+ Додати</button></div></div>`).join('')}
  <button class="add-team" data-action="add-team" ${roster.teams.length>=8?'disabled':''}>＋ Створити команду</button><p class="note" style="margin:14px 1px 0">Можна створити до 8 команд. Вони залишаться збереженими у вашому браузері.</p></section>
  <aside class="panel"><div class="panel-head"><h2>Налаштування гри</h2><span class="panel-kicker">01 / 02</span></div><div class="setting-label"><div><strong>Карток на гравця</strong><small>Випадкові категорії від 1 до 8</small></div><span class="large-number">${roster.cardCount}<span style="font-size:15px;color:var(--muted)"> / 8</span></span></div><input class="slider" type="range" min="1" max="8" step="1" value="${roster.cardCount}" data-action="card-count" aria-label="Кількість карт на гравця"><div class="slider-ends"><span>1 КАРТА</span><span>ВСІ 8 КАРТ</span></div>
  <div class="settings-divider"></div><div class="feature-row"><span class="feature-icon">↻</span><div><strong>Без частих повторів</strong><p>Картки беруться з перемішаних колод кожної категорії. Перед повтором намагаємося використати всі інші варіанти. Історія пам’ятається між партіями.</p></div></div><div class="feature-row"><span class="feature-icon">◈</span><div><strong>Особисті карти</strong><p>Кожен гравець може переглянути свої карти приватно, а потім відкривати їх для інших по одній.</p></div></div><div class="feature-row"><span class="feature-icon">⌁</span><div><strong>Раунди та вибування</strong><p>Відзначайте вибулих гравців, переходьте до наступного раунду та переглядайте результати команд.</p></div></div>
  <div class="start-card"><div class="start-counts"><span>Гравців: <strong>${total}</strong></span><span>Карт у роздачі: <strong>${total*roster.cardCount}</strong></span></div><button class="primary-btn full" data-action="start" ${total<2?'disabled':''}>Роздати карти <span aria-hidden="true">↗</span></button>${total<2?'<p class="note" style="margin:10px 0 0">Потрібно мінімум 2 гравці.</p>':''}${total>20?'<p class="warning">Понад 20 гравців: деякі карти категорій доведеться повторити в одній партії.</p>':''}</div>
  ${game?'<button class="ghost-btn" style="margin-top:12px;width:100%" data-action="resume">↶ Повернутися до поточної гри</button>':''}<button class="ghost-btn" data-action="reset-history" style="width:100%;margin-top:9px">Очистити історію колод</button></aside></div>`;
}
function renderGame(){
  if(!game.teams.some(t=>t.id===game.activeTeamId))game.activeTeamId=game.teams[0].id;
  if(!getTeamPlayers(game.activeTeamId).some(p=>p.id===game.activePlayerId))game.activePlayerId=getTeamPlayers(game.activeTeamId)[0]?.id;
  const team=game.teams.find(t=>t.id===game.activeTeamId), players=getTeamPlayers(team.id);
  const player=selectedPlayer(), revealed=player?.revealed?.length||0;
  return `<div class="game-hero"><div><div class="eyebrow">Протокол виживання · ${esc(formatDate(game.startedAt))}</div><h1>Раунд <em>${game.round.toString().padStart(2,'0')}</em></h1><p class="note">Виберіть гравця, відкривайте його карти та визначайте, хто заслуговує на місце в бункері.</p></div><div class="game-buttons"><button class="ghost-btn" data-action="edit-roster">⚙ Команди</button><button class="ghost-btn" data-action="summary">Результати</button><button class="primary-btn" data-action="new-deal">↻ Нова роздача</button></div></div>
  <div class="team-tabs" role="tablist" aria-label="Команди">${game.teams.map(t=>{let pp=getTeamPlayers(t.id);return `<button role="tab" aria-selected="${t.id===team.id}" class="team-tab ${t.id===team.id?'active':''}" data-action="select-team" data-team="${esc(t.id)}"><strong>${esc(t.name)}</strong><small>${pp.filter(p=>!p.eliminated).length} / ${pp.length} у грі</small></button>`}).join('')}</div>
  <div class="game-layout"><aside class="panel player-panel-list"><div class="players-title">УЧАСНИКИ · ${players.length}</div><div class="players-items">${players.map((p,i)=>`<button class="player-select ${p.id===player?.id?'active':''} ${p.eliminated?'eliminated':''}" data-action="select-player" data-player="${esc(p.id)}"><span class="player-avatar">${String(i+1).padStart(2,'0')}</span><span class="player-name-wrap"><strong>${esc(p.name)}</strong><small>${p.eliminated?'Вибув із гри':'У грі'}</small></span><span class="player-progress">${p.revealed.length}/${p.cards.length}</span></button>`).join('')}</div><div class="side-separator"></div><div class="round-controls"><p>Поточний раунд: <strong style="color:var(--lime)">${game.round}</strong></p><button class="ghost-btn" data-action="next-round">Наступний раунд →</button></div></aside>
  <section class="panel public-panel">${player?`<div class="selected-header"><div><div class="person-meta">${esc(team.name)} · ${player.eliminated?'Вибув':'Активний гравець'}</div><h2>${esc(player.name)}</h2></div><div class="selected-actions"><button class="ghost-btn" data-action="private-open" data-player="${esc(player.id)}">◉ Мої карти</button><button class="ghost-btn ${player.eliminated?'':'danger-ghost'}" data-action="toggle-eliminate" data-player="${esc(player.id)}">${player.eliminated?'↶ Повернути':'✕ Виключити'}</button></div></div>
  <div class="subline"><span>Відкрито: <strong>${revealed} із ${player.cards.length}</strong></span><span>Кожна карта відкривається окремо</span></div>
  <div class="cards-grid">${player.cards.map(card=>renderCard(card,player,{private:false})).join('')}</div>`:'<div class="no-player">Оберіть учасника команди.</div>'}</section></div>`;
}
function renderCard(card, player, options={}){
  const {category,title,description}=materializeCard(card);
  const isPublic=player.revealed.includes(category.id);
  const shown=options.private||isPublic;
  const special=category.id==='special';
  return `<article class="game-card ${shown?'revealed':'is-locked'}" data-cat="${esc(category.id)}"><div class="card-top"><span class="card-number">${String(category.number).padStart(2,'0')}</span><span class="card-category">${esc(category.title)}</span></div><div class="card-content">${shown?`<h3 class="card-title">${esc(title)}</h3>${description?`<p class="card-desc">${esc(description)}</p>`:''}${special&&card.used?'<p class="special-used">✓ Картку вже використано</p>':''}`:'<div class="locked-body"><span class="locked-icon">◇</span> КАРТУ ПРИХОВАНО</div>'}</div>
  ${options.private?(special?`<button class="reveal-btn" data-action="toggle-special-used" data-player="${esc(player.id)}" data-category="${esc(category.id)}">${card.used?'↶ Повернути дію':'✓ Позначити використаною'}</button>`:''):`<button class="reveal-btn" data-action="toggle-reveal" data-player="${esc(player.id)}" data-category="${esc(category.id)}">${isPublic?'↶ Приховати':'↗ Відкрити карту'}</button>`}</article>`;
}
function formatDate(iso){try{return new Date(iso).toLocaleDateString('uk-UA',{day:'2-digit',month:'2-digit',year:'numeric'});}catch{return 'Партія';}}
function renderDialog(){
  if(!dialog){overlay.innerHTML='';overlay.hidden=true;return;}
  overlay.hidden=false;
  if(dialog.type==='rules'){
    overlay.innerHTML=`<div class="dialog narrow" role="dialog" aria-modal="true" aria-label="Правила гри"><div class="dialog-head"><div class="eyebrow">Інструкція</div><button class="icon-btn" data-action="close-dialog" aria-label="Закрити">×</button></div><h2>Як грати?</h2><div class="rule-step"><strong>01</strong><p>Створіть одну або кілька команд, додайте учасників і виберіть від 1 до 8 карт на людину.</p></div><div class="rule-step"><strong>02</strong><p>Натисніть <b>«Роздати карти»</b>. Кожен гравець відкриває <b>«Мої карти»</b>, коли йому передадуть пристрій.</p></div><div class="rule-step"><strong>03</strong><p>Під час раундів гравці публічно відкривають карти й пояснюють, чому їх слід залишити у бункері.</p></div><div class="rule-step"><strong>04</strong><p>Після обговорення проводьте голосування усно та натискайте <b>«Виключити»</b> для тих, хто вибуває.</p></div><div class="rule-step"><strong>05</strong><p>Особливі випадки розігруються за текстом картки. Використану дію можна позначити в особистому перегляді.</p></div><p class="note">Усі дані зберігаються локально. Ця версія призначена для гри на одному пристрої, а не для синхронізації між телефонами.</p><div class="dialog-actions"><button class="primary-btn" data-action="close-dialog">Зрозуміло</button></div></div>`;
  } else if(dialog.type==='private'){
    const player=game?.players.find(p=>p.id===dialog.playerId);
    if(!player){dialog=null;renderDialog();return;}
    overlay.innerHTML=`<div class="dialog ${dialog.unlocked?'':'narrow'}" role="dialog" aria-modal="true" aria-label="Особисті карти"><div class="dialog-head"><div class="eyebrow">Приватний перегляд · ${esc(game.teams.find(t=>t.id===player.teamId)?.name||'Команда')}</div><button class="icon-btn" data-action="close-dialog" aria-label="Закрити">×</button></div>${dialog.unlocked?`<h2>Карти: ${esc(player.name)}</h2><p>Ці карти видно лише під час приватного перегляду. Закрийте вікно, перш ніж передати пристрій іншому.</p><div class="private-cards">${player.cards.map(c=>renderCard(c,player,{private:true})).join('')}</div><div class="dialog-actions"><button class="primary-btn" data-action="close-dialog">◉ Приховати всі карти</button></div>`:`<div class="privacy-icon">◈</div><h2>Лише для ${esc(player.name)}</h2><p>Передайте пристрій цьому гравцю. Після натискання кнопки з'являться всі його карти, включно з прихованими від інших.</p><div class="dialog-actions"><button class="ghost-btn" data-action="close-dialog">Скасувати</button><button class="primary-btn" data-action="private-unlock">Показати мої карти ↗</button></div>`}</div>`;
  } else if(dialog.type==='summary'){
    overlay.innerHTML=`<div class="dialog narrow" role="dialog" aria-modal="true" aria-label="Підсумки партії"><div class="dialog-head"><div class="eyebrow">Партія · Раунд ${game.round}</div><button class="icon-btn" data-action="close-dialog" aria-label="Закрити">×</button></div><h2>Хто залишився?</h2><p>Підсумок за ручними виключеннями. Голосування проводиться учасниками поза застосунком.</p>${game.teams.map(t=>{const pp=getTeamPlayers(t.id),alive=pp.filter(p=>!p.eliminated);return `<div class="summary-team"><strong>${esc(t.name)} · ${alive.length}/${pp.length}</strong><p>${alive.length?alive.map(p=>esc(p.name)).join(', '):'Усі гравці вибули'}</p><small>У бункері залишаються ${alive.length} учасників</small></div>`}).join('')}<div class="dialog-actions"><button class="ghost-btn" data-action="copy-summary">Копіювати підсумок</button><button class="primary-btn" data-action="close-dialog">Продовжити гру</button></div></div>`;
  }
}
function addPlayer(teamId){
  const team=roster.teams.find(t=>t.id===teamId),input=document.getElementById('add-'+teamId);
  if(!team||!input)return;
  const name=input.value.trim().slice(0,36);
  if(!name){input.focus();toast('Введіть ім’я учасника.');return;}
  if(allPlayers(roster).length>=80){toast('Максимальна кількість гравців — 80.');return;}
  team.players.push({id:uid(),name});persistRoster();render();document.getElementById('add-'+teamId)?.focus();
}
function toggleReveal(playerId,catId){const p=game?.players.find(p=>p.id===playerId);if(!p||!p.cards.some(c=>c.categoryId===catId))return;if(p.revealed.includes(catId))p.revealed=p.revealed.filter(x=>x!==catId);else p.revealed.push(catId);persistGame();render();}
function gameClick(action,button){const teamId=button.dataset.team,playerId=button.dataset.player,catId=button.dataset.category;
  switch(action){
    case 'start':case 'new-deal':dealCards();break;
    case 'add-team':if(roster.teams.length>=8)return;roster.teams.push({id:uid(),name:`Команда ${roster.teams.length+1}`,players:[]});persistRoster();render();break;
    case 'remove-team':if(roster.teams.length<=1)return;{const t=roster.teams.find(x=>x.id===teamId);if(t?.players.length&&!confirm(`Видалити «${t.name}» разом з усіма гравцями?`))return;roster.teams=roster.teams.filter(x=>x.id!==teamId);persistRoster();render();}break;
    case 'add-player':addPlayer(teamId);break;
    case 'remove-player':{const t=roster.teams.find(x=>x.id===teamId);if(!t)return;t.players=t.players.filter(p=>p.id!==playerId);persistRoster();render();}break;
    case 'reset-history':if(confirm('Очистити історію використаних карт? Наступні роздачі почнуться з нових перемішаних колод.')){decks={};persistDecks();toast('Історію колод очищено.');}break;
    case 'resume':view='game';render();break;
    case 'edit-roster':view='setup';render();break;
    case 'select-team':game.activeTeamId=teamId;game.activePlayerId=getTeamPlayers(teamId)[0]?.id;persistGame();render();break;
    case 'select-player':{const p=game.players.find(p=>p.id===playerId);if(!p)return;game.activePlayerId=playerId;game.activeTeamId=p.teamId;persistGame();render();}break;
    case 'toggle-reveal':toggleReveal(playerId,catId);break;
    case 'toggle-eliminate':{const p=game?.players.find(p=>p.id===playerId);if(!p)return;p.eliminated=!p.eliminated;persistGame();render();toast(p.eliminated?`${p.name} вибув із гри.`:`${p.name} повернувся до гри.`);}break;
    case 'next-round':game.round+=1;persistGame();render();toast(`Почався раунд ${game.round}.`);break;
    case 'private-open':dialog={type:'private',playerId,unlocked:false};renderDialog();break;
    case 'private-unlock':dialog.unlocked=true;renderDialog();break;
    case 'toggle-special-used':{const p=game?.players.find(p=>p.id===playerId),c=p?.cards.find(c=>c.categoryId==='special');if(!c)return;c.used=!c.used;persistGame();renderDialog();}break;
    case 'summary':dialog={type:'summary'};renderDialog();break;
    case 'help':dialog={type:'rules'};renderDialog();break;
    case 'close-dialog':dialog=null;renderDialog();break;
    case 'copy-summary':{const content=game.teams.map(t=>{const pp=getTeamPlayers(t.id),alive=pp.filter(p=>!p.eliminated);return `${t.name} (${alive.length}/${pp.length}): ${alive.map(p=>p.name).join(', ')||'Ніхто'}`}).join('\n');const text=`БУНКЕР: ЕКОНОМІКА — раунд ${game.round}\n${content}`;if(navigator.clipboard?.writeText){navigator.clipboard.writeText(text).then(()=>toast('Підсумок скопійовано!')).catch(()=>fallbackCopy(text));}else fallbackCopy(text);}break;
    default:break;
  }
}
function fallbackCopy(text){const input=document.createElement('textarea');input.value=text;input.style.position='fixed';input.style.left='-9999px';document.body.appendChild(input);input.select();try{document.execCommand('copy');toast('Підсумок скопійовано!');}catch{toast('Копіювання недоступне у цьому браузері.');}input.remove();}
document.addEventListener('click',event=>{const target=event.target.closest('[data-action]');if(!target||target.disabled)return;gameClick(target.dataset.action,target);});
document.addEventListener('change',event=>{const input=event.target;if(input.dataset.action==='rename-team'){const team=roster.teams.find(t=>t.id===input.dataset.team);if(!team)return;team.name=input.value.trim().slice(0,40)||'Команда';persistRoster();render();}else if(input.dataset.action==='card-count'){roster.cardCount=clampInt(input.value,1,8);persistRoster();render();}});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&dialog){dialog=null;renderDialog();}if(event.key==='Enter'&&event.target?.id?.startsWith('add-')){event.preventDefault();addPlayer(event.target.id.slice(4));}});
overlay.addEventListener('click',event=>{if(event.target===overlay){dialog=null;renderDialog();}});
render();
