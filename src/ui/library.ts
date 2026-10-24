/**
 * The screens for the holes and courses the player keeps: My holes & courses, the course editor, and the one hole
 * picker both that and Practice are built on. Each fills the page with a sheet and wires its buttons; every decision
 * about what a course still needs, or what a hole is called, comes from `src/game/library.ts`.
 */
import { COURSES } from '../engine/generator';
import {
  MAX_NAME,
  coursePar,
  courseStep,
  deleteCourse,
  deleteHole,
  draftPar,
  draftToCourse,
  holeName,
  holeSource,
  missingHoles,
  moveSlot,
  pickGroups,
  type CourseDraft,
  type CustomCourse,
  type Library,
  type SavedHole,
} from '../game/library';
import { esc, query } from './dom';

/** Two taps to delete: the first asks, the second does it. Nothing the player keeps goes on one tap. */
const SURE = 'Sure?';

function sheet(page: HTMLElement, html: string): void {
  page.innerHTML = `<div class="sheet">${html}</div>`;
}

const parBit = (par: number) => `<span class="hint"> · Par ${String(par)}</span>`;

// ------------------------------------------------------------------ my holes & courses

export type LibraryTab = 'holes' | 'courses';

export interface LibraryHost {
  page: HTMLElement;
  /** The library as it stands; `commit` hands back a changed one to store. */
  lib(): Library;
  commit(lib: Library): void;
  onBack(): void;
  /** Draw a new hole (the builder on the title screen). */
  onBuild(): void;
  /** Re-open a saved hole in the builder. */
  onOpenHole(hole: SavedHole): void;
  /** Ask for a new name for a saved hole. */
  onRenameHole(hole: SavedHole): void;
  /** Put a course together: an existing one, or a new one when it is null. */
  onEditCourse(course: CustomCourse | null): void;
  onPlayCourse(course: CustomCourse): void;
}

/** My holes & courses: the saved holes on one tab, the custom courses on the other. */
export function mountLibrary(host: LibraryHost, tab: LibraryTab): void {
  let open: LibraryTab = tab;
  /** The id whose Delete has been tapped once. */
  let asking: string | null = null;
  let note = '';

  function draw() {
    const lib = host.lib();
    sheet(
      host.page,
      `<h2>My holes &amp; courses</h2>
       <div class="tabs" role="group" aria-label="Holes or courses">
         <button class="btn small ${open === 'holes' ? 'sel' : ''}" data-tab="holes" type="button">Holes <span class="count">${String(lib.holes.length)}</span></button>
         <button class="btn small ${open === 'courses' ? 'sel' : ''}" data-tab="courses" type="button">Courses <span class="count">${String(lib.courses.length)}</span></button>
       </div>
       <p class="hint" id="library-note" role="status">${note === '' ? tabHint(open) : esc(note)}</p>
       ${open === 'holes' ? holesList(lib, asking) : coursesList(lib, asking)}
       <div class="actions">
         <button class="btn" data-act="back" type="button">Back</button>
         ${
           open === 'holes'
             ? '<button class="btn primary" data-act="build" type="button">Build a hole</button>'
             : '<button class="btn primary" data-act="new-course" type="button">New course</button>'
         }
       </div>`,
    );

    host.page.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => {
      b.addEventListener('click', () => {
        open = b.dataset.tab === 'courses' ? 'courses' : 'holes';
        asking = null;
        note = '';
        draw();
      });
    });
    query(host.page, '[data-act=back]').addEventListener('click', () => {
      host.onBack();
    });
    host.page.querySelector('[data-act=build]')?.addEventListener('click', () => {
      host.onBuild();
    });
    host.page.querySelector('[data-act=new-course]')?.addEventListener('click', () => {
      host.onEditCourse(null);
    });

    host.page.querySelectorAll<HTMLButtonElement>('[data-open]').forEach((b) => {
      b.addEventListener('click', () => {
        const hole = host.lib().holes.find((h) => h.id === b.dataset.open);
        if (hole) host.onOpenHole(hole);
      });
    });
    host.page.querySelectorAll<HTMLButtonElement>('[data-rename-hole]').forEach((b) => {
      b.addEventListener('click', () => {
        const hole = host.lib().holes.find((h) => h.id === b.dataset.renameHole);
        if (hole) host.onRenameHole(hole);
      });
    });
    host.page.querySelectorAll<HTMLButtonElement>('[data-play-course]').forEach((b) => {
      b.addEventListener('click', () => {
        const course = host.lib().courses.find((c) => c.id === b.dataset.playCourse);
        if (course) host.onPlayCourse(course);
      });
    });
    host.page.querySelectorAll<HTMLButtonElement>('[data-edit-course]').forEach((b) => {
      b.addEventListener('click', () => {
        const course = host.lib().courses.find((c) => c.id === b.dataset.editCourse);
        if (course) host.onEditCourse(course);
      });
    });
    host.page.querySelectorAll<HTMLButtonElement>('[data-del]').forEach((b) => {
      b.addEventListener('click', () => {
        const id = b.dataset.del;
        if (id === undefined) return;
        if (asking !== id) {
          asking = id;
          note = 'Tap Delete again to remove it for good.';
          draw();
          return;
        }
        asking = null;
        note = '';
        host.commit(deleteFromLib(host.lib(), id));
      });
    });
  }

  draw();
}

/** Delete whatever `id` names: a hole (`s:`) or a course (`c:`). */
const deleteFromLib = (lib: Library, id: string): Library => (id.startsWith('s:') ? deleteHole(lib, id) : deleteCourse(lib, id));

function tabHint(tab: LibraryTab): string {
  return tab === 'holes'
    ? 'Holes you drew and saved. Open one to play or change it.'
    : 'Courses of 18 holes you picked. Play one from New round, or here.';
}

function holesList(lib: Library, asking: string | null): string {
  if (lib.holes.length === 0) return '<p class="hint empty">No saved holes yet — draw one, then tap Save in the builder.</p>';
  return `<div class="list">${lib.holes
    .map(
      (h) => `<div class="list-row">
        <span class="list-name"><b>${esc(h.name)}</b>${parBit(h.hole.par)}</span>
        <span class="list-acts">
          <button class="btn small" data-open="${esc(h.id)}" type="button">Open</button>
          <button class="btn small" data-rename-hole="${esc(h.id)}" type="button">Rename</button>
          <button class="btn small" data-del="${esc(h.id)}" type="button">${asking === h.id ? SURE : 'Delete'}</button>
        </span>
      </div>`,
    )
    .join('')}</div>`;
}

function coursesList(lib: Library, asking: string | null): string {
  if (lib.courses.length === 0) return '<p class="hint empty">No courses yet — tap New course and pick 18 holes.</p>';
  return `<div class="list">${lib.courses
    .map((c) => {
      const gone = missingHoles(lib, c);
      return `<div class="list-row">
        <span class="list-name"><b>${esc(c.name)}</b>${gone.length > 0 ? `<span class="hint"> · ${String(gone.length)} hole${gone.length === 1 ? '' : 's'} gone</span>` : parBit(coursePar(lib, c))}</span>
        <span class="list-acts">
          <button class="btn small" data-play-course="${esc(c.id)}" type="button" ${gone.length > 0 ? 'disabled' : ''}>Play</button>
          <button class="btn small" data-edit-course="${esc(c.id)}" type="button">Edit</button>
          <button class="btn small" data-del="${esc(c.id)}" type="button">${asking === c.id ? SURE : 'Delete'}</button>
        </span>
      </div>`;
    })
    .join('')}</div>`;
}

// ------------------------------------------------------------------ the course editor

export interface EditorHost {
  page: HTMLElement;
  lib(): Library;
  /** The draft as it stands. The editor hands back every change, so the picker can come and go. */
  draft(): CourseDraft;
  onChange(draft: CourseDraft): void;
  /** Pick a hole for slot `i` (the shared picker, then back here). */
  onPickSlot(i: number): void;
  /** Fill all 18 slots from one built-in course. */
  onFill(): void;
  onSave(course: CustomCourse): void;
  onBack(): void;
}

/** Put a course together: name it, pick its 18 holes, move them around, save it. */
export function mountCourseEditor(host: EditorHost): void {
  let note = '';

  function draw() {
    const lib = host.lib();
    const draft = host.draft();
    const src = holeSource(lib);
    const slots = draft.slots
      .map((id, i) => {
        const name = id === null ? 'Pick a hole' : (holeName(lib, id) ?? 'That hole is gone');
        const par = id === null ? null : src.par(id);
        return `<li class="course-slot">
          <span class="slot-no">${String(i + 1)}</span>
          <button class="btn small slot-pick ${id === null ? 'empty' : ''}" data-slot="${String(i)}" type="button">${esc(name)}${par === null ? '' : parBit(par)}</button>
          <button class="btn small" data-up="${String(i)}" type="button" aria-label="Move hole ${String(i + 1)} earlier" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button class="btn small" data-down="${String(i)}" type="button" aria-label="Move hole ${String(i + 1)} later" ${i === draft.slots.length - 1 ? 'disabled' : ''}>↓</button>
        </li>`;
      })
      .join('');
    sheet(
      host.page,
      `<h2>${draft.name.trim() === '' ? 'New course' : esc(draft.name)}</h2>
       <label class="name-row">Name <input id="course-name" maxlength="${String(MAX_NAME)}" value="${esc(draft.name)}" placeholder="My course" autocomplete="off" /></label>
       <p class="hint" id="course-step" role="status">${esc(note === '' ? courseStep(lib, draft) : note)} · par ${String(draftPar(lib, draft))}</p>
       <ol class="course-slots">${slots}</ol>
       <div class="actions sticky-actions">
         <button class="btn" data-act="back" type="button">Back</button>
         <button class="btn" data-act="fill" type="button">Fill from…</button>
         <button class="btn primary" data-act="save-course" type="button">Save course</button>
       </div>`,
    );

    const name = query(host.page, '#course-name');
    if (name instanceof HTMLInputElement) {
      name.addEventListener('input', () => {
        host.onChange({ ...host.draft(), name: name.value });
      });
    }
    host.page.querySelectorAll<HTMLButtonElement>('[data-slot]').forEach((b) => {
      b.addEventListener('click', () => {
        host.onPickSlot(Number(b.dataset.slot));
      });
    });
    const move = (attr: 'up' | 'down', by: number) => {
      host.page.querySelectorAll<HTMLButtonElement>(`[data-${attr}]`).forEach((b) => {
        b.addEventListener('click', () => {
          note = '';
          host.onChange(moveSlot(host.draft(), Number(b.dataset[attr]), by));
          draw();
        });
      });
    };
    move('up', -1);
    move('down', 1);
    query(host.page, '[data-act=back]').addEventListener('click', () => {
      host.onBack();
    });
    query(host.page, '[data-act=fill]').addEventListener('click', () => {
      host.onFill();
    });
    query(host.page, '[data-act=save-course]').addEventListener('click', () => {
      const atSave = host.lib();
      const course = draftToCourse(host.draft(), Date.now());
      // The same line the step shows: a course with an empty slot, or a hole that is gone, is not saved.
      if (course === null || missingHoles(atSave, course).length > 0) {
        note = courseStep(atSave, host.draft());
        draw();
        return;
      }
      host.onSave(course);
    });
  }

  draw();
}

// ------------------------------------------------------------------ the shared hole picker

export interface PickerHost {
  page: HTMLElement;
  lib(): Library;
  title: string;
  hint: string;
  /** The player stepper over the list (Practice), or nothing. */
  players: { count: number; onCount(count: number): void } | null;
  onPick(id: string): void;
  onBack(): void;
}

/** One hole, picked: for a course slot, or to play on its own as practice. */
export function mountPicker(host: PickerHost): void {
  const groups = pickGroups(host.lib());
  let open = 0;

  function draw() {
    const group = groups[open];
    const stepper = host.players;
    sheet(
      host.page,
      `<h2>${esc(host.title)}</h2>
       <p class="hint">${esc(host.hint)}</p>
       ${
         stepper === null
           ? ''
           : `<h3>Players <span class="stepper">
               <button class="btn small" data-count="-1" type="button" aria-label="Fewer players" ${stepper.count <= 1 ? 'disabled' : ''}>−</button>
               <span class="hand" style="font-size:24px">${String(stepper.count)}</span>
               <button class="btn small" data-count="1" type="button" aria-label="More players" ${stepper.count >= 4 ? 'disabled' : ''}>+</button>
             </span></h3>`
       }
       <div class="tabs picker-tabs" role="group" aria-label="Where the hole comes from">
         ${groups.map((g, i) => `<button class="btn small ${i === open ? 'sel' : ''}" data-group="${String(i)}" type="button">${esc(g.name)}</button>`).join('')}
       </div>
       <div class="pick-grid">
         ${(group?.items ?? [])
           .map(
             (it) =>
               `<button class="btn small pick" data-pick="${esc(it.id)}" type="button"><b>${esc(it.label)}</b><small>Par ${String(it.par)}</small></button>`,
           )
           .join('')}
       </div>
       <div class="actions"><button class="btn" data-act="back" type="button">Back</button></div>`,
    );
    host.page.querySelectorAll<HTMLButtonElement>('[data-group]').forEach((b) => {
      b.addEventListener('click', () => {
        open = Number(b.dataset.group);
        draw();
      });
    });
    host.page.querySelectorAll<HTMLButtonElement>('[data-pick]').forEach((b) => {
      b.addEventListener('click', () => {
        const id = b.dataset.pick;
        if (id !== undefined) host.onPick(id);
      });
    });
    host.page.querySelectorAll<HTMLButtonElement>('[data-count]').forEach((b) => {
      b.addEventListener('click', () => {
        stepper?.onCount(stepper.count + Number(b.dataset.count));
      });
    });
    query(host.page, '[data-act=back]').addEventListener('click', () => {
      host.onBack();
    });
  }

  draw();
}

export interface CoursePickerHost {
  page: HTMLElement;
  title: string;
  hint: string;
  /** The built-in course that was picked, by index. */
  onPick(course: string): void;
  onBack(): void;
}

/** Which built-in course to fill a course draft from: one row each. */
export function mountCoursePicker(host: CoursePickerHost): void {
  sheet(
    host.page,
    `<h2>${esc(host.title)}</h2>
     <p class="hint">${esc(host.hint)}</p>
     <div class="list">
       ${COURSES.map(
         (c, i) =>
           `<div class="list-row"><span class="list-name"><b>${esc(c.name)}</b><span class="hint"> · ${esc(c.blurb)}</span></span>
            <span class="list-acts"><button class="btn small" data-pick="${String(i)}" type="button">Use</button></span></div>`,
       ).join('')}
     </div>
     <div class="actions"><button class="btn" data-act="back" type="button">Back</button></div>`,
  );
  host.page.querySelectorAll<HTMLButtonElement>('[data-pick]').forEach((b) => {
    b.addEventListener('click', () => {
      const id = b.dataset.pick;
      if (id !== undefined) host.onPick(id);
    });
  });
  query(host.page, '[data-act=back]').addEventListener('click', () => {
    host.onBack();
  });
}

// ------------------------------------------------------------------ naming something

/**
 * Ask for a name over whatever screen is showing (saving a hole from the builder, renaming one). `onDone` gets the
 * name, or null when the player backs out. Enter is Save, Escape is Cancel.
 */
export function askName(page: HTMLElement, opts: { title: string; value: string; ok: string; onDone: (name: string | null) => void }): void {
  const holder = document.createElement('div');
  holder.className = 'hole-card-holder';
  holder.innerHTML = `<div class="hole-card ask">
      <h2>${esc(opts.title)}</h2>
      <label class="name-row">Name <input id="ask-name" maxlength="${String(MAX_NAME)}" value="${esc(opts.value)}" autocomplete="off" /></label>
      <div class="actions">
        <button class="btn" data-act="cancel" type="button">Cancel</button>
        <button class="btn primary" data-act="ok" type="button">${esc(opts.ok)}</button>
      </div>
    </div>`;
  page.appendChild(holder);
  const input = query(holder, '#ask-name');
  const done = (name: string | null) => {
    holder.remove();
    opts.onDone(name);
  };
  query(holder, '[data-act=cancel]').addEventListener('click', () => {
    done(null);
  });
  query(holder, '[data-act=ok]').addEventListener('click', () => {
    done(input instanceof HTMLInputElement ? input.value : '');
  });
  if (input instanceof HTMLInputElement) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') done(input.value);
      if (e.key === 'Escape') done(null);
    });
    input.focus();
    input.select();
  }
}
