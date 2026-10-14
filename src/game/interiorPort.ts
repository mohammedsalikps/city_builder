import type { GameStore } from '@/state/GameStore';
import type { ObjectRegistry } from '@/construction/ObjectRegistry';
import { roleOf } from '@/construction/ConstructionObjectDefinition';
import type { InteriorOutcome, InteriorPort } from '@/creative/ai/BuildAssistant';
import { roomName, type RoomType } from '@/creative/plan/ConstructionPlan';
import type { InteriorExplorer } from './InteriorExplorer';

const YES_NO = ['Yes, do it', 'No thanks'];

/**
 * Interior Explorer as the AI helper's hands: each request is carried out
 * (or shown first and confirmed) by InteriorExplorer, and the answer is made
 * from what really happened - a room that does not exist is said not to
 * exist, a move that does not fit is said not to fit.
 */
export function interiorPortFor(explorer: InteriorExplorer, store: GameStore, registry: ObjectRegistry): InteriorPort {
  const roomList = (): string[] => explorer.snapshotState()?.house.rooms.map((r) => r.name) ?? [];
  const ensureInside = (): InteriorOutcome | null => {
    if (explorer.isInside) return null;
    const entered = explorer.enter();
    return entered.ok ? null : entered;
  };
  const describeRoom = (type: RoomType, ordinal: number | null) =>
    ordinal && ordinal > 1 ? `${['', 'first', 'second', 'third', 'fourth', 'fifth'][ordinal] ?? `number ${ordinal}`} ${roomName(type)}` : roomName(type);
  const findRoom = (room: { type: RoomType; ordinal: number | null }) => explorer.room({ type: room.type, ordinal: room.ordinal ?? undefined });
  const missingRoom = (room: { type: RoomType; ordinal: number | null }): InteriorOutcome => ({
    ok: false,
    message: `This house doesn't have a ${describeRoom(room.type, room.ordinal)}. It has: ${roomList().join(', ')}.`,
    choices: roomList().slice(0, 3).map((name) => `Show me the ${name.toLowerCase()}`),
  });

  return {
    isInside: () => explorer.isInside,
    hasProposal: () => explorer.hasProposal,

    enter: () => {
      const result = explorer.enter();
      if (!result.ok) return result;
      return { ok: true, message: 'Welcome inside your house! Which room would you like to explore?', choices: roomList().slice(0, 3).map((name) => `Show me the ${name.toLowerCase()}`) };
    },

    exit: () => {
      explorer.exit();
      return { ok: true, message: "We're back outside. Tap your house and choose Enter house to go in again." };
    },

    goToRoom: async (type, ordinal) => {
      const blocked = ensureInside();
      if (blocked) return blocked;
      const room = findRoom({ type, ordinal });
      if (!room) return missingRoom({ type, ordinal });
      const arrived = await explorer.goToRoom(room.id);
      return arrived
        ? { ok: true, message: `You're in the ${room.name.toLowerCase()}. Would you like to add furniture or change the colours?` }
        : { ok: false, message: `I couldn't get to the ${room.name.toLowerCase()} just now.` };
    },

    setView: (view) => {
      const blocked = ensureInside();
      if (blocked) return blocked;
      explorer.setView(view);
      return view === 'dollhouse'
        ? { ok: true, message: "Here's the whole house from above. The roof and outside walls are see-through, so you can see every room." }
        : { ok: true, message: "Let's walk around! Use W A S D, the arrow keys or the stick, and drag to look." };
    },

    tour: () => {
      const blocked = ensureInside();
      if (blocked) return blocked;
      void explorer.startTour();
      return { ok: true, message: "Follow me! I'll show you every room. Tap the screen or press a key to stop the tour." };
    },

    add: async (item, count, room, near) => {
      const blocked = ensureInside();
      if (blocked) return blocked;
      let roomId: string | undefined;
      if (room && room !== 'here') {
        const found = findRoom(room);
        if (!found) return missingRoom(room);
        roomId = found.id;
        if (explorer.snapshotState()?.roomId !== found.id) await explorer.goToRoom(found.id);
      }
      const result = explorer.proposeAdd(item.definitionId, { roomId, near: near ?? undefined, count });
      return { ...result, choices: result.ok ? YES_NO : [] };
    },

    move: (item, near) => {
      if (!explorer.isInside) return { ok: false, message: 'Go inside first, then I can move furniture around.' };
      let id: string | null = null;
      let label = 'it';
      if (item === 'it') {
        const state = store.getState();
        const selected = state.placedObjects.find((p) => p.id === state.selectedInstanceId);
        const definition = selected ? registry.get(selected.definitionId) : undefined;
        if (selected && definition && roleOf(definition) === null) {
          id = selected.id;
          label = definition.name.toLowerCase();
        }
        if (!id) return { ok: false, message: 'Tap the piece of furniture you want to move first.' };
      } else {
        // The one in this room first, else anywhere in the house.
        const here = explorer.currentRoom();
        const candidates = [...explorer.furnitureOfType(item.types, here), ...explorer.furnitureOfType(item.types, null)];
        id = candidates[0]?.id ?? null;
        label = item.word;
        if (!id) return { ok: false, message: `I can't find a ${item.word} in this house. Shall I add one? Say "add a ${item.word}".` };
      }
      const result = explorer.proposeMove(id, near);
      return { ...result, message: result.ok ? result.message : result.message.replace('that', label), choices: result.ok ? YES_NO : [] };
    },

    paint: async (item, colour, room) => {
      if (item === 'it') {
        const state = store.getState();
        const selected = state.placedObjects.find((p) => p.id === state.selectedInstanceId);
        const definition = selected ? registry.get(selected.definitionId) : undefined;
        if (!selected || !definition) return { ok: false, message: 'Tap the piece you want to paint first.' };
        if (roleOf(definition) !== null) return { ok: false, message: `I can paint furniture and decorations, but not ${definition.name.toLowerCase()}s yet.` };
        const result = explorer.proposeRecolor([selected.id], colour, definition.name.toLowerCase(), null);
        return { ...result, choices: result.ok ? YES_NO : [] };
      }
      const blocked = ensureInside();
      if (blocked) return blocked;
      let target = null;
      if (room) {
        target = findRoom(room);
        if (!target) return missingRoom(room);
      }
      const scope = target ?? explorer.currentRoom();
      let pieces = explorer.furnitureOfType(item.types, scope);
      // Nothing like that in this room: the whole house.
      if (pieces.length === 0 && !target) pieces = explorer.furnitureOfType(item.types, null);
      const what = pieces.length === 1 ? item.word : item.plural;
      if (pieces.length === 0) return { ok: false, message: `I couldn't find any ${item.plural} ${target ? `in the ${target.name.toLowerCase()}` : 'in this house'}.` };
      const result = explorer.proposeRecolor(pieces.map((p) => p.id), colour, what, (target ?? scope)?.name ?? null);
      return { ...result, choices: result.ok ? YES_NO : [] };
    },

    confirm: () => explorer.confirmProposal(),
    cancel: () => {
      explorer.cancelProposal();
      return { ok: true, message: 'Okay, nothing changed.' };
    },
  };
}
