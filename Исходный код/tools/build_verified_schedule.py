#!/usr/bin/env python3
"""Build the recurring base timetable from the user-verified XLSX workbook."""
import argparse, collections, datetime, json, re
from openpyxl import load_workbook

DAYS={'Понедельник':0,'Вторник':1,'Среда':2,'Четверг':3,'Пятница':4}
BASE=datetime.date(2026,9,7)
PROFILES={'соцгум':'social','химбио':'chemical','физмат':'physical'}

def norm(value):
    return re.sub(r'[^a-zа-я0-9]+',' ',str(value or '').lower().replace('ё','е')).strip()

def subject_code(value):
    value=str(value or '').strip(); code=value.split(' · ')[0].strip()
    return {'Эк':'ЭК','эк':'ЭК'}.get(code,code)

def old_code(name):
    n=norm(name)
    rules=[
      ('разговоры о важном','РОВ'),('русский язык','р/я'),('английск|иностранный язык','а/я'),('математика','м'),
      ('литературное чтение','лч'),('^literature$|^литература$','л'),('изобразительное','ИЗО'),('^музыка$','муз'),('физическая культура','ФК'),
      ('окружающий мир','ом'),('^география$','геог'),('^биология$','б'),('^физика$','ф'),('^химия$','х'),('^история','и'),('^обществознание$','о'),
      ('^геометрия$','Г'),('^алгебра','А'),('вероятность и статистика','ВиС'),('безопасности и защиты родины','ОБЗР'),
      ('труд технология|^технология$','Т'),('информатика','ИКТ'),('алгоритм|программирован','ВДА'),('индивидуальный учебный','ИУП'),
      ('мои горизонты','Р-мг'),('актуальные вопросы истории','АВИ'),('^черчение$','Чер'),('религиозных культур','ОРКС'),('педагогический имидж','П-И'),
      ('подготовка к огэ','ЭК'),('^биохимия$','БиХ'),('основы фармакологии','ОФ'),('основы психологии','ОПс'),('основы педагогики','пед')]
    for pattern,code in rules:
        if re.search(pattern,n): return code
    return None

def semantic(text):
    n=norm(text)
    if 'дев' in n:return 'female'
    if 'мал' in n or 'юнош' in n:return 'male'
    if 'гр 1' in n or 'перв' in n:return 'group1'
    if 'гр 2' in n or 'втор' in n:return 'group2'
    for name,key in PROFILES.items():
        if name in n:return key
    return ''

def short_signature(full):
    bits=norm(full).split();return (bits[0],)+(tuple(x[0] for x in bits[1:3]))

def main():
    ap=argparse.ArgumentParser();ap.add_argument('xlsx');ap.add_argument('input');ap.add_argument('output');args=ap.parse_args()
    db=json.load(open(args.input,encoding='utf-8'));book=load_workbook(args.xlsx,data_only=True,read_only=False)
    classes={norm(c['name']):c for c in db['classes']};subjects={s['id']:s for s in db['subjects']};teachers={t['id']:t for t in db['teachers']}
    def resolve_teacher(value):
        signature=short_signature(value);surname,initials=signature[0],signature[1:]
        if surname=='злобин' and initials==('т','в'):surname='зюбан'
        candidates=[]
        for t in db['teachers']:
            full=short_signature(t['name'])
            if full[0]==surname and full[1:1+len(initials)]==initials:candidates.append(t['id'])
        return candidates[0] if len(candidates)==1 else None
    subject_codes={sid:old_code(s['name']) for sid,s in subjects.items()}
    historical=collections.defaultdict(list)
    for l in db['lessons']:
        cl=next((c for c in db['classes'] if c['id']==l['classId']),None);code=subject_codes.get(l['subjectId'])
        if cl and code:
            historical[(cl['id'],code)].append(l)
    snap=book['Учителя — снимок'];snapshot=collections.defaultdict(list)
    for d in range(5):
      for slot in range(1,10):
        col=2+d*9+slot-1
        for row in range(4,snap.max_row+1):
          value=str(snap.cell(row,col).value or '')
          tid=resolve_teacher(str(snap.cell(row,1).value or ''))
          if not tid:continue
          for class_name in re.split(r'[\n,]+',value):
            c=classes.get(norm(class_name))
            if c:snapshot[(d,slot,c['id'])].append(tid)
    records=collections.defaultdict(list);sheet=book['Группы — записи']
    for row in sheet.iter_rows(min_row=2,values_only=True):
        day,slot,class_name,lane,subject,kind,color,confirmed=row;c=classes.get(norm(class_name))
        if not c or day not in DAYS or not subject:continue
        code=subject_code(subject);key=(DAYS[day],int(slot),c['id'],code,str(color or ''),str(kind or ''))
        records[key].append({'lane':str(lane or ''),'subject':str(subject),'confirmed':str(confirmed or '')})
    pending=[]
    for (day,slot,class_id,code,color,kind),members in sorted(records.items()):
        class_row=next(c for c in db['classes'] if c['id']==class_id);profile_values=[PROFILES[norm(m['lane'])] for m in members if norm(m['lane']) in PROFILES]
        split='\u0440\u0430\u0437\u0434\u0435\u043b' in norm(kind)
        sem=semantic(' '.join(m['subject']+' '+m['lane'] for m in members)) if split and not profile_values else ''
        audience=list(dict.fromkeys(profile_values));all_profiles=['social','chemical']+(['physical'] if norm(class_row['name'])=='11' else [])
        if audience and len(audience)==len(all_profiles):audience=[]
        old=historical.get((class_id,code),[])
        if sem:
            matched=[l for l in old if semantic(l.get('groupName'))==sem]
            if matched:old=matched
        subject_id=collections.Counter(l['subjectId'] for l in old).most_common(1)[0][0] if old else next((sid for sid,s in subjects.items() if (s.get('abbreviation') or '')==code),None)
        if not subject_id:raise ValueError(f'Не найден предмет {code}: {class_row["name"]}')
        explicit=next((resolve_teacher(m['confirmed']) for m in members if m['confirmed']),None)
        pending.append({'day':day,'slot':slot,'classId':class_id,'subjectId':subject_id,'code':code,'semantic':sem,'audience':audience,'explicit':explicit,'kind':kind,'color':color,'old':old})
    lessons=[];groups={};courses={};used_by_time=collections.defaultdict(set);indexes=collections.Counter()
    for item in pending:
        slot_key=(item['day'],item['slot'],item['classId']);used=used_by_time[(item['day'],item['slot'])];snap_ids=snapshot.get(slot_key,[]);index=indexes[slot_key];indexes[slot_key]+=1
        choices=collections.Counter(l.get('teacherId') for l in item['old'] if l.get('teacherId'))
        def score(tid):
          same=sum(1 for l in item['old'] if l.get('teacherId')==tid and (datetime.date.fromisoformat(l['date']).weekday()==item['day'] and l['slot']==item['slot']))
          return (100000 if tid==item['explicit'] else 0)+(10000 if tid in snap_ids else 0)+choices[tid]*20+same*50-(50000 if tid in used else 0)
        related={'БиХ':{'БиХ','б','х'},'б':{'БиХ','б'},'х':{'БиХ','х'}}.get(item['code'],{item['code']})
        qualified={x['teacherId'] for x in db.get('teacherSubjects',[]) if subject_codes.get(x.get('subjectId')) in related}
        pool=set(choices)|set(snap_ids)|qualified|({item['explicit']} if item['explicit'] else set());available=[tid for tid in pool if tid not in used];teacher_id=max(available or pool,key=score) if pool else None
        if teacher_id:used.add(teacher_id)
        group_name=None;group_id=None
        if item['semantic']:
          names={'female':'Девочки','male':'Мальчики','group1':'1-я группа','group2':'2-я группа'};group_name=names[item['semantic']]
        elif item['audience']:
          names={'social':'Соцгум','chemical':'Химбио','physical':'Физмат'};group_name=' + '.join(names[x] for x in item['audience'])
        if group_name:
          group_id='xlsx-group-'+item['classId']+'-'+item['subjectId']+'-'+('-'.join(item['audience']) or item['semantic'])
          groups[group_id]={'id':group_id,'classId':item['classId'],'subjectId':item['subjectId'],'name':group_name,'shortName':group_name,'level':'Профиль' if item['audience'] else 'Базовый'}
        course_key=(teacher_id,item['classId'],item['subjectId'],group_id,tuple(item['audience']))
        course_id='xlsx-course-'+str(len(courses)+1) if course_key not in courses else courses[course_key]['id']
        courses.setdefault(course_key,{'id':course_id,'teacherId':teacher_id,'classId':item['classId'],'subjectId':item['subjectId'],'groupId':group_id,'groupName':group_name,'weeklyHours':0,'weeklyCount':0,'length':1})
        courses[course_key]['weeklyHours']+=1;courses[course_key]['weeklyCount']+=1
        date=(BASE+datetime.timedelta(days=item['day'])).isoformat();old_sample=item['old'][0] if item['old'] else {}
        lesson={'id':f'xlsx-{item["classId"]}-{item["day"]}-{item["slot"]}-{index}','classId':item['classId'],'subjectId':item['subjectId'],'teacherId':teacher_id,'courseId':course_id,'groupId':group_id,'groupName':group_name,'date':date,'slot':item['slot'],'time':old_sample.get('time',''),'callId':old_sample.get('callId'),'roomId':None,'roomMode':'auto','parked':False,'source':'raspisanie_s_podgruppami_utochnennoe.xlsx'}
        if item['audience']:lesson['profileAudience']=item['audience']
        lessons.append(lesson)
    # The workbook contains two teacher double-bookings whose missing assignment
    # cannot be inferred safely. Keep every card, but put all four into the
    # unplaced tray for explicit correction by the deputy head.
    by_teacher_time=collections.defaultdict(list)
    for lesson in lessons:by_teacher_time[(lesson['date'],lesson['slot'],lesson['teacherId'])].append(lesson)
    for same_time in by_teacher_time.values():
      if len(same_time)<2:continue
      shared=len({x['classId'] for x in same_time})==1 and len({x['subjectId'] for x in same_time})==1
      if shared:continue
      for lesson in same_time:
        lesson['parked']=True;lesson['parkingArea']='bottom';lesson['placementIssue']='Несоответствие учителя в исходном Excel — требуется ручное назначение'
    if any(not l['teacherId'] for l in lessons):raise ValueError(f'Без учителя: {sum(not l["teacherId"] for l in lessons)}')
    db['lessons']=[];db['baseSchedule']={'week':BASE.isoformat(),'lessons':lessons};db['courses']=list(courses.values());db['groups']=list(groups.values());db['teacherSubjects']=[{'teacherId':t,'subjectId':s} for t,s in sorted(set((l['teacherId'],l['subjectId']) for l in lessons))]
    db['overrides']={};db['extraLessons']=[];db['absences']=[];db['history']=[]
    db['preferences']={**db.get('preferences',{}),'studioSuspensions':True};db['meta']['scheduleBaselineRevision']=1;db['meta']['scheduleSource']='raspisanie_s_podgruppami_utochnennoe.xlsx';db['meta']['scheduleSourceDate']='2026-11-16'
    db['meta']['lessonMinDate']=BASE.isoformat();db['meta']['lessonMaxDate']=(BASE+datetime.timedelta(days=4)).isoformat()
    db['meta']['counts']={**db['meta'].get('counts',{}),'classes':len(db['classes']),'teachers':len(db['teachers']),'subjects':len(db['subjects']),'rooms':len(db['rooms']),'lessons':len(lessons),'courses':len(db['courses']),'groups':len(db['groups']),'teacherSubjects':len(db['teacherSubjects']),'issues':0}
    json.dump(db,open(args.output,'w',encoding='utf-8'),ensure_ascii=False,separators=(',',':'))
    print(json.dumps({'lessons':len(lessons),'courses':len(courses),'groups':len(groups),'classes':len(set(l['classId'] for l in lessons))},ensure_ascii=False))

if __name__=='__main__':main()
