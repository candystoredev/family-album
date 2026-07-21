/**
 * Shared types for the Faces → People pipeline. Kept dependency-free so both
 * the browser detector (`detect.ts`), the pure clustering logic (`cluster.ts`),
 * and the server routes can import them without pulling in face-api or the DB.
 */

/** A face box in normalized image coordinates (0..1), origin top-left. */
export interface FaceBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A single detected face: its box, the 128-d descriptor, detector confidence. */
export interface DetectedFace {
  box: FaceBox;
  /** 128 floats. Plain number[] so it JSON-serializes over the wire. */
  descriptor: number[];
  score: number;
}

/** A face row as clustering/matching sees it — an id plus its descriptor. */
export interface FaceVector {
  id: string;
  descriptor: number[];
}

/** A named person's reference vector: the centroid of their confirmed faces. */
export interface PersonReference {
  personId: string;
  name: string;
  centroid: number[];
  /** How many confirmed faces the centroid averages — more = more reliable. */
  count: number;
}

/** A cluster of unnamed faces proposed by {@link clusterFaces}. */
export interface FaceCluster {
  faceIds: string[];
  centroid: number[];
  /**
   * Best matching known person, if any face's centroid falls within the match
   * threshold — the closed-vocabulary "is this @Grandma?" suggestion. `null`
   * when the cluster looks like a new, unnamed person.
   */
  suggestion: { personId: string; name: string; distance: number } | null;
}
