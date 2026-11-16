/* Room allocation is derived from the original schedule; original records stay intact. */
(function(root){
 const assignments={
  '2310958':41,'554213':3,'1656121':26,'4613673':25,'2310913':10,
  '554143':15,'1652365':9,'6981940':11,'554146':18,'554208':38,
  '554214':23,'8760979':17,'2310937':2,'2310949':1,'554206':16,
  '8413291':14,'6950934':29,'7145234':27,'2934657':44,'554145':39,
  '6371537':6,'1652368':13,'7916917':42,'5049788':37,'5816909':28,
  '2310995':36,'2311026':45,'553805':5,'1128046':7
 };
 const number=name=>String(name||'').match(/^\s*(?:каб(?:инет)?\.?\s*)?(\d+[а-яa-z]?)(?=\s|[.(]|$)/i)?.[1]||'';
 function install(db,preferences){
  // Do not apply this school's names to an unrelated imported database.
  if(!db.teachers.some(t=>t.id==='554143'&&t.name.startsWith('Дутова')))return false;
  if(preferences.roomPolicy?.schema===1){
   const p=preferences.roomPolicy;
   if(p.assignmentRevision>=3)return false;
   p.teacherRooms??={};
   p.teacherRules??={};p.classRooms??={};p.pool??=[];
   for(const [teacher,n] of Object.entries(assignments)){
    if(!db.teachers.some(t=>t.id===teacher))continue;
    let room=db.rooms.find(r=>number(r.name)===String(n));
    if(!room){room={id:'local-room-'+n,name:String(n),source:'Список строго закреплённых кабинетов'};db.rooms.push(room)}
    p.teacherRooms[teacher]=room.id;
    if(!p.teacherRules[teacher])p.teacherRules[teacher]={mode:'fixed',rooms:[room.id],forbidden:[]};
    if(!p.pool.includes(room.id))p.pool.push(room.id);
   }
   for(const [teacher,n,previous] of [['2310913',10,'5954547'],['2310937',2,'554210']]){
    const room=db.rooms.find(r=>number(r.name)===String(n));
    if(room&&db.teachers.some(t=>t.id===teacher)){p.teacherRooms[teacher]=room.id;delete p.teacherRooms[previous]}
   }
   for(const c of db.classes){
    const head=c.classHeadId||db.teachers.find(t=>t.name===c.classHeadName)?.id,room=head&&p.teacherRooms[head];
    if(room&&!p.classRooms[c.id]?.length)p.classRooms[c.id]=[room];
   }
   p.assignmentRevision=3;p.enabled=true;
   return true;
  }
  const teacherRooms={},pool=[];
  for(const [teacher,n] of Object.entries(assignments)){
   if(!db.teachers.some(t=>t.id===teacher))continue;
   let room=db.rooms.find(r=>number(r.name)===String(n));
   if(!room){room={id:'local-room-'+n,name:String(n),source:'Список кабинетов учителей'};db.rooms.push(room)}
   teacherRooms[teacher]=room.id;if(!pool.includes(room.id))pool.push(room.id);
  }
  pool.sort((a,b)=>number(db.rooms.find(r=>r.id===a)?.name).localeCompare(number(db.rooms.find(r=>r.id===b)?.name),'ru',{numeric:true}));
  const teacherRules=Object.fromEntries(Object.entries(teacherRooms).map(([teacher,room])=>[teacher,{mode:'fixed',rooms:[room],forbidden:[]}])),classRooms={};
  for(const c of db.classes){const head=c.classHeadId||db.teachers.find(t=>t.name===c.classHeadName)?.id,room=head&&teacherRooms[head];if(room)classRooms[c.id]=[room]}
  preferences.roomPolicy={schema:1,assignmentRevision:3,enabled:true,teacherRooms,teacherRules,classRooms,pool,source:'Список строго закреплённых кабинетов; уточнения: Барышникова 10, Голованев 2'};
  return true;
 }
 const cache=new WeakMap();
 function resolve(db,raw){
  const policy=db.preferences?.roomPolicy;
  if(!policy?.enabled)return raw;
  const key=JSON.stringify([db.overrides,db.extraLessons,db.absences,db.preferences?.studioSuspensions,db.baseSchedule,(db.courses||[]).filter(c=>c.studioEdited),policy]);
  const cached=cache.get(db);
  if(cached?.key===key&&cached.lessons===db.lessons&&cached.rooms===db.rooms)return cached.rows.map(l=>({...l}));
  const roomIds=new Set(db.rooms.map(r=>r.id)),pool=(policy.pool||[]).filter(r=>roomIds.has(r)),home=policy.teacherRooms||{};
  const rule=l=>policy.teacherRules?.[l.teacherId]||{mode:'preferred',rooms:home[l.teacherId]?[home[l.teacherId]]:[],forbidden:[]};
  const preferred=l=>[...new Set([...(rule(l).rooms||[]),...(policy.classRooms?.[l.classId]||[])])].filter(r=>roomIds.has(r));
  const allowed=(r,l)=>roomIds.has(r)&&!(rule(l).forbidden||[]).includes(r);
  const manual=l=>l.roomMode==='manual'||(l.roomMode!=='auto'&&Object.hasOwn(db.overrides?.[l.id]||{},'roomId'));
  const rows=raw.map(l=>({...l,roomMode:manual(l)?'manual':'auto'}));
  const byDay=new Map();
  for(const l of rows){if(!byDay.has(l.date))byDay.set(l.date,[]);byDay.get(l.date).push(l)}
  for(const lessons of byDay.values()){
   const occupied=new Map();
   const teacherDayRooms=new Map();
   const reserve=l=>{if(!l.cancelled&&!l.parked&&!l.suspended&&l.roomId){if(!occupied.has(l.roomId))occupied.set(l.roomId,[]);occupied.get(l.roomId).push(l);if(l.teacherId){if(!teacherDayRooms.has(l.teacherId))teacherDayRooms.set(l.teacherId,[]);teacherDayRooms.get(l.teacherId).push({slot:l.slot,roomId:l.roomId})}}};
   const free=(r,l)=>!(occupied.get(r)||[]).some(x=>root.ScheduleEngine.overlap(x,l));
   for(const l of lessons.filter(x=>x.roomMode==='manual'))reserve(l);
   const automatic=lessons.filter(x=>x.roomMode==='auto').sort((a,b)=>Number(rule(b).mode==='fixed')-Number(rule(a).mode==='fixed')||Number(!preferred(a).length)-Number(!preferred(b).length)||a.slot-b.slot||String(a.id).localeCompare(String(b.id),'en',{numeric:true}));
   // Reserve home rooms before assigning fallback rooms, including overlapping bell schedules.
   const fallback=[];
   for(const l of automatic){
    const first=preferred(l)[0];
    l.roomId=null;l.roomReason='Нет свободного кабинета';
    if(l.cancelled||l.parked||l.suspended){l.roomId=first||null;l.roomReason='Урок вне сетки не занимает кабинет';continue}
    if(rule(l).mode==='fixed'){
     const fixed=roomIds.has(rule(l).rooms?.[0])?rule(l).rooms[0]:null;
     l.roomId=fixed&&free(fixed,l)?fixed:null;
     l.roomReason=l.roomId?'Жёсткое закрепление за учителем':fixed?'Жёсткое закрепление: кабинет занят, номер очищен':'Жёсткое закрепление: кабинет не задан';
     if(l.roomId)reserve(l);
    }else fallback.push(l);
   }
   for(const l of fallback){
    const teacherPreferred=rule(l).rooms||[],classPreferred=policy.classRooms?.[l.classId]||[],near=(teacherDayRooms.get(l.teacherId)||[]).sort((a,b)=>Math.abs(a.slot-l.slot)-Math.abs(b.slot-l.slot))[0]?.roomId;
    const choices=[...new Set([...teacherPreferred,...classPreferred,...pool])].filter(r=>allowed(r,l)&&free(r,l));
    const score=r=>(r===near?-10000:0)+(teacherPreferred.includes(r)?teacherPreferred.indexOf(r)*10:classPreferred.includes(r)?200+classPreferred.indexOf(r)*10:1000);
    l.roomId=choices.sort((a,b)=>score(a)-score(b))[0]||null;
    if(l.roomId){const tr=rule(l).rooms||[],cr=policy.classRooms?.[l.classId]||[];l.roomReason=tr.includes(l.roomId)?'Предпочтение учителя №'+(tr.indexOf(l.roomId)+1):cr.includes(l.roomId)?'Предпочтение класса №'+(cr.indexOf(l.roomId)+1):'Выбран свободный кабинет';reserve(l)}
   }
  }
  cache.set(db,{key,lessons:db.lessons,rooms:db.rooms,rows});
  return rows.map(l=>({...l}));
 }
 const api={assignments,number,install,resolve};root.RoomAllocator=api;
 if(typeof module!=='undefined')module.exports=api;
})(globalThis);
