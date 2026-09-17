import { roleOf, type ConstructionObjectDefinition, type ObjectCategory } from '@/construction/ConstructionObjectDefinition';
import type { ObjectRegistry } from '@/construction/ObjectRegistry';
import type { TemplateRegistry } from './Template';

/**
 * World Studio's child-facing vocabulary, loaded from src/data/studio.json:
 * the Build Orb's creations ("Build a house"), the styles each offers, the
 * city stories a child can pick, and the "Make it yours" shortcuts shown
 * for a selected object. Pure presentation data - every entry resolves to
 * something the engine already has (a template, a definition, a street
 * drawing session), so nothing here adds a second way to describe the world.
 */

export type CreationKind = 'template' | 'piece' | 'street' | 'drawer';
export type ImprovementKind = 'home' | 'street' | 'nature' | 'vehicle' | 'furniture' | 'decor';

export interface CreationVariant {
  id: string;
  name: string;
  hint?: string;
  /** For kind 'template'. */
  templateId?: string;
  /** For kind 'piece'. */
  definitionId?: string;
}

export interface CreationDefinition {
  id: string;
  name: string;
  /** Intent phrasing shown while it's active ("Build a house"). */
  verb: string;
  /** Icon id (see ui/studio/icons.ts). */
  icon: string;
  ring: 'inner' | 'outer';
  kind: CreationKind;
  improve: ImprovementKind;
  variants: CreationVariant[];
}

export interface StoryDefinition {
  id: string;
  name: string;
  icon: string;
  tagline: string;
  /** Creation ids this story highlights in the Build Orb. Never restricts anything. */
  suggests: string[];
}

export type ImprovementAction =
  | { id: string; name: string; icon: string; type: 'near'; items: string[]; needs?: 'walls' }
  | { id: string; name: string; icon: string; type: 'place'; definitionId: string; needs?: 'walls' }
  | { id: string; name: string; icon: string; type: 'street'; needs?: 'walls' };

export interface ImprovementSet {
  title: string;
  actions: ImprovementAction[];
}

export interface PieceShelf {
  id: string;
  name: string;
  icon: string;
  categories: ObjectCategory[];
}

export interface StudioData {
  stories: StoryDefinition[];
  creations: CreationDefinition[];
  improvements: Record<ImprovementKind, ImprovementSet>;
  pieces: PieceShelf[];
}

export class StudioCatalog {
  constructor(
    readonly data: StudioData,
    registry: ObjectRegistry,
    templates: TemplateRegistry,
  ) {
    validate(data, registry, templates);
  }

  get creations(): CreationDefinition[] {
    return this.data.creations;
  }

  get stories(): StoryDefinition[] {
    return this.data.stories;
  }

  get pieces(): PieceShelf[] {
    return this.data.pieces;
  }

  creation(id: string): CreationDefinition | undefined {
    return this.data.creations.find((c) => c.id === id);
  }

  story(id: string | null): StoryDefinition | undefined {
    return id ? this.data.stories.find((s) => s.id === id) : undefined;
  }

  improvements(kind: ImprovementKind): ImprovementSet {
    return this.data.improvements[kind];
  }

  /** Which "Make it yours" set suits a selected object. Driven by role/category, never by id. */
  improvementKindOf(definition: ConstructionObjectDefinition): ImprovementKind {
    const role = roleOf(definition);
    if (role === 'wall' || role === 'floor' || role === 'roof' || role === 'opening') return 'home';
    switch (definition.category) {
      case 'buildings':
      case 'structures':
      case 'openings':
        return 'home';
      case 'roads':
        return 'street';
      case 'nature':
        return 'nature';
      case 'vehicles':
        return 'vehicle';
      case 'furniture':
        return 'furniture';
      default:
        return 'decor';
    }
  }

  /** A friendly noun for a selected object's bubble title. */
  friendlyKindName(definition: ConstructionObjectDefinition): string {
    const role = roleOf(definition);
    if (definition.category === 'buildings') return definition.name;
    if (definition.category === 'roads') {
      if (definition.type === 'sidewalk') return 'Sidewalk';
      if (definition.type === 'driveway' || definition.id.includes('driveway')) return 'Driveway';
      return 'Street';
    }
    if (role === 'wall') return 'Wall';
    if (role === 'roof') return 'Roof';
    if (role === 'floor') return 'Floor';
    return definition.name;
  }
}

function validate(data: StudioData, registry: ObjectRegistry, templates: TemplateRegistry): void {
  const fail = (message: string): never => {
    throw new Error(`Invalid studio data: ${message}`);
  };
  const creationIds = new Set(data.creations.map((c) => c.id));
  for (const creation of data.creations) {
    for (const variant of creation.variants) {
      if (creation.kind === 'template' && (!variant.templateId || !templates.get(variant.templateId))) {
        fail(`creation "${creation.id}" variant "${variant.id}" needs a known templateId`);
      }
      if (creation.kind === 'piece' && (!variant.definitionId || !registry.has(variant.definitionId))) {
        fail(`creation "${creation.id}" variant "${variant.id}" needs a known definitionId`);
      }
    }
    if (!data.improvements[creation.improve]) fail(`creation "${creation.id}" improve set "${creation.improve}" is missing`);
  }
  for (const story of data.stories) {
    for (const id of story.suggests) if (!creationIds.has(id)) fail(`story "${story.id}" suggests unknown creation "${id}"`);
  }
  for (const [kind, set] of Object.entries(data.improvements)) {
    for (const action of set.actions) {
      if (action.type === 'near') {
        for (const item of action.items) if (!registry.has(item)) fail(`improvement ${kind}.${action.id} uses unknown "${item}"`);
      } else if (action.type === 'place' && !registry.has(action.definitionId)) {
        fail(`improvement ${kind}.${action.id} uses unknown "${action.definitionId}"`);
      }
    }
  }
}
