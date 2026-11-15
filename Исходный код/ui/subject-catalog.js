/* Canonical subject names and abbreviations confirmed by raspisanie_s_podgruppami_utochnennoe.xlsx. */
(function(root){
 const revision=2;
 const rules=[
  [/^\s*Разговоры о важном\s*$/i,'РОВ'],[/^\s*Русский язык\s*$/i,'р/я'],[/английск/i,'а/я'],[/^\s*Математика\s*$/i,'м'],
  [/^\s*Литературное чтение\s*$/i,'лч'],[/^\s*Литература\s*$/i,'л'],[/^Изобразительное искусство$/i,'ИЗО'],[/^Музыка$/i,'муз'],[/^Физическая культура$/i,'ФК'],
  [/^Окружающий мир$/i,'ом'],[/^География$/i,'геог'],[/^Биология$/i,'б'],[/^Физика$/i,'ф'],[/^Химия$/i,'х'],[/^История(?: России\. Всеобщая история)?$/i,'и'],[/^Обществознание$/i,'о'],
  [/^Геометрия$/i,'Г'],[/^Алгебра(?: и начала математического анализа)?$/i,'А'],[/^Вероятность и статистика$/i,'ВиС'],[/безопасности и защиты Родины/i,'ОБЗР'],
  [/^(?:Труд \(технология\)|Технология)$/i,'Т'],[/^(?:Информатика|Информатика и ИКТ)$/i,'ИКТ'],[/алгоритмик|основы программирования/i,'ВДА'],[/^Индивидуальный учебный проект$/i,'ИУП'],
  [/(?:Россия|Моя Россия).*мои горизонты/i,'Р-мг'],[/^Актуальные вопросы истории$/i,'АВИ'],[/^Черчение$/i,'Чер'],[/религиозных культур и светской этики/i,'ОРКС'],
  [/^Педагогический имидж$/i,'П-И'],[/подготовка к ОГЭ по обществознанию/i,'ЭК'],[/^Биохимия$/i,'БиХ'],[/^Основы фармакологии$/i,'ОФ'],[/^Основы психологии$/i,'ОПс'],[/^Основы педагогики$/i,'пед']
 ];
 const tidy=value=>String(value||'').toLowerCase().replace(/[ё]/g,'е').replace(/[‐-―-]+/g,' ').replace(/[^a-zа-я0-9]+/gi,' ').trim();
 function abbreviation(name,current=''){return rules.find(([re])=>re.test(String(name||'').trim()))?.[1]||current||name||''}
 function duplicateKey(name){
  const n=tidy(name);
  if(/^(?:моя )?россия мои горизонты$/.test(n))return 'horizons';
  if(n==='технология'||n==='труд технология')return 'technology';
  if(n==='мы твои друзья')return 'friends';
  return 'exact:'+n;
 }
 const aliases=new Map([
  ['второй иностранный язык английский','Иностранный язык (английский)'],['иностранный язык','Иностранный язык (английский)'],
  ['информатика и икт','Информатика'],['практическая информатика','Информатика'],
  ['история россии всеобщая история','История'],['россия моя история','История'],
  ['актуальные вопросы обществознания','Обществознание'],['актуальные вопросы изучения обществознания','Обществознание'],['права человека','Обществознание'],
  ['литературное чтение на родном языке русском','Литературное чтение'],['родной язык русский','Русский язык'],['родная литература русская','Литература'],
  ['физическая химия','Химия'],['основы программирования на python','Основы программирования']
 ]);
 function clean(data){
  data.preferences??={};data.meta??={};
  const labels=data.preferences.labels??={},groups=new Map(),replace=new Map(),subjects=[],source=data.subjects||[],byName=new Map(source.map(s=>[tidy(s.name),s]));let merged=0,renamed=0,deleted=0;
  for(const source of data.subjects||[]){
   const alias=aliases.get(tidy(source.name)),target=alias&&byName.get(tidy(alias));if(target){replace.set(source.id,target.id);merged++;continue}
   const item={...source},allowed=rules.some(([re])=>re.test(String(item.name||'').trim()));if(!allowed){replace.set(item.id,null);deleted++;continue}
   const key=duplicateKey(item.name),existing=groups.get(key);
   if(existing){replace.set(item.id,existing.id);merged++;continue}
   if(tidy(item.name)==='иностранный язык английский')item.name='Английский язык';
   if(key==='horizons')item.name='Россия — мои горизонты';
   if(key==='technology')item.name='Труд (технология)';
   if(key==='friends')item.name='Мы — твои друзья';
   const short=abbreviation(item.name,item.abbreviation);if(item.abbreviation!==short){item.abbreviation=short;renamed++}
   groups.set(key,item);subjects.push(item);
  }
  const id=id=>replace.has(id)?replace.get(id):id,rows=[data.lessons,data.extraLessons,data.baseSchedule?.lessons,data.courses,data.groups,data.teacherSubjects];
  for(const list of rows)for(const row of list||[])if(row.subjectId)row.subjectId=id(row.subjectId);
  for(const patch of Object.values(data.overrides||{}))if(patch?.subjectId)patch.subjectId=id(patch.subjectId);
  const valid=new Set(subjects.map(s=>s.id)),keep=row=>!Object.hasOwn(row||{},'subjectId')||valid.has(row.subjectId),removedLessonIds=new Set();
  for(const [lessonId,patch] of Object.entries(data.overrides||{}))if(patch?.subjectId&&!valid.has(patch.subjectId))removedLessonIds.add(lessonId);
  for(const key of ['lessons','extraLessons']){for(const row of data[key]||[])if(!keep(row))removedLessonIds.add(row.id);data[key]=(data[key]||[]).filter(keep)}
  if(data.baseSchedule){for(const row of data.baseSchedule.lessons||[])if(!keep(row))removedLessonIds.add(row.id);data.baseSchedule.lessons=(data.baseSchedule.lessons||[]).filter(keep)}
  data.courses=(data.courses||[]).filter(keep);data.groups=(data.groups||[]).filter(keep);data.teacherSubjects=(data.teacherSubjects||[]).filter(keep);
  for(const key of Object.keys(data.overrides||{}))if(removedLessonIds.has(key)||!keep(data.overrides[key]))delete data.overrides[key];
  const nextLabels={};for(const subject of subjects)nextLabels[subject.id]=abbreviation(subject.name,labels[subject.id]||subject.abbreviation);data.preferences.labels=nextLabels;
  data.preferences.studioDisplay={...data.preferences.studioDisplay,abbreviate:true};data.preferences.compactDisplay={...data.preferences.compactDisplay,abbreviate:true};data.preferences.printLayout={...data.preferences.printLayout,abbreviate:true};
  data.teacherSubjects=[...new Map((data.teacherSubjects||[]).map(x=>[String(x.teacherId)+'|'+id(x.subjectId),{...x,subjectId:id(x.subjectId)}])).values()];
  data.subjects=subjects;data.meta.subjectCatalogRevision=revision;
  if(merged||deleted)data.history=[];
  return {merged,deleted,renamed,subjects:subjects.length};
 }
 const api={revision,rules,aliases,abbreviation,duplicateKey,clean};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.SubjectCatalog=api;
})(typeof globalThis!=='undefined'?globalThis:this);
