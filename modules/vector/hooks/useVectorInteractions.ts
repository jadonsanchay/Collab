import { type PointerEvent as ReactPointerEvent, useCallback, useRef, type WheelEvent } from 'react';

import type { Handle, VectorRenderer } from '@/common/render/vector/Renderer';
import { objectBounds } from '@/common/render/vector/Renderer';
import { panBy, screenToWorld, zoomAt } from '@/common/vector/camera';
import { createObject, deleteObjects, updateObject } from '@/common/vector/doc';
import { hitsObject, nearestSide, normalizeRect, rectsIntersect, topmostAt } from '@/common/vector/geometry';
import { topZ } from '@/common/vector/order';
import type { Anchor, BoardObject, Point, Rect } from '@/common/vector/types';
import { STICKY_FILLS, TEXT_FIELDS } from '@/common/vector/types';
import { isLocked, SHAPE_TOOLS, useVectorStore } from '@/common/store/vector.store';

import { childrenOf, newConnector, newFrame, newShape, newSticky, newStroke, newText } from '@/common/vector/objects';
import type { VectorSession } from '../lib/session';
import { snapRect } from '../lib/snapping';
import { angleFromCenter, resizeBox, scaleObjectsInto } from '../lib/transform';

type Drag =
  | { kind: 'pan'; last: Point }
  | { kind: 'marquee'; start: Point; additive: boolean }
  | { kind: 'move'; start: Point; ids: string[]; origin: Map<string, BoardObject>; children: Map<string, BoardObject> }
  | { kind: 'resize'; handle: Handle; start: Point; box: Rect; origin: BoardObject[] }
  | { kind: 'rotate'; center: Point; origin: Map<string, BoardObject> }
  | { kind: 'stroke'; points: [number, number, number][] }
  | { kind: 'shape'; start: Point }
  | { kind: 'frame'; start: Point }
  | { kind: 'connector'; from: Anchor; fromPoint: Point }
  | { kind: 'erase'; erased: Set<string> };

/** Snap distance in screen pixels. */
const SNAP_PX = 8;

/** Drags shorter than this are clicks. */
const CLICK_PX = 4;

const store = useVectorStore.getState;

const objectsMap = () => new Map(store().objects.map((object) => [object.id, object]));

const commitSelection = (ids: Iterable<string>) => store().setSelection(ids);

/**
 * The pointer state machine for the vector board. One active drag at a
 * time, kept in a ref so nothing here re-renders React per event; results
 * go to the Yjs document (through this client's origin, for undo) and to
 * the store (selection, camera), which the renderer subscribes to.
 */
export const useVectorInteractions = (
  session: VectorSession | null,
  rendererRef: { current: VectorRenderer | null },
  userId: string,
) => {
  const dragRef = useRef<Drag | null>(null);
  const shiftRef = useRef(false);

  const toWorld = useCallback(
    (event: { clientX: number; clientY: number }): Point =>
      screenToWorld({ x: event.clientX, y: event.clientY }, store().camera),
    [],
  );

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (!session || dragRef.current) return;

      event.currentTarget.setPointerCapture(event.pointerId);
      shiftRef.current = event.shiftKey;

      const { tool, objects, selection } = store();
      const readOnly = isLocked(store());
      const renderer = rendererRef.current;
      const point = toWorld(event);
      const panButton = event.button === 1 || event.button === 2;

      if (panButton || tool === 'hand') {
        dragRef.current = { kind: 'pan', last: { x: event.clientX, y: event.clientY } };
        return;
      }

      if (readOnly && tool !== 'select') return;

      // A new gesture is a new undo step. Without this, the undo manager
      // merges anything within its capture window into one step, so a
      // stroke, a sticky and a delete done quickly would undo as a unit.
      session.undo.stopCapturing();

      switch (tool) {
        case 'select': {
          // Viewers can select (to see what something is) but not transform.
          const handle = readOnly ? null : (renderer?.handleAt(point) ?? null);

          if (handle === 'rotate') {
            const box = renderer?.selectionBox();
            if (!box) return;

            const origin = new Map(objects.filter((o) => selection.has(o.id)).map((o) => [o.id, o]));
            dragRef.current = { kind: 'rotate', center: { x: box.x + box.w / 2, y: box.y + box.h / 2 }, origin };
            return;
          }

          if (handle) {
            const box = renderer?.selectionBox();
            if (!box) return;

            dragRef.current = {
              kind: 'resize',
              handle,
              start: point,
              box,
              origin: objects.filter((o) => selection.has(o.id)),
            };
            return;
          }

          const hit = topmostAt(point, objects);

          if (hit) {
            let ids: string[];

            if (event.shiftKey) {
              const next = new Set(selection);
              if (next.has(hit.id)) next.delete(hit.id);
              else next.add(hit.id);
              ids = [...next];
            } else {
              ids = selection.has(hit.id) ? [...selection] : [hit.id];
            }

            commitSelection(ids);

            if (readOnly) return;

            const map = objectsMap();
            const origin = new Map(ids.map((id) => [id, map.get(id) as BoardObject]));
            const children = new Map<string, BoardObject>();

            ids.forEach((id) => {
              const object = map.get(id);
              if (object?.type === 'frame') {
                childrenOf(object, objects).forEach((child) => {
                  if (!origin.has(child.id)) children.set(child.id, child);
                });
              }
            });

            dragRef.current = { kind: 'move', start: point, ids, origin, children };
            return;
          }

          if (!event.shiftKey) commitSelection([]);
          dragRef.current = { kind: 'marquee', start: point, additive: event.shiftKey };
          return;
        }

        case 'pen':
          dragRef.current = { kind: 'stroke', points: [[point.x, point.y, event.pressure || 0.5]] };
          renderer?.setLiveStrokes([{ points: dragRef.current.points, color: store().color, size: store().strokeWidth }]);
          return;

        case 'eraser':
          dragRef.current = { kind: 'erase', erased: new Set() };
          return;

        case 'rect':
        case 'ellipse':
        case 'line':
        case 'arrow':
          dragRef.current = { kind: 'shape', start: point };
          return;

        case 'frame':
          dragRef.current = { kind: 'frame', start: point };
          return;

        case 'connector': {
          const hit = topmostAt(point, objects.filter((o) => o.type !== 'connector'));
          const from: Anchor = hit ? { objectId: hit.id, side: nearestSide(hit, point) } : { x: point.x, y: point.y };

          dragRef.current = { kind: 'connector', from, fromPoint: point };
          return;
        }

        case 'text': {
          const text = newText(point, { color: store().color, fontSize: 24 }, { z: topZ(objects), createdBy: userId });
          createObject(session.doc, text, session.origin);
          commitSelection([text.id]);
          // Tool first: switching tools closes any editor.
          store().setTool('select');
          store().setEditingId(text.id);
          return;
        }

        case 'sticky': {
          const fill = STICKY_FILLS[objects.filter((o) => o.type === 'sticky').length % STICKY_FILLS.length];
          const sticky = newSticky(point, fill, { z: topZ(objects), createdBy: userId });
          createObject(session.doc, sticky, session.origin);
          commitSelection([sticky.id]);
          store().setTool('select');
          store().setEditingId(sticky.id);
          break;
        }

        default:
          break;
      }
    },
    [rendererRef, session, toWorld, userId],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      const drag = dragRef.current;
      if (!drag || !session) return;

      shiftRef.current = event.shiftKey;

      const renderer = rendererRef.current;
      const point = toWorld(event);
      const { camera } = store();

      switch (drag.kind) {
        case 'pan': {
          store().setCamera(panBy(camera, event.clientX - drag.last.x, event.clientY - drag.last.y));
          drag.last = { x: event.clientX, y: event.clientY };
          return;
        }

        case 'marquee': {
          const marquee = normalizeRect(drag.start, point);
          const map = objectsMap();
          const hits = store()
            .objects.filter((object) => !object.locked && rectsIntersect(marquee, objectBounds(object, map)))
            .map((object) => object.id);

          renderer?.setSelection({ ids: new Set(hits), marquee });
          return;
        }

        case 'move': {
          let dx = point.x - drag.start.x;
          let dy = point.y - drag.start.y;

          const moving = [...drag.origin.values()];
          const map = objectsMap();
          const boxes = moving.map((object) => objectBounds(object, map));
          const box = boxes.reduce(
            (acc, b) => ({
              x: Math.min(acc.x, b.x),
              y: Math.min(acc.y, b.y),
              w: Math.max(acc.x + acc.w, b.x + b.w) - Math.min(acc.x, b.x),
              h: Math.max(acc.y + acc.h, b.y + b.h) - Math.min(acc.y, b.y),
            }),
            boxes[0],
          );

          const others = store()
            .objects.filter((object) => !drag.origin.has(object.id) && !drag.children.has(object.id) && object.type !== 'connector')
            .map((object) => objectBounds(object, map));

          const snap = event.altKey
            ? { dx: 0, dy: 0, guides: { x: [], y: [] } }
            : snapRect({ x: box.x + dx, y: box.y + dy, w: box.w, h: box.h }, others, SNAP_PX / camera.zoom);

          dx += snap.dx;
          dy += snap.dy;

          session.doc.transact(() => {
            drag.origin.forEach((original, id) => {
              updateObject(session.doc, id, { x: original.x + dx, y: original.y + dy });
            });
            drag.children.forEach((original, id) => {
              updateObject(session.doc, id, { x: original.x + dx, y: original.y + dy });
            });
          }, session.origin);

          renderer?.setSelection({ ids: store().selection, guides: snap.guides });
          return;
        }

        case 'resize': {
          const next = resizeBox(drag.box, drag.handle, point.x - drag.start.x, point.y - drag.start.y, event.shiftKey);
          const patches = scaleObjectsInto(drag.origin, drag.box, next);

          session.doc.transact(() => {
            patches.forEach(({ id, ...patch }) => {
              if (id) updateObject(session.doc, id, patch);
            });
          }, session.origin);
          return;
        }

        case 'rotate': {
          let angle = angleFromCenter(drag.center, point);
          if (event.shiftKey) angle = Math.round(angle / 15) * 15;

          session.doc.transact(() => {
            drag.origin.forEach((_, id) => updateObject(session.doc, id, { rotation: ((angle % 360) + 360) % 360 }));
          }, session.origin);
          return;
        }

        case 'stroke': {
          drag.points.push([point.x, point.y, event.pressure || 0.5]);
          renderer?.setLiveStrokes([{ points: drag.points, color: store().color, size: store().strokeWidth }]);
          return;
        }

        case 'erase': {
          store()
            .objects.filter((object) => object.type === 'stroke' && !drag.erased.has(object.id) && hitsObject(point, object, 6))
            .forEach((object) => drag.erased.add(object.id));

          if (drag.erased.size) deleteObjects(session.doc, [...drag.erased], session.origin);
          return;
        }

        case 'shape':
        case 'frame': {
          renderer?.setSelection({ ids: new Set(), marquee: normalizeRect(drag.start, point) });
          return;
        }

        case 'connector': {
          renderer?.setSelection({ ids: new Set(), marquee: normalizeRect(drag.fromPoint, point) });
          break;
        }

        default:
          break;
      }
    },
    [rendererRef, session, toWorld],
  );

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      const drag = dragRef.current;
      dragRef.current = null;

      if (!drag || !session) return;

      const renderer = rendererRef.current;
      const point = toWorld(event);
      const { objects, selection } = store();
      const common = { z: topZ(objects), createdBy: userId };

      switch (drag.kind) {
        case 'marquee': {
          const marquee = normalizeRect(drag.start, point);
          const map = objectsMap();
          const hits = objects
            .filter((object) => !object.locked && rectsIntersect(marquee, objectBounds(object, map)))
            .map((object) => object.id);

          commitSelection(drag.additive ? [...selection, ...hits] : hits);
          renderer?.setSelection({ ids: store().selection });
          return;
        }

        case 'move':
          renderer?.setSelection({ ids: selection });
          return;

        case 'stroke': {
          renderer?.setLiveStrokes([]);

          if (drag.points.length < 2) {
            drag.points.push([point.x + 0.01, point.y + 0.01, 0.5]);
          }

          createObject(
            session.doc,
            newStroke(drag.points, { color: store().color, size: store().strokeWidth }, common),
            session.origin,
          );
          return;
        }

        case 'shape': {
          renderer?.setSelection({ ids: new Set() });

          const kind = SHAPE_TOOLS[store().tool];
          if (!kind) return;

          let to = point;

          if (Math.hypot(to.x - drag.start.x, to.y - drag.start.y) * store().camera.zoom < CLICK_PX) {
            // A click drops a default-sized shape.
            to = { x: drag.start.x + 160, y: drag.start.y + 100 };
          } else if (event.shiftKey) {
            const size = Math.max(Math.abs(to.x - drag.start.x), Math.abs(to.y - drag.start.y));
            to = { x: drag.start.x + Math.sign(to.x - drag.start.x || 1) * size, y: drag.start.y + Math.sign(to.y - drag.start.y || 1) * size };
          }

          const shape = newShape(
            kind,
            drag.start,
            to,
            { stroke: store().color, fill: store().fill, strokeWidth: store().strokeWidth },
            common,
          );

          createObject(session.doc, shape, session.origin);
          commitSelection([shape.id]);
          store().setTool('select');
          return;
        }

        case 'frame': {
          renderer?.setSelection({ ids: new Set() });

          const rect = normalizeRect(drag.start, point);
          if (rect.w * store().camera.zoom < CLICK_PX) return;

          const frame = newFrame(drag.start, point, { z: 'Zz', createdBy: userId });
          // Frames sit under everything: a `z` below the lowest object.
          frame.z = objects.length ? `${objects.map((o) => o.z).sort()[0]}0` : 'a0';
          createObject(session.doc, frame, session.origin);
          commitSelection([frame.id]);
          store().setTool('select');
          return;
        }

        case 'connector': {
          renderer?.setSelection({ ids: new Set() });

          const hit = topmostAt(point, objects.filter((o) => o.type !== 'connector'));
          const to: Anchor = hit ? { objectId: hit.id, side: nearestSide(hit, point) } : { x: point.x, y: point.y };

          if (!hit && Math.hypot(point.x - drag.fromPoint.x, point.y - drag.fromPoint.y) * store().camera.zoom < CLICK_PX) return;

          const connector = newConnector(drag.from, to, { stroke: store().color, strokeWidth: store().strokeWidth }, common);
          createObject(session.doc, connector, session.origin);
          commitSelection([connector.id]);
          store().setTool('select');
          break;
        }

        default:
          break;
      }
    },
    [rendererRef, session, toWorld, userId],
  );

  /** Double-clicking something with text opens the editor on it. */
  const handleDoubleClick = useCallback(
    (event: { clientX: number; clientY: number }) => {
      const { objects, tool } = store();
      if (isLocked(store()) || (tool !== 'select' && tool !== 'hand')) return;

      const hit = topmostAt(toWorld(event), objects);
      if (!hit || hit.locked || !TEXT_FIELDS[hit.type]) return;

      commitSelection([hit.id]);
      store().setEditingId(hit.id);
    },
    [toWorld],
  );

  const handleWheel = useCallback(
    (event: WheelEvent<HTMLDivElement>) => {
      const { camera } = store();

      if (event.ctrlKey || event.metaKey) {
        const factor = Math.exp(-event.deltaY / 300);
        store().setCamera(zoomAt(camera, { x: event.clientX, y: event.clientY }, factor));
      } else {
        store().setCamera(panBy(camera, -event.deltaX, -event.deltaY));
      }
    },
    [],
  );

  const cancelDrag = useCallback(() => {
    dragRef.current = null;
    rendererRef.current?.setLiveStrokes([]);
    rendererRef.current?.setSelection({ ids: store().selection });
  }, [rendererRef]);

  return { handlePointerDown, handlePointerMove, handlePointerUp, handleDoubleClick, handleWheel, cancelDrag };
};
