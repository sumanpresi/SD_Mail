// Screens for Labels (create / rename / colour / hide / delete / counts) and Email rules
// (list, visual builder, preview on existing email, test on one email, run history).
// They live inside Settings as the "Labels" and "Email rules" tabs.
import { S, D, esc, icon, toast, confirmBox, openModal, emit } from './core.js';
import { FIELDS, OPERATORS, ACTIONS, fieldById, actionById, newRule, normalizeRule, validateRule, summarizeRule, describeAction, parseRuleSentence } from './rules-engine.js';
import { allRules, previewExisting, applyPreview, runAllNow, testRulesOnEmail, loadAllLabels, labelCatalog, labelCounts, createLabel, renameLabel, deleteLabel, rulesUsingLabel, PALETTE, ruleAccounts } from './rules.js';

const set = (fn) => S.store.update(fn);
const signedIn = () => D().accounts.filter((a) => S.demo || !S.authNeeded.has(a.email));
const disconnected = () => D().accounts.filter((a) => !S.demo && S.authNeeded.has(a.email));
const when = (t) => new Date(t).toLocaleString([], { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

function connectionNote(m) {
  const off = disconnected();
  if (!off.length) return '';
  setTimeout(() => document.querySelector('[data-goto-accounts]')?.addEventListener('click', () => m?.el.querySelector('[data-tab="accounts"]')?.click()), 0);
  return `<div class="note warn rule-warn">${icon('alert', 'sm')} <span><b>Gmail connection required</b> for ${off.map((a) => esc(a.email)).join(', ')}. Rules and labels cannot reach ${off.length > 1 ? 'these accounts' : 'this account'} until you reconnect. <a href="#" data-goto-accounts>Reconnect under Accounts</a></span></div>`;
}

// ============================ LABELS ============================
const counts = new Map(); // name(lower) -> {threads, unread, at}

export function mountLabels(panel, m) {
  const st = { editing: '', colour: '', busy: false };
  const draw = () => {
    const cat = labelCatalog();
    const hidden = new Set(D().hiddenLabels || []);
    const accts = signedIn();
    panel.innerHTML = `<h4>Labels</h4>
      <div class="note">These are your real Gmail labels. Creating, renaming or deleting one here does the same in Gmail. Deleting a label never deletes emails.</div>
      ${connectionNote(m)}
      <div class="lbl-new">
        <input class="inp" id="lbl-name" placeholder="New label, e.g. Finance  (use / for a sub-label: Projects/NGDR)" maxlength="100">
        ${accts.length > 1 ? `<select class="inp" id="lbl-acct" aria-label="Create in"><option value="">In all accounts</option>${accts.map((a) => `<option value="${esc(a.email)}">Only ${esc(a.email)}</option>`).join('')}</select>` : ''}
        <button class="btn primary" id="lbl-create">${icon('plus', 'sm')} Create</button>
      </div>
      <div class="lbl-list">${cat.map((e) => {
        const k = e.name.toLowerCase(); const c = D().labelColors[e.name]; const cnt = counts.get(k);
        if (st.editing === k) return `<div class="lbl-row editing"><span class="lbl-dot" style="background:${c || 'var(--line-2)'}"></span>
          <input class="inp" id="lbl-rename" value="${esc(e.name)}" maxlength="100" aria-label="New name"><button class="btn sm primary" data-save="${esc(e.name)}">Save</button><button class="btn sm ghost" data-cancel>Cancel</button></div>`;
        return `<div class="lbl-row ${hidden.has(e.name) ? 'is-hidden' : ''}">
          <button class="lbl-dot" data-colour="${esc(e.name)}" style="background:${c || 'var(--line-2)'}" title="Change colour" aria-label="Change colour of ${esc(e.name)}"></button>
          <div class="lbl-main"><b>${esc(e.name)}</b><small><span data-count="${esc(k)}">${!e.accounts.length ? 'Not created in Gmail yet — it is created the first time it is used' : cnt ? `${plural(cnt.threads, 'conversation')}${cnt.unread ? ` · ${cnt.unread} unread` : ''}` : 'Counting…'}</span>${e.accounts.length && accts.length > 1 ? ` · in ${e.accounts.length === accts.length ? 'all accounts' : e.accounts.map((x) => esc(x.account)).join(', ')}` : ''}</small></div>
          <label class="switch" title="Show in sidebar"><input type="checkbox" data-show="${esc(e.name)}" ${hidden.has(e.name) ? '' : 'checked'}><span></span><em>${hidden.has(e.name) ? 'Hidden' : 'Shown'}</em></label>
          <button class="iconbtn" data-rename="${esc(e.name)}" title="Rename" aria-label="Rename ${esc(e.name)}">${icon('edit', 'sm')}</button>
          <button class="iconbtn danger" data-del="${esc(e.name)}" title="Delete label" aria-label="Delete ${esc(e.name)}">${icon('trash', 'sm')}</button>
        </div>${st.colour === k ? `<div class="lbl-palette">${PALETTE.map((p) => `<button style="background:${p}" data-pick="${p}" data-for="${esc(e.name)}" class="${c === p ? 'on' : ''}" aria-label="Colour ${p}"></button>`).join('')}<button class="btn sm ghost" data-pick="" data-for="${esc(e.name)}">No colour</button></div>` : ''}`;
      }).join('') || '<div class="note">No labels yet.</div>'}</div>
      <div class="note">“Shown” labels appear in the sidebar. Colours are LifeMail's own and are saved in your Google Drive, so they follow you to every device.</div>`;
    fillCounts(cat);
  };
  const fillCounts = (cat) => {
    for (const e of cat) {
      const k = e.name.toLowerCase(); const c = counts.get(k);
      if (!e.accounts.length || (c && Date.now() - c.at < 60_000)) continue;
      labelCounts(e).then((r) => {
        counts.set(k, { ...r, at: Date.now() });
        const el = panel.querySelector(`[data-count="${CSS.escape(k)}"]`);
        if (el) el.textContent = `${plural(r.threads, 'conversation')}${r.unread ? ` · ${r.unread} unread` : ''}`;
      });
    }
  };
  const busy = async (fn) => { if (st.busy) return; st.busy = true; try { await fn(); } catch (e) { toast(e.message, { err: true, ms: 7000 }); } finally { st.busy = false; draw(); emit('side'); } };

  panel.onclick = async (e) => {
    const b = e.target.closest('button, a'); if (!b) return;
    const d = b.dataset;
    if (b.id === 'lbl-create') {
      const name = panel.querySelector('#lbl-name').value;
      const only = panel.querySelector('#lbl-acct')?.value;
      await busy(async () => { const n = await createLabel(name, only ? [only] : signedIn().map((a) => a.email)); toast(`Label “${n}” created`); });
    } else if (d.colour !== undefined) { st.colour = st.colour === d.colour.toLowerCase() ? '' : d.colour.toLowerCase(); draw(); }
    else if (d.pick !== undefined) { set((x) => { if (d.pick) x.labelColors[d.for] = d.pick; else delete x.labelColors[d.for]; }); st.colour = ''; draw(); emit('side'); }
    else if (d.rename) { st.editing = d.rename.toLowerCase(); draw(); const i = panel.querySelector('#lbl-rename'); i.focus(); i.select(); }
    else if (d.cancel !== undefined) { st.editing = ''; draw(); }
    else if (d.save) {
      const v = panel.querySelector('#lbl-rename').value;
      await busy(async () => { const n = await renameLabel(d.save, v); st.editing = ''; counts.delete(d.save.toLowerCase()); toast(`Renamed to “${n}”`); emit('reload'); });
    } else if (d.del) {
      const name = d.del; const using = rulesUsingLabel(name);
      const cnt = counts.get(name.toLowerCase());
      const ok = await confirmBox(`Delete the label “${name}” from Gmail?${cnt ? ` It is on ${plural(cnt.threads, 'conversation')}.` : ''} The emails are NOT deleted — they stay in your mailbox; only this label is removed.${using.length ? ` ${plural(using.length, 'rule')} that ${using.length === 1 ? 'applies' : 'apply'} this label (${using.map((r) => r.name).join(', ')}) will be switched off.` : ''}`, 'Delete label', true);
      if (!ok) return;
      await busy(async () => { const off = await deleteLabel(name); counts.delete(name.toLowerCase()); toast(`Label “${name}” deleted${off ? ` · ${plural(off, 'rule')} switched off` : ''}`); emit('reload'); });
    }
  };
  panel.onchange = (e) => {
    const n = e.target.dataset.show; if (n === undefined) return;
    set((x) => { x.hiddenLabels = e.target.checked ? x.hiddenLabels.filter((y) => y !== n) : [...new Set([...x.hiddenLabels, n])]; });
    draw(); emit('side');
  };
  panel.onkeydown = (e) => {
    if (e.key === 'Escape' && st.editing) { e.stopPropagation(); st.editing = ''; draw(); return; }
    if (e.key !== 'Enter') return;
    if (e.target.id === 'lbl-name') panel.querySelector('#lbl-create').click();
    if (e.target.id === 'lbl-rename') panel.querySelector('[data-save]').click();
  };
  draw();
  loadAllLabels().then(() => { if (panel.isConnected && !st.editing) draw(); });
}

// ============================ RULES ============================
const PERIODS = [[7, 'Last 7 days', 300], [30, 'Last 30 days', 500], [90, 'Last 90 days', 1000], [365, 'Last 12 months', 1000]];

export function mountRules(panel, m, startView) {
  const st = { view: startView || 'list', draft: null, preview: null, previewFor: null, busy: '', period: 30, archiveOk: false, errors: [] };
  const saveRules = (list) => set((d) => { d.rules = list; });

  const draw = () => { panel.innerHTML = VIEWS[st.view](); wire[st.view]?.(); };
  const labelNames = () => labelCatalog().map((e) => e.name);

  const VIEWS = {
    list: () => {
      const rules = allRules(); const log = D().ruleLog || [];
      return `<h4>Email rules</h4>
      <div class="note">A rule says: <b>WHEN</b> an email matches → <b>THEN</b> label it (or star, mark read…). Every rule is checked — one email can match several rules and get several labels. Rules run whenever LifeMail is open on your phone or computer, and first catch up on email that arrived while it was closed. They never delete email.</div>
      ${connectionNote(m)}
      <div class="rule-bar">
        <button class="btn primary" data-a="new">${icon('plus', 'sm')} Create rule</button>
        <button class="btn" data-a="run" ${rules.some((r) => r.enabled) ? '' : 'disabled'}>${icon('play', 'sm')} Run rules now</button>
        <button class="btn" data-a="existing" ${rules.some((r) => r.enabled) ? '' : 'disabled'}>Run on existing emails…</button>
      </div>
      ${st.busy ? `<div class="note">${esc(st.busy)}</div>` : ''}
      <div class="rule-list">${rules.map((r, i) => { const s = summarizeRule(r); return `
        <div class="rule-card ${r.enabled ? '' : 'off'}">
          <div class="rule-top"><span class="rule-n">${i + 1}</span><b class="grow">${esc(r.name)}</b>
            <label class="switch"><input type="checkbox" data-toggle="${r.id}" ${r.enabled ? 'checked' : ''}><span></span><em>${r.enabled ? 'Active' : 'Off'}</em></label></div>
          <div class="rule-line"><span class="rule-k">When</span><span>${esc(s.when)}</span></div>
          <div class="rule-line"><span class="rule-k">Then</span><span>${r.actions.map((a) => a.label ? `<span class="chip" style="${chipStyle(a.label)}">${a.type === 'removeLabel' ? '− ' : ''}${esc(a.label)}</span>` : `<span class="chip ${a.type === 'archive' ? 'risky' : ''}">${esc(describeAction(a))}</span>`).join(' ')}</span></div>
          ${r.account ? `<div class="rule-line"><span class="rule-k">Only</span><span>${esc(r.account)}</span></div>` : ''}
          <div class="rule-actions">
            <button class="btn sm" data-edit="${r.id}">${icon('edit', 'sm')} Edit</button>
            <button class="btn sm" data-test="${r.id}">Test</button>
            <button class="iconbtn" data-up="${i}" ${i === 0 ? 'disabled' : ''} title="Move up (checked earlier)" aria-label="Move up">${icon('up', 'sm')}</button>
            <button class="iconbtn" data-down="${i}" ${i === rules.length - 1 ? 'disabled' : ''} title="Move down" aria-label="Move down">${icon('down', 'sm')}</button>
            <span class="grow"></span>
            <button class="btn sm ghost danger" data-del="${r.id}">${icon('trash', 'sm')} Delete</button>
          </div>
        </div>`; }).join('') || `<div class="rule-empty">${icon('filter')}<p>No rules yet.</p><p class="note" style="background:none">Example: WHEN <i>From domain contains @gsi.gov.in</i> THEN <i>Label “GSI Mail”</i>.</p></div>`}</div>
      ${rules.length > 1 ? '<div class="note">Order: rules are checked from top to bottom. All matching rules apply; if two rules disagree about the same label, the lower rule wins.</div>' : ''}
      <h4>Run history</h4>
      ${log.length ? `<div class="rule-log">${log.slice(0, 30).map((l) => `<div class="log-row ${l.status === 'Failed' ? 'bad' : ''}">
          <span class="log-t">${esc(when(l.at))}</span>
          <span class="log-r"><b>${esc(l.rule)}</b>${D().accounts.length > 1 ? ` <small>${esc(l.account || '')}</small>` : ''}</span>
          <span class="log-n">${plural(l.checked, 'email')} checked · ${l.matched} matched${l.action ? ` · ${esc(l.action)}` : ''}</span>
          <span class="log-s">${l.status === 'Failed' ? `${icon('alert', 'sm')} Failed: ${esc(l.error)}` : `${icon('check', 'sm')} ${esc({ new: 'New email', manual: 'Run now', existing: 'Existing emails' }[l.trigger] || 'Success')}`}</span></div>`).join('')}</div>
        <button class="btn sm ghost" data-a="clearlog">Clear history</button>` : '<div class="note">Nothing yet. Each run that changes something is listed here.</div>'}`;
    },

    edit: () => {
      const r = st.draft; const isNew = !allRules().some((x) => x.id === r.id);
      const names = labelNames(); const accts = D().accounts;
      const hasArchive = r.actions.some((a) => a.type === 'archive');
      return `<button class="btn sm ghost" data-a="back">${icon('back', 'sm')} All rules</button>
      <h4>${isNew ? 'Create rule' : 'Edit rule'}</h4>
      ${isNew ? `<div class="quickfill"><label class="field" style="margin:0"><span>Quick fill <span class="hint">— optional: describe the rule in a sentence (worked out on this device, nothing is sent anywhere)</span></span>
        <div class="qf-row"><input class="inp" id="qf" placeholder="e.g. emails from @gsi.gov.in with subject NGDR, label them NGDR"><button class="btn" data-a="qf">Fill</button></div></label></div>` : ''}
      <label class="field"><span>Rule name</span><input id="r-name" value="${esc(r.name)}" placeholder="e.g. GSI Work Emails" maxlength="80"></label>
      ${accts.length > 1 ? `<label class="field"><span>Check emails in</span><select id="r-acct"><option value="">All accounts</option>${accts.map((a) => `<option value="${esc(a.email)}" ${r.account === a.email ? 'selected' : ''}>${esc(a.email)}</option>`).join('')}</select></label>` : ''}
      <div class="rb-block">
        <div class="rb-head"><b>WHEN</b>${r.conditions.length > 1 ? `<div class="seg sm" data-seg="logic"><button data-v="AND" class="${r.logic === 'AND' ? 'on' : ''}">ALL conditions (AND)</button><button data-v="OR" class="${r.logic === 'OR' ? 'on' : ''}">ANY condition (OR)</button></div>` : ''}</div>
        ${r.conditions.map((c, i) => condRow(c, i, r)).join(`<div class="rb-join">${r.logic}</div>`)}
        <button class="btn sm ghost" data-a="addc">${icon('plus', 'sm')} Add condition</button>
        <div class="hint-line">Tip: separate alternatives with commas — Subject contains <i>NGDR, BISAG</i> matches either word. Matching ignores capital letters.</div>
      </div>
      <div class="rb-block">
        <div class="rb-head"><b>THEN</b></div>
        ${r.actions.map((a, i) => actRow(a, i, names)).join('')}
        <button class="btn sm ghost" data-a="adda">${icon('plus', 'sm')} Add action</button>
        <datalist id="lbl-dl">${names.map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
        ${r.actions.some((a) => a.label && !names.some((n) => n.toLowerCase() === a.label.toLowerCase())) ? `<div class="hint-line">${icon('tag', 'sm')} A label that does not exist yet is created in Gmail the first time the rule uses it.</div>` : ''}
        ${hasArchive ? `<label class="check risky-box"><input type="checkbox" id="r-archive-ok" ${st.archiveOk ? 'checked' : ''}> <span><b>Archive is switched on.</b> Matching emails will leave the Inbox (they stay in All Mail and under their labels, and can be moved back). Tick to confirm.</span></label>` : ''}
      </div>
      ${st.errors.length ? `<div class="note warn">${st.errors.map(esc).join('<br>')}</div>` : ''}
      <div class="rb-block rb-preview">
        <div class="rb-head"><b>TEST WITH EXISTING EMAILS</b></div>
        <div class="qf-row"><select class="inp" id="r-period" style="max-width:190px">${PERIODS.map(([d, n]) => `<option value="${d}" ${st.period === d ? 'selected' : ''}>${n}</option>`).join('')}</select>
          <button class="btn" data-a="preview" ${st.busy ? 'disabled' : ''}>${icon('search', 'sm')} Test with existing emails</button></div>
        ${st.busy ? `<div class="note">${esc(st.busy)}</div>` : ''}
        ${st.preview && st.previewFor === 'draft' ? previewHtml(st.preview, st.draft) : '<div class="hint-line">Shows which of your existing emails this rule would match — nothing is changed.</div>'}
      </div>
      <div class="rb-foot">
        <button class="btn ghost" data-a="back">Cancel</button>
        <span class="grow"></span>
        ${st.preview && st.previewFor === 'draft' && st.preview.matches.length ? `<button class="btn" data-a="save-apply">${isNew ? 'Activate' : 'Save'} &amp; apply to these ${st.preview.matches.length} emails</button>` : ''}
        <button class="btn primary" data-a="save">${isNew ? `${icon('check', 'sm')} Activate rule` : 'Save rule'}</button>
      </div>
      <div class="hint-line" style="text-align:right">${isNew ? 'Activating applies the rule to new email from now on. Existing emails change only if you choose “apply to these emails”.' : ''}</div>`;
    },

    test: () => {
      const r = st.previewRule;
      return `<button class="btn sm ghost" data-a="back">${icon('back', 'sm')} All rules</button>
      <h4>Test “${esc(r.name)}”</h4>
      <div class="rule-line"><span class="rule-k">When</span><span>${esc(summarizeRule(r).when)}</span></div>
      <div class="rule-line"><span class="rule-k">Then</span><span>${esc(summarizeRule(r).then)}</span></div>
      <div class="qf-row" style="margin-top:12px"><select class="inp" id="r-period" style="max-width:190px">${PERIODS.map(([d, n]) => `<option value="${d}" ${st.period === d ? 'selected' : ''}>${n}</option>`).join('')}</select>
        <button class="btn" data-a="retest" ${st.busy ? 'disabled' : ''}>${icon('search', 'sm')} Test again</button></div>
      ${st.busy ? `<div class="note">${esc(st.busy)}</div>` : ''}
      ${st.preview ? previewHtml(st.preview, r) : ''}
      ${st.preview?.matches.some((x) => x.plan.actions.length) ? `<div class="rb-foot"><span class="grow"></span><button class="btn primary" data-a="apply-test">Apply to these ${st.preview.matches.filter((x) => x.plan.actions.length).length} emails</button></div>` : ''}
      <div class="hint-line">Tip: to see why a particular email did or did not match, open the email and choose ⋯ → Test rules on this email.</div>`;
    },

    existing: () => `<button class="btn sm ghost" data-a="back">${icon('back', 'sm')} All rules</button>
      <h4>Run rules on existing emails</h4>
      <div class="note">First LifeMail shows what would change. Nothing changes until you press Apply.</div>
      <div class="qf-row"><select class="inp" id="r-period" style="max-width:190px">${PERIODS.map(([d, n]) => `<option value="${d}" ${st.period === d ? 'selected' : ''}>${n}</option>`).join('')}</select>
        <button class="btn" data-a="preview-all" ${st.busy ? 'disabled' : ''}>${icon('search', 'sm')} Preview</button></div>
      ${st.busy ? `<div class="note">${esc(st.busy)}</div>` : ''}
      ${st.preview && st.previewFor === 'all' ? `
        <div class="pv-sum"><b>${plural(st.preview.matches.filter((x) => x.plan.actions.length).length, 'email')} will change</b> · ${plural(st.preview.checked, 'email')} checked</div>
        ${errorsHtml(st.preview)}
        <div class="pv-rules">${allRules().filter((r) => r.enabled).map((r) => `<div><span>${esc(r.name)}</span><b>${st.preview.perRule.get(r.id) || 0} matched</b></div>`).join('')}</div>
        ${matchList(st.preview.matches.filter((x) => x.plan.actions.length), null)}
        ${st.preview.matches.some((x) => x.plan.actions.length) ? `<div class="rb-foot"><span class="grow"></span><button class="btn primary" data-a="apply-all">Apply to ${plural(st.preview.matches.filter((x) => x.plan.actions.length).length, 'email')}</button></div>` : ''}` : ''}`,
  };

  const wire = {
    list: () => {
      panel.onclick = async (e) => {
        const b = e.target.closest('button, a'); if (!b || b.disabled) return;
        const d = b.dataset; const rules = allRules();
        if (d.a === 'new') { st.draft = newRule({ conditions: [{ field: 'fromDomain', op: 'contains', value: '' }], actions: [{ type: 'applyLabel', label: '' }] }); st.preview = null; st.errors = []; st.archiveOk = false; st.view = 'edit'; draw(); setTimeout(() => panel.querySelector('#qf, #r-name')?.focus(), 30); }
        else if (d.edit) { st.draft = structuredClone(rules.find((r) => r.id === d.edit)); st.preview = null; st.errors = []; st.archiveOk = st.draft.actions.some((a) => a.type === 'archive'); st.view = 'edit'; draw(); }
        else if (d.test) { st.previewRule = rules.find((r) => r.id === d.test); st.view = 'test'; st.preview = null; draw(); runPreview([st.previewRule], 'test'); }
        else if (d.up || d.down) {
          const i = +(d.up ?? d.down); const j = d.up !== undefined ? i - 1 : i + 1;
          const list = [...rules]; [list[i], list[j]] = [list[j], list[i]]; saveRules(list); draw();
        } else if (d.del) {
          const r = rules.find((x) => x.id === d.del);
          if (!(await confirmBox(`Delete the rule “${r.name}”? Labels it already applied stay on the emails.`, 'Delete rule', true))) return;
          saveRules(rules.filter((x) => x.id !== d.del)); draw(); emit('side');
        } else if (d.a === 'run') {
          st.busy = 'Running rules on new email…'; draw();
          try { const r = await runAllNow(); toast(r.errors.length ? r.errors.join('\n') : r.checked ? `${plural(r.checked, 'new email')} checked · ${r.changed} changed` : 'No new email since the last check', { err: !!r.errors.length, ms: 6000 }); }
          catch (err) { toast(err.message, { err: true }); }
          st.busy = ''; draw();
        } else if (d.a === 'existing') { st.view = 'existing'; st.preview = null; draw(); }
        else if (d.a === 'clearlog') { set((x) => { x.ruleLog = []; }); draw(); }
      };
      panel.onchange = (e) => {
        const id = e.target.dataset.toggle; if (!id) return;
        set((x) => { const r = x.rules.find((y) => y.id === id); if (r) { r.enabled = e.target.checked; if (r.enabled) r.activatedAt = Date.now(); } });
        toast(e.target.checked ? 'Rule switched on — it applies to new email from now' : 'Rule switched off'); draw(); emit('side');
      };
    },
    edit: () => {
      const r = st.draft;
      const read = () => {
        r.name = panel.querySelector('#r-name').value;
        const a = panel.querySelector('#r-acct'); if (a) r.account = a.value;
        panel.querySelectorAll('[data-c]').forEach((row) => {
          const c = r.conditions[+row.dataset.c];
          c.field = row.querySelector('[data-cf]').value;
          if (fieldById(c.field).kind === 'bool') { c.op = 'is'; c.value = row.querySelector('[data-cb]')?.value !== 'no'; }
          else { c.op = row.querySelector('[data-co]')?.value || 'contains'; const v = row.querySelector('[data-cv]'); c.value = v ? v.value : ''; }
        });
        panel.querySelectorAll('[data-ac]').forEach((row) => {
          const a2 = r.actions[+row.dataset.ac];
          a2.type = row.querySelector('[data-at]').value;
          const l = row.querySelector('[data-al]'); a2.label = l ? l.value : '';
        });
        const ok = panel.querySelector('#r-archive-ok'); if (ok) st.archiveOk = ok.checked;
        const p = panel.querySelector('#r-period'); if (p) st.period = +p.value;
      };
      const redraw = () => { read(); draw(); };
      panel.onchange = (e) => {
        if (e.target.matches('[data-cf], [data-at]')) { // field/action type changed: reshape the row
          read();
          const row = e.target.closest('[data-c]');
          if (row) { const c = r.conditions[+row.dataset.c]; if (fieldById(c.field).kind === 'bool') { c.op = 'is'; c.value = true; } else if (typeof c.value === 'boolean') { c.op = 'contains'; c.value = ''; } }
          st.preview = null; draw();
        } else if (e.target.id === 'r-period') st.period = +e.target.value;
        else if (e.target.id === 'r-archive-ok') st.archiveOk = e.target.checked;
      };
      panel.oninput = (e) => { if (e.target.matches('[data-cv], [data-co], [data-al]')) st.preview = null; };
      panel.onkeydown = (e) => { if (e.key === 'Enter' && e.target.id === 'qf') { e.preventDefault(); panel.querySelector('[data-a="qf"]').click(); } };
      panel.querySelector('[data-seg="logic"]')?.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; read(); r.logic = b.dataset.v; st.preview = null; draw(); });
      panel.onclick = async (e) => {
        const b = e.target.closest('button'); if (!b || b.disabled) return;
        const d = b.dataset;
        if (d.a === 'back') { st.view = 'list'; st.preview = null; draw(); }
        else if (d.a === 'qf') {
          const parsed = parseRuleSentence(panel.querySelector('#qf').value, labelNames());
          if (!parsed) return toast('Could not understand that. Try: “emails from @gsi.gov.in, label them GSI Mail”.', { err: true, ms: 6000 });
          read();
          Object.assign(r, { name: r.name || parsed.name, logic: parsed.logic, conditions: parsed.conditions.length ? parsed.conditions : r.conditions, actions: parsed.actions.length ? parsed.actions : r.actions });
          st.preview = null; draw(); toast('Filled in — please check it before activating');
        }
        else if (d.a === 'addc') { read(); r.conditions.push({ field: 'subject', op: 'contains', value: '' }); draw(); panel.querySelectorAll('[data-cv]').forEach((x, i, all) => i === all.length - 1 && x.focus()); }
        else if (d.rmc !== undefined) { read(); r.conditions.splice(+d.rmc, 1); if (!r.conditions.length) r.conditions.push({ field: 'subject', op: 'contains', value: '' }); st.preview = null; draw(); }
        else if (d.a === 'adda') { read(); r.actions.push({ type: 'applyLabel', label: '' }); draw(); }
        else if (d.rma !== undefined) { read(); r.actions.splice(+d.rma, 1); if (!r.actions.length) r.actions.push({ type: 'applyLabel', label: '' }); draw(); }
        else if (d.a === 'preview') {
          read(); const clean = normalizeRule(r);
          if (!clean.conditions.length) { st.errors = ['Add at least one condition (WHEN) with a value before testing.']; return draw(); }
          st.errors = []; runPreview([{ ...clean, name: clean.name || 'This rule', enabled: true }], 'draft');
        } else if (d.a === 'save' || d.a === 'save-apply') {
          read(); const clean = normalizeRule(r);
          st.errors = validateRule(clean);
          if (clean.actions.some((a) => a.type === 'archive') && !st.archiveOk) st.errors.push('Tick the box to confirm the Archive action, or remove it.');
          if (st.errors.length) return draw();
          const list = allRules(); const i = list.findIndex((x) => x.id === clean.id);
          if (i < 0) { clean.createdAt = clean.activatedAt = Date.now(); clean.enabled = true; list.push(clean); } else list[i] = { ...clean, enabled: list[i].enabled, activatedAt: list[i].activatedAt };
          saveRules(list); emit('side');
          let msg = i < 0 ? `Rule “${clean.name}” is active` : `Rule “${clean.name}” saved`;
          if (d.a === 'save-apply' && st.preview) {
            st.busy = 'Applying…'; draw();
            const res = await applyPreview(st.preview, { trigger: 'existing' });
            msg += ` · ${plural(res.changed, 'email')} updated`;
            if (res.errors.length) toast(res.errors.join('\n'), { err: true, ms: 8000 });
          }
          st.busy = ''; st.view = 'list'; st.preview = null; draw(); toast(msg);
        }
      };
    },
    test: () => {
      panel.onclick = async (e) => {
        const b = e.target.closest('button'); if (!b || b.disabled) return;
        if (b.dataset.a === 'back') { st.view = 'list'; st.preview = null; draw(); }
        else if (b.dataset.a === 'retest') { st.period = +panel.querySelector('#r-period').value; runPreview([st.previewRule], 'test'); }
        else if (b.dataset.a === 'apply-test') { await doApply(); }
      };
    },
    existing: () => {
      panel.onclick = async (e) => {
        const b = e.target.closest('button'); if (!b || b.disabled) return;
        if (b.dataset.a === 'back') { st.view = 'list'; st.preview = null; draw(); }
        else if (b.dataset.a === 'preview-all') { st.period = +panel.querySelector('#r-period').value; runPreview(allRules().filter((r) => r.enabled), 'all'); }
        else if (b.dataset.a === 'apply-all') { await doApply(); }
      };
    },
  };

  async function runPreview(rules, forWhat) {
    const max = PERIODS.find((p) => p[0] === st.period)?.[2] || 500;
    st.busy = 'Checking your emails…'; st.preview = null; st.previewFor = forWhat; draw();
    try {
      st.preview = await previewExisting(rules, { days: st.period, max, onProgress: (t) => { st.busy = t; const n = panel.querySelector('.note:not(.warn)'); if (n && /Checking/.test(n.textContent)) n.textContent = t; } });
    } catch (err) { toast(err.message, { err: true }); }
    st.busy = ''; if (panel.isConnected) draw();
  }
  async function doApply() {
    const changing = st.preview.matches.filter((x) => x.plan.actions.length);
    const risky = changing.some((x) => x.plan.removeSystem.includes('INBOX'));
    if (!(await confirmBox(`Apply to ${plural(changing.length, 'email')} now?${risky ? ' This includes ARCHIVING emails (they leave the Inbox but are not deleted).' : ''}`, 'Apply', risky))) return;
    st.busy = 'Applying…'; draw();
    const res = await applyPreview({ ...st.preview, matches: changing }, { trigger: 'existing' });
    st.busy = ''; st.view = 'list'; st.preview = null; draw();
    toast(res.errors.length ? res.errors.join('\n') : `${plural(res.changed, 'email')} updated`, { err: !!res.errors.length, ms: 6000 });
  }

  draw();
  loadAllLabels().then(() => { if (panel.isConnected && st.view === 'list') draw(); });
}

function chipStyle(label) { const c = D().labelColors[label]; return c ? `background:${c}22;color:${c}` : ''; }

function condRow(c, i, r) {
  const f = fieldById(c.field);
  return `<div class="rb-row" data-c="${i}">
    <select class="inp" data-cf aria-label="Field">${FIELDS.map((x) => `<option value="${x.id}" ${x.id === f.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
    ${f.kind === 'bool'
      ? `<select class="inp" data-cb aria-label="Value"><option value="yes" ${c.value !== false ? 'selected' : ''}>Yes</option><option value="no" ${c.value === false ? 'selected' : ''}>No</option></select><span class="rb-spacer"></span>`
      : `<select class="inp" data-co aria-label="Condition">${OPERATORS.map((o) => `<option value="${o.id}" ${o.id === c.op ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select>
         <input class="inp" data-cv value="${esc(typeof c.value === 'string' ? c.value : '')}" placeholder="${esc(f.ph || '')}" aria-label="Value" maxlength="200">`}
    <button class="iconbtn" data-rmc="${i}" title="Remove condition" aria-label="Remove condition" ${r.conditions.length < 2 ? 'disabled' : ''}>${icon('x', 'sm')}</button>
  </div>`;
}
function actRow(a, i, names) {
  const def = actionById(a.type) || ACTIONS[0];
  return `<div class="rb-row act" data-ac="${i}">
    <select class="inp" data-at aria-label="Action">${ACTIONS.map((x) => `<option value="${x.id}" ${x.id === def.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
    ${def.needsLabel ? `<input class="inp" data-al list="lbl-dl" value="${esc(a.label || '')}" placeholder="Label, e.g. GSI Mail" aria-label="Label" maxlength="100">` : '<span class="rb-spacer"></span>'}
    <button class="iconbtn" data-rma="${i}" title="Remove action" aria-label="Remove action">${icon('x', 'sm')}</button>
  </div>`;
}
function errorsHtml(p) { return p.errors.length ? `<div class="note warn">${p.errors.map(esc).join('<br>')}</div>` : ''; }
function previewHtml(p, rule) {
  const days = PERIODS.find((x) => x[0] === p.days)?.[1].toLowerCase() || '';
  return `<div class="pv-sum"><b>Matched emails: ${p.matches.length}</b> <span>of ${plural(p.checked, 'email')} checked (${esc(days)})</span></div>
    ${errorsHtml(p)}
    ${p.matches.length ? `${matchList(p.matches, rule)}${p.matches.some((x) => !x.plan.actions.length) ? `<div class="hint-line">${p.matches.filter((x) => !x.plan.actions.length).length} of them already have what this rule does — nothing to change there.</div>` : ''}` : '<div class="hint-line">No existing email matches. Check the spelling, or try a longer period.</div>'}`;
}
function matchList(matches, rule) {
  const shown = matches.slice(0, 40);
  return `<div class="pv-list">${shown.map(({ msg, plan, account }) => {
    const why = rule ? plan.matched.find((m) => m.rule.id === rule.id)?.checks || plan.matched[0]?.checks || [] : plan.matched.flatMap((m) => m.checks);
    return `<details class="pv-item"><summary><span class="pv-from">${esc(msg.fromName || msg.fromEmail || msg.from)}</span><span class="pv-subj">${esc(msg.subject || '(no subject)')}</span><span class="pv-date">${esc(new Date(msg.date).toLocaleDateString([], { day: 'numeric', month: 'short' }))}</span></summary>
      <div class="pv-why">${why.map((c) => `<div class="${c.ok ? 'ok' : 'no'}">${c.ok ? '✓' : '✗'} ${esc(c.text)}</div>`).join('')}
        ${!rule && plan.matched.length ? `<div class="pv-rn">Rules: ${plan.matched.map((m) => esc(m.rule.name)).join(', ')}</div>` : ''}
        <div class="pv-then">${plan.actions.length ? plan.actions.map((a) => `→ ${esc(a)}`).join('<br>') : 'Already done — nothing to change'}</div>
        ${D().accounts.length > 1 ? `<div class="pv-rn">${esc(account)}</div>` : ''}</div></details>`;
  }).join('')}</div>${matches.length > shown.length ? `<div class="hint-line">…and ${matches.length - shown.length} more.</div>` : ''}`;
}

// ============================ TEST ONE EMAIL ============================
/** "Test rules on this email" — shows every rule as MATCHED / NOT MATCHED and why. */
export async function openRuleTest(t) {
  const m = openModal(`<div class="mtitle">${icon('filter')}<h3>Test rules on this email</h3><button class="iconbtn" data-close aria-label="Close">${icon('x')}</button></div>
    <div class="mcontent" id="rt"><div class="note">Checking…</div></div>
    <div class="mfoot"><button class="btn ghost" data-close>Close</button><span class="grow"></span><button class="btn" data-rules>Manage rules</button><button class="btn primary" data-apply hidden>Apply now</button></div>`);
  m.el.querySelector('[data-rules]').onclick = () => { m.close(); import('./settings.js').then((s) => s.openSettings('rules')); };
  try {
    const { msg, results, plan } = await testRulesOnEmail(t.account, t.messageId);
    const box = m.el.querySelector('#rt');
    const matched = results.filter((x) => x.matched && x.applies && x.rule.enabled);
    const other = results.filter((x) => !(x.matched && x.applies && x.rule.enabled));
    box.innerHTML = `<div class="rt-mail"><b>${esc(msg.subject || '(no subject)')}</b><small>From ${esc(msg.from)}</small></div>
      ${!results.length ? '<div class="note">You have no rules yet. Choose Manage rules → Create rule.</div>' : ''}
      ${matched.length ? `<div class="rt-sec ok">MATCHED</div>${matched.map((x) => ruleResult(x)).join('')}` : results.length ? '<div class="rt-sec">No active rule matches this email.</div>' : ''}
      ${other.length ? `<div class="rt-sec no">NOT MATCHED</div>${other.map((x) => ruleResult(x)).join('')}` : ''}
      ${matched.length ? `<div class="rt-sec">THEREFORE</div><div class="pv-then">${plan.actions.length ? plan.actions.map((a) => `→ ${esc(a)}`).join('<br>') : 'Nothing to change — this email already has everything these rules do.'}</div>` : ''}`;
    if (plan.actions.length) {
      const ap = m.el.querySelector('[data-apply]'); ap.hidden = false;
      ap.onclick = async () => {
        ap.disabled = true;
        const res = await applyPreview({ checked: 1, matches: [{ account: t.account, msg, plan }] }, { trigger: 'manual' });
        toast(res.errors.length ? res.errors.join('\n') : 'Rules applied to this email', { err: !!res.errors.length });
        m.close(); emit('reload');
      };
    }
  } catch (e) {
    m.el.querySelector('#rt').innerHTML = `<div class="note warn">${e.authNeeded ? 'Gmail connection required — reconnect this account in Settings → Accounts.' : esc(e.message)}</div>`;
  }
}
function ruleResult(x) {
  const note = !x.rule.enabled ? ' <small>(rule is off)</small>' : !x.applies ? ` <small>(only checks ${esc(x.rule.account)})</small>` : '';
  return `<div class="rt-rule"><b>${esc(x.rule.name)}</b>${note}
    <div class="pv-why">${x.checks.map((c) => `<div class="${c.ok ? 'ok' : 'no'}">${c.ok ? '✓' : '✗'} ${esc(c.text)}</div>`).join('')}
    ${x.rule.conditions.length > 1 ? `<div class="pv-rn">${x.rule.logic === 'OR' ? 'Needs ANY one condition' : 'Needs ALL conditions'}</div>` : ''}</div></div>`;
}

export { ruleAccounts };
