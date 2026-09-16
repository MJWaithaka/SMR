(() => {
  'use strict';

  const state = {
    token: localStorage.getItem('smr_session_token_v1') || '',
    member: null,
    snapshot: null,
    query: '',
    schoolChallengeId: '',
    loginChallengeId: ''
  };
  const tree = document.querySelector('#catalogue-tree');
  const search = document.querySelector('#catalogue-search');
  const emptyState = document.querySelector('#empty-state');
  const syncStatus = document.querySelector('#sync-status');
  const accountButton = document.querySelector('#account-button');
  const accountBalance = document.querySelector('#account-balance');
  const dialog = document.querySelector('#account-dialog');
  const formMessage = document.querySelector('#form-message');
  const forms = [...document.querySelectorAll('.auth-form')];
  const toast = document.querySelector('#toast');
  let toastTimer;

  function apiUrl() {
    const configured = String(window.SMR_API_BASE_URL || '').replace(/\/+$/, '');
    if (!configured) throw new Error('The SMR connection has not been configured yet.');
    return configured + '/api';
  }

  async function callServer(name, ...args) {
    const requests = {
      getCatalogueSnapshot: ['catalogue_snapshot', { session_token: args[0] || '' }],
      requestSchoolSignupCode: ['request_school_signup_code', { school_email: args[0] }],
      verifySchoolSignupCode: ['verify_school_signup_code', { challenge_id: args[0], code: args[1] }],
      requestLoginCode: ['request_login_code', { email: args[0] }],
      completeLogin: ['complete_login', { challenge_id: args[0], code: args[1] }],
      signOut: ['sign_out', { session_token: args[0] || '' }],
      requestCatalogueAccess: ['request_catalogue_access', { session_token: args[0], drive_item_id: args[1] }]
    };
    const request = requests[name];
    if (!request) throw new Error('Unsupported SMR action.');
    const response = await fetch(apiUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: request[0], payload: request[1] })
    });
    const body = await response.json().catch(() => null);
    if (!body || !body.ok) throw new Error((body && body.error) || 'The SMR service could not complete that request.');
    return body.data;
  }

  function coins(value) { return (Math.round(Number(value || 0) * 100) / 100).toString(); }
  function showToast(message) {
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 5000);
  }
  function setMessage(message) { formMessage.textContent = message || ''; }
  function showForm(id) {
    forms.forEach(form => { form.hidden = form.id !== id; });
    document.querySelector('#account-home').hidden = Boolean(id) || Boolean(state.member);
    document.querySelector('#signed-in-panel').hidden = !state.member;
    setMessage('');
  }
  function updateAccount() {
    const signedIn = Boolean(state.member);
    document.querySelector('.account-name').textContent = signedIn ? 'Your account' : 'Sign in';
    accountBalance.hidden = !signedIn;
    if (signedIn) accountBalance.textContent = coins(state.member.balance_coins) + ' 🪙';
  }
  function openAccount() {
    if (state.member) document.querySelector('#signed-in-email').textContent = state.member.delivery_email;
    showForm('');
    dialog.showModal();
  }
  function buildTree(nodes) {
    const byId = new Map(nodes.map(node => [String(node.id), { ...node, children: [] }]));
    const roots = [];
    byId.forEach(node => {
      const parent = byId.get(String(node.parent_id || ''));
      if (parent) parent.children.push(node); else roots.push(node);
    });
    const sortNodes = list => list
      .sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true }))
      .forEach(node => sortNodes(node.children));
    sortNodes(roots);
    return roots;
  }
  function matches(node) {
    const ownText = [node.name, ...(node.announcements || []).map(item => item.message)].join(' ').toLowerCase();
    return !state.query || ownText.includes(state.query) || node.children.some(matches);
  }
  async function requestAccess(node) {
    if (!state.member) {
      openAccount();
      setMessage('Sign in first, then request this item.');
      return;
    }
    const price = coins(node.access.price_millis / 1000);
    const label = node.access.purchase_label || node.name;
    const isFolder = node.access.purchase_drive_item_id && node.access.purchase_drive_item_id !== node.id;
    const itemWord = isFolder || node.kind === 'folder' ? 'folder and everything inside it' : 'file';
    if (!window.confirm('Request ' + label + ' for ' + price + ' 🪙? You will receive the ' + itemWord + ' in Drive.')) return;
    try {
      const result = await callServer('requestCatalogueAccess', state.token, node.access.purchase_drive_item_id || node.id);
      if (result.status === 'COMPLETED') showToast('Access granted. It is now available in Drive.');
      else showToast(result.error || 'The request could not be completed; your held coins were released.');
      await loadCatalogue();
    } catch (error) {
      showToast(error.message);
    }
  }
  function createNode(node, depth) {
    if (!matches(node)) return null;
    const isFolder = node.kind === 'folder';
    const wrapper = document.createElement('div');
    wrapper.className = 'tree-node tree-node-' + (isFolder ? 'folder' : 'file');
    wrapper.style.setProperty('--depth', depth);
    wrapper.dataset.open = 'true';
    wrapper.setAttribute('role', 'treeitem');
    if (isFolder) wrapper.setAttribute('aria-expanded', 'true');
    const row = document.createElement('div');
    row.className = 'tree-row';
    if (isFolder) {
      const toggle = document.createElement('button');
      toggle.className = 'tree-toggle';
      toggle.type = 'button';
      toggle.setAttribute('aria-label', 'Collapse ' + node.name);
      toggle.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">expand_more</span>';
      toggle.addEventListener('click', () => {
        const open = wrapper.dataset.open === 'true';
        wrapper.dataset.open = String(!open);
        wrapper.setAttribute('aria-expanded', String(!open));
        toggle.setAttribute('aria-label', (open ? 'Expand ' : 'Collapse ') + node.name);
      });
      row.append(toggle);
    } else {
      const spacer = document.createElement('span');
      spacer.className = 'tree-toggle';
      spacer.setAttribute('aria-hidden', 'true');
      row.append(spacer);
    }
    const icon = document.createElement('span');
    icon.className = 'tree-icon material-symbols-outlined';
    icon.textContent = isFolder ? 'folder' : 'description';
    icon.setAttribute('aria-hidden', 'true');
    row.append(icon);
    const label = document.createElement(isFolder ? 'span' : 'button');
    label.className = isFolder ? 'tree-label' : 'tree-label tree-link ' + (node.access.mode === 'requestable' ? 'tree-link-restricted' : '');
    label.textContent = String(node.name).replace(' 🪙', '');
    if (!isFolder) {
      label.type = 'button';
      label.title = node.access.mode === 'requestable' ? 'Request access with coins' : 'Open ' + node.name;
      label.addEventListener('click', () => {
        if (node.access.mode === 'requestable') return requestAccess(node);
        if (!node.web_url) return showToast('Refreshing the latest catalogue…');
        window.open(node.web_url, '_blank', 'noopener');
      });
    }
    row.append(label);
    if (node.coin_marked) {
      const coin = document.createElement('span');
      coin.className = 'tree-coin';
      coin.textContent = '🪙';
      coin.setAttribute('aria-label', 'Coin-marked item');
      row.append(coin);
    }
    wrapper.append(row);
    (node.announcements || []).forEach(item => {
      const note = document.createElement('p');
      note.className = 'tree-note';
      note.textContent = item.message;
      wrapper.append(note);
    });
    if (isFolder && node.children.length) {
      const children = document.createElement('div');
      children.className = 'tree-children';
      children.setAttribute('role', 'group');
      node.children.forEach(child => {
        const childNode = createNode(child, depth + 1);
        if (childNode) children.append(childNode);
      });
      wrapper.append(children);
    }
    return wrapper;
  }
  function renderCatalogue() {
    tree.replaceChildren();
    const roots = buildTree(state.snapshot.nodes || []);
    let count = 0;
    roots.forEach(node => {
      const element = createNode(node, 0);
      if (element) { tree.append(element); count += 1; }
    });
    emptyState.hidden = count !== 0;
  }
  function loadCachedCatalogue() {
    try {
      const cached = JSON.parse(localStorage.getItem('smr_public_catalogue_v1') || 'null');
      if (!cached || !cached.saved_at || Date.now() - cached.saved_at > 6 * 60 * 60 * 1000) return;
      state.snapshot = cached.snapshot;
      renderCatalogue();
      syncStatus.innerHTML = '<span class="status-dot"></span>Refreshing';
    } catch {
      localStorage.removeItem('smr_public_catalogue_v1');
    }
  }
  function savePublicCatalogue(snapshot) {
    const publicNodes = (snapshot.nodes || []).map(node => ({
      ...node,
      web_url: '',
      access: { ...node.access, mode: node.access.is_owned ? 'requestable' : node.access.mode }
    }));
    localStorage.setItem('smr_public_catalogue_v1', JSON.stringify({ saved_at: Date.now(), snapshot: { nodes: publicNodes } }));
  }
  async function loadCatalogue() {
    syncStatus.innerHTML = '<span class="status-dot"></span>Syncing';
    try {
      state.snapshot = await callServer('getCatalogueSnapshot', state.token);
      state.member = state.snapshot.member || null;
      if (!state.member) {
        state.token = '';
        localStorage.removeItem('smr_session_token_v1');
      }
      savePublicCatalogue(state.snapshot);
      updateAccount();
      renderCatalogue();
      syncStatus.innerHTML = '<span class="status-dot"></span>Synced';
    } catch (error) {
      tree.innerHTML = '<p class="loading-state">The catalogue could not load. Refresh to try again.</p>';
      syncStatus.textContent = 'Unavailable';
      showToast(error.message);
    }
  }

  accountButton.addEventListener('click', openAccount);
  document.querySelector('#close-dialog').addEventListener('click', () => dialog.close());
  document.querySelectorAll('.back-button').forEach(button => button.addEventListener('click', () => showForm('')));
  document.querySelector('#show-login').addEventListener('click', () => showForm('login-form'));
  document.querySelector('#show-signup').addEventListener('click', () => showForm('school-form'));
  document.querySelector('#contribute-button').addEventListener('click', () => showToast('Contributions will be added to this same course tree next.'));
  document.querySelector('#sign-out').addEventListener('click', async () => {
    try { await callServer('signOut', state.token); } catch { /* Local sign-out still succeeds. */ }
    state.token = '';
    state.member = null;
    localStorage.removeItem('smr_session_token_v1');
    updateAccount();
    dialog.close();
    loadCatalogue();
  });
  search.addEventListener('input', event => {
    state.query = event.target.value.trim().toLowerCase();
    if (state.snapshot) renderCatalogue();
  });
  document.querySelector('#expand-all').addEventListener('click', () => tree.querySelectorAll('.tree-node-folder').forEach(node => {
    node.dataset.open = 'true';
    node.setAttribute('aria-expanded', 'true');
  }));
  document.addEventListener('keydown', event => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      search.focus();
    }
  });

  document.querySelector('#login-form').addEventListener('submit', async event => {
    event.preventDefault();
    setMessage('Sending your code…');
    try {
      const result = await callServer('requestLoginCode', document.querySelector('#login-email').value);
      state.loginChallengeId = result.challenge_id || '';
      showForm('login-code-form');
      setMessage('If that address has an account, its code is on the way.');
    } catch (error) { setMessage(error.message); }
  });
  document.querySelector('#login-code-form').addEventListener('submit', async event => {
    event.preventDefault();
    setMessage('Signing you in…');
    try {
      const result = await callServer('completeLogin', state.loginChallengeId, document.querySelector('#login-code').value);
      state.token = result.session_token;
      state.member = result.member;
      localStorage.setItem('smr_session_token_v1', state.token);
      updateAccount();
      dialog.close();
      showToast('Signed in.');
      loadCatalogue();
    } catch (error) { setMessage(error.message); }
  });
  document.querySelector('#school-form').addEventListener('submit', async event => {
    event.preventDefault();
    setMessage('Sending your code…');
    try {
      const result = await callServer('requestSchoolSignupCode', document.querySelector('#school-email').value);
      state.schoolChallengeId = result.challenge_id;
      showForm('school-code-form');
      setMessage('A school verification code was sent.');
    } catch (error) { setMessage(error.message); }
  });
  document.querySelector('#school-code-form').addEventListener('submit', async event => {
    event.preventDefault();
    setMessage('Verifying…');
    try {
      const result = await callServer('verifySchoolSignupCode', state.schoolChallengeId, document.querySelector('#school-code').value);
      state.token = result.session_token;
      state.member = result.member;
      localStorage.setItem('smr_session_token_v1', state.token);
      updateAccount();
      dialog.close();
      showToast('Your SMR account is ready.');
      loadCatalogue();
    } catch (error) { setMessage(error.message); }
  });

  loadCachedCatalogue();
  loadCatalogue();
})();
