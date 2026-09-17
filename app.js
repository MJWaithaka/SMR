(() => {
  'use strict';

  const state = {
    token: localStorage.getItem('smr_session_token_v1') || '',
    memberId: localStorage.getItem('smr_member_id_v1') || '',
    member: null,
    snapshot: null,
    query: '',
    schoolChallengeId: '',
    loginChallengeId: '',
    contributionTargetId: '',
    expandedNodeIds: new Set(),
    expansionStateKey: '',
    contextNodeId: '',
    contextDepth: 0
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
  const requestDialog = document.querySelector('#request-dialog');
  const requestSummary = document.querySelector('#request-summary');
  const requestDetail = document.querySelector('#request-detail');
  const contributionDialog = document.querySelector('#contribution-dialog');
  const contributionForm = document.querySelector('#contribution-form');
  const contributionTarget = document.querySelector('#contribution-target');
  const contributionMessage = document.querySelector('#contribution-message');
  const treeMenu = document.querySelector('#tree-menu');
  const treeMenuToggle = document.querySelector('#tree-menu-toggle');
  const treeMenuRequest = document.querySelector('#tree-menu-request');
  let toastTimer;
  let resolvePendingRequest = null;

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
      quoteCatalogueAccess: ['quote_catalogue_access', { session_token: args[0], drive_item_id: args[1] }],
      requestCatalogueAccess: ['request_catalogue_access', { session_token: args[0], drive_item_id: args[1] }],
      submitCatalogueContribution: ['submit_catalogue_contribution', { session_token: args[0], target_drive_item_id: args[1], title: args[2], source_url: args[3], note: args[4] }]
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
  function closeRequestDialog(confirmed) {
    if (!resolvePendingRequest) return;
    const resolve = resolvePendingRequest;
    resolvePendingRequest = null;
    requestDialog.close();
    resolve(confirmed);
  }
  function confirmRequest(quote) {
    const files = quote.unowned_item_count + ' unowned file' + (quote.unowned_item_count === 1 ? '' : 's');
    requestSummary.textContent = quote.label + ' — ' + coins(quote.total_price_coins) + ' 🪙';
    requestDetail.textContent = quote.item_kind === 'folder'
      ? 'This covers ' + files + '. You will receive access in Drive immediately.'
      : 'You will receive access to this file in Drive immediately.';
    requestDialog.showModal();
    return new Promise(resolve => { resolvePendingRequest = resolve; });
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
  function getExpansionStateKey() {
    return 'smr_catalogue_expansion_v1:' + (state.member && state.member.member_id ? state.member.member_id : state.memberId || 'guest');
  }
  function rememberMember(member) {
    state.member = member || null;
    state.memberId = state.member && state.member.member_id ? String(state.member.member_id) : '';
    if (state.memberId) localStorage.setItem('smr_member_id_v1', state.memberId);
    else localStorage.removeItem('smr_member_id_v1');
  }
  function loadExpansionState() {
    const key = getExpansionStateKey();
    if (state.expansionStateKey === key) return;
    state.expansionStateKey = key;
    try {
      const saved = JSON.parse(localStorage.getItem(key) || '[]');
      state.expandedNodeIds = new Set(Array.isArray(saved) ? saved.map(String) : []);
    } catch {
      state.expandedNodeIds = new Set();
      localStorage.removeItem(key);
    }
  }
  function saveExpansionState() {
    localStorage.setItem(state.expansionStateKey || getExpansionStateKey(), JSON.stringify([...state.expandedNodeIds]));
  }
  function folderById(id) {
    return [...tree.querySelectorAll('.tree-node-folder')].find(element => element.dataset.nodeId === String(id));
  }
  function snapshotNodeById(id) {
    return ((state.snapshot && state.snapshot.nodes) || []).find(node => String(node.id) === String(id)) || null;
  }
  function setFolderOpen(folder, open, save) {
    if (!folder) return;
    folder.dataset.open = String(open);
    folder.setAttribute('aria-expanded', String(open));
    const toggle = folder.querySelector(':scope > .tree-row .tree-toggle');
    if (toggle) toggle.setAttribute('aria-label', (open ? 'Collapse ' : 'Expand ') + (folder.querySelector('.tree-label') || {}).textContent);
    if (open) state.expandedNodeIds.add(folder.dataset.nodeId);
    else state.expandedNodeIds.delete(folder.dataset.nodeId);
    if (save !== false) saveExpansionState();
  }
  function setFoldersAtDepth(depth, open) {
    tree.querySelectorAll('.tree-node-folder').forEach(folder => {
      if (Number(folder.dataset.depth) === depth) setFolderOpen(folder, open, false);
    });
    saveExpansionState();
  }
  function hideTreeMenu() {
    treeMenu.hidden = true;
    state.contextNodeId = '';
  }
  function showTreeMenu(event, nodeElement) {
    event.preventDefault();
    state.contextNodeId = nodeElement.dataset.nodeId;
    state.contextDepth = Number(nodeElement.dataset.depth);
    const isFolder = nodeElement.classList.contains('tree-node-folder');
    const node = snapshotNodeById(state.contextNodeId);
    treeMenuRequest.hidden = !node || isFolder || node.access.mode !== 'requestable';
    document.querySelector('#tree-menu-contribute').hidden = !isFolder;
    treeMenuToggle.hidden = !isFolder;
    if (isFolder) {
      const isOpen = nodeElement.dataset.open === 'true';
      treeMenuToggle.querySelector('span:last-child').textContent = isOpen ? 'Collapse this folder' : 'Expand this folder';
      treeMenuToggle.querySelector('.material-symbols-outlined').textContent = isOpen ? 'expand_less' : 'expand_more';
    }
    treeMenu.hidden = false;
    const menuRect = treeMenu.getBoundingClientRect();
    treeMenu.style.left = Math.max(12, Math.min(event.clientX, window.innerWidth - menuRect.width - 12)) + 'px';
    treeMenu.style.top = Math.max(12, Math.min(event.clientY, window.innerHeight - menuRect.height - 12)) + 'px';
    treeMenuToggle.focus();
  }
  function openAccount() {
    if (state.member) document.querySelector('#signed-in-email').textContent = state.member.delivery_email;
    showForm('');
    dialog.showModal();
  }
  function catalogueFolderOptions() {
    const nodes = (state.snapshot && state.snapshot.nodes) || [];
    const byId = new Map(nodes.map(node => [String(node.id), node]));
    const pathCache = new Map();
    function pathFor(node) {
      if (pathCache.has(String(node.id))) return pathCache.get(String(node.id));
      const parent = byId.get(String(node.parent_id || ''));
      const path = (parent ? pathFor(parent) + ' › ' : '') + node.name;
      pathCache.set(String(node.id), path);
      return path;
    }
    return nodes.filter(node => node.kind === 'folder').map(node => ({ id: String(node.id), path: pathFor(node) })).sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
  }
  function openContribution(targetId) {
    if (!state.member) {
      openAccount();
      setMessage('Sign in first, then contribute material.');
      return;
    }
    const folders = catalogueFolderOptions();
    if (!folders.length) return showToast('The catalogue is still loading. Try again in a moment.');
    contributionTarget.replaceChildren();
    folders.forEach(folder => {
      const option = document.createElement('option');
      option.value = folder.id;
      option.textContent = folder.path;
      contributionTarget.append(option);
    });
    contributionTarget.value = folders.some(folder => folder.id === String(targetId || '')) ? String(targetId) : folders[0].id;
    state.contributionTargetId = contributionTarget.value;
    contributionMessage.textContent = '';
    contributionDialog.showModal();
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
    try {
      const quote = await callServer('quoteCatalogueAccess', state.token, node.access.purchase_drive_item_id || node.id);
      if (quote.already_owned) return showToast('You already own every currently priced item here.');
      if (!(await confirmRequest(quote))) return;
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
    wrapper.dataset.nodeId = String(node.id);
    wrapper.dataset.depth = String(depth);
    wrapper.style.setProperty('--depth', depth);
    const shouldOpen = Boolean(state.query) || depth === 0 || state.expandedNodeIds.has(String(node.id));
    wrapper.dataset.open = String(shouldOpen);
    wrapper.setAttribute('role', 'treeitem');
    if (isFolder) wrapper.setAttribute('aria-expanded', String(shouldOpen));
    const row = document.createElement('div');
    row.className = 'tree-row';
    if (isFolder) {
      const toggle = document.createElement('button');
      toggle.className = 'tree-toggle';
      toggle.type = 'button';
      toggle.setAttribute('aria-label', (shouldOpen ? 'Collapse ' : 'Expand ') + node.name);
      toggle.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">expand_more</span>';
      toggle.addEventListener('click', () => {
        const open = wrapper.dataset.open === 'true';
        setFolderOpen(wrapper, !open);
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
    const requiresAccess = node.access.mode === 'requestable' && !isFolder;
    const needsConfiguration = node.access.mode === 'unconfigured';
    const isAction = !isFolder || requiresAccess || needsConfiguration;
    const label = document.createElement(isAction ? 'button' : 'span');
    label.className = 'tree-label' + (isAction ? ' tree-link' : '') + ((requiresAccess || needsConfiguration) ? ' tree-link-restricted' : '');
    label.textContent = String(node.name).replace(' 🪙', '');
    if (isAction) {
      label.type = 'button';
      label.title = requiresAccess ? 'Request access with coins' : needsConfiguration ? 'This coin-marked material is not configured for website requests yet' : 'Open ' + node.name;
      label.addEventListener('click', () => {
        if (requiresAccess) return requestAccess(node);
        if (needsConfiguration) return showToast('This coin-marked material is not priced for website requests yet.');
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
    loadExpansionState();
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
      rememberMember(state.snapshot.member || null);
      if (!state.member) {
        state.token = '';
        localStorage.removeItem('smr_session_token_v1');
      }
      loadExpansionState();
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
  document.querySelector('#close-request-dialog').addEventListener('click', () => closeRequestDialog(false));
  document.querySelector('#cancel-request').addEventListener('click', () => closeRequestDialog(false));
  document.querySelector('#confirm-request').addEventListener('click', () => closeRequestDialog(true));
  requestDialog.addEventListener('cancel', event => { event.preventDefault(); closeRequestDialog(false); });
  document.querySelectorAll('.back-button').forEach(button => button.addEventListener('click', () => showForm('')));
  document.querySelector('#show-login').addEventListener('click', () => showForm('login-form'));
  document.querySelector('#show-signup').addEventListener('click', () => showForm('school-form'));
  document.querySelector('#contribute-button').addEventListener('click', () => openContribution(''));
  document.querySelector('#close-contribution-dialog').addEventListener('click', () => contributionDialog.close());
  document.querySelector('#sign-out').addEventListener('click', async () => {
    try { await callServer('signOut', state.token); } catch { /* Local sign-out still succeeds. */ }
    state.token = '';
    rememberMember(null);
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
    setFolderOpen(node, true, false);
  }));
  document.querySelector('#expand-all').addEventListener('click', saveExpansionState);
  tree.addEventListener('contextmenu', event => {
    const row = event.target.closest('.tree-row');
    const nodeElement = row && row.parentElement;
    if (nodeElement) showTreeMenu(event, nodeElement);
  });
  treeMenuRequest.addEventListener('click', () => {
    const node = snapshotNodeById(state.contextNodeId);
    hideTreeMenu();
    if (node) requestAccess(node);
  });
  treeMenuToggle.addEventListener('click', () => {
    const folder = folderById(state.contextNodeId);
    if (folder) setFolderOpen(folder, folder.dataset.open !== 'true');
    hideTreeMenu();
  });
  document.querySelector('#tree-menu-contribute').addEventListener('click', () => {
    const targetId = state.contextNodeId;
    hideTreeMenu();
    openContribution(targetId);
  });
  document.querySelector('#tree-menu-collapse-level').addEventListener('click', () => { setFoldersAtDepth(state.contextDepth, false); hideTreeMenu(); });
  document.querySelector('#tree-menu-expand-level').addEventListener('click', () => { setFoldersAtDepth(state.contextDepth, true); hideTreeMenu(); });
  document.addEventListener('pointerdown', event => { if (!treeMenu.hidden && !treeMenu.contains(event.target)) hideTreeMenu(); });
  window.addEventListener('resize', hideTreeMenu);
  window.addEventListener('scroll', hideTreeMenu, true);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !treeMenu.hidden) hideTreeMenu();
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      search.focus();
    }
  });

  contributionForm.addEventListener('submit', async event => {
    event.preventDefault();
    contributionMessage.textContent = 'Submitting for review…';
    try {
      const result = await callServer('submitCatalogueContribution', state.token, contributionTarget.value, document.querySelector('#contribution-title-input').value, document.querySelector('#contribution-url').value, document.querySelector('#contribution-note').value);
      contributionDialog.close();
      contributionForm.reset();
      showToast(result.duplicate ? 'That contribution is already waiting for review.' : 'Submitted for community review.');
    } catch (error) {
      contributionMessage.textContent = error.message;
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
      rememberMember(result.member);
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
      rememberMember(result.member);
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
