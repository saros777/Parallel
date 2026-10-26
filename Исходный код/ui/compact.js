/* Compact cards preserve each lesson record, selection and group-block dragging. */
const compactDefaults={subject:true,room:true,teacher:false,group:false,abbreviate:true};
function displaySubject(l,abbreviate=true){
 const s=lookup('subjects',l.subjectId);
 return (abbreviate?(settings.labels?.[l.subjectId]||compactNames.find(([re])=>re.test(s?.name||''))?.[1]||s?.abbreviation):null)||s?.name||'Неизвестный предмет';
}
function profileBadges(l){
 const profiles=E.classProfiles(l,db),audience=E.profileAudience(l,db);
 return profiles.length&&audience.length?`<span class="profile-badges" aria-label="${h(audience.map(x=>E.profileNames[x]).join(', '))}">${profiles.map(p=>`<span class="${audience.includes(p)?'active':''}">${E.profileShort[p]}</span>`).join('')}</span>`:'';
}
const spaciousCard=card;
card=function(l){
 if(!compact)return spaciousCard(l);
 const changed=!!db.overrides[l.id],abs=E.absenceFor(l,db);
 const title=[lookup('subjects',l.subjectId)?.name,teacherName(l.teacherId),l.roomId?roomName(l.roomId):'Кабинет не указан',l.groupName||'Весь класс',l.time].filter(Boolean).join(' · ');
 return `<button class="lesson compact-card ${changed?'changed':''} ${l.cancelled?'cancelled':''} ${selectedLesson===l.id?'selected':''}" style="--subject-color:${subjectColor(l.subjectId)}" draggable="${!l.locked&&!l.cancelled}" data-lesson="${h(l.id)}" data-testid="lesson-${h(l.id)}" title="${h(title)}" aria-label="${h(title)}">
 <span class="compact-line">${settings.subject?`<strong>${h(displaySubject(l,settings.abbreviate))}</strong>`:''}${settings.room?`<span class="compact-room" title="${h(l.roomId?roomName(l.roomId):'Кабинет не указан')}">${h(PrintTools.roomNumber(l.roomId?roomName(l.roomId):''))}</span>`:''}</span>
 ${settings.teacher?`<small>${h(short(teacherName(l.teacherId)))}</small>`:''}
 ${profileBadges(l)}${settings.group&&l.groupName?`<small class="compact-group">${h(PrintTools.groupLabel(l.groupName))}</small>`:''}
 ${l.cancelled?'<span class="compact-status">Отмена</span>':abs?'<span class="compact-status danger">Отсутствие</span>':changed?'<span class="compact-status">Изм.</span>':l.locked?'<span class="compact-status">Закр.</span>':''}</button>`;
};
const regularSchedule=renderSchedule;
renderSchedule=function(){
 const original=settings;
 try{
  if(compact)settings={...settings,...compactDefaults,...settings.compactDisplay};
  regularSchedule();
  const lessonMap=new Map(E.effective(db).map(l=>[l.id,l]));
  $$('.matrix tbody td').forEach(td=>{
   let cards=[...td.children].filter(x=>x.matches('[data-lesson]'));
   if(!cards.length)return;
   const stack=document.createElement('div');
   stack.className='slot-stack'+(cards.length>1?' divided-slot':'');
   stack.style.setProperty('--parts',cards.length);
   stack.setAttribute('aria-label',cards.length>1?cards.length+' занятий в слоте':'Урок');
   const lessons=cards.map(c=>lessonMap.get(c.dataset.lesson)),lines=E.profileLines(lessons,db,td.dataset.cellClass);
   if(lines.some(x=>x.profile)){
    stack.classList.add('profile-slot');stack.style.setProperty('--parts',E.classProfiles(lessons[0],db).length);
    for(const p of E.classProfiles(lessons[0],db)){
     const lane=document.createElement('div');lane.className='profile-lane';lane.dataset.profileTarget=p;
     lane.innerHTML=`<span class="profile-lane-label" title="${h(E.profileNames[p])}">${E.profileShort[p]}</span>`;
     const laneLines=lines.filter(x=>x.profile===p);
     for(const entry of laneLines){
      if(!entry.lesson){lane.insertAdjacentHTML('beforeend','<span class="profile-empty">—</span>');continue}
      const original=cards.find(c=>c.dataset.lesson===entry.lesson.id),copy=original.cloneNode(true);
      copy.dataset.profileOrigin=p;lane.append(copy);
     }
     stack.append(lane);
    }
    cards.forEach(c=>c.remove());
   }else cards.forEach(c=>stack.append(c));
   td.append(stack);
  });
  bindCards();
  if(typeof bindProfileDrops==='function')bindProfileDrops();
 }finally{settings=original}
};
const regularSettings=showSettings;
showSettings=function(){
 if(!compact){regularSettings();return}
 const view={...settings,...compactDefaults,...settings.compactDisplay};
 dialog('Компактные слоты',`<div class="form-grid">${[['subject','Предмет'],['room','Только номер кабинета'],['teacher','Учитель'],['group','Подгруппа / профиль'],['abbreviate','Сокращения предметов']].map(([k,v])=>`<label class="checkbox-line"><input type="checkbox" data-compact-field="${k}" ${view[k]?'checked':''}>${v}</label>`).join('')}<label class="checkbox-line"><input type="checkbox" id="compact-cancelled" ${settings.showCancelled?'checked':''}>Показывать отмененные</label></div><p class="hint">Каждое занятие подгруппы занимает отдельную строку внутри общего слота. Полные сведения доступны по клику. Настройки печати независимы.</p>`,[{text:'Предмет + кабинет',action:()=>{$$('[data-compact-field]').forEach(x=>x.checked=!!compactDefaults[x.dataset.compactField])}},{text:'Применить',class:'primary',action:()=>{
  settings.compactDisplay=Object.fromEntries($$('[data-compact-field]').map(x=>[x.dataset.compactField,x.checked]));
  settings.showCancelled=$('#compact-cancelled').checked;dirty=true;$('#dialog').close();render();
 }}]);
};
