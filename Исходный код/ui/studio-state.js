/* Persist the timetable view itself, not only the underlying lessons. */
(function(root){
 const axes=new Set(['classes','teachers','rooms','general']),periods=new Set(['base','weeks']),spans=new Set(['week','day']),filterModes=new Set(['all','class','teacher','subject']);
 const validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')&&Number.isFinite(Date.parse(value));
 function normalize(source={},classIds=[],anchor=''){
  const known=new Set(classIds),ids=Array.isArray(source.selectedClassIds)?source.selectedClassIds.filter(id=>known.has(id)):null;
  const filter=value=>({mode:filterModes.has(value?.mode)?value.mode:'all',value:typeof value?.value==='string'?value.value:''});
  return {period:periods.has(source.period)?source.period:'base',axis:axes.has(source.axis)?source.axis:'classes',teacherSpan:spans.has(source.teacherSpan)?source.teacherSpan:'week',teacherDay:Number.isInteger(+source.teacherDay)&&+source.teacherDay>=1&&+source.teacherDay<=5?+source.teacherDay:1,date:validDate(source.date)?source.date:anchor,selectedClassIds:ids,filters:{bottom:filter(source.filters?.bottom),side:filter(source.filters?.side)}};
 }
 const api={normalize};root.StudioViewState=api;if(typeof module!=='undefined')module.exports=api;
 if(typeof document==='undefined')return;

 let activeProject=null,restoring=false,saveQueued=false,lastPersisted='';
 function snapshot(){return {period:studioPeriod,axis:studioAxis,teacherSpan:studioTeacherSpan,teacherDay:studioTeacherDay,date,selectedClassIds:selectedClasses?[...selectedClasses]:null,filters:structuredClone(studioFilters)}}
 function stateMark(){return JSON.stringify({view:snapshot(),displayByAxis:settings.studioDisplayByAxis||{}})}
 function restore(){
  const state=normalize(settings.studioViewState,db.classes.map(c=>c.id),SM.anchor(db));restoring=true;
  studioPeriod=state.period;studioAxis=state.axis;studioTeacherSpan=state.teacherSpan;studioTeacherDay=state.teacherDay;date=state.date;selectedClasses=state.selectedClassIds===null?null:new Set(state.selectedClassIds);studioFilters=state.filters;restoring=false;
  lastPersisted=stateMark();
 }
 function save(){
  if(restoring||!db)return;const mark=stateMark();if(mark===lastPersisted)return;
  settings.studioViewState=snapshot();lastPersisted=mark;dirty=true;window.parallelProjectChanged?.();renderStatus?.();
  if(connected&&!loading){clearTimeout(saveTimer);saveTimer=setTimeout(()=>persist(),250)}
 }
 function queueSave(){if(saveQueued)return;saveQueued=true;queueMicrotask(()=>{saveQueued=false;save()})}

 const renderBeforeState=render;
 // Every timetable navigation path ends in render(): this also covers the
 // previous/next/today buttons and programmatic transitions (for example,
 // opening an absence in the weekly view), not only toolbar click selectors.
 render=function(){if(db&&db!==activeProject){activeProject=db;restore()}renderBeforeState();queueSave()};
 const studioViewBeforeState=studioView;
 studioView=function(){return {...studioViewBeforeState(),...(settings.studioDisplayByAxis?.[studioAxis]||{})}};

 const showSettingsBeforeState=showSettings;
 showSettings=function(){
  const viewAxis=studioAxis;showSettingsBeforeState();const apply=[...$('#dialog').querySelectorAll('button')].find(button=>button.textContent.trim()==='Применить');if(!apply)return;
  const action=apply.onclick;apply.onclick=event=>{const chosen=Object.fromEntries($$('[data-studio-field]').map(field=>[field.dataset.studioField,field.checked]));settings.studioDisplayByAxis={...settings.studioDisplayByAxis,[viewAxis]:chosen};action.call(apply,event);queueSave()};
 };
})(globalThis);
