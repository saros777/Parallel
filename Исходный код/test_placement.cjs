const assert=require('node:assert/strict'),seed=require('./seed.json'),S=require('./ui/studio-model.js'),E=require('./ui/engine.js');
require('./ui/room-engine.js');const W=require('./ui/workbench-engine.js');
const db={...seed,baseSchedule:null,lessons:S.template(seed),extraLessons:[],overrides:{},absences:[],preferences:{}};
const rows=E.effective(db),dates=[...new Set(rows.map(l=>l.date))];let checks=0;
for(const name of ['4б','5а','1а']){
 const classId=db.classes.find(c=>c.name===name).id,source=rows.find(l=>l.classId===classId&&l.teacherId);
 for(const date of dates)for(let slot=1;slot<=8;slot++){
  if(rows.some(l=>l.classId===classId&&l.date===date&&l.slot===slot))continue;
  const raw=W.plan(db,source.id,date,slot,{timingDB:db});
  // Deliberately stale bell text: it must not change the visible occupancy.
  raw[0].after.time=source.time;
  const issues=W.assess(db,raw).issues;
  const busy=rows.some(l=>l.id!==source.id&&l.teacherId===source.teacherId&&l.date===date&&l.slot===slot);
  assert.equal(issues.some(i=>i.kind==='Учитель занят одновременно'),busy,`${name} ${date} slot ${slot}`);
  assert(!issues.some(i=>i.kind.includes('Пересечение класса')),`false class collision in empty ${name} ${date}/${slot}`);
  assert(!issues.some(i=>i.kind.toLowerCase().includes('время звонка')));
  assert.equal(raw[0].after.classId,classId);assert.equal(raw[0].after.teacherId,source.teacherId);
  checks++;
 }
}
assert(checks>30);console.log(`Placement oracle: ${checks} empty cells in original 4б, 5а and 1а agree with visible teacher/class occupancy`);
