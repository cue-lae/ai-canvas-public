(() => {
  'use strict';
  const root=document.getElementById('installer-flow-preview');
  const q=s=>root.querySelector(s);
  q('.ip-footer-note').textContent='初版';
  const send=(action,fields={})=>window.chrome.webview.postMessage({action,...fields});
  let initialLayoutScheduled=false;
  const state={phase:'ready',path:'',isUpdate:false,shortcut:true,editing:false,percent:0,version:'',previousVersion:'',error:'',cancelling:false};
  const paths={folder:'M20 20H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 2h9a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2Z',check:'m20 6-11 11-5-5',x:'M18 6 6 18M6 6l12 12','arrow-right':'M5 12h14m-7-7 7 7-7 7'};
  root.querySelectorAll('[data-lucide]').forEach(item=>{
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
    for(const [key,value] of Object.entries({viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'2','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'}))svg.setAttribute(key,value);
    const shape=document.createElementNS(svg.namespaceURI,'path');shape.setAttribute('d',paths[item.dataset.lucide]||'');svg.append(shape);item.replaceWith(svg);
  });
  const error=document.createElement('p');error.setAttribute('role','alert');error.className='ip-runtime-error';error.hidden=true;q('[data-page=ready]').append(error);
  function render(){
    const update=state.isUpdate;
    q('.ip-footer-note').textContent=state.version||'初版';
    root.querySelectorAll('[data-page]').forEach(e=>e.hidden=e.dataset.page!==state.phase);
    q('.ip-heading').textContent=update?'准备更新':'准备安装';
    q('.ip-subtitle').textContent=update?'已检测到旧版，可以更新至AI Canvas 初版。':'安装画布并准备 Codex 插件。';
    q('.ip-update-summary').hidden=!update;
    q('.ip-update-summary>span').textContent='已安装 '+state.previousVersion;
    q('.ip-update-summary strong').textContent=state.version;
    q('.ip-change').hidden=update||state.editing;
    q('.ip-path-display').hidden=state.editing;
    q('.ip-location-edit').hidden=!state.editing;
    q('.ip-path').textContent=state.path;
    q('.ip-location-note').textContent=update?'更新沿用当前安装位置。':'默认仅为当前用户安装。';
    q('.ip-shortcut').hidden=update;q('.ip-shortcut input').checked=state.shortcut;
    q('.ip-preserve').hidden=!update;
    q('.ip-progress-heading').textContent=update?'正在更新':'正在安装';
    q('.ip-progress-subtitle').textContent=update?'保留已有项目与设置。':'安装完成后即可打开画布。';
    q('progress').value=state.percent;q('progress').setAttribute('aria-label','安装进度');q('.ip-percent').textContent=state.percent+'%';
    q('.ip-progress-status').textContent=state.cancelling?'正在取消':state.percent<25?'准备文件':state.percent<85?(update?'更新应用文件':'安装应用文件'):'完成设置';
    q('.ip-done-heading').textContent=update?'更新完成':'安装完成';
    q('.ip-cancel-note').textContent=update?'此次更新已取消，可稍后重新开始。':'可以稍后重新开始。';
    q('.ip-step').textContent=state.phase==='progress'?'2 / 3':state.phase==='done'?'3 / 3':'1 / 3';
    const primary=q('.ip-primary'),secondary=q('.ip-secondary');
    primary.hidden=state.phase==='progress';primary.disabled=state.editing;
    primary.textContent=state.phase==='done'?'打开画布':state.phase==='cancelled'?'重新开始':update?'开始更新':'开始安装';
    secondary.textContent=state.phase==='done'?'完成':state.phase==='cancelled'?'关闭':'取消';secondary.disabled=state.cancelling;
    error.hidden=!state.error;error.textContent=state.error;
    requestAnimationFrame(()=>send('resize',{height:Math.ceil(q('.ip-window').getBoundingClientRect().height)}));
  }
  q('.ip-change').addEventListener('click',()=>{state.editing=true;q('#ip-path-input').value=state.path;q('#ip-path-error').hidden=true;render();q('#ip-path-input').focus();q('#ip-path-input').select();});
  q('[data-location=cancel]').addEventListener('click',()=>{state.editing=false;render();});
  q('[data-location=save]').addEventListener('click',()=>{const value=q('#ip-path-input').value.trim();if(!/^[a-z]:\\.+/i.test(value)||/[<>"|?*]/.test(value)){q('#ip-path-error').hidden=false;render();return;}state.path=value;state.editing=false;q('#ip-path-error').hidden=true;render();});
  q('.ip-shortcut input').addEventListener('change',e=>{state.shortcut=e.target.checked;});
  q('.ip-primary').addEventListener('click',()=>{if(state.phase==='done'){send('open');return;}if(state.phase==='cancelled'){send('ready');return;}if(state.phase==='ready'&&!state.editing)send('install',{path:state.path,shortcut:state.shortcut});});
  q('.ip-secondary').addEventListener('click',()=>send(state.phase==='progress'?'cancel':'close'));
  q('.ip-close').addEventListener('click',()=>send('close'));
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();if(state.editing){state.editing=false;render();}else send('close');}});
  window.chrome.webview.addEventListener('message',e=>{
    const incoming=e.data;if(!incoming||incoming.kind!=='state')return;
    const wasEditing=state.editing;Object.assign(state,incoming);
    if(state.phase!=='ready')state.editing=false;else if(wasEditing&&!incoming.error)state.editing=true;
    render();
    if(!initialLayoutScheduled){
      initialLayoutScheduled=true;
      Promise.resolve(document.fonts?.ready).then(()=>requestAnimationFrame(()=>requestAnimationFrame(()=>send('surface-ready',{height:Math.ceil(q('.ip-window').getBoundingClientRect().height)}))));
    }
  });
  new ResizeObserver(()=>send('resize',{height:Math.ceil(q('.ip-window').getBoundingClientRect().height)})).observe(q('.ip-window'));
  send('ready');
})();
