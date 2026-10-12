(async function(){
  await import('/static/measurement-provenance.js');
  await import('/static/offline-submission.js');
  function escapeHtml(v){return String(v==null?'':v).replace(/[&<>"']/g,function(ch){return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[ch]||ch;});}
  const typed=document.getElementById('typed-question');
  if(typed){const full='为什么加入 NH₄Cl 后油水分层更明显？';let i=0;const t=setInterval(()=>{i++;typed.textContent=full.slice(0,i);if(i>=full.length)clearInterval(t)},70)}
  document.querySelectorAll('.magnetic,.card').forEach(el=>{el.addEventListener('mousemove',e=>{const r=el.getBoundingClientRect();el.style.setProperty('--x',`${e.clientX-r.left}px`);el.style.setProperty('--y',`${e.clientY-r.top}px`)})});
  const flows=[
    ['Step 01','微课导入：水蒸气蒸馏与盐析分离','通过微课视频与课标知识点导入，学生理解水蒸气蒸馏原理与 NH₄Cl 盐析效应的理论基础，为动手操作建立认知框架。',[['教学目标','理解水蒸气蒸馏原理（共沸点低于各组分沸点）、NH₄Cl 电解质电离与盐析效应'],['学生任务','观看微课 → 完成课前预习问题 → 记录疑问点 → 使用 AI 助教预习答疑'],['课标映射','人教版化学必修一（物质分离提纯）、选必一（电解质溶液）']]],
    ['Step 02','变量探究：NH₄Cl 浓度梯度实验','学生分组操作，设置 0%/1%/3%/4% NH₄Cl 浓度梯度，规范记录实验数据，培养变量控制与实验操作能力。',[['教学目标','掌握控制变量法（自变量=NH₄Cl浓度，因变量=精油得率，控制变量=橘皮质量/时间等）'],['学生任务','按分组完成蒸馏操作 → 精确记录橘皮质量、精油质量、分层清晰度、乳化情况 → 提交数据至平台'],['对照设计','0% 组为必要空白对照，用于验证盐析是否有效提升得率']]],
    ['Step 03','数据采集与分析：从个体到班级趋势','平台自动汇总全班数据，生成浓度-得率趋势图与异常诊断，学生学习用数据证据解释实验结果。',[['教学目标','学会数据处理（均值/标准差）、识别异常值（IQR规则）、基于证据的论证'],['学生任务','查看班级趋势图 → 比较自己数据与班级均值 → 分析异常数据原因 → AI 自动诊断提示'],['AI 赋能','DeepSeek 对每条提交数据给出个性化诊断建议（得率合理性、分层充分性、改进方向）']]],
    ['Step 04','抑菌观察：E. coli 生长受抑现象比较','通过空白对照组、Tween 80 对照组与精油乳液组的抑菌圈对比，培养对照实验意识与科学表达能力。',[['教学目标','理解对照实验原则、抑菌圈测量方法、细胞膜结构与精油抑菌机制（相似相溶）'],['学生任务','记录抑菌圈直径 → 测量可视化对比 → 评估抑制等级 → 讨论对照组意义'],['安全边界','以教师指导和教学安全材料为基础，平台不提供危险微生物培养操作']]],
    ['Step 05','AI 闭环反馈：诊断—反馈—总结','AI 贯穿整个教学过程：个性化数据诊断、习题错误反馈、班级共性问题归纳，形成"教—学—评"闭环。',[['教学目标','培养反思与改进能力，理解科学结论的局限性与可修正性'],['AI 闭环','① 数据提交后 AI 个性化诊断 → ② 习题答错后 AI 知识点解释 → ③ 教师端 AI 班级诊断摘要'],['教师承接','AI 生成班级共性问题分析 → 教师据此调整下节课重点 → 布置针对性课后练习']]]
  ];
  window.showFlow=function(i){const k=document.getElementById('flow-kicker');if(!k)return;document.querySelectorAll('.flow-tab').forEach((x,j)=>x.classList.toggle('active',i===j));const f=flows[i];k.textContent=f[0];document.getElementById('flow-title').textContent=f[1];document.getElementById('flow-desc').textContent=f[2];document.getElementById('flow-visual').innerHTML=f[3].map(c=>`<div class="flow-mini-card"><strong>${c[0]}</strong><div>${c[1]}</div></div>`).join('')}
  function grade(mm){mm=Number(mm)||0;if(mm<=1)return ['无明显抑制','#94a3b8'];if(mm<8)return ['弱抑制','#f59e0b'];if(mm<15)return ['中等抑制','#10b981'];return ['较强抑制','#2563eb']}
  function petri(zone){
    zone=Number(zone)||0;const g=grade(zone);
    function dots(cx,z,offset){let out='';for(let i=0;i<72;i++){const a=((i+offset)*137.5)%360,r=7+(((i+offset)*23)%74),x=cx+Math.cos(a*Math.PI/180)*r,y=132+Math.sin(a*Math.PI/180)*r,inZ=Math.hypot(x-cx,y-132)<z*3.05;out+=`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(1.1+(i%3)*.42).toFixed(1)}" fill="#10b981" opacity="${z>1?(inZ?.14:.68):.78}"/>`}return out}
    function dish(cx,label,z,accent,offset){return `<g><circle cx="${cx}" cy="132" r="82" fill="url(#dishTwinClient)" stroke="#94a3b8" stroke-width="2"/><circle cx="${cx}" cy="132" r="73" fill="none" stroke="#e2e8f0"/>${dots(cx,z,offset)}<circle cx="${cx}" cy="132" r="${Math.max(2,z*3.05).toFixed(1)}" fill="${accent}" opacity=".18"/><circle cx="${cx}" cy="132" r="${Math.max(2,z*3.05).toFixed(1)}" fill="none" stroke="${accent}" stroke-width="3" stroke-dasharray="7 5"><animate attributeName="stroke-dashoffset" values="0;24" dur="2.6s" repeatCount="indefinite"/></circle><line x1="${(cx-z*3.05).toFixed(1)}" y1="132" x2="${(cx+z*3.05).toFixed(1)}" y2="132" stroke="${accent}" stroke-width="2"/><text x="${cx}" y="236" text-anchor="middle" font-size="13" fill="#475569" font-weight="800">${label}</text><text x="${cx}" y="256" text-anchor="middle" font-size="12" fill="#64748b">${z.toFixed(1)} mm</text></g>`}
    return `<div class="digital-twin-card"><div class="digital-twin-head"><div><div class="kicker">Measurement Visualisation</div><h3>抑菌圈测量可视化</h3></div><strong style="color:${g[1]}">${g[0]}</strong></div><svg class="petri-twin-svg" viewBox="0 0 520 280"><defs><radialGradient id="dishTwinClient" cx="50%" cy="45%"><stop offset="0%" stop-color="#ffffff"/><stop offset="100%" stop-color="#dbeafe"/></radialGradient></defs><rect width="520" height="280" rx="28" fill="#f8fafc"/><text x="260" y="32" text-anchor="middle" font-size="14" fill="#0f172a" font-weight="800">E. coli 抑菌圈测量示意</text>${dish(145,'空白对照组',0,'#94a3b8',0)}${dish(375,'精油乳液组',zone,g[1],9)}<path d="M260 74 V218" stroke="#e2e8f0" stroke-dasharray="6 8"/></svg><p class="small">输入抑菌圈直径后生成测量示意图，用于辅助对照观察，不是自动图像识别。</p></div>`
  }
  document.querySelectorAll('.section-head p').forEach(paragraph=>{paragraph.textContent=paragraph.textContent.replace('纳入、排除或删除','纳入、排除或归档')});
  document.querySelectorAll('[data-record-action="delete"]').forEach(button=>{button.textContent='归档';button.title='软删除：保留科学数据与审查历史'});
  const form=document.getElementById('student-form');
  const measurementState=form&&window.EchoClassMeasurementProvenance?window.EchoClassMeasurementProvenance.createState():null;
  function syncMeasurementState(){if(!form||!measurementState)return;const snapshot=measurementState.snapshot(),stateInput=form.elements.namedItem('measurement_image_state'),methodInput=form.elements.namedItem('measurement_method');if(stateInput)stateInput.value=snapshot.imageState;if(methodInput)methodInput.value=snapshot.method}
if(form){const peel=document.getElementById('peel_mass'),oil=document.getElementById('oil_mass'),zone=document.getElementById('inhibition_zone_diameter'),phase=document.getElementById('phase_clarity_score'),emu=document.getElementById('emulsification_level'),yText=document.getElementById('yield-text'),zText=document.getElementById('zone-text'),dText=document.getElementById('diagnosis-text'),sText=document.getElementById('data-status'),gText=document.getElementById('grade-text'),preview=document.getElementById('petri-preview');function update(){const p=Number(peel.value),o=Number(oil.value),z=Number(zone.value),ph=Number(phase.value),em=String(emu.value||''),y=p>0&&o>0?o/p*100:0;yText.textContent=y?`${y.toFixed(2)}%`:'--.--%';zText.textContent=z?`${z.toFixed(1)} mm`:'-- mm';const gr=grade(z);gText.textContent=gr[0];gText.style.color=gr[1];let status='正常',text='当前数据可进入同浓度组比较。';if(!y)text='输入质量后自动计算得率。';else if(y>2){status='需复核';text='得率偏高，请复核水相混入与容器皮重。'}else if(y<.35){status='需复核';text='得率偏低，可检查蒸馏时间、冷凝效率和收集过程。'}if(y>=1.5&&ph<=2){status='逻辑冲突';text='分层清晰度低但得率高，建议复核是否混入底层水相。'}if(em.includes('明显')&&y>1.4){status='需复核';text='明显乳化且得率较高，建议充分静置后复核。'}sText.textContent=status;dText.textContent=text}['input','change'].forEach(e=>form.addEventListener(e,update));update();const img=document.getElementById('plate_image');const previewBox=document.getElementById('image-preview');const petriInput=document.getElementById('petri_diameter_mm');let applyingCalibratedDiameter=false;function setMeasurementProvenance(state,method){const stateInput=form.elements.namedItem('measurement_image_state'),methodInput=form.elements.namedItem('measurement_method');if(stateInput)stateInput.value=state;if(methodInput)methodInput.value=method}if(zone)zone.addEventListener('input',()=>{if(!applyingCalibratedDiameter){const state=img&&img.files&&img.files[0]?'image_loaded':'manual_only';setMeasurementProvenance(state,'manual_direct')}});function initPlateMeasurement(src){
  if(measurementState){measurementState.imageLoaded();syncMeasurementState()}else setMeasurementProvenance('image_loaded','manual_direct');
  if(!previewBox)return;
  previewBox.innerHTML=`<div style="width:100%;display:grid;gap:10px"><canvas id="plate-measure-canvas" style="width:100%;max-height:420px;border-radius:18px;background:#020617;cursor:crosshair;touch-action:none"></canvas><div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center"><button class="btn btn-secondary" type="button" id="measure-reset-btn">重新框选</button><span id="measure-tip" class="small strong">拖拽画圆框住抑菌圈，系统按培养皿规格换算直径。</span></div></div>`;
  const canvas=document.getElementById('plate-measure-canvas'),tip=document.getElementById('measure-tip'),reset=document.getElementById('measure-reset-btn'),ctx=canvas.getContext('2d');
  const im=new Image();let circle=null,drawing=false,startPt=null,currentPt=null;
  function pt(ev){const e=ev.touches&&ev.touches[0]?ev.touches[0]:ev;const r=canvas.getBoundingClientRect();return{x:(e.clientX-r.left)*canvas.width/r.width,y:(e.clientY-r.top)*canvas.height/r.height}}
  function setDia(c){const real=Number(petriInput&&petriInput.value)||90;const platePx=Math.min(canvas.width,canvas.height)*.92;const mm=2*c.r*real/platePx;const zone=document.getElementById('inhibition_zone_diameter');if(zone){applyingCalibratedDiameter=true;zone.value=Math.max(0,mm).toFixed(1);zone.dispatchEvent(new Event('input',{bubbles:true}));applyingCalibratedDiameter=false;if(measurementState){measurementState.calibrationCompleted({dishDiameterMm:real,circleRadiusPx:c.r,plateDiameterPx:platePx});syncMeasurementState()}else setMeasurementProvenance('calibrated_complete','manual_local_image_calibrated')}if(tip)tip.textContent=`框选测量值：${mm.toFixed(1)} mm（圆直径 ${Math.round(2*c.r)} px；培养皿 ${real} mm）。不准可重新框选或手动修改。`}
  function mark(c,active){if(!c)return;ctx.save();ctx.fillStyle=active?'rgba(79,70,229,.12)':'rgba(249,115,22,.14)';ctx.strokeStyle=active?'#4f46e5':'#f97316';ctx.lineWidth=3;ctx.setLineDash(active?[8,6]:[]);ctx.beginPath();ctx.arc(c.x,c.y,c.r,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.setLineDash([]);ctx.strokeStyle='#f97316';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(c.x-c.r,c.y);ctx.lineTo(c.x+c.r,c.y);ctx.stroke();ctx.fillStyle='#f97316';ctx.beginPath();ctx.arc(c.x,c.y,4,0,Math.PI*2);ctx.fill();ctx.restore()}
  function draw(){if(!im.naturalWidth)return;const maxW=760,scale=Math.min(1,maxW/im.naturalWidth);canvas.width=Math.round(im.naturalWidth*scale);canvas.height=Math.round(im.naturalHeight*scale);ctx.drawImage(im,0,0,canvas.width,canvas.height);mark(circle,false);if(drawing&&startPt&&currentPt){mark({x:startPt.x,y:startPt.y,r:Math.hypot(currentPt.x-startPt.x,currentPt.y-startPt.y)},true)}}
  im.onload=()=>{draw();if(tip)tip.textContent='图片已载入。按住抑菌圈中心向外拖拽，画圆框住透明抑菌圈边缘。'};im.src=src;
  function begin(ev){ev.preventDefault();startPt=pt(ev);currentPt=startPt;drawing=true;draw()}
  function move(ev){if(!drawing)return;ev.preventDefault();currentPt=pt(ev);draw()}
  function finish(ev){if(!drawing)return;ev.preventDefault();currentPt=pt(ev);const r=Math.hypot(currentPt.x-startPt.x,currentPt.y-startPt.y);if(r>4){circle={x:startPt.x,y:startPt.y,r};setDia(circle)}drawing=false;startPt=null;currentPt=null;draw()}
  canvas.addEventListener('mousedown',begin);canvas.addEventListener('mousemove',move);window.addEventListener('mouseup',finish);
  canvas.addEventListener('touchstart',begin,{passive:false});canvas.addEventListener('touchmove',move,{passive:false});canvas.addEventListener('touchend',finish,{passive:false});
  if(reset)reset.addEventListener('click',()=>{circle=null;if(measurementState){measurementState.resetSelection();syncMeasurementState()}else setMeasurementProvenance('image_loaded','manual_direct');draw();if(tip)tip.textContent='已重置。请拖拽画圆框住抑菌圈。'});
  if(petriInput)['input','change'].forEach(eventName=>petriInput.addEventListener(eventName,()=>{if(!measurementState)return;const before=measurementState.snapshot().method;measurementState.dishDiameterChanged(petriInput.value);syncMeasurementState();if(before==='manual_local_image_calibrated'&&measurementState.snapshot().method!=='manual_local_image_calibrated'){circle=null;draw();if(tip)tip.textContent='培养皿规格已变化，原标定已失效，请重新框选抑菌圈。'}}));
}
async function validLocalImage(file){if(file.size>10*1024*1024)return false;const allowedMime=new Set(['image/jpeg','image/png','image/webp']);const allowedExt=/\.(?:jpe?g|png|webp)$/i;if(!allowedMime.has(file.type)||!allowedExt.test(file.name))return false;const b=new Uint8Array(await file.slice(0,12).arrayBuffer());const jpg=b[0]===0xff&&b[1]===0xd8&&b[2]===0xff;const png=b[0]===0x89&&b[1]===0x50&&b[2]===0x4e&&b[3]===0x47&&b[4]===0x0d&&b[5]===0x0a&&b[6]===0x1a&&b[7]===0x0a;const webp=String.fromCharCode(...b.slice(0,4))==='RIFF'&&String.fromCharCode(...b.slice(8,12))==='WEBP';return jpg||png||webp}
if(zone&&measurementState)zone.addEventListener('input',()=>{if(!applyingCalibratedDiameter){measurementState.manualEntry(Boolean(img&&img.files&&img.files[0]));syncMeasurementState()}});if(img){img.addEventListener('change',async()=>{const generation=Number(form.dataset.imageReadGeneration||0)+1;form.dataset.imageReadGeneration=String(generation);if(measurementState){measurementState.imageReplacementStarted();syncMeasurementState()}const file=img.files&&img.files[0];if(!file){if(measurementState){measurementState.imageRemoved();syncMeasurementState()}else setMeasurementProvenance('manual_only','manual_direct');return}if(!(await validLocalImage(file))){if(Number(form.dataset.imageReadGeneration)!==generation)return;alert('仅支持 10MB 以内、文件类型与内容一致的 JPEG、PNG 或 WebP 图片');img.value='';if(measurementState){measurementState.fileReadFailed();syncMeasurementState()}else setMeasurementProvenance('manual_only','manual_direct');return}const reader=new FileReader();reader.onload=()=>{if(Number(form.dataset.imageReadGeneration)===generation)initPlateMeasurement(reader.result)};reader.onerror=()=>{if(Number(form.dataset.imageReadGeneration)!==generation)return;img.value='';if(measurementState){measurementState.fileReadFailed();syncMeasurementState()}else setMeasurementProvenance('manual_only','manual_direct')};reader.readAsDataURL(file)})}}
  // === AI Teaching Assistant Chat ===
  var _currentScene='';
  var _chatHistory=[];
  function _storageKey(){ return 'llm_chat_'+_currentScene; }
  function _saveChat(){ try{ sessionStorage.setItem(_storageKey(), JSON.stringify(_chatHistory)); }catch{} }
  function _loadChat(){ try{ _chatHistory=JSON.parse(sessionStorage.getItem(_storageKey())||'[]'); }catch{ _chatHistory=[]; } }
  function _renderMessages(){
    const box=document.getElementById('chat-messages'); if(!box) return;
    const chips=document.getElementById('llm-chips-area');
    if(!_chatHistory.length){
      if(chips) chips.style.display='';
      box.innerHTML='<div class="llm-empty"><p>选择上方常见问题，或在下方输入你的探究疑问</p></div>';
      return;
    }
    if(chips) chips.style.display='none';
    box.innerHTML=_chatHistory.map(function(m){
      if(m.role==='user'){
        return '<div class="llm-msg llm-msg-user"><div class="llm-msg-label">我的提问</div><div class="llm-msg-body">'+escapeHtml(m.content||'').replace(/\n/g,'<br>')+'</div></div>';
      }
      return '<div class="llm-msg llm-msg-ai"><div class="llm-msg-label">AI 助教</div><div class="llm-msg-body">'+escapeHtml(m.content||'').replace(/\n/g,'<br>')+'</div></div>';
    }).join('');
    box.scrollTop=box.scrollHeight;
  }
  window.selectScene=function(id){
    _currentScene=id;
    _loadChat();
    document.getElementById('scene-selector').style.display='none';
    var chatEl=document.getElementById('chat-area');
    if(chatEl) chatEl.style.display='';
    var label=document.getElementById('chat-scene-label');
    if(label && window._sceneLabels) label.textContent=_sceneLabels[id]||id;
    var chipsArea=document.getElementById('llm-chips-area');
    if(chipsArea && window._reviewChips && window._previewChips){
      chipsArea.innerHTML=(id==='review'?_reviewChips:_previewChips);
    }
    _renderMessages();
    var ta=document.getElementById('question'); if(ta) ta.focus();
  };
  window.backToScenes=function(){
    document.getElementById('scene-selector').style.display='';
    document.getElementById('chat-area').style.display='none';
  };
  window.clearChat=function(){
    _chatHistory=[];
    _saveChat();
    _renderMessages();
  };
  window.fillQuestion=function(q){ var x=document.getElementById('question'); if(x){ x.value=q; x.focus(); } };
  var llmQuestionInput=document.getElementById('question');
  if(llmQuestionInput){llmQuestionInput.addEventListener('keydown',function(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();var f=document.getElementById('ask-form');if(f)f.requestSubmit();}});}
  var _sending=false;
  const ask=document.getElementById('ask-form');
  if(ask){ask.addEventListener('submit',async function(e){
    e.preventDefault();
    if(_sending) return;
    const input=document.getElementById('question');
    const question=(input.value||'').trim();
    if(!question) return;
    input.value='';
    _chatHistory.push({role:'user',content:question});
    _chatHistory.push({role:'assistant',content:'思考中……'});
    _saveChat(); _renderMessages();
    _sending=true;
    var btn=document.getElementById('llm-send-btn'); if(btn){btn.disabled=true;btn.textContent='…';}
    try{
      const r=await fetch('/api/llm/ask',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({question,scene:_currentScene,history:_chatHistory.slice(0,-1).map(function(m){return {role:m.role,content:m.content}})})});
      const data=await r.json();
      _chatHistory[_chatHistory.length-1].content=data.answer||'暂时没有生成结果。';
    }catch{
      _chatHistory[_chatHistory.length-1].content='网络不稳定，请稍后再试。本地提示：请从变量、现象、证据和结论四步分析。';
    }
    _saveChat(); _renderMessages();
    _sending=false;
    if(btn){btn.disabled=false;btn.textContent='↑';}
  })}

  // === Practice page AI helper ===
  const practiceAsk=document.getElementById('practice-ask-form');
  const practiceInput=document.getElementById('practice-question');
  const practiceAnswer=document.getElementById('practice-answer-box');
  const practiceBtn=document.getElementById('practice-ai-send');
  if(practiceInput){
    practiceInput.addEventListener('keydown',function(e){
      if(e.key==='Enter'&&!e.shiftKey){
        e.preventDefault();
        if(practiceAsk) practiceAsk.requestSubmit();
      }
    });
  }
  if(practiceAsk){practiceAsk.addEventListener('submit',async function(e){
    e.preventDefault();
    const question=(practiceInput && practiceInput.value || '').trim();
    if(!question) return;
    if(practiceBtn){practiceBtn.disabled=true;practiceBtn.textContent='生成中…';}
    if(practiceAnswer){practiceAnswer.innerHTML='<div class="practice-answer-loading">AI 正在生成解析，请稍候……</div>';}
    try{
      const r=await fetch('/api/llm/ask',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({question,scene:'review',history:[]})});
      const data=await r.json().catch(()=>({}));
      if(!r.ok) throw Error(data.error||'生成失败');
      if(practiceAnswer){
        const mode=data.mode==='deepseek-proxy'?'DeepSeek 实时生成':'本地兜底解析';
        practiceAnswer.innerHTML='<div class="practice-answer-meta">'+mode+'</div><div class="practice-answer-body">'+escapeHtml(data.answer||'暂时没有生成结果。').replace(/\n/g,'<br>')+'</div>';
      }
    }catch(err){
      if(practiceAnswer){practiceAnswer.innerHTML='<div class="practice-answer-body">网络不稳定，请稍后再试。你可以先按“变量—现象—证据—结论”的顺序分析这个问题。</div>';}
    }finally{
      if(practiceBtn){practiceBtn.disabled=false;practiceBtn.textContent='生成解释';}
    }
  })}

  const cp=document.getElementById('change-password-form');if(cp){cp.addEventListener('submit',async e=>{e.preventDefault();const payload=Object.fromEntries(new FormData(cp).entries());const box=document.getElementById('password-result');try{const r=await fetch('/api/auth/change-password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const data=await r.json();box.textContent=data.message||data.error?.message||'修改失败';box.style.color=r.ok?'#047857':'#b45309';if(r.ok&&['/student/login','/teacher/login','/admin/login'].includes(data.login_url))window.location.assign(data.login_url+'?password=changed')}catch{box.textContent='修改失败，请稍后再试';box.style.color='#b45309'}})}
window.resetPassword=async function(username){const box=document.getElementById('admin-result');if(box){box.textContent='正在重置...';box.style.color='#2563eb'}try{const r=await fetch('/api/admin/reset-password',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({username})});const data=await r.json().catch(()=>({}));if(!r.ok)throw Error(data.error||'重置失败');const temporary=String(data.temporary_password||'');if(!temporary)throw Error('服务器未返回临时密码');if(box){box.textContent=`${username} 的一次性临时密码：${temporary}（请安全交付）`;box.style.color='#047857'}document.querySelectorAll(`[data-reset-user="${CSS.escape(username)}"]`).forEach(btn=>{btn.textContent='已重置';btn.classList.add('is-done')})}catch(err){if(box){box.textContent=err.message||'重置失败';box.style.color='#b45309'}}}
document.querySelectorAll('[data-reset-user]').forEach(btn=>btn.addEventListener('click',()=>resetPassword(btn.dataset.resetUser)));
document.querySelectorAll('[data-class-target]').forEach(btn=>btn.addEventListener('click',()=>document.getElementById(btn.dataset.classTarget)?.scrollIntoView({behavior:'smooth',block:'start'})));
const adminSearch=document.getElementById('admin-user-search');if(adminSearch){const detail=document.getElementById('admin-user-detail');function render(){const q=adminSearch.value.trim().toLowerCase();const rows=[...document.querySelectorAll('[data-user-row]')];let first=null;rows.forEach(row=>{const hit=!q||row.dataset.username.toLowerCase().includes(q)||row.dataset.name.toLowerCase().includes(q)||row.dataset.class.toLowerCase().includes(q);row.style.display=hit?'':'none';if(q&&hit&&!first)first=row});if(!q){detail.textContent='输入后显示匹配账号信息';return}if(!first){detail.textContent='未找到匹配账号';return}const cells=[...first.children].map(td=>td.textContent.trim());detail.replaceChildren();const name=document.createElement('strong');name.textContent=cells[2];detail.appendChild(name);[['账号：',cells[0]],['角色：',cells[1]],['班级：',cells[3]]].forEach(([label,value])=>{const span=document.createElement('span');span.textContent=label+value;detail.appendChild(span)});const reset=document.createElement('button');reset.className='mini-btn';reset.type='button';reset.textContent='生成临时密码';reset.addEventListener('click',()=>resetPassword(cells[0]));detail.appendChild(reset)}adminSearch.addEventListener('input',render);render()}
 // (legacy sim-slider handler removed – superseded by V13 Clevenger Canvas)
// Practice results loader for teacher page
window.loadPQResults=async function(btn){
  const panel=document.getElementById('pq-results-panel');
  if(!panel) return;
  if(btn){ btn.textContent='加载中…'; btn.disabled=true; }
  try{
    const r=await fetch('/api/practice/results',{credentials:'same-origin'});
    const data=await r.json();
    if(!r.ok) throw Error(data.error||'无权限');
    const answers=data.answers||[];
    const ts=new Date().toLocaleTimeString('zh-CN');
    if(!answers.length){ panel.innerHTML=`<p class="small">暂无作答记录。学生在习题页完成选择题后数据将自动保存。<em style="color:#94a3b8;margin-left:8px">上次更新 ${ts}</em></p>`; return; }
    const byQ={};
    answers.forEach(a=>{ if(!byQ[a.qid]) byQ[a.qid]={total:0,correct:0,level:a.level}; byQ[a.qid].total++; if(a.correct) byQ[a.qid].correct++; });
    const lvName=['','基础','提升','拓展'];
    const rows=Object.entries(byQ).sort((a,b)=>a[0].localeCompare(b[0],undefined,{numeric:true})).map(([qid,s])=>`<tr><td>${escapeHtml(qid)}</td><td><span class="pq-lv-badge pq-lv-${Number(s.level)||1}">${escapeHtml(lvName[s.level]||s.level)}</span></td><td>${Number(s.total)||0}</td><td>${Number(s.correct)||0}</td><td>${s.total?(s.correct/s.total*100).toFixed(0)+'%':'—'}</td></tr>`).join('');
    const byStu={};
    answers.forEach(a=>{ const k=a.student?.name||a.student?.id||'体验用户'; if(!byStu[k]) byStu[k]={name:k,cls:a.student?.class_name||'—',total:0,correct:0}; byStu[k].total++; if(a.correct) byStu[k].correct++; });
    const stuRows=Object.values(byStu).sort((a,b)=>b.correct-a.correct).map(s=>`<tr><td><strong>${escapeHtml(s.name)}</strong></td><td>${escapeHtml(s.cls)}</td><td>${Number(s.total)||0}</td><td>${Number(s.correct)||0}</td><td>${(s.correct/s.total*100).toFixed(0)}%</td></tr>`).join('');
    panel.innerHTML=`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><span class="small" style="color:#94a3b8">实时数据 · 上次更新 ${ts}</span><button class="btn btn-secondary" style="padding:4px 12px;font-size:12px" type="button" onclick="loadPQResults()">刷新</button></div><div class="grid-2" style="gap:20px"><div><h3 style="margin-bottom:8px">各题正确率</h3><div class="table-wrap"><table><thead><tr><th>题目</th><th>难度</th><th>作答数</th><th>正确数</th><th>正确率</th></tr></thead><tbody>${rows}</tbody></table></div></div><div><h3 style="margin-bottom:8px">学生作答汇总</h3><div class="table-wrap"><table><thead><tr><th>姓名</th><th>班级</th><th>总答题</th><th>正确</th><th>正确率</th></tr></thead><tbody>${stuRows}</tbody></table></div></div></div>`;
  }catch(e){ panel.textContent=e.message||'加载失败'; panel.style.color='#b45309'; }
};

// Auto-refresh practice results every 45s on teacher page
(function(){
  if(!document.getElementById('pq-results-panel')) return;
  loadPQResults();
  setInterval(()=>loadPQResults(), 45000);
})();

// Real-time trend chart polling: refresh every 30s by re-fetching analytics
(function(){
  const wrap=document.getElementById('live-trend-svg');
  if(!wrap) return;
  const params=new URLSearchParams(window.location.search);
  const publicDemoPage=['/','/classroom','/theme','/demo','/dashboard'].includes(window.location.pathname);
  const demoQuery=publicDemoPage||params.get('demo')==='1'||params.get('mode')==='demo'?'?demo=1':'';
  async function refreshTrend(){
    try{
      const r=await fetch('/api/analytics'+demoQuery,{credentials:'same-origin'});
      if(!r.ok) return;
      const d=await r.json();
      const stats=d.stats||[];
      if(!stats.length) return;
      // Minimal SVG re-render (update bar heights and value labels by re-fetching the full page trend)
      // Simpler approach: fetch /api/trend-svg if available, otherwise skip silently
      const tr=await fetch('/api/trend-svg'+demoQuery,{credentials:'same-origin'});
      if(!tr.ok) return;
      const svg=await tr.text();
      const container=document.getElementById('live-trend-svg');
      if(container&&svg.startsWith('<svg')){ container.outerHTML=svg; }
    }catch(e){}
  }
  setInterval(refreshTrend, 30000);
})();
  // V8 material gallery: click image thumbnails to enlarge in a local lightbox.
  function ensureLightbox(){
    let modal=document.getElementById('lightbox-backdrop');
    if(modal) return modal;
    modal=document.createElement('div');
    modal.id='lightbox-backdrop';
    modal.className='lightbox-backdrop';
    modal.innerHTML=`<div class="lightbox-panel" role="dialog" aria-modal="true"><div class="lightbox-head"><span id="lightbox-title">材料预览</span><button class="lightbox-close" type="button" aria-label="关闭">×</button></div><div class="lightbox-body"><img id="lightbox-image" alt="材料放大预览"/></div></div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click',e=>{ if(e.target===modal) modal.classList.remove('open'); });
    modal.querySelector('.lightbox-close').addEventListener('click',()=>modal.classList.remove('open'));
    document.addEventListener('keydown',e=>{ if(e.key==='Escape') modal.classList.remove('open'); });
    return modal;
  }
  window.generateClassSummary = async function() {
    const box = document.getElementById('class-summary-box');
    const btn = document.getElementById('gen-class-summary');
    if (!box || !btn) return;
    btn.disabled = true;
    btn.textContent = '正在生成……';
    box.innerHTML = '<p style="color:#64748b">AI 正在分析班级数据，请稍候……</p>';
    try {
      const res = await fetch('/api/llm/class-summary', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '生成失败');
      box.innerHTML = '<div class="llm-msg llm-msg-ai"><div class="llm-msg-label">AI 班级诊断</div><div class="llm-msg-body">' + escapeHtml(data.summary || '暂无结果').replace(/\n/g, '<br>') + '</div></div>' + '<p class="small" style="margin-top:8px;color:#94a3b8">生成时间：' + escapeHtml(data.generated_at || '') + ' · 模式：' + escapeHtml(data.mode || '') + '</p>';
    } catch (e) {
      box.textContent = e.message || '生成失败';
      box.style.color = '#ef4444';
    }
    btn.disabled = false;
    btn.textContent = '刷新 AI 班级诊断';
  };

  document.querySelectorAll('.zoomable-image').forEach(img=>{
    const open=()=>{
      const modal=ensureLightbox();
      const big=modal.querySelector('#lightbox-image');
      const title=modal.querySelector('#lightbox-title');
      big.src=img.dataset.src || img.src;
      big.alt=img.alt || '材料放大预览';
      title.textContent=img.dataset.title || img.alt || '材料预览';
      modal.classList.add('open');
    };
    img.addEventListener('click',open);
    const parent=img.closest('.resource-thumb');
    if(parent) parent.addEventListener('click',e=>{ if(e.target!==img) open(); });
  });

  function ensureVideoModal(){
    let modal=document.getElementById('video-modal-backdrop');
    if(modal) return modal;
    modal=document.createElement('div');
    modal.id='video-modal-backdrop';
    modal.className='video-modal-backdrop';
    modal.innerHTML=`<div class="video-modal-panel" role="dialog" aria-modal="true"><div class="video-modal-head"><span id="video-modal-title">实验教学视频</span><button class="video-modal-close" type="button" aria-label="关闭">×</button></div><div class="video-modal-body"><video id="video-modal-player" controls preload="metadata"></video></div></div>`;
    document.body.appendChild(modal);
    const player=modal.querySelector('#video-modal-player');
    const close=()=>{ player.pause(); modal.classList.remove('open'); };
    modal.addEventListener('click',e=>{ if(e.target===modal) close(); });
    modal.querySelector('.video-modal-close').addEventListener('click',close);
    document.addEventListener('keydown',e=>{ if(e.key==='Escape' && modal.classList.contains('open')) close(); });
    return modal;
  }
  document.querySelectorAll('.video-open-card').forEach(card=>{
    card.addEventListener('click',()=>{
      const modal=ensureVideoModal();
      const player=modal.querySelector('#video-modal-player');
      const title=modal.querySelector('#video-modal-title');
      player.src=card.dataset.videoSrc || '';
      player.poster=card.dataset.videoPoster || '';
      title.textContent=card.dataset.videoTitle || '实验教学视频';
      modal.classList.add('open');
      player.focus();
      player.play().catch(()=>{});
    });
  });

})();


// V9 interactive local molecule projection (offline-safe fallback for limonene.glb)
(function(){
  const canvas=document.querySelector('.molecule-canvas');
  if(!canvas) return;
  const ctx=canvas.getContext('2d');
  let W=canvas.width,H=canvas.height,drag=false,lastX=0,lastY=0,rx=-0.42,ry=0.78,auto=true;
  const atoms=[
    {id:'C1',x:-1.35,y:-.78,z:0,t:'C'},{id:'C2',x:-.42,y:-1.32,z:.18,t:'C'},{id:'C3',x:.76,y:-.96,z:.02,t:'C'},
    {id:'C4',x:1.22,y:.28,z:-.14,t:'C'},{id:'C5',x:.28,y:1.04,z:-.10,t:'C'},{id:'C6',x:-1.02,y:.62,z:.08,t:'C'},
    {id:'C7',x:2.18,y:.62,z:.16,t:'C'},{id:'C8',x:2.92,y:-.26,z:.02,t:'C'},{id:'C9',x:2.35,y:1.86,z:.08,t:'C'},
    {id:'C10',x:-1.92,y:1.62,z:-.10,t:'C'},
    {id:'H1',x:-2.10,y:-1.18,z:.02,t:'H'},{id:'H2',x:-.50,y:-2.22,z:.24,t:'H'},{id:'H3',x:.95,y:-1.88,z:.12,t:'H'},
    {id:'H4',x:.52,y:1.95,z:-.18,t:'H'},{id:'H5',x:-2.55,y:1.28,z:.10,t:'H'},{id:'H6',x:-1.58,y:2.36,z:-.22,t:'H'},
    {id:'H7',x:3.80,y:-.18,z:.06,t:'H'},{id:'H8',x:2.62,y:-1.06,z:.04,t:'H'},{id:'H9',x:2.90,y:2.42,z:.10,t:'H'}
  ];
  const bonds=[['C1','C2'],['C2','C3'],['C3','C4'],['C4','C5'],['C5','C6'],['C6','C1'],['C1','H1'],['C2','H2'],['C3','H3'],['C5','H4'],['C6','C10'],['C10','H5'],['C10','H6'],['C4','C7'],['C7','C8'],['C8','H7'],['C8','H8'],['C7','C9'],['C9','H9']];
  function project(a){const cy=Math.cos(ry),sy=Math.sin(ry),cx=Math.cos(rx),sx=Math.sin(rx);let x=a.x*cy-a.z*sy,z=a.x*sy+a.z*cy,y=a.y*cx-z*sx;z=a.y*sx+z*cx;const scale=66/(1+z*.10);return{x:W/2+x*scale-20,y:H/2+y*scale+8,z,scale,type:a.t,id:a.id}}
  function draw(){ctx.clearRect(0,0,W,H);const bg=ctx.createRadialGradient(W*.52,H*.45,20,W*.52,H*.45,W*.62);bg.addColorStop(0,'rgba(30,64,175,.22)');bg.addColorStop(1,'rgba(2,6,23,0)');ctx.fillStyle=bg;ctx.fillRect(0,0,W,H);ctx.strokeStyle='rgba(56,189,248,.08)';ctx.lineWidth=1;for(let x=30;x<W;x+=34){ctx.beginPath();ctx.moveTo(x,25);ctx.lineTo(x,H-25);ctx.stroke()}for(let y=35;y<H;y+=34){ctx.beginPath();ctx.moveTo(28,y);ctx.lineTo(W-28,y);ctx.stroke()}const pts=Object.fromEntries(atoms.map(a=>[a.id,project(a)]));bonds.map(([a,b])=>({a:pts[a],b:pts[b],z:(pts[a].z+pts[b].z)/2})).sort((p,q)=>p.z-q.z).forEach(({a,b})=>{ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.lineWidth=5;ctx.strokeStyle='rgba(96,165,250,.82)';ctx.shadowColor='rgba(56,189,248,.28)';ctx.shadowBlur=9;ctx.stroke();ctx.shadowBlur=0});Object.values(pts).sort((a,b)=>a.z-b.z).forEach(p=>{const r=(p.type==='H'?7:13)*(1+p.z*.035);const grad=ctx.createRadialGradient(p.x-r*.35,p.y-r*.35,2,p.x,p.y,r*1.3);if(p.type==='H'){grad.addColorStop(0,'#ffffff');grad.addColorStop(1,'#cbd5e1')}else{grad.addColorStop(0,'#fed7aa');grad.addColorStop(.48,'#f97316');grad.addColorStop(1,'#7c2d12')}ctx.fillStyle=grad;ctx.beginPath();ctx.arc(p.x,p.y,Math.max(4,r),0,Math.PI*2);ctx.fill();ctx.lineWidth=1.5;ctx.strokeStyle=p.type==='H'?'rgba(255,255,255,.65)':'rgba(251,146,60,.9)';ctx.stroke();if(p.type==='C'){ctx.fillStyle='rgba(255,255,255,.86)';ctx.font='700 10px Inter, sans-serif';ctx.textAlign='center';ctx.fillText('C',p.x,p.y+3)}});ctx.fillStyle='rgba(226,232,240,.92)';ctx.font='800 15px Inter, sans-serif';ctx.textAlign='left';ctx.fillText('D-Limonene · interactive ball-stick projection',26,32);ctx.fillStyle='rgba(148,163,184,.9)';ctx.font='12px Inter, sans-serif';ctx.fillText('拖动可旋转；正式 GLB 文件已保存在 /models/limonene.glb',26,H-24);if(auto&&!drag){ry+=0.0045;rx+=0.0014}requestAnimationFrame(draw)}
  canvas.addEventListener('pointerdown',e=>{drag=true;auto=false;lastX=e.clientX;lastY=e.clientY;canvas.setPointerCapture(e.pointerId)});canvas.addEventListener('pointermove',e=>{if(!drag)return;ry+=(e.clientX-lastX)*.008;rx+=(e.clientY-lastY)*.008;lastX=e.clientX;lastY=e.clientY});canvas.addEventListener('pointerup',()=>{drag=false;setTimeout(()=>auto=true,2600)});draw();
})();

// V10 resource cards: make task sheet / lesson plan / safety note clickable.
(function(){
  function ensureDocModal(){
    let modal=document.getElementById('doc-modal-backdrop');
    if(modal) return modal;
    modal=document.createElement('div');
    modal.id='doc-modal-backdrop';
    modal.className='doc-modal-backdrop';
    modal.innerHTML='<div class="doc-modal-panel" role="dialog" aria-modal="true"><div class="doc-modal-head"><strong id="doc-modal-title">资源说明</strong><button type="button" class="doc-modal-close" aria-label="关闭">×</button></div><div id="doc-modal-content" class="doc-modal-content"></div></div>';
    document.body.appendChild(modal);
    modal.addEventListener('click',e=>{ if(e.target===modal) modal.classList.remove('open'); });
    modal.querySelector('.doc-modal-close').addEventListener('click',()=>modal.classList.remove('open'));
    document.addEventListener('keydown',e=>{ if(e.key==='Escape') modal.classList.remove('open'); });
    return modal;
  }
  document.querySelectorAll('.doc-open-card').forEach(card=>{
    card.addEventListener('click',()=>{
      const modal=ensureDocModal();
      modal.querySelector('#doc-modal-title').textContent=card.dataset.docTitle||'资源说明';
      modal.querySelector('#doc-modal-content').textContent=(card.dataset.docContent||'暂无内容').replace(/\\n/g,'\n');
      modal.classList.add('open');
    });
  });
})();

// V12 practice quiz: tab switching, MC answer checking, adaptive difficulty
(function(){
  let pqCorrect = 0;
  // Per-level stats: {correct, total} stored in localStorage
  const STORE_KEY = 'citrus_pq_stats';
  const LVL_TOTALS = {1:11, 2:12, 3:7};
  function loadStats(){ try{return JSON.parse(localStorage.getItem(STORE_KEY)||'{}')}catch{return{}} }
  function saveStats(s){ try{localStorage.setItem(STORE_KEY,JSON.stringify(s))}catch{} }
  let stats = loadStats();
  if(!stats[1]) stats[1]={c:0,t:0}; if(!stats[2]) stats[2]={c:0,t:0}; if(!stats[3]) stats[3]={c:0,t:0};

  function recLevel(){
    // recommend level based on accuracy: <40% stay, >75% advance, else stay
    for(let lv=1;lv<=3;lv++){
      const s=stats[lv]; if(!s||s.t<2) return lv; // not enough data → stay at this level
      const acc=s.c/s.t;
      if(acc<.4) return lv;
      if(acc>.75 && lv<3) continue; // advance
      return lv;
    }
    return 3;
  }

  function updateAdaptUI(){
    for(let lv=1;lv<=3;lv++){
      const s=stats[lv]||{c:0,t:0}, el=document.getElementById('pq-stat-'+lv);
      if(el) el.textContent = s.t>0 ? `${s.c}/${s.t} (${Math.round(s.c/s.t*100)}%)` : `0/${LVL_TOTALS[lv]}`;
    }
    const rec=recLevel();
    const tip=document.getElementById('pq-recommend-tip');
    const lvNames=['','基础','提升','拓展'];
    if(tip){
      const enough=Object.values(stats).some(s=>s.t>=2);
      tip.textContent = enough ? `推荐难度：${lvNames[rec]}（基于正确率自动调整）` : '完成2道以上选择题后，将根据正确率推荐难度';
    }
    // highlight/dim cards
    document.querySelectorAll('[data-level]').forEach(card=>{
      const lv=+card.dataset.level;
      card.classList.toggle('pq-recommended', lv===rec);
    });
    // update correct counter
    const el=document.getElementById('pq-correct'); if(el) el.textContent=String(pqCorrect);
  }

  let filterActive=false, filterLevel=1;
  window.pqFilterToggle=function(){
    filterActive=!filterActive;
    filterLevel=recLevel();
    const btn=document.getElementById('pq-filter-btn');
    if(btn) btn.classList.toggle('active',filterActive);
    document.querySelectorAll('[data-level]').forEach(card=>{
      if(!filterActive){ card.style.display=''; return; }
      card.style.display=(+card.dataset.level===filterLevel)?'':'none';
    });
  };

  window.pqSwitch = function(modId) {
    document.querySelectorAll('.pq-panel').forEach(p => p.classList.add('hidden'));
    document.querySelectorAll('.pq-tab').forEach(t => t.classList.toggle('active', t.dataset.mod === modId));
    const panel = document.getElementById('pqpanel-' + modId);
    if (panel) { panel.classList.remove('hidden'); panel.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  };

  window.pqAnswer = function(btn) {
    const qi = btn.dataset.qi;
    const card = document.getElementById('pqcard-' + qi);
    if (!card || card.classList.contains('pq-answered')) return;
    card.classList.add('pq-answered');
    const isCorrect = btn.dataset.correct === '1';
    const lv = +(card.dataset.level||1);
    // Track
    if(!stats[lv]) stats[lv]={c:0,t:0};
    stats[lv].t++; if(isCorrect) stats[lv].c++;
    saveStats(stats);
    // Save to backend (best-effort, no-throw)
    fetch('/api/practice/answer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({qid:qi,level:lv,correct:isCorrect,selected:+btn.dataset.oi})}).catch(()=>{});
    card.querySelectorAll('.pq-opt').forEach(o => {
      o.disabled = true;
      if (o.dataset.correct === '1') o.classList.add('pq-correct');
      else if (o === btn && !isCorrect) o.classList.add('pq-wrong');
    });
    const fb = document.getElementById('pqfb-' + qi);
    if (fb) {
      fb.style.display = 'block';
      fb.className = 'pq-feedback ' + (isCorrect ? 'pq-fb-correct' : 'pq-fb-wrong');
      fb.textContent = isCorrect ? '✓ 回答正确！' : '✗ 未选对，正确答案已用绿色标出。';
    }
    const explain = document.getElementById('pqex-' + qi);
    if (explain) explain.style.display = 'block';
    if (!isCorrect) {
      const questionText = card.querySelector('.pq-text')?.textContent || '';
      const selectedText = btn.textContent || '';
      const correctBtn = card.querySelector('.pq-opt[data-correct="1"]');
      const correctText = correctBtn ? correctBtn.textContent : '';
      const aiBox = document.createElement('div');
      aiBox.className = 'pq-ai-feedback';
      aiBox.innerHTML = '<div class="pq-ai-loading">AI 正在生成个性化解析……</div>';
      card.appendChild(aiBox);
      fetch('/api/llm/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: '题目：' + questionText + '\n学生选择了：' + selectedText + '\n正确答案是：' + correctText + '\n请针对学生的错误给出知识点解释。',
          scene: '_quiz_feedback',
          history: []
        })
      }).then(function(r) { return r.json(); }).then(function(data) {
        if (data.answer) {
          aiBox.innerHTML = '<div class="pq-ai-label">AI 个性化反馈</div><div class="pq-ai-body">' + escapeHtml(data.answer).replace(/\n/g, '<br>') + '</div>';
        } else {
          aiBox.innerHTML = '';
        }
      }).catch(function() { aiBox.innerHTML = ''; });
    }
    if (isCorrect) pqCorrect++;
    updateAdaptUI();
    // If filter is active and recommended level changed, refresh filter
    if(filterActive){ const newRec=recLevel(); if(newRec!==filterLevel){ filterLevel=newRec; document.querySelectorAll('[data-level]').forEach(c=>{ c.style.display=(+c.dataset.level===filterLevel)?'':'none'; }); } }
  };

  updateAdaptUI();
})();

// V11 true GLB viewer: renders the uploaded limonene.glb locally with raw WebGL.
// No CDN, no external runtime dependency; falls back to the 2D structure block when WebGL/GLB fails.
(function(){
  const viewers = document.querySelectorAll('.glb-viewer');
  if(!viewers.length) return;

  const COMP_SIZE = {5120:1,5121:1,5122:2,5123:2,5125:4,5126:4};
  const TYPE_SIZE = {SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16};

  function readGlb(arrayBuffer){
    const dv = new DataView(arrayBuffer);
    if(dv.getUint32(0,true)!==0x46546c67) throw new Error('不是有效 GLB 文件');
    let offset=12, json=null, bin=null;
    while(offset < arrayBuffer.byteLength){
      const len=dv.getUint32(offset,true), type=dv.getUint32(offset+4,true);
      const start=offset+8;
      if(type===0x4e4f534a){
        json=JSON.parse(new TextDecoder().decode(new Uint8Array(arrayBuffer,start,len)));
      }else if(type===0x004e4942){
        bin=arrayBuffer.slice(start,start+len);
      }
      offset=start+len;
      offset += (4 - (offset % 4)) % 4;
    }
    if(!json || !bin) throw new Error('GLB 缺少 JSON 或 BIN 数据');
    return {json,bin};
  }
  function componentReader(dv, type){
    if(type===5126) return (o)=>dv.getFloat32(o,true);
    if(type===5125) return (o)=>dv.getUint32(o,true);
    if(type===5123) return (o)=>dv.getUint16(o,true);
    if(type===5121) return (o)=>dv.getUint8(o);
    if(type===5122) return (o)=>dv.getInt16(o,true);
    if(type===5120) return (o)=>dv.getInt8(o);
    throw new Error('不支持的 componentType: '+type);
  }
  function accessorArray(gltf, bin, index){
    const acc=gltf.accessors[index];
    const bv=gltf.bufferViews[acc.bufferView];
    const comps=TYPE_SIZE[acc.type]||1;
    const compBytes=COMP_SIZE[acc.componentType];
    const elemBytes=comps*compBytes;
    const stride=bv.byteStride||elemBytes;
    const base=(bv.byteOffset||0)+(acc.byteOffset||0);
    const dv=new DataView(bin);
    const read=componentReader(dv, acc.componentType);
    const out = acc.componentType===5126 ? new Float32Array(acc.count*comps) : new Uint32Array(acc.count*comps);
    for(let i=0;i<acc.count;i++){
      const off=base+i*stride;
      for(let c=0;c<comps;c++) out[i*comps+c]=read(off+c*compBytes);
    }
    return out;
  }
  function identity(){return [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];}
  function mul(a,b){
    const o=new Array(16).fill(0);
    for(let r=0;r<4;r++) for(let c=0;c<4;c++) for(let k=0;k<4;k++) o[c*4+r]+=a[k*4+r]*b[c*4+k];
    return o;
  }
  function fromNode(n){
    if(n.matrix) return n.matrix.slice();
    const t=n.translation||[0,0,0], s=n.scale||[1,1,1], q=n.rotation||[0,0,0,1];
    const [x,y,z,w]=q;
    const x2=x+x,y2=y+y,z2=z+z;
    const xx=x*x2,xy=x*y2,xz=x*z2, yy=y*y2,yz=y*z2,zz=z*z2, wx=w*x2,wy=w*y2,wz=w*z2;
    return [
      (1-(yy+zz))*s[0], (xy+wz)*s[0], (xz-wy)*s[0], 0,
      (xy-wz)*s[1], (1-(xx+zz))*s[1], (yz+wx)*s[1], 0,
      (xz+wy)*s[2], (yz-wx)*s[2], (1-(xx+yy))*s[2], 0,
      t[0],t[1],t[2],1
    ];
  }
  function transformPoint(m,x,y,z){
    return [m[0]*x+m[4]*y+m[8]*z+m[12], m[1]*x+m[5]*y+m[9]*z+m[13], m[2]*x+m[6]*y+m[10]*z+m[14]];
  }
  function transformNormal(m,x,y,z){
    const nx=m[0]*x+m[4]*y+m[8]*z, ny=m[1]*x+m[5]*y+m[9]*z, nz=m[2]*x+m[6]*y+m[10]*z;
    const l=Math.hypot(nx,ny,nz)||1; return [nx/l,ny/l,nz/l];
  }
  function materialColor(gltf, matIndex){
    const mat=gltf.materials?.[matIndex];
    const c=mat?.pbrMetallicRoughness?.baseColorFactor;
    if(Array.isArray(c)) return [c[0],c[1],c[2],c[3]??1];
    const name=(mat?.name||'').toLowerCase();
    if(name.includes('hydrogen')) return [.92,.96,1,1];
    if(name.includes('carbon')) return [.96,.42,.12,1];
    return [.94,.45,.13,1];
  }
  function extractMeshes(gltf,bin){
    const prims=[];
    function visit(nodeIndex,parent){
      const node=gltf.nodes[nodeIndex];
      const mat=mul(parent,fromNode(node||{}));
      if(node.mesh!==undefined){
        const mesh=gltf.meshes[node.mesh];
        for(const p of mesh.primitives||[]){
          if(p.mode!==undefined && p.mode!==4) continue; // triangles only
          const pos=accessorArray(gltf,bin,p.attributes.POSITION);
          const nor=p.attributes.NORMAL!==undefined ? accessorArray(gltf,bin,p.attributes.NORMAL) : null;
          const ind=p.indices!==undefined ? accessorArray(gltf,bin,p.indices) : null;
          const tp=new Float32Array(pos.length), tn=new Float32Array(pos.length);
          for(let i=0;i<pos.length;i+=3){
            const v=transformPoint(mat,pos[i],pos[i+1],pos[i+2]); tp.set(v,i);
            const n=nor ? transformNormal(mat,nor[i],nor[i+1],nor[i+2]) : transformNormal(mat,pos[i],pos[i+1],pos[i+2]); tn.set(n,i);
          }
          prims.push({pos:tp,nor:tn,ind,color:materialColor(gltf,p.material)});
        }
      }
      for(const ch of node.children||[]) visit(ch,mat);
    }
    const scene=gltf.scenes?.[gltf.scene||0] || {nodes:gltf.nodes?.map((_,i)=>i)||[]};
    for(const n of scene.nodes||[]) visit(n,identity());
    return prims;
  }
  function compile(gl,type,src){const sh=gl.createShader(type);gl.shaderSource(sh,src);gl.compileShader(sh);if(!gl.getShaderParameter(sh,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));return sh;}
  function program(gl,vs,fs){const p=gl.createProgram();gl.attachShader(p,compile(gl,gl.VERTEX_SHADER,vs));gl.attachShader(p,compile(gl,gl.FRAGMENT_SHADER,fs));gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));return p;}
  function perspective(fov,aspect,near,far){const f=1/Math.tan(fov/2), nf=1/(near-far);return [f/aspect,0,0,0, 0,f,0,0, 0,0,(far+near)*nf,-1, 0,0,(2*far*near)*nf,0];}
  function lookAt(eye,center,up){
    let zx=eye[0]-center[0],zy=eye[1]-center[1],zz=eye[2]-center[2]; let zl=Math.hypot(zx,zy,zz)||1; zx/=zl;zy/=zl;zz/=zl;
    let xx=up[1]*zz-up[2]*zy,xy=up[2]*zx-up[0]*zz,xz=up[0]*zy-up[1]*zx; let xl=Math.hypot(xx,xy,xz)||1; xx/=xl;xy/=xl;xz/=xl;
    const yx=zy*xz-zz*xy, yy=zz*xx-zx*xz, yz=zx*xy-zy*xx;
    return [xx,yx,zx,0, xy,yy,zy,0, xz,yz,zz,0, -(xx*eye[0]+xy*eye[1]+xz*eye[2]), -(yx*eye[0]+yy*eye[1]+yz*eye[2]), -(zx*eye[0]+zy*eye[1]+zz*eye[2]), 1];
  }
  function rotXY(rx,ry){const cx=Math.cos(rx),sx=Math.sin(rx),cy=Math.cos(ry),sy=Math.sin(ry);return [cy,sx*sy,-cx*sy,0, 0,cx,sx,0, sy,-sx*cy,cx*cy,0, 0,0,0,1];}
  function renderViewer(viewer){
    const canvas=viewer.querySelector('canvas'); const gl=canvas.getContext('webgl',{antialias:true,alpha:true});
    if(!gl) throw new Error('当前浏览器不支持 WebGL');
    const vs='attribute vec3 aP;attribute vec3 aN;uniform mat4 uM;uniform mat4 uPV;uniform vec3 uC;uniform float uS;varying vec3 vN;varying vec3 vP;void main(){vec3 p=(aP-uC)*uS;vec4 wp=uM*vec4(p,1.0);vP=wp.xyz;vN=mat3(uM)*aN;gl_Position=uPV*wp;}';
    const fs='precision mediump float;uniform vec4 uColor;varying vec3 vN;varying vec3 vP;void main(){vec3 n=normalize(vN);vec3 l=normalize(vec3(0.45,0.75,0.55));float d=max(dot(n,l),0.0);float rim=pow(1.0-max(dot(n,normalize(vec3(0.0,0.0,1.0))),0.0),2.0);vec3 col=uColor.rgb*(0.38+0.70*d)+vec3(0.20,0.45,0.95)*rim*0.28;gl_FragColor=vec4(col,uColor.a);}';
    const prog=program(gl,vs,fs); const loc={p:gl.getAttribLocation(prog,'aP'),n:gl.getAttribLocation(prog,'aN'),m:gl.getUniformLocation(prog,'uM'),pv:gl.getUniformLocation(prog,'uPV'),c:gl.getUniformLocation(prog,'uC'),s:gl.getUniformLocation(prog,'uS'),color:gl.getUniformLocation(prog,'uColor')};
    return fetch(viewer.dataset.model).then(r=>{if(!r.ok) throw new Error('无法读取模型文件'); return r.arrayBuffer();}).then(buf=>{
      const {json,bin}=readGlb(buf); const prims=extractMeshes(json,bin); if(!prims.length) throw new Error('模型中未找到可渲染三角网格');
      let min=[Infinity,Infinity,Infinity], max=[-Infinity,-Infinity,-Infinity];
      prims.forEach(pr=>{for(let i=0;i<pr.pos.length;i+=3){for(let k=0;k<3;k++){min[k]=Math.min(min[k],pr.pos[i+k]);max[k]=Math.max(max[k],pr.pos[i+k]);}}});
      const center=[(min[0]+max[0])/2,(min[1]+max[1])/2,(min[2]+max[2])/2]; const size=Math.max(max[0]-min[0],max[1]-min[1],max[2]-min[2])||1; const scale=2.9/size;
      const gpu=prims.map(pr=>{const pb=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,pb);gl.bufferData(gl.ARRAY_BUFFER,pr.pos,gl.STATIC_DRAW);const nb=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,nb);gl.bufferData(gl.ARRAY_BUFFER,pr.nor,gl.STATIC_DRAW);let ib=null,count=pr.ind?pr.ind.length:pr.pos.length/3,type=null;if(pr.ind){ib=gl.createBuffer();gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,ib); const useUint=pr.ind.length>65535 || Math.max(...Array.from(pr.ind.slice(0,Math.min(5000,pr.ind.length))))>65535; if(useUint && !gl.getExtension('OES_element_index_uint')){ib=null; count=pr.pos.length/3;} else {const data=useUint?new Uint32Array(pr.ind):new Uint16Array(pr.ind); type=useUint?gl.UNSIGNED_INT:gl.UNSIGNED_SHORT; gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,data,gl.STATIC_DRAW); count=data.length;}} return {...pr,pb,nb,ib,count,type};});
      let rx=-0.38, ry=0.72, dragging=false, lx=0, ly=0, auto=true;
      function resize(){const rect=viewer.getBoundingClientRect();const dpr=Math.min(window.devicePixelRatio||1,2);const w=Math.max(320,Math.floor(rect.width*dpr));const h=Math.max(320,Math.floor((viewer.clientHeight||420)*dpr));if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;gl.viewport(0,0,w,h);}}
      canvas.addEventListener('pointerdown',e=>{dragging=true;auto=false;lx=e.clientX;ly=e.clientY;canvas.setPointerCapture(e.pointerId);});
      canvas.addEventListener('pointermove',e=>{if(!dragging)return;ry+=(e.clientX-lx)*0.008;rx+=(e.clientY-ly)*0.008;lx=e.clientX;ly=e.clientY;});
      canvas.addEventListener('pointerup',()=>{dragging=false;setTimeout(()=>auto=true,2200)});
      window.addEventListener('resize',resize);
      gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE); gl.clearColor(0,0,0,0);
      function frame(){resize(); if(auto) ry+=0.004; gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT); gl.useProgram(prog); const aspect=canvas.width/canvas.height; const pv=mul(perspective(Math.PI/4,aspect,0.1,100),lookAt([0,0.25,6.2],[0,0,0],[0,1,0])); gl.uniformMatrix4fv(loc.pv,false,new Float32Array(pv)); gl.uniformMatrix4fv(loc.m,false,new Float32Array(rotXY(rx,ry))); gl.uniform3fv(loc.c,new Float32Array(center)); gl.uniform1f(loc.s,scale); for(const pr of gpu){gl.uniform4fv(loc.color,new Float32Array(pr.color)); gl.bindBuffer(gl.ARRAY_BUFFER,pr.pb); gl.vertexAttribPointer(loc.p,3,gl.FLOAT,false,0,0); gl.enableVertexAttribArray(loc.p); gl.bindBuffer(gl.ARRAY_BUFFER,pr.nb); gl.vertexAttribPointer(loc.n,3,gl.FLOAT,false,0,0); gl.enableVertexAttribArray(loc.n); if(pr.ib){gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,pr.ib); gl.drawElements(gl.TRIANGLES,pr.count,pr.type,0);} else gl.drawArrays(gl.TRIANGLES,0,pr.count);} requestAnimationFrame(frame); }
      viewer.classList.add('loaded'); frame();
    });
  }
viewers.forEach(v=>renderViewer(v).catch(err=>{console.warn('GLB viewer failed:',err); v.classList.add('failed'); const loading=v.querySelector('.glb-loading'); if(loading) loading.textContent='3D 模型暂未加载：'+err.message+'。可查看下方 2D 标准拓扑结构。';}));
})();

// V13 – Clevenger Apparatus Canvas (round-bottom flask → vertical condenser → Clevenger trap)
(function(){
  const cvs = document.getElementById('dsim-canvas');
  if(!cvs) return;
  const ctx = cvs.getContext('2d');
  const DPR = Math.min(window.devicePixelRatio||1, 2);
  function fit(){
    const pw = (cvs.parentElement?.clientWidth||520) - 32;
    const W = Math.max(300, pw), H = Math.round(W * 0.55);
    cvs.style.width = W+'px'; cvs.style.height = H+'px';
    cvs.width = W*DPR; cvs.height = H*DPR;
  }
  fit(); window.addEventListener('resize', ()=>{ fit(); drawD(performance.now()); });

  const concSel = document.getElementById('dsim-conc');
  const slider  = document.getElementById('dsim-slider');
  const playBtn = document.getElementById('dsim-play');
  const SF = {0:.72, 1:.9, 3:1.16, 4:1.02};
  function conc(){ return +(concSel?.value||3); }
  function sf(){ return SF[conc()]||1; }
  function prog(t){ return Math.max(0, Math.min(1, (1-Math.exp(-t/18))*sf())); }
  function drainOpenAt(t){ return t>=22 && t<56 && ((t-14)%12)>9.2; }
  function drainOpenFrac(t){ return drainOpenAt(t) ? Math.max(0, Math.min(1, (((t-14)%12)-9.2)/2.8)) : 0; }
  function phaseOf(t){
    if(t<8) return {n:'预热中',c:'#f59e0b'};
    if(t<22) return {n:'蒸发冷凝',c:'#f97316'};
    if(drainOpenAt(t)) return {n:'旋开放水',c:'#0284c7'};
    if(t<54) return {n:'油水分层',c:'#10b981'};
    return {n:'分离收集精油',c:'#2563eb'};
  }
  function setEl(id,text,color){ const e=document.getElementById(id); if(!e)return; e.textContent=text; if(color)e.style.color=color; }

  let simT=0, playing=false, lastTs=null, raf=null, spawnTs=0;
  const VP=[];

  function lerpPt(pts,t){ const n=pts.length-1,seg=Math.min(n-1,Math.floor(t*n)),lt=(t*n)-seg; return [pts[seg][0]+(pts[seg+1][0]-pts[seg][0])*lt,pts[seg][1]+(pts[seg+1][1]-pts[seg][1])*lt]; }

  function drawD(ts){
    if(playing){
      if(lastTs!=null){ const dt=Math.min(0.08,(ts-lastTs)/1000); simT=Math.min(60,simT+dt*5); }
      lastTs=ts;
      if(simT>=60){ playing=false; if(playBtn) playBtn.textContent='↺ 重播'; }
    }
    const W=cvs.width/DPR, H=cvs.height/DPR;
    const p=prog(simT), ph=phaseOf(simT), c=conc();
    setEl('dsim-time',Math.round(simT)+' min');
    setEl('dsim-phase',ph.n,ph.c); setEl('dsim-stage',ph.n,ph.c);
    setEl('dsim-yield',(p*1.42*sf()).toFixed(2)+'%');
    setEl('dsim-effect',c===0?'对照组':c===3?'已测观察组':c===4?'注意乳化':c+'%梯度');
    if(slider) slider.value=String(Math.round(simT));

    ctx.save(); ctx.scale(DPR,DPR);

    // ── Background ──────────────────────────────────────────────
    ctx.fillStyle='#fefcfb';
    ctx.beginPath(); if(ctx.roundRect) ctx.roundRect(0,0,W,H,14); else ctx.rect(0,0,W,H);
    ctx.fill();

    // ── Coordinates (compact, everything fits within H) ──────────
    const FR = Math.min(W*.085, H*.17);          // flask radius
    const FL = {cx:W*.43, cy:H*.58, r:FR};       // flask center
    const NW = FR*.28;                            // neck half-width
    const NECK_TOP = FL.cy - FR - FR*.65;         // where flask neck meets side arm
    // Condenser: tall vertical tube, then outlet into the side receiver.
    const CND = {cx:W*.58, top:H*.07, bot:H*.45, hw:11};
    // Clevenger trap: graduated receiver with stopcock and drain tip.
    const CLV = {
      cx: W*.68,
      top: H*.20,
      grle: H*.46,
      tw: 11,
      bw: Math.min(22,W*.038)
    };
    const valveY = CLV.grle + H*.045;
    const drainY = valveY + H*.12;

    // ── Heating mantle ──────────────────────────────────────────
    const mantleY = FL.cy + FR;
    ctx.save();
    ctx.beginPath();
    if(ctx.roundRect) ctx.roundRect(FL.cx-FR*1.18, FL.cy+FR*.28, FR*2.36, FR*.82, 8);
    else ctx.rect(FL.cx-FR*1.18, FL.cy+FR*.28, FR*2.36, FR*.82);
    ctx.fillStyle='rgba(148,163,184,.16)';
    ctx.fill();
    ctx.strokeStyle='rgba(100,116,139,.45)';
    ctx.lineWidth=1.4;
    ctx.stroke();
    ctx.restore();
    ctx.beginPath();
    ctx.ellipse(FL.cx, mantleY, FR*.84, FR*.19, 0, 0, Math.PI);
    ctx.fillStyle='#475569'; ctx.fill();
    // small digital display on mantle
    const dW=42, dH=14, dX=FL.cx-dW/2, dY=mantleY+2;
    ctx.beginPath(); if(ctx.roundRect) ctx.roundRect(dX,dY,dW,dH,3); else ctx.rect(dX,dY,dW,dH);
    ctx.fillStyle='#1e293b'; ctx.fill();
    ctx.fillStyle='#4ade80'; ctx.font=`bold ${Math.max(7,H*.038)}px monospace`; ctx.textAlign='center';
    ctx.fillText(simT<8?'38°C':simT<22?`${Math.round(58+simT*1.9)}°C`:'98°C', FL.cx, dY+dH-2);

    // ── Flame ────────────────────────────────────────────────────
    if(simT>0.5){
      const fi=Math.min(1,simT/8), flk=1+Math.sin(ts/100)*.22;
      for(let f=0;f<3;f++){
        const fx=FL.cx-7+f*7, fy=mantleY+1, fh=(13+f*3)*fi*flk;
        const g=ctx.createRadialGradient(fx,fy,0,fx,fy-fh*.5,fh);
        g.addColorStop(0,'rgba(253,224,71,.9)'); g.addColorStop(.4,'rgba(249,115,22,.8)'); g.addColorStop(1,'rgba(239,68,68,0)');
        ctx.beginPath(); ctx.ellipse(fx,fy-fh*.35,3.5,fh*.75,0,0,Math.PI*2); ctx.fillStyle=g; ctx.fill();
      }
    }

    // ── Flask body ───────────────────────────────────────────────
    ctx.save();
    ctx.beginPath(); ctx.arc(FL.cx,FL.cy,FR,0,Math.PI*2);
    ctx.fillStyle='rgba(255,255,255,0.5)'; ctx.fill(); ctx.clip();
    // flask starts with the most water; water/oil vapor leaves the flask as distillation proceeds.
    const waterRemain = Math.max(.28, 1 - simT/74);
    const liqH = FR*(.55 + waterRemain*1.05);
    const liqY = FL.cy + FR - liqH;
    ctx.fillStyle='rgba(219,234,254,0.78)';
    ctx.fillRect(FL.cx-FR, liqY, FR*2, FL.cy+FR-liqY+2);
    // orange peel sediment
    ctx.fillStyle='rgba(251,146,60,.42)';
    ctx.fillRect(FL.cx-FR, FL.cy+FR-FR*.48, FR*2, FR*.48);
    // bubbles
    if(simT>5&&p>0.07) for(let b=0;b<5;b++){
      const bx=FL.cx-13+((b*13+Math.floor(simT*3))%26), by=liqY+3+((b*17+Math.floor(simT*5))%16);
      if(by<FL.cy+FR-4){ ctx.beginPath(); ctx.arc(bx,by,2,0,Math.PI*2); ctx.strokeStyle='rgba(255,255,255,.7)'; ctx.lineWidth=1; ctx.stroke(); }
    }
    ctx.restore();
    ctx.beginPath(); ctx.arc(FL.cx,FL.cy,FR,0,Math.PI*2);
    ctx.strokeStyle='#94a3b8'; ctx.lineWidth=2; ctx.stroke();

    // ── Flask neck (vertical upward) ─────────────────────────────
    const NY1=FL.cy-FR+2;
    ctx.beginPath();
    ctx.moveTo(FL.cx-NW,NY1); ctx.lineTo(FL.cx-NW,NECK_TOP);
    ctx.lineTo(FL.cx+NW,NECK_TOP); ctx.lineTo(FL.cx+NW,NY1);
    ctx.strokeStyle='#94a3b8'; ctx.lineWidth=1.8; ctx.stroke();

    // ── Side arm: neck top → condenser bottom (steam path) ───────
    ctx.beginPath();
    ctx.moveTo(FL.cx+NW, NECK_TOP);
    ctx.bezierCurveTo(FL.cx+FR*.8, NECK_TOP-6, CND.cx-CND.hw*2.4, CND.bot-20, CND.cx, CND.bot-8);
    ctx.strokeStyle='#94a3b8'; ctx.lineWidth=1.8; ctx.stroke();

    // ── Condenser: vertical Liebig-style with water jacket ────────
    // outer jacket (light-blue filled)
    ctx.beginPath();
    if(ctx.roundRect) ctx.roundRect(CND.cx-CND.hw-3,CND.top,(CND.hw+3)*2,CND.bot-CND.top,9);
    else ctx.rect(CND.cx-CND.hw-3,CND.top,(CND.hw+3)*2,CND.bot-CND.top);
    ctx.fillStyle='rgba(219,234,254,0.52)'; ctx.fill();
    ctx.strokeStyle='#93c5fd'; ctx.lineWidth=1.5; ctx.stroke();
    // inner glass tube
    ctx.beginPath();
    if(ctx.roundRect) ctx.roundRect(CND.cx-CND.hw*.5,CND.top+5,CND.hw,CND.bot-CND.top-10,5);
    else ctx.rect(CND.cx-CND.hw*.5,CND.top+5,CND.hw,CND.bot-CND.top-10);
    ctx.strokeStyle='#60a5fa'; ctx.lineWidth=1.4; ctx.stroke();
    // characteristic diamond-segment rings (Liebig condenser look)
    const NSEG=6, segH=(CND.bot-CND.top-18)/NSEG;
    for(let i=0;i<NSEG;i++){
      const sy=CND.top+9+i*segH+segH*.5;
      ctx.beginPath(); ctx.ellipse(CND.cx, sy, CND.hw+2, 3.5, 0, 0, Math.PI*2);
      ctx.strokeStyle='rgba(147,197,253,.4)'; ctx.lineWidth=1.2; ctx.stroke();
    }
    // cooling water inlet/outlet side tubes
    ctx.beginPath(); ctx.moveTo(CND.cx+CND.hw+3,CND.top+10); ctx.lineTo(CND.cx+CND.hw+14,CND.top+10);
    ctx.strokeStyle='#93c5fd'; ctx.lineWidth=1.5; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(CND.cx+CND.hw+3,CND.bot-10); ctx.lineTo(CND.cx+CND.hw+14,CND.bot-10);
    ctx.strokeStyle='#93c5fd'; ctx.lineWidth=1.5; ctx.stroke();
    ctx.fillStyle='#93c5fd'; ctx.font=`${Math.max(8,H*.034)}px Inter,sans-serif`; ctx.textAlign='left';
    ctx.fillText('出水',CND.cx+CND.hw+16, CND.top+14);
    ctx.fillText('进水',CND.cx+CND.hw+16, CND.bot-6);
    // animated cooling-water drops (upward, counter-current)
    for(let w=0;w<4;w++){
      const segL=CND.bot-CND.top-20;
      const wy=CND.bot-10-((w*segL/4+(ts/90*segL/4))%segL);
      ctx.beginPath(); ctx.arc(CND.cx+CND.hw+6,wy,2.2,0,Math.PI*2);
      ctx.fillStyle='rgba(96,165,250,.55)'; ctx.fill();
    }
    // condensate drops running down inside inner tube (simT>10)
    if(simT>10){
      const dp=Math.min(1,(simT-10)/14);
      for(let d=0;d<3;d++){
        const dL=CND.bot-CND.top-18;
        const doff=(d*dL/3+(ts/550*dL))%dL;
        const dy=CND.top+9+doff;
        if(dy>CND.top+6&&dy<CND.bot-6){ ctx.beginPath(); ctx.arc(CND.cx,dy,2.2+dp*.7,0,Math.PI*2); ctx.fillStyle='rgba(96,165,250,.78)'; ctx.fill(); }
      }
    }

    // ── Connection: condenser outlet → Clevenger receiver ─────────
    ctx.beginPath();
    ctx.moveTo(CND.cx+CND.hw*.55, CND.bot-16);
    ctx.bezierCurveTo(CND.cx+22, CND.bot-16, CLV.cx-20, CLV.top+10, CLV.cx, CLV.top+10);
    ctx.strokeStyle='#94a3b8'; ctx.lineWidth=1.8; ctx.stroke();

    // ── Clevenger trap (graduated tube + stopcock + drain tip) ─────
    const TW=CLV.tw, BW=CLV.bw;
    // --- fills first (behind glass walls) ---
    const drainOpen = drainOpenAt(simT);
    const receiverTop = CLV.top+12;
    const receiverH = CLV.grle - receiverTop;
    const earlyFill = Math.max(0, Math.min(1, (simT-8)/16));
    const fillCycle = simT<22 ? earlyFill*.68 : .28 + (((simT-22)%12)/12)*.52;
    const drainFill = .42 - drainOpenFrac(simT)*.22;
    const waterFill = simT<8 ? 0 : Math.max(0, Math.min(.86, drainOpen ? drainFill : fillCycle));
    // The receiver starts empty; water and a small amount of oil arrive together with condensate.
    const waterH = Math.max(0, Math.min(receiverH*.86, receiverH*waterFill));
    const oilH = simT<8 ? 0 : Math.max(0, Math.min(receiverH*.075, p*H*.012));
    const waterTop = CLV.grle - waterH;
    const oilTop = Math.max(receiverTop, waterTop - oilH);
    if(waterTop<CLV.grle-2){
      ctx.fillStyle='rgba(96,165,250,0.78)';
      ctx.fillRect(CLV.cx-TW+1, waterTop, (TW-1)*2, CLV.grle-waterTop);
    }
    if(oilH>2){
      ctx.fillStyle='rgba(251,191,36,0.88)';
      ctx.fillRect(CLV.cx-TW+1, oilTop, (TW-1)*2, oilH);
    }
    // --- glass walls of graduated tube ---
    ctx.beginPath();
    if(ctx.roundRect) ctx.roundRect(CLV.cx-TW, CLV.top+8, TW*2, CLV.grle-CLV.top-8, 5);
    else ctx.rect(CLV.cx-TW, CLV.top+8, TW*2, CLV.grle-CLV.top-8);
    ctx.strokeStyle='#94a3b8'; ctx.lineWidth=1.6; ctx.stroke();
    // graduation marks (right side) with mL labels
    ctx.fillStyle='#94a3b8'; ctx.font=`${Math.max(7,H*.027)}px Inter,sans-serif`; ctx.textAlign='left';
    for(let g=0;g<5;g++){
      const gy=CLV.top+12+g*((CLV.grle-CLV.top-12)/4);
      ctx.beginPath(); ctx.moveTo(CLV.cx+TW,gy); ctx.lineTo(CLV.cx+TW+5,gy);
      ctx.strokeStyle='#94a3b8'; ctx.lineWidth=1; ctx.stroke();
      ctx.fillText(String(4-g)+'ml', CLV.cx+TW+7, gy+3.5);
    }
    // narrow glass neck leading to stopcock
    ctx.beginPath();
    ctx.moveTo(CLV.cx-TW+3, CLV.grle);
    ctx.bezierCurveTo(CLV.cx-9, CLV.grle+8, CLV.cx-8, valveY-9, CLV.cx-8, valveY);
    ctx.moveTo(CLV.cx+TW-3, CLV.grle);
    ctx.bezierCurveTo(CLV.cx+9, CLV.grle+8, CLV.cx+8, valveY-9, CLV.cx+8, valveY);
    ctx.strokeStyle='#94a3b8'; ctx.lineWidth=1.6; ctx.stroke();
    // stopcock valve: blue horizontal handle and round plug, like the reference inset
    ctx.beginPath(); ctx.moveTo(CLV.cx-BW, valveY); ctx.lineTo(CLV.cx+BW, valveY);
    ctx.strokeStyle='#1d4ed8'; ctx.lineWidth=6; ctx.lineCap='round'; ctx.stroke();
    ctx.lineCap='butt';
    ctx.beginPath();
    ctx.arc(CLV.cx,valveY,9,0,Math.PI*2);
    ctx.fillStyle='#3b82f6'; ctx.fill(); ctx.strokeStyle='#1e3a8a'; ctx.lineWidth=1.6; ctx.stroke();
    // tapered drain tip below the stopcock
    ctx.beginPath();
    ctx.moveTo(CLV.cx-7,valveY+9);
    ctx.bezierCurveTo(CLV.cx-5, valveY+22, CLV.cx-2, drainY-6, CLV.cx, drainY);
    ctx.bezierCurveTo(CLV.cx+2, drainY-6, CLV.cx+5, valveY+22, CLV.cx+7, valveY+9);
    ctx.strokeStyle='#94a3b8'; ctx.lineWidth=1.5; ctx.stroke();
    if(drainOpen){
      for(let d=0;d<4;d++){
        const dy=drainY+4+((d*9+ts/70)%34);
        ctx.beginPath(); ctx.arc(CLV.cx+(d%2?2:-2),dy,2.1,0,Math.PI*2);
        ctx.fillStyle='rgba(96,165,250,.72)'; ctx.fill();
      }
    }

    // ── Vapor/condensate particles: flask → condenser → Clevenger ─
    const vPath=[
      [FL.cx, NECK_TOP-3],
      [FL.cx+NW+8, NECK_TOP-2],
      [(FL.cx+CND.cx)/2+8, NECK_TOP-6],
      [CND.cx, CND.bot-6],
      [CND.cx, CND.top+16],
      [(CND.cx+CLV.cx)/2, CND.top+8],
      [CLV.cx, CLV.top+16]
    ];
    if(simT>4&&simT<58&&p>0.04&&(ts-spawnTs)>100/Math.max(.1,p*2)){
      spawnTs=ts; VP.push({t:0,sp:0.0038+Math.random()*.004,r:2+Math.random()*2,wb:Math.random()*Math.PI*2});
    }
    for(let i=VP.length-1;i>=0;i--){
      const vp=VP[i]; vp.t=Math.min(1,vp.t+vp.sp);
      if(vp.t>=1){VP.splice(i,1);continue;}
      const [px,py]=lerpPt(vPath,vp.t);
      const wb=Math.sin(vp.t*16+vp.wb)*2;
      const alpha=vp.t<.5?0.52:Math.max(0,0.52-(vp.t-.5)*2.4);
      if(alpha<=0){VP.splice(i,1);continue;}
      ctx.beginPath(); ctx.arc(px+wb,py,vp.r*(1-vp.t*.35),0,Math.PI*2);
      ctx.fillStyle=`rgba(96,165,250,${alpha.toFixed(2)})`; ctx.fill();
    }

    // ── Labels ────────────────────────────────────────────────────
    const LFS=Math.max(9,H*.036);
    ctx.font=`bold ${LFS}px Inter,sans-serif`; ctx.fillStyle='#64748b'; ctx.textAlign='center';
    // flask label: below the mantle display, safely within canvas
    ctx.fillText('蒸馏烧瓶', FL.cx, dY+dH+LFS+2);
    // condenser label: below the condenser
    ctx.fillText('冷凝管', CND.cx, CND.bot+LFS+4);
    // Clevenger label: right of the tube
    ctx.textAlign='left';
    ctx.fillText('Clevenger', CLV.cx+BW+10, CLV.grle-LFS*.5);
    ctx.fillText('分水器', CLV.cx+BW+10, CLV.grle+LFS*.5+2);
    // oil accumulation annotation
    if(oilH>8){
      ctx.fillStyle='#92400e'; ctx.font=`bold ${Math.max(8,H*.031)}px Inter,sans-serif`; ctx.textAlign='right';
      ctx.fillText('精油↑', CLV.cx-TW-4, oilTop+oilH*.5+3);
    }
    if(drainOpen){
      ctx.fillStyle='#1e40af'; ctx.font=`${Math.max(8,H*.030)}px Inter,sans-serif`; ctx.textAlign='center';
      ctx.fillText('放出水相', CLV.cx, drainY+H*.10);
    }else if(simT>22&&simT<54){
      ctx.fillStyle='#1e40af'; ctx.font=`${Math.max(8,H*.030)}px Inter,sans-serif`; ctx.textAlign='right';
      ctx.fillText('水相待放出', CLV.cx-TW-4, waterTop+Math.max(8, waterH*.5));
    }

    ctx.restore();
    if(playing||VP.length>0) raf=requestAnimationFrame(drawD);
  }

  if(slider){ slider.addEventListener('input',()=>{ simT=+slider.value; if(!playing){cancelAnimationFrame(raf);drawD(performance.now());} }); }
  if(concSel){ concSel.addEventListener('change',()=>{ if(!playing){cancelAnimationFrame(raf);drawD(performance.now());} }); }
  if(playBtn){ playBtn.addEventListener('click',()=>{ if(simT>=59) simT=0; playing=!playing; playBtn.textContent=playing?'⏸ 暂停':'▶ 播放'; if(playing){lastTs=null;raf=requestAnimationFrame(drawD);}else cancelAnimationFrame(raf); }); }
  drawD(performance.now());
})();

// V14 – Inhibition zone Canvas (real-time two-dish comparison)
(function(){
  const cvs = document.getElementById('isim-canvas');
  if(!cvs) return;
  const ctx = cvs.getContext('2d');
  const DPR = Math.min(window.devicePixelRatio||1, 2);
  function fit(){
    const pw = cvs.parentElement.clientWidth - 36 || 500;
    const W=Math.max(260,pw), H=Math.round(W*.50);
    cvs.style.width=W+'px'; cvs.style.height=H+'px'; cvs.width=W*DPR; cvs.height=H*DPR;
  }
  fit(); window.addEventListener('resize',()=>{ fit(); });

  let zone=13.5;
  // Precompute bacteria positions (phyllotaxis)
  const BACT=Array.from({length:88},(_,i)=>({ a:(i*137.5)%360*Math.PI/180, d:10+(i*17%74), r:1.6+(i%4)*.5 }));

  function grade(z){ if(z<=1) return {t:'无明显抑制',c:'#94a3b8'}; if(z<8) return {t:'弱抑制',c:'#f59e0b'}; if(z<15) return {t:'中等抑制',c:'#10b981'}; return {t:'较强抑制',c:'#2563eb'}; }
  function setEl(id,text,color){ const e=document.getElementById(id); if(!e)return; e.textContent=text; if(color)e.style.color=color; }

  function drawDish(cx,cy,dishR,zoneR,label,sublabel){
    const now=Date.now();
    // Agar
    const ag=ctx.createRadialGradient(cx-dishR*.2,cy-dishR*.25,2,cx,cy,dishR);
    ag.addColorStop(0,'#fffbf2'); ag.addColorStop(.55,'#f5e6c8'); ag.addColorStop(1,'#e8d5a8');
    ctx.beginPath(); ctx.arc(cx,cy,dishR,0,Math.PI*2); ctx.fillStyle=ag; ctx.fill();
    ctx.strokeStyle='rgba(107,114,128,.7)'; ctx.lineWidth=2; ctx.stroke();
    ctx.beginPath(); ctx.arc(cx,cy,dishR*.88,0,Math.PI*2); ctx.strokeStyle='rgba(107,114,128,.25)'; ctx.lineWidth=1; ctx.stroke();

    // Bacteria
    BACT.forEach((b,i)=>{
      const bx=cx+Math.cos(b.a)*b.d, by=cy+Math.sin(b.a)*b.d;
      const inZone=zoneR>0 && Math.hypot(bx-cx,by-cy)<zoneR;
      const pulse=0.72+Math.sin(now/1100+i*.42)*.14;
      ctx.beginPath(); ctx.arc(bx,by,b.r*(inZone?.35:pulse),0,Math.PI*2);
      ctx.fillStyle=`rgba(34,197,94,${inZone?.1:.62+Math.sin(now/2200+i)*.07})`; ctx.fill();
    });

    // Clear zone + boundary
    if(zoneR>0){
      const cg=ctx.createRadialGradient(cx,cy,0,cx,cy,zoneR);
      cg.addColorStop(0,'rgba(255,255,255,.96)'); cg.addColorStop(.72,'rgba(255,255,255,.8)'); cg.addColorStop(1,'rgba(255,255,255,.05)');
      ctx.beginPath(); ctx.arc(cx,cy,zoneR,0,Math.PI*2); ctx.fillStyle=cg; ctx.fill();
      // animated dashed ring
      ctx.beginPath(); ctx.arc(cx,cy,zoneR,0,Math.PI*2);
      ctx.strokeStyle='#f97316'; ctx.lineWidth=2.5;
      ctx.setLineDash([8,5]); ctx.lineDashOffset=-(now/30)%13; ctx.stroke(); ctx.setLineDash([]);
      // diameter line
      ctx.beginPath(); ctx.moveTo(cx-zoneR,cy); ctx.lineTo(cx+zoneR,cy);
      ctx.strokeStyle='rgba(249,115,22,.65)'; ctx.lineWidth=1.5; ctx.stroke();
      [cx-zoneR,cx+zoneR].forEach(ex=>{ ctx.beginPath(); ctx.moveTo(ex,cy-5); ctx.lineTo(ex,cy+5); ctx.strokeStyle='#f97316'; ctx.lineWidth=1.5; ctx.stroke(); });
      // center disk
      ctx.beginPath(); ctx.arc(cx,cy,7,0,Math.PI*2); ctx.fillStyle='#f97316'; ctx.fill();
      ctx.beginPath(); ctx.arc(cx,cy,7,0,Math.PI*2); ctx.strokeStyle='#fff'; ctx.lineWidth=1.5; ctx.stroke();
      // dim label
      ctx.fillStyle='#c2410c'; ctx.font='bold 10px Inter,sans-serif'; ctx.textAlign='center';
      ctx.fillText('⌀ '+sublabel, cx, cy-zoneR-10);
    } else {
      ctx.beginPath(); ctx.arc(cx,cy,5,0,Math.PI*2); ctx.fillStyle='#94a3b8'; ctx.fill();
    }
    // dish labels
    ctx.fillStyle='#334155'; ctx.font='bold 11px Inter,sans-serif'; ctx.textAlign='center';
    ctx.fillText(label,cx,cy+dishR+18);
    ctx.fillStyle='#94a3b8'; ctx.font='10px Inter,sans-serif'; ctx.fillText(sublabel,cx,cy+dishR+32);
  }

  function renderI(){
    const W=cvs.width/DPR, H=cvs.height/DPR;
    const dishR=Math.min(H*.40, W*.22);
    const zoneR=Math.max(0,Math.min(dishR*.92, zone*dishR/20));
    const g=grade(zone);
    setEl('isim-grade-badge',g.t,g.c); setEl('isim-level',g.t,g.c); setEl('isim-diam',zone.toFixed(1)+' mm');
    setEl('isim-edge', zone<1?'无':zone<8?'模糊':'清晰');

    ctx.save(); ctx.scale(DPR,DPR);
    // Dark BG
    ctx.fillStyle='#0f172a';
    ctx.beginPath(); if(ctx.roundRect) ctx.roundRect(0,0,W,H,16); else { ctx.rect(0,0,W,H); } ctx.fill();
    // Title
    ctx.fillStyle='#e2e8f0'; ctx.font='bold 12px Inter,sans-serif'; ctx.textAlign='center';
    ctx.fillText('E. coli 抑菌观察数字对照',W/2,22);
    // Dishes
    drawDish(W*.25, H*.50, dishR, 0,          '空白对照组', '0 mm');
    drawDish(W*.75, H*.50, dishR, zoneR, '精油乳液组', zone.toFixed(1)+' mm');
    // Divider
    ctx.beginPath(); ctx.moveTo(W/2,H*.1); ctx.lineTo(W/2,H*.9);
    ctx.strokeStyle='rgba(255,255,255,.08)'; ctx.setLineDash([5,7]); ctx.lineWidth=1; ctx.stroke(); ctx.setLineDash([]);
    ctx.restore();

    // Also update petri-preview side panel SVG grade badge if on student page
    const gb2=document.getElementById('isim-grade'); if(gb2){gb2.textContent=g.t;gb2.style.color=g.c;}
    requestAnimationFrame(renderI);
  }

  // React to zone input
  const zoneInput=document.getElementById('inhibition_zone_diameter');
  if(zoneInput){ const upd=()=>{ const v=+zoneInput.value; if(v>=0) zone=v; }; zoneInput.addEventListener('input',upd); zoneInput.addEventListener('change',upd); upd(); }
  renderI();
})();

// v210 teacher data management: review/include/exclude/delete records without rebuilding the page manually.
(function(){
  async function manageRecord(id, action){
    const label = action==='delete'?'删除':(action==='exclude'?'排除':'纳入');
    if(action==='delete' && !confirm('确定删除这条学生数据吗？此操作不可撤销。')) return;
    const note = action==='exclude' ? (prompt('排除原因（可留空）：','教师复核后排除') || '') : '';
    const res = await fetch('/api/records/manage', {
      method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ id, action, note })
    });
    const data = await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(data.error || (label+'失败'));
    location.reload();
  }
  document.addEventListener('click', (e)=>{
    const btn=e.target.closest('[data-record-action]');
    if(btn){
      e.preventDefault();
      btn.disabled=true;
      manageRecord(btn.dataset.recordId, btn.dataset.recordAction).catch(err=>{ alert(err.message||'操作失败'); btn.disabled=false; });
      return;
    }
    const filter=e.target.closest('[data-record-filter]');
    if(filter){
      e.preventDefault();
      const state=filter.dataset.recordFilter;
      document.querySelectorAll('[data-record-filter]').forEach(b=>b.classList.toggle('active', b===filter));
      document.querySelectorAll('[data-record-row]').forEach(row=>{
        row.style.display = (state==='all' || row.dataset.reviewState===state) ? '' : 'none';
      });
    }
  });
})();

// v211 管理员账号导入与新建：支持 Excel 复制粘贴 / CSV 文本
(function(){
  function qs(sel){ return document.querySelector(sel); }
  function setText(el, text, ok){ if(!el) return; el.textContent=text; el.style.color=ok ? '#047857' : '#b45309'; }
  async function postJson(url, payload){
    const r = await fetch(url, { method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) });
    const data = await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(data.error || '操作失败');
    return data;
  }
  function bindAdminUserTools(){
    const form = qs('#admin-create-user-form');
    if(form && !form.dataset.bound){
      form.dataset.bound='1';
      form.addEventListener('submit', async (e)=>{
        e.preventDefault();
        const box=qs('#admin-create-user-result');
        setText(box, '正在保存账号...', true);
        const fd = new FormData(form);
        const payload = Object.fromEntries(fd.entries());
        try{
          const data = await postJson('/api/admin/create-user', payload);
          setText(box, data.message || '账号已保存，刷新后可在列表中查看。', true);
          setTimeout(()=>location.reload(), 800);
        }catch(err){ setText(box, err.message || '保存失败', false); }
      });
    }
    const fill = qs('#admin-fill-import-example');
    const ta = qs('#admin-import-users-text');
    if(fill && ta && !fill.dataset.bound){
      fill.dataset.bound='1';
      fill.addEventListener('click', ()=>{
        ta.value = '角色\t账号\t姓名\t班级\t小组\t密码\nstudent\tstudent004\t张三\t高二化学探究班\t第4组\t\nstudent\tstudent005\t李四\t高二化学探究班\t第4组\t\nteacher\tteacher002\t王老师\t高二化学探究班\t\t';
        ta.focus();
      });
    }
    const btn = qs('#admin-import-users-btn');
    if(btn && ta && !btn.dataset.bound){
      btn.dataset.bound='1';
      btn.addEventListener('click', async ()=>{
        const box=qs('#admin-import-users-result');
        const text=ta.value.trim();
        if(!text){ setText(box, '请先从 Excel 复制账号表并粘贴到文本框。', false); return; }
        setText(box, '正在导入账号...', true);
        try{
          const data = await postJson('/api/admin/import-users', { text });
          const extra = data.errors && data.errors.length ? `；跳过 ${data.errors.length} 行` : '';
          setText(box, (data.message || '导入完成') + extra + '，页面即将刷新。', true);
          setTimeout(()=>location.reload(), 1000);
        }catch(err){ setText(box, err.message || '导入失败', false); }
      });
    }
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindAdminUserTools);
  else bindAdminUserTools();
})();
