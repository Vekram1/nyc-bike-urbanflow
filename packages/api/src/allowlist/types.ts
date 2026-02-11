export type AllowlistKind =
  | "system_id"
  | "tile_schema"
  | "severity_version"
  | "policy_version"
  | "layers_set"
  | "compare_mode";

export type AllowlistQuery = {
  kind: AllowlistKind;
  value: string;
  system_id?: string;
};

export type AllowlistRejection = {
  kind: AllowlistKind;
  value: string;
  system_id?: string;
  reason: "not_allowlisted" | "disabled" | "missing";
};

export type AllowlistStore = {
  isAllowed(query: AllowlistQuery): Promise<boolean>;
  listAllowedValues?: (args: { kind: AllowlistQuery["kind"]; system_id?: string }) => Promise<string[]>;
};
