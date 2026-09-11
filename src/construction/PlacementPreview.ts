import * as THREE from 'three';
import type { ConstructionObjectDefinition } from './ConstructionObjectDefinition';
import type { ConstructionResources } from './ConstructionResources';
import type { Vec3 } from './PlacedObject';

const INVALID_COLOR = 0xd9463c;
const INVALID_EDGE_COLOR = 0xff8a80;
const VALID_EMISSIVE = 0x111a26;
const INVALID_EMISSIVE = 0x3a0a08;

/**
 * The translucent "ghost" shown before an object is placed.
 *
 * One mesh is created up front and reused for every definition: switching
 * objects swaps the shared geometry and recolours the single preview
 * material. Nothing is allocated per mouse move, and the preview is never
 * part of the placement root, so it can never be mistaken for a placed object.
 *
 * Validity is shown by colour: the object's own tint when allowed, red when not.
 */
export class PlacementPreview {
  private readonly mesh: THREE.Mesh;
  private readonly edges: THREE.LineSegments;
  private readonly material: THREE.MeshStandardMaterial;
  private readonly edgeMaterial: THREE.LineBasicMaterial;
  private readonly validColor = new THREE.Color();
  private readonly validEdgeColor = new THREE.Color();
  private definition: ConstructionObjectDefinition | null = null;
  private valid = true;

  constructor(
    private readonly root: THREE.Object3D,
    private readonly resources: ConstructionResources,
  ) {
    this.material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      emissive: new THREE.Color(VALID_EMISSIVE),
    });
    this.edgeMaterial = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 });

    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
    this.mesh.name = 'placementPreview';
    this.mesh.visible = false;
    this.mesh.renderOrder = 10;

    this.edges = new THREE.LineSegments(new THREE.BufferGeometry(), this.edgeMaterial);
    this.mesh.add(this.edges);

    this.root.add(this.mesh);
  }

  get isVisible(): boolean {
    return this.mesh.visible;
  }

  get isValid(): boolean {
    return this.valid;
  }

  /** Change which definition is being previewed. `null` hides the preview. */
  setDefinition(definition: ConstructionObjectDefinition | null): void {
    if (definition === this.definition) return;
    this.definition = definition;
    if (!definition) {
      this.hide();
      return;
    }
    this.mesh.geometry = this.resources.getGeometry(definition);
    this.edges.geometry = this.resources.getEdges(definition);
    this.validColor.set(definition.color);
    this.validEdgeColor.set(definition.color).offsetHSL(0, 0, 0.35);
    this.applyColors();
  }

  /** Move the preview to a resolved world position and show whether it is allowed. */
  show(position: Vec3, rotationY: number, valid = true): void {
    if (!this.definition) return;
    this.mesh.position.set(position.x, position.y, position.z);
    this.mesh.rotation.set(0, rotationY, 0);
    if (valid !== this.valid) {
      this.valid = valid;
      this.applyColors();
    }
    this.mesh.visible = true;
  }

  hide(): void {
    this.mesh.visible = false;
  }

  dispose(): void {
    this.root.remove(this.mesh);
    this.material.dispose();
    this.edgeMaterial.dispose();
    // Geometries are shared with ConstructionResources and disposed there.
  }

  private applyColors(): void {
    if (this.valid) {
      this.material.color.copy(this.validColor);
      this.material.emissive.set(VALID_EMISSIVE);
      this.edgeMaterial.color.copy(this.validEdgeColor);
    } else {
      this.material.color.set(INVALID_COLOR);
      this.material.emissive.set(INVALID_EMISSIVE);
      this.edgeMaterial.color.set(INVALID_EDGE_COLOR);
    }
  }
}
