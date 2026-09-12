import type { ConstructionObjectDefinition } from '@/construction/ConstructionObjectDefinition';
import type { ChallengeDefinition, WorldDefinition } from '@/challenges/Challenge';
import objectsJson from './objects.json';
import challengesJson from './challenges.json';
import worldsJson from './worlds.json';
import assetsJson from './assets.json';
import sceneryJson from './scenery.json';
import templatesJson from './templates.json';
import type { AssetDefinition } from '@/visual/assets/AssetRegistry';
import type { SceneryDefinition } from '@/visual/scenery/Scenery';
import type { TemplateDefinition } from '@/creative/Template';

/**
 * Entry point for all static game content. Later steps add levels,
 * challenges and materials here, each as its own JSON file.
 */
export const objectDefinitions = objectsJson as ConstructionObjectDefinition[];

/** Campaign worlds (level groups). World 2+ are added here later. */
export const worldDefinitions = worldsJson as WorldDefinition[];

/** Challenge Mode levels, in data. Levels 9+ are added here later. */
export const challengeDefinitions = challengesJson as ChallengeDefinition[];

/** 3D asset library (models under public/assets/3d). */
export const assetDefinitions = assetsJson as AssetDefinition[];

/** The world around the construction site: environment and neighbourhood. */
export const sceneryDefinition = sceneryJson as unknown as SceneryDefinition;

/** My World creative templates - starting arrangements, never levels. */
export const templateDefinitions = templatesJson as TemplateDefinition[];
