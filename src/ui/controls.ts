// Small DOM control kit in ROM.VIZ panel style. Every control is two-way bound to a
// store path: user input → store.set, any store change → control refresh (so presets work).
import { store } from '../state';

const syncs: Array<() => void> = [];
store.on(() => syncs.forEach((s) => s()));
const bind = (fn: () => void) => {
  syncs.push(fn);
  fn();
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, parent?: HTMLElement) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  parent?.appendChild(e);
  return e;
}

function row(parent: HTMLElement, label: string) {
  const r = el('div', 'ctrl-row', parent);
  el('span', 'ctrl-label', r).textContent = label;
  return r;
}

/** Collapsible panel group; returns the body element to fill. */
export function section(parent: HTMLElement, title: string, badge?: string) {
  const s = el('section', 'panel-section', parent);
  const head = el('button', 'section-title', s);
  head.type = 'button';
  head.innerHTML = `<span>${title}</span>${badge ? `<em class="badge">${badge}</em>` : ''}<i class="chev"></i>`;
  const body = el('div', 'section-body', s);
  head.addEventListener('click', () => s.classList.toggle('collapsed'));
  return body;
}

export function slider(
  parent: HTMLElement,
  label: string,
  path: string,
  o: { min: number; max: number; step: number; fmt?: (v: number) => string; onUser?: () => void },
) {
  const r = row(parent, label);
  const input = el('input', '', r);
  Object.assign(input, { type: 'range', min: o.min, max: o.max, step: o.step });
  const val = el('span', 'ctrl-val', r);
  const fmt = o.fmt ?? ((v: number) => String(v));
  input.addEventListener('input', () => {
    o.onUser?.();
    store.set(path, Number(input.value));
  });
  bind(() => {
    const v = store.get<number>(path);
    if (Number(input.value) !== v) input.value = String(v);
    val.textContent = fmt(v);
  });
  return { row: r, input };
}

export function select(parent: HTMLElement, label: string, path: string, options: [string, string][]) {
  const r = row(parent, label);
  const s = el('select', 'sel', r);
  for (const [v, t] of options) s.add(new Option(t, v));
  s.addEventListener('change', () => {
    const num = Number(s.value);
    store.set(path, typeof store.get(path) === 'number' && !isNaN(num) ? num : s.value);
  });
  bind(() => (s.value = String(store.get(path))));
  return { row: r, input: s };
}

/** Segmented buttons for short option lists. */
export function seg(parent: HTMLElement, label: string, path: string, options: [string | number, string][]) {
  const r = row(parent, label);
  const wrap = el('div', 'seg', r);
  const btns = options.map(([v, t]) => {
    const b = el('button', 'seg-btn', wrap);
    b.type = 'button';
    b.textContent = t;
    b.addEventListener('click', () => store.set(path, v));
    return [v, b] as const;
  });
  bind(() => btns.forEach(([v, b]) => b.classList.toggle('active', store.get(path) === v)));
  return { row: r };
}

let toggleSeq = 0;
export function toggle(parent: HTMLElement, label: string, path: string) {
  const r = el('div', 'toggle-row', parent);
  const id = `t-${path.replace(/\./g, '-')}-${++toggleSeq}`; // one path may have several toggles
  r.innerHTML = `<label for="${id}">${label}</label><span class="toggle"><input type="checkbox" id="${id}"><span class="toggle-track"></span><span class="toggle-thumb"></span></span>`;
  const input = r.querySelector('input')!;
  r.querySelector('.toggle')!.addEventListener('click', (e) => {
    if (e.target !== input) input.click();
  });
  input.addEventListener('change', () => store.set(path, input.checked));
  bind(() => (input.checked = store.get<boolean>(path)));
  return { row: r, input };
}

export function color(parent: HTMLElement, label: string, path: string) {
  const r = row(parent, label);
  const wrap = el('div', 'color-field', r);
  const picker = el('input', '', wrap);
  picker.type = 'color';
  const hex = el('input', 'hex', wrap);
  hex.type = 'text';
  hex.maxLength = 7;
  hex.spellcheck = false;
  picker.addEventListener('input', () => store.set(path, picker.value.toUpperCase()));
  hex.addEventListener('change', () => {
    const v = hex.value.trim().replace(/^#?/, '#');
    if (/^#[0-9a-f]{6}$/i.test(v)) store.set(path, v.toUpperCase());
    else hex.value = store.get<string>(path);
  });
  bind(() => {
    const v = store.get<string>(path);
    picker.value = v.toLowerCase();
    if (document.activeElement !== hex) hex.value = v;
  });
  return { row: r };
}

export function number(parent: HTMLElement, label: string, path: string, min: number, max: number, unit = '') {
  const r = row(parent, label);
  const input = el('input', 'num', r);
  Object.assign(input, { type: 'number', min, max, step: 1 });
  if (unit) el('span', 'ctrl-unit', r).textContent = unit;
  input.addEventListener('change', () => {
    const v = Math.min(max, Math.max(min, Math.round(Number(input.value) || min)));
    input.value = String(v);
    store.set(path, v);
  });
  bind(() => (input.value = String(store.get(path))));
  return { row: r, input };
}

export function text(parent: HTMLElement, label: string, path: string, placeholder = '') {
  const r = row(parent, label);
  const input = el('input', 'txt', r);
  Object.assign(input, { type: 'text', placeholder, spellcheck: false });
  input.addEventListener('change', () => store.set(path, input.value.trim()));
  bind(() => (input.value = store.get<string>(path)));
  return { row: r, input };
}

/** Small heading that groups related rows inside a section. */
export function subhead(parent: HTMLElement, label: string) {
  const h = el('div', 'subhead', parent);
  h.textContent = label;
  return h;
}

export function note(parent: HTMLElement, cls = 'note') {
  return el('div', cls, parent);
}

/** Show `node` only while `pred` holds. */
export function showIf(node: HTMLElement, pred: () => boolean) {
  bind(() => node.classList.toggle('hidden', !pred()));
}

/** Disable a control row with a reason (e.g. features from later milestones). */
export function disable(node: HTMLElement, reason: string) {
  node.classList.add('disabled');
  node.title = reason;
  node.querySelectorAll('input,select,button').forEach((i) => ((i as HTMLInputElement).disabled = true));
}

export { bind, el };
