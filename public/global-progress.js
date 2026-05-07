(function(){
  const STATES = { idle:'idle', starting:'starting', processing:'processing', success:'success', error:'error' };
  const DEFAULT_STAGE = [12,28,45,61,74,86,93];
  let container;
  let manualProgressDepth = 0;
  let submitProgressId = null;

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[char]));
  }

  function ensureUi(){
    if (container) return container;
    container = document.createElement('section');
    container.id = 'lsaGlobalProgressHost';
    container.setAttribute('aria-live', 'polite');
    container.innerHTML = '<div class="lsa-progress-stack"></div>';
    document.body.appendChild(container);
    return container;
  }

  function cardTemplate(id,label){
    return `<article class="lsa-progress-card" data-id="${id}" data-state="${STATES.starting}"><div class="lsa-progress-head"><strong>${escapeHtml(label)}</strong><span class="lsa-progress-pct">0%</span></div><div class="lsa-progress-track"><span class="lsa-progress-bar"></span></div><div class="lsa-progress-status">Starting…</div></article>`;
  }

  function style(){
    if (document.getElementById('lsaGlobalProgressStyle')) return;
    const css = document.createElement('style');
    css.id='lsaGlobalProgressStyle';
    css.textContent = `#lsaGlobalProgressHost{position:fixed;top:12px;right:12px;z-index:9999;display:flex;flex-direction:column;gap:8px;width:min(360px,calc(100vw - 24px));pointer-events:none}.lsa-progress-stack{display:flex;flex-direction:column;gap:8px}.lsa-progress-card{background:var(--lsa-surface,#fff);color:var(--lsa-text,#0f172a);border:1px solid var(--lsa-border,#d1d5db);border-radius:12px;padding:10px;box-shadow:0 10px 28px rgba(0,0,0,.12)}.lsa-progress-head{display:flex;justify-content:space-between;gap:12px;font-size:12px;margin-bottom:6px}.lsa-progress-head strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.lsa-progress-track{height:8px;border-radius:999px;background:var(--lsa-surface-muted,#f1f5f9);overflow:hidden}.lsa-progress-bar{display:block;height:100%;width:0;background:#2563eb;transition:width .28s ease, background .2s ease}.lsa-progress-status{font-size:12px;margin-top:6px;color:var(--lsa-text-muted,#475569)}.lsa-progress-card[data-state="success"] .lsa-progress-bar{background:#16a34a}.lsa-progress-card[data-state="error"] .lsa-progress-bar{background:#dc2626}@media(max-width:640px){#lsaGlobalProgressHost{top:8px;right:8px;width:calc(100vw - 16px)}}`;
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
    set(id,{ state: ok ? STATES.success : STATES.error, percent:100, message: message || (ok ? 'Completed successfully' : 'Action failed') });
    setTimeout(()=>{ const card = container?.querySelector(`[data-id="${id}"]`); if(card) card.remove(); }, ok ? 2200 : 5000);
  }

  function stagedMessage(label, pct) {
    if (/login|authenticat|sign/i.test(label)) return pct < 40 ? 'Verifying credentials…' : pct < 85 ? 'Opening Internal OS…' : 'Finalizing secure session…';
    if (/generate|extract|match|insight|retrieval|translate|summar/i.test(label)) return pct < 40 ? 'Preparing inputs…' : pct < 85 ? 'Processing structured output…' : 'Finalizing result…';
    if (/save|create|update|publish|convert/i.test(label)) return pct < 40 ? 'Validating changes…' : pct < 85 ? 'Saving to the backend…' : 'Synchronizing view…';
    if (/delete|clear|archive|unarchive/i.test(label)) return pct < 40 ? 'Confirming request…' : pct < 85 ? 'Applying thread update…' : 'Refreshing workspace…';
    return pct < 40 ? 'Preparing request…' : pct < 85 ? 'Processing…' : 'Completing…';
  }

  function withProgress(label, fn, opts){
    const id = start(label);
    const real = opts && typeof opts.onProgress === 'function';
    let timer; let i = 0;
    set(id,{state:STATES.starting, percent:4, message:'Starting…'});
    if (!real) {
      timer = setInterval(()=>{ const pct = DEFAULT_STAGE[Math.min(i, DEFAULT_STAGE.length-1)]; i += 1; set(id,{state:STATES.processing, percent:pct, message:stagedMessage(label || '', pct)}); if (i >= DEFAULT_STAGE.length) clearInterval(timer); }, 400);
    }
    const controller = { update: (percent, msg) => set(id,{state:STATES.processing, percent, message: msg || stagedMessage(label || '', percent)}) };
    manualProgressDepth += 1;
    return Promise.resolve()
      .then(()=>fn(controller))
      .then((res)=>{ if (timer) clearInterval(timer); finish(id,true,'Completed successfully'); return res; })
      .catch((err)=>{ if (timer) clearInterval(timer); finish(id,false, err?.message || 'Action failed'); throw err; })
      .finally(()=>{ manualProgressDepth = Math.max(0, manualProgressDepth - 1); });
  }

  function labelFromUrl(url, method) {
    const text = String(url || '');
    if (text.includes('/login')) return 'Authenticate session';
    if (text.includes('/kb-capture/generate')) return 'Generate structured knowledge';
    if (text.includes('/kb-capture/check-duplicates')) return 'Check KB duplicates';
    if (text.includes('/kb-capture/convert-to-kb')) return 'Publish capture to Knowledge Base';
    if (text.includes('/kb/quick-capture')) return method === 'DELETE' ? 'Delete quick capture' : 'Save quick capture';
    if (text.includes('/kb/articles')) return method === 'DELETE' ? 'Delete knowledge article' : 'Save knowledge article';
    if (text.includes('/kb/categories')) return 'Create knowledge category';
    if (text.includes('/provider-capture/generate')) return 'Generate provider profile';
    if (text.includes('/provider-capture/upload')) return 'Upload provider capture files';
    if (text.includes('/providers/match')) return 'Generate provider matches';
    if (text.includes('/providers/duplicate-check')) return 'Check provider duplicates';
    if (/\/api\/providers\/[^/]+\/documents/.test(text)) return method === 'GET' ? 'Load provider documents' : 'Upload provider document';
    if (text.includes('/api/providers')) return method === 'DELETE' ? 'Delete provider' : 'Save provider';
    if (text.includes('/communications/mail/reply')) return 'Send mail reply';
    if (text.includes('/send-attachment')) return 'Send WhatsApp attachment';
    if (text.includes('/api/send')) return 'Send WhatsApp reply';
    if (text.includes('/api/label')) return 'Update inbox label';
    if (text.includes('/clear')) return 'Clear inbox thread';
    if (text.includes('/delete')) return 'Delete inbox thread';
    if (text.includes('/archive')) return text.includes('/unarchive') ? 'Unarchive inbox thread' : 'Archive inbox thread';
    if (text.includes('/automation/run')) return 'Run automation workflow';
    if (text.includes('/automation/workflows')) return 'Update automation workflow';
    if (text.includes('/system/mode')) return 'Switch runtime mode';
    if (text.includes('/account/') || text.includes('/branding/')) return 'Save account settings';
    return method === 'GET' ? 'Load latest data' : 'Process request';
  }

  function shouldAutoProgress(input, init) {
    if (manualProgressDepth > 0) return false;
    const headers = new Headers(init?.headers || (input && input.headers) || {});
    if (headers.get('x-lsa-silent-progress') === '1') return false;
    const method = String(init?.method || input?.method || 'GET').toUpperCase();
    return !['GET', 'HEAD', 'OPTIONS'].includes(method);
  }

  function installFetchProgress() {
    if (!window.fetch || window.fetch.__lsaProgressWrapped) return;
    const originalFetch = window.fetch.bind(window);
    const wrapped = function(input, init) {
      if (!shouldAutoProgress(input, init)) return originalFetch(input, init);
      const method = String(init?.method || input?.method || 'GET').toUpperCase();
      const url = typeof input === 'string' ? input : input?.url;
      const label = labelFromUrl(url, method);
      const id = start(label);
      let i = 0;
      set(id, { state: STATES.starting, percent: 6, message: 'Starting…' });
      const timer = setInterval(() => {
        const pct = DEFAULT_STAGE[Math.min(i, DEFAULT_STAGE.length - 1)];
        i += 1;
        set(id, { state: STATES.processing, percent: pct, message: stagedMessage(label, pct) });
        if (i >= DEFAULT_STAGE.length) clearInterval(timer);
      }, 350);
      return originalFetch(input, init)
        .then((response) => {
          clearInterval(timer);
          finish(id, response.ok, response.ok ? 'Completed successfully' : `Request failed (${response.status})`);
          return response;
        })
        .catch((error) => {
          clearInterval(timer);
          finish(id, false, error?.message || 'Network request failed');
          throw error;
        });
    };
    wrapped.__lsaProgressWrapped = true;
    window.fetch = wrapped;
  }

  function installSubmitProgress() {
    document.addEventListener('submit', (event) => {
      const form = event.target;
      if (!form || form.dataset.lsaSilentProgress === '1' || submitProgressId) return;
      const action = form.getAttribute('action') || window.location.pathname;
      const label = labelFromUrl(action, form.getAttribute('method') || 'POST');
      submitProgressId = start(label);
      let i = 0;
      set(submitProgressId, { state: STATES.starting, percent: 8, message: 'Starting secure request…' });
      const timer = setInterval(() => {
        const pct = DEFAULT_STAGE[Math.min(i, DEFAULT_STAGE.length - 1)];
        i += 1;
        set(submitProgressId, { state: STATES.processing, percent: pct, message: stagedMessage(label, pct) });
        if (i >= DEFAULT_STAGE.length) clearInterval(timer);
      }, 300);
      window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
    }, true);
  }

  window.LSAGlobalProgress = { withProgress, start, set, finish, STATES, installFetchProgress, installSubmitProgress };
  installFetchProgress();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installSubmitProgress, { once: true });
  } else {
    installSubmitProgress();
  }
})();
