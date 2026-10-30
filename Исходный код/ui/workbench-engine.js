/* Pure manual scheduling operations. No automatic deletion, class reassignment or silent override. */
(function(root){
 const E=root.ScheduleEngine||require('./engine.js');
 const active=l=>!l.cancelled&&!l.parked&&!l.suspended;
 function slice(db,dates){const ds=new Set(dates);if(db.baseSchedule)return {...db,baseSchedule:null,lessons:E.effective(db).filter(l=>ds.has(l.date)),extraLessons:[],overrides:{}};return {...db,lessons:db.lessons.filter(l=>ds.has(l.date)),extraLessons:(db.extraLessons||[]).filter(l=>ds.has(l.date))}}
 function plan(db,id,date,slot,{targetId=null,action='swap',block=false,timingDB=db}={}){
  const rows=E.effective(db),old=rows.find(l=>l.id===id);
  if(!old||old.cancelled)throw Error('Урок удалён или не найден');
  if(old.locked)throw Error('Сначала снимите закрепление урока');
  if(!date||!Number.isInteger(slot)||slot<1||slot>20)throw Error('Некорректная дата или номер урока');
  const from=block&&!old.parked?rows.filter(l=>active(l)&&l.classId===old.classId&&l.date===old.date&&l.slot===old.slot):[old];
  const targets=rows.filter(l=>active(l)&&l.classId===old.classId&&l.date===date&&l.slot===slot&&!from.some(f=>f.id===l.id));
  const target=targetId?targets.find(l=>l.id===targetId):null;
  const to=block?targets:target?[target]:[];
  if([...from,...to].some(l=>l.locked))throw Error('Затронут закреплённый урок. Сначала снимите закрепление.');
  const moved=l=>({...l,date,slot,parked:false,...E.slotInfo(timingDB,l.classId,date,slot)});
  const changes=from.map(l=>({id:l.id,before:l,after:moved(l)}));
  if(action!=='together')for(const l of to){
   const after=action==='stash'||old.parked?{...l,parked:true}:{...l,date:old.date,slot:old.slot,parked:false,...E.slotInfo(timingDB,l.classId,old.date,old.slot)};
   changes.push({id:l.id,before:l,after});
  }
  return changes;
 }
 function assess(db,patches){
  const local=slice(db,patches.flatMap(p=>[p.before.date,p.after.date]));
  const resolved=E.resolvePatches(local,patches);
  return {patches:resolved,issues:E.newIssues(local,resolved)};
 }
 function park(db,id,block=false){
  const rows=E.effective(db),old=rows.find(l=>l.id===id);
  if(!old||old.cancelled)throw Error('Урок не найден');
  const selected=block?rows.filter(l=>active(l)&&l.classId===old.classId&&l.date===old.date&&l.slot===old.slot):[old];
  if(selected.some(l=>l.locked))throw Error('Сначала снимите закрепление урока');
  return selected.map(l=>({id:l.id,before:l,after:{...l,parked:true}}));
 }
 function assignment(db,l){
  const courses=(db.courses||[]).filter(c=>c.classId===l.classId&&c.subjectId===l.subjectId&&(!c.startDate||c.startDate<=l.date)&&(!c.endDate||c.endDate>=l.date));
  const sameGroup=x=>(x.groupName||'')===(l.groupName||'');
  const direct=courses.filter(c=>c.teacherId&&sameGroup(c));
  const original=db.lessons.filter(x=>x.classId===l.classId&&x.subjectId===l.subjectId&&x.teacherId&&sameGroup(x)).sort((a,b)=>Math.abs(Date.parse(a.date)-Date.parse(l.date))-Math.abs(Date.parse(b.date)-Date.parse(l.date)));
  const sources=direct.length?direct:original;
  const teachers=[...new Set(sources.map(x=>x.teacherId))].filter(id=>db.teachers.some(t=>t.id===id&&!t.hasMaternityVacation));
  return {teacherId:teachers[0]||null,teachers,courseId:(direct[0]||courses.find(sameGroup))?.id||original[0]?.courseId||null};
 }
 function teacherColor(id,db){if(!id)return '#e3e6eb';const ids=db.teachers.map(t=>t.id).sort(),i=ids.indexOf(id);return `hsl(${Math.round(((i<0?0:i)*137.508)%360)} 62% 79%)`}
 const api={active,slice,plan,assess,park,assignment,teacherColor};
 root.WorkbenchEngine=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
