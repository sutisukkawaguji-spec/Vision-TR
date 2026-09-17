/* Dedicated dashboard: intentionally independent from the map application. */
const dashboardConfig = window.SURVEY_CONFIG || {};
const dashboardDb = window.supabase?.createClient(dashboardConfig.supabaseUrl, dashboardConfig.supabasePublishableKey);
const dashboardState = { groupId: new URLSearchParams(location.search).get('workGroup') || '', year: 'all', graph: 'bar', fieldKey: '', search: '', filterField: '', filterValue: '' };
let dashboardUser, dashboardGroups = [], dashboardForm, dashboardRecords = [], dashboardPlots = [], dashboardPeople = [];
const dashboardExpandedRecords = new Set(), dashboardExpandedImages = new Map();
const colors = ['#10b981','#3b82f6','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#ec4899','#84cc16','#f97316','#64748b'];
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' }[char]));
const opts = field => (field?.options || []).map((item, index) => typeof item === 'object' ? { id:String(item.id), label:String(item.label ?? ''), active:item.active !== false } : { id:`legacy_${index}_${String(item).replace(/\W+/g,'_')}`, label:String(item), active:true });
const optionLabel = (field, value) => opts(field).find(item => item.id === String(value))?.label || String(value ?? '');
const fmtDate = value => value ? String(value).slice(0, 10) : '';

function setDashboardChart(type) {
  dashboardState.graph = type === 'donut' ? 'donut' : 'bar';
  render();
}
window.setDashboardChart = setDashboardChart;

async function startDashboard() {
  if (!dashboardDb) return showError('ไม่พบการตั้งค่าการเชื่อมต่อฐานข้อมูล');
  const { data:{ session } } = await dashboardDb.auth.getSession();
  if (!session) { location.replace('index.html'); return; }
  const { data: profile, error } = await dashboardDb.from('profiles').select('*').eq('id', session.user.id).single();
  if (error) return showError(error.message);
  dashboardUser = profile;
  const [groups, people, plots] = await Promise.all([
    dashboardDb.from('work_groups').select('*').eq('team_id', profile.team_id).order('created_at'),
    dashboardDb.from('profiles').select('id,display_name,email,updated_at').eq('team_id', profile.team_id),
    dashboardDb.from('base_plots').select('id,source_properties').eq('team_id', profile.team_id)
  ]);
  dashboardGroups = groups.data || []; dashboardPeople = people.data || []; dashboardPlots = plots.data || [];
  if (!dashboardState.groupId) {
    const remembered = localStorage.getItem('survey_current_cat');
    dashboardState.groupId = dashboardGroups.find(group => group.name === remembered)?.id || profile.active_work_group_id || dashboardGroups[0]?.id || '';
  }
  document.getElementById('work-group').addEventListener('change', event => { dashboardState.groupId = event.target.value; dashboardState.fieldKey = ''; loadGroup(); });
  document.getElementById('year-filter').addEventListener('change', event => { dashboardState.year = event.target.value; render(); });
  document.getElementById('group-field').addEventListener('change', event => { dashboardState.fieldKey = event.target.value; render(); });
  document.getElementById('survey-search').addEventListener('input', event => { dashboardState.search = event.target.value; renderSurveyList(); });
  document.getElementById('survey-field-filter').addEventListener('change', event => { dashboardState.filterField = event.target.value; renderSurveyList(); });
  document.getElementById('survey-value-filter').addEventListener('input', event => { dashboardState.filterValue = event.target.value; renderSurveyList(); });
  await loadGroup();
}

async function loadGroup() {
  const group = dashboardGroups.find(item => item.id === dashboardState.groupId);
  if (!group) return showError('ไม่พบกลุ่มงาน');
  document.getElementById('back-to-map').href = `index.html?workGroup=${encodeURIComponent(group.id)}`;
  const [form, records] = await Promise.all([
    dashboardDb.from('survey_forms').select('*').eq('work_group_id', group.id).maybeSingle(),
    dashboardDb.from('plot_records').select('*').eq('work_group_id', group.id)
  ]);
  dashboardForm = form.data || null; dashboardRecords = records.data || [];
  render();
}

function render() {
  const group = dashboardGroups.find(item => item.id === dashboardState.groupId);
  const groupSelect = document.getElementById('work-group');
  groupSelect.innerHTML = dashboardGroups.map(item => `<option value="${esc(item.id)}" ${item.id === dashboardState.groupId ? 'selected':''}>${esc(item.name)}</option>`).join('');
  const allFeatures = dashboardRecords.flatMap(record => (record.record_properties?.survey_features || []).map(feature => ({ ...feature, record, recorder: feature.recorded_by || record.recorded_by })));
  const years = [...new Set(allFeatures.map(feature => fmtDate(feature.recorded_at || feature.updated_at).slice(0,4)).filter(Boolean))].sort().reverse();
  document.getElementById('year-filter').innerHTML = `<option value="all">ทุกปี</option>${years.map(year => `<option value="${year}" ${dashboardState.year === year ? 'selected':''}>ปี ${year}</option>`).join('')}`;
  const features = allFeatures.filter(feature => feature.status === 'done' && (dashboardState.year === 'all' || fmtDate(feature.recorded_at || feature.updated_at).startsWith(dashboardState.year)));
  const fields = (dashboardForm?.fields || []).filter(field => field.dashboard_group === true && ['select','multiselect'].includes(field.type));
  if (!fields.some(field => field.key === dashboardState.fieldKey)) dashboardState.fieldKey = fields[0]?.key || '';
  const field = fields.find(item => item.key === dashboardState.fieldKey);
  document.getElementById('group-field').innerHTML = fields.length ? fields.map(item => `<option value="${esc(item.key)}" ${item.key === dashboardState.fieldKey ? 'selected':''}>${esc(item.label)}</option>`).join('') : '<option>ยังไม่ได้กำหนด Dropdown</option>';
  const allFormFields = dashboardForm?.fields || [];
  if (!allFormFields.some(field => field.key === dashboardState.filterField)) dashboardState.filterField = '';
  document.getElementById('survey-field-filter').innerHTML = `<option value="">ทุกช่องบันทึก</option>${allFormFields.map(field => `<option value="${esc(field.key)}" ${field.key === dashboardState.filterField ? 'selected':''}>${esc(field.label)}</option>`).join('')}`;
  const categories = new Map();
  if (field) features.forEach(feature => (Array.isArray(feature.form_data?.[field.key]) ? feature.form_data[field.key] : [feature.form_data?.[field.key]]).filter(value => value !== undefined && value !== '').forEach(value => { const label = optionLabel(field,value); categories.set(label,(categories.get(label)||0)+1); }));
  const donePlots = dashboardRecords.filter(record => record.status === 'done').length;
  const photoCount = features.reduce((sum, feature) => sum + (feature.images || []).length, 0);
  const activePeople = dashboardPeople.filter(person => person.id === dashboardUser.id ? navigator.onLine : Date.now()-new Date(person.updated_at||0).getTime()<900000).length;
  document.getElementById('summary-cards').innerHTML = card('ชื่องาน', group?.name || '-', 'text-sm') + card('จำนวนแปลง', dashboardPlots.length, '', `เสร็จ ${donePlots}`) + card('รายการสำรวจ', features.length, '', `รูปถ่าย ${photoCount}`) + card('ออนไลน์ล่าสุด', `${activePeople}/${dashboardPeople.length}`, '', 'ภายใน 15 นาที');
  document.getElementById('chart-title').textContent = field ? `กราฟผลสำรวจ: ${field.label}` : 'กราฟผลสำรวจ';
  renderChart([...categories.entries()].sort((a,b)=>b[1]-a[1]));
  renderPeople(features); renderStatus(features); renderTrend(features); renderSurveyList();
  document.getElementById('dashboard-loading').classList.add('hidden'); document.getElementById('dashboard-app').classList.remove('hidden');
}

function card(label, value, size = '', hint = '') { return `<div class="card"><p class="text-[11px] text-slate-500">${esc(label)}</p><p class="${size || 'text-2xl'} font-extrabold text-slate-800 truncate">${esc(value)}</p><p class="text-[10px] text-emerald-600">${esc(hint)}</p></div>`; }
function renderChart(items) {
  document.querySelectorAll('.chart-type').forEach(button => {
    const selected = button.dataset.chart === dashboardState.graph;
    button.className = `chart-type flex-1 rounded-lg py-2 text-sm font-bold transition ${selected ? 'bg-emerald-600 text-white shadow-sm' : 'bg-white text-slate-600 hover:bg-slate-100'}`;
    button.setAttribute('aria-pressed', String(selected));
  });
  const host = document.getElementById('main-chart'); if (!items.length) { host.innerHTML='<p class="text-center py-12 text-sm text-slate-400">ยังไม่มีผลสำรวจตามตัวกรองนี้</p>'; return; }
  const total=items.reduce((sum,[,count])=>sum+count,0), max=Math.max(...items.map(([,count])=>count));
  if (dashboardState.graph === 'donut') { let at=0; const gradient=items.map(([,count],i)=>{const start=at;at+=count/total*100;return `${colors[i%colors.length]} ${start}% ${at}%`;}).join(','); host.innerHTML=`<div class="flex flex-col sm:flex-row items-center gap-5"><div class="donut" style="background:conic-gradient(${gradient})"><div class="donut-hole"><b class="text-2xl">${total}</b><span class="text-[10px] text-slate-500">รายการ</span></div></div><div class="w-full max-h-60 overflow-y-auto">${items.map(([label,count],i)=>`<div class="flex justify-between gap-2 text-xs py-1"><span class="truncate"><i class="inline-block w-2.5 h-2.5 rounded-full mr-2" style="background:${colors[i%colors.length]}"></i>${esc(label)}</span><b>${count}</b></div>`).join('')}</div></div>`; }
  else host.innerHTML=`<div class="bar-scroll">${items.map(([label,count])=>`<div class="mb-3"><div class="flex justify-between gap-2 text-xs font-bold mb-1"><span class="truncate">${esc(label)}</span><span>${count}</span></div><div class="h-4 rounded-full bg-slate-100 overflow-hidden"><div class="h-full bg-emerald-500 rounded-full" style="width:${count/max*100}%"></div></div></div>`).join('')}</div>`;
}
function renderPeople(features) { const counts=new Map();features.forEach(feature=>counts.set(feature.recorder||'unknown',(counts.get(feature.recorder||'unknown')||0)+1)); const now=Date.now(); document.getElementById('surveyors').innerHTML=dashboardPeople.map(person=>{const online=person.id===dashboardUser.id?navigator.onLine:now-new Date(person.updated_at||0).getTime()<900000;return `<div class="flex justify-between py-2 border-b border-slate-100 last:border-0"><div><p class="text-xs font-bold"><i class="fa-solid fa-circle text-[8px] ${online?'text-emerald-500':'text-slate-300'} mr-1"></i>${esc(person.display_name||person.email||'ผู้สำรวจ')}</p><p class="text-[10px] text-slate-400">${online?'ออนไลน์ล่าสุด':'ไม่อยู่ล่าสุด'}</p></div><b>${counts.get(person.id)||0}</b></div>`;}).join('') || '<p class="text-sm text-slate-400">ไม่มีรายชื่อสมาชิก</p>'; }
function renderStatus(features) {
  const count = status => dashboardRecords.filter(record => record.status === status).length;
  const mainPlots = dashboardPlots.length;
  const doneItems = features.length;
  const doneDetail = mainPlots > 0 ? `${count('done')} แปลงหลัก · ${doneItems} รายการสำรวจ` : `${doneItems} รายการเสร็จสิ้น`;
  document.getElementById('plot-status').innerHTML = [
    ['รอดำเนินการ', `${count('waiting')} แปลง`, 'text-slate-600'],
    ['กำลังเดินทาง', `${count('navigating')} แปลง`, 'text-blue-600'],
    ['กำลังตรวจ', `${count('checking')} แปลง`, 'text-amber-600'],
    ['เสร็จสิ้น', doneDetail, 'text-emerald-600']
  ].map(([label, detail, color]) => `<div class="flex items-center justify-between gap-3 py-2 border-b border-slate-100 last:border-0"><span class="text-sm font-semibold text-slate-700">${label}</span><b class="text-xs text-right ${color}">${detail}</b></div>`).join('');
}
function renderTrend(features) { const data=new Map();features.forEach(feature=>{const d=fmtDate(feature.recorded_at||feature.updated_at);if(d)data.set(d,(data.get(d)||0)+1);});const items=[...data.entries()].sort().slice(-14),max=Math.max(1,...items.map(([,count])=>count));document.getElementById('trend').innerHTML=items.length?`<div class="h-40 flex items-end gap-1 overflow-x-auto">${items.map(([date,count])=>`<div class="min-w-8 flex-1 h-full flex flex-col justify-end items-center"><b class="text-[9px]">${count}</b><div class="w-full max-w-7 bg-blue-500 rounded-t" style="height:${Math.max(8,count/max*110)}px"></div><span class="text-[8px] text-slate-400 mt-1">${date.slice(5)}</span></div>`).join('')}</div>`:'<p class="text-sm text-slate-400 py-10 text-center">ยังไม่มีแนวโน้ม</p>'; }
function featureDisplayValues(feature) {
  return (dashboardForm?.fields || []).map(field => {
    const value = feature.form_data?.[field.key];
    const display = Array.isArray(value) ? value.map(item => optionLabel(field, item)).join(', ') : optionLabel(field, value);
    return { label: field.label, value: display };
  }).filter(item => item.value);
}
function entryMatches(entry) {
  const term = dashboardState.search.trim().toLocaleLowerCase('th');
  const fieldTerm = dashboardState.filterValue.trim().toLocaleLowerCase('th');
  const values = featureDisplayValues(entry);
  const haystack = `${entry.parentName || ''} ${entry.name || ''} ${entry.note || ''} ${values.map(item => `${item.label} ${item.value}`).join(' ')}`.toLocaleLowerCase('th');
  const selectedField = (dashboardForm?.fields || []).find(field => field.key === dashboardState.filterField);
  const rawSelected = entry.form_data?.[dashboardState.filterField];
  const selected = selectedField ? (Array.isArray(rawSelected) ? rawSelected.map(value => optionLabel(selectedField, value)).join(', ') : optionLabel(selectedField, rawSelected)) : haystack;
  return (!term || haystack.includes(term)) && (!fieldTerm || String(selected).toLocaleLowerCase('th').includes(fieldTerm));
}
function entryPhotos(entry) { return (entry.images || []).map(image => typeof image === 'string' ? image : image?.url).filter(Boolean); }
function dashboardEntryDetail(entry, title) {
  const values = featureDisplayValues(entry);
  const photos = entryPhotos(entry);
  return `<div class="text-left space-y-3"><div><p class="text-xs text-slate-500">${esc(title)}</p><p class="font-bold text-slate-800">${esc(entry.name || entry.parentName || 'รายการสำรวจ')}</p></div><div class="space-y-1">${values.length ? values.map(item => `<div class="flex justify-between gap-4 text-sm border-b border-slate-100 py-1"><span>${esc(item.label)}</span><b class="text-right">${esc(item.value)}</b></div>`).join('') : '<p class="text-sm text-slate-400">ยังไม่มีข้อมูลฟอร์ม</p>'}</div>${entry.note ? `<div class="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">${esc(entry.note)}</div>` : ''}${photos.length ? `<div><p class="text-xs font-bold text-slate-500 mb-2">รูปถ่าย · แตะเพื่อดูภาพใหญ่</p><div class="flex flex-wrap gap-2">${photos.map((url,index) => `<button type="button" onclick='showDashboardGallery(${JSON.stringify(photos)},${index})' class="rounded-lg overflow-hidden border border-slate-200"><img src="${esc(url)}" class="w-16 h-16 object-cover" alt="รูปสำรวจ"></button>`).join('')}</div></div>` : ''}</div>`;
}
function renderSurveyList() {
  const groups = dashboardRecords.map(record => {
    const props = record.record_properties || {};
    const basePlot = dashboardPlots.find(plot => plot.id === record.base_plot_id);
    const main = { record, parentName: props.name || record.base_plot_id || 'แปลงหลัก', name: props.name || 'ข้อมูลแปลงหลัก', note: record.note || props.note || '', form_data: props.form_data || {}, images: record.images || props.images || [], recorded_at: record.recorded_at, updated_at: record.updated_at, isMain: true, isIndependentParent: basePlot?.source_properties?.is_custom_draw === true };
    const children = (props.survey_features || []).map(feature => ({ ...feature, is_independent_child: feature.is_independent_child === true || main.isIndependentParent, record, parentName: main.parentName, isMain: false }));
    const matchingChildren = children.filter(entryMatches);
    const matchesMain = entryMatches(main);
    if (!children.length) return matchesMain ? { record, main, children: [], visibleChildren: [] } : null;
    return (matchesMain || matchingChildren.length) ? { record, main, children, visibleChildren: matchingChildren } : null;
  }).filter(Boolean).slice(0, 300);
  window.dashboardListGroups = new Map();
  document.getElementById('survey-list-count').textContent = `${groups.length} แปลง`;
  document.getElementById('survey-list').innerHTML = groups.length ? groups.map(group => {
    const id = group.record.id;
    const hasChildren = group.children.length > 0;
    const filtering = Boolean(dashboardState.search || dashboardState.filterField || dashboardState.filterValue);
    const expanded = dashboardExpandedRecords.has(id) || (filtering && group.visibleChildren.length > 0);
    const shownChildren = filtering ? group.visibleChildren : group.children;
    const independentChildren = group.children.filter(child => child.is_independent_child === true).length;
    const childType = independentChildren === group.children.length ? 'แปลงอิสระย่อย' : 'รายการย่อย';
    const childSummary = hasChildren ? `${group.children.length} ${childType}${shownChildren.length !== group.children.length ? ` · ตรงเงื่อนไข ${shownChildren.length}` : ''}` : 'ข้อมูลบันทึกแปลงหลัก';
    group.shownChildren = shownChildren;
    window.dashboardListGroups.set(id, group);
    const childHtml = expanded ? `<div class="mt-2 ml-3 pl-3 border-l-2 border-emerald-200 space-y-2">${shownChildren.length ? shownChildren.map((child, index) => `<button type="button" onclick="openDashboardChild('${esc(id)}',${index})" class="w-full text-left rounded-xl bg-emerald-50/50 border border-emerald-100 p-3 hover:bg-emerald-100 transition"><div class="flex justify-between gap-2"><div class="min-w-0"><p class="text-sm font-bold text-slate-800 truncate">${esc(child.name || (child.is_independent_child ? `แปลงอิสระ ${index + 1}` : `รายการย่อย ${index + 1}`))}</p><p class="text-[10px] text-slate-400">${child.is_independent_child ? 'แปลงอิสระย่อย · ' : ''}${fmtDate(child.recorded_at || child.updated_at)} · กดเพื่อดูรายละเอียด</p></div><span class="text-xs text-emerald-700">${entryPhotos(child).length} <i class="fa-solid fa-image"></i></span></div></button>`).join('') : '<p class="p-3 text-xs text-slate-400">ไม่มีรายการย่อยที่ตรงกับตัวกรอง</p>'}</div>` : '';
    return `<article class="rounded-xl border border-slate-200 bg-white p-3"><div class="flex items-start gap-2"><button type="button" onclick="toggleSurveyRecord('${esc(id)}')" class="mt-0.5 w-8 h-8 rounded-lg ${hasChildren ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'}" ${hasChildren ? '' : 'disabled'}>${hasChildren ? `<i class="fa-solid fa-${expanded ? 'minus' : 'plus'}"></i>` : '<i class="fa-solid fa-file-lines"></i>'}</button><button type="button" onclick="openDashboardRecord('${esc(id)}')" class="min-w-0 flex-1 text-left rounded-lg hover:bg-slate-50 p-1"><p class="text-sm font-bold text-slate-800 truncate">${esc(group.main.parentName)}</p><p class="text-[11px] text-slate-500">${childSummary} · กดเพื่อดูรายละเอียดหลัก</p></button></div>${childHtml}</article>`;
  }).join('') : '<p class="text-center py-10 text-sm text-slate-400">ไม่พบรายการที่ตรงกับเงื่อนไข</p>';
}
function toggleSurveyRecord(id) { if (dashboardExpandedRecords.has(id)) dashboardExpandedRecords.delete(id); else dashboardExpandedRecords.add(id); renderSurveyList(); }
function openDashboardRecord(id) { const group = window.dashboardListGroups?.get(id); if (group && window.Swal) Swal.fire({ title: 'รายละเอียดแปลงหลัก', html: dashboardEntryDetail(group.main, 'ข้อมูลแปลงหลัก'), width: 620, confirmButtonText: 'ปิด' }); }
function openDashboardChild(id, index) { const child = window.dashboardListGroups?.get(id)?.shownChildren?.[index]; if (child && window.Swal) Swal.fire({ title: 'รายละเอียดรายการย่อย', html: dashboardEntryDetail(child, child.parentName || 'แปลงหลัก'), width: 620, confirmButtonText: 'ปิด' }); }
function showDashboardGallery(images, index = 0) { window.dashboardGalleryImages = images; window.dashboardGalleryIndex = index; const image = images[index]; if (!image || !window.Swal) return; Swal.fire({ showCloseButton: true, showConfirmButton: false, width: 760, html: `<div class="relative flex items-center justify-center min-h-[360px]"><button type="button" onclick="moveDashboardGallery(-1)" ${index ? '' : 'disabled'} class="absolute left-0 w-10 h-10 rounded-full bg-black/60 text-white disabled:opacity-20"><i class="fa-solid fa-chevron-left"></i></button><img src="${esc(image)}" class="max-h-[65vh] max-w-[88%] object-contain rounded-xl"><button type="button" onclick="moveDashboardGallery(1)" ${index < images.length - 1 ? '' : 'disabled'} class="absolute right-0 w-10 h-10 rounded-full bg-black/60 text-white disabled:opacity-20"><i class="fa-solid fa-chevron-right"></i></button></div><p class="mt-2 text-sm text-slate-500">${index + 1} / ${images.length}</p>` }); }
function moveDashboardGallery(step) { showDashboardGallery(window.dashboardGalleryImages || [], (window.dashboardGalleryIndex || 0) + step); }
window.toggleSurveyRecord = toggleSurveyRecord;
window.openDashboardRecord = openDashboardRecord;
window.openDashboardChild = openDashboardChild;
window.showDashboardGallery = showDashboardGallery;
window.moveDashboardGallery = moveDashboardGallery;
function showError(message) { document.getElementById('dashboard-loading').innerHTML=`<i class="fa-solid fa-triangle-exclamation mr-2 text-amber-500"></i>${esc(message)}`; }
startDashboard().catch(error => showError(error.message));
