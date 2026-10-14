import type { ConstructionPlan } from '@/creative/plan/ConstructionPlan';
import type { LayoutFacts } from '@/creative/plan/LayoutKit';

/**
 * One short, encouraging design idea after something is built - learning
 * through what the child just made, never a lesson to sit through. Every
 * idea is built from the layout's MEASURED facts (what was really placed,
 * and how far apart), so a tip can never describe something that is not
 * there. Deterministic: the same build and seed give the same tip.
 */
export type DesignConcept =
  | 'Dimensions'
  | 'Room layout'
  | 'Symmetry'
  | 'Light'
  | 'Materials'
  | 'Accessibility'
  | 'Landscaping'
  | 'Planning'
  | 'Safety'
  | 'Spacing';

export interface DesignTip {
  concept: DesignConcept;
  text: string;
}

/** A family car is about 4.5 m long - a size children can picture. */
const CAR_LENGTH = 4.5;

interface Idea extends DesignTip {
  /** Words in a change list ("2 more benches", "a playground") this idea is about. */
  about: string[];
}

/**
 * The tip for a creation just built (`changes` empty) or just changed (the
 * PlanBuilder change list, e.g. ["4 m wider", "a balcony"]). A change gets
 * the idea about what changed when there is one; otherwise `seed` varies
 * the idea between builds so the child does not see the same one every time.
 */
export function designTip(plan: ConstructionPlan, changes: readonly string[], seed: number, facts: LayoutFacts): DesignTip {
  const ideas = ideasFor(plan, facts);
  const matching = ideas.find((idea) => idea.about.some((word) => changes.some((change) => change.includes(word))));
  const chosen = matching ?? ideas[Math.abs(Math.floor(seed)) % ideas.length];
  return { concept: chosen.concept, text: chosen.text };
}

function ideasFor(plan: ConstructionPlan, facts: LayoutFacts): Idea[] {
  const { counts, measures, flags } = facts;
  const ideas: Idea[] = [];
  const idea = (concept: DesignConcept, text: string, about: string[] = []) => ideas.push({ concept, text, about });
  const m = (value: number) => `${Number.isInteger(value) ? value : value.toFixed(1)} m`;

  switch (plan.kind) {
    case 'house': {
      const cars = Math.max(1, Math.round(plan.size.width / CAR_LENGTH));
      idea('Dimensions', `Your house is ${plan.size.width} m wide - about as long as ${cars} car${cars === 1 ? '' : 's'} parked in a row!`, ['wider', 'narrower', 'deeper', 'shallower']);
      if (flags.bedroomsAtBack) idea('Room layout', 'The bedrooms are at the back, away from the front door, so they stay quiet for sleeping.', ['bedroom']);
      if (flags.balcony) idea('Safety', 'Builders put railings round a balcony so nobody can fall off - safety first!', ['balcony']);
      if (plan.roof === 'gable') idea('Materials', 'A pitched roof is made of overlapping tiles, like fish scales, so rain slides straight off.', ['roof']);
      if (plan.roof === 'flat') idea('Materials', 'Flat roofs need a gentle slope and good drains so rain water can run away.', ['roof']);
      if (plan.garden && counts.tree) idea('Landscaping', 'Trees at the back give shade in summer and shelter the house from the wind.', ['garden']);
      if (flags.driveway) idea('Planning', 'The driveway is on the other side from the front door, so cars never cross the path.', ['driveway']);
      if (flags.everyRoomHasWindow) idea('Light', 'Every room has a window. Daylight makes rooms bright and cheerful - and saves electricity.');
      idea('Accessibility', `The doors are ${Math.round(measures.doorWidth * 100)} cm wide - wide enough for a wheelchair to roll through. Good builders think about everyone.`);
      if (measures.bathroomFittings > 0) idea('Room layout', 'In the bathroom everything stands against the walls, so the middle stays free to move about.', ['bathroom']);
      if (counts.counter) idea('Room layout', 'The kitchen worktop stands against a wall, with the table in the open floor so you can walk round it.', ['kitchen']);
      if (flags.armchairs) idea('Room layout', 'Big rooms fit more furniture: your living room has room for a sofa, a table and two armchairs.', ['wider', 'bigger']);
      if ('near' in plan.site && plan.site.near === 'lake') idea('Planning', 'Your house stands back from the lake shore, so the ground under it stays firm and dry.', ['new spot']);
      break;
    }
    case 'garden':
    case 'park': {
      const garden = plan.kind === 'garden';
      if (flags.path) {
        idea(
          'Accessibility',
          garden
            ? `Your path is ${m(measures.pathWidth)} wide - room to walk along it without stepping on the flowers.`
            : `The paths are ${m(measures.pathWidth)} wide, so two people can walk side by side.`,
          ['path'],
        );
      }
      if (measures.lawnArea > 0) idea('Landscaping', `You kept about ${measures.lawnArea} square metres of open grass. Open space lets the sun reach the ground and gives room to play.`, ['wider', 'bigger', 'smaller']);
      if (flags.benchFacesFlowers) idea('Planning', 'A bench looks out over the flowers, so you can sit and enjoy them.', ['bench', 'flower']);
      if (flags.playground && measures.minPlayClearance > 0) {
        idea('Safety', `Every piece of play equipment has at least ${m(measures.minPlayClearance)} of free space round it, so children don't bump into each other.`, ['playground']);
      }
      if ((counts.tree ?? 0) > 1 && measures.minTreeGap > 0) idea('Spacing', `The trees are at least ${m(measures.minTreeGap)} apart, so each one has room to spread its branches.`, ['tree']);
      if (counts.fence && flags.path) idea('Planning', 'The fence has a gate right where the path comes in, so there is a clear way in.', ['fence']);
      if (counts.streetlight) idea('Safety', 'Lamps along the paths help people find their way after dark.', ['lamps']);
      if (!garden && counts.bench && flags.path) idea('Planning', 'Benches stand beside the paths, facing them, with room in front for your legs.', ['bench']);
      idea('Dimensions', `Your ${plan.kind} is ${plan.size.width} × ${plan.size.depth} m - that's ${plan.size.width * plan.size.depth} square metres of ground.`, ['wider', 'deeper']);
      break;
    }
    case 'neighborhood': {
      if (measures.minHouseGap > 0) idea('Spacing', `There are at least ${m(measures.minHouseGap)} between neighbouring houses, so each one gets light, privacy and room for a garden.`, ['house']);
      if (flags.street) idea('Safety', `Pavements ${m(measures.pavementWidth)} wide keep people walking safely away from the cars on the street.`, ['street']);
      if (flags.park) idea('Planning', 'The houses share a little park, so neighbours have a place to play and meet.', ['park']);
      if (flags.frontPaths) idea('Planning', 'Every front path leads straight to the pavement, so everyone can walk out of their door to the street.');
      idea('Dimensions', `The street is ${m(measures.streetLength)} long - about ${Math.max(1, Math.round(measures.streetLength / CAR_LENGTH))} cars nose to tail.`, ['house']);
      break;
    }
    case 'treehouse': {
      idea('Safety', `The deck is ${m(measures.deckHeight)} up, so railings ${m(measures.railingHeight)} high go round every open edge to keep everyone safe.`);
      idea('Materials', `${measures.posts} strong posts hold the deck up, so the tree does not have to carry its weight.`);
      if (flags.ladder) idea('Safety', `The ladder's rails reach ${m(measures.handholds)} above the deck, so your hands have something to hold at the top.`, ['ladder']);
      if (flags.stairs) idea('Accessibility', 'Stairs are easier to climb than a ladder, especially when you are carrying something.', ['stairs']);
      if (flags.roof) idea('Materials', "The hut's pitched roof lets rain run straight off.", ['hut', 'roof']);
      // A storey of a house is about 3 m.
      if (measures.treeHeight >= 6) idea('Dimensions', `The tree is ${m(measures.treeHeight)} tall - taller than a two-storey house!`);
      break;
    }
    case 'objects': {
      const play = (counts.swing ?? 0) + (counts.slide ?? 0) + (counts.sandpit ?? 0);
      if (play > 0) idea('Safety', 'The play equipment stands 3 m apart, so everyone can play safely.', ['swing', 'slide', 'sandpit']);
      idea('Spacing', `Everything is at least ${m(measures.spacing)} apart, so there is room to walk between them.`);
      break;
    }
  }
  return ideas;
}
