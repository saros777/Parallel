/* Pure formatting helpers shared by the board, print preview and tests. */
(function(root){
 const defaults={orientation:'portrait',margin:5,font:10,fit:true,subject:true,room:true,teacher:false,group:false,className:true,banding:true,view:'classes',abbreviate:true,cancelled:false,layout:'sheet',scope:'all',preset:'portrait',schema:2};
 const presets={
  portrait:{...defaults},
  sections:{...defaults,layout:'sections',font:12,preset:'sections'},
  landscape:{...defaults,orientation:'landscape',font:9,preset:'landscape'}
 };
 function roomNumber(name){
  const text=String(name||'').trim();
  const match=text.match(/^(?:каб(?:инет)?\.?\s*№?\s*|№\s*)?(\d+[а-яa-z]?(?:[-/]\d+[а-яa-z]?)?)(?=\s|[.(]|$)/i);
  return match?match[1]:'—';
 }
 function preferences(value){
  const p={...defaults},v=value||{};
  p.orientation=v.orientation==='landscape'?'landscape':'portrait';
  p.layout=v.layout==='sections'?'sections':'sheet';
  p.scope=v.scope==='selected'?'selected':'all';
  p.view=v.view==='teachers'?'teachers':'classes';
  p.preset=['portrait','sections','landscape'].includes(v.preset)?v.preset:'custom';
  for(const k of ['fit','subject','room','teacher','group','className','banding','abbreviate'])if(typeof v[k]==='boolean')p[k]=v[k];
  for(const [k,min,max] of [['margin',3,20],['font',9,14]])if(Number.isFinite(Number(v[k])))p[k]=Math.max(min,Math.min(max,Number(v[k])));
  if(!p.subject&&!p.room&&!p.teacher&&!p.group&&!(p.view==='teachers'&&p.className))p.subject=true;
  return p;
 }
 function groupLabel(name){
  return String(name||'').replace(/Социально[- ]гуманитарный/gi,'СГ').replace(/Химико[- ]биологический/gi,'ХБ')
   .replace(/Физико[- ]математический/gi,'ФМ').replace(/(?:первая|1[- ]?я)\s*подгруппа/gi,'1')
   .replace(/(?:вторая|2[- ]?я)\s*подгруппа/gi,'2').replace(/подгруппа\s*/gi,'гр. ')
   .replace(/Углубленн[ыё]й/gi,'угл.').replace(/Базовый/gi,'баз.');
 }
 const dateLabel=date=>date.slice(8,10)+'.'+date.slice(5,7)+'.'+date.slice(2,4);
 const api={defaults,presets,roomNumber,preferences,groupLabel,dateLabel};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.PrintTools=api;
})(typeof globalThis!=='undefined'?globalThis:this);
