/** The validated + normalized form of a procedure, ready for XML generation. */
export interface NormalizedNode {
  nodeId: string;
  blockId: string;
  /** field name -> string value, as given in the input JSON. */
  fields: Record<string, string>;
  /** value input name -> connected child node. */
  valueInputs: Record<string, NormalizedNode>;
  /** statement input name -> ordered list of child nodes (next-chains flattened). */
  statementInputs: Record<string, NormalizedNode[]>;
}

export interface NormalizedProcedure {
  procedureName: string;
  trigger: string | null;
  /** Main statement sequence (next-chains flattened). */
  sequence: NormalizedNode[];
}
