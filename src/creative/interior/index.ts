/**
 * Interior Explorer logic: the rooms of a planned house in world metres
 * (HouseInterior) and walking around inside it (WalkModel). Pure data and
 * maths - safe to load without a DOM or WebGL.
 */
export {
  EYE_HEIGHT,
  WALK_RADIUS,
  describeHouseInterior,
  findRoom,
  houseToWorld,
  roomAt,
  worldToHouse,
  type Box2,
  type InteriorFloor,
  type InteriorHouse,
  type InteriorRoom,
  type PlanRecordLike,
} from './HouseInterior';
export {
  OUTSIDE,
  buildWalkModel,
  doorGraph,
  entryPose,
  exitPoint,
  findFreeSpot,
  isFree,
  moveWithCollision,
  roomViewpoint,
  tourOrder,
  windowsOf,
  type ViewPose,
  type WalkDoor,
  type WalkModel,
  type WalkWindow,
} from './WalkModel';
