/* ===========================================================
   Web Memo App  -  Vanilla JS
   - Profiles / Tabs / Notes (localStorage)
   - Real-time char/word/line/paragraph/reading-time stats
   - Themes (light/dark/glass/sepia/midnight)
   - Find & Replace (with highlight overlay)
   - Undo/Redo (native textarea + safety snapshots)
   - Auto-save (debounced) + restore from previous session
   - Markdown preview (minimal)
   - Export / Import (.txt .md .json)
=========================================================== */

const STORAGE_KEY = 'memo-app::state::v1';
const SETTINGS_KEY = 'memo-app::settings::v1';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const uid = () => 'n_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

/* ---------- Default state ---------- */
function defaultState() {
  const wId = uid(), pId = uid();
  const now = Date.now();
  return {
    currentProfile: 'work',
    profiles: {
      work: {
        name: '仕事',
        notes: {
          [wId]: { id: wId, title: 'はじめてのメモ', content: '# ようこそ\n\n左上のプロファイルで「仕事 / プライベート」を切替できます。\nタブを追加して並行作業もOK。\n\n- Ctrl+F : 検索\n- Ctrl+H : 置換\n- Ctrl+S : 強制保存\n- Ctrl+N : 新規ノート\n- Ctrl+W : タブを閉じる\n- Ctrl+P : Markdownプレビュー切替', createdAt: now, updatedAt: now }
        },
        openTabs: [wId],
        activeTab: wId
      },
      private: {
        name: 'プライベート',
        notes: {
          [pId]: { id: pId, title: '買い物リスト', content: '- 牛乳\n- パン\n- たまご', createdAt: now, updatedAt: now }
        },
        openTabs: [pId],
        activeTab: pId
      }
    }
  };
}

function defaultSettings() {
  return {
    theme: 'light',
    fontFamily: 'system',
    fontSize: 16,
    autosaveMs: 800,
    wrap: 'soft',
    wordMode: 'auto',
    eol: 'LF',
    tab: 'tab'
  };
}

/* ---------- Load / Save ---------- */
let state = loadJSON(STORAGE_KEY, defaultState());
let settings = loadJSON(SETTINGS_KEY, defaultSettings());

// Migrate / sanity
if (!state.profiles || !state.profiles[state.currentProfile]) {
  state = defaultState();
}

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return Object.assign({}, fallback, JSON.parse(raw));
  } catch { return fallback; }
}
function persistState() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
function persistSettings() { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }

/* ---------- DOM refs ---------- */
const editor = $('#editor');
const titleInput = $('#titleInput');
const preview = $('#preview');
const tabsEl = $('#tabs');
const noteListEl = $('#noteList');
const profileSelect = $('#profileSelect');
const saveStateEl = $('#saveState');
const toastEl = $('#toast');

/* ---------- Helpers ---------- */
function currentProfile() { return state.profiles[state.currentProfile]; }
function currentNote() {
  const p = currentProfile();
  return p?.notes[p.activeTab] || null;
}
function setActiveTab(noteId) {
  const p = currentProfile();
  if (!p.notes[noteId]) return;
  if (!p.openTabs.includes(noteId)) p.openTabs.push(noteId);
  p.activeTab = noteId;
  scheduleSave();
  renderAll();
}
function openNote(noteId) { setActiveTab(noteId); editor.focus(); }
function closeTab(noteId) {
  const p = currentProfile();
  const idx = p.openTabs.indexOf(noteId);
  if (idx < 0) return;
  p.openTabs.splice(idx, 1);
  if (p.activeTab === noteId) {
    p.activeTab = p.openTabs[idx] || p.openTabs[idx - 1] || null;
  }
  if (!p.activeTab && Object.keys(p.notes).length) {
    p.activeTab = Object.keys(p.notes)[0];
    if (!p.openTabs.includes(p.activeTab)) p.openTabs.push(p.activeTab);
  }
  scheduleSave();
  renderAll();
}
function createNote(title = '無題のノート') {
  const id = uid();
  const now = Date.now();
  const p = currentProfile();
  p.notes[id] = { id, title, content: '', createdAt: now, updatedAt: now };
  p.openTabs.push(id);
  p.activeTab = id;
  scheduleSave();
  renderAll();
  titleInput.focus();
  titleInput.select();
}
function deleteNote(id) {
  const p = currentProfile();
  if (!p.notes[id]) return;
  if (!confirm(`「${p.notes[id].title || '無題'}」を削除しますか?`)) return;
  delete p.notes[id];
  p.openTabs = p.openTabs.filter(t => t !== id);
  if (p.activeTab === id) p.activeTab = p.openTabs[p.openTabs.length - 1] || Object.keys(p.notes)[0] || null;
  if (!Object.keys(p.notes).length) createNote();
  scheduleSave();
  renderAll();
  toast('削除しました');
}

/* ---------- Render ---------- */
function renderProfiles() {
  profileSelect.innerHTML = '';
  for (const key of Object.keys(state.profiles)) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = state.profiles[key].name;
    if (key === state.currentProfile) opt.selected = true;
    profileSelect.appendChild(opt);
  }
}

function renderNoteList(filter = '') {
  const p = currentProfile();
  const q = filter.trim().toLowerCase();
  noteListEl.innerHTML = '';
  const notes = Object.values(p.notes)
    .filter(n => !q || (n.title + '\n' + n.content).toLowerCase().includes(q))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  for (const n of notes) {
    const li = document.createElement('li');
    if (n.id === p.activeTab) li.classList.add('active');
    li.dataset.id = n.id;
    const date = new Date(n.updatedAt);
    const dateStr = `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;
    li.innerHTML = `
      <div class="nl-title">${escapeHtml(n.title || '無題')}</div>
      <div class="nl-meta"><span>${escapeHtml((n.content || '').slice(0, 32).replace(/\n/g, ' ')) || '(空)'}</span><span>${dateStr}</span></div>
      <div class="nl-actions">
        <button class="icon-btn" data-act="open" title="開く">↗</button>
        <button class="icon-btn danger" data-act="del" title="削除">🗑</button>
      </div>`;
    li.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'del') { e.stopPropagation(); deleteNote(n.id); return; }
      openNote(n.id);
    });
    noteListEl.appendChild(li);
  }
}

function renderTabs() {
  const p = currentProfile();
  tabsEl.innerHTML = '';
  for (const id of p.openTabs) {
    const note = p.notes[id];
    if (!note) continue;
    const el = document.createElement('div');
    el.className = 'tab' + (id === p.activeTab ? ' active' : '');
    el.dataset.id = id;
    el.innerHTML = `<span class="tab-title">${escapeHtml(note.title || '無題')}</span><button class="tab-close" title="閉じる">✕</button>`;
    el.addEventListener('click', (e) => {
      if (e.target.closest('.tab-close')) { closeTab(id); return; }
      setActiveTab(id);
    });
    // middle-click close
    el.addEventListener('auxclick', (e) => { if (e.button === 1) closeTab(id); });
    tabsEl.appendChild(el);
  }
}

function renderEditor() {
  const note = currentNote();
  if (!note) {
    editor.value = '';
    titleInput.value = '';
    return;
  }
  if (editor.value !== note.content) editor.value = note.content;
  if (titleInput.value !== note.title) titleInput.value = note.title;
  updateStats();
  if (!preview.classList.contains('hidden')) renderPreview();
  updateHighlights();
}

function renderAll() {
  renderProfiles();
  renderTabs();
  renderNoteList($('#noteSearch').value);
  renderEditor();
}

/* ---------- Stats ---------- */
function updateStats() {
  const text = editor.value;
  const chars = [...text].length;  // count code-points (emoji aware)
  const lines = text.length ? text.split(/\r\n|\r|\n/).length : 0;
  const paras = text.trim() ? text.trim().split(/\n{2,}/).length : 0;

  let words = 0;
  if (settings.wordMode === 'space') {
    words = text.trim() ? text.trim().split(/\s+/).length : 0;
  } else if (settings.wordMode === 'cjk') {
    words = (text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu) || []).length;
  } else {
    // auto: ASCII words + CJK chars
    const ascii = (text.match(/[A-Za-z0-9]+(?:[\-'_][A-Za-z0-9]+)*/g) || []).length;
    const cjk = (text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu) || []).length;
    words = ascii + cjk;
  }
  $('#statChar').textContent = chars.toLocaleString();
  $('#statWord').textContent = words.toLocaleString();
  $('#statLine').textContent = lines.toLocaleString();
  $('#statPara').textContent = paras.toLocaleString();

  // Reading time: ~500 chars per min for JP-mixed
  const min = Math.max(1, Math.round(chars / 500));
  $('#statRead').textContent = chars ? `${min}分` : '0分';

  updateCursor();
}
function updateCursor() {
  const text = editor.value.slice(0, editor.selectionStart);
  const line = text.split(/\r\n|\r|\n/).length;
  const col = text.length - (text.lastIndexOf('\n') + 1) + 1;
  $('#statCursor').textContent = `${line}:${col}`;
  const sel = editor.selectionEnd - editor.selectionStart;
  $('#statSel').textContent = sel.toLocaleString();
}

/* ---------- Save ---------- */
let saveTimer = null;
function scheduleSave() {
  saveStateEl.classList.add('saving');
  saveStateEl.textContent = '保存中...';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    persistState();
    saveStateEl.classList.remove('saving');
    saveStateEl.textContent = '保存済み ' + new Date().toLocaleTimeString();
  }, settings.autosaveMs);
}
function flushSave() {
  clearTimeout(saveTimer);
  persistState();
  saveStateEl.classList.remove('saving');
  saveStateEl.textContent = '保存済み ' + new Date().toLocaleTimeString();
}

/* ---------- Editor events ---------- */
editor.addEventListener('input', () => {
  const n = currentNote();
  if (!n) return;
  n.content = editor.value;
  n.updatedAt = Date.now();
  updateStats();
  scheduleSave();
  renderNoteListDebounced();
  if (!preview.classList.contains('hidden')) renderPreview();
  updateHighlights();
});
editor.addEventListener('click', updateCursor);
editor.addEventListener('keyup', updateCursor);
editor.addEventListener('select', updateCursor);

titleInput.addEventListener('input', () => {
  const n = currentNote();
  if (!n) return;
  n.title = titleInput.value;
  n.updatedAt = Date.now();
  scheduleSave();
  renderTabs();
  renderNoteListDebounced();
});

let nlTimer;
function renderNoteListDebounced() {
  clearTimeout(nlTimer);
  nlTimer = setTimeout(() => renderNoteList($('#noteSearch').value), 250);
}

/* Tab key inserts tab/space */
editor.addEventListener('keydown', (e) => {
  if (e.key === 'Tab' && !e.shiftKey) {
    e.preventDefault();
    const insert = settings.tab === 'tab' ? '\t' : ' '.repeat(Number(settings.tab) || 2);
    const s = editor.selectionStart, en = editor.selectionEnd;
    editor.setRangeText(insert, s, en, 'end');
    editor.dispatchEvent(new Event('input'));
  }
});

/* ---------- Profile ---------- */
profileSelect.addEventListener('change', () => {
  state.currentProfile = profileSelect.value;
  scheduleSave();
  renderAll();
});
$('#addProfileBtn').addEventListener('click', () => {
  const name = prompt('新しいプロファイル名:', '新しい');
  if (!name) return;
  const key = name.toLowerCase().replace(/\s+/g, '-') + '-' + Math.random().toString(36).slice(2, 5);
  const id = uid();
  state.profiles[key] = { name, notes: { [id]: { id, title: '無題', content: '', createdAt: Date.now(), updatedAt: Date.now() } }, openTabs: [id], activeTab: id };
  state.currentProfile = key;
  flushSave();
  renderAll();
});
$('#renameProfileBtn').addEventListener('click', () => {
  const p = currentProfile();
  const name = prompt('プロファイル名を変更:', p.name);
  if (!name) return;
  p.name = name;
  flushSave();
  renderProfiles();
});
$('#deleteProfileBtn').addEventListener('click', () => {
  if (Object.keys(state.profiles).length <= 1) { toast('最後のプロファイルは削除できません'); return; }
  const p = currentProfile();
  if (!confirm(`プロファイル「${p.name}」とその全ノートを削除しますか?`)) return;
  delete state.profiles[state.currentProfile];
  state.currentProfile = Object.keys(state.profiles)[0];
  flushSave();
  renderAll();
});

/* ---------- Notes list ---------- */
$('#newNoteBtn').addEventListener('click', () => createNote());
$('#noteSearch').addEventListener('input', (e) => renderNoteList(e.target.value));

/* ---------- Tabs ---------- */
$('#tabAddBtn').addEventListener('click', () => createNote());

/* ---------- Toolbar ---------- */
$('#undoBtn').addEventListener('click', () => document.execCommand('undo'));
$('#redoBtn').addEventListener('click', () => document.execCommand('redo'));

$('#fontIncBtn').addEventListener('click', () => setFontSize(settings.fontSize + 1));
$('#fontDecBtn').addEventListener('click', () => setFontSize(settings.fontSize - 1));
$('#fontFamilySelect').addEventListener('change', (e) => {
  settings.fontFamily = e.target.value;
  document.body.dataset.editorFont = settings.fontFamily;
  persistSettings();
});
function setFontSize(n) {
  settings.fontSize = Math.max(10, Math.min(40, n));
  document.documentElement.style.setProperty('--editor-size', settings.fontSize + 'px');
  $('#fontSizeLabel').textContent = settings.fontSize;
  persistSettings();
}

/* ---------- Theme ---------- */
function applyTheme(theme) {
  settings.theme = theme;
  document.body.dataset.theme = theme;
  $$('.theme-btn').forEach(b => b.classList.toggle('active', b.dataset.theme === theme));
  persistSettings();
}
$$('.theme-btn').forEach(b => b.addEventListener('click', () => applyTheme(b.dataset.theme)));

/* ---------- Markdown preview ---------- */
$('#previewBtn').addEventListener('click', togglePreview);
function togglePreview() {
  preview.classList.toggle('hidden');
  if (!preview.classList.contains('hidden')) renderPreview();
}
function renderPreview() {
  preview.innerHTML = mdRender(editor.value);
}
// minimal markdown
function mdRender(src) {
  const esc = (s) => s.replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  // code blocks first
  const codes = [];
  src = src.replace(/```([\s\S]*?)```/g, (_, code) => {
    codes.push(`<pre><code>${esc(code)}</code></pre>`);
    return ` CODE${codes.length - 1} `;
  });
  let lines = src.split(/\r\n|\r|\n/);
  let html = '';
  let inList = null;
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    // headings
    let m;
    if (m = line.match(/^(#{1,6})\s+(.*)$/)) { html += `<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`; closeList(); continue; }
    if (/^\s*-{3,}\s*$/.test(line)) { html += '<hr/>'; closeList(); continue; }
    if (m = line.match(/^\s*>\s?(.*)$/)) { html += `<blockquote>${inline(m[1])}</blockquote>`; closeList(); continue; }
    if (m = line.match(/^\s*[-*+]\s+(.*)$/)) { openList('ul'); html += `<li>${inline(m[1])}</li>`; continue; }
    if (m = line.match(/^\s*\d+\.\s+(.*)$/)) { openList('ol'); html += `<li>${inline(m[1])}</li>`; continue; }
    if (line.trim() === '') { closeList(); html += ''; continue; }
    closeList();
    html += `<p>${inline(line)}</p>`;
  }
  closeList();
  function openList(t) { if (inList !== t) { closeList(); html += `<${t}>`; inList = t; } }
  function closeList() { if (inList) { html += `</${inList}>`; inList = null; } }
  function inline(s) {
    s = esc(s);
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
    return s;
  }
  return html.replace(/ CODE(\d+) /g, (_, i) => codes[+i]);
}

/* ---------- Find / Replace ---------- */
const findbar = $('#findbar');
const findInput = $('#findInput');
const replaceInput = $('#replaceInput');
const replaceOne = $('#replaceOne');
const replaceAll = $('#replaceAll');
const findCount = $('#findCount');
const findCase = $('#findCase');

let findMatches = [];
let findIndex = 0;

$('#findBtn').addEventListener('click', () => openFind(false));
$('#replaceBtn').addEventListener('click', () => openFind(true));
$('#findClose').addEventListener('click', () => closeFind());
$('#findNext').addEventListener('click', () => stepFind(1));
$('#findPrev').addEventListener('click', () => stepFind(-1));
findInput.addEventListener('input', () => doFind(true));
findCase.addEventListener('change', () => doFind(true));
replaceOne.addEventListener('click', () => doReplace(false));
replaceAll.addEventListener('click', () => doReplace(true));
findInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); stepFind(e.shiftKey ? -1 : 1); }
  if (e.key === 'Escape') closeFind();
});

function openFind(withReplace) {
  findbar.classList.remove('hidden');
  replaceInput.classList.toggle('hidden', !withReplace);
  replaceOne.classList.toggle('hidden', !withReplace);
  replaceAll.classList.toggle('hidden', !withReplace);
  // prefill with selection
  const sel = editor.value.substring(editor.selectionStart, editor.selectionEnd);
  if (sel) findInput.value = sel;
  findInput.focus(); findInput.select();
  doFind(true);
}
function closeFind() {
  findbar.classList.add('hidden');
  findMatches = [];
  updateHighlights();
}
function doFind(reset) {
  const term = findInput.value;
  findMatches = [];
  if (!term) { findCount.textContent = '0 / 0'; updateHighlights(); return; }
  const flags = findCase.checked ? 'g' : 'gi';
  const re = new RegExp(escapeRegex(term), flags);
  const text = editor.value;
  let m;
  while ((m = re.exec(text)) !== null) {
    findMatches.push({ start: m.index, end: m.index + m[0].length });
    if (m[0].length === 0) re.lastIndex++;
  }
  if (reset) findIndex = 0;
  findIndex = Math.min(findIndex, Math.max(0, findMatches.length - 1));
  findCount.textContent = `${findMatches.length ? findIndex + 1 : 0} / ${findMatches.length}`;
  if (findMatches.length) selectMatch(findIndex);
  updateHighlights();
}
function stepFind(dir) {
  if (!findMatches.length) return;
  findIndex = (findIndex + dir + findMatches.length) % findMatches.length;
  findCount.textContent = `${findIndex + 1} / ${findMatches.length}`;
  selectMatch(findIndex);
  updateHighlights();
}
function selectMatch(i) {
  const m = findMatches[i];
  if (!m) return;
  editor.focus();
  editor.setSelectionRange(m.start, m.end);
  // scroll into view
  const fakeBefore = editor.value.slice(0, m.start);
  const lineNum = fakeBefore.split(/\n/).length;
  const lineH = parseFloat(getComputedStyle(editor).lineHeight) || 24;
  editor.scrollTop = Math.max(0, (lineNum - 4) * lineH);
}
function doReplace(all) {
  if (!findMatches.length) return;
  const rep = replaceInput.value;
  if (all) {
    // replace from last to first
    let v = editor.value;
    for (let i = findMatches.length - 1; i >= 0; i--) {
      const m = findMatches[i];
      v = v.slice(0, m.start) + rep + v.slice(m.end);
    }
    const cnt = findMatches.length;
    editor.value = v;
    editor.dispatchEvent(new Event('input'));
    toast(`${cnt}件 置換`);
    doFind(true);
  } else {
    const m = findMatches[findIndex];
    if (!m) return;
    editor.setRangeText(rep, m.start, m.end, 'end');
    editor.dispatchEvent(new Event('input'));
    doFind(false);
  }
}
function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/* Highlight overlay: simply select current match (visual via ::selection).
   For a fuller solution we'd need a layered renderer; we keep things light and reliable. */
function updateHighlights() { /* selection-based; nothing to draw */ }

/* ---------- Export / Import ---------- */
$('#exportBtn').addEventListener('click', () => {
  const choice = prompt('エクスポート形式: 1=現在のノート(.md) / 2=現在のノート(.txt) / 3=全データ(.json)', '1');
  const n = currentNote();
  if (!n) return;
  if (choice === '1') saveBlob(`${n.title || 'note'}.md`, n.content);
  else if (choice === '2') saveBlob(`${n.title || 'note'}.txt`, n.content);
  else if (choice === '3') saveBlob(`memo-app-backup-${Date.now()}.json`, JSON.stringify({ state, settings }, null, 2));
});
$('#importBtn').addEventListener('click', () => $('#importInput').click());
$('#importInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  if (file.name.endsWith('.json')) {
    try {
      const data = JSON.parse(text);
      if (data.state) state = data.state;
      if (data.settings) settings = Object.assign(defaultSettings(), data.settings);
      flushSave(); persistSettings(); applyAllSettings(); renderAll();
      toast('全データを取込みました');
    } catch { toast('JSONの解析に失敗'); }
  } else {
    const id = uid();
    currentProfile().notes[id] = { id, title: file.name.replace(/\.[^.]+$/, ''), content: text, createdAt: Date.now(), updatedAt: Date.now() };
    currentProfile().openTabs.push(id);
    currentProfile().activeTab = id;
    flushSave(); renderAll();
    toast('取込みました');
  }
  e.target.value = '';
});
function saveBlob(filename, content) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------- Settings modal ---------- */
$('#settingsBtn').addEventListener('click', () => openModal($('#settingsModal')));
$$('[data-close]').forEach(el => el.addEventListener('click', () => closeModal(el.closest('.modal'))));
function openModal(m) { m.classList.remove('hidden'); }
function closeModal(m) { m.classList.add('hidden'); }

const setAutosave = $('#setAutosave');
const setWrap = $('#setWrap');
const setWordMode = $('#setWordMode');
const setEOL = $('#setEOL');
const setTab = $('#setTab');

setAutosave.addEventListener('change', () => { settings.autosaveMs = +setAutosave.value; persistSettings(); });
setWrap.addEventListener('change', () => { settings.wrap = setWrap.value; editor.wrap = settings.wrap; persistSettings(); });
setWordMode.addEventListener('change', () => { settings.wordMode = setWordMode.value; persistSettings(); updateStats(); });
setEOL.addEventListener('change', () => { settings.eol = setEOL.value; persistSettings(); });
setTab.addEventListener('change', () => { settings.tab = setTab.value; persistSettings(); });

$('#resetAllBtn').addEventListener('click', () => {
  if (!confirm('本当に全データを削除しますか?この操作は取消できません。')) return;
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(SETTINGS_KEY);
  state = defaultState(); settings = defaultSettings();
  applyAllSettings(); renderAll();
  toast('初期化しました');
  closeModal($('#settingsModal'));
});

/* ---------- Keyboard shortcuts ---------- */
window.addEventListener('keydown', (e) => {
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && e.key.toLowerCase() === 'f') { e.preventDefault(); openFind(false); }
  else if (ctrl && e.key.toLowerCase() === 'h') { e.preventDefault(); openFind(true); }
  else if (ctrl && e.key.toLowerCase() === 's') { e.preventDefault(); flushSave(); toast('保存しました'); }
  else if (ctrl && e.key.toLowerCase() === 'n') { e.preventDefault(); createNote(); }
  else if (ctrl && e.key.toLowerCase() === 'w') { e.preventDefault(); closeTab(currentProfile().activeTab); }
  else if (ctrl && e.key.toLowerCase() === 'p') { e.preventDefault(); togglePreview(); }
  else if (e.key === 'Escape' && !findbar.classList.contains('hidden')) { closeFind(); }
});

/* ---------- Boot ---------- */
function applyAllSettings() {
  applyTheme(settings.theme);
  document.body.dataset.editorFont = settings.fontFamily;
  document.documentElement.style.setProperty('--editor-size', settings.fontSize + 'px');
  $('#fontSizeLabel').textContent = settings.fontSize;
  $('#fontFamilySelect').value = settings.fontFamily;
  editor.wrap = settings.wrap;
  setAutosave.value = String(settings.autosaveMs);
  setWrap.value = settings.wrap;
  setWordMode.value = settings.wordMode;
  setEOL.value = settings.eol;
  setTab.value = settings.tab;
}

/* ---------- Utils ---------- */
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toastEl.classList.remove('show'), 1600);
}

/* ---------- Warn unsaved on unload ---------- */
window.addEventListener('beforeunload', () => { flushSave(); });

/* Go! */
applyAllSettings();
renderAll();
