/* Offline, editable DOCX export. The docx library is bundled beside this file. */
(function(root){
  function build({school,date,groups,rows,prefs,subject,teacher,className,room,groupLabel,profileLines}){
  const D=root.docx,mm=n=>Math.round(n*1440/25.4),land=prefs.orientation==='landscape';
  const horizontalMargin=Math.min(20,prefs.margin+3),max=Math.max(8,...rows.map(l=>l.slot)),width=mm((land?297:210)-2*horizontalMargin);
  const first=mm(prefs.view==='teachers'?31:9),widths=[first,...Array(max).fill(Math.floor((width-first)/max))];widths[widths.length-1]+=width-widths.reduce((a,b)=>a+b,0);
  const font=Math.max(9,prefs.font),border={style:D.BorderStyle.SINGLE,size:4,color:'89939E'};
  const para=(text,opts={})=>new D.Paragraph({spacing:{before:0,after:0,line:240,lineRule:D.LineRuleType.AUTO},...opts,children:[new D.TextRun({text:String(text||''),size:font*2,...(opts.bold?{bold:true}:{})})]});
  const lessonPara=(left,right,cellWidth,opts={})=>new D.Paragraph({spacing:{before:0,after:0,line:240,lineRule:D.LineRuleType.AUTO},...opts,tabStops:right?[{type:D.TabStopType.RIGHT,position:Math.max(120,cellWidth-90)}]:undefined,children:[new D.TextRun({text:String(left||''),size:font*2}),...(right?[new D.TextRun({text:'\t'+right,size:font*2,bold:true})]:[])]});
  let band=false;
  const cell=(text,i,head=false)=>new D.TableCell({width:{size:widths[i],type:D.WidthType.DXA},verticalAlign:D.VerticalAlign.CENTER,shading:band?{fill:'F0F3F5'}:head?{fill:'EFF2F5'}:undefined,children:Array.isArray(text)?text:[para(text,{bold:head})]});
  const sections=groups.map(g=>{
   band=false;
   const head=new D.TableRow({tableHeader:true,cantSplit:true,children:[cell(prefs.view==='teachers'?'Учитель':'Кл.',0,true),...Array.from({length:max},(_,i)=>cell(String(i+1),i+1,true))]});
   const data=g.classes.map((c,index)=>{band=prefs.banding&&(prefs.view==='teachers'?index%2===1:parseInt(c.name)%2===0);return new D.TableRow({cantSplit:true,children:[cell(c.name,0,true),...Array.from({length:max},(_,i)=>{
    const lessons=rows.filter(l=>l[prefs.view==='teachers'?'teacherId':'classId']===c.id&&l.slot===i+1&&!l.cancelled&&!l.parked);
    const paragraphs=profileLines(lessons,c.id).flatMap((entry,j)=>{
     const l=entry.lesson;if(!l)return [para(' ',{spacing:{before:j?25:0,after:0,line:240,lineRule:D.LineRuleType.AUTO},border:j?{top:{...border,color:'C7CDD4'}}:undefined})];
     const parts=[prefs.subject?subject(l,prefs.abbreviate):'',prefs.view==='teachers'&&prefs.className?className(l):''].filter(Boolean),roomText=prefs.room?room(l):'';
     const out=[lessonPara(parts.join('  '),roomText,widths[i+1],{spacing:{before:j?25:0,after:0,line:240,lineRule:D.LineRuleType.AUTO},border:j?{top:{...border,color:'C7CDD4'}}:undefined})];
     if(prefs.teacher&&prefs.view!=='teachers')out.push(para(teacher(l)));
     if(prefs.group&&l.groupName&&!l.profileAudience?.length)out.push(para(groupLabel(l.groupName)));
     for(let continuation=1;continuation<(entry.span||1);continuation++)out.push(para(' '));
     return out;
    });
    return cell(paragraphs.length?paragraphs:[para('·')],i+1);
   })]})});
   return {properties:{page:{size:{width:11906,height:16838,orientation:land?D.PageOrientation.LANDSCAPE:D.PageOrientation.PORTRAIT},margin:{top:mm(prefs.margin),right:mm(horizontalMargin),bottom:mm(prefs.margin),left:mm(horizontalMargin),header:0,footer:0}}},children:[
    new D.Paragraph({spacing:{after:60},children:[new D.TextRun({text:'Расписание '+root.PrintTools.dateLabel(date),bold:true,size:26})]}),
    new D.Table({width:{size:width,type:D.WidthType.DXA},columnWidths:widths,layout:D.TableLayoutType.FIXED,borders:{top:border,bottom:border,left:border,right:border,insideHorizontal:border,insideVertical:border},margins:{top:20,bottom:20,left:35,right:35},rows:[head,...data]})
   ]};
  });
  return new D.Document({creator:'Параллель '+(window.DESKTOP?.version||'5.4.8'),title:'Расписание '+date,description:'Редактируемая таблица расписания',styles:{default:{document:{run:{font:'Calibri',size:font*2},paragraph:{spacing:{before:0,after:0}}}}},sections});
 }
 root.WordExport={build};
 if(typeof module!=='undefined')module.exports=root.WordExport;
})(globalThis);
