(function(){
  const STATES = { idle:'idle', starting:'starting', processing:'processing', success:'success', error:'error' };
  const DEFAULT_STAGE = [12,28,45,61,74,86,93];
  let container;

  function ensureUi(){
    if (container) return container;
    container = document.createElement('section');
    container.id = 'lsaGlobalProgressHost';
    container.innerHTML = '<div class="lsa-progress-stack"></div>';
    document.body.appendChild(container);
    return container;
  }

  function cardTemplate(id,label){
    return `<article class="lsa-progress-card" data-id="${id}" data-state="${STATES.starting}"><div class="lsa-progress-head"><strong>${label}</strong><span class="lsa-progress-pct">0%</span></div><div class="lsa-progress-track"><span class="lsa-progress-bar"></span></div><div class="lsa-progress-status">Starting…</div></article>`;
  }

  function style(){
    if (document.getElementById('lsaGlobalProgressStyle')) return;
    const css = document.createElement('style');
    css.id='lsaGlobalProgressStyle';
    css.textContent = `#lsaGlobalProgressHost{position:fixed;top:12px;right:12px;z-index:9999;display:flex;flex-direction:column;gap:8px;max-width:360px}.lsa-progress-stack{display:flex;flex-direction:column;gap:8px}.lsa-progress-card{background:#fff;color:#0f172a;border:1px solid #d1d5db;border-radius:10px;padding:10px;box-shadow:0 8px 24px rgba(0,0,0,.08)}.lsa-progress-head{display:flex;justify-content:space-between;font-size:12px;margin-bottom:6px}.lsa-progress-track{height:8px;border-radius:999px;background:#f1f5f9;overflow:hidden}.lsa-progress-bar{display:block;height:100%;width:0;background:#2563eb;transition:width .25s ease, background .2s ease}.lsa-progress-status{font-size:12px;margin-top:6px;color:#475569}.lsa-progress-card[data-state="success"] .lsa-progress-bar{background:#16a34a}.lsa-progress-card[data-state="error"] .lsa-progress-bar{background:#dc2626}`;
    document.head.appendChild(css);
  }

  function start(label){
    style(); ensureUi();
    const id = `gp_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
    container.querySelector('.lsa-progress-stack').insertAdjacentHTML('afterbegin', cardTemplate(id,label || 'Processing action'));
    return id;
  }

  function set(id, payload){
    const card = container?.querySelector(`[data-id="${id}"]`);
    if (!card) return;
    const pct = Math.max(0, Math.min(100, Number(payload.percent ?? 0)));
    card.dataset.state = payload.state || STATES.processing;
    card.querySelector('.lsa-progress-bar').style.width = `${pct}%`;
    card.querySelector('.lsa-progress-pct').textContent = `${Math.round(pct)}%`;
    card.querySelector('.lsa-progress-status').textContent = payload.message || '';
  }

  function finish(id, ok, message){
    set(id,{ state: ok ? STATES.success : STATES.error, percent:100, message: message || (ok ? 'Completed' : 'Failed') });
    setTimeout(()=>{ const card = container?.querySelector(`[data-id="${id}"]`); if(card) card.remove(); }, ok ? 2200 : 5000);
  }

  function withProgress(label, fn, opts){
    const id = start(label);
    const real = opts && typeof opts.onProgress === 'function';
    let timer; let i = 0;
    set(id,{state:STATES.starting, percent:4, message:'Starting…'});
    if (!real) {
      timer = setInterval(()=>{ const pct = DEFAULT_STAGE[Math.min(i, DEFAULT_STAGE.length-1)]; i += 1; set(id,{state:STATES.processing, percent:pct, message:'Processing…'}); if (i >= DEFAULT_STAGE.length) clearInterval(timer); }, 400);
    }
    const controller = { update: (percent, msg) => set(id,{state:STATES.processing, percent, message: msg || 'Processing…'}) };
    return Promise.resolve()
      .then(()=>fn(controller))
      .then((res)=>{ if (timer) clearInterval(timer); finish(id,true,'Completed successfully'); return res; })
      .catch((err)=>{ if (timer) clearInterval(timer); finish(id,false, err?.message || 'Action failed'); throw err; });
  }

  window.LSAGlobalProgress = { withProgress, start, set, finish, STATES };
})();
