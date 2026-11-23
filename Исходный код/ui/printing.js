/* Explicit print presets and offline PDF with physical A4 page dimensions. */
showPrint=function(initialView){
 let prefs=PrintTools.preferences(settings.printLayout?.schema===2?settings.printLayout:PrintTools.defaults),drawTimer,allFit=false;
 if(initialView==='teachers'||initialView==='classes')prefs.view=initialView;
 const native=window.DESKTOP?.native?window.go?.main?.DesktopBridge:null;
 let exportDirectory=native?(window.localStorage?.getItem('parallel.exportDirectory')||''):'';
 const exportFolderControls=native?`<fieldset class="print-fields print-export-folder"><legend>Сохранение файлов</legend><label class="field">Папка по умолчанию<input id="print-export-directory" type="text" readonly value="${h(exportDirectory)}" placeholder="Не выбрана — Windows предложит последнюю папку"></label><div><button type="button" id="print-export-choose">Выбрать папку…</button><button type="button" id="print-export-reset" ${exportDirectory?'':'disabled'}>Сбросить</button></div><small>PDF, Word и экспортируемые таблицы открывают «Сохранить как» в этой папке.</small></fieldset>`:'';
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow'}).format(new Date()),screenClasses=selected();let printDate=today,dayRows=[],resetPreviewScroll=false;
 // For a day currently shown in the weekly editor, print the exact resolved
 // rows on screen. This preserves every unsaved move/removal and, critically,
 // the room numbers already assigned to those cards. Other dates are expanded
 // from the same in-memory project without requiring a save.
 const loadDay=()=>{const visibleWeek=route==='schedule'&&studioPeriod==='weeks'&&studioDates.includes(printDate),source=visibleWeek?studioRows.filter(l=>l.date===printDate):E.effectiveBetween(db,printDate,printDate);dayRows=E.sortProfileRows(source.filter(l=>!l.cancelled&&!l.parked&&!l.suspended).map(l=>({...l,profileAudience:E.profileAudience(l,db)})),db)};loadDay();
 let classes=[],rows=[],pageGroups=[];
 const printParts=(lessons,className)=>PrintTools.slotParts(lessons.map(l=>({...l,profileAudience:E.profileAudience(l,db)})),className);
 const checked=k=>prefs[k]?'checked':'';
 dialog('Печать A4 · версия 5.4.18',`<div class="print-presets">
 <button data-print-preset="portrait"><strong>1. Книжный · 1 лист</strong><span>Все классы · предмет + номер</span></button>
 <button data-print-preset="sections"><strong>2. Книжный · крупнее</strong><span>По ступеням · до 3 листов</span></button>
 <button data-print-preset="landscape"><strong>3. Альбомный · 1 лист</strong><span>Дополнительный компактный вариант</span></button>
 </div><div class="print-workbench"><div class="print-options">
 <p class="print-selection" id="print-selection"></p><label class="field">Дата расписания<input id="print-date" type="date" value="${printDate}"></label>
 <label class="field">Строки расписания<select id="print-view"><option value="classes">Классы</option><option value="teachers">Учителя</option></select></label>
 <label class="field">Какие классы<select id="print-scope"><option value="all">Все классы школы</option><option value="selected">Только выбранные на экране</option></select></label>
 <label class="field">Лист A4<select id="paper-orientation"><option value="portrait">Книжная (вертикально)</option><option value="landscape">Альбомная</option></select></label>
 <div class="form-grid"><label class="field">Поля, мм<input id="paper-margin" type="number" min="3" max="20" step="1" value="${prefs.margin}"></label><label class="field">Шрифт, пт<input id="paper-font" type="number" min="9" max="14" step="0.5" value="${prefs.font}"></label></div>${exportFolderControls}
 <label class="checkbox-line"><input id="paper-fit" type="checkbox" ${checked('fit')}>Уместить в выбранный макет</label>
 <fieldset class="print-fields"><legend>Содержимое ячейки</legend>${[['subject','Предмет'],['className','Класс (в печати по учителям)'],['room','Номер кабинета без названия'],['teacher','Учитель (в печати по классам)'],['group','Подгруппа / профиль'],['abbreviate','Сокращения предметов'],['banding','Лёгкая заливка параллелей / строк']].map(([k,v])=>`<label class="checkbox-line"><input type="checkbox" data-print-field="${k}" ${checked(k)}>${v}</label>`).join('')}</fieldset>
 <button id="paper-reset">Сброс: книжный, все классы</button>
 <p id="print-fit-status" role="status"></p><p class="hint">«Сохранить PDF A4» и «Сохранить Word» открывают системное окно Windows для выбора папки и имени файла. Для обычной печати: A4, масштаб 100%, колонтитулы выключены. Номер не назначен: «—».</p>
 </div><div class="print-preview-wrap"><div class="print-preview-label">Так будет выглядеть печать · номер справа, без названия кабинета</div><div class="print-preview-scroll"><div id="paper-preview"></div></div></div></div>`,[
 {text:'Сохранить настройки',action:()=>{readControls();store();$('#dialog').close()}},
 {text:'Печать',action:()=>{
  readControls();draw();if(!classes.length||!allFit)return;store();
  $('#print-root').innerHTML=$('#paper-preview').innerHTML;
  let style=$('#schedule-page-style');if(!style){style=document.createElement('style');style.id='schedule-page-style';document.head.append(style)}
  style.textContent=`@page parallel-schedule{size:A4 ${prefs.orientation};margin:${prefs.margin}mm} @media print{.print-compact-sheet{page:parallel-schedule}}`;
  $('#dialog').close();window.print();
 }},
 {text:'Сохранить PDF A4',class:'primary',action:async()=>{
  readControls();draw();if(!classes.length||!allFit)return;
  const buttons=$$('.print-dialog button,.print-dialog input,.print-dialog select');buttons.forEach(x=>x.disabled=true);
  let capture;
  try{
   await document.fonts.ready;
   $('#print-fit-status').textContent='Готовлю PDF с фиксированным размером A4…';
   const doc=new jspdf.jsPDF({orientation:prefs.orientation,unit:'mm',format:'a4',compress:true});
   doc.setProperties({title:'Расписание '+printDate,creator:'Параллель 5.4.18'});
   const width=(prefs.orientation==='portrait'?210:297)-prefs.margin*2;
   const sheets=$$('#paper-preview .print-compact-sheet');
   for(let i=0;i<sheets.length;i++){
    capture=document.createElement('div');capture.className='pdf-capture';capture.append(sheets[i].cloneNode(true));document.body.append(capture);
    const canvas=await html2canvas(capture.firstElementChild,{scale:3,backgroundColor:'#ffffff',logging:false,windowWidth:1400,windowHeight:1800});
    if(i)doc.addPage('a4',prefs.orientation);
    doc.addImage(canvas,'PNG',prefs.margin,prefs.margin,width,canvas.height*width/canvas.width,undefined,'FAST');
    capture.remove();capture=null;
   }
   const saved=await download(`Расписание_${printDate}_A4_${prefs.orientation}_${sheets.length}л.pdf`,doc.output('blob'),'application/pdf');
   if(saved===false)$('#print-fit-status').textContent='Сохранение PDF отменено.';
   else{store();draw();$('#print-fit-status').textContent+=' · PDF сохранён'}
  }catch(e){$('#print-fit-status').textContent='Не удалось создать PDF: '+e.message}
  finally{capture?.remove();buttons.forEach(x=>x.disabled=false);if(!classes.length||!allFit){$('#dialog-action-1').disabled=true;$('#dialog-action-2').disabled=true}}
 }},
 {text:'Сохранить Word',class:'primary',action:async()=>{
  readControls();draw();if(!classes.length)return;
  const button=$('#dialog-action-3');button.disabled=true;button.textContent='Готовлю Word…';
  try{
   const doc=WordExport.build({school:db.meta.school,date:printDate,groups:pageGroups,rows,prefs,subject:displaySubject,teacher:l=>short(teacherName(l.teacherId)),className:l=>lookup('classes',l.classId)?.name||'',room:l=>PrintTools.roomNumber(l.roomId?roomName(l.roomId):''),groupLabel:PrintTools.groupLabel,profileLines:(ls,cid)=>prefs.view==='teachers'?ls.map((lesson,start)=>({lesson,lane:null,lanes:Math.max(1,ls.length),start,span:1})):printParts(ls,lookup('classes',cid)?.name)});
   const blob=await docx.Packer.toBlob(doc);
   const saved=await download(`Расписание_${printDate}_A4_${prefs.orientation}.docx`,blob,'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
   if(saved===false)$('#print-fit-status').textContent='Сохранение Word отменено.';
   else{store();$('#print-fit-status').textContent='Word сохранён: редактируемая таблица. Разбиение страниц может отличаться от PDF; проверьте перед печатью.'}
  }catch(e){$('#print-fit-status').textContent='Не удалось создать Word: '+e.message}
  finally{button.disabled=false;button.textContent='Сохранить Word'}
 }}]);
 $('#dialog').classList.add('print-dialog');
 $('#dialog').addEventListener('close',()=>{clearTimeout(drawTimer);$('#dialog').classList.remove('print-dialog')},{once:true});
 if(native){
  const folderInput=$('#print-export-directory'),choose=$('#print-export-choose'),reset=$('#print-export-reset');
  choose.onclick=async()=>{choose.disabled=true;try{const selected=await native.ChooseExportDirectory(exportDirectory);if(selected){exportDirectory=selected;window.localStorage?.setItem('parallel.exportDirectory',selected);folderInput.value=selected;reset.disabled=false}}catch(e){message('Не удалось выбрать папку: '+(e.message||e))}finally{choose.disabled=false}};
  reset.onclick=()=>{exportDirectory='';window.localStorage?.removeItem('parallel.exportDirectory');folderInput.value='';reset.disabled=true;message('Папка экспорта сброшена. Windows предложит последнюю использованную папку.')};
 }
 function store(){settings.printLayout={...prefs};dirty=true;render()}
 function readControls(){
  if($('#print-date')?.value&&$('#print-date').value!==printDate){printDate=$('#print-date').value;resetPreviewScroll=true;loadDay()}
  prefs=PrintTools.preferences({...prefs,view:$('#print-view').value,scope:$('#print-scope').value,orientation:$('#paper-orientation').value,margin:+$('#paper-margin').value,font:+$('#paper-font').value,fit:$('#paper-fit').checked,...Object.fromEntries($$('[data-print-field]').map(x=>[x.dataset.printField,x.checked]))});
  $$('[data-print-field]').forEach(x=>x.checked=prefs[x.dataset.printField]);
 }
 function syncControls(){
  $('#print-view').value=prefs.view;$('#paper-orientation').value=prefs.orientation;$('#print-scope').value=prefs.scope;$('#paper-margin').value=prefs.margin;$('#paper-font').value=prefs.font;$('#paper-fit').checked=prefs.fit;
  $$('[data-print-field]').forEach(x=>x.checked=prefs[x.dataset.printField]);
  $$('[data-print-preset]').forEach(x=>{x.classList.toggle('active',x.dataset.printPreset===prefs.preset);x.setAttribute('aria-pressed',String(x.dataset.printPreset===prefs.preset))});
 }
 function line(entry){
  const l=entry.lesson;
  const position=`grid-row:${(entry.start??0)+1}/span ${entry.span||1}`;
  if(!l)return `<div class="print-slot-line print-slot-empty" style="${position}" aria-hidden="true">&nbsp;</div>`;
  const group=l.groupName&&!E.profileAudience(l,db).length&&!db.subjects.some(s=>s.name===l.groupName)?PrintTools.groupLabel(l.groupName):'';
  return `<div class="print-slot-line" data-print-lesson="${h(l.id)}" style="${position}"><div class="print-primary-line"><strong>${prefs.subject?h(displaySubject(l,prefs.abbreviate)):''}${prefs.view==='teachers'&&prefs.className?' '+h(lookup('classes',l.classId)?.name):''}</strong>${prefs.room?`<span class="print-room" aria-label="Кабинет ${h(PrintTools.roomNumber(l.roomId?roomName(l.roomId):''))}">${h(PrintTools.roomNumber(l.roomId?roomName(l.roomId):''))}</span>`:''}</div>${prefs.teacher&&prefs.view!=='teachers'?`<div class="print-secondary">${h(short(teacherName(l.teacherId)))}</div>`:''}${prefs.group&&group?`<div class="print-secondary">${h(group)}</div>`:''}</div>`;
 }
 function draw(){
  loadDay();
  const selectedClasses=prefs.scope==='all'?db.classes:screenClasses;
  const ids=new Set(selectedClasses.map(c=>c.id));rows=dayRows.filter(l=>ids.has(l.classId));
  classes=prefs.view==='teachers'?db.teachers.filter(t=>rows.some(l=>l.teacherId===t.id)).sort((a,b)=>a.name.localeCompare(b.name,'ru')).map(t=>({...t,name:short(t.name)})):selectedClasses;
  const max=Math.max(8,...rows.map(l=>l.slot));
  pageGroups=prefs.layout==='sections'?[
   {name:'1–4 классы',classes:classes.filter(c=>(c.grade||parseInt(c.name))<=4)},
   {name:'5–9 классы',classes:classes.filter(c=>(c.grade||parseInt(c.name))>=5&&(c.grade||parseInt(c.name))<=9)},
   {name:'10–11 классы',classes:classes.filter(c=>(c.grade||parseInt(c.name))>=10)}
  ].filter(g=>g.classes.length):[{name:'Все выбранные классы',classes}];
  if(prefs.view==='teachers'){pageGroups=[];const count=prefs.layout==='sections'?16:Math.max(1,classes.length);for(let i=0;i<classes.length;i+=count)pageGroups.push({name:'Учителя',classes:classes.slice(i,i+count)})}
  const width=(prefs.orientation==='portrait'?210:297)-prefs.margin*2,height=(prefs.orientation==='portrait'?297:210)-prefs.margin*2;
  const labelWidth=prefs.view==='teachers'?32:10,slotWidth=prefs.orientation==='portrait'?19:22,tableWidth=Math.min(width,labelWidth+max*slotWidth);
  const preview=$('#paper-preview');preview.style.width=(width+prefs.margin*2)+'mm';preview.style.padding=prefs.margin+'mm';
  const label=prefs.view==='teachers'?'учителей':'классов';
  $('#print-selection').textContent=`${PrintTools.dateLabel(printDate)} · ${classes.length} ${label} · ${prefs.orientation==='portrait'?'вертикально':'альбомно'}`;
  const cellLines=(c,slot)=>{const ls=rows.filter(l=>l[prefs.view==='teachers'?'teacherId':'classId']===c.id&&l.slot===slot);return prefs.view==='teachers'?ls.map((lesson,start)=>({lesson,lane:null,lanes:Math.max(1,ls.length),start,span:1})):printParts(ls,c.name)},cellHTML=(c,slot)=>{const lines=cellLines(c,slot);return lines.length?`<div class="print-slot-stack" style="--parts:${Math.max(1,...lines.map(x=>x.lanes||1))}">${lines.map(line).join('')}</div>`:'<span class="print-empty">·</span>'};
  preview.innerHTML=pageGroups.map(g=>{const fill=prefs.layout==='sheet'&&g.classes.length>=18,teacherView=prefs.view==='teachers';return `<section class="print-compact-sheet ${fill?'print-fill-page':''} ${teacherView?'print-teachers':'print-classes'}" style="--print-font:${prefs.font}pt;--print-label-font:${Math.min(prefs.font,8)}pt;--print-pad:${teacherView?0.25:prefs.orientation==='landscape'?0.3:0.7}mm;--slot-pad:${teacherView?0.12:prefs.orientation==='landscape'?0.15:0.45}mm;--table-width:${tableWidth}mm;--sheet-height:${height-2}mm;width:${width}mm"><header class="print-title"><h1>Расписание ${PrintTools.dateLabel(printDate)}</h1></header><table class="compact-print-table"><colgroup><col style="width:${labelWidth}mm">${Array.from({length:max},()=>'<col>').join('')}</colgroup><thead><tr><th>${teacherView?'Учитель':'Кл.'}</th>${Array.from({length:max},(_,i)=>`<th>${i+1}</th>`).join('')}</tr></thead><tbody>${g.classes.map((c,j)=>`<tr class="${prefs.banding&&(teacherView?j%2===1:parseInt(c.name)%2===0)?'print-grade-band':''}"><th scope="row">${h(c.name)}</th>${Array.from({length:max},(_,i)=>`<td>${cellHTML(c,i+1)}</td>`).join('')}</tr>`).join('')}</tbody></table></section>`}).join('');
  allFit=!!classes.length;const fonts=[];
  $$('#paper-preview .print-compact-sheet').forEach(sheet=>{
   const limit=height*96/25.4-4,used=()=>Math.max(sheet.getBoundingClientRect().height,sheet.scrollHeight),wide=()=>[...sheet.querySelectorAll('.print-primary-line strong')].some(x=>x.scrollWidth>x.clientWidth+1),labelsWide=()=>[...sheet.querySelectorAll('tbody th[scope="row"]')].some(x=>x.scrollWidth>x.clientWidth+1);let font=prefs.font,labelFont=Math.min(prefs.font,8);
   if(prefs.view==='teachers')while(labelsWide()&&labelFont>6.5){labelFont=Math.max(6.5,labelFont-.25);sheet.style.setProperty('--print-label-font',labelFont+'pt')}
   const minFont=prefs.view==='teachers'?7.5:9;
   if(prefs.fit)while((used()>limit||wide())&&font>minFont){font=Math.max(minFont,font-.25);sheet.style.setProperty('--print-font',font+'pt')}
   if(used()>limit||wide()||labelsWide())allFit=false;fonts.push(font);
  });
  if(resetPreviewScroll){$('.print-preview-scroll').scrollTop=0;$('.print-preview-scroll').scrollLeft=0;resetPreviewScroll=false}
  $('#print-fit-status').textContent=!classes.length?'Нет строк для выбранного дня и классов.':allFit?`${pageGroups.length} ${pageGroups.length===1?'лист':'листа'} A4 · ${prefs.orientation==='portrait'?'книжный':'альбомный'} · ${classes.length} ${label} · ${Math.min(...fonts)} пт`:'Не помещается без обрезки. Выберите макет 2, выключите лишние поля или уменьшите шрифт. Печать заблокирована до исправления.';
  $('#print-fit-status').classList.toggle('print-warning',!allFit);
  $('#dialog-action-1').disabled=!allFit;$('#dialog-action-2').disabled=!allFit;
 }
 $$('.print-options input,.print-options select').forEach(x=>x.oninput=()=>{prefs.preset='custom';readControls();syncControls();clearTimeout(drawTimer);drawTimer=setTimeout(draw,80)});
 $$('[data-print-preset]').forEach(b=>b.onclick=()=>{prefs={...PrintTools.presets[b.dataset.printPreset],view:prefs.view};syncControls();draw()});
 $('#paper-reset').onclick=()=>{prefs={...PrintTools.defaults};syncControls();draw()};
 syncControls();draw();document.fonts.ready.then(()=>{if($('#paper-preview'))draw()});
};
