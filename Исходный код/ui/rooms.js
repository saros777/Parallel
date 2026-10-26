/* Teacher-room directory and scheduling editor integration. */
function initializeRooms(){
 if(!db||loading)return;
 RoomAllocator.install(db,settings);
 db.preferences=settings;
}
const beforeRoomRender=render;
render=function(){initializeRooms();beforeRoomRender();
 if(connected&&['schedule','directory'].includes(route)){
  $('#heading-actions').insertAdjacentHTML('beforeend','<button id="teacher-rooms">Кабинеты учителей</button>');
  $('#teacher-rooms').onclick=showTeacherRooms;
 }
 if(route==='schedule'&&mode==='day'){
  $$('.compact-room').forEach(el=>{
   const id=el.closest('[data-lesson]').dataset.lesson;
   el.classList.add('editable-room');el.setAttribute('role','button');el.tabIndex=0;
   el.title='Изменить кабинет этого урока';el.setAttribute('aria-label','Изменить кабинет '+el.textContent);
   const open=e=>{e.preventDefault();e.stopPropagation();showDayRoom(id)};
   el.onclick=open;el.ondblclick=e=>e.stopPropagation();el.onkeydown=e=>{if(e.key==='Enter'||e.key===' ')open(e)};
  });
  $('#heading-actions').insertAdjacentHTML('beforeend','<button id="day-room-edit">Изменить кабинет</button>');
  $('#day-room-edit').onclick=()=>selectedLesson?showDayRoom(selectedLesson):message('Нажмите номер кабинета в ячейке или сначала выберите урок.');
 }
};
function showDayRoom(id){
 const old=E.effective(db).find(l=>l.id===id);if(!old)return;
 dialog('Кабинет · '+lookup('classes',old.classId)?.name,`<p>${h(subjectName(old))} · ${fmt(old.date)} · урок ${old.slot}<br>${h(teacherName(old.teacherId))}${old.groupName?'<br>'+h(old.groupName):''}</p>
 <label class="checkbox-line"><input id="day-room-auto" type="checkbox" ${old.roomMode==='auto'?'checked':''}>Автоматически по учителю</label>
 <label class="field">Кабинет<select id="day-room-select">${roomOptions(old.roomId,'Не указан')}</select></label>
 <p id="day-room-note" class="hint" role="status"></p>`,[{text:'Отмена',action:()=>$('#dialog').close()},{text:'Сохранить кабинет',class:'primary',action:()=>{
  const after={...old,roomId:$('#day-room-select').value||null,roomMode:$('#day-room-auto').checked?'auto':'manual'};
  saveRoomChange(old,after);
 }}]);
 const update=()=>{
  const automatic=$('#day-room-auto').checked;
  if(automatic){
   const next=E.resolvePatches(db,[{id:old.id,before:old,after:{...old,roomMode:'auto'}}])[0].after;
   $('#day-room-select').value=next.roomId||'';$('#day-room-note').textContent=next.roomReason||'Автоматический подбор';
  }else $('#day-room-note').textContent='Ручное назначение действует только на этот урок и дату. Его можно отменить через историю.';
  const busy=new Set(E.effective(db).filter(l=>l.id!==old.id&&!l.cancelled&&E.overlap(old,l)).map(l=>l.roomId));
  [...$('#day-room-select').options].forEach(o=>{if(o.value)o.textContent=(RoomAllocator.number(roomName(o.value))||roomName(o.value))+(busy.has(o.value)?' · занят':' · свободен')});
 };
 $('#day-room-auto').onchange=update;
 $('#day-room-select').onchange=()=>{$('#day-room-auto').checked=false;update()};
 update();
}
function saveRoomChange(old,after){
 // Save room fields only: forcing a room must never bypass teacher/time validation.
 const requested={...old,roomId:after.roomId||null,roomMode:after.roomMode||'manual'};
 const patch={id:old.id,before:old,after:requested};
 const next=E.resolvePatches(db,[patch])[0].after;
 const warnings=E.changeIssues(next,db,E.effective(E.patchedDB(db,[patch])));
 const commit=forced=>{
  $('#dialog').close();
  transact((forced?'Принудительно: ':'')+'кабинет урока '+lookup('classes',old.classId)?.name,()=>{
   db.overrides[old.id]={...db.overrides[old.id],roomId:next.roomId,roomMode:next.roomMode,roomForced:!!forced};
  });
 };
 if(!warnings.length){commit(false);return}
 dialog('Сохранить кабинет с предупреждением?',`<p>${h(lookup('classes',old.classId)?.name)} · ${fmt(old.date)} · урок ${old.slot}<br>Кабинет: <strong>${h(next.roomId?RoomAllocator.number(roomName(next.roomId)):'не указан')}</strong></p>
 <ul>${warnings.map(x=>`<li>${h(x)}</li>`).join('')}</ul>
 <p>Можно принудительно сохранить кабинет. Учитель, предмет, дата и время не изменятся. Предупреждения останутся в контроле расписания; ручной кабинет не будет заменён автоматическим подбором.</p>`,
 [{text:'Назад к кабинету',action:()=>showDayRoom(old.id)},{text:'Всё равно сохранить кабинет',class:'primary',action:()=>commit(true)}]);
}
function roomOptions(current,empty){
 const rooms=[...db.rooms].sort((a,b)=>RoomAllocator.number(a.name).localeCompare(RoomAllocator.number(b.name),'ru',{numeric:true}));
 return options(rooms.map(r=>({...r,name:RoomAllocator.number(r.name)||r.name})),current,empty);
}
function showTeacherRooms(){
 const policy=settings.roomPolicy||{enabled:false,teacherRooms:{},pool:[]};
 dialog('Кабинеты учителей',`<p>Закрепления из вашего списка с уточнениями: Барышникова Е.А. — 10, Голованев В.А. — 2. У Валуйских и Колядиной закрепление снято; свободный кабинет подбирается автоматически.</p>
 <label class="checkbox-line"><input type="checkbox" id="rooms-enabled" ${policy.enabled?'checked':''}>Подбирать кабинеты автоматически</label>
 <p class="hint">Сначала закреплённый кабинет, если свободен. Иначе — любой свободный из списка ниже. Проверяется пересечение реального времени занятий, в том числе подгрупп. Вручную выбранные кабинеты сохраняются. Оснащение и вместимость пока не проверяются.</p>
 <div class="room-directory"><table class="data-table"><thead><tr><th>Учитель</th><th>Закреплённый кабинет</th></tr></thead><tbody>${db.teachers.map(t=>`<tr><td>${h(t.name)}</td><td><select data-home-room="${h(t.id)}" aria-label="Кабинет: ${h(t.name)}">${roomOptions(policy.teacherRooms[t.id],'Любой свободный')}</select></td></tr>`).join('')}</tbody></table></div>
 <h3>Кабинеты для свободного подбора</h3><div class="room-pool">${db.rooms.map(r=>`<label class="checkbox-line"><input type="checkbox" data-pool-room="${h(r.id)}" ${policy.pool.includes(r.id)?'checked':''}>${h(RoomAllocator.number(r.name)||r.name)}</label>`).join('')}</div>
 <p class="hint">Изменение закреплений пересчитает автоматические кабинеты на всех датах. Учителя, предметы и время уроков не меняются. При нехватке кабинетов появится замечание в «Контроле расписания».</p>`,
 [{text:'Отмена',action:()=>$('#dialog').close()},{text:'Сохранить закрепления',class:'primary',action:()=>{
  const teacherRooms={};$$('[data-home-room]').forEach(x=>{if(x.value)teacherRooms[x.dataset.homeRoom]=x.value});
  settings.roomPolicy={...policy,schema:1,enabled:$('#rooms-enabled').checked,teacherRooms,pool:$$('[data-pool-room]:checked').map(x=>x.dataset.poolRoom)};
  $('#dialog').close();render();message('Закрепления сохранены. Автоматические кабинеты пересчитаны; ручные назначения оставлены.');
 }}]);
}
function attachRoomEditor(old){
 let automatic=old.roomMode!=='manual'&&settings.roomPolicy?.enabled;
 $('#edit-room').closest('label').insertAdjacentHTML('afterend','<label class="checkbox-line"><input id="edit-room-auto" type="checkbox">Кабинет автоматически по учителю</label><p id="room-explanation" class="hint full" role="status"></p>');
 $('#edit-room-auto').checked=!!automatic;
 function update(){
  const temp={...old,teacherId:$('#edit-teacher').value||null,subjectId:$('#edit-subject').value,date:$('#edit-date').value,slot:+$('#edit-slot').value,time:$('#edit-start').value+' - '+$('#edit-end').value,roomMode:automatic?'auto':'manual',roomId:$('#edit-room').value||null};
  const next=E.resolvePatches(db,[{id:old.id,before:old,after:temp}])[0].after;
  if(automatic)$('#edit-room').value=next.roomId||'';
  const others=E.effective(E.patchedDB(db,[{id:old.id,before:old,after:temp}])).filter(x=>x.id!==old.id&&!x.cancelled&&E.overlap(temp,x));
  [...$('#edit-room').options].forEach(o=>{
   if(!o.value){o.textContent='Не указан';return}
   const r=lookup('rooms',o.value),busy=others.some(x=>x.roomId===o.value);
   o.textContent=(RoomAllocator.number(r?.name)||r?.name)+(busy?' · занят':' · свободен');
  });
  $('#room-explanation').textContent=automatic?(next.roomReason||'Автоматический подбор')+'. Можно выбрать кабинет вручную.':'Кабинет выбран вручную. Занятость будет проверена перед сохранением.';
 }
 $('#edit-room-auto').onchange=e=>{automatic=e.target.checked;update()};
 $('#edit-room').onchange=()=>{automatic=false;$('#edit-room-auto').checked=false;update()};
 $('#edit-teacher').addEventListener('change',()=>{automatic=!!settings.roomPolicy?.enabled;$('#edit-room-auto').checked=automatic;update()});
 ['#edit-date','#edit-slot','#edit-start','#edit-end'].forEach(s=>$(s).addEventListener('change',update));
 update();
}
