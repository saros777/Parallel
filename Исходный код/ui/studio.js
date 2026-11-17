/* Full-window timetable editor. One click picks up, the next places; Escape cancels. */
const SM=StudioModel;
let studioPeriod='base',studioAxis='classes',studioTeacherSpan='week',studioTeacherDay=1,studioPick=null,studioWork=null,studioRows=[],studioRoomRows=[],studioDates=[],studioEntities=[],studioSlots=8,studioFilters={bottom:{mode:'all',value:''},side:{mode:'all',value:''}},studioGhost=null,studioRedo=[];
date=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow'}).format(new Date());
let studioBottom=90,studioSide=160,studioResizeObserver=null;
const studioFields=['classes','teachers','rooms','subjects','courses','groups','teacherSubjects','baseSchedule'];
const studioEditableBefore=editable;
editable=function(){return {...studioEditableBefore(),...Object.fromEntries(studioFields.map(k=>[k,structuredClone(db[k]??(k==='baseSchedule'?null:[]))])),preferences:structuredClone(settings)}};
transact=function(label,fn){
 const before=editable();fn();const entry=ProjectModel.historyEntry(label,before,editable());
 if(!entry)return;
 studioRedo=[];
 db.history.push(entry);if(db.history.length>200)db.history.splice(0,db.history.length-200);
 dirty=true;render();message(label+'.');
};
const studioUndoBefore=undo;
undo=function(){const last=db.history.at(-1);if(!last)return;if(last.format!==2){if(last.before?.preferences)settings=structuredClone(last.before.preferences);studioCancel();studioUndoBefore();return}db.history.pop();ProjectModel.restoreHistory(db,last);studioRedo.push(last);if(last.values?.preferences)settings=structuredClone(db.preferences);studioCancel();dirty=true;render();message('Отменено: '+last.label+'.')};
function redo(){const entry=studioRedo.pop();if(!entry)return;ProjectModel.restoreHistory(db,entry,'after');db.history.push(entry);if(entry.values?.preferences)settings=structuredClone(db.preferences);studioCancel();dirty=true;render();message('Повторено: '+entry.label+'.')}
stateMark=function(){return JSON.stringify([db.overrides,db.extraLessons,db.absences,db.history.length,settings,...studioFields.map(k=>db[k])])};
const studioRenderBefore=render;
render=function(){
 settings.studioSuspensions=true;
 document.body.classList.toggle('studio-page',route==='schedule');
 studioRenderBefore();
 if(route==='schedule'){$('#teacher-rooms')?.remove();$('#day-room-edit')?.remove();studioFit()}
};
function studioView(){return {subject:true,className:true,teacher:false,room:true,group:false,abbreviate:true,...settings.studioDisplay}}
function studioSubject(l){
 const s=lookup('subjects',l.subjectId);if(!studioView().abbreviate)return s?.name||'Предмет';
 if(settings.labels?.[l.subjectId])return settings.labels[l.subjectId];
 if(s?.abbreviation)return s.abbreviation;
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
 if(v.subject&&['teachers','rooms'].includes(studioAxis))parts.push(studioSubject(l));
 if(v.className&&['teachers','rooms'].includes(studioAxis))parts.push(lookup('classes',l.classId)?.name||'—');
 if(studioAxis==='general'&&v.teacher)parts.push(studioTeacher(l.teacherId));
 const quickRoom=v.room&&studioAxis==='teachers',roomText=l.roomId?PrintTools.roomNumber(roomName(l.roomId)):'—';
 if(v.room&&studioAxis!=='rooms'&&!quickRoom)parts.push(roomText);
 if(v.teacher&&studioAxis==='rooms')parts.push(studioTeacher(l.teacherId));
 if(v.group&&studioGroup(l))parts.push(studioGroup(l));
 if(l.cycleWeeks===2)parts.push(l.cyclePhase?'II':'I');
 const color=lookup('teachers',l.teacherId)?.color||W.teacherColor(l.teacherId,db);
 const text=parts.join(' · ')||'·',measure=text+(quickRoom?' · '+roomText:'');
 return `<button type="button" class="lesson studio-card ${l.placementForced?'forced':''} ${studioPick?.id===l.id?'picked':''}" data-lesson="${h(l.id)}" style="--subject-color:${h(color)};--text-length:${[...measure].length||1};--text-em:${typeof studioTextMeasure==='function'?studioTextMeasure(measure):1.8}" title="${h(studioBrief(l))}" aria-label="${h(studioBrief(l))}"><span class="studio-card-text">${h(text)}</span>${quickRoom?`<span class="studio-room-chip" data-room-chip="${h(l.id)}" title="Изменить кабинет">${h(roomText)}</span>`:''}</button>`;
};
function studioVisualParts(rows,entityId,problemIds=new Set()){
 const sorted=E.sortProfileRows(rows||[],db);
 if(!['classes','general'].includes(studioAxis))return sorted.map(lesson=>({lesson}));
 const className=lookup('classes',entityId)?.name||'';
 const normalized=sorted.map(lesson=>({...lesson,profileAudience:E.profileAudience(lesson,db)}));
 return PrintTools.slotParts(normalized,className).map(part=>part.lesson?{...part,lesson:{...part.lesson,placementForced:part.lesson.placementForced||problemIds.has(part.lesson.id)}}:part);
}
function studioVisualCell(rows,entityId,problemIds=new Set()){
 const parts=studioVisualParts(rows,entityId,problemIds);
 const tracks=Math.max(1,...parts.map(part=>part.lanes||1));
 return {parts:tracks,html:parts.map(part=>{const position=`grid-row:${(part.start??0)+1}/span ${part.span||1}`;return part.lesson?card(part.lesson).replace('style="',`style="${position};`):`<span class="studio-lane-empty" style="${position}" aria-hidden="true"></span>`}).join('')};
}
function studioRowFactor(entity,type){return type==='classes'&&entity.name==='10а'?1.7:type==='classes'&&entity.name==='11'?2.25:1}
selected=function(){return db.classes.filter(c=>!selectedClasses||selectedClasses.has(c.id))};
function studioContext(){
 if(studioPeriod==='base')return {...db,basePreview:true,baseSchedule:null,lessons:SM.template(db),overrides:{},extraLessons:[],absences:[],calendar:[]};
 return db;
}
function studioApply(label,patches,forced=false,carryId=null){
 studioCancel();$('#dialog').close();
 transact(label,()=>{
  const changes=patches.map(p=>({...p,after:{...p.after,placementForced:forced}}));
  if(studioPeriod==='base')SM.commitBase(db,changes);
  else changes.forEach(p=>{if(!db.lessons.some(l=>l.id===p.id)&&!SM.expand(db).some(l=>l.id===p.id)&&!db.extraLessons.some(l=>l.id===p.id))db.extraLessons.push(p.after);else db.overrides[p.id]={...db.overrides[p.id],...p.after}});
 });
 // A click on an occupied cell completes the exchange in one undoable
 // transaction, then immediately continues with the displaced card.
 if(carryId&&studioRows.some(l=>l.id===carryId&&!l.cancelled))studioTake(carryId);
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
function studioConfirm(label,raw,carryId=null){
 const r=studioCheck(raw);const notes=[...new Set(r.issues.map(x=>x.kind))];
 if(!notes.length){studioApply(label,r.patches,false,carryId);return}
 const moving=new Set(raw.map(p=>p.id));
 const otherIds=new Set(r.issues.flatMap(i=>i.lessonIds||[]).filter(id=>!moving.has(id)));
 const occupied=[...otherIds].map(id=>studioRows.find(l=>l.id===id)).filter(Boolean);
 studioPopup('Конфликт',`<ul>${notes.map(n=>`<li>${h(n)}</li>`).join('')}</ul>${occupied.length?`<small>${occupied.slice(0,3).map(l=>h(lookup('classes',l.classId)?.name+' · '+studioSubject(l)+' · '+days[SM.day(l.date)]+' '+l.slot)).join('<br>')}</small>`:''}`,[{text:'Не размещать',action:studioClosePopup},{text:'Игнорировать конфликт и разместить',class:'primary',action:()=>studioApply(label,r.patches,true,carryId)}]);
}
function studioTime(classId,d,slot){const l=studioRows.find(l=>l.classId===classId&&l.date===d&&l.slot===slot&&l.time)||db.lessons.find(l=>l.classId===classId&&l.slot===slot&&l.time);return {time:l?.time||'',callId:l?.callId||null}}
function studioPlacement(td,targetId=null){
 const old=studioRows.find(l=>l.id===studioPick?.id);if(!old)throw Error('Выберите урок');
 if(!SM.targetAllowed(old,studioAxis,td.dataset.entity))throw Error(studioAxis==='teachers'?'Выберите строку учителя этого урока':studioAxis==='rooms'?'Выберите строку кабинета этого урока':'Карточку можно разместить только в строке её класса');
 const members=old.blockId?studioRows.filter(l=>l.blockId===old.blockId&&l.date===old.date):[old],memberIds=new Set(members.map(l=>l.id));
 if(members.some(l=>l.locked))throw Error('Сначала снимите закрепление всех уроков спарки');
 const targetDate=td.dataset.date,targetSlot=+td.dataset.slot,probes=members.map(l=>({...l,date:targetDate,slot:targetSlot+(l.blockOffset||0)-(old.blockOffset||0),parked:false,suspended:false}));
 if(probes.some(l=>l.slot<1||l.slot>studioSlots))throw Error('Блок уроков не помещается в этот день');
 const occupants=[...td.querySelectorAll('[data-lesson]')].map(e=>studioRows.find(l=>l.id===e.dataset.lesson)).filter(l=>l&&!memberIds.has(l.id)&&!l.cancelled&&!l.parked&&!l.suspended&&l.classId===old.classId);
 const exact=targetId?occupants.find(l=>l.id===targetId):null,overlapping=occupants.filter(l=>!E.disjoint(old,l,db));
 if(overlapping.length>1)throw Error('В ячейке несколько подгрупп. Перемещайте их отдельно');
 // Complementary subgroups share a slot. Clicking such a card must not
 // displace it; only an overlapping lesson is exchanged.
 const target=exact&&!E.disjoint(old,exact,db)?exact:(overlapping[0]||null);
 // Teacher occupancy is deliberately not a hard placement restriction.
 // The final-state assessment reports it as a red warning and lets the user
 // place the card after confirmation.  This also keeps ordinary swaps usable.
 if(target?.locked)throw Error('Целевой урок закреплён. Сначала снимите закрепление');
 if(target?.blockId||members.length>1&&target)throw Error('Спарку можно обменивать только целиком');
 return {old,members,target,probes,action:target?'swap':'together'};
}
function studioPlan(td,action=null,targetId=null){
 const placement=studioPlacement(td,targetId),{old,target}=placement;action=action||placement.action;
 const local=W.slice(studioWork,[old.date,td.dataset.date]);
 const patches=W.plan(local,old.id,td.dataset.date,+td.dataset.slot,{targetId:target?.id||null,action,timingDB:studioWork});
 Object.assign(patches[0].after,studioTime(old.classId,td.dataset.date,+td.dataset.slot));
 patches[0].after.parkingArea=null;patches[0].after.suspended=false;const absent=E.absenceFor({...patches[0].after,parked:false},studioWork);patches[0].after.absenceReturnFor=absent?.id||null;
 if(old.blockId){for(const partner of studioRows.filter(l=>l.id!==old.id&&l.blockId===old.blockId&&l.date===old.date)){if(partner.locked)throw Error('Сначала снимите закрепление всех уроков спарки');const slot=+td.dataset.slot+(partner.blockOffset||0)-(old.blockOffset||0);if(slot<1||slot>studioSlots)throw Error('Блок уроков не помещается в этот день');patches.push({id:partner.id,before:partner,after:{...partner,...patches[0].after,id:partner.id,slot,blockOffset:partner.blockOffset,...studioTime(partner.classId,td.dataset.date,slot)}})}}
 return patches;
}
function studioPlace(td,targetId=null){
 if(!studioPick)return;
 try{
  const old=studioRows.find(l=>l.id===studioPick.id);
  if(!SM.targetAllowed(old,studioAxis,td.dataset.entity)){studioHover(td);return}
  if(!old.parked&&!old.suspended&&old.date===td.dataset.date&&old.slot===+td.dataset.slot&&(['classes','general'].includes(studioAxis)||old[studioAxis==='teachers'?'teacherId':'roomId']===td.dataset.entity)){studioCancel();return}
  const placement=studioPlacement(td,targetId),patches=studioPlan(td,placement.action,targetId);
  studioConfirm(placement.target?'Обмен уроками':'Перенос урока',patches,placement.target?.id||null);
 }catch(e){message(e.message)}
}
function studioPark(area){
 if(!studioPick)return;try{const picked=studioRows.find(l=>l.id===studioPick.id);const members=picked.blockId?studioRows.filter(l=>l.blockId===picked.blockId&&l.date===picked.date):[picked];const p=members.flatMap(l=>W.park(studioWork,l.id)).map(p=>({...p,after:{...p.after,parkingArea:area}}));studioApply(area==='side'?'Убрать в боковую область':'Убрать в неразмещённые',p)}catch(e){message(e.message)}
}
let studioPointer={x:0,y:0};
function studioPositionGhost(){if(studioGhost)studioGhost.style.transform=`translate3d(${studioPointer.x}px,${studioPointer.y}px,0) translate(-50%,-50%)`}
function studioCancel(){studioClosePopup();document.querySelector('#studio-room-menu')?.remove();studioPick=null;studioGhost?.remove();studioGhost=null;$$('.picked,.target-ok,.target-bad,.target-block,.target-pending').forEach(e=>e.classList.remove('picked','target-ok','target-bad','target-block','target-pending'));$('#studio-hint')?.replaceChildren(document.createTextNode('Клик — взять · следующий клик — разместить · Esc — отменить · правая кнопка — изменить'))}
function studioTake(id){
 const l=studioRows.find(l=>l.id===id);if(!l)return;
 if(l.locked||l.cancelled){message('Сначала снимите закрепление или восстановите урок.');return}
 studioCancel();studioPick={id,cache:new Map()};selectedLesson=id;
 studioGhost=document.createElement('div');studioGhost.id='studio-ghost';studioGhost.innerHTML=card(l)+'<small>Выберите ячейку · Esc — отмена</small>';document.body.append(studioGhost);
 const source=$$('[data-lesson]').find(e=>e.dataset.lesson===id),rect=source?.getBoundingClientRect();
 studioGhost.style.setProperty('--ghost-width',Math.max(32,rect?.width||44)+'px');studioGhost.style.setProperty('--ghost-height',Math.max(14,rect?.height||22)+'px');studioGhost.style.setProperty('--ghost-font',source?getComputedStyle(source).fontSize:'12px');
 studioPositionGhost();
 $$('[data-lesson]').filter(e=>e.dataset.lesson===id).forEach(e=>e.classList.add('picked'));
 const key=studioAxis==='teachers'?'teacherId':studioAxis==='rooms'?'roomId':'classId';
 $$('[data-row-head]').forEach(e=>{e.classList.remove('target-ok','target-bad','target-block');if(e.dataset.rowHead===l[key])e.classList.add('target-ok')});
 // Availability uses the already rendered rows and is cheap enough to paint
 // the complete week synchronously.  Full room allocation remains part of
 // the final placement check, not the hover/highlight path.
 for(const head of $$('[data-col-head]')){const [d,n]=head.dataset.colHead.split('|'),td=$(`[data-entity="${l[key]}"][data-date="${d}"][data-slot="${n}"]`);if(td){const result=studioAvailability(td);if(!result.blocked)head.classList.add(result.notes.length?'target-bad':'target-ok')}}
 $('#studio-hint').textContent=studioBrief(l)+' · выберите место; правая/нижняя область — временно убрать';
}
function studioQuickAvailability(td){
 const placement=studioPlacement(td),changed=new Set([...placement.members.map(l=>l.id),...(placement.target?[placement.target.id]:[])]),candidates=placement.probes.map(l=>({...l,parked:false,suspended:false}));
 if(placement.target&&!placement.old.parked)candidates.push({...placement.target,date:placement.old.date,slot:placement.old.slot,parked:false,...studioTime(placement.target.classId,placement.old.date,placement.old.slot)});
 const notes=[];
 for(const candidate of candidates){
  notes.push(...SM.restrictions(candidate,db));
  if(E.absenceFor(candidate,studioWork))notes.push('Учитель отмечен отсутствующим');
  if((studioWork.calendar||[]).some(c=>c.classId===candidate.classId&&c.date===candidate.date&&c.isHoliday))notes.push('Неучебный день');
  for(const other of studioRows)if(!changed.has(other.id)&&!other.cancelled&&!other.parked&&!other.suspended)notes.push(...E.pairIssues(candidate,other,studioWork).filter(kind=>kind!=='Кабинет занят одновременно'));
 }
 for(let i=0;i<candidates.length;i++)for(let j=i+1;j<candidates.length;j++)notes.push(...E.pairIssues(candidates[i],candidates[j],studioWork).filter(kind=>kind!=='Кабинет занят одновременно'));
 return {notes:[...new Set(notes)]};
}
function studioAvailability(td){
 const key=td.dataset.entity+'|'+td.dataset.date+'|'+td.dataset.slot;
 if(!studioPick.cache.has(key)){try{studioPick.cache.set(key,studioQuickAvailability(td))}catch(e){studioPick.cache.set(key,{blocked:true,notes:[e.message]})}}
 return studioPick.cache.get(key);
}
function studioHover(td){
 if(!studioPick)return;
 const old=studioRows.find(l=>l.id===studioPick.id),allowed=old&&SM.targetAllowed(old,studioAxis,td.dataset.entity);
 const r=studioAvailability(td),state=r.notes.length?'target-bad':'target-ok';
 const head=$(`[data-col-head="${td.dataset.date}|${td.dataset.slot}"]`),row=td.parentElement.firstElementChild;
 if(allowed&&!r.blocked){head?.classList.remove('target-ok','target-bad','target-block','target-pending');head?.classList.add(state);row.classList.remove('target-ok','target-bad','target-block');row.classList.add(state)}
 studioGhost?.classList.toggle('conflict',allowed&&!r.blocked&&!!r.notes.length);
 if(studioGhost)studioGhost.querySelector('small').textContent=r.notes.join('; ')||'Клик — разместить';
}
function studioFilter(area){const current=studioFilters[area];return typeof current==='string'?studioFilters[area]={mode:current,value:''}:current}
function studioFilterRows(area,rows){
 const f=studioFilter(area),field=f.mode==='teacher'?'teacherId':f.mode==='subject'?'subjectId':'classId';
 const filtered=f.mode==='all'||!f.value?rows:rows.filter(l=>l[field]===f.value);
 return [...filtered].sort((a,b)=>String(lookup(f.mode==='teacher'?'teachers':f.mode==='subject'?'subjects':'classes',a[field])?.name||'').localeCompare(String(lookup(f.mode==='teacher'?'teachers':f.mode==='subject'?'subjects':'classes',b[field])?.name||''),'ru',{numeric:true})||a.slot-b.slot||a.date.localeCompare(b.date));
}
function studioTray(area,rows){
 const f=studioFilter(area),items=studioFilterRows(area,rows),selectedLabel=f.value?(f.mode==='teacher'?studioTeacher(f.value):f.mode==='subject'?studioSubject({subjectId:f.value}):lookup('classes',f.value)?.name):'';
 const label=l=>f.mode==='teacher'?studioTeacher(l.teacherId):f.mode==='subject'?(lookup('subjects',l.subjectId)?.name||'Предмет'):(lookup('classes',l.classId)?.name||'Класс');
 const button=(mode,text)=>`<button type="button" data-tray-filter="${area}" data-filter-mode="${mode}" class="${f.mode===mode?'active':''}" title="${h(text)}">${h(f.mode===mode&&selectedLabel?text.split(' ')[0]+': '+selectedLabel:text)}</button>`;
 const item=(l,withLabel=true)=>`<div class="tray-item">${withLabel?`<small>${h(label(l))}</small>`:''}${card(l)}</div>`;
 // In the default class view every right-hand row mirrors the matching
 // timetable row.  Keeping empty rows is intentional: a picked card can be
 // put back opposite its class without first searching in a flat pile.
 const classRows=area==='side'&&f.mode==='all'&&['classes','general'].includes(studioAxis);
 const entityIds=new Set(studioEntities.map(e=>e.id)),shown=classRows?items.filter(l=>entityIds.has(l.classId)):items;
 const content=classRows?studioEntities.map(e=>`<div class="side-line" data-side-class="${h(e.id)}" aria-label="${h(e.name)}" title="${h(e.name)}" style="--row-factor:${studioRowFactor(e,'classes')}">${shown.filter(l=>l.classId===e.id).map(l=>item(l,false)).join('')}</div>`).join(''):(shown.map(l=>item(l)).join('')||'<p class="hint">Нет карточек для выбранного фильтра</p>');
 return `<header><strong>${area==='side'?'Снятые':'Неразмещённые'} <span>${shown.length}${shown.length!==rows.length?' / '+rows.length:''}</span></strong><span class="tray-filter-buttons">${button('all','Все')}${button('class','Классы')}${button('teacher','Учителя')}${button('subject','Предметы')}</span></header><div class="studio-tray-content${classRows?' side-class-rows':''}"${classRows?' data-class-rows="true"':''}>${content}</div>`;
}
function studioFreeRooms(rows,d,slot,teacherId=null){
 const occupied=new Set(rows.filter(l=>!l.cancelled&&!l.parked&&!l.suspended&&l.date===d&&l.slot===slot&&l.roomId).map(l=>l.roomId));
 const primary=new Map(db.classes.filter(c=>(c.grade||parseInt(c.name))<=4).flatMap(c=>{const room=c.homeRoomId||settings.roomPolicy?.classRooms?.[c.id]?.[0];return room?[[room,c.id]]:[]})),teacherClasses=new Set(teacherId?[...(db.courses||[]).filter(c=>c.teacherId===teacherId).map(c=>c.classId),...rows.filter(l=>l.teacherId===teacherId).map(l=>l.classId)]:[]);
 const familiarPrimary=new Set([...primary].filter(([,classId])=>teacherClasses.has(classId)).map(([room])=>room));
 const free=db.rooms.filter(r=>!occupied.has(r.id)).map(r=>({id:r.id,text:PrintTools.roomNumber(r.name)||r.name,primary:primary.has(r.id)&&!familiarPrimary.has(r.id)})).sort((a,b)=>Number(a.primary)-Number(b.primary)||a.text.localeCompare(b.text,'ru',{numeric:true}));
 const names=free.map(x=>x.text);return {text:names.length?names.slice(0,4).join(', ')+(names.length>4?' +'+(names.length-4):''):'—',title:names.join(', ')||'Свободных кабинетов нет',names};
}
renderSchedule=function(){
 mode='week';compact=true;grade='all';classFilter='';
 const week=studioPeriod==='base'?SM.anchor(db):monday(date);
 const weekDates=Array.from({length:5},(_,i)=>E.addDays(week,i));studioDates=studioAxis==='teachers'&&studioTeacherSpan==='day'?[studioPeriod==='weeks'?date:weekDates[Math.max(0,Math.min(4,studioTeacherDay-1))]]:weekDates;
 studioWork=studioContext();
 const periodRows=(studioPeriod==='base'?E.effective(studioWork):E.effectiveBetween(studioWork,studioDates[0],studioDates.at(-1))).filter(l=>studioDates.includes(l.date));
 const carried=studioPeriod==='weeks'?[...new Map(E.effective(db).filter(l=>l.parkingArea==='side'&&!l.cancelled&&l.date<=studioDates.at(-1)).map(l=>[String(l.id).split('@')[0],l])).values()]:[];
 studioRows=[...new Map([...periodRows,...carried].map(l=>[l.id,l])).values()];
 studioWork={...studioWork,baseSchedule:null,lessons:studioRows,extraLessons:[],overrides:{}};
 const ids=new Set(selected().map(c=>c.id));
 const current=periodRows.filter(l=>!l.cancelled),visible=current.filter(l=>ids.has(l.classId));
 const side=[...new Map([...carried,...current.filter(l=>l.suspended)].map(l=>[l.id,l])).values()];
 const bottom=current.filter(l=>l.parked&&l.parkingArea!=='side');
 const rows=visible.filter(l=>!l.parked&&!l.suspended),roomRows=current.filter(l=>!l.parked&&!l.suspended);studioRoomRows=roomRows;
 const type=studioAxis==='general'?'classes':studioAxis,key=type==='classes'?'classId':type==='teachers'?'teacherId':'roomId';
 studioEntities=type==='classes'?selected():db[type].filter(e=>visible.some(l=>l[key]===e.id));
 studioSlots=Math.max(8,...visible.map(l=>l.slot));
 const index=new Map();for(const l of rows){const k=[l[key],l.date,l.slot].join('|');if(!index.has(k))index.set(k,[]);index.get(k).push(l)}
 $('#heading-actions').innerHTML='';
 if(typeof studioCanReuseView!=='function'||!studioCanReuseView()) $('#controls').innerHTML=`<div class="studio-toolbar"><div class="segmented"><button data-period="base" class="${studioPeriod==='base'?'active':''}">Основное расписание</button><button data-period="weeks" class="${studioPeriod==='weeks'?'active':''}">По неделям</button></div>${studioPeriod==='weeks'?dateBar()+'<button id="studio-today">Сегодня</button>':''}<div class="segmented">${[['classes','Классы'],['teachers','Учителя'],['rooms','Кабинеты'],['general','Общее']].map(([k,n])=>`<button data-studio-axis="${k}" class="${studioAxis===k?'active':''}">${n}</button>`).join('')}</div>${studioAxis==='teachers'?`<div class="segmented"><button data-teacher-span="week" class="${studioTeacherSpan==='week'?'active':''}">Неделя</button><button data-teacher-span="day" class="${studioTeacherSpan==='day'?'active':''}">День</button></div>${studioPeriod==='base'&&studioTeacherSpan==='day'?`<select id="studio-teacher-day" aria-label="День недели">${[1,2,3,4,5].map(d=>`<option value="${d}" ${studioTeacherDay===d?'selected':''}>${days[d]}</option>`).join('')}</select>`:''}`:''}<button id="class-choice">Выбор классов</button><button id="display-settings">Вид карточки</button><span class="spacer"></span><button id="studio-calculate">${studioPeriod==='base'?'Рассчитать основу':'Пересчитать день'}</button><button id="studio-absence">Отсутствие</button><button id="studio-print">Печать</button><button id="studio-undo" title="Отменить" aria-label="Отменить" ${db.history.length?'':'disabled'}>↶</button><button id="studio-redo" title="Повторить" aria-label="Повторить" ${studioRedo.length?'':'disabled'}>↷</button></div>`;
 const problems=E.conflicts(studioWork,rows),problemIds=new Set(problems.flatMap(x=>x.lessonIds));
 const paint={index,problemIds,problems,key,side,bottom,rows,roomRows};if(typeof studioUpdateExisting==='function'&&studioUpdateExisting(paint))return;
 const freeFooter=['teachers','rooms'].includes(studioAxis)?`<tfoot><tr><th title="Свободные кабинеты">Своб.</th>${studioDates.map(d=>Array.from({length:studioSlots},(_,i)=>{const free=studioFreeRooms(roomRows,d,i+1);return `<td title="${h(free.title)}">${h(free.text)}</td>`}).join('')).join('')}</tr></tfoot>`:'';
 const rangeLabel=studioDates.length===1?fmt(studioDates[0]):fmt(studioDates[0])+' — '+fmt(studioDates.at(-1));
 $('#view').innerHTML=`<div class="studio-meta"><span>${studioPeriod==='base'?'Основа · изменения повторяются по неделям':rangeLabel+' · исключения выбранного периода'} · ${studioEntities.length} строк</span></div><div id="studio-workspace"><div class="studio-grid"><table class="studio-matrix"><colgroup><col class="entity-col">${studioDates.map(()=>Array.from({length:studioSlots},()=>'<col>').join('')).join('')}</colgroup><thead><tr><th rowspan="2">${type==='classes'?'Класс':type==='teachers'?'Учитель':'Кабинет'}</th>${studioDates.map(d=>`<th colspan="${studioSlots}">${days[SM.day(d)]}${studioPeriod==='weeks'?` <small>${fmt(d)}</small>`:''}</th>`).join('')}</tr><tr>${studioDates.map(d=>Array.from({length:studioSlots},(_,i)=>`<th data-col-head="${d}|${i+1}">${i+1}</th>`).join('')).join('')}</tr></thead><tbody>${studioEntities.map(e=>`<tr style="--row-factor:${studioRowFactor(e,type)}"><th data-row-head="${e.id}" title="${h(e.name)}">${h(type==='teachers'?studioTeacher(e.id):type==='rooms'?PrintTools.roomNumber(e.name):e.name)}</th>${studioDates.map(d=>Array.from({length:studioSlots},(_,i)=>{const visual=studioVisualCell(index.get([e.id,d,i+1].join('|'))||[],e.id,problemIds);return `<td data-entity="${e.id}" data-date="${d}" data-slot="${i+1}" tabindex="0" aria-label="${h(e.name)} ${days[SM.day(d)]} урок ${i+1}" class="${i===0?'day-start':''}"><div class="studio-stack" style="--parts:${visual.parts}">${visual.html}</div></td>`}).join('')).join('')}</tr>`).join('')}</tbody>${freeFooter}</table></div><div id="studio-v-split" role="separator" aria-label="Ширина правой области" aria-orientation="vertical" tabindex="0"></div><aside id="studio-side" class="studio-tray" data-park="side">${studioTray('side',side)}</aside><div id="studio-h-split" role="separator" aria-label="Высота нижней области" aria-orientation="horizontal" tabindex="0"></div><section id="studio-bottom" class="studio-tray" data-park="bottom">${studioTray('bottom',bottom)}</section></div><div id="studio-hint" role="status">Клик — взять · следующий клик — разместить · Esc — отменить · правая кнопка — изменить кабинет</div>`;
 $$('[data-period]').forEach(b=>b.onclick=()=>{studioCancel();const next=b.dataset.period;if(next==='weeks'&&studioPeriod!=='weeks')date=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow'}).format(new Date());studioPeriod=next;render()});
 $$('[data-studio-axis]').forEach(b=>b.onclick=()=>{studioCancel();studioAxis=b.dataset.studioAxis;render()});
 $$('[data-teacher-span]').forEach(b=>b.onclick=()=>{studioCancel();studioTeacherSpan=b.dataset.teacherSpan;render()});$('#studio-teacher-day')?.addEventListener('change',e=>{studioTeacherDay=+e.target.value;render()});
 if(studioPeriod==='weeks'){bindDateBar(studioAxis==='teachers'&&studioTeacherSpan==='day'?1:7);$('#studio-today').onclick=()=>{date=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow'}).format(new Date());render()}}
 $('#class-choice').onclick=showClassChoice;$('#display-settings').onclick=showSettings;
 $('#studio-absence').onclick=()=>{if(studioPeriod==='base'){studioPeriod='weeks';date=SM.anchor(db);render()}showAbsence()};
 $('#studio-print').onclick=()=>showPrint();$('#studio-calculate').onclick=()=>studioPeriod==='base'?showBaseGenerator():showRebuild();
 $('#studio-undo').onclick=undo;$('#studio-redo').onclick=redo;studioBindTrayFilters();
 if(typeof studioRememberCells==='function')studioRememberCells(paint);bindCards();studioBindFreeRooms();studioBindSplit();studioResizeObserver?.disconnect();studioResizeObserver=new ResizeObserver(studioFit);studioResizeObserver.observe($('.studio-grid'));studioFit();
};
function studioBindFreeRooms(){
 const cells=$$('.studio-matrix tfoot td');if(!cells.length)return;
 const mark=(d,slot)=>{cells.forEach(x=>x.classList.remove('free-focus'));const i=studioDates.indexOf(d)*studioSlots+(+slot-1);if(cells[i])cells[i].classList.add('free-focus')};
 $$('[data-col-head]').forEach(x=>x.onpointerenter=()=>{const [d,slot]=x.dataset.colHead.split('|');mark(d,slot)});
 $$('[data-entity]').forEach(x=>x.addEventListener('pointerenter',()=>mark(x.dataset.date,x.dataset.slot)));
}
bindCards=function(){
 if(route!=='schedule'){ // Existing replacement desk uses selection, not pickup.
  $$('[data-lesson]').forEach(b=>{b.onclick=()=>{selectedLesson=b.dataset.lesson;renderInspector()};b.oncontextmenu=e=>{e.preventDefault();showLesson(b.dataset.lesson)}});return;
 }
 $$('[data-lesson]').forEach(b=>{
  b.draggable=false;
  b.onclick=e=>{if(e.target.closest('[data-room-chip]'))return;if(studioPick){e.stopPropagation();const td=b.closest('td');if(td){studioPlace(td,b.dataset.lesson);return}if(b.dataset.lesson===studioPick.id)studioCancel();else studioPark(b.closest('[data-park]').dataset.park);return}e.stopPropagation();if(e.detail>0)studioPointer={x:e.clientX,y:e.clientY};else{const r=b.getBoundingClientRect();studioPointer={x:r.left+r.width/2,y:r.top+r.height/2}}studioTake(b.dataset.lesson)};
  b.oncontextmenu=e=>{e.preventDefault();studioCancel();if(['teachers','rooms'].includes(studioAxis))studioRoomEditor(b.dataset.lesson);else showLesson(b.dataset.lesson)};
  b.querySelector('[data-room-chip]')?.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();studioCancel();studioRoomMenu(e.currentTarget,b.dataset.lesson)});
 });
 $$('[data-entity]').forEach(td=>{
  td.onclick=()=>{if(studioPick)studioPlace(td)};
  td.onpointerenter=()=>studioHover(td);
  td.oncontextmenu=e=>{e.preventDefault();studioCancel();const l=td.querySelector('[data-lesson]');if(l)showLesson(l.dataset.lesson);else if(['classes','general'].includes(studioAxis))showLesson(null,{classId:td.dataset.entity,date:td.dataset.date,slot:+td.dataset.slot})};
  td.onkeydown=e=>{if(e.target===td&&(e.key==='Enter'||e.key===' ')){e.preventDefault();if(studioPick)studioPlace(td);else {const b=td.querySelector('[data-lesson]');if(b){const r=b.getBoundingClientRect();studioPointer={x:r.left+r.width/2,y:r.top+r.height/2};studioTake(b.dataset.lesson)}}}};
 });
 $$('[data-park]').forEach(t=>t.onclick=e=>{if(!e.target.closest('select,button')&&studioPick)studioPark(t.dataset.park)});
};
function studioBindTrayFilters(){
 $$('[data-tray-filter]').forEach(button=>button.onclick=e=>{e.stopPropagation();const area=button.dataset.trayFilter,mode=button.dataset.filterMode;if(mode==='all'){studioFilters[area]={mode:'all',value:''};render();return}studioOpenTrayMenu(button,area,mode)});
}
function studioOpenTrayMenu(anchor,area,mode){
 document.querySelector('#studio-filter-menu')?.remove();const source=mode==='class'?db.classes:mode==='teacher'?db.teachers:db.subjects,current=studioFilter(area);
 const title=mode==='class'?'Выберите класс':mode==='teacher'?'Выберите учителя':'Выберите предмет';
 const rows=source.map(x=>({x,text:mode==='teacher'?studioTeacher(x.id):mode==='subject'?studioSubject({subjectId:x.id}):x.name})).sort((a,b)=>a.text.localeCompare(b.text,'ru',{numeric:true,sensitivity:'base'}));
 // Fill down the columns and add as many columns as the viewport needs.  The
 // menu never becomes a second scrolling area: every option remains visible.
 const stride=29,chrome=44,maxRows=Math.max(1,Math.floor((innerHeight-12-chrome)/stride)),columns=Math.max(1,Math.ceil(rows.length/maxRows)),menuRows=Math.max(1,Math.ceil(rows.length/columns)),ideal=mode==='teacher'?190:mode==='subject'?170:105;
 const menu=document.createElement('div');menu.id='studio-filter-menu';menu.dataset.filterMode=mode;menu.setAttribute('role','menu');menu.setAttribute('aria-label',title);menu.style.setProperty('--filter-columns',columns);menu.style.setProperty('--filter-rows',menuRows);menu.style.width=Math.min(innerWidth-12,Math.max(180,columns*ideal+14))+'px';menu.innerHTML=`<strong>${title}</strong><div>${rows.map(({x,text})=>`<button type="button" role="menuitem" data-filter-value="${h(x.id)}" title="${h(text)}" class="${current.mode===mode&&current.value===x.id?'active':''}">${h(text)}</button>`).join('')}</div>`;
 document.body.append(menu);const r=anchor.getBoundingClientRect(),box=menu.getBoundingClientRect();menu.style.left=Math.max(6,Math.min(r.left,innerWidth-box.width-6))+'px';menu.style.top=Math.max(6,Math.min(r.bottom+3,innerHeight-box.height-6))+'px';
 const dispose=()=>{menu.remove();document.removeEventListener('pointerdown',close,true);document.removeEventListener('keydown',escape,true)},close=e=>{if(!menu.contains(e.target)&&e.target!==anchor)dispose()},escape=e=>{if(e.key==='Escape')dispose()};
 menu.querySelectorAll('[data-filter-value]').forEach(b=>b.onclick=()=>{studioFilters[area]={mode,value:b.dataset.filterValue};dispose();render()});menu.querySelector('button')?.focus();
 setTimeout(()=>{document.addEventListener('pointerdown',close,true);document.addEventListener('keydown',escape,true)});
}
function studioRoomEditor(id){
 const old=studioRows.find(l=>l.id===id);if(!old)return;
 const rooms=studioRoomChoices(old);
 dialog('Кабинет · '+studioBrief(old),`<label class="field">Назначение кабинета<select id="studio-quick-room"><option value="__auto" ${old.roomMode!=='manual'?'selected':''}>Подобрать автоматически</option><option value="__none" ${old.roomMode==='manual'&&!old.roomId?'selected':''}>Нет</option>${rooms.map(({room,free})=>`<option value="${h(room.id)}" ${old.roomId===room.id&&old.roomMode==='manual'?'selected':''}>${h(PrintTools.roomNumber(room.name)||room.name)} · ${free?'свободен':'занят'}</option>`).join('')}</select></label><p class="hint"><span class="room-free-key">Свободные кабинеты отмечены зелёным</span>. «Нет» сохраняет урок без кабинета; автоподбор использует правила учителя.</p>`,[{text:'Отмена',action:()=>$('#dialog').close()},{text:'Полное редактирование',action:()=>showLesson(id)},{text:'Сохранить кабинет',class:'primary',action:()=>{const value=$('#studio-quick-room').value,automatic=value==='__auto',roomId=automatic||value==='__none'?null:value;studioApply('Изменение кабинета',[{id:old.id,before:old,after:{...old,roomId,roomMode:automatic?'auto':'manual'}}])}}]);
}
function studioRoomChoices(old){
 const rooms=[...db.rooms].sort((a,b)=>(PrintTools.roomNumber(a.name)||a.name).localeCompare(PrintTools.roomNumber(b.name)||b.name,'ru',{numeric:true,sensitivity:'base'}));
 const occupied=new Set(studioRows.filter(x=>x.id!==old.id&&!x.cancelled&&!x.parked&&!x.suspended&&E.overlap(old,x)&&x.roomId).map(x=>x.roomId));
 return rooms.map(room=>({room,free:!occupied.has(room.id)}));
}
function studioRoomMenu(anchor,id){
 document.querySelector('#studio-room-menu')?.remove();const old=studioRows.find(l=>l.id===id);if(!old)return;const menu=document.createElement('div');menu.id='studio-room-menu';menu.innerHTML=`<strong>${h(studioSubject(old))} · ${h(lookup('classes',old.classId)?.name)}</strong><div class="studio-room-options"><button type="button" data-room-value="__auto" class="${old.roomMode!=='manual'?'active':''}">Автоподбор</button><button type="button" data-room-value="__none" class="${old.roomMode==='manual'&&!old.roomId?'active':''}">Нет</button>${studioRoomChoices(old).map(({room,free})=>`<button type="button" data-room-value="${h(room.id)}" class="${old.roomId===room.id?'active ':''}${free?'room-free':'room-busy'}" title="${free?'Свободен':'Занят в это время'}">${h(PrintTools.roomNumber(room.name)||room.name)}</button>`).join('')}</div><button type="button" data-room-cancel>Отменить</button>`;document.body.append(menu);
 const rect=anchor.getBoundingClientRect(),box=menu.getBoundingClientRect();menu.style.left=Math.max(6,Math.min(rect.left,innerWidth-box.width-6))+'px';menu.style.top=Math.max(6,Math.min(rect.bottom+3,innerHeight-box.height-6))+'px';menu.querySelectorAll('[data-room-value]').forEach(b=>b.onclick=()=>{const value=b.dataset.roomValue,automatic=value==='__auto',roomId=automatic||value==='__none'?null:value;menu.remove();studioApply('Изменение кабинета',[{id:old.id,before:old,after:{...old,roomId,roomMode:automatic?'auto':'manual'}}])});menu.querySelector('[data-room-cancel]').onclick=()=>menu.remove();menu.querySelector('[data-room-value]')?.focus();
}
function studioFit(){
 const workspace=$('#studio-workspace');if(!workspace)return;
 workspace.style.setProperty('--side-width',studioSide+'px');workspace.style.setProperty('--bottom-height',studioBottom+'px');
 const grid=$('.studio-grid'),n=Math.max(1,studioEntities.length),rowType=studioAxis==='general'?'classes':studioAxis,weight=studioEntities.reduce((sum,e)=>sum+studioRowFactor(e,rowType),0)||1,footer=['teachers','rooms'].includes(studioAxis)?30:0,rowHeight=Math.max(1,(grid.clientHeight-38-footer-n)/weight);
 workspace.style.setProperty('--row-height',rowHeight+'px');workspace.style.setProperty('--footer-height',footer+'px');
 workspace.style.setProperty('--row-tracks',studioEntities.map(e=>`minmax(0,${studioRowFactor(e,rowType)}fr)`).join(' '));
 $$('.studio-matrix tbody tr').forEach((tr,i)=>tr.style.setProperty('--entity-row-height',rowHeight*studioRowFactor(studioEntities[i],rowType)+'px'));
 const entityWidth=studioAxis==='teachers'?110:44,columns=studioSlots*Math.max(1,studioDates.length),available=Math.max(1,(grid.clientWidth-entityWidth)/columns),colWidth=studioDates.length===1?Math.min(78,available):available;
 workspace.style.setProperty('--matrix-width',studioDates.length===1?(entityWidth+columns*colWidth)+'px':'100%');workspace.style.setProperty('--column-track',colWidth+'px');
 workspace.style.setProperty('--card-width',colWidth+'px');workspace.style.setProperty('--card-height',Math.max(7,Math.min(24,rowHeight))+'px');
 workspace.style.setProperty('--card-font',Math.max(6,Math.min(12,colWidth/3.2,rowHeight*.65))+'px');
 $$('#studio-workspace .studio-card').forEach(c=>{
  const stack=c.closest('.studio-stack'),height=stack?stack.clientHeight/(stack.children.length||1):Math.min(24,rowHeight);
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
function showBaseGenerator(){
 const count=SM.template(db).filter(l=>l.parked&&!l.cancelled&&selected().some(c=>c.id===l.classId)).length;
 dialog('Расчёт основного расписания',`<p>В нижней области для выбранных классов: <strong>${count}</strong> неразмещённых карточек.</p><label class="field">Максимальный номер урока<input id="base-max-slot" type="number" min="4" max="12" value="8"></label><p class="hint">Будут рассчитаны три безопасных варианта. Учитываются занятость классов и учителей, рабочие дни, разрешённые уроки, подгруппы, спарки и правила кабинетов. Закреплённые и уже размещённые карточки сохраняются. Результат применяется только после выбора.</p>`,[{text:'Рассчитать варианты',class:'primary',action:()=>{
  const maxSlot=+$('#base-max-slot').value;if(!Number.isInteger(maxSlot)||maxSlot<4||maxSlot>12){message('Максимальный урок: от 4 до 12.');return}
  const labels={balanced:'Сбалансированный',compact:'Компактнее для классов',teachers:'Меньше окон учителей',emergency:'Аварийный: допустить спарку учителя'},results=['balanced','compact','teachers','emergency'].map(strategy=>E.generateBase(db,SM.template(db),{classIds:selected().map(c=>c.id),maxSlot,strategy}));
  $('#dialog').close();dialog('Варианты основного расписания',`<p>Выберите вариант. Все изменения можно отменить одной стрелкой «Назад».</p><div class="generator-variants">${results.map((r,i)=>`<label><input type="radio" name="base-variant" value="${i}" ${i===0?'checked':''}><strong>${labels[r.strategy]}</strong><span>${r.patches.length} размещено · ${r.unresolved.length} не размещено${r.strategy==='emergency'?' · конфликты будут отмечены':''}</span></label>`).join('')}</div><div class="table-wrap"><table class="data-table"><thead><tr><th>Класс</th><th>Предмет</th><th>Предложение</th></tr></thead><tbody>${results[0].patches.slice(0,80).map(p=>`<tr><td>${h(lookup('classes',p.after.classId)?.name)}</td><td>${h(studioSubject(p.after))}</td><td>${days[SM.day(p.after.date)]}, урок ${p.after.slot}</td></tr>`).join('')}</tbody></table></div><p class="hint">Аварийный вариант выбирайте только как крайний: он допускает одновременные карточки одного учителя, но не пересечения классов. В таблице показаны первые 80 назначений.</p>`,[{text:'Не применять',action:()=>$('#dialog').close()},{text:'Применить выбранный вариант',class:'primary',action:()=>{const r=results[+$('input[name="base-variant"]:checked').value];if(!r.patches.length){message('Для выбранного варианта нет применимых изменений.');return}studioApply('Расчёт основного расписания: '+labels[r.strategy],r.patches,r.strategy==='emergency')}}]);
 }}]);
}
showSettings=function(){
 const v=studioView();dialog('Вид карточки',`<p>Настройки применяются к экрану и печати. В режиме классов удобно оставить предмет и кабинет; в режиме учителей можно добавить предмет, класс и кабинет.</p><div class="form-grid">${[['subject','Предмет'],['className','Класс'],['teacher','Учитель: фамилия и инициалы'],['room','Номер кабинета'],['group','Подгруппа / профиль'],['abbreviate','Сокращения предметов']].map(([k,n])=>`<label class="checkbox-line"><input type="checkbox" data-studio-field="${k}" ${v[k]?'checked':''}>${n}</label>`).join('')}</div>`,[{text:'Отмена',action:()=>$('#dialog').close()},{text:'Применить',class:'primary',action:()=>{settings.studioDisplay=Object.fromEntries($$('[data-studio-field]').map(e=>[e.dataset.studioField,e.checked]));settings.printLayout={...settings.printLayout,subject:$('#dialog [data-studio-field="subject"]').checked,className:$('#dialog [data-studio-field="className"]').checked,room:$('#dialog [data-studio-field="room"]').checked,teacher:$('#dialog [data-studio-field="teacher"]').checked,group:$('#dialog [data-studio-field="group"]').checked,abbreviate:$('#dialog [data-studio-field="abbreviate"]').checked};$('#dialog').close();dirty=true;render()}}]);
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
let studioPointerFrame=0;
document.addEventListener('pointermove',e=>{studioPointer={x:e.clientX,y:e.clientY};if(studioGhost&&!studioPointerFrame)studioPointerFrame=requestAnimationFrame(()=>{studioPointerFrame=0;studioPositionGhost()})});
document.addEventListener('keydown',e=>{if(e.key==='Escape')studioCancel()});
$('#dialog').addEventListener('close',()=>{$('#dialog').style.margin='';$('#dialog').style.left='';$('#dialog').style.top=''});
const studioBootRender=render;
render=function(){if(db?.preferences?.studioLayout){studioSide=db.preferences.studioLayout.side;studioBottom=db.preferences.studioLayout.bottom}if(route!=='schedule')studioCancel();studioBootRender()};
