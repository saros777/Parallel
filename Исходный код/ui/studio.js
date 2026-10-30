/* Full-window timetable editor. One click picks up, the next places; Escape cancels. */
const SM=StudioModel;
let studioPeriod='base',studioAxis='classes',studioPick=null,studioWork=null,studioRows=[],studioDates=[],studioEntities=[],studioSlots=8,studioFilters={bottom:'all',side:'all'},studioGhost=null;
date=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow'}).format(new Date());
let studioBottom=90,studioSide=160,studioResizeObserver=null;
const studioFields=['classes','teachers','rooms','subjects','courses','groups','teacherSubjects','baseSchedule'];
const studioEditableBefore=editable;
editable=function(){return {...studioEditableBefore(),...Object.fromEntries(studioFields.map(k=>[k,structuredClone(db[k]??(k==='baseSchedule'?null:[]))])),preferences:structuredClone(settings)}};
transact=function(label,fn){
 const before=editable();fn();const after=editable();
 const keys=Object.keys(before).filter(k=>JSON.stringify(before[k])!==JSON.stringify(after[k]));
 if(!keys.length)return;
 // Store only changed collections: a timetable move must not duplicate all directories.
 db.history.push({id:crypto.randomUUID(),at:new Date().toISOString(),label,before:Object.fromEntries(keys.map(k=>[k,before[k]])),after:Object.fromEntries(keys.map(k=>[k,after[k]]))});
 dirty=true;render();message(label+'.');
};
const studioUndoBefore=undo;
undo=function(){const last=db.history.at(-1);if(last?.before?.preferences)settings=structuredClone(last.before.preferences);studioCancel();studioUndoBefore()};
stateMark=function(){return JSON.stringify([db.overrides,db.extraLessons,db.absences,db.history.length,settings,...studioFields.map(k=>db[k])])};
const studioRenderBefore=render;
render=function(){
 settings.studioSuspensions=true;
 document.body.classList.toggle('studio-page',route==='schedule');
 studioRenderBefore();
 if(route==='schedule'){$('#teacher-rooms')?.remove();$('#day-room-edit')?.remove();studioFit()}
};
function studioView(){return {subject:true,teacher:false,room:false,group:false,abbreviate:true,...settings.studioDisplay}}
function studioSubject(l){
 const s=lookup('subjects',l.subjectId);if(!studioView().abbreviate)return s?.name||'Предмет';
 if(settings.labels?.[l.subjectId])return settings.labels[l.subjectId];
 if(s?.studioEdited&&s.abbreviation)return s.abbreviation;
 return wbLabel(l);
}
function studioGroup(l){
 const g=(db.groups||[]).find(x=>x.id===l.groupId);
 if(g?.shortName)return g.shortName;
 const a=E.profileAudience(l,db);if(a.length)return a.map(x=>E.profileShort[x]||x).join('+');
 return PrintTools.groupLabel(l.groupName||g?.name||'').replace(/подгруппа/gi,'гр.').replace(/Базовый/gi,'баз.').replace(/Углубленный/gi,'угл.');
}
function studioTeacher(id){const t=lookup('teachers',id);return t?.shortName||short(t?.name||'Не назначен')}
function studioBrief(l){return [lookup('classes',l.classId)?.name,lookup('subjects',l.subjectId)?.name,studioTeacher(l.teacherId),l.roomId?PrintTools.roomNumber(roomName(l.roomId)):'Без кабинета',studioGroup(l)].filter(Boolean).join(' · ')}
card=function(l){
 const v=studioView(),parts=[];
 if(v.subject&&['general','classes'].includes(studioAxis))parts.push(studioSubject(l));
 if(['teachers','rooms'].includes(studioAxis))parts.push(lookup('classes',l.classId)?.name||'—');
 if(studioAxis==='general'&&v.teacher)parts.push(studioTeacher(l.teacherId));
 if(studioAxis==='general'&&v.room)parts.push(l.roomId?PrintTools.roomNumber(roomName(l.roomId)):'—');
 if(v.group&&studioGroup(l))parts.push(studioGroup(l));
 const color=lookup('teachers',l.teacherId)?.color||W.teacherColor(l.teacherId,db);
 return `<button type="button" class="lesson studio-card ${l.placementForced?'forced':''} ${studioPick?.id===l.id?'picked':''}" data-lesson="${h(l.id)}" style="--subject-color:${h(color)}" title="${h(studioBrief(l))}" aria-label="${h(studioBrief(l))}">${h(parts.join(' · ')||'·')}</button>`;
};
selected=function(){return db.classes.filter(c=>!selectedClasses||selectedClasses.has(c.id))};
function studioContext(){
 if(studioPeriod==='base')return {...db,baseSchedule:null,lessons:SM.template(db),overrides:{},extraLessons:[],absences:[],calendar:[]};
 return db;
}
function studioApply(label,patches,forced=false){
 studioCancel();$('#dialog').close();
 transact(label,()=>{
  const changes=patches.map(p=>({...p,after:{...p.after,placementForced:forced}}));
  if(studioPeriod==='base')SM.commitBase(db,changes);
  else changes.forEach(p=>{if(!db.lessons.some(l=>l.id===p.id)&&!SM.expand(db).some(l=>l.id===p.id)&&!db.extraLessons.some(l=>l.id===p.id))db.extraLessons.push(p.after);else db.overrides[p.id]={...db.overrides[p.id],...p.after}});
 });
}
function studioCheck(raw){
 const result=W.assess(studioWork,raw);
 const restrictions=raw.flatMap(p=>[...SM.restrictions(p.after,db),...(E.absenceFor(p.after,studioWork)?['Учитель отмечен отсутствующим']:[])].map(kind=>({kind,lessonIds:[p.id]})));
 return {patches:result.patches,issues:[...result.issues,...restrictions]};
}
function studioClosePopup(){document.querySelector('#studio-popover')?.remove()}
function studioPopup(title,body,actions){
 studioClosePopup();$('#dialog').close();
 const panel=document.createElement('section');panel.id='studio-popover';panel.setAttribute('role','dialog');panel.setAttribute('aria-label',title);
 panel.innerHTML=`<header><strong>${h(title)}</strong><button aria-label="Закрыть сообщение">×</button></header><div class="popover-body">${body}</div><div class="popover-actions">${actions.map((a,i)=>`<button data-pop-action="${i}" class="${a.class||''}">${h(a.text)}</button>`).join('')}</div>`;
 document.body.append(panel);panel.querySelector('header button').onclick=studioClosePopup;
 actions.forEach((a,i)=>panel.querySelector(`[data-pop-action="${i}"]`).onclick=a.action);
 const r=panel.getBoundingClientRect();panel.style.left=Math.max(6,Math.min(studioPointer.x+12,innerWidth-r.width-6))+'px';panel.style.top=Math.max(6,Math.min(studioPointer.y+12,innerHeight-r.height-6))+'px';
 panel.querySelector('[data-pop-action]')?.focus({preventScroll:true});
}
function studioConfirm(label,raw){
 const r=studioCheck(raw);const notes=[...new Set(r.issues.map(x=>x.kind))];
 if(!notes.length){studioApply(label,r.patches);return}
 const moving=new Set(raw.map(p=>p.id));
 const otherIds=new Set(r.issues.flatMap(i=>i.lessonIds||[]).filter(id=>!moving.has(id)));
 const occupied=[...otherIds].map(id=>studioRows.find(l=>l.id===id)).filter(Boolean);
 studioPopup('Конфликт',`<ul>${notes.map(n=>`<li>${h(n)}</li>`).join('')}</ul>${occupied.length?`<small>${occupied.slice(0,3).map(l=>h(lookup('classes',l.classId)?.name+' · '+studioSubject(l)+' · '+days[SM.day(l.date)]+' '+l.slot)).join('<br>')}</small>`:''}`,[{text:'Не размещать',action:studioClosePopup},{text:'Игнорировать конфликт и разместить',class:'primary',action:()=>studioApply(label,r.patches,true)}]);
}
function studioTime(classId,d,slot){const l=studioRows.find(l=>l.classId===classId&&l.date===d&&l.slot===slot&&l.time)||db.lessons.find(l=>l.classId===classId&&l.slot===slot&&l.time);return {time:l?.time||'',callId:l?.callId||null}}
function studioPlan(td,action='together'){
 const old=studioRows.find(l=>l.id===studioPick?.id);if(!old)throw Error('Выберите урок');
 if(!SM.targetAllowed(old,studioAxis,td.dataset.entity))throw Error(studioAxis==='teachers'?'Выберите строку учителя этого урока':studioAxis==='rooms'?'Выберите строку кабинета этого урока':'Карточку можно разместить только в строке её класса');
 const target=[...td.querySelectorAll('[data-lesson]')].map(e=>studioRows.find(l=>l.id===e.dataset.lesson)).find(l=>l.id!==old.id&&(!old.blockId||l.blockId!==old.blockId))?.id;
 const local=W.slice(studioWork,[old.date,td.dataset.date]);
 const patches=W.plan(local,old.id,td.dataset.date,+td.dataset.slot,{targetId:target===old.id?null:target,action,timingDB:studioWork});
 Object.assign(patches[0].after,studioTime(old.classId,td.dataset.date,+td.dataset.slot));
 patches[0].after.parkingArea=null;patches[0].after.suspended=false;const absent=E.absenceFor({...patches[0].after,parked:false},studioWork);patches[0].after.absenceReturnFor=absent?.id||null;
 if(old.blockId){for(const partner of studioRows.filter(l=>l.id!==old.id&&l.blockId===old.blockId&&l.date===old.date)){if(partner.locked)throw Error('Сначала снимите закрепление всех уроков спарки');const slot=+td.dataset.slot+(partner.blockOffset||0)-(old.blockOffset||0);if(slot<1||slot>studioSlots)throw Error('Блок уроков не помещается в этот день');patches.push({id:partner.id,before:partner,after:{...partner,...patches[0].after,id:partner.id,slot,blockOffset:partner.blockOffset,...studioTime(partner.classId,td.dataset.date,slot)}})}}
 return patches;
}
function studioPlace(td){
 if(!studioPick)return;
 try{
  const old=studioRows.find(l=>l.id===studioPick.id);
  if(!SM.targetAllowed(old,studioAxis,td.dataset.entity)){studioHover(td);return}
  if(!old.parked&&!old.suspended&&old.date===td.dataset.date&&old.slot===+td.dataset.slot&&(['classes','general'].includes(studioAxis)||old[studioAxis==='teachers'?'teacherId':'roomId']===td.dataset.entity)){studioCancel();return}
  const occupants=[...td.querySelectorAll('[data-lesson]')].map(e=>studioRows.find(l=>l.id===e.dataset.lesson)).filter(l=>l&&l.id!==old.id&&(!old.blockId||l.blockId!==old.blockId));
  if(occupants.some(l=>l.classId===old.classId)){
   studioPopup('Ячейка занята',`<p>${h(studioBrief(old))}</p><p>Выберите действие. При совместном размещении ни один урок не удаляется.</p>`,[{text:'Назад',action:studioClosePopup},{text:'Поменять местами',action:()=>studioConfirm('Обмен уроками',studioPlan(td,'swap'))},{text:'Вытеснить в резерв',action:()=>studioConfirm('Перенос с резервом',studioPlan(td,'stash'))},{text:'Поместить вместе',class:'primary',action:()=>studioConfirm('Совместное размещение',studioPlan(td))}]);
  }else studioConfirm('Перенос урока',studioPlan(td));
 }catch(e){message(e.message)}
}
function studioPark(area){
 if(!studioPick)return;try{const picked=studioRows.find(l=>l.id===studioPick.id);const members=picked.blockId?studioRows.filter(l=>l.blockId===picked.blockId&&l.date===picked.date):[picked];const p=members.flatMap(l=>W.park(studioWork,l.id)).map(p=>({...p,after:{...p.after,parkingArea:area}}));studioApply(area==='side'?'Убрать в боковую область':'Убрать в неразмещённые',p)}catch(e){message(e.message)}
}
let studioPointer={x:0,y:0};
function studioCancel(){studioClosePopup();studioPick=null;studioGhost?.remove();studioGhost=null;$$('.picked,.target-ok,.target-bad,.target-block,.target-pending').forEach(e=>e.classList.remove('picked','target-ok','target-bad','target-block','target-pending'));$('#studio-hint')?.replaceChildren(document.createTextNode('Клик — взять · следующий клик — разместить · Esc — отменить · правая кнопка — изменить'))}
function studioTake(id){
 const l=studioRows.find(l=>l.id===id);if(!l)return;
 if(l.locked||l.cancelled){message('Сначала снимите закрепление или восстановите урок.');return}
 studioCancel();studioPick={id,cache:new Map()};selectedLesson=id;
 studioGhost=document.createElement('div');studioGhost.id='studio-ghost';studioGhost.innerHTML=card(l)+'<small>Выберите ячейку · Esc — отмена</small>';document.body.append(studioGhost);
 studioGhost.style.left=Math.min(innerWidth-180,studioPointer.x+12)+'px';studioGhost.style.top=Math.min(innerHeight-70,studioPointer.y+12)+'px';
 $$('[data-lesson]').filter(e=>e.dataset.lesson===id).forEach(e=>e.classList.add('picked'));
 const key=studioAxis==='teachers'?'teacherId':studioAxis==='rooms'?'roomId':'classId';
 $$('[data-row-head]').forEach(e=>{e.classList.toggle('target-ok',e.dataset.rowHead===l[key]);e.classList.toggle('target-block',e.dataset.rowHead!==l[key])});
 const pickup=studioPick,heads=$$('[data-col-head]');let nextHead=0;
 heads.forEach(head=>head.classList.add('target-pending'));
 // Yield between columns so picking up a card never waits for the whole week.
 const paintNext=()=>{
  if(studioPick!==pickup||nextHead>=heads.length)return;
  const head=heads[nextHead++],[d,n]=head.dataset.colHead.split('|');
  const td=$(`[data-entity="${l[key]}"][data-date="${d}"][data-slot="${n}"]`);
  if(td){const result=studioAvailability(td);head.classList.remove('target-pending');head.classList.add(result.blocked?'target-block':result.notes.length?'target-bad':'target-ok')}
  if(nextHead<heads.length)requestAnimationFrame(paintNext);
 };
 requestAnimationFrame(paintNext);
 $('#studio-hint').textContent=studioBrief(l)+' · выберите место; правая/нижняя область — временно убрать';
}
function studioAvailability(td){
 const key=td.dataset.entity+'|'+td.dataset.date+'|'+td.dataset.slot;
 if(!studioPick.cache.has(key)){try{const r=studioCheck(studioPlan(td));studioPick.cache.set(key,{notes:[...new Set(r.issues.map(x=>x.kind))]})}catch(e){studioPick.cache.set(key,{blocked:true,notes:[e.message]})}}
 return studioPick.cache.get(key);
}
function studioHover(td){
 if(!studioPick)return;
 const r=studioAvailability(td),state=r.blocked?'target-block':r.notes.length?'target-bad':'target-ok';
 const head=$(`[data-col-head="${td.dataset.date}|${td.dataset.slot}"]`);if(!r.blocked){head?.classList.remove('target-ok','target-bad','target-pending');head?.classList.add(state)}
 const row=td.parentElement.firstElementChild;if(!r.blocked){row.classList.remove('target-ok','target-bad');row.classList.add(state)}
 studioGhost?.classList.toggle('conflict',!!r.notes.length&&!r.blocked);
 if(studioGhost)studioGhost.querySelector('small').textContent=r.notes.join('; ')||'Клик — разместить';
}
function studioTray(area,rows){
 const sort=studioFilters[area],key=sort==='teacher'?'teacherId':'classId';
 const items=[...rows].sort((a,b)=>sort==='all'?a.date.localeCompare(b.date)||a.slot-b.slot:String(lookup(key==='classId'?'classes':'teachers',a[key])?.name||'').localeCompare(String(lookup(key==='classId'?'classes':'teachers',b[key])?.name||''),'ru',{numeric:true}));
 return `<header><strong>${area==='side'?'Отсутствия / снятые':'Неразмещённые'} <span>${rows.length}</span></strong><select data-tray-sort="${area}" aria-label="Сортировка ${area==='side'?'отсутствий':'резерва'}"><option value="all" ${sort==='all'?'selected':''}>Все уроки</option><option value="class" ${sort==='class'?'selected':''}>По классу</option><option value="teacher" ${sort==='teacher'?'selected':''}>По учителю</option></select></header><div class="studio-tray-content">${area==='side'&&sort==='all'?`<div class="side-spacer"></div>${studioEntities.map(e=>`<div class="side-line">${items.filter(l=>l[studioAxis==='teachers'?'teacherId':studioAxis==='rooms'?'roomId':'classId']===e.id).map(card).join('')}</div>`).join('')}`:items.map(l=>`<div class="tray-item"><small>${h(sort==='teacher'?studioTeacher(l.teacherId):lookup('classes',l.classId)?.name)}${studioPeriod==='weeks'?' · '+h(fmt(l.date)):''}</small>${card(l)}</div>`).join('')||'<p class="hint">Кликните сюда с выбранной карточкой</p>'}</div>`;
}
renderSchedule=function(){
 mode='week';compact=true;grade='all';classFilter='';
 studioWork=studioContext();studioRows=E.effective(studioWork);
 const week=studioPeriod==='base'?SM.anchor(db):monday(date);
 studioDates=Array.from({length:5},(_,i)=>E.addDays(week,i));
 studioRows=studioRows.filter(l=>studioDates.includes(l.date));
 studioWork={...studioWork,baseSchedule:null,lessons:studioRows,extraLessons:[],overrides:{}};
 const ids=new Set(selected().map(c=>c.id));
 const visible=studioRows.filter(l=>studioDates.includes(l.date)&&ids.has(l.classId)&&!l.cancelled);
 const side=visible.filter(l=>l.parkingArea==='side'||l.suspended);
 const bottom=visible.filter(l=>l.parked&&l.parkingArea!=='side');
 const rows=visible.filter(l=>!l.parked&&!l.suspended);
 const type=studioAxis==='general'?'classes':studioAxis,key=type==='classes'?'classId':type==='teachers'?'teacherId':'roomId';
 studioEntities=type==='classes'?selected():db[type].filter(e=>visible.some(l=>l[key]===e.id));
 studioSlots=Math.max(8,...visible.map(l=>l.slot));
 const index=new Map();for(const l of rows){const k=[l[key],l.date,l.slot].join('|');if(!index.has(k))index.set(k,[]);index.get(k).push(l)}
 $('#heading-actions').innerHTML='';
 $('#controls').innerHTML=`<div class="studio-toolbar"><div class="segmented"><button data-period="base" class="${studioPeriod==='base'?'active':''}">Основное расписание</button><button data-period="weeks" class="${studioPeriod==='weeks'?'active':''}">По неделям</button></div>${studioPeriod==='weeks'?dateBar()+'<button id="studio-today">Сегодня</button>':''}<div class="segmented">${[['classes','Классы'],['teachers','Учителя'],['rooms','Кабинеты'],['general','Общее']].map(([k,n])=>`<button data-studio-axis="${k}" class="${studioAxis===k?'active':''}">${n}</button>`).join('')}</div><button id="class-choice">Выбор классов</button><button id="display-settings">Вид карточки</button><span class="spacer"></span><button id="studio-absence">Отсутствие</button><button id="studio-print">Печать</button><button id="studio-undo" ${db.history.length?'':'disabled'}>Отменить</button></div>`;
 const problems=E.conflicts(studioWork,rows),problemIds=new Set(problems.flatMap(x=>x.lessonIds));
 $('#view').innerHTML=`<div class="studio-meta"><span>${studioPeriod==='base'?'Основа · изменения повторяются по неделям':fmt(studioDates[0])+' — '+fmt(studioDates[4])+' · исключения выбранной недели'} · ${studioEntities.length} строк</span><button id="studio-warnings">${problems.length} замечаний</button></div><div id="studio-workspace"><div class="studio-grid"><table class="studio-matrix"><colgroup><col class="entity-col">${studioDates.map(()=>Array.from({length:studioSlots},()=>'<col>').join('')).join('')}</colgroup><thead><tr><th rowspan="2">${type==='classes'?'Класс':type==='teachers'?'Учитель':'Кабинет'}</th>${studioDates.map(d=>`<th colspan="${studioSlots}">${days[SM.day(d)]}${studioPeriod==='weeks'?` <small>${fmt(d)}</small>`:''}</th>`).join('')}</tr><tr>${studioDates.map(d=>Array.from({length:studioSlots},(_,i)=>`<th data-col-head="${d}|${i+1}">${i+1}</th>`).join('')).join('')}</tr></thead><tbody>${studioEntities.map(e=>`<tr><th data-row-head="${e.id}" title="${h(e.name)}">${h(type==='teachers'?studioTeacher(e.id):type==='rooms'?PrintTools.roomNumber(e.name):e.name)}</th>${studioDates.map(d=>Array.from({length:studioSlots},(_,i)=>{const ls=E.sortProfileRows(index.get([e.id,d,i+1].join('|'))||[],db);return `<td data-entity="${e.id}" data-date="${d}" data-slot="${i+1}" tabindex="0" aria-label="${h(e.name)} ${days[SM.day(d)]} урок ${i+1}" class="${i===0?'day-start':''}"><div class="studio-stack">${ls.map(l=>card({...l,placementForced:l.placementForced||problemIds.has(l.id)})).join('')}</div></td>`}).join('')).join('')}</tr>`).join('')}</tbody></table></div><div id="studio-v-split" role="separator" aria-label="Ширина правой области" aria-orientation="vertical" tabindex="0"></div><aside id="studio-side" class="studio-tray" data-park="side">${studioTray('side',side)}</aside><div id="studio-h-split" role="separator" aria-label="Высота нижней области" aria-orientation="horizontal" tabindex="0"></div><section id="studio-bottom" class="studio-tray" data-park="bottom">${studioTray('bottom',bottom)}</section></div><div id="studio-hint" role="status">Клик — взять · следующий клик — разместить · Esc — отменить · правая кнопка — изменить</div>`;
 $$('[data-period]').forEach(b=>b.onclick=()=>{studioCancel();studioPeriod=b.dataset.period;render()});
 $$('[data-studio-axis]').forEach(b=>b.onclick=()=>{studioCancel();studioAxis=b.dataset.studioAxis;render()});
 if(studioPeriod==='weeks'){bindDateBar(7);$('#studio-today').onclick=()=>{date=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow'}).format(new Date());render()}}
 $('#class-choice').onclick=showClassChoice;$('#display-settings').onclick=showSettings;
 $('#studio-absence').onclick=()=>{if(studioPeriod==='base'){studioPeriod='weeks';date=SM.anchor(db);render()}showAbsence()};
 $('#studio-print').onclick=()=>{date=studioPeriod==='base'?SM.anchor(db):date;showPrint()};
 $('#studio-undo').onclick=undo;$('#studio-warnings').onclick=()=>setRoute('conflicts');
 $$('[data-tray-sort]').forEach(s=>s.onchange=()=>{studioFilters[s.dataset.traySort]=s.value;render()});
 bindCards();studioBindSplit();studioResizeObserver?.disconnect();studioResizeObserver=new ResizeObserver(studioFit);studioResizeObserver.observe($('.studio-grid'));studioFit();
};
bindCards=function(){
 if(route!=='schedule'){ // Existing replacement desk uses selection, not pickup.
  $$('[data-lesson]').forEach(b=>{b.onclick=()=>{selectedLesson=b.dataset.lesson;renderInspector()};b.oncontextmenu=e=>{e.preventDefault();showLesson(b.dataset.lesson)}});return;
 }
 $$('[data-lesson]').forEach(b=>{
  b.draggable=false;
  b.onclick=e=>{if(studioPick){if(b.closest('td'))return; e.stopPropagation();if(b.dataset.lesson===studioPick.id)studioCancel();else studioPark(b.closest('[data-park]').dataset.park);return}e.stopPropagation();studioTake(b.dataset.lesson)};
  b.oncontextmenu=e=>{e.preventDefault();studioCancel();showLesson(b.dataset.lesson)};
 });
 $$('[data-entity]').forEach(td=>{
  td.onclick=()=>{if(studioPick)studioPlace(td)};
  td.onpointerenter=()=>studioHover(td);
  td.oncontextmenu=e=>{e.preventDefault();studioCancel();const l=td.querySelector('[data-lesson]');if(l)showLesson(l.dataset.lesson);else if(['classes','general'].includes(studioAxis))showLesson(null,{classId:td.dataset.entity,date:td.dataset.date,slot:+td.dataset.slot})};
  td.onkeydown=e=>{if(e.target===td&&(e.key==='Enter'||e.key===' ')){e.preventDefault();if(studioPick)studioPlace(td);else {const b=td.querySelector('[data-lesson]');if(b)studioTake(b.dataset.lesson)}}};
 });
 $$('[data-park]').forEach(t=>t.onclick=e=>{if(!e.target.closest('select,button')&&studioPick)studioPark(t.dataset.park)});
};
function studioFit(){
 const workspace=$('#studio-workspace');if(!workspace)return;
 workspace.style.setProperty('--side-width',studioSide+'px');workspace.style.setProperty('--bottom-height',studioBottom+'px');
 const grid=$('.studio-grid'),n=Math.max(1,studioEntities.length),rowHeight=Math.max(1,(grid.clientHeight-38-n)/n);
 workspace.style.setProperty('--row-height',rowHeight+'px');
 const colWidth=Math.max(1,(grid.clientWidth-(studioAxis==='teachers'?110:44))/(studioSlots*5));
 workspace.style.setProperty('--card-width',colWidth+'px');workspace.style.setProperty('--card-height',Math.max(7,Math.min(24,rowHeight))+'px');
 workspace.style.setProperty('--card-font',Math.max(6,Math.min(12,colWidth/3.2,rowHeight*.65))+'px');
 $$('#studio-workspace .studio-card').forEach(c=>{
  const stack=c.closest('.studio-stack'),height=stack?rowHeight/(stack.children.length||1):Math.min(24,rowHeight);
  const width=colWidth,len=[...c.textContent].length||1;
  const size=Math.max(6,Math.min(16,height*.9,(width-2)/(len*.56)));
  if(c.style.getPropertyValue('--studio-font')!==size+'px')c.style.setProperty('--studio-font',size+'px');
 });

}
function studioBindSplit(){
 for(const [id,kind]of [['studio-v-split','side'],['studio-h-split','bottom']]){
  const el=$('#'+id);el.onpointerdown=e=>{e.preventDefault();el.setPointerCapture(e.pointerId);const x=e.clientX,y=e.clientY,initial=kind==='side'?studioSide:studioBottom;
   el.onpointermove=ev=>{if(kind==='side')studioSide=Math.max(60,Math.min(innerWidth*.4,initial+x-ev.clientX));else studioBottom=Math.max(40,Math.min(innerHeight*.35,initial+y-ev.clientY));studioFit()};
   el.onpointerup=()=>{el.onpointermove=null;settings.studioLayout={side:studioSide,bottom:studioBottom};dirty=true;persist()};
  };
  el.onkeydown=e=>{if(!e.key.startsWith('Arrow'))return;e.preventDefault();if(kind==='side')studioSide=Math.max(60,studioSide+(e.key==='ArrowLeft'?10:-10));else studioBottom=Math.max(40,studioBottom+(e.key==='ArrowUp'?10:-10));settings.studioLayout={side:studioSide,bottom:studioBottom};studioFit();dirty=true;persist()};
 }
}
showSettings=function(){
 const v=studioView();dialog('Вид карточки',`<p>В режиме «Общее» выберите содержимое. «Классы» показывают предмет, «Учителя» и «Кабинеты» — классы. Сокращения и подгруппы действуют во всех режимах.</p><div class="form-grid">${[['subject','Предмет'],['teacher','Учитель: фамилия и инициалы'],['room','Номер кабинета'],['group','Подгруппа / профиль'],['abbreviate','Сокращения предметов']].map(([k,n])=>`<label class="checkbox-line"><input type="checkbox" data-studio-field="${k}" ${v[k]?'checked':''}>${n}</label>`).join('')}</div>`,[{text:'Отмена',action:()=>$('#dialog').close()},{text:'Применить',class:'primary',action:()=>{settings.studioDisplay=Object.fromEntries($$('[data-studio-field]').map(e=>[e.dataset.studioField,e.checked]));$('#dialog').close();dirty=true;render()}}]);
};
const studioOldLesson=showLesson;
showLesson=function(id,initial){
 if(route!=='schedule'){studioOldLesson(id,initial);return}
 const old=id?studioRows.find(l=>l.id===id):{id:'studio-'+crypto.randomUUID(),teacherId:null,roomId:null,subjectId:db.subjects[0]?.id,...initial};if(!old)return;
 const groups=db.groups.filter(g=>g.classId===old.classId);const originalGroup=old.groupId||groups.find(g=>g.name===old.groupName)?.id||'';
 dialog(id?'Редактировать урок':'Добавить урок',`<p>${h(lookup('classes',old.classId)?.name)} · ${studioPeriod==='base'?'основное расписание':'выбранная неделя'}</p><div class="form-grid"><label>Предмет<select id="studio-edit-subject">${options(db.subjects,old.subjectId)}</select></label><label>Учитель<select id="studio-edit-teacher">${options(db.teachers,old.teacherId,'Не назначен')}</select></label><label>Кабинет<select id="studio-edit-room">${options(db.rooms,old.roomId,'Автоматически')}</select></label><label>Подгруппа<select id="studio-edit-group">${options(groups,originalGroup,'Весь класс')}</select></label><label>День<select id="studio-edit-day">${studioDates.map(d=>`<option value="${d}" ${d===old.date?'selected':''}>${days[SM.day(d)]}${studioPeriod==='weeks'?' '+fmt(d):''}</option>`).join('')}</select></label><label>Номер урока<input id="studio-edit-slot" type="number" min="1" max="20" value="${old.slot}"></label><label>Время (чч:мм - чч:мм)<input id="studio-edit-time" value="${h(old.time||E.slotInfo(db,old.classId,old.date,old.slot).time||'')}" placeholder="08:30 - 09:15"></label><label class="checkbox-line"><input id="studio-edit-lock" type="checkbox" ${old.locked?'checked':''}>Закрепить урок</label></div><p id="studio-edit-error" role="alert" class="error"></p>`,[{text:'Отмена',action:()=>$('#dialog').close()},...(id?[{text:'В резерв',action:()=>studioApply('Убрать в резерв',[{id:old.id,before:old,after:{...old,parked:true,parkingArea:'bottom'}}])}]:[]),{text:'Сохранить',class:'primary',action:()=>{
  const slot=+$('#studio-edit-slot').value,d=$('#studio-edit-day').value;if(!Number.isInteger(slot)||slot<1||slot>20){$('#studio-edit-error').textContent='Номер урока от 1 до 20';return}
  const group=db.groups.find(g=>g.id===$('#studio-edit-group').value);
  const clock=$('#studio-edit-time').value.trim();if(clock&&!/^([01]\d|2[0-3]):[0-5]\d\s*[-–]\s*([01]\d|2[0-3]):[0-5]\d$/.test(clock)){$('#studio-edit-error').textContent='Время: чч:мм - чч:мм';return}
  const after={...old,subjectId:$('#studio-edit-subject').value,teacherId:$('#studio-edit-teacher').value||null,roomId:$('#studio-edit-room').value||null,roomMode:$('#studio-edit-room').value?'manual':'auto',groupId:group?.id||null,groupName:group?.name||null,profileAudience:group?.id===originalGroup?old.profileAudience:null,date:d,slot,locked:$('#studio-edit-lock').checked,...E.slotInfo(db,old.classId,d,slot),time:$('#studio-edit-time').value.trim()};
  studioConfirm('Редактирование урока',[{id:old.id,before:old,after}]);
 }}]);
};
const studioAbsenceBefore=showAbsence;
showAbsence=function(){
 studioAbsenceBefore();const b=$('#dialog-action-0'),act=b.onclick;
 b.textContent='Добавить и показать снятые уроки';b.onclick=()=>{act();if(!$('#dialog').open){studioPeriod='weeks';setRoute('schedule')}};
};
document.addEventListener('pointermove',e=>{studioPointer={x:e.clientX,y:e.clientY};if(studioGhost){studioGhost.style.left=Math.max(0,Math.min(innerWidth-180,e.clientX+12))+'px';studioGhost.style.top=Math.max(0,Math.min(innerHeight-70,e.clientY+12))+'px'}});
document.addEventListener('keydown',e=>{if(e.key==='Escape')studioCancel()});
$('#dialog').addEventListener('close',()=>{$('#dialog').style.margin='';$('#dialog').style.left='';$('#dialog').style.top=''});
const studioBootRender=render;
render=function(){if(db?.preferences?.studioLayout){studioSide=db.preferences.studioLayout.side;studioBottom=db.preferences.studioLayout.bottom}if(route!=='schedule')studioCancel();studioBootRender()};
