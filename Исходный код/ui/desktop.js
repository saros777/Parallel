/* Desktop UX: all data remain on this computer, not in a cloud preview. */
$('.brand small').textContent='ВЕРСИЯ 5.1 · ДИСПЕТЧЕР';
titles.data=['База и резервные копии','Автосохранение на вашем компьютере'];
$('footer').innerHTML='<span>Параллель 5.1 · На вашем компьютере · Без подключения к ВШ</span><button id="exit-application">Сохранить и выйти</button>';
const desktopStatus=renderStatus;
renderStatus=function(){
 desktopStatus();
 if(connected&&!saving&&!dirty&&!saveError)$('#save-state').textContent='На диске · '+lastSaved;
 if(loading)$('#import-notice').innerHTML='Открываю сохраненное расписание на этом компьютере.';
};
$('#exit-application').onclick=async()=>{
 if(saving){message('Дождитесь окончания сохранения и нажмите еще раз.');return}
 if(dirty)await persist();
 if(saveError||dirty){message('Выход отменен: изменения еще не записаны на диск. '+saveError);return}
 dialog('Закрыть приложение','<p>Сохраненные изменения останутся на компьютере. Для следующего запуска дважды щелкните Параллель.exe.</p>',[{text:'Остаться',action:()=>$('#dialog').close()},{text:'Закрыть программу',class:'primary',action:async()=>{
  try{
   const r=await fetch('/api/shutdown',{method:'POST'});if(!r.ok)throw Error('Не удалось закрыть приложение');
   $('#dialog').close();
   $('body').innerHTML='<main style="max-width:640px;margin:90px auto;padding:30px"><h1>Приложение закрыто</h1><p>Все изменения сохранены на вашем компьютере. Эту вкладку можно закрыть.</p><p>Для следующего запуска откройте Параллель.exe.</p></main>';
  }catch(e){message(e.message)}
 }}]);
};
renderData=function(){
 $('#view').innerHTML=`<div class="panel"><h2>Приложение работает на вашем компьютере</h2><p>${db.classes.length} классов · ${db.teachers.length} учителя · ${db.lessons.length.toLocaleString('ru-RU')} исходных уроков. Расписание уже входит в программу.</p><p>Ничего устанавливать или импортировать для начала работы не нужно. Интернет не требуется. Данные не отправляются в ВШ или на внешний сервер.</p></div><div class="panel"><h2>Сохранение и резервные копии</h2><p>После изменения дождитесь надписи «На диске» вверху. При следующем запуске Параллель.exe программа откроет вашу последнюю сохраненную базу, а не первоначальное расписание.</p><p>Рабочая база: <strong id="desktop-data-dir">загрузка…</strong>. Программа сохраняет предыдущие 20 версий в папке backups.</p><button id="desktop-folder">Открыть папку данных</button> <button id="desktop-backup" class="primary">Скачать резервную копию</button> <button id="desktop-import">Восстановить из JSON</button> <button id="appearance">Светлая / темная тема</button><p class="hint">Рабочая база не лежит внутри EXE. Перемещение или замена файла программы не удаляет сохраненные изменения. Для переноса на другой компьютер скачайте резервную копию и импортируйте ее там.</p></div><div class="panel"><h2>Как пользоваться</h2><ol class="help-list"><li>Классы идут строками, понедельник–пятница слева направо. Переключайте основное расписание и недели; кликните по уроку, затем по месту назначения.</li><li>Добавьте отсутствие учителя, даты и номера уроков. На экране замен выберите затронутое занятие и преподавателя справа.</li><li>Если замены нет, отмените урок или все нерешенные занятия учителя за выбранный день.</li><li>«Пересчитать день» предложит замены и переносы в окна. Посмотрите «было / будет» и подтвердите.</li><li>Ошибочные операции отменяйте через историю. Автосохранение записывает и отмену операции.</li><li>Для завершения нажмите «Сохранить и выйти» внизу. Закрытие только вкладки оставляет программу работающей в фоне.</li></ol></div><div class="panel"><h2>Что входит в исходный код</h2><p>В архиве поставки есть папка «Исходный код»: интерфейс, правила замен, локальный сервер на Go, встроенное начальное расписание, тесты и команды сборки. Для запуска готового EXE исходный код и Go не нужны.</p><p>Это самостоятельная программа, не продукт aSc. Пересчет ограничен выбранным днем и не является полным годовым генератором. Учет отсутствий не заменяет кадровый табель и расчет оплаты.</p></div>`;
 $('#desktop-backup').onclick=save;$('#desktop-import').onclick=()=>$('#file').click();
 $('#desktop-folder').onclick=async()=>{
  try{const r=await fetch('/api/open-folder',{method:'POST'});if(!r.ok)throw Error('Не удалось открыть папку');}
  catch(e){message(e.message)}
 };
 $('#appearance').onclick=()=>{theme=theme==='dark'?'light':'dark';document.documentElement.dataset.theme=theme};
 fetch('/api/info').then(r=>r.json()).then(x=>{if($('#desktop-data-dir'))$('#desktop-data-dir').textContent=x.dataDir}).catch(()=>{if($('#desktop-data-dir'))$('#desktop-data-dir').textContent='%LOCALAPPDATA%\\ParallelSchool'});
};
// Backups written by the server use an envelope; accept those as well as exports.
const normalizePlain=normalize;
normalize=function(data){return normalizePlain(data?.state?.meta?data.state:data)};
const nativeDesktopRender=render;
render=function(){nativeDesktopRender();if($('#page-description')&&route==='data')$('#page-description').textContent='Автосохранение на вашем компьютере · Резервные копии · Исходный код'};
