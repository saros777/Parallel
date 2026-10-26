/* Explicit profile audiences for 10а and 11, with stable top-to-bottom ordering. */
function profilePatch(old,audience){
 const profiles=E.classProfiles(old,db);
 const groupName=audience.length===profiles.length?null:audience.map(x=>E.profileNames[x]).join(' + ');
 const exact=db.courses.find(c=>c.classId===old.classId&&c.subjectId===old.subjectId&&JSON.stringify(E.profileAudience({...old,groupName:c.groupName,profileAudience:null},db))===JSON.stringify(audience));
 return {id:old.id,before:old,after:{...old,profileAudience:audience,profileManual:true,groupName,courseId:exact?.id||null}};
}
function confirmProfilePatches(patches,title='Изменить профили урока'){
 const problems=E.newIssues(db,patches);
 dialog(title,`<p>Изменится только состав профилей на эту дату. Учителя, предметы и время останутся прежними.</p><ul>${patches.map(p=>`<li>${h(subjectName(p.before))}: ${h((E.profileAudience(p.before,db).length?E.profileAudience(p.before,db):E.classProfiles(p.before,db)).map(x=>E.profileShort[x]).join('+'))} → <strong>${h(p.after.profileAudience.map(x=>E.profileShort[x]).join('+'))}</strong></li>`).join('')}</ul>${problems.length?`<p class="error">Предупреждение: ${h([...new Set(problems.map(x=>x.kind))].join('; '))}. Можно сохранить принудительно; замечания останутся в контроле.</p>`:'<p class="hint">Новых пересечений не обнаружено.</p>'}`,
 [{text:'Не применять',action:()=>$('#dialog').close()},{text:problems.length?'Сохранить с пересечениями':'Применить профили',class:'primary',action:()=>{
  $('#dialog').close();transact(title,()=>patches.forEach(p=>{db.overrides[p.id]={...db.overrides[p.id],profileAudience:p.after.profileAudience,profileManual:true,groupName:p.after.groupName,courseId:p.after.courseId}}));
 }}]);
}
function showProfiles(id,proposed){
 const old=E.effective(db).find(l=>l.id===id);if(!old)return;
 const profiles=E.classProfiles(old,db);
 if(!profiles.length){message('Профили доступны для 10а и 11 класса.');return}
 const inferred=proposed||E.profileAudience(old,db),selected=new Set(inferred.length?inferred:profiles);
 dialog('Профили урока · '+lookup('classes',old.classId)?.name,`<p>${h(lookup('subjects',old.subjectId)?.name)} · ${fmt(old.date)} · урок ${old.slot}</p>
 <div class="profile-editor">${profiles.map((p,i)=>`<label><span>${i+1}</span><input type="checkbox" data-profile="${p}" ${selected.has(p)?'checked':''}><strong>${h(E.profileNames[p])}</strong><small>${i===0?'Верхняя строка':i===profiles.length-1?'Нижняя строка':'Средняя строка'}</small></label>`).join('')}</div>
 <p class="hint">Отметьте профиль или сочетание профилей, которое занимается этим предметом. Один урок может быть общим для двух профилей. Порядок строк всегда фиксирован: ${profiles.map(p=>E.profileNames[p]).join(' → ')}.</p>
 <p class="hint">Это изменение состава учебной группы в локальном расписании. Учитель, предмет, кабинет, дата и время не меняются. Оно не отправляется обратно в ВШ.</p><p id="profile-error" class="error" role="alert"></p>`,
 [{text:'Отмена',action:()=>$('#dialog').close()},{text:'Сохранить профили',class:'primary',action:()=>{
  const audience=$$('[data-profile]:checked').map(x=>x.dataset.profile);
  if(!audience.length){$('#profile-error').textContent='Выберите хотя бы один профиль.';return}
  confirmProfilePatches([profilePatch(old,audience)],'Профили урока '+lookup('classes',old.classId)?.name);
 }}]);
}
let draggedProfile=null;
function bindProfileDrops(){
 $$('[data-lesson]').forEach(el=>el.addEventListener('dragstart',()=>{draggedProfile=el.dataset.profileOrigin||null}));
 $$('[data-profile-target]').forEach(lane=>{
  lane.addEventListener('dragover',e=>{e.preventDefault();lane.classList.add('profile-drag-over')});
  lane.addEventListener('dragleave',()=>lane.classList.remove('profile-drag-over'));
  lane.addEventListener('drop',e=>{
   lane.classList.remove('profile-drag-over');
   const td=lane.closest('td'),old=E.effective(db).find(l=>l.id===(dragId||e.dataTransfer.getData('text/plain')));
   if(!old||old.classId!==td.dataset.cellClass)return;
   if(old.date!==td.dataset.cellDate||old.slot!==+td.dataset.cellSlot)return; // ordinary block transfer handles other slots
   e.preventDefault();e.stopPropagation();
   if(old.locked||old.cancelled){message('Сначала снимите закрепление или восстановите урок.');return}
   const target=lane.dataset.profileTarget,source=draggedProfile||E.profileAudience(old,db)[0];draggedProfile=null;
   if(source===target)return;
   const current=E.profileAudience(old,db),occupants=E.effective(db).filter(l=>l.id!==old.id&&l.classId===old.classId&&l.date===old.date&&l.slot===old.slot&&!l.cancelled&&E.profileAudience(l,db).includes(target));
   if(current.length===1&&occupants.length===1&&E.profileAudience(occupants[0],db).length===1&&!occupants[0].locked){
    confirmProfilePatches([profilePatch(old,[target]),profilePatch(occupants[0],[source])],'Обмен профилями внутри слота');
   }else{
    const audience=E.classProfiles(old,db).filter(p=>p===target||(current.includes(p)&&p!==source));
    showProfiles(old.id,audience);
   }
  });
 });
}
const profileInspector=renderInspector;
renderInspector=function(){
 profileInspector();
 const l=E.effective(db).find(x=>x.id===selectedLesson);
 if(l&&E.classProfiles(l,db).length){
  $('#inspect-edit').insertAdjacentHTML('afterend','<button id="inspect-profile">Изменить профили</button>');
  $('#inspect-profile').onclick=()=>showProfiles(l.id);
 }
};
const profileShowLesson=showLesson;
showLesson=function(id,initial){
 profileShowLesson(id,initial);
 const l=id?E.effective(db).find(x=>x.id===id):null;
 if(l&&E.classProfiles(l,db).length){
  const field=$('#edit-group')?.closest('label');
  field?.insertAdjacentHTML('afterend',`<div class="profile-editor-inline"><span>Профили:</span>${E.profileAudience(l,db).map(x=>`<b>${E.profileShort[x]}</b>`).join('')}<button type="button" id="edit-profiles">Изменить</button></div>`);
  $('#edit-profiles').onclick=()=>showProfiles(l.id);
 }
};
