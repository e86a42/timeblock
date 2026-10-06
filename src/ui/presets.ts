// §6.5 — Presets: three built-in looks plus full-parameter JSON save/load.
import { DEFAULTS, store, type Params } from '../state';
import { download } from '../io/exportMp4';

type Partial2<T> = { [K in keyof T]?: Partial<T[K]> };

export const BUILTIN: Record<string, { label: string; params: Partial2<Params> }> = {
  ghostTrail: {
    label: 'Ghost Trail',
    params: {
      canvas: { sourceBg: false },
      block: {
        blend: 'additive', opacity: 0.12, falloff: 0.85, falloffCurve: 0.6, spacing: 1.2, subframes: 4,
        feather: 8, highlight: true, heroOpacity: 1, heroFullFrame: false, bbox: false, colorOverTime: false,
      },
      subject: { anchor: 'none' },
      camera: { animation: 'orbit', orbitStart: -30, orbitAngle: 60, orbitEase: 'ease', playback: 'buildup' },
      pip: { enabled: false },
    },
  },
  planeStack: {
    label: 'Plane Stack',
    params: {
      canvas: { sourceBg: false },
      block: {
        blend: 'normal', opacity: 0.35, falloff: 0.4, falloffCurve: 1, spacing: 1.5, subframes: 3,
        feather: 4, highlight: true, heroOpacity: 1, heroFullFrame: true, bbox: false, colorOverTime: false,
      },
      subject: { anchor: 'none' },
      camera: { animation: 'orbit+dolly', orbitStart: -45, orbitAngle: 90, orbitEase: 'linear', playback: 'buildup' },
      pip: { enabled: false },
    },
  },
  silhouetteVolume: {
    label: 'Silhouette Volume',
    params: {
      canvas: { sourceBg: false },
      block: {
        blend: 'additive', opacity: 0.1, falloff: 0.3, falloffCurve: 1, spacing: 1, subframes: 3,
        feather: 2, highlight: true, heroOpacity: 1, heroFullFrame: false, bbox: true, colorOverTime: true,
      },
      subject: { anchor: 'center', anchorStrength: 1 },
      camera: { animation: 'orbit', orbitStart: -60, orbitAngle: 120, orbitEase: 'linear', playback: 'buildup' },
      pip: { enabled: true, trackBox: true },
    },
  },
};

const FILE_TAG = 'timeblock-preset';

export function savePreset() {
  const json = JSON.stringify({ type: FILE_TAG, version: 1, params: store.p }, null, 2);
  download(new Blob([json], { type: 'application/json' }), 'timeblock_preset.json');
}

/** Apply a full params object; timing values saved with it win over auto-follow rules. */
function applyFull(params: any) {
  // Auto-follow flags first so loaded Duration / Build-up values are not overwritten.
  store.set('export.durationAuto', false);
  store.set('camera.buildAuto', false);
  store.load(params);
  store.load({ export: { duration: params.export?.duration } });
  store.load({ camera: { buildTime: params.camera?.buildTime } });
}

export async function loadPresetFile(file: File) {
  const obj = JSON.parse(await file.text());
  if (obj?.type !== FILE_TAG || typeof obj.params !== 'object') throw new Error('TIME.BLOCK 프리셋 파일이 아닙니다');
  applyFull(obj.params);
}

// ── User presets (named, kept in this browser) ──────────────
export interface UserPreset {
  name: string;
  savedAt: number;
  params: Params;
}

const STORAGE_KEY = 'timeblock.userPresets.v1';

export function listUserPresets(): UserPreset[] {
  try {
    const list = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(list) ? list.filter((p) => typeof p?.name === 'string' && p.params) : [];
  } catch {
    return [];
  }
}

function writeUserPresets(list: UserPreset[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false; // private mode / storage blocked
  }
}

/**
 * Snapshot of the current look. The clip range and output file name belong to one video,
 * so they are left out — applying a preset to another clip keeps that clip's In/Out.
 */
function snapshot(): Params {
  const p = structuredClone(store.p) as any;
  delete p.block.inT;
  delete p.block.outT;
  delete p.export.fileName;
  return p;
}

/** Save (or overwrite) a named preset from the current settings. */
export function saveUserPreset(name: string) {
  const list = listUserPresets().filter((p) => p.name !== name);
  list.push({ name, savedAt: Date.now(), params: snapshot() });
  list.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  return writeUserPresets(list);
}

export function deleteUserPreset(name: string) {
  return writeUserPresets(listUserPresets().filter((p) => p.name !== name));
}

export function applyUserPreset(name: string) {
  const p = listUserPresets().find((x) => x.name === name);
  if (p) applyFull(p.params);
}

// ── Manager dialog ──────────────────────────────────────────
function presetDialog(onChange: () => void, onError: (msg: string) => void) {
  const dlg = document.createElement('dialog');
  dlg.className = 'preset-dialog';
  dlg.innerHTML = `
    <form method="dialog" class="pd-head">
      <div class="section-title static"><span>내 프리셋</span></div>
      <button class="pd-close" aria-label="닫기">✕</button>
    </form>
    <div class="pd-save">
      <input class="txt" type="text" maxlength="40" placeholder="프리셋 이름" spellcheck="false" />
      <button class="btn btn--accent btn--sm" type="button">저장</button>
    </div>
    <div class="note pd-hint">현재 파라미터 전체를 이 브라우저에 저장합니다 (영상 구간 In/Out · 파일 이름 제외).</div>
    <ul class="pd-list"></ul>`;
  document.body.appendChild(dlg);
  const input = dlg.querySelector<HTMLInputElement>('.pd-save input')!;
  const saveBtn = dlg.querySelector<HTMLButtonElement>('.pd-save button')!;
  const list = dlg.querySelector<HTMLUListElement>('.pd-list')!;
  const fmtDate = (t: number) =>
    new Date(t).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  const refreshSave = () => {
    const name = input.value.trim();
    const exists = listUserPresets().some((p) => p.name === name);
    saveBtn.disabled = !name;
    saveBtn.textContent = exists ? '덮어쓰기' : '저장';
  };

  const render = () => {
    const items = listUserPresets();
    list.replaceChildren(
      ...items.map((p) => {
        const li = document.createElement('li');
        li.innerHTML = `<div class="pd-name"></div><div class="pd-date mono"></div>
          <button type="button" class="btn btn--sm" data-act="apply">적용</button>
          <button type="button" class="btn btn--sm" data-act="update" title="현재 설정으로 덮어쓰기">갱신</button>
          <button type="button" class="btn btn--sm pd-del" data-act="delete" title="삭제">삭제</button>`;
        li.querySelector('.pd-name')!.textContent = p.name;
        li.querySelector('.pd-date')!.textContent = fmtDate(p.savedAt);
        li.addEventListener('click', (e) => {
          const act = (e.target as HTMLElement).dataset.act;
          if (act === 'apply') applyUserPreset(p.name);
          if (act === 'update' && !saveUserPreset(p.name)) onError('브라우저 저장소에 쓸 수 없습니다');
          if (act === 'delete') {
            const btn = e.target as HTMLButtonElement;
            if (btn.dataset.confirm !== '1') {
              btn.dataset.confirm = '1';
              btn.textContent = '확인';
              setTimeout(() => {
                btn.dataset.confirm = '';
                btn.textContent = '삭제';
              }, 2500);
              return;
            }
            deleteUserPreset(p.name);
          }
          if (act) {
            render();
            onChange();
          }
        });
        return li;
      }),
    );
    if (!items.length) {
      const empty = document.createElement('li');
      empty.className = 'pd-empty';
      empty.textContent = '저장된 프리셋이 없습니다.';
      list.appendChild(empty);
    }
    refreshSave();
  };

  const save = () => {
    const name = input.value.trim();
    if (!name) return;
    if (!saveUserPreset(name)) return onError('브라우저 저장소에 쓸 수 없습니다 (시크릿 모드일 수 있음)');
    input.value = '';
    render();
    onChange();
  };
  input.addEventListener('input', refreshSave);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      save();
    }
  });
  saveBtn.addEventListener('click', save);
  dlg.addEventListener('click', (e) => e.target === dlg && dlg.close()); // backdrop click

  return {
    open() {
      input.value = `프리셋 ${listUserPresets().length + 1}`;
      render();
      dlg.showModal();
      input.select();
    },
  };
}

// ── Topbar menu ─────────────────────────────────────────────
export function bindPresetMenu(select: HTMLSelectElement, onError: (msg: string) => void) {
  const build = () => {
    select.innerHTML = '';
    select.add(new Option('Preset', ''));
    const group = (label: string, opts: [string, string][]) => {
      const g = document.createElement('optgroup');
      g.label = label;
      for (const [v, t] of opts) g.appendChild(new Option(t, v));
      select.appendChild(g);
    };
    group('기본 프리셋', Object.entries(BUILTIN).map(([id, p]) => [id, p.label]));
    const mine = listUserPresets();
    if (mine.length) group('내 프리셋', mine.map((p) => [`user:${p.name}`, p.name]));
    group('관리', [
      ['manage', '현재 설정을 프리셋으로 저장…'],
      ['save', 'JSON 파일로 내보내기…'],
      ['load', 'JSON 파일 불러오기…'],
      ['reset', '기본값으로 초기화'],
    ]);
  };
  build();
  const dialog = presetDialog(build, onError);

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'application/json,.json';
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files?.[0];
    fileInput.value = '';
    if (f) await loadPresetFile(f).catch((e) => onError((e as Error).message));
  });

  select.addEventListener('change', () => {
    const v = select.value;
    select.value = '';
    if (v === 'manage') dialog.open();
    else if (v === 'save') savePreset();
    else if (v === 'load') fileInput.click();
    else if (v === 'reset') {
      const { inT, outT } = store.p.block; // keep the clip range
      store.load({ ...DEFAULTS, block: { ...DEFAULTS.block, inT, outT } });
    } else if (v.startsWith('user:')) applyUserPreset(v.slice(5));
    else if (BUILTIN[v]) store.load(BUILTIN[v].params);
  });
}
