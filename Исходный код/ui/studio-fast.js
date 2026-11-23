/* Reuse existing cells and resolve a target day once, rather than the whole year. */
let studioPaintShape=null,studioFitFrame=0,studioConflictKeys=new Set();
const studioTextCache=new Map(),studioMeasureCanvas=document.createElement('canvas'),studioMeasureContext=studioMeasureCanvas.getContext('2d');
function studioTextMeasure(text){if(!studioTextCache.has(text)){if(studioMeasureContext)studioMeasureContext.font='400 100px Inter, Arial, sans-serif';studioTextCache.set(text,Math.max(.5,studioMeasureContext?studioMeasureContext.measureText(text).width/100:[...text].length*.65).toFixed(3))}return studioTextCache.get(text)}
const studioFitImmediate=studioFit;
studioFit=function(){if(!studioFitFrame)studioFitFrame=requestAnimationFrame(()=>{
 studioFitFrame=0;if(!CSS.supports('container-type','size')){studioFitImmediate();return}
 const workspace=$('#studio-workspace'),grid=$('.studio-grid');if(!workspace||!grid)return;
 workspace.style.setProperty('--side-width',studioSide+'px');workspace.style.setProperty('--bottom-height',studioBottom+'px');
 const width=grid.clientWidth,height=grid.clientHeight,n=Math.max(20,studioEntities.length),rowType=studioAxis==='general'?'classes':studioAxis,weight=Math.max(20,studioEntities.reduce((sum,e)=>sum+studioRowFactor(e,rowType),0)),entity=studioAxis==='teachers'?110:44,columns=studioSlots*Math.max(1,studioDates.length),stamp=[width,height,n,weight,entity,columns,studioDates.length].join('|');if(workspace.__fitStamp===stamp)return;workspace.__fitStamp=stamp;
 const footer=['teachers','rooms'].includes(studioAxis)?30:0,row=Math.max(1,(height-36-footer-n)/weight),available=Math.max(1,(width-entity)/columns),cell=studioDates.length===1?Math.min(78,available):available;
 workspace.style.setProperty('--rows',n);workspace.style.setProperty('--row-tracks',studioEntities.map(e=>`minmax(0,${studioRowFactor(e,rowType)}fr)`).join(' '));workspace.style.setProperty('--slots',studioSlots);workspace.style.setProperty('--columns',columns);workspace.style.setProperty('--footer-height',footer+'px');workspace.style.setProperty('--entity-width',entity+'px');workspace.style.setProperty('--row-height',row+'px');workspace.style.setProperty('--card-width',cell+'px');workspace.style.setProperty('--card-height',Math.min(24,row)+'px');workspace.style.setProperty('--card-font',Math.max(6,Math.min(16,row*.8,cell/2.3))+'px');workspace.style.setProperty('--matrix-width',studioDates.length===1?(entity+columns*cell)+'px':'100%');workspace.style.setProperty('--column-track',cell+'px');
 $$('.studio-matrix tbody tr').forEach((tr,i)=>tr.style.setProperty('--entity-row-height',row*studioRowFactor(studioEntities[i],rowType)+'px'));
})};
function studioShape(){return JSON.stringify([studioPeriod,studioAxis,studioDates,studioSlots,studioEntities.map(e=>e.id)])}
function studioCanReuseView(){const reuse=!!$('#studio-workspace')&&!!$('#studio-undo')&&!!$('#studio-redo')&&studioPaintShape===studioShape();if(!reuse)studioPaintShape=null;return reuse}
function studioCellView(paint,td){return studioVisualCell(paint.index.get([td.dataset.entity,td.dataset.date,td.dataset.slot].join('|'))||[],td.dataset.entity,paint.problemIds)}
function studioCellHTML(paint,td){return studioCellView(paint,td).html}
function studioRememberCells(paint){
 studioConflictKeys=new Set(paint.problems.map(i=>i.kind+'|'+i.lessonIds.slice().sort().join('|')));
 studioPaintShape=studioShape();$$('[data-entity]').forEach(td=>{const view=studioCellView(paint,td);td.__studioHTML=view.html;td.__studioParts=view.parts});
 for(const [area,rows]of [['side',paint.side],['bottom',paint.bottom]])$('#studio-'+area).__studioHTML=studioTray(area,rows);
}
function studioUpdateExisting(paint){
 if(!$('#studio-workspace')||studioPaintShape!==studioShape())return false;
 studioConflictKeys=new Set(paint.problems.map(i=>i.kind+'|'+i.lessonIds.slice().sort().join('|')));
 $$('[data-entity]').forEach(td=>{const view=studioCellView(paint,td);if(td.__studioHTML!==view.html||td.__studioParts!==view.parts){const stack=td.querySelector('.studio-stack');stack.innerHTML=view.html;stack.style.setProperty('--parts',view.parts);td.__studioHTML=view.html;td.__studioParts=view.parts}});
 for(const [area,rows]of [['side',paint.side],['bottom',paint.bottom]]){const el=$('#studio-'+area),html=studioTray(area,rows);if(el.__studioHTML!==html){el.innerHTML=html;el.__studioHTML=html}}
 $$('.studio-matrix tfoot td').forEach((td,i)=>{const d=studioDates[Math.floor(i/studioSlots)],slot=i%studioSlots+1,free=studioFreeRooms(paint.roomRows||paint.rows,d,slot);td.textContent=free.text;td.title=free.title});
 $('#studio-undo').disabled=!db.history.length;$('#studio-redo').disabled=!studioRedo.length;
 if($('#date'))$('#date').value=date;
 studioBindTrayFilters();
 bindCards();studioFit();return true;
}
const studioTakeIndexed=studioTake;
studioTake=function(id){
 studioTakeIndexed(id);if(!studioPick)return;
 studioPick.source=new Map(studioRows.map(l=>[l.id,l]));studioPick.byDay=new Map();
 for(const l of studioRows){if(!studioPick.byDay.has(l.date))studioPick.byDay.set(l.date,[]);studioPick.byDay.get(l.date).push(l)}
 studioPick.existing=studioConflictKeys;
};
// Keep the incremental renderer, but use the exact same placement preview as
// the click handler.  A second, approximate conflict calculation here caused
// green cells to reject drops (and occupied cells to be marked red).
const studioAvailabilityChecked=studioAvailability;
studioAvailability=function(td){return studioAvailabilityChecked(td)};
