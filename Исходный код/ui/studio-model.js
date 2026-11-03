/* Recurring timetable and dated exceptions. Originals remain intact for undo/import. */
(function(root){
 const day=d=>new Date(d+'T12:00:00Z').getUTCDay();
 const add=(d,n)=>{const t=new Date(d+'T12:00:00Z');t.setUTCDate(t.getUTCDate()+n);return t.toISOString().slice(0,10)};
 const monday=d=>add(d,-((day(d)+6)%7));
 const signature=l=>[l.classId,l.courseId||l.subjectId,l.groupId||l.groupName||'',day(l.date),l.slot].join('|');
 function anchor(db){
  if(db.baseSchedule)return db.baseSchedule.week;
  const weeks=new Map();for(const l of db.lessons){const w=monday(l.date);weeks.set(w,(weeks.get(w)||0)+1)}
  return [...weeks].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))[0]?.[0]||monday(new Date().toISOString().slice(0,10));
 }
 function template(db){
  if(db.baseSchedule)return db.baseSchedule.lessons.map(l=>({...l}));
  const w=anchor(db),end=add(w,6);return db.lessons.filter(l=>l.date>=w&&l.date<=end).map(l=>({...l,roomMode:l.roomMode||'auto'}));
 }
 function expand(db,start=null,end=null){
  const holidays=new Set((db.calendar||[]).filter(c=>c.isHoliday).map(c=>c.classId+'|'+c.date));
  let rows=[...db.lessons,...(db.extraLessons||[])];
  if(db.baseSchedule){
   const base=db.baseSchedule,baseEnd=add(base.week,6),original=db.lessons.filter(l=>l.date>=base.week&&l.date<=baseEnd);
   const byId=new Map(base.lessons.map(l=>[l.id,l])),sourceById=new Map(original.map(l=>[l.id,l]));
   const changes=new Map(original.map(l=>[signature(l),byId.get(l.id)]));
   const originals=new Set(original.map(l=>l.id));
   if(start&&end){
    const deltas=original.map(l=>byId.has(l.id)?Math.round((Date.parse(byId.get(l.id).date)-Date.parse(l.date))/86400000):0),low=add(start,-Math.max(0,...deltas)),high=add(end,-Math.min(0,...deltas));
    rows=rows.filter(l=>(l.date>=low&&l.date<=high)||(db.overrides?.[l.id]?.date>=start&&db.overrides[l.id].date<=end));
   }
   rows=rows.map(l=>{
    const t=changes.get(signature(l));if(!t)return l;
    const source=sourceById.get(t.id);if(!source)return l;
    const delta=Math.round((Date.parse(t.date)-Date.parse(source.date))/86400000);
    const targetDate=add(l.date,delta);return {...l,...t,id:l.id,date:targetDate,...(holidays.has(l.classId+'|'+targetDate)?{cancelled:true,baseHoliday:true}:{})};
   });
   const dates=new Map(),sourceClasses=new Set();for(const l of db.lessons){sourceClasses.add(l.classId);if(start&&end&&(l.date<start||l.date>end))continue;if(!dates.has(l.classId))dates.set(l.classId,new Set());dates.get(l.classId).add(l.date)}
   // New projects store weekly templates, not thousands of generated annual rows.
   const year=(db.meta?.academicYear||base.week).match(/\d{4}/)?.[0]||base.week.slice(0,4),schoolStart=year+'-09-01',schoolEnd=(+year+1)+'-05-31',from=start&&start>schoolStart?start:schoolStart,to=end&&end<schoolEnd?end:schoolEnd;
   for(const c of db.classes.filter(c=>!sourceClasses.has(c.id))){const ds=new Set();for(let d=from;d<=to;d=add(d,1))if(day(d)>=1&&day(d)<=5)ds.add(d);dates.set(c.id,ds)}
   for(const t of base.lessons.filter(l=>!originals.has(l.id)))for(const d of dates.get(t.classId)||[]){
    if(day(d)!==day(t.date)||holidays.has(t.classId+'|'+d))continue;
    rows.push({...t,id:t.id+'@'+d,date:d});
   }
  }else if(start&&end)rows=rows.filter(l=>(l.date>=start&&l.date<=end)||(db.overrides?.[l.id]?.date>=start&&db.overrides[l.id].date<=end));
  const courses=new Map((db.courses||[]).filter(c=>c.studioEdited).map(c=>[c.id,c]));
  return rows.map(l=>{const c=courses.get(l.courseId);return c?{...l,subjectId:c.subjectId,teacherId:c.teacherId,classId:c.classId,groupId:c.groupId||null,groupName:c.groupName||null}:l});
 }
 function commitBase(db,patches){
  const lessons=template(db),map=new Map(lessons.map(l=>[l.id,l]));
  for(const p of patches)map.set(p.id,{...p.after});
  db.baseSchedule={...db.baseSchedule,week:anchor(db),lessons:[...map.values()]};
 }
 function restrictions(l,db){
  if(l.cancelled||l.parked)return [];
  const t=db.teachers.find(t=>t.id===l.teacherId),out=[];
  if(t?.availability&&!t.availability[day(l.date)]?.includes(l.slot))out.push('Учитель недоступен в этот день / урок');
  if(t?.workDays?.length&&!t.workDays.includes(day(l.date)))out.push('Нерабочий день учителя');
  if(t?.allowedSlots?.length&&!t.allowedSlots.includes(l.slot))out.push('Урок вне разрешённого времени учителя');
  return out;
 }
 function suspended(l,db){if(!db.preferences?.studioSuspensions||l.parked||l.cancelled)return false;const a=(db.absences||[]).find(a=>a.teacherId===l.teacherId&&a.startDate<=l.date&&a.endDate>=l.date&&l.slot>=(a.startSlot||1)&&l.slot<=(a.endSlot||20));return !!(a&&l.absenceReturnFor!==a.id)}
 function activeWeek(l,db){if(db.basePreview||l.cycleWeeks!==2)return true;const week=Math.round((Date.parse(monday(l.date))-Date.parse(db.baseSchedule?.week||anchor(db)))/604800000);return ((week%2)+2)%2===(l.cyclePhase||0)}
 function targetAllowed(l,axis,entity){return l[axis==='teachers'?'teacherId':axis==='rooms'?'roomId':'classId']===entity}
 const api={targetAllowed,suspended,activeWeek,day,add,monday,signature,anchor,template,expand,commitBase,restrictions};
 root.StudioModel=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
