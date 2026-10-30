/* Pure scheduling functions shared by UI and tests. */
(function(root){
const id=x=>String(x??'');
const addDays=(d,n)=>{const t=new Date(d+'T12:00:00Z');t.setUTCDate(t.getUTCDate()+n);return t.toISOString().slice(0,10)};
function effective(db){const rows=(root.StudioModel?root.StudioModel.expand(db):[...db.lessons,...(db.extraLessons||[])]).map(x=>({...x,...(db.overrides||{})[x.id]})).map(l=>root.StudioModel?{...l,suspended:root.StudioModel.suspended(l,db)}:l);return root.RoomAllocator?root.RoomAllocator.resolve(db,rows):rows}
function patchedDB(db,patches){
 const work={...db,overrides:{...db.overrides},extraLessons:[...(db.extraLessons||[])]};
 const ids=new Set([...db.lessons,...work.extraLessons].map(x=>x.id));
 for(const p of patches){if(!ids.has(p.id)){work.extraLessons.push(p.after);ids.add(p.id)}else work.overrides[p.id]={...work.overrides[p.id],...p.after}}
 return work;
}
function resolvePatches(db,patches){
 if(!db.preferences?.roomPolicy?.enabled)return patches;
 const rows=new Map(effective(patchedDB(db,patches)).map(x=>[x.id,x]));
 return patches.map(p=>({...p,after:rows.get(p.id)||p.after}));
}
function roomOnlyChange(before,after){
 const keys=['classId','date','slot','time','teacherId','subjectId','groupName'];
 return keys.every(k=>(before[k]??null)===(after[k]??null))&&JSON.stringify(before.profileAudience||[])===JSON.stringify(after.profileAudience||[])&&!!before.cancelled===!!after.cancelled&&!!before.locked===!!after.locked&&
  (before.roomId!==after.roomId||before.roomMode!==after.roomMode);
}
function minutes(l){
 const m=(l.time||'').match(/(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})/);
 return m?[+m[1]*60 + +m[2],+m[3]*60 + +m[4]]:[l.slot*60,l.slot*60+45];
}
// Grid coordinates are the scheduling authority; bell text is descriptive only.
function overlap(a,b){return !a.cancelled&&!b.cancelled&&!a.parked&&!b.parked&&!a.suspended&&!b.suspended&&a.date===b.date&&Number.isInteger(a.slot)&&a.slot===b.slot}

const profileKeys=['social','chemical','physical'];
const profileNames={social:'Социально-гуманитарный',chemical:'Химико-биологический',physical:'Физико-математический'};
const profileShort={social:'СГ',chemical:'ХБ',physical:'ФМ'};
function classProfiles(l,db){
 const name=db.classes.find(c=>id(c.id)===id(l.classId))?.name;
 return name==='10а'?profileKeys.slice(0,2):name==='11'?[...profileKeys]:[];
}
function audience(l,db){
 const c=db.classes.find(c=>id(c.id)===id(l.classId)),n=(l.groupName||'').toLowerCase();
 if(Array.isArray(l.profileAudience)&&l.profileAudience.length)return l.profileAudience.filter(x=>classProfiles(l,db).includes(x));
 if(!n)return null;
 if(n.includes('социально')||n.includes('химико')||n.includes('физико')){
  return [['социально','social'],['химико','chemical'],['физико','physical']].filter(([word])=>n.includes(word)).map(x=>x[1]);
 }
 if((c?.name==='11'||c?.name==='10а')&&/базов|углуб/.test(n)){
  const s=db.subjects.find(s=>id(s.id)===id(l.subjectId))?.name.toLowerCase()||'';
  const advanced=n.includes('углуб');
  let high=null;
  if(/истор|обществ/.test(s))high='social';
  if(/хими|биолог/.test(s))high='chemical';
  if(/алгебр|геометр|вероят|математ|физик/.test(s))high='physical';
  if(high)return classProfiles(l,db).filter(x=>advanced?x===high:x!==high);
 }
 return null;
}
function profileAudience(l,db){return audience(l,db)||[]}
function profileRank(l,db){
 const profiles=classProfiles(l,db),a=profileAudience(l,db);
 return a.length?Math.min(...a.map(x=>profiles.indexOf(x)).filter(x=>x>=0)):profiles.length+1;
}
function sortProfileRows(rows,db){return [...rows].sort((a,b)=>profileRank(a,db)-profileRank(b,db)||String(a.id).localeCompare(String(b.id),'ru',{numeric:true}))}
function profileLines(rows,db,classId){
 const profiles=classProfiles({classId},db);
 const split=profiles.length&&rows.some(l=>{const a=profileAudience(l,db);return a.length>0&&a.length<profiles.length});
 if(!split)return sortProfileRows(rows,db).map(lesson=>({lesson,profile:null}));
 return profiles.flatMap(profile=>{
  const ls=rows.filter(l=>{const a=profileAudience(l,db);return !a.length||a.includes(profile)});
  return ls.length?sortProfileRows(ls,db).map(lesson=>({lesson,profile})):[{lesson:null,profile}];
 });
}
function disjoint(a,b,db){
 if(a.groupId&&b.groupId&&a.groupId!==b.groupId){const ga=(db.groups||[]).find(g=>g.id===a.groupId),gb=(db.groups||[]).find(g=>g.id===b.groupId);if(ga&&gb&&ga.classId===gb.classId&&ga.subjectId===gb.subjectId)return true;}
 const aa=audience(a,db),bb=audience(b,db);
 if(aa&&bb)return !aa.some(x=>bb.includes(x));
 function ordinal(n){if(/первая|первой/i.test(n))return '1';if(/вторая|второй/i.test(n))return '2';return n.match(/(?:^|\D)([12])(?:\D|$)/)?.[1]}
 const ga=ordinal(a.groupName||''),gb=ordinal(b.groupName||'');
 return !!(ga&&gb&&ga!==gb);
}
function absenceFor(l,db){return !l.parked&&(db.absences||[]).find(a=>id(a.teacherId)===id(l.teacherId)&&a.startDate<=l.date&&a.endDate>=l.date&&l.slot>=(a.startSlot||1)&&l.slot<=(a.endSlot||20))}
function pairIssues(a,b,db){
 if(a.id===b.id||a.cancelled||b.cancelled||!overlap(a,b))return [];
 const r=[];
 if(a.teacherId&&a.teacherId===b.teacherId)r.push('Учитель занят одновременно');
 if(a.roomId&&a.roomId===b.roomId)r.push('Кабинет занят одновременно');
 if(a.classId===b.classId&&!disjoint(a,b,db))r.push('Пересечение класса / состава подгрупп');
 return r;
}
function conflicts(db,rows=effective(db)){
 const out=[],days={};
 for(const x of rows.filter(x=>!x.cancelled&&!x.parked&&!x.suspended)){
  (days[x.date]??=[]).push(x);
  if(!x.teacherId)out.push({lessonIds:[x.id],date:x.date,kind:'Не назначен учитель'});
  if(db.preferences?.roomPolicy?.enabled&&x.roomMode==='auto'&&!x.roomId)out.push({lessonIds:[x.id],date:x.date,kind:'Нет свободного кабинета'});
  for(const kind of root.StudioModel?.restrictions(x,db)||[])out.push({lessonIds:[x.id],date:x.date,kind});
  if(absenceFor(x,db))out.push({lessonIds:[x.id],date:x.date,kind:'Назначен отсутствующий учитель'});
 }
 for(const ls of Object.values(days))for(let i=0;i<ls.length;i++)for(let j=i+1;j<ls.length;j++){
  for(const kind of pairIssues(ls[i],ls[j],db))out.push({lessonIds:[ls[i].id,ls[j].id],date:ls[i].date,kind});
 }
 return out;
}
function changeIssues(candidate,db,rows=effective(db),ignore=[]){
 const issues=root.StudioModel?root.StudioModel.restrictions(candidate,db):[];
 if(!candidate.cancelled&&!candidate.parked){
  if(absenceFor(candidate,db))issues.push('Учитель отмечен отсутствующим');
  if(db.preferences?.roomPolicy?.enabled&&candidate.roomMode==='auto'&&!candidate.roomId)issues.push('Нет свободного кабинета: выберите другой слот или добавьте кабинет');
  for(const other of rows)if(other.id!==candidate.id&&!ignore.includes(other.id))issues.push(...pairIssues(candidate,other,db));
  const cal=(db.calendar||[]).find(x=>x.classId===candidate.classId&&x.date===candidate.date);
  if(cal?.isHoliday)issues.push('В календаре ВШ этот день отмечен неучебным');
 }
 return [...new Set(issues)];
}
function subjectIdentity(name){
 return String(name||'').toLowerCase().replace(/ё/g,'е').replace(/\s*\((?:базовый|углубленный)(?: уровень)?\)\s*/g,' ').replace(/\s+/g,' ').trim();
}
function subjectFamily(name){
 const n=subjectIdentity(name);
 if(/^(математика|алгебра(?: и начала (?:математического )?анализа)?|геометрия|вероятность и статистика)$/.test(n))return 'math';
 if(/^(история(?: россии| всеобщая| россии\. всеобщая история)?|всеобщая история|обществознание|актуальные вопросы (?:истории|(?:изучения )?обществознания)|подготовка к огэ по обществознанию)$/.test(n))return 'history-social';
 return null;
}
function candidates(lesson,db){
 const rows=effective(db);
 const names=new Map(db.subjects.map(s=>[id(s.id),s.name]));
 const target=subjectIdentity(names.get(id(lesson.subjectId))),family=subjectFamily(target);
 const qualifications=new Map();
 // Use original teaching assignments, not temporary substitutions, as evidence.
 for(const x of [...(db.teacherSubjects||[]),...(db.courses||[]),...db.lessons]){
  if(!x.teacherId||!x.subjectId)continue;
  const key=id(x.teacherId);if(!qualifications.has(key))qualifications.set(key,new Set());
  qualifications.get(key).add(id(x.subjectId));
 }
 return db.teachers.filter(t=>!t.hasMaternityVacation&&id(t.id)!==id(lesson.teacherId)).map(t=>{
  const taught=[...(qualifications.get(id(t.id))||[])];
  const exact=taught.filter(s=>s===id(lesson.subjectId)||(target&&subjectIdentity(names.get(s))===target));
  const relatedSubjects=taught.filter(s=>family&&subjectFamily(names.get(s))===family);
  if(!exact.length&&!relatedSubjects.length)return null;
  const l={...lesson,teacherId:t.id};
  const busy=(root.StudioModel&&root.StudioModel.restrictions(l,db).length)||absenceFor(l,db)||rows.some(x=>x.id!==l.id&&!x.cancelled&&x.teacherId===t.id&&overlap(x,l));
  const subject=!!exact.length,related=!subject&&!!relatedSubjects.length;
  const known=db.lessons.some(x=>x.teacherId===t.id&&x.classId===l.classId);
  const matchingSubjects=[...new Set((subject?exact:relatedSubjects).map(s=>names.get(s)).filter(Boolean))];
  const assigned=(db.teacherSubjects||[]).some(x=>id(x.teacherId)===id(t.id)&&(subject?exact:relatedSubjects).includes(id(x.subjectId)));
  return {teacher:t,busy:!!busy,subject,related,matchingSubjects,qualification:subject?'Преподаёт этот предмет':'Смежный: '+matchingSubjects.join(', '),known,score:(subject?100:0)+(assigned?5:0)+(known?3:0)};
 }).filter(Boolean).sort((a,b)=>Number(a.busy)-Number(b.busy)||b.score-a.score||a.teacher.name.localeCompare(b.teacher.name,'ru'));
}
function slotInfo(db,classId,date,slot){
 const same=effective(db).find(x=>x.classId===classId&&x.date===date&&x.slot===slot)||db.lessons.find(x=>x.classId===classId&&x.slot===slot);
 return {time:same?.time||'',callId:same?.callId||null};
}
function rebuild(db,date,classIds){
 const rows=effective(db).map(x=>({...x})),proposals=[];
 for(const c of classIds){
  const classRows=rows.filter(x=>x.classId===c&&x.date===date&&!x.cancelled&&!x.parked);
  const slots=[...new Set(classRows.map(x=>x.slot))].sort((a,b)=>a-b);
  for(const old of slots){
   const block=classRows.filter(x=>x.slot===old);
   if(block.some(x=>x.locked||absenceFor(x,db)))continue;
   // Keep subgroup blocks together; never merge or reorder teaching audiences.
   const previous=classRows.filter(x=>x.slot<old).map(x=>x.slot);
   const earliest=previous.length?Math.max(...previous)+1:1;
   for(let target=earliest;target<old;target++){
    if(classRows.some(x=>x.slot===target))continue;
    const proposed=block.map(x=>({...x,slot:target,...slotInfo(db,c,date,target)}));
    if(proposed.some(x=>changeIssues(x,db,rows,block.map(b=>b.id)).length))continue;
    if(proposed.some((x,i)=>proposed.slice(i+1).some(y=>pairIssues(x,y,db).length)))continue;
    block.forEach((x,i)=>{proposals.push({id:x.id,before:{...x},after:proposed[i]});Object.assign(x,proposed[i]);});
    break;
   }
  }
 }
 return proposals;
}
function validate(db){
 for(const k of ['classes','teachers','subjects','lessons','rooms'])if(!Array.isArray(db[k]))throw Error('В файле отсутствует массив '+k);
 if(db.meta?.schemaVersion!=='1.0')throw Error('Поддерживается схема 1.0');
 for(const k of ['classes','teachers','subjects','lessons','rooms']){
  const ids=new Set();for(const r of db[k]){if(typeof r.id!=='string'||!r.id||ids.has(r.id))throw Error('Некорректные или повторяющиеся ID в '+k);ids.add(r.id)}
 }
 const cls=new Set(db.classes.map(x=>x.id)),subs=new Set(db.subjects.map(x=>x.id));
 for(const l of db.lessons)if(!/^\d{4}-\d{2}-\d{2}$/.test(l.date)||!Number.isInteger(l.slot)||l.slot<1||l.slot>20||!cls.has(l.classId)||!subs.has(l.subjectId))throw Error('Некорректная запись урока '+l.id);
 return true;
}
function newIssues(db,patches){
 const dates=new Set(patches.flatMap(p=>[p.before.date,p.after.date]));
 const original=effective(db).filter(x=>dates.has(x.date));
 const after=effective(patchedDB(db,patches)).filter(x=>dates.has(x.date));
 const key=i=>i.kind+'|'+i.lessonIds.slice().sort().join('|');
 const existing=new Set(conflicts(db,original).map(key));
 const errors=conflicts(db,after).filter(x=>!existing.has(key(x)));
 for(const p of patches)if(!p.after.cancelled&&!p.after.parked){
  if((db.calendar||[]).some(c=>c.classId===p.after.classId&&c.date===p.after.date&&c.isHoliday))errors.push({kind:'Неучебный день',lessonIds:[p.id]});
 }
 return errors;
}
function transfer(db,lessonId,targetDate,targetSlot){
 const rows=effective(db),l=rows.find(x=>x.id===lessonId);
 if(!l||l.locked||l.cancelled)throw Error('Закрепленное или отмененное занятие нельзя переносить');
 const from=rows.filter(x=>!x.cancelled&&!x.parked&&x.classId===l.classId&&x.date===l.date&&x.slot===l.slot);
 const to=rows.filter(x=>!x.cancelled&&!x.parked&&x.classId===l.classId&&x.date===targetDate&&x.slot===targetSlot);
 if([...from,...to].some(x=>x.locked))throw Error('В одном из блоков есть закрепленный урок');
 const changes=[...from.map(x=>({id:x.id,before:x,after:{...x,date:targetDate,slot:targetSlot,...slotInfo(db,x.classId,targetDate,targetSlot)}})),...to.map(x=>({id:x.id,before:x,after:{...x,date:l.date,slot:l.slot,...slotInfo(db,x.classId,l.date,l.slot)}}))];
 if(newIssues(db,changes).length)throw Error('Перенос создаст новое пересечение. Выберите свободный слот или другого учителя.');
 return resolvePatches(db,changes);
}
function optimize(db,date,options={}){
 const work={...db,overrides:structuredClone(db.overrides||{})},changes=new Map(),unresolved=[];
 const ids=options.classIds||db.classes.map(c=>c.id);
 function put(before,after,reason){
  const prev=changes.get(before.id);changes.set(before.id,{id:before.id,before:prev?.before||before,after,reason:prev?prev.reason+'; '+reason:reason});
  work.overrides[before.id]={...work.overrides[before.id],...after};
 }
 const affected=effective(work).filter(l=>l.date===date&&ids.includes(l.classId)&&!l.cancelled&&absenceFor(l,work));
 const eligible=c=>!c.busy&&(c.subject||options.allowRelated!==false);
 affected.sort((a,b)=>candidates(a,work).filter(eligible).length-candidates(b,work).filter(eligible).length);
 for(const l of affected){
  if(l.locked){unresolved.push({...l,reason:'Закрепленный урок: требуется ручное решение'});continue}
  const candidate=candidates(l,work).filter(eligible).find(c=>!newIssues(work,[{id:l.id,before:l,after:{...l,teacherId:c.teacher.id,roomMode:'auto'}}]).length);
  if(candidate)put(l,resolvePatches(work,[{id:l.id,before:l,after:{...l,teacherId:candidate.teacher.id,roomMode:'auto',substitutionReason:absenceFor(l,work)?.reason}}])[0].after,'Замена учителя');
  else if(options.cancelUnresolved)put(l,{...l,cancelled:true,cancelReason:'Нет доступной замены: '+(absenceFor(l,work)?.reason||'отсутствие')},'Отмена без замены');
  else unresolved.push({...l,reason:'Нет подходящего свободного преподавателя'});
 }
 if(options.compact!==false){
  // Iterative safe gap closing, allowing a later block to fill an earlier gap.
  for(let pass=0;pass<3;pass++){
   let moved=false;
   for(const cid of ids){
    const rows=effective(work).filter(x=>x.date===date&&x.classId===cid&&!x.cancelled&&!x.parked);
    const max=Math.max(0,...rows.map(x=>x.slot));
    for(let target=1;target<max;target++){
     const now=effective(work).filter(x=>x.date===date&&x.classId===cid&&!x.cancelled&&!x.parked);
     if(now.some(x=>x.slot===target))continue;
     const sources=[...new Set(now.filter(x=>x.slot>target).map(x=>x.slot))].sort((a,b)=>a-b);
     for(const slot of sources){
      const block=now.filter(x=>x.slot===slot);
      if(block.some(x=>x.locked||absenceFor(x,work)))continue;
      const patch=block.map(x=>({id:x.id,before:x,after:{...x,slot:target,...slotInfo(work,cid,date,target)}}));
      if(newIssues(work,patch).length)continue;
      patch.forEach(p=>put(p.before,p.after,'Перенос '+slot+' → '+target));moved=true;break;
     }
    }
   }
   if(!moved)break;
  }
 }
 const patches=resolvePatches(db,[...changes.values()]);
 return {patches,unresolved,errors:newIssues(db,patches)};
}
const api={id,addDays,effective,minutes,overlap,disjoint,absenceFor,pairIssues,conflicts,changeIssues,candidates,subjectFamily,slotInfo,rebuild,validate,newIssues,transfer,optimize,patchedDB,resolvePatches,roomOnlyChange,profileKeys,profileNames,profileShort,classProfiles,profileAudience,profileRank,sortProfileRows,profileLines};
root.ScheduleEngine=api;
if(typeof module!=='undefined')module.exports=api;
})(globalThis);
