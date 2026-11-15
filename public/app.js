(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const h = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const dayLabel = (ms) => new Date(ms)
    .toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' })
    .replace(/,/g, '').toUpperCase();
  const clock = (ms) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const safeUrl = (u) => (typeof u === 'string' && /^https?:\/\//i.test(u) ? u : null);

  const thread = $('#thread'), input = $('#input'), sendBtn = $('#send');
  const list = $('#convList'), titleEl = $('#deskTitle'), banner = $('#banner');
  const sidebar = $('#sidebar'), sidebarBackdrop = $('#sidebarBackdrop');
  const toggleSidebarBtn = $('#toggleSidebar'), closeSidebarBtn = $('#closeSidebar');
  const quickNewChatBtn = $('#quickNewChat'), activePageTag = $('#activePageTag');
  const themeToggleBtn = $('#toggleTheme');
  const chatNav = $('#chatNav'), navJumpTop = $('#navJumpTop');
  const navJumpBottom = $('#navJumpBottom'), navTurnBadge = $('#navTurnBadge');
  const state = { convs: [], activeId: null, current: null, busy: false };

  function setTheme(theme, save = false) {
    const dark = theme === 'dark';
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    if (themeToggleBtn) {
      themeToggleBtn.setAttribute('aria-pressed', String(dark));
      themeToggleBtn.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
      $('.tab-icon', themeToggleBtn).textContent = dark ? '☀' : '☾';
      $('.tab-label', themeToggleBtn).textContent = dark ? 'LIGHT' : 'DARK';
    }
    if (save) {
      try { localStorage.setItem('almanac-theme', dark ? 'dark' : 'light'); } catch {}
    }
  }

  setTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');

  const PROMPT_SUGGESTIONS = [
    'What did I ask on 3 November?',
    'Has CRM tool pricing changed since Monday?',
    'Compare Postgres managed database pricing between Supabase and Neon',
    'What is on my schedule and task list for today?',
    'When is my meeting with Marcus on Saturday and what is the agenda?',
    'What are my daily deep work routine and focus rules?',
    'What did I discuss in my 1-on-1 with Elena on Monday?',
    'What are the milestones and deadlines for Project Falcon?',
    'What is our production release checklist and rollback condition?',
    'What recurring standups and workouts do I have this week?',
  ];

  function getDynamicSuggestions() {
    const suggestions = [];
    if (state.convs && state.convs.length > 0) {
      const validConvs = state.convs.filter(c => c.title && c.title !== 'Untitled page');
      const shuffled = [...validConvs].sort(() => Math.random() - 0.5);
      for (const c of shuffled) {
        if (suggestions.length >= 1) break;
        let t = c.title.trim();
        if (t.endsWith('?')) {
          suggestions.push(t);
        } else {
          suggestions.push(`What did we discuss about ${t.toLowerCase()}?`);
        }
      }
    }
    const pool = [...PROMPT_SUGGESTIONS].sort(() => Math.random() - 0.5);
    for (const p of pool) {
      if (suggestions.length >= 3) break;
      if (!suggestions.includes(p)) suggestions.push(p);
    }
    return suggestions.slice(0, 3);
  }
  const STEPS = [['memory', 'Notes'], ['search', 'Web'], ['write', 'Writing']];

  marked.setOptions({ gfm: true, breaks: false });
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') { node.setAttribute('target', '_blank'); node.setAttribute('rel', 'noopener noreferrer'); }
  });

  /* ---------- api ---------- */
  async function api(path, opts = {}) {
    const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
    if (!res.ok) throw new Error((await res.text()) || res.statusText);
    return res.status === 204 ? null : res.json();
  }

  async function streamChat(payload, handlers) {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(payload),
    });
    if (!res.ok || !res.body) throw new Error((await res.text()) || 'Request failed');
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const frame = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const ev = /^event: (.+)$/m.exec(frame);
        const data = /^data: (.+)$/m.exec(frame);
        if (ev && data && handlers[ev[1]]) handlers[ev[1]](JSON.parse(data[1]));
      }
    }
  }

  /* ---------- markdown + chips (tags are replaced AFTER parsing, on text nodes only) ---------- */
  function renderMarkdown(m, highlight = true) {
    const tpl = document.createElement('template');
    tpl.innerHTML = DOMPurify.sanitize(marked.parse(m.content || ''), { ADD_ATTR: ['target', 'rel'] });
    const evMap = new Map((m.evidence || []).map((e) => [e.ref.toUpperCase(), e]));
    const flMap = new Map((m.flags || []).map((f) => [f.id.toUpperCase(), f]));
    const known = new Set([...evMap.keys(), ...flMap.keys()]);
    const walker = document.createTreeWalker(tpl.content, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const n of nodes) {
      if (n.parentElement && n.parentElement.closest('code, pre, a, button')) continue;
      const txt = n.nodeValue || '';
      if (!/[\[【][WMU]\d+[\]】]/i.test(txt)) continue;
      const frag = document.createDocumentFragment();
      let last = 0;
      for (const mt of txt.matchAll(/[\[【]([WMU]\d+)[\]】]/gi)) {
        frag.append(txt.slice(last, mt.index));
        last = mt.index + mt[0].length;
        const ref = mt[1].toUpperCase();
        if (!known.has(ref)) { frag.append(mt[0]); continue; }
        const isFlag = ref[0] === 'U';
        const evItem = evMap.get(ref);
        const flagItem = flMap.get(ref);

        // Hyperlink anchor directly to reference in Sources drawer
        const link = h('a', `cite cite-${ref[0].toLowerCase()}`, isFlag ? '?' : ref);
        link.href = `#ref-${ref}`;
        link.dataset.ref = ref;
        link.setAttribute('role', 'doc-biblioref');

        // Detailed hover tooltip
        if (evItem) {
          const title = evItem.title || evItem.domain || (evItem.kind === 'memory' ? 'Saved note' : 'Web source');
          const snippetExcerpt = evItem.snippet ? `\n"${evItem.snippet.slice(0, 140)}${evItem.snippet.length > 140 ? '…' : ''}"` : '';
          link.title = `Reference [${ref}]: ${title}${evItem.url ? ' (' + evItem.url + ')' : ''}${snippetExcerpt}`;
          link.setAttribute('aria-label', `Reference ${ref}: ${title}`);
        } else if (flagItem) {
          link.title = `Unverified claim [${ref}]: ${flagItem.reason || 'Flagged by verifier'}`;
          link.setAttribute('aria-label', `Unverified claim ${ref}: ${flagItem.reason || 'Flagged'}`);
        }

        frag.append(link);
      }
      frag.append(txt.slice(last));
      n.replaceWith(frag);
    }
    tpl.content.querySelectorAll('table').forEach((t) => {
      const wrap = h('div', 'table-wrap');
      t.replaceWith(wrap);
      wrap.append(t);
    });
    if (highlight) tpl.content.querySelectorAll('pre code').forEach((code) => hljs.highlightElement(code));
    return tpl.content;
  }

  function setStep(ticker, { step, state, detail }) {
    let li = ticker.querySelector(`[data-step="${step}"]`);
    if (!li) {
      li = h('li', 'step');
      li.dataset.step = step;
      const sq = h('span', 'sq');
      const lb = h('span', 'label', STEPS.find(([k]) => k === step)?.[1] || step);
      const dt = h('span', 'detail');
      li.append(sq, lb, dt);
      ticker.append(li);
    }
    li.dataset.state = state;
    if (state === 'skipped') li.hidden = true;
    else li.hidden = false;
    const dt = li.querySelector('.detail');
    if (dt) dt.textContent = detail ? ` · ${detail}` : '';
  }

  function renderEvidenceItem(item) {
    const isMemory = item.kind === 'memory';
    const row = h('div', `src ${isMemory ? 'src-memory' : 'src-web'}`);
    const refUpper = (item.ref || '').toUpperCase();
    row.dataset.ref = refUpper;
    row.id = `ref-${refUpper}`;
    const badge = h('span', 'badge', item.ref);
    const body = h('div', 'src-body');
    const u = safeUrl(item.url);
    const titleEl = u ? h('a', 'src-title', item.title || item.domain || 'Web source') : h('span', 'src-title', item.title || 'Saved note');
    if (u) { titleEl.href = u; titleEl.target = '_blank'; titleEl.rel = 'noopener noreferrer'; }
    const metaParts = [];
    if (isMemory) {
      if (item.conversationTitle) metaParts.push(`In: ${item.conversationTitle}`);
      if (item.when) metaParts.push(dayLabel(item.when));
    } else {
      if (item.domain) metaParts.push(item.domain);
      if (item.published) metaParts.push(`Published ${item.published}`);
      if (item.retrieved) metaParts.push(`Retrieved ${clock(item.retrieved)}`);
    }
    const meta = h('div', 'src-meta', metaParts.join(' · '));
    body.append(titleEl, meta);
    if (item.snippet) body.append(h('p', 'src-snippet', item.snippet));
    row.append(badge, body);
    return row;
  }

  function renderFlagItem(flag) {
    const row = h('div', 'src src-flag');
    const flagUpper = (flag.id || '').toUpperCase();
    row.dataset.ref = flagUpper;
    row.id = `ref-${flagUpper}`;
    const badge = h('span', 'badge', '?');
    const body = h('div', 'src-body');
    const claimTitle = flag.claim ? `Flagged claim ${flag.id}: “${flag.claim}”` : `Flagged claim ${flag.id}`;
    body.append(h('span', 'src-title', claimTitle));
    const metaParts = [flag.reason];
    if (flag.sourceRef) metaParts.push(`Source: ${flag.sourceRef}`);
    if (flag.stale) metaParts.push('Undated/stale evidence');
    body.append(h('div', 'src-meta', metaParts.join(' · ')));
    body.append(h('div', 'src-verifier-note', '⚠️ Verifier limit: token overlap does not verify full semantic truth. Check original source.'));
    row.append(badge, body);
    return row;
  }

  function updateSources(msgEl, m) {
    let wrap = msgEl.querySelector('.sources');
    const citedRefs = new Set();
    msgEl.querySelectorAll('.cite').forEach((b) => {
      if (b.dataset.ref) citedRefs.add(b.dataset.ref.toUpperCase());
    });
    const ev = m.evidence || [];
    const fl = m.flags || [];
    if (!ev.length && !fl.length && (!m.meta || !m.meta.trace)) {
      if (wrap) wrap.remove();
      return;
    }
    if (!wrap) {
      wrap = h('details', 'sources');
      msgEl.append(wrap);
    }
    wrap.replaceChildren();
    const sum = h('summary');
    const citedEv = ev.filter((e) => citedRefs.has((e.ref || '').toUpperCase()));
    const unreadEv = ev.filter((e) => !citedRefs.has((e.ref || '').toUpperCase()));
    const webCount = ev.filter((e) => e.kind !== 'memory').length;
    const memCount = ev.filter((e) => e.kind === 'memory').length;
    const citedCount = citedEv.length;
    sum.textContent = `Sources · ${citedCount} cited · ${webCount} web · ${memCount} notes retrieved`;
    wrap.append(sum);

    const citedWrap = h('div', 'src-group');
    for (const f of fl) citedWrap.append(renderFlagItem(f));
    for (const e of citedEv) citedWrap.append(renderEvidenceItem(e));
    wrap.append(citedWrap);

    if (unreadEv.length) {
      const extra = h('details', 'more');
      const exSum = h('summary', '', `Also retrieved (${unreadEv.length})`);
      extra.append(exSum);
      for (const e of unreadEv) extra.append(renderEvidenceItem(e));
      wrap.append(extra);
    }

    const limitsNote = h('div', 'verification-limits-note');
    limitsNote.innerHTML = '<strong>Verification Limits:</strong> Citations confirm extracted figures and quotes against retrieved snapshots. They do not guarantee vendor uptime, third-party page accuracy, unannounced terms, or omitted enterprise tiers.';
    wrap.append(limitsNote);

    if (m.meta && Array.isArray(m.meta.trace)) {
      const tr = h('div', 'trace', m.meta.trace.map((t) => `${t.stage} ${t.ms} ms`).join(' · '));
      wrap.append(tr);
    }
    if (m.status === 'aborted') wrap.append(h('div', 'foot', 'Stopped before I finished.'));
  }

  function renderTemporalBadge(msgEl, hints) {
    if (!msgEl || !hints || !hints.length) return;
    const meta = msgEl.querySelector('.msg-meta');
    if (!meta) return;
    meta.querySelectorAll('.resolved-date-tag').forEach((el) => el.remove());
    for (const th of hints) {
      const tag = h('span', 'resolved-date-tag', `📅 ${th.label}`);
      if (th.alt) tag.title = `Alternate reading: ${th.alt.label}`;
      meta.append(tag);
    }
  }

  function renderMessage(m, { streaming } = {}) {
    const node = h('article', `msg ${m.role}`);
    if (streaming) node.classList.add('streaming');
    node.dataset.id = m.id;
    const meta = h('header', 'msg-meta');
    meta.append(h('span', 'who', m.role === 'user' ? 'YOU' : 'ALMANAC'), h('time', '', `${dayLabel(m.createdAt)} · ${clock(m.createdAt)}`));
    if (m.demo) meta.append(h('span', 'demo', 'DEMO'));
    const temporal = m.temporal || (m.meta && m.meta.temporal);
    if (temporal && temporal.length) {
      for (const th of temporal) {
        const tag = h('span', 'resolved-date-tag', `📅 ${th.label}`);
        if (th.alt) tag.title = `Alternate reading: ${th.alt.label}`;
        meta.append(tag);
      }
    }
    node.append(meta);

    if (m.role === 'assistant') {
      const ticker = h('ul', 'ticker');
      node.append(ticker);
    }
    const body = h('div', 'msg-body');
    if (m.role === 'user') body.textContent = m.content;
    else body.append(renderMarkdown(m));
    node.append(body);

    if (m.role === 'assistant') {
      updateSources(node, m);
      node.addEventListener('click', (e) => {
        const link = e.target.closest('.cite');
        if (!link || !link.dataset.ref) return;
        const ref = link.dataset.ref.toUpperCase();
        const src = node.querySelector(`.src[data-ref="${ref}"]`);
        if (!src) return;
        
        // Prevent default jump to handle smooth navigation, open drawers, and flash
        e.preventDefault();
        const wrap = node.querySelector('.sources');
        if (wrap && !wrap.open) wrap.open = true;
        const more = src.closest('.more');
        if (more && !more.open) more.open = true;
        
        src.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        src.classList.remove('hl');
        void src.offsetWidth;
        src.classList.add('hl');
        src.setAttribute('tabindex', '-1');
        src.focus({ preventScroll: true });
      });
    }
    return node;
  }

  function showEmpty() {
    thread.replaceChildren();
    const box = h('div', 'empty');
    const hd = h('h2');
    hd.append('Ask first. I\u2019ll check the ', h('mark', '', 'notes'), ', then the ', h('span', 'web', 'web'), '.');
    const chips = h('div', 'chips');
    const suggestions = getDynamicSuggestions();
    suggestions.forEach((q) => {
      const b = h('button', 'btn', q);
      b.type = 'button';
      b.onclick = () => send(q);
      chips.append(b);
    });
    box.append(hd, chips);
    thread.append(box);
    updateNav();
  }

  function renderList() {
    list.replaceChildren();
    let last = '';
    for (const c of state.convs) {
      const k = new Date(c.updatedAt).toDateString();
      if (k !== last) { list.append(h('div', 'day', dayLabel(c.updatedAt))); last = k; }
      const row = h('div', 'conv');
      if (c.id === state.activeId) row.setAttribute('aria-current', 'true');
      const open = h('button', 't', c.title || 'Untitled page');
      open.type = 'button';
      open.onclick = () => openConv(c.id);
      const del = h('button', 'del', '\u00d7');
      del.type = 'button';
      del.setAttribute('aria-label', `Delete ${c.title || 'page'}`);
      del.onclick = async () => {
        if (!confirm('Delete this page and its notes?')) return;
        await api(`/api/conversations/${c.id}`, { method: 'DELETE' });
        if (state.activeId === c.id) newChat();
        refreshList();
      };
      row.append(open, del);
      list.append(row);
    }
  }

  /* ---------- sidebar controls ---------- */
  let lastFocusedElement = null;

  function openSidebar() {
    lastFocusedElement = document.activeElement;
    sidebar.classList.add('open');
    sidebarBackdrop.hidden = false;
    sidebar.setAttribute('aria-hidden', 'false');
    const focusable = sidebar.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (focusable.length > 0) {
      focusable[0].focus();
    }
  }

  function closeSidebar() {
    if (!sidebar.classList.contains('open')) return;
    sidebar.classList.remove('open');
    sidebarBackdrop.hidden = true;
    sidebar.setAttribute('aria-hidden', 'true');
    if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
      lastFocusedElement.focus();
    } else if (toggleSidebarBtn) {
      toggleSidebarBtn.focus();
    }
  }

  function toggleSidebar() {
    if (sidebar.classList.contains('open')) closeSidebar();
    else openSidebar();
  }

  /* ---------- behaviour ---------- */
  const nearBottom = () => thread.scrollHeight - thread.scrollTop - thread.clientHeight < 140;
  const toBottom = () => { thread.scrollTop = thread.scrollHeight; };
  function updateNav() {
    if (!chatNav) return;
    const msgs = thread ? thread.querySelectorAll('.msg') : [];
    const count = msgs.length;
    if (count === 0) {
      chatNav.hidden = true;
      return;
    }
    chatNav.hidden = false;
    if (navTurnBadge) {
      navTurnBadge.textContent = `${count} ${count === 1 ? 'MSG' : 'MSGS'}`;
    }
    if (thread) {
      const isAtTop = thread.scrollTop <= 20;
      const isAtBottom = nearBottom();
      if (navJumpTop) navJumpTop.disabled = isAtTop;
      if (navJumpBottom) navJumpBottom.disabled = isAtBottom;
      if (isAtTop && isAtBottom) {
        chatNav.classList.add('dimmed');
      } else {
        chatNav.classList.remove('dimmed');
      }
    }
  }
  const setTitle = (t) => {
    titleEl.textContent = 'ALMANAC';
    document.title = t ? `${t} \u00b7 Almanac` : 'Almanac';
    if (activePageTag) {
      if (t) {
        activePageTag.textContent = t;
        activePageTag.hidden = false;
      } else {
        activePageTag.textContent = '';
        activePageTag.hidden = true;
      }
    }
  };
  const setBusy = (b) => { state.busy = b; thread.setAttribute('aria-busy', String(b)); sendBtn.disabled = b || !input.value.trim(); };

  async function refreshList() {
    try { state.convs = await api('/api/conversations'); } catch { state.convs = []; }
    renderList();
  }
  async function openConv(id) {
    closeSidebar();
    const c = await api(`/api/conversations/${id}`);
    state.activeId = c.id;
    state.current = c;
    setTitle(c.title);
    c.messages.forEach((m) => {
      m.flags = (m.meta && m.meta.flags) || [];
      m.temporal = (m.meta && m.meta.temporal) || [];
    });
    thread.replaceChildren(...c.messages.map((m) => renderMessage(m)));
    renderList();
    toBottom();
    updateNav();
  }
  function newChat() {
    closeSidebar();
    state.activeId = null;
    state.current = null;
    setTitle('');
    showEmpty();
    renderList();
    input.focus();
  }

  async function send(text) {
    text = (text || '').trim();
    if (!text || state.busy) return;
    setBusy(true);
    const t0 = Date.now();
    const u = { id: `u${t0}`, role: 'user', content: text, createdAt: t0 };
    const a = { id: `a${t0}`, role: 'assistant', content: '', createdAt: t0, evidence: [], flags: [], meta: {}, status: 'streaming' };
    if (!state.current) state.current = { id: null, messages: [] };
    if (!state.current.messages.length) thread.replaceChildren();
    state.current.messages.push(u, a);
    thread.append(renderMessage(u));
    const aNode = renderMessage(a, { streaming: true });
    thread.append(aNode);
    toBottom();
    updateNav();

    const body = $('.msg-body', aNode), ticker = $('.ticker', aNode);
    let raf = 0;
    const paint = (highlight = false) => {
      raf = 0;
      const stick = nearBottom();
      body.replaceChildren(renderMarkdown(a, highlight));
      if (stick) toBottom();
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(paint); };

    try {
      await streamChat({ conversationId: state.activeId, message: text, tz: TZ }, {
        conversation: (d) => { state.activeId = d.id; state.current.id = d.id; if (d.title) setTitle(d.title); },
        temporal: (d) => {
          if (d && d.hints && d.hints.length) {
            a.temporal = d.hints;
            renderTemporalBadge(aNode, d.hints);
          }
        },
        status: (d) => setStep(ticker, d),
        evidence: (d) => { a.evidence = d.items || []; updateSources(aNode, a); },
        token: (d) => { a.content += d.t; schedule(); },
        reset: () => { a.content = ''; schedule(); },
        patch: (d) => { a.content = d.text; a.flags = d.flags || []; schedule(); },
        done: (d) => { a.id = d.id; a.createdAt = d.createdAt || a.createdAt; a.meta = { trace: d.trace, flags: a.flags }; a.status = 'complete'; },
        error: (d) => { a.content += (a.content ? '\n\n' : '') + d.message; schedule(); },
      });
    } catch (err) {
      if (!a.content) a.content = 'Connection dropped before I could answer. Try again.';
    } finally {
      if (raf) cancelAnimationFrame(raf);
      a.status = a.status === 'streaming' ? 'complete' : a.status;
      paint(true);
      updateSources(aNode, a);
      aNode.classList.remove('streaming');
      setBusy(false);
      refreshList();
      updateNav();
    }
  }

  async function loadHealth() {
    const today = $('#today');
    try {
      const hl = await api('/api/health');
      if (today) today.textContent = `${dayLabel(hl.now)} ${new Date(hl.now).getFullYear()}`;
      if (hl.notices && hl.notices.length) { banner.textContent = hl.notices.join(' '); banner.hidden = false; }
    } catch {
      if (today) today.textContent = `${dayLabel(Date.now())} ${new Date().getFullYear()}`;
    }
  }

  /* ---------- typewriter loading screen ---------- */
  function initTypewriterLoading() {
    const screen = $('#loadingScreen');
    const textEl = $('#typewriterText');
    if (!screen || !textEl) return;

    const word = 'ALMANAC';
    let i = 0;
    const typeNext = () => {
      if (i < word.length) {
        textEl.textContent += word[i];
        i++;
        setTimeout(typeNext, 90 + Math.random() * 45);
      } else {
        setTimeout(() => {
          screen.classList.add('fade-out');
          setTimeout(() => {
            screen.remove();
          }, 450);
        }, 360);
      }
    };
    setTimeout(typeNext, 120);
  }

  /* ---------- wiring ---------- */
  const grow = () => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 200)}px`;
    sendBtn.disabled = state.busy || !input.value.trim();
  };
  input.addEventListener('input', grow);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('#composer').requestSubmit(); }
  });
  $('#composer').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value;
    input.value = '';
    grow();
    send(text);
  });

  $('#newChat').addEventListener('click', newChat);
  if (quickNewChatBtn) quickNewChatBtn.addEventListener('click', newChat);
  if (themeToggleBtn) themeToggleBtn.addEventListener('click', () => {
    setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark', true);
  });
  if (toggleSidebarBtn) toggleSidebarBtn.addEventListener('click', toggleSidebar);
  if (closeSidebarBtn) closeSidebarBtn.addEventListener('click', closeSidebar);
  if (sidebarBackdrop) sidebarBackdrop.addEventListener('click', closeSidebar);
  
  if (navJumpTop) {
    navJumpTop.addEventListener('click', () => {
      if (thread) thread.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }
  if (navJumpBottom) {
    navJumpBottom.addEventListener('click', () => {
      if (thread) thread.scrollTo({ top: thread.scrollHeight, behavior: 'smooth' });
    });
  }
  if (thread) {
    thread.addEventListener('scroll', updateNav, { passive: true });
  }

  // Universal viewport wheel forwarding: scrolling on sides or fixed controls scrolls #thread
  window.addEventListener('wheel', (e) => {
    const localScroll = e.target.closest('.sidebar-scroll, pre, textarea, .table-wrap');
    if (localScroll) return;

    if (!e.target.closest('#thread') && thread) {
      thread.scrollBy({ top: e.deltaY, behavior: 'auto' });
    }
  }, { passive: true });

  // Clicking anywhere on sides or background focuses #thread for instant keyboard navigation
  window.addEventListener('click', (e) => {
    if (!e.target.closest('button, a, textarea, input, .msg-body, .sidebar')) {
      if (thread) thread.focus({ preventScroll: true });
    }
  });
  
  if (sidebar) {
    sidebar.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        const focusable = Array.from(sidebar.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter(el => !el.disabled && el.offsetParent !== null);
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSidebar();
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      input.focus();
      input.select();
    }

    // Scroll navigation keys when not typing
    const activeTag = document.activeElement ? document.activeElement.tagName : '';
    if (activeTag !== 'TEXTAREA' && activeTag !== 'INPUT' && thread) {
      if (e.key === 'PageDown' || (e.key === ' ' && !e.shiftKey)) {
        e.preventDefault();
        thread.scrollBy({ top: window.innerHeight * 0.75, behavior: 'smooth' });
      } else if (e.key === 'PageUp' || (e.key === ' ' && e.shiftKey)) {
        e.preventDefault();
        thread.scrollBy({ top: -window.innerHeight * 0.75, behavior: 'smooth' });
      } else if (e.key === 'Home') {
        e.preventDefault();
        thread.scrollTo({ top: 0, behavior: 'smooth' });
      } else if (e.key === 'End') {
        e.preventDefault();
        thread.scrollTo({ top: thread.scrollHeight, behavior: 'smooth' });
      }
    }
  });

  initTypewriterLoading();
  loadHealth();
  refreshList();
  showEmpty();
})();
