/* Ordered preferences use room IDs internally; human editing uses room numbers only. */
showTeacherRooms=function(){
 const p=settings.roomPolicy||{enabled:true,teacherRooms:{},pool:[]};
 const numbers=ids=>(ids||[]).map(id=>RoomAllocator.number(roomName(id))).filter(Boolean).join(', ');
 const rule=id=>p.teacherRules?.[id]||{mode:'preferred',rooms:p.teacherRooms?.[id]?[p.teacherRooms[id]]:[]};
 const fields=(id,r)=>`<select data-rule-mode="${h(id)}" aria-label="Правило кабинета"><option value="preferred" ${r.mode!=='fixed'?'selected':''}>Предпочтения</option><option value="fixed" ${r.mode==='fixed'?'selected':''}>Жёсткое закрепление</option></select><input class="room-order" data-rule-order="${h(id)}" value="${h(numbers(r.rooms))}" placeholder="Например: 10, 12, 14" aria-label="Кабинеты по приоритету">`;
 dialog('Кабинеты: учителя и классы',`<label class="checkbox-line"><input type="checkbox" id="rooms-enabled" ${p.enabled?'checked':''}>Подбирать кабинеты автоматически</label>
 <p class="hint"><strong>Жёсткое закрепление:</strong> ровно один кабинет, без замены при занятости; пересечение отмечается. <strong>Предпочтения:</strong> номера через запятую, от наиболее желательного. Сначала предпочтения учителя, затем класса, затем любой свободный из разрешённых. Ручной выбор для отдельного урока важнее всех этих правил.</p>
 <div class="room-directory"><table class="data-table"><thead><tr><th>Учитель</th><th>Правило и порядок кабинетов</th></tr></thead><tbody>${db.teachers.map(t=>`<tr><td>${h(short(t.name))}</td><td>${fields(t.id,rule(t.id))}</td></tr>`).join('')}</tbody></table></div>
 <h3>Предпочтения классов</h3><div class="room-directory"><table class="data-table"><thead><tr><th>Класс</th><th>Кабинеты по убыванию приоритета</th></tr></thead><tbody>${db.classes.map(c=>`<tr><td>${h(c.name)}</td><td><input class="room-order" data-class-rooms="${c.id}" value="${h(numbers(p.classRooms?.[c.id]))}" placeholder="Например: 15, 18" aria-label="Кабинеты ${h(c.name)}"></td></tr>`).join('')}</tbody></table></div>
 <h3>Кабинеты для свободного подбора</h3><div class="room-pool">${db.rooms.map(r=>`<label class="checkbox-line"><input type="checkbox" data-pool-room="${h(r.id)}" ${(p.pool||[]).includes(r.id)?'checked':''}>${h(RoomAllocator.number(r.name)||r.name)}</label>`).join('')}</div>
 <p class="hint">Изменения действуют на всех датах для автоматических назначений. Время, предметы и учителя не меняются. Оснащение и вместимость не проверяются. Пустой список предпочтений означает свободный подбор.</p><p id="room-rule-error" class="error" role="alert"></p>`,
 [{text:'Отмена',action:()=>$('#dialog').close()},{text:'Сохранить правила',class:'primary',action:()=>{
  try{
   const parse=value=>{
    const parts=value.split(/[,;\s]+/).map(x=>x.trim()).filter(Boolean);
    return [...new Set(parts.map(n=>{const matches=db.rooms.filter(r=>RoomAllocator.number(r.name)===n);if(matches.length!==1)throw Error('Номер кабинета не найден или неоднозначен: '+n);return matches[0].id}))];
   };
   const teacherRules={},teacherRooms={},classRooms={};
   $$('[data-rule-order]').forEach(x=>{
    const id=x.dataset.ruleOrder,mode=$(`[data-rule-mode="${id}"]`).value,rooms=parse(x.value);
    if(mode==='fixed'&&rooms.length!==1)throw Error(short(teacherName(id))+': для жёсткого закрепления укажите ровно один кабинет');
    teacherRules[id]={mode,rooms};if(rooms[0])teacherRooms[id]=rooms[0];
   });
   $$('[data-class-rooms]').forEach(x=>classRooms[x.dataset.classRooms]=parse(x.value));
   settings.roomPolicy={...p,schema:1,enabled:$('#rooms-enabled').checked,teacherRules,teacherRooms,classRooms,pool:$$('[data-pool-room]:checked').map(x=>x.dataset.poolRoom)};
   $('#dialog').close();dirty=true;render();message('Правила кабинетов сохранены. Ручные назначения сохранены.');
  }catch(e){$('#room-rule-error').textContent=e.message}
 }}]);
};
